-- Spec 0008. Freeze capture proof and expose the absolute dispatch deadline only to Workers.
alter table public.voice_sessions add column capture_rule text check (capture_rule = 'mute_stops_capture');

create or replace function private.guard_voice_session() returns trigger language plpgsql security definer set search_path = '' as $$
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
  if not (private.voice_set_once(old.capture_rule,new.capture_rule) and private.voice_set_once(old.credential_rule,new.credential_rule) and private.voice_set_once(old.claimed_agent_id,new.claimed_agent_id)
    and private.voice_set_once(old.config_fingerprint,new.config_fingerprint) and private.voice_set_once(old.agent_version_id,new.agent_version_id)
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

create or replace function private.voice_write(s public.voice_sessions) returns public.voice_sessions
language plpgsql set search_path = '' as $$
declare written public.voice_sessions;
begin
  -- The only UPDATE statement in the feature. Lists every mutable column once.
  update public.voice_sessions set
    capture_rule = s.capture_rule, credential_rule = s.credential_rule, claimed_agent_id = s.claimed_agent_id,
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

create or replace function private.voice_transition(event private.voice_event, session_id uuid, actor uuid, payload jsonb) returns jsonb
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
  if actor is not null and event <> 'end' and not exists (select from public.profiles where id = actor and role = 'coach' and access_enabled)
    then perform private.fail('FORBIDDEN'); end if;
  cfg := private.voice_config(payload->'config');

  n := s;
  -- Universal pre-steps, in order, for every event.
  if not private.voice_binding_valid(n) then n := private.voice_revoke(n, 'CONTEXT_CHANGED', at_time); end if;
  n := private.voice_expire(n, at_time);

  -- Refusals commit universal revocation and expiry. Cleanup remains possible after drift.
  if event in ('arm','connect','finish') and cfg is not null
    and n.config_fingerprint is distinct from cfg.fingerprint then refusal := 'CONFIG_CHANGED'; end if;

  if refusal is null then
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
      or cfg.capture_rule <> 'mute_stops_capture' or not private.voice_limits_match(cfg) then
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
      n.capture_rule := cfg.capture_rule; n.credential_rule := cfg.credential_rule; n.claimed_agent_id := cfg.agent_id;
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
    if cfg is null then refusal := 'VOICE_UNAVAILABLE';
    elsif n.dispatch_id is distinct from (payload->>'dispatch_id')::uuid then refusal := 'VOICE_BUSY';
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
    if (observation->>'unexpected')::boolean then n.hold_until := null; n := private.voice_revoke(n, 'START_UNKNOWN', at_time); end if;   -- outside contract: reconcile only
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
      if payload->>'sdk_conversation_id' is distinct from n.provider_conversation_id then n := private.voice_revoke(n, 'CONVERSATION_MISMATCH', at_time); refusal := 'CONVERSATION_MISMATCH'; end if;
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
        -- Verified duration is recorded only after safe closure below.
      elsif observation->>'status' in ('initiated','in-progress','processing') and n.provider_state <> 'terminal' then
        n.provider_state := 'live';
      end if;
      -- Any observed identity other than the pinned agent version revokes, whenever it is seen.
      if observation->>'versionId' is distinct from n.agent_version_id
        or observation->>'agentId' is distinct from n.claimed_agent_id then
        n := private.voice_revoke(n, 'EXECUTION_IDENTITY_UNAVAILABLE', at_time);
      end if;
    end if;
  end case;
  end if;

  n := private.voice_close(n, cfg, at_time);
  if s.ended_at is null and n.ended_at is not null and observation->>'kind' = 'observed'
    and observation->>'conversationId' = n.provider_conversation_id
    and observation->>'status' in ('done','failed')
    and (observation->>'durationSeconds')::integer between 0 and 600 then
    n.duration_seconds := (observation->>'durationSeconds')::integer;
  end if;
  if to_jsonb(n) is distinct from to_jsonb(s) then n := private.voice_write(n); end if;
  return private.voice_projection(n, refusal, extra, at_time);
exception
  when sqlstate 'PT401' or sqlstate 'PT403' or sqlstate 'PT404' or sqlstate 'PT409' or sqlstate 'PT422' then raise;
  when deadlock_detected or serialization_failure then raise;
  when invalid_text_representation or check_violation or not_null_violation or numeric_value_out_of_range or invalid_parameter_value
    then perform private.fail('INVALID_INPUT'); return null;
  when others then perform private.fail('DATABASE_ERROR'); return null;
end; $$;

create or replace function private.voice_projection(s public.voice_sessions, refusal text, extra jsonb, at_time timestamptz)
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
      'finishMode', case when s.capture_rule = 'mute_stops_capture' then 'mute_and_request' else 'end_immediately' end,
      'proposalId', s.proposal_id, 'proposalEligible', private.voice_eligible(s), 'revoked', s.proposal_revoked_at is not null,
      -- Worker-only facts. The Worker strips these before any browser response.
      'worker', jsonb_build_object('dispatchId', s.dispatch_id, 'dispatchUntil', s.dispatch_until, 'providerConversationId', s.provider_conversation_id,
        'configFingerprint', s.config_fingerprint,
        'observe', s.ended_at is null and s.provider_conversation_id is not null,
        'alert', case when s.ended_at is null and s.local_outcome <> 'open' and s.dispatch_started_at is not null
          and s.hold_until is null then 'HELD_UNBOUNDED' end)),
    'refusal', refusal) || coalesce(extra, '{}'::jsonb);
$$;
