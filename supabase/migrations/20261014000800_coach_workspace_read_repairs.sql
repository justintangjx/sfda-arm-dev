-- Repair installed workspace reads without bypassing table policies or column grants.

create or replace function public.list_coach_campaigns(mode text, query text default null, stage public.campaign_stage default null, cursor text default null, page_size integer default 20)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare coach uuid := private.require_enabled_coach(); search text := private.coach_search_query(query);
  fingerprint text; parsed jsonb; cursor_created timestamptz; cursor_id uuid; rows jsonb;
begin
  if mode is null or mode not in ('current','history') then perform private.fail('INVALID_INPUT'); end if;
  if page_size is null or page_size not between 1 and 100 then perform private.fail('INVALID_INPUT'); end if;
  fingerprint := private.coach_query_fingerprint(jsonb_build_object('list','campaigns','mode',mode,'query',search,'stage',list_coach_campaigns.stage));
  parsed := private.coach_cursor_decode(cursor, fingerprint, array['createdAt','id']);
  if parsed is not null then
    cursor_created := (parsed->>'createdAt')::timestamptz;
    cursor_id := (parsed->>'id')::uuid;
  end if;
  select coalesce(jsonb_agg(item order by created_at,id),'[]') into rows from (
    select c.created_at,c.id,jsonb_build_object(
      'campaignId',c.id,'id',c.id,'createdAt',c.created_at,'name',c.name,'teamName',c.team_name,'competitionId',comp.id,'competitionName',comp.name,
      'stage',c.stage,'version',c.version,'membershipActive',cc.is_active,'membershipVersion',cc.version,
      'accessLabel',case when cc.is_active and c.stage <> 'closed' then 'Current assignment' else 'Historical access' end
    ) as item
    from public.campaign_coaches cc
    join public.campaigns c on c.id = cc.campaign_id
    join public.competitions comp on comp.id = c.competition_id
    where cc.coach_id = coach
      and ((mode = 'current' and cc.is_active and c.stage <> 'closed')
        or (mode = 'history' and (not cc.is_active or c.stage = 'closed')))
      and (list_coach_campaigns.stage is null or c.stage = list_coach_campaigns.stage)
      and (search is null or strpos(lower(c.name), lower(search)) > 0 or strpos(lower(c.team_name), lower(search)) > 0 or strpos(lower(comp.name), lower(search)) > 0)
      and (parsed is null or (c.created_at,c.id) > (cursor_created,cursor_id))
    order by c.created_at,c.id limit page_size + 1
  ) page;
  return private.coach_list_envelope(rows, page_size, fingerprint, array['createdAt','id']);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then perform private.fail('INVALID_INPUT'); return null;
end; $$;

create or replace function private.coach_campaign_context(campaign_id uuid, coach_id uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare campaign public.campaigns; competition public.competitions; membership public.campaign_coaches;
  frozen_count bigint;
begin
  if coach_campaign_context.coach_id is distinct from private.require_enabled_coach() then perform private.fail('FORBIDDEN'); end if;
  if not coalesce(private.can_read_campaign(coach_campaign_context.campaign_id),false) then perform private.fail('NOT_FOUND'); end if;
  select * into campaign from public.campaigns where id = coach_campaign_context.campaign_id;
  if not found then perform private.fail('NOT_FOUND'); end if;
  select * into competition from public.competitions where id = campaign.competition_id;
  select * into membership from public.campaign_coaches cc where cc.campaign_id = coach_campaign_context.campaign_id and cc.coach_id = coach_campaign_context.coach_id;
  if not found then perform private.fail('NOT_FOUND'); end if;
  if campaign.requirements_frozen_at is null then frozen_count := null;
  else select count(*) into frozen_count from public.final_obligations fo where fo.campaign_id = coach_campaign_context.campaign_id and fo.coach_id = coach_campaign_context.coach_id;
  end if;
  return jsonb_build_object(
    'campaignId',campaign.id,'name',campaign.name,'teamName',campaign.team_name,'competitionId',competition.id,'competitionName',competition.name,
    'stage',campaign.stage,'version',campaign.version,'membershipActive',membership.is_active,'membershipVersion',membership.version,
    'requirements',jsonb_build_object('scope','self','frozen',campaign.requirements_frozen_at is not null,'frozenRequiredCount',frozen_count),
    'writeKinds',jsonb_build_array('preparation'),'correctionSupport','unavailable');
end; $$;

create or replace function public.list_coach_roster(campaign_id uuid, query text default null, membership text default 'active', drafts text default 'all', cursor text default null, page_size integer default 20)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare coach uuid := private.require_enabled_coach(); search text := private.coach_search_query(query);
  fingerprint text; parsed jsonb; cursor_created timestamptz; cursor_id uuid; rows jsonb;
begin
  if not coalesce(private.can_read_campaign(list_coach_roster.campaign_id),false) then perform private.fail('NOT_FOUND'); end if;
  if membership is null or membership not in ('all','active','withdrawn') or drafts is null or drafts not in ('all','saved') then perform private.fail('INVALID_INPUT'); end if;
  if page_size is null or page_size not between 1 and 100 then perform private.fail('INVALID_INPUT'); end if;
  fingerprint := private.coach_query_fingerprint(jsonb_build_object('list','roster','campaignId',list_coach_roster.campaign_id,'query',search,'membership',membership,'drafts',drafts));
  parsed := private.coach_cursor_decode(cursor, fingerprint, array['createdAt','playerId']);
  if parsed is not null then
    cursor_created := (parsed->>'createdAt')::timestamptz;
    cursor_id := (parsed->>'playerId')::uuid;
  end if;
  select coalesce(jsonb_agg(item order by created_at,player_id),'[]') into rows from (
    select cp.created_at,cp.player_id,jsonb_build_object(
      'playerId',cp.player_id,'createdAt',cp.created_at,'displayName',p.display_name,'membershipActive',cp.is_active,'membershipVersion',cp.version,
      'hasSavedPreparationDraft',exists (
        select from public.feedback_entries fe where fe.campaign_id = list_coach_roster.campaign_id and fe.player_id = cp.player_id and fe.coach_id = coach
          and fe.kind = 'preparation' and fe.status = 'draft'),
      'preparationSubmissionCount',(
        select count(*)::text from public.feedback_entries fe where fe.campaign_id = list_coach_roster.campaign_id and fe.player_id = cp.player_id and fe.coach_id = coach
          and fe.kind = 'preparation' and fe.status = 'submitted'),
      'latestPreparationSubmittedAt',(
        select max(fe.submitted_at) from public.feedback_entries fe where fe.campaign_id = list_coach_roster.campaign_id and fe.player_id = cp.player_id and fe.coach_id = coach
          and fe.kind = 'preparation' and fe.status = 'submitted')
    ) as item
    from public.campaign_players cp
    join public.profiles p on p.id = cp.player_id
    where cp.campaign_id = list_coach_roster.campaign_id
      and (membership = 'all' or (membership = 'active' and cp.is_active) or (membership = 'withdrawn' and not cp.is_active))
      and (search is null or strpos(lower(p.display_name), lower(search)) > 0 or private.coach_player_reference_match(search, cp.player_id))
      and (drafts = 'all' or exists (
        select from public.feedback_entries fe where fe.campaign_id = list_coach_roster.campaign_id and fe.player_id = cp.player_id and fe.coach_id = coach
          and fe.kind = 'preparation' and fe.status = 'draft'))
      and (parsed is null or (cp.created_at,cp.player_id) > (cursor_created,cursor_id))
    order by cp.created_at,cp.player_id limit page_size + 1
  ) page;
  return private.coach_list_envelope(rows, page_size, fingerprint, array['createdAt','playerId']);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then perform private.fail('INVALID_INPUT'); return null;
end; $$;

create or replace function public.get_coach_player_context(campaign_id uuid, player_id uuid, query text default null, membership text default 'active', drafts text default 'all')
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare coach uuid := private.require_enabled_coach(); search text := private.coach_search_query(query);
  campaign_ctx jsonb; cp public.campaign_players; p public.profiles; draft_row public.feedback_entries; filter_match boolean; writable boolean;
begin
  if membership is null or membership not in ('all','active','withdrawn') or drafts is null or drafts not in ('all','saved') then perform private.fail('INVALID_INPUT'); end if;
  campaign_ctx := private.coach_campaign_context(get_coach_player_context.campaign_id, coach);
  select * into cp from public.campaign_players member where member.campaign_id = get_coach_player_context.campaign_id and member.player_id = get_coach_player_context.player_id;
  if not found then perform private.fail('NOT_FOUND'); end if;
  select profile.id, profile.display_name into p.id, p.display_name from public.profiles profile where profile.id = get_coach_player_context.player_id;
  filter_match := (membership = 'all' or (membership = 'active' and cp.is_active) or (membership = 'withdrawn' and not cp.is_active))
    and (search is null or strpos(lower(p.display_name), lower(search)) > 0 or private.coach_player_reference_match(search, get_coach_player_context.player_id))
    and (drafts = 'all' or exists (
      select from public.feedback_entries fe where fe.campaign_id = get_coach_player_context.campaign_id and fe.player_id = get_coach_player_context.player_id and fe.coach_id = coach
        and fe.kind = 'preparation' and fe.status = 'draft'));
  select * into draft_row from public.feedback_entries fe where fe.campaign_id = get_coach_player_context.campaign_id and fe.player_id = get_coach_player_context.player_id and fe.coach_id = coach
    and fe.kind = 'preparation' and fe.status = 'draft';
  writable := (campaign_ctx->>'membershipActive')::boolean and (campaign_ctx->>'stage') = 'preparation' and cp.is_active;
  return jsonb_build_object(
    'campaignContext',campaign_ctx,
    'playerId',get_coach_player_context.player_id,'displayName',p.display_name,'membershipActive',cp.is_active,'membershipVersion',cp.version,
    'filterMatch',filter_match,'preparationWritable',writable,
    'draft',case when draft_row.id is null then null else jsonb_build_object(
      'id',draft_row.id,'version',draft_row.version,'updatedAt',draft_row.updated_at,
      'observations',draft_row.observations,'strengths',draft_row.strengths,'developmentFocus',draft_row.development_focus,'observedOn',draft_row.observed_on) end);
end; $$;

create or replace function public.get_coach_roster_neighbors(campaign_id uuid, player_id uuid, query text default null, membership text default 'active', drafts text default 'all')
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare coach uuid := private.require_enabled_coach(); search text := private.coach_search_query(query);
  fingerprint text; ordered uuid[]; idx integer; selected_match boolean; prev jsonb; next_neighbor jsonb;
begin
  if not coalesce(private.can_read_campaign(get_coach_roster_neighbors.campaign_id),false) then perform private.fail('NOT_FOUND'); end if;
  if membership is null or membership not in ('all','active','withdrawn') or drafts is null or drafts not in ('all','saved') then perform private.fail('INVALID_INPUT'); end if;
  fingerprint := private.coach_query_fingerprint(jsonb_build_object('list','roster','campaignId',get_coach_roster_neighbors.campaign_id,'query',search,'membership',membership,'drafts',drafts));
  select coalesce(array_agg(cp.player_id order by cp.created_at,cp.player_id), array[]::uuid[]) into ordered
    from public.campaign_players cp
    join public.profiles p on p.id = cp.player_id
    where cp.campaign_id = get_coach_roster_neighbors.campaign_id
      and (membership = 'all' or (membership = 'active' and cp.is_active) or (membership = 'withdrawn' and not cp.is_active))
      and (search is null or strpos(lower(p.display_name), lower(search)) > 0 or private.coach_player_reference_match(search, cp.player_id))
      and (drafts = 'all' or exists (
        select from public.feedback_entries fe where fe.campaign_id = get_coach_roster_neighbors.campaign_id and fe.player_id = cp.player_id and fe.coach_id = coach
          and fe.kind = 'preparation' and fe.status = 'draft'));
  idx := array_position(ordered, get_coach_roster_neighbors.player_id);
  selected_match := idx is not null;
  if selected_match and idx > 1 then
    select jsonb_build_object('playerId',p.player_id,'displayName',pr.display_name,'membershipVersion',p.version) into prev
      from public.campaign_players p join public.profiles pr on pr.id = p.player_id where p.campaign_id = get_coach_roster_neighbors.campaign_id and p.player_id = ordered[idx-1];
  end if;
  if selected_match and idx < coalesce(array_length(ordered,1),0) then
    select jsonb_build_object('playerId',p.player_id,'displayName',pr.display_name,'membershipVersion',p.version) into next_neighbor
      from public.campaign_players p join public.profiles pr on pr.id = p.player_id where p.campaign_id = get_coach_roster_neighbors.campaign_id and p.player_id = ordered[idx+1];
  end if;
  return jsonb_build_object('queryFingerprint',fingerprint,'selectedMatch',selected_match,'previous',prev,'next',next_neighbor);
end; $$;

-- PostgreSQL base64 wraps lines. Remove the wrapping before emitting URL cursors
-- and before counting padding while accepting cursors emitted by older versions.
create or replace function private.coach_cursor_encode(fingerprint text, tuple jsonb) returns text
language sql immutable set search_path = '' as $$
  select translate(encode(convert_to((jsonb_build_object('version',1,'queryFingerprint',fingerprint) || tuple)::text,'UTF8'),'base64'), E'+/=\n\r', '-_');
$$;

create or replace function private.coach_cursor_decode(cursor_text text, expected_fingerprint text, required_keys text[])
returns jsonb language plpgsql immutable set search_path = '' as $$
declare raw text; parsed jsonb; key text; instant timestamptz; identity uuid;
begin
  if cursor_text is null then return null; end if;
  if length(cursor_text) > 4096 then perform private.fail('INVALID_CURSOR'); end if;
  raw := translate(cursor_text, E'-_\n\r', '+/');
  if raw = '' or raw !~ '^[A-Za-z0-9+/]*={0,2}$' then perform private.fail('INVALID_CURSOR'); end if;
  while length(raw) % 4 <> 0 loop raw := raw || '='; end loop;
  begin
    parsed := convert_from(decode(raw, 'base64'), 'UTF8')::jsonb;
    if jsonb_typeof(parsed) is distinct from 'object' or parsed->'version' is distinct from '1'::jsonb
      or parsed->>'queryFingerprint' is distinct from expected_fingerprint then perform private.fail('INVALID_CURSOR'); end if;
    foreach key in array required_keys loop
      if jsonb_typeof(parsed->key) is distinct from 'string' then perform private.fail('INVALID_CURSOR'); end if;
      if key in ('createdAt','submittedAt') then
        instant := (parsed->>key)::timestamptz;
        if not isfinite(instant) then perform private.fail('INVALID_CURSOR'); end if;
      elsif key in ('id','playerId') then
        identity := (parsed->>key)::uuid;
      end if;
    end loop;
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow
    or character_not_in_repertoire or invalid_parameter_value then
    perform private.fail('INVALID_CURSOR');
  end;
  return parsed;
end; $$;

-- All public reads run with caller privileges. Only the existing identity check
-- needs owner access to private profile status; data projections remain invoker.
alter function public.get_coach_campaign_context(uuid) security invoker;
alter function public.list_coach_feedback_history(uuid,uuid,text,text,text,integer) security invoker;
alter function public.get_coach_feedback_entry(uuid,uuid,uuid) security invoker;

-- These helpers validate inputs, build projections or check the current actor.
-- Grant only this call graph, retaining all existing table and column grants.
grant execute on function private.require_enabled_coach(),
  private.coach_search_query(text), private.coach_query_fingerprint(jsonb),
  private.coach_cursor_decode(text,text,text[]), private.coach_cursor_encode(text,jsonb),
  private.coach_list_envelope(jsonb,integer,text,text[]),
  private.coach_player_reference_match(text,uuid), private.coach_campaign_context(uuid,uuid),
  private.checked_date(text), private.fail(text)
  to authenticated;
