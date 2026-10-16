-- Spec 0008. Voice session lifecycle. This file is the single owner of every session rule:
-- table structure, field invariants (guard trigger), lock order (voice_lock), time rules
-- (voice_expire), safe closure (voice_close), eligibility (voice_eligible/voice_fileable),
-- every transition (voice_reserve, voice_transition) and the filing check.
-- The Worker never decides a next state. It submits events with external observations
-- and returns the projection this file produces.
--
-- Shared lock order (spec 0008 "Atomic filing and value sourcing"), enforced only by voice_lock:
--   1. SFDA reservation advisory lock (reserve, local_verification claim only)
--   2. caller profile
--   3. competition
--   4. campaign
--   5. campaign_coaches row, then campaign_players row
--   6. voice_sessions rows in UUID order
--   7. feedback draft, receipt (existing private.mutate / private.write_feedback order)
--
-- Refusal rule: a lifecycle refusal is RETURNED as {refusal: code}, never raised, so that
-- writes the refusal itself causes (revocation, local failure, expiry) commit. Raised errors
-- are reserved for AUTH_REQUIRED, FORBIDDEN, NOT_FOUND, INVALID_INPUT, IDEMPOTENCY_CONFLICT and
-- DATABASE_ERROR, and are only raised before anything is written.

-- ---------------------------------------------------------------- types
create type public.voice_local_outcome as enum ('open','finished','failed','timed_out','cancelled');
create type public.voice_provider_state as enum ('not_issued','unknown','live','terminal');
create type public.voice_authorisation_kind as enum ('production_activation','local_verification');
create type public.voice_session_status as enum
  ('reserved','authorising','active','finishing','proposal_ready','completed','cancelled','failed','expired','uncertain');
-- The complete event vocabulary. Adding an event means adding one branch to voice_transition.
create type private.voice_event as enum
  ('validate','claim','arm','issuance','connect','finish','accept','end','observe','reconcile');

-- Every operating constant lives here. The Worker manifest's fixed limits are compared with
-- this record at claim; a mismatch fails closed. The browser receives the values it needs in
-- the projection and never hard codes them.
create type private.voice_limit_values as (
  reservation_window interval,   -- 30 s, reserve -> claim
  dispatch_window interval,      -- 10 s, claim -> arm -> Fetch
  setup_window interval,         -- 40 s, arm -> /connected (10 s token Fetch + 30 s local setup)
  call_cap interval,             -- 300 s, provider enforced
  hold_margin interval,          -- 30 s, added to the hold formula
  finish_window interval,        -- 20 s
  warning_lead interval,         -- 30 s remaining warning
  coach_daily integer,           -- 20
  sfda_daily integer,            -- 100
  local_run_cases integer,       -- 10
  retention interval,            -- 30 days after ended_at
  filing_ids integer             -- 100 voice_session_ids per write
);
create function private.voice_limits() returns private.voice_limit_values language sql immutable set search_path = '' as $$
  select row(interval '30 seconds', interval '10 seconds', interval '40 seconds', interval '300 seconds', interval '30 seconds',
    interval '20 seconds', interval '30 seconds', 20, 100, 10, interval '30 days', 100)::private.voice_limit_values;
$$;

-- Trusted configuration facts. Supplied by the Worker from its verified manifest on every
-- event that needs them and bound to the row by fingerprint, so the database needs no
-- second configuration table and a Worker holding a different manifest cannot act on a row.
create type private.voice_config_facts as (
  fingerprint text,
  agent_id text,
  agent_version_id text,
  credential_rule text,                 -- 'hold_only' | 'terminal_consumes'
  capture_rule text,                    -- 'mute_stops_capture' | 'unproven'
  dispatch_to_issuance_seconds integer, -- null = bound not established
  redemption_seconds integer,           -- null = bound not established
  limits jsonb                          -- {callCapSeconds, finishSeconds, coachDaily, sfdaDaily}
);

-- ---------------------------------------------------------------- table
create table public.voice_sessions (
  id uuid primary key default gen_random_uuid(),
  start_request_id uuid not null,
  coach_id uuid not null references public.profiles(id) on delete restrict,
  campaign_id uuid not null,
  competition_id uuid not null,
  player_id uuid not null,
  kind public.feedback_kind not null check (kind = 'preparation'),
  campaign_version integer not null check (campaign_version > 0),
  caller_version integer not null check (caller_version > 0),
  coach_membership_version integer not null check (coach_membership_version > 0),
  player_membership_version integer not null check (player_membership_version > 0),
  config_fingerprint text check (config_fingerprint ~ '^[a-f0-9]{64}$'),
  agent_version_id text check (agent_version_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  authorisation_kind public.voice_authorisation_kind,
  authorisation_evidence_id text check (authorisation_evidence_id ~ '^[A-Za-z0-9._:-]{1,200}$'),
  authorisation_until timestamptz,
  -- Status is derived, never written. It cannot drift from the fields that decide it.
  status public.voice_session_status generated always as (
    case
      when ended_at is not null then case local_outcome
        when 'finished' then 'completed'::public.voice_session_status
        when 'cancelled' then 'cancelled'::public.voice_session_status
        when 'failed' then 'failed'::public.voice_session_status
        else 'expired'::public.voice_session_status end
      when local_outcome <> 'open' then 'uncertain'::public.voice_session_status
      when proposal_accepted_at is not null then 'proposal_ready'::public.voice_session_status
      when finish_requested_at is not null then 'finishing'::public.voice_session_status
      when connected_at is not null then 'active'::public.voice_session_status
      when dispatch_id is not null then 'authorising'::public.voice_session_status
      else 'reserved'::public.voice_session_status
    end) stored,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default current_timestamp,
  updated_at timestamptz not null default current_timestamp,
  reservation_until timestamptz not null,
  dispatch_id uuid unique,
  dispatch_authorised_at timestamptz,
  dispatch_until timestamptz,
  dispatch_started_at timestamptz,
  hold_until timestamptz,
  credential_valid_until timestamptz,
  local_outcome public.voice_local_outcome not null default 'open',
  provider_state public.voice_provider_state not null default 'not_issued',
  local_ended_at timestamptz,
  proposal_revoked_at timestamptz,
  provider_terminal_at timestamptz,
  provider_conversation_id text check (provider_conversation_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  proposal_id uuid,
  proposal_accepted_at timestamptz,
  identity_verified_at timestamptz,
  connected_at timestamptz,
  finish_requested_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer check (duration_seconds between 0 and 600),
  failure_code text check (failure_code in ('RESERVATION_EXPIRED','DISPATCH_EXPIRED','SETUP_EXPIRED','CALL_CAP',
    'FINISH_EXPIRED','CONFIG_INVALID','ISSUANCE_REFUSED','START_UNKNOWN','CONVERSATION_MISMATCH',
    'EXECUTION_IDENTITY_UNAVAILABLE','CONTEXT_CHANGED','BACKGROUNDED','TRANSPORT_FAILED')),
  unique (coach_id, start_request_id),
  foreign key (campaign_id, competition_id) references public.campaigns(id, competition_id) on delete restrict,
  foreign key (competition_id, coach_id, player_id, campaign_id)
    references public.competition_pairings(competition_id, coach_id, player_id, campaign_id) on delete restrict,
  -- Claim binds configuration, authorisation and dispatch together.
  check (num_nulls(config_fingerprint, agent_version_id, authorisation_kind, authorisation_evidence_id, authorisation_until,
    dispatch_id, dispatch_authorised_at, dispatch_until) in (0, 8)),
  check (dispatch_until is null or dispatch_until <= authorisation_until),
  check (dispatch_started_at is null or dispatch_id is not null),
  check (provider_state = 'not_issued' or dispatch_started_at is not null),
  check (provider_conversation_id is null or dispatch_started_at is not null),
  check ((connected_at is null) = (identity_verified_at is null)),
  check (identity_verified_at is null or provider_conversation_id is not null),
  check (finish_requested_at is null or connected_at is not null),
  check ((proposal_id is null) = (proposal_accepted_at is null)),
  check (proposal_accepted_at is null or finish_requested_at is not null),
  check ((local_outcome = 'open') = (local_ended_at is null)),
  check (local_outcome <> 'cancelled' or proposal_revoked_at is not null),
  check ((provider_state = 'terminal') = (provider_terminal_at is not null)),
  check (ended_at is null or local_outcome <> 'open'),
  check (duration_seconds is null or ended_at is not null)
);
create unique index voice_one_outstanding on public.voice_sessions (coach_id) where ended_at is null;
create index voice_coach_created on public.voice_sessions (coach_id, created_at);
create index voice_created on public.voice_sessions (created_at);
create index voice_outstanding_order on public.voice_sessions (created_at, id) where ended_at is null;
create index voice_ended on public.voice_sessions (ended_at) where ended_at is not null;

-- ---------------------------------------------------------------- field invariants
create function private.voice_set_once(before anyelement, after anyelement) returns boolean
language sql immutable set search_path = '' as $$ select before is null or before is not distinct from after $$;

-- Structural backstop for every writer, including future ones. Transition preconditions
-- live in voice_transition; what a field may become once written lives here.
create function private.guard_voice_session() returns trigger language plpgsql security definer set search_path = '' as $$
declare l private.voice_limit_values := private.voice_limits();
  mutable_after_end constant text[] := array['local_outcome','proposal_revoked_at','failure_code','version','updated_at','status'];
begin
  if tg_op = 'DELETE' then
    if old.ended_at is null or old.ended_at > current_timestamp - l.retention then perform private.fail('IMMUTABLE_RECORD'); end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.version <> 1 or new.local_outcome <> 'open' or new.provider_state <> 'not_issued'
      or new.reservation_until <> new.created_at + l.reservation_window
      or num_nonnulls(new.config_fingerprint, new.dispatch_id, new.dispatch_started_at, new.hold_until, new.credential_valid_until,
        new.local_ended_at, new.proposal_revoked_at, new.provider_terminal_at, new.provider_conversation_id, new.proposal_id,
        new.identity_verified_at, new.connected_at, new.finish_requested_at, new.ended_at, new.duration_seconds, new.failure_code) > 0
      then perform private.fail('INVALID_INPUT'); end if;
    return new;
  end if;
  if new.version <> old.version + 1 or new.updated_at <> current_timestamp then perform private.fail('VERSION_CONFLICT'); end if;
  -- Identity and captured binding never change.
  if (new.id,new.start_request_id,new.coach_id,new.campaign_id,new.competition_id,new.player_id,new.kind,new.campaign_version,
      new.caller_version,new.coach_membership_version,new.player_membership_version,new.created_at,new.reservation_until)
    is distinct from (old.id,old.start_request_id,old.coach_id,old.campaign_id,old.competition_id,old.player_id,old.kind,
      old.campaign_version,old.caller_version,old.coach_membership_version,old.player_membership_version,old.created_at,old.reservation_until)
    then perform private.fail('IMMUTABLE_RECORD'); end if;
  -- Set once: a dispatch, a conversation reference, an acceptance, a revocation and a closure are permanent.
  if not (private.voice_set_once(old.config_fingerprint,new.config_fingerprint) and private.voice_set_once(old.agent_version_id,new.agent_version_id)
    and private.voice_set_once(old.authorisation_kind,new.authorisation_kind) and private.voice_set_once(old.authorisation_evidence_id,new.authorisation_evidence_id)
    and private.voice_set_once(old.authorisation_until,new.authorisation_until) and private.voice_set_once(old.dispatch_id,new.dispatch_id)
    and private.voice_set_once(old.dispatch_authorised_at,new.dispatch_authorised_at) and private.voice_set_once(old.dispatch_until,new.dispatch_until)
    and private.voice_set_once(old.dispatch_started_at,new.dispatch_started_at) and private.voice_set_once(old.credential_valid_until,new.credential_valid_until)
    and private.voice_set_once(old.local_ended_at,new.local_ended_at) and private.voice_set_once(old.proposal_revoked_at,new.proposal_revoked_at)
    and private.voice_set_once(old.provider_terminal_at,new.provider_terminal_at) and private.voice_set_once(old.provider_conversation_id,new.provider_conversation_id)
    and private.voice_set_once(old.proposal_id,new.proposal_id) and private.voice_set_once(old.proposal_accepted_at,new.proposal_accepted_at)
    and private.voice_set_once(old.identity_verified_at,new.identity_verified_at) and private.voice_set_once(old.connected_at,new.connected_at)
    and private.voice_set_once(old.finish_requested_at,new.finish_requested_at) and private.voice_set_once(old.ended_at,new.ended_at)
    and private.voice_set_once(old.failure_code,new.failure_code))
    then perform private.fail('IMMUTABLE_RECORD'); end if;
  -- Revocation is irreversible (set once above, never cleared).
  if old.proposal_revoked_at is not null and new.proposal_revoked_at is null then perform private.fail('IMMUTABLE_RECORD'); end if;
  -- The hold deadline is set by claim, may later only drop to null (outside contract), never move.
  if old.dispatch_id is not null and new.hold_until is distinct from old.hold_until and new.hold_until is not null
    then perform private.fail('IMMUTABLE_RECORD'); end if;
  -- First local ending is fixed; only cancellation may supersede it.
  if old.local_outcome <> 'open' and new.local_outcome <> old.local_outcome and new.local_outcome <> 'cancelled'
    then perform private.fail('IMMUTABLE_RECORD'); end if;
  -- Provider state moves forward. unknown -> not_issued only for a definite refusal with no conversation.
  if (old.provider_state, new.provider_state) not in (
      ('not_issued','not_issued'),('not_issued','unknown'),('unknown','unknown'),('unknown','live'),('unknown','terminal'),
      ('live','live'),('live','terminal'),('terminal','terminal'))
    and not (old.provider_state = 'unknown' and new.provider_state = 'not_issued' and new.provider_conversation_id is null)
    then perform private.fail('IMMUTABLE_RECORD'); end if;
  -- After safe closure only cancellation's revocation may still be recorded.
  if old.ended_at is not null and (to_jsonb(new) - mutable_after_end) is distinct from (to_jsonb(old) - mutable_after_end)
    then perform private.fail('IMMUTABLE_RECORD'); end if;
  return new;
end; $$;
create trigger guard_voice_session before insert or update or delete on public.voice_sessions
  for each row execute function private.guard_voice_session();

-- ---------------------------------------------------------------- access
alter table public.voice_sessions enable row level security;
revoke all on public.voice_sessions from public, anon, authenticated, service_role;
-- Metadata only: every column is safe. Author and enabled admins read; nobody mutates directly.
create policy voice_session_reads on public.voice_sessions for select to authenticated using (
  private.enabled_role() = 'admin' or (private.enabled_role() = 'coach' and coach_id = auth.uid())
);
grant select on public.voice_sessions to authenticated;

-- ---------------------------------------------------------------- derived predicates
-- Captured revisions still equal current authoritative rows, with live permission.
-- Versions only increase, so a mismatch is permanent: disabling then restoring access never
-- revalidates an old binding even where the stored revocation instant was rolled back.
create function private.voice_binding_valid(s public.voice_sessions) returns boolean
language sql stable set search_path = '' as $$
  select exists (
    select from public.profiles p
    join public.campaigns c on c.id = s.campaign_id
    join public.campaign_coaches cc on cc.campaign_id = s.campaign_id and cc.coach_id = s.coach_id
    join public.campaign_players cp on cp.campaign_id = s.campaign_id and cp.player_id = s.player_id
    where p.id = s.coach_id and p.access_enabled and p.role = 'coach' and p.version = s.caller_version
      and c.stage = 'preparation' and c.version = s.campaign_version
      and cc.is_active and cc.version = s.coach_membership_version
      and cp.is_active and cp.version = s.player_membership_version);
$$;
create function private.voice_finish_until(s public.voice_sessions) returns timestamptz
language sql immutable set search_path = '' as $$
  select least(s.finish_requested_at + (private.voice_limits()).finish_window, s.connected_at + (private.voice_limits()).call_cap);
$$;
-- Review eligibility: may this proposal be shown and applied?
create function private.voice_eligible(s public.voice_sessions) returns boolean
language sql stable set search_path = '' as $$
  select s.proposal_accepted_at is not null and s.identity_verified_at is not null and s.proposal_revoked_at is null
    and private.voice_binding_valid(s);
$$;
-- Filing eligibility: review eligibility plus locally ended capture. Remote uncertainty alone never rejects.
create function private.voice_fileable(s public.voice_sessions) returns boolean
language sql stable set search_path = '' as $$
  select private.voice_eligible(s) and s.local_outcome in ('finished','failed','timed_out');
$$;

-- ---------------------------------------------------------------- the one lock helper
create function private.voice_lock_members(campaign uuid, coach uuid, player uuid) returns void
language plpgsql set search_path = '' as $$
begin
  perform 1 from public.campaign_coaches where campaign_id = campaign and coach_id = coach for update;
  perform 1 from public.campaign_players where campaign_id = campaign and player_id = player for update;
end; $$;
create function private.voice_lock(coach uuid, campaign uuid, player uuid, reservation boolean) returns void
language plpgsql set search_path = '' as $$
declare competition uuid;
begin
  -- 1. Never acquired after a profile or session lock: callers invoke voice_lock first in their transaction.
  if reservation then perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sfda.voice_reservation', 0)); end if;
  -- 2.
  perform 1 from public.profiles where id = coach for update;
  -- 3. and 4. The campaign's competition is immutable, so the unlocked read is safe.
  select c.competition_id into competition from public.campaigns c where c.id = campaign;
  if not found then perform private.fail('NOT_FOUND'); end if;
  perform 1 from public.competitions where id = competition for update;
  perform 1 from public.campaigns where id = campaign for update;
  -- 5.
  perform private.voice_lock_members(campaign, coach, player);
  -- 6. is the caller's: select ... from public.voice_sessions ... order by id for update.
end; $$;

-- ---------------------------------------------------------------- pure row steps
create function private.voice_end_local(s public.voice_sessions, outcome public.voice_local_outcome, code text, at_time timestamptz)
returns public.voice_sessions language plpgsql immutable set search_path = '' as $$
begin
  if outcome = 'cancelled' then
    s.local_outcome := 'cancelled';
    s.proposal_revoked_at := coalesce(s.proposal_revoked_at, at_time);
  elsif s.local_outcome = 'open' then
    s.local_outcome := outcome;
  end if;
  s.local_ended_at := coalesce(s.local_ended_at, at_time);
  s.failure_code := coalesce(s.failure_code, code);
  return s;
end; $$;
-- Binding or identity failure: irreversible revocation and, if still open, local failure.
create function private.voice_revoke(s public.voice_sessions, code text, at_time timestamptz)
returns public.voice_sessions language plpgsql immutable set search_path = '' as $$
begin
  s.proposal_revoked_at := coalesce(s.proposal_revoked_at, at_time);
  if s.local_outcome = 'open' then s := private.voice_end_local(s, 'failed', code, at_time); end if;
  return s;
end; $$;
-- Time rules for an abandoned open controller. Applied before every event, so a late event
-- always sees the expired state and is refused by the ordinary precondition.
create function private.voice_expire(s public.voice_sessions, at_time timestamptz)
returns public.voice_sessions language plpgsql immutable set search_path = '' as $$
declare l private.voice_limit_values := private.voice_limits();
begin
  if s.local_outcome <> 'open' then return s; end if;
  if s.dispatch_id is null and at_time >= s.reservation_until then
    return private.voice_end_local(s, 'timed_out', 'RESERVATION_EXPIRED', at_time);
  elsif s.dispatch_id is not null and s.dispatch_started_at is null and at_time >= s.dispatch_until then
    return private.voice_end_local(s, 'timed_out', 'DISPATCH_EXPIRED', at_time);
  elsif s.dispatch_started_at is not null and s.connected_at is null and at_time >= s.dispatch_started_at + l.setup_window then
    return private.voice_end_local(s, 'timed_out', 'SETUP_EXPIRED', at_time);
  elsif s.finish_requested_at is not null and at_time >= private.voice_finish_until(s) then
    -- An accepted proposal survives the finish window; unfinished delivery does not.
    return private.voice_end_local(s, case when s.proposal_accepted_at is null then 'timed_out' else 'finished' end::public.voice_local_outcome,
      case when s.proposal_accepted_at is null then 'FINISH_EXPIRED' end, at_time);
  elsif s.connected_at is not null and at_time >= s.connected_at + l.call_cap + l.hold_margin then
    return private.voice_end_local(s, 'timed_out', 'CALL_CAP', at_time);
  end if;
  return s;
end; $$;
-- Safe closure. The only place ended_at is set.
create function private.voice_close(s public.voice_sessions, cfg private.voice_config_facts, at_time timestamptz)
returns public.voice_sessions language plpgsql immutable set search_path = '' as $$
begin
  if s.ended_at is not null or s.local_outcome = 'open' then return s; end if;
  if s.dispatch_started_at is null                                  -- no provider request was ever permitted
    or s.provider_state = 'not_issued'                              -- definite refusal, no credential exists
    or (s.hold_until is not null and at_time >= s.hold_until)       -- proven absolute hold deadline
    or (s.provider_state = 'terminal' and cfg.credential_rule = 'terminal_consumes'
        and cfg.fingerprint = s.config_fingerprint)                 -- reviewed replay contract proves consumption
  then
    s.ended_at := at_time;
  end if;
  return s;
end; $$;

-- ---------------------------------------------------------------- boundary helpers
-- Strict parse of the Worker's manifest facts. Null input means "no verified configuration".
create function private.voice_config(value jsonb) returns private.voice_config_facts
language plpgsql immutable set search_path = '' as $$
declare keys constant text[] := array['fingerprint','agentId','agentVersionId','credentialRule','captureRule',
  'dispatchToIssuanceSeconds','redemptionSeconds','limits'];
begin
  if value is null or value = 'null'::jsonb then return null; end if;
  if jsonb_typeof(value) <> 'object' or not value ?& keys
    or exists (select from jsonb_object_keys(value) k where k <> all(keys))
    or value->>'fingerprint' !~ '^[a-f0-9]{64}$'
    or value->>'agentId' !~ '^[A-Za-z0-9_-]{1,128}$' or value->>'agentVersionId' !~ '^[A-Za-z0-9_-]{1,128}$'
    or value->>'credentialRule' not in ('hold_only','terminal_consumes')
    or value->>'captureRule' not in ('mute_stops_capture','unproven')
    or jsonb_typeof(value->'limits') <> 'object'
    or (value->'dispatchToIssuanceSeconds' <> 'null'::jsonb and (value->>'dispatchToIssuanceSeconds')::integer not between 1 and 3600)
    or (value->'redemptionSeconds' <> 'null'::jsonb and (value->>'redemptionSeconds')::integer not between 1 and 3600)
    then perform private.fail('INVALID_INPUT'); end if;
  return row(value->>'fingerprint', value->>'agentId', value->>'agentVersionId', value->>'credentialRule', value->>'captureRule',
    (value->>'dispatchToIssuanceSeconds')::integer, (value->>'redemptionSeconds')::integer, value->'limits')::private.voice_config_facts;
end; $$;
-- True when the manifest's fixed operating limits equal this file's constants.
create function private.voice_limits_match(cfg private.voice_config_facts) returns boolean
language sql immutable set search_path = '' as $$
  select cfg.limits = jsonb_build_object('callCapSeconds', extract(epoch from (private.voice_limits()).call_cap)::integer,
    'finishSeconds', extract(epoch from (private.voice_limits()).finish_window)::integer,
    'coachDaily', (private.voice_limits()).coach_daily, 'sfdaDaily', (private.voice_limits()).sfda_daily);
$$;
create function private.voice_ms(value interval) returns bigint language sql immutable set search_path = '' as $$
  select greatest(0, floor(extract(epoch from value) * 1000))::bigint;
$$;
-- The one projection. Durations are relative to database time so no caller compares clocks.
create function private.voice_projection(s public.voice_sessions, refusal text, extra jsonb, at_time timestamptz)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'session', jsonb_build_object(
      'id', s.id, 'version', s.version, 'status', s.status, 'startRequestId', s.start_request_id,
      'localOutcome', s.local_outcome, 'providerState', s.provider_state, 'failureCode', s.failure_code,
      'binding', jsonb_build_object('callerId', s.coach_id, 'campaignId', s.campaign_id, 'playerId', s.player_id, 'kind', s.kind,
        'campaignVersion', s.campaign_version, 'callerAccessVersion', s.caller_version,
        'coachMembershipVersion', s.coach_membership_version, 'playerMembershipVersion', s.player_membership_version),
      'createdAt', s.created_at, 'connectedAt', s.connected_at, 'finishRequestedAt', s.finish_requested_at,
      'localEndedAt', s.local_ended_at, 'endedAt', s.ended_at, 'holdUntil', s.hold_until,
      'callCapSeconds', extract(epoch from (private.voice_limits()).call_cap)::integer,
      'warningSeconds', extract(epoch from (private.voice_limits()).warning_lead)::integer,
      'callRemainingMs', case when s.connected_at is not null and s.local_outcome = 'open'
        then private.voice_ms(s.connected_at + (private.voice_limits()).call_cap - at_time) end,
      'finishRemainingMs', case when s.finish_requested_at is not null and s.local_outcome = 'open'
        then private.voice_ms(private.voice_finish_until(s) - at_time) end,
      'proposalId', s.proposal_id, 'proposalEligible', private.voice_eligible(s), 'revoked', s.proposal_revoked_at is not null,
      -- Worker-only facts. The Worker strips these before any browser response.
      'worker', jsonb_build_object('dispatchId', s.dispatch_id, 'providerConversationId', s.provider_conversation_id,
        'configFingerprint', s.config_fingerprint,
        'observe', s.ended_at is null and s.provider_conversation_id is not null,
        'alert', case when s.ended_at is null and s.local_outcome <> 'open' and s.dispatch_started_at is not null
          and s.hold_until is null then 'HELD_UNBOUNDED' end)),
    'refusal', refusal) || coalesce(extra, '{}'::jsonb);
$$;
-- The refusal for an event on an ended or revoked row. Stored failure codes stay internal; only
-- the three the coach can act on cross the boundary. Every refusal literal in this file is in
-- src/domain/voice.ts voiceErrorCodes (asserted by the database suite).
create function private.voice_ended(s public.voice_sessions) returns text language sql immutable set search_path = '' as $$
  select case when s.failure_code in ('CONTEXT_CHANGED','CONVERSATION_MISMATCH','EXECUTION_IDENTITY_UNAVAILABLE')
    then s.failure_code else 'SESSION_ENDED' end;
$$;
-- A refusal with no row to project (reserve only: nothing was inserted).
create function private.voice_refusal(refusal text, extra jsonb) returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('session', null, 'refusal', refusal) || coalesce(extra, '{}'::jsonb);
$$;
create function private.voice_write(s public.voice_sessions) returns public.voice_sessions
language plpgsql set search_path = '' as $$
declare written public.voice_sessions;
begin
  -- The only UPDATE statement in the feature. Lists every mutable column once.
  update public.voice_sessions set
    config_fingerprint = s.config_fingerprint, agent_version_id = s.agent_version_id, authorisation_kind = s.authorisation_kind,
    authorisation_evidence_id = s.authorisation_evidence_id, authorisation_until = s.authorisation_until,
    dispatch_id = s.dispatch_id, dispatch_authorised_at = s.dispatch_authorised_at, dispatch_until = s.dispatch_until,
    dispatch_started_at = s.dispatch_started_at, hold_until = s.hold_until, credential_valid_until = s.credential_valid_until,
    local_outcome = s.local_outcome, provider_state = s.provider_state, local_ended_at = s.local_ended_at,
    proposal_revoked_at = s.proposal_revoked_at, provider_terminal_at = s.provider_terminal_at,
    provider_conversation_id = s.provider_conversation_id, proposal_id = s.proposal_id, proposal_accepted_at = s.proposal_accepted_at,
    identity_verified_at = s.identity_verified_at, connected_at = s.connected_at, finish_requested_at = s.finish_requested_at,
    ended_at = s.ended_at, duration_seconds = s.duration_seconds, failure_code = s.failure_code,
    version = version + 1, updated_at = current_timestamp
  where id = s.id returning * into written;
  return written;
end; $$;

-- ---------------------------------------------------------------- creation
create function private.voice_reserve(actor uuid, start_request uuid, campaign uuid, player uuid) returns jsonb
language plpgsql set search_path = '' as $$
declare l private.voice_limit_values := private.voice_limits(); s public.voice_sessions; person public.profiles;
  c public.campaigns; cc public.campaign_coaches; cp public.campaign_players; day_start timestamptz; outstanding uuid;
begin
  if actor is null then perform private.fail('AUTH_REQUIRED'); end if;
  if start_request is null or campaign is null or player is null then perform private.fail('INVALID_INPUT'); end if;
  -- Non-authoritative visibility check so a caller cannot lock campaigns it cannot see.
  if not coalesce(private.can_read_campaign(campaign), false) then perform private.fail('NOT_FOUND'); end if;
  -- Lock order 1-5.
  perform private.voice_lock(actor, campaign, player, true);
  -- Idempotent start: the same request ID returns the existing row and never proceeds to claim.
  select * into s from public.voice_sessions where coach_id = actor and start_request_id = start_request;
  if found then
    if (s.campaign_id, s.player_id) is distinct from (campaign, player) then perform private.fail('IDEMPOTENCY_CONFLICT'); end if;
    return private.voice_projection(s, null, jsonb_build_object('fresh', false), clock_timestamp());
  end if;
  -- Authoritative permission under locks.
  select * into person from public.profiles where id = actor;
  if not found or not person.access_enabled or person.role <> 'coach' then perform private.fail('FORBIDDEN'); end if;
  select * into c from public.campaigns where id = campaign;
  select * into cc from public.campaign_coaches where campaign_id = campaign and coach_id = actor;
  if not found or not cc.is_active then perform private.fail('FORBIDDEN'); end if;
  if c.stage <> 'preparation' then return private.voice_refusal('CONTEXT_CHANGED', null); end if;
  select * into cp from public.campaign_players where campaign_id = campaign and player_id = player;
  if not found or not cp.is_active or not exists (select from public.competition_pairings
      where competition_id = c.competition_id and coach_id = actor and player_id = player and campaign_id = campaign)
    then perform private.fail('NOT_FOUND'); end if;
  -- One outstanding session per coach, across tabs and devices. The partial unique index is the backstop.
  select id into outstanding from public.voice_sessions where coach_id = actor and ended_at is null;
  if found then return private.voice_refusal('VOICE_BUSY', jsonb_build_object('outstandingSessionId', outstanding)); end if;
  -- Quotas, serialized by the advisory lock, counted from reservations in the database's Singapore day.
  day_start := (private.singapore_today(current_timestamp)::timestamp) at time zone 'Asia/Singapore';
  if (select count(*) from public.voice_sessions where coach_id = actor and created_at >= day_start) >= l.coach_daily
    or (select count(*) from public.voice_sessions where created_at >= day_start) >= l.sfda_daily then
    return private.voice_refusal('QUOTA_EXCEEDED', jsonb_build_object('quotaResetAt', day_start + interval '1 day'));
  end if;
  insert into public.voice_sessions(start_request_id, coach_id, campaign_id, competition_id, player_id, kind, campaign_version,
      caller_version, coach_membership_version, player_membership_version, reservation_until)
    values (start_request, actor, campaign, c.competition_id, player, 'preparation', c.version, person.version, cc.version, cp.version,
      current_timestamp + l.reservation_window)
    returning * into s;
  return private.voice_projection(s, null, jsonb_build_object('fresh', true), clock_timestamp());
end; $$;

-- ---------------------------------------------------------------- the transition core
create function private.voice_transition(event private.voice_event, session_id uuid, actor uuid, payload jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare l private.voice_limit_values := private.voice_limits(); s public.voice_sessions; n public.voice_sessions;
  cfg private.voice_config_facts; at_time timestamptz; refusal text; extra jsonb := '{}';
  observation jsonb := payload->'observation'; authorisation jsonb := payload->'authorisation';
  expected integer := (payload->>'expected_version')::integer;
begin
  -- Identity columns are immutable (guard), so this unlocked read only chooses what to lock.
  select * into s from public.voice_sessions where id = session_id;
  if not found then perform private.fail('NOT_FOUND'); end if;
  -- Ownership. Scheduled reconcile is the only actorless event. An inaccessible row is NOT_FOUND.
  if event = 'validate' and actor is null then perform private.fail('AUTH_REQUIRED'); end if;
  if (event = 'reconcile') <> (actor is null) then perform private.fail('INVALID_INPUT'); end if;
  if actor is not null and actor <> s.coach_id then perform private.fail('NOT_FOUND'); end if;
  -- Lock order 1-5, then 6 for this one row. Reservation lock only for a local run claim (case budget).
  perform private.voice_lock(s.coach_id, s.campaign_id, s.player_id,
    event = 'claim' and authorisation->>'kind' = 'local_verification');
  select * into s from public.voice_sessions where id = session_id for update;
  if not found then perform private.fail('NOT_FOUND'); end if;
  at_time := clock_timestamp();
  -- Current enabled coach, rechecked under the profile lock. Nothing has been written yet.
  if actor is not null and not exists (select from public.profiles where id = actor and role = 'coach' and access_enabled)
    then perform private.fail('FORBIDDEN'); end if;
  cfg := private.voice_config(payload->'config');
  if event <> 'claim' and cfg is not null and s.config_fingerprint is distinct from cfg.fingerprint and s.config_fingerprint is not null
    then return private.voice_projection(s, 'CONFIG_CHANGED', null, at_time); end if;

  n := s;
  -- Universal pre-steps, in order, for every event.
  if not private.voice_binding_valid(n) then n := private.voice_revoke(n, 'CONTEXT_CHANGED', at_time); end if;
  n := private.voice_expire(n, at_time);

  case event
  when 'validate' then
    -- Caller JWT, before applying fields. No write beyond the pre-steps.
    if n.proposal_revoked_at is not null then refusal := 'CONTEXT_CHANGED';
    elsif not private.voice_eligible(n) then refusal := 'PROPOSAL_UNAVAILABLE'; end if;

  when 'claim' then
    -- Checks: unclaimed; open; not revoked; reservation unexpired (pre-step); binding valid (pre-step);
    -- verified configuration with both finite bounds and limits equal to voice_limits();
    -- authorisation kind/evidence/expiry in the future; for local_verification the run record lists a
    -- case equal to (coach, campaign, player, start_request_id) and the run has < local_run_cases rows.
    if n.dispatch_id is not null then refusal := 'VOICE_BUSY';               -- another claimant won
    elsif n.local_outcome <> 'open' then refusal := private.voice_ended(n);
    elsif cfg is null or cfg.dispatch_to_issuance_seconds is null or cfg.redemption_seconds is null
      or not private.voice_limits_match(cfg) then
      n := private.voice_end_local(n, 'failed', 'CONFIG_INVALID', at_time); refusal := 'VOICE_UNAVAILABLE';
    elsif authorisation is null or jsonb_typeof(authorisation) <> 'object'
      or authorisation->>'kind' not in ('production_activation','local_verification')
      or authorisation->>'evidenceId' !~ '^[A-Za-z0-9._:-]{1,200}$'
      or (authorisation->>'until')::timestamptz is null
      or (authorisation->>'until')::timestamptz <= at_time then
      n := private.voice_end_local(n, 'failed', 'CONFIG_INVALID', at_time); refusal := 'VOICE_UNAVAILABLE';
    elsif authorisation->>'kind' = 'local_verification' and (
      jsonb_typeof(authorisation->'localRun') <> 'object'
      or jsonb_typeof(authorisation->'localRun'->'cases') <> 'array'
      or not exists (
        select from jsonb_array_elements(authorisation->'localRun'->'cases') c
        where c->>'actorId' = n.coach_id::text and c->>'campaignId' = n.campaign_id::text
          and c->>'playerId' = n.player_id::text and c->>'startRequestId' = n.start_request_id::text)
      or (select count(*) from public.voice_sessions
          where authorisation_evidence_id = authorisation->>'evidenceId') >= l.local_run_cases) then
      n := private.voice_end_local(n, 'failed', 'CONFIG_INVALID', at_time); refusal := 'VOICE_UNAVAILABLE';
    else
      n.config_fingerprint := cfg.fingerprint; n.agent_version_id := cfg.agent_version_id;
      n.authorisation_kind := (authorisation->>'kind')::public.voice_authorisation_kind;
      n.authorisation_evidence_id := authorisation->>'evidenceId';
      n.authorisation_until := (authorisation->>'until')::timestamptz;
      n.dispatch_id := gen_random_uuid(); n.dispatch_authorised_at := at_time;
      n.dispatch_until := least(at_time + l.dispatch_window, n.authorisation_until);
      n.hold_until := n.dispatch_until + make_interval(secs => cfg.dispatch_to_issuance_seconds + cfg.redemption_seconds)
        + l.call_cap + l.hold_margin;
      extra := jsonb_build_object('dispatchId', n.dispatch_id);
    end if;

  when 'arm' then
    -- Checks: same dispatch; never armed before (a started dispatch is never repeated, even after a
    -- crash before Fetch); open; not revoked; binding valid; before dispatch_until and authorisation_until.
    if n.dispatch_id is distinct from (payload->>'dispatch_id')::uuid then refusal := 'VOICE_BUSY';
    elsif n.dispatch_started_at is not null then refusal := 'START_UNKNOWN';
    elsif n.local_outcome <> 'open' or n.proposal_revoked_at is not null then refusal := private.voice_ended(n);
    elsif at_time >= n.dispatch_until or at_time >= n.authorisation_until then refusal := 'DISPATCH_EXPIRED';
    else
      n.dispatch_started_at := at_time; n.provider_state := 'unknown';
      extra := jsonb_build_object('dispatchRemainingMs', private.voice_ms(n.dispatch_until - at_time));
    end if;

  when 'issuance' then
    -- Observation: {outcome: issued|not_issued|unknown, conversationId?, credentialValidUntil?, unexpected}.
    -- not_issued = definite proof of no provider side effect (recognised 4xx, or Fetch never called).
    -- Recorded only for its own dispatch. Never reopens delivery or extends a deadline.
    if n.dispatch_id is distinct from (payload->>'dispatch_id')::uuid or n.dispatch_started_at is null then
      perform private.fail('INVALID_INPUT');
    end if;
    if (observation->>'unexpected')::boolean then n.hold_until := null; end if;   -- outside contract: reconcile only
    case observation->>'outcome'
    when 'issued' then
      if n.provider_conversation_id is not null and n.provider_conversation_id <> observation->>'conversationId' then
        n.hold_until := null; n := private.voice_revoke(n, 'CONVERSATION_MISMATCH', at_time); refusal := 'CONVERSATION_MISMATCH';
      else
        n.provider_conversation_id := observation->>'conversationId';
        n.credential_valid_until := (observation->>'credentialValidUntil')::timestamptz;  -- recorded, never tightens hold_until
      end if;
      -- The database, not the Worker, decides whether the token may leave the Worker.
      extra := jsonb_build_object('deliverToken', refusal is null and n.local_outcome = 'open' and n.proposal_revoked_at is null);
    when 'not_issued' then
      if n.provider_conversation_id is null then n.provider_state := 'not_issued'; end if;
      n := private.voice_end_local(n, 'failed', 'ISSUANCE_REFUSED', at_time); refusal := 'VOICE_UNAVAILABLE';
    else
      n := private.voice_end_local(n, 'failed', 'START_UNKNOWN', at_time); refusal := 'START_UNKNOWN';
    end case;

  when 'connect' then
    -- Mandatory execution identity. Observation {kind: observed|unavailable, conversationId, agentId, versionId, status}.
    if n.connected_at is not null then
      if payload->>'sdk_conversation_id' is distinct from n.provider_conversation_id then refusal := 'CONVERSATION_MISMATCH'; end if;
    elsif expected is distinct from s.version then refusal := 'VERSION_CONFLICT';
    elsif n.local_outcome <> 'open' or n.proposal_revoked_at is not null then refusal := private.voice_ended(n);
    elsif cfg is null then refusal := 'VOICE_UNAVAILABLE';
    elsif n.provider_conversation_id is null or payload->>'sdk_conversation_id' is distinct from n.provider_conversation_id then
      n := private.voice_revoke(n, 'CONVERSATION_MISMATCH', at_time); refusal := 'CONVERSATION_MISMATCH';
    elsif observation->>'kind' is distinct from 'observed'
      or observation->>'conversationId' is distinct from n.provider_conversation_id
      or observation->>'agentId' is distinct from cfg.agent_id
      or observation->>'versionId' is distinct from n.agent_version_id
      or observation->>'status' not in ('initiated','in-progress') then
      -- No inference from the requested version or the browser supplied ID.
      n := private.voice_revoke(n, 'EXECUTION_IDENTITY_UNAVAILABLE', at_time); refusal := 'EXECUTION_IDENTITY_UNAVAILABLE';
    else
      n.identity_verified_at := at_time; n.connected_at := at_time; n.provider_state := 'live';
    end if;

  when 'finish' then
    -- Repetition returns the first deadline and never extends it.
    if n.finish_requested_at is null then
      if expected is distinct from s.version then refusal := 'VERSION_CONFLICT';
      elsif n.local_outcome <> 'open' or n.proposal_revoked_at is not null then refusal := private.voice_ended(n);
      elsif n.connected_at is null then refusal := 'SESSION_ENDED';
      elsif cfg is null or cfg.capture_rule <> 'mute_stops_capture' then refusal := 'VOICE_UNAVAILABLE';  -- browser must end instead
      else n.finish_requested_at := at_time; end if;
    end if;

  when 'accept' then
    -- One proposal UUID, identity checked, open, not revoked, binding valid, inside the first finish window.
    if n.proposal_id is not null then
      if n.proposal_id is distinct from (payload->>'proposal_id')::uuid then refusal := 'PROPOSAL_UNAVAILABLE';
      elsif not private.voice_eligible(n) then refusal := 'CONTEXT_CHANGED'; end if;   -- revalidation, no extension
    elsif n.proposal_revoked_at is not null then refusal := 'CONTEXT_CHANGED';
    elsif n.finish_requested_at is null or n.local_outcome <> 'open' or at_time >= private.voice_finish_until(n) then refusal := 'FINISH_EXPIRED';
    elsif n.identity_verified_at is null then refusal := 'PROPOSAL_UNAVAILABLE';
    else n.proposal_id := (payload->>'proposal_id')::uuid; n.proposal_accepted_at := at_time; end if;

  when 'end' then
    -- Idempotent for the same terminal intent. Cancellation supersedes and revokes, even after closure.
    case payload->>'reason'
    when 'cancelled' then n := private.voice_end_local(n, 'cancelled', null, at_time);
    when 'backgrounded' then n := private.voice_end_local(n, 'cancelled', 'BACKGROUNDED', at_time);
    when 'finished' then n := private.voice_end_local(n, 'finished', null, at_time);
    when 'timed_out' then n := private.voice_end_local(n, 'timed_out', 'CALL_CAP', at_time);
    when 'failed' then n := private.voice_end_local(n, 'failed', 'TRANSPORT_FAILED', at_time);
    else perform private.fail('INVALID_INPUT');
    end case;

  when 'observe', 'reconcile' then
    -- Remote state only. Never clears revocation or restores a proposal.
    -- Observation {kind: observed|missing|unavailable, conversationId, agentId, versionId, status, durationSeconds}.
    -- missing (404 under retention) and unavailable prove nothing: state unchanged.
    if observation->>'kind' = 'observed' and n.provider_conversation_id is not null
      and observation->>'conversationId' = n.provider_conversation_id then
      if observation->>'status' in ('done','failed') then
        n.provider_state := 'terminal'; n.provider_terminal_at := coalesce(n.provider_terminal_at, at_time);
        n.duration_seconds := least((observation->>'durationSeconds')::integer, 600);
      elsif observation->>'status' in ('initiated','in-progress','processing') and n.provider_state <> 'terminal' then
        n.provider_state := 'live';
      end if;
      -- Any observed identity other than the pinned agent version revokes, whenever it is seen.
      if observation->>'versionId' is distinct from n.agent_version_id
        or (cfg is not null and observation->>'agentId' is distinct from cfg.agent_id) then
        n := private.voice_revoke(n, 'EXECUTION_IDENTITY_UNAVAILABLE', at_time);
      end if;
    end if;
  end case;

  n := private.voice_close(n, cfg, at_time);
  if to_jsonb(n) is distinct from to_jsonb(s) then n := private.voice_write(n); end if;
  return private.voice_projection(n, refusal, extra, at_time);
exception
  when sqlstate 'PT401' or sqlstate 'PT403' or sqlstate 'PT404' or sqlstate 'PT409' or sqlstate 'PT422' then raise;
  when deadlock_detected or serialization_failure then raise;
  when invalid_text_representation or check_violation or not_null_violation or numeric_value_out_of_range or invalid_parameter_value
    then perform private.fail('INVALID_INPUT'); return null;
  when others then perform private.fail('DATABASE_ERROR'); return null;
end; $$;

-- ---------------------------------------------------------------- public doors (narrow, typed)
-- Caller JWT.
create function public.reserve_voice_session(start_request_id uuid, campaign_id uuid, player_id uuid) returns jsonb
language sql security definer set search_path = '' as $$ select private.voice_reserve(auth.uid(), start_request_id, campaign_id, player_id); $$;
create function public.validate_voice_binding(session_id uuid) returns jsonb
language sql security definer set search_path = '' as $$ select private.voice_transition('validate', session_id, auth.uid(), '{}'); $$;

-- Worker only. actor_id is the Worker verified bearer identity; ownership is checked in the core.
create function public.read_voice_session(session_id uuid, actor_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.voice_sessions;
begin
  select * into s from public.voice_sessions where id = session_id and coach_id = actor_id;
  if not found then perform private.fail('NOT_FOUND'); end if;
  return private.voice_projection(s, null, null, clock_timestamp());
end; $$;
create function public.claim_voice_session(session_id uuid, actor_id uuid, config jsonb, authorisation jsonb) returns jsonb
language sql security definer set search_path = '' as $$
  select private.voice_transition('claim', session_id, actor_id, jsonb_build_object('config', config, 'authorisation', authorisation)); $$;
create function public.arm_voice_dispatch(session_id uuid, actor_id uuid, dispatch_id uuid, config jsonb) returns jsonb
language sql security definer set search_path = '' as $$
  select private.voice_transition('arm', session_id, actor_id, jsonb_build_object('dispatch_id', dispatch_id, 'config', config)); $$;
create function public.record_voice_issuance(session_id uuid, actor_id uuid, dispatch_id uuid, observation jsonb) returns jsonb
language sql security definer set search_path = '' as $$
  select private.voice_transition('issuance', session_id, actor_id, jsonb_build_object('dispatch_id', dispatch_id, 'observation', observation)); $$;
create function public.record_voice_connection(session_id uuid, actor_id uuid, expected_version integer, sdk_conversation_id text,
  observation jsonb, config jsonb) returns jsonb
language sql security definer set search_path = '' as $$
  select private.voice_transition('connect', session_id, actor_id, jsonb_build_object('expected_version', expected_version,
    'sdk_conversation_id', sdk_conversation_id, 'observation', observation, 'config', config)); $$;
create function public.begin_voice_finish(session_id uuid, actor_id uuid, expected_version integer, config jsonb) returns jsonb
language sql security definer set search_path = '' as $$
  select private.voice_transition('finish', session_id, actor_id, jsonb_build_object('expected_version', expected_version, 'config', config)); $$;
create function public.accept_voice_proposal(session_id uuid, actor_id uuid, proposal_id uuid) returns jsonb
language sql security definer set search_path = '' as $$
  select private.voice_transition('accept', session_id, actor_id, jsonb_build_object('proposal_id', proposal_id)); $$;
create function public.end_voice_session(session_id uuid, actor_id uuid, reason text) returns jsonb
language sql security definer set search_path = '' as $$
  select private.voice_transition('end', session_id, actor_id, jsonb_build_object('reason', reason)); $$;
create function public.observe_voice_provider(session_id uuid, actor_id uuid, observation jsonb, config jsonb) returns jsonb
language sql security definer set search_path = '' as $$
  select private.voice_transition('observe', session_id, actor_id, jsonb_build_object('observation', observation, 'config', config)); $$;

-- Scheduled only. No browser credential reaches these.
create function public.list_voice_reconciliation(after_created_at timestamptz, after_id uuid, page_size integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare rec record; items jsonb := '[]'::jsonb; next_cursor jsonb; seen integer := 0;
  last_created timestamptz; last_id uuid;
begin
  if page_size is null or page_size not between 1 and 100 or ((after_created_at is null) <> (after_id is null)) then perform private.fail('INVALID_INPUT'); end if;
  for rec in
    select id, created_at, provider_conversation_id
    from public.voice_sessions
    where ended_at is null
      and (after_created_at is null or (created_at, id) > (after_created_at, after_id))
    order by created_at, id
    limit page_size + 1
  loop
    seen := seen + 1;
    if seen <= page_size then
      items := items || jsonb_build_array(jsonb_build_object(
        'id', rec.id,
        'providerConversationId', rec.provider_conversation_id,
        'observe', rec.provider_conversation_id is not null));
      last_created := rec.created_at;
      last_id := rec.id;
    end if;
  end loop;
  if seen > page_size then
    next_cursor := jsonb_build_object('createdAt', last_created, 'id', last_id);
  else
    next_cursor := null;
  end if;
  return jsonb_build_object('items', items, 'nextCursor', next_cursor);
end; $$;
create function public.reconcile_voice_session(session_id uuid, observation jsonb, config jsonb) returns jsonb
language sql security definer set search_path = '' as $$
  select private.voice_transition('reconcile', session_id, null, jsonb_build_object('observation', observation, 'config', config)); $$;
create function public.delete_ended_voice_sessions(batch_size integer) returns integer
language plpgsql security definer set search_path = '' as $$
declare deleted integer;
begin
  if batch_size is null or batch_size not between 1 and 1000 then perform private.fail('INVALID_INPUT'); end if;
  -- SKIP LOCKED: a filing transaction holding a session lock is never waited on, so no lock order applies.
  with doomed as (
    select id from public.voice_sessions where ended_at <= current_timestamp - (private.voice_limits()).retention
    order by ended_at, id limit batch_size for update skip locked)
  delete from public.voice_sessions v using doomed where v.id = doomed.id;
  get diagnostics deleted = row_count;
  return deleted;
end; $$;

-- ---------------------------------------------------------------- atomic filing
-- Normalised for the receipt fingerprint: sorted distinct, at most 100, absent when empty, so a
-- manual write keeps its pre-0008 fingerprint and a replay with different bindings conflicts.
create function private.voice_ids(ids uuid[]) returns jsonb language plpgsql immutable set search_path = '' as $$
begin
  if ids is null or cardinality(ids) = 0 then return null; end if;
  if array_position(ids, null) is not null or cardinality(ids) > (private.voice_limits()).filing_ids then perform private.fail('INVALID_INPUT'); end if;
  return (select jsonb_agg(id order by id) from (select distinct unnest(ids) as id) d);
end; $$;
create function private.voice_input(ids uuid[]) returns jsonb language sql immutable set search_path = '' as $$
  select case when private.voice_ids(ids) is null then '{}'::jsonb else jsonb_build_object('voice_session_ids', private.voice_ids(ids)) end;
$$;
-- Called by write_feedback after mutate has locked profile -> competition -> campaign and checked
-- feedback_permission, and before the draft row lock. Raises; the whole write rolls back.
create function private.voice_check_filing(p jsonb, campaign public.campaigns) returns void
language plpgsql set search_path = '' as $$
declare ids uuid[]; s public.voice_sessions; seen integer := 0; player uuid := (p->>'player_id')::uuid;
begin
  if p->'voice_session_ids' is null then return; end if;
  ids := array(select jsonb_array_elements_text(p->'voice_session_ids')::uuid);
  if p->>'kind' <> 'preparation' then perform private.fail('VOICE_CONTEXT_CHANGED'); end if;
  perform private.voice_lock_members(campaign.id, auth.uid(), player);                   -- order 5
  for s in select * from public.voice_sessions where id = any(ids) order by id for update loop  -- order 6
    seen := seen + 1;
    if s.coach_id <> auth.uid() or s.campaign_id <> campaign.id or s.player_id <> player or not private.voice_fileable(s)
      then perform private.fail('VOICE_CONTEXT_CHANGED'); end if;
  end loop;
  if seen <> cardinality(ids) then perform private.fail('VOICE_CONTEXT_CHANGED'); end if;      -- deleted metadata
end; $$;

-- Latest write_feedback (20261009000200) with one inserted line, marked below.
create or replace function private.write_feedback(action text, p jsonb, campaign public.campaigns) returns jsonb
language plpgsql set search_path = '' as $$
declare entry public.feedback_entries; draft public.feedback_entries; obligation uuid; content jsonb := p->'content';
  player uuid := (p->>'player_id')::uuid; entry_kind public.feedback_kind := (p->>'kind')::public.feedback_kind;
begin
  if action = 'discard_feedback_draft' then
    select * into draft from public.feedback_entries where id = (p->>'draft_id')::uuid and coach_id = auth.uid() and status = 'draft' for update;
    if not found then perform private.fail('NOT_FOUND'); end if;
    perform private.feedback_permission(draft.campaign_id,draft.player_id,draft.kind);
    perform private.check_version(draft.version,(p->>'expected_version')::integer);
    delete from public.feedback_entries where feedback_entries.id = draft.id;
    return private.effect('feedback_entry',draft.id,draft.version,jsonb_build_object('coach_id',auth.uid(),'player_id',draft.player_id,'version',draft.version));
  end if;
  obligation := private.feedback_permission(campaign.id,player,entry_kind);
  perform private.voice_check_filing(p, campaign);  -- 0008: sessions after memberships, before the draft lock
  if p->'review_confirmed' is distinct from 'true'::jsonb then perform private.fail('INVALID_INPUT'); end if;
  perform private.check_content(content,action = 'submit_feedback');
  select * into draft from public.feedback_entries where campaign_id = campaign.id and coach_id = auth.uid() and player_id = player and feedback_entries.kind = entry_kind and status = 'draft' for update;
  if p->>'draft_id' is not null then
    if draft.id is distinct from (p->>'draft_id')::uuid then perform private.fail('NOT_FOUND'); end if;
    perform private.check_version(draft.version,(p->>'expected_version')::integer);
    update public.feedback_entries set observations = content->>'observations', strengths = content->>'strengths',
      development_focus = content->>'development_focus', observed_on = private.checked_date(content->>'observed_on'),
      reviewed_at = current_timestamp, updated_at = current_timestamp, version = version + 1,
      status = case when action = 'submit_feedback' then 'submitted'::public.feedback_status else 'draft'::public.feedback_status end,
      submitted_at = case when action = 'submit_feedback' then current_timestamp else null end
      where feedback_entries.id = draft.id returning * into entry;
  else
    if p->>'expected_version' is not null then perform private.fail('INVALID_INPUT'); end if;
    if draft.id is not null then perform private.fail('DRAFT_EXISTS'); end if;
    insert into public.feedback_entries(campaign_id,competition_id,coach_id,player_id,kind,status,observations,strengths,development_focus,observed_on,submitted_at,final_obligation_id)
      values (campaign.id,campaign.competition_id,auth.uid(),player,entry_kind,
        case when action = 'submit_feedback' then 'submitted'::public.feedback_status else 'draft'::public.feedback_status end,
        content->>'observations',content->>'strengths',content->>'development_focus',private.checked_date(content->>'observed_on'),
        case when action = 'submit_feedback' then current_timestamp else null end,obligation) returning * into entry;
  end if;
  return private.effect('feedback_entry',entry.id,entry.version,jsonb_build_object('coach_id',auth.uid(),'player_id',player,'version',entry.version));
end; $$;

drop function public.save_feedback_draft(uuid,uuid,uuid,public.feedback_kind,jsonb,boolean,uuid,integer);
drop function public.submit_feedback(uuid,uuid,uuid,public.feedback_kind,jsonb,boolean,uuid,integer);
create function public.save_feedback_draft(mutation_id uuid, campaign_id uuid, player_id uuid, kind public.feedback_kind, content jsonb,
  review_confirmed boolean, draft_id uuid, expected_version integer, voice_session_ids uuid[] default null) returns jsonb
language sql security definer set search_path = '' as $$
  select private.mutate('save_feedback_draft',mutation_id,jsonb_build_object('campaign_id',campaign_id,'player_id',player_id,'kind',kind,
    'content',content,'review_confirmed',review_confirmed,'draft_id',draft_id,'expected_version',expected_version)
    || private.voice_input(voice_session_ids));
$$;
create function public.submit_feedback(mutation_id uuid, campaign_id uuid, player_id uuid, kind public.feedback_kind, content jsonb,
  review_confirmed boolean, draft_id uuid, expected_version integer, voice_session_ids uuid[] default null) returns jsonb
language sql security definer set search_path = '' as $$
  select private.mutate('submit_feedback',mutation_id,jsonb_build_object('campaign_id',campaign_id,'player_id',player_id,'kind',kind,
    'content',content,'review_confirmed',review_confirmed,'draft_id',draft_id,'expected_version',expected_version)
    || private.voice_input(voice_session_ids));
$$;

-- ---------------------------------------------------------------- grants
-- Only this file's private functions. A schema-wide revoke would strip later grants
-- (safe_metadata, coach workspace helpers) that earlier migrations re-established.
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and (p.proname like 'voice\_%' or p.proname = 'guard_voice_session')
  loop execute format('revoke all on function %s from public, anon, authenticated, service_role', f); end loop;
end $$;
revoke all on function public.reserve_voice_session(uuid,uuid,uuid), public.validate_voice_binding(uuid),
  public.save_feedback_draft(uuid,uuid,uuid,public.feedback_kind,jsonb,boolean,uuid,integer,uuid[]),
  public.submit_feedback(uuid,uuid,uuid,public.feedback_kind,jsonb,boolean,uuid,integer,uuid[]),
  public.read_voice_session(uuid,uuid), public.claim_voice_session(uuid,uuid,jsonb,jsonb), public.arm_voice_dispatch(uuid,uuid,uuid,jsonb),
  public.record_voice_issuance(uuid,uuid,uuid,jsonb), public.record_voice_connection(uuid,uuid,integer,text,jsonb,jsonb),
  public.begin_voice_finish(uuid,uuid,integer,jsonb), public.accept_voice_proposal(uuid,uuid,uuid), public.end_voice_session(uuid,uuid,text),
  public.observe_voice_provider(uuid,uuid,jsonb,jsonb), public.list_voice_reconciliation(timestamptz,uuid,integer),
  public.reconcile_voice_session(uuid,jsonb,jsonb), public.delete_ended_voice_sessions(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.reserve_voice_session(uuid,uuid,uuid), public.validate_voice_binding(uuid),
  public.save_feedback_draft(uuid,uuid,uuid,public.feedback_kind,jsonb,boolean,uuid,integer,uuid[]),
  public.submit_feedback(uuid,uuid,uuid,public.feedback_kind,jsonb,boolean,uuid,integer,uuid[]) to authenticated;
grant execute on function public.read_voice_session(uuid,uuid), public.claim_voice_session(uuid,uuid,jsonb,jsonb),
  public.arm_voice_dispatch(uuid,uuid,uuid,jsonb), public.record_voice_issuance(uuid,uuid,uuid,jsonb),
  public.record_voice_connection(uuid,uuid,integer,text,jsonb,jsonb), public.begin_voice_finish(uuid,uuid,integer,jsonb),
  public.accept_voice_proposal(uuid,uuid,uuid), public.end_voice_session(uuid,uuid,text), public.observe_voice_provider(uuid,uuid,jsonb,jsonb),
  public.list_voice_reconciliation(timestamptz,uuid,integer), public.reconcile_voice_session(uuid,jsonb,jsonb),
  public.delete_ended_voice_sessions(integer) to service_role;
