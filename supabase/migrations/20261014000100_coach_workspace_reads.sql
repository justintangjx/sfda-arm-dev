-- Caller-scoped coach workspace reads for campaign discovery, roster, context, neighbors and history.

create function private.require_enabled_coach() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  if actor is null then perform private.fail('AUTH_REQUIRED'); end if;
  if private.enabled_role() is distinct from 'coach'::public.account_role then perform private.fail('FORBIDDEN'); end if;
  return actor;
end; $$;

create function private.coach_search_query(value text) returns text
language plpgsql immutable set search_path = '' as $$
declare trimmed text := btrim(value);
begin
  if value is null or trimmed = '' then return null; end if;
  if char_length(trimmed) > 160 then perform private.fail('INVALID_INPUT'); end if;
  return trimmed;
end; $$;

create function private.coach_query_fingerprint(payload jsonb) returns text
language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(jsonb_build_object('fingerprintVersion',1,'scope','coach_workspace','payload',payload)::text,'UTF8')),'hex');
$$;

create function private.coach_cursor_decode(cursor_text text, expected_fingerprint text, required_keys text[])
returns jsonb language plpgsql immutable set search_path = '' as $$
declare raw text; decoded bytea; parsed jsonb; key text;
begin
  if cursor_text is null then return null; end if;
  raw := replace(replace(cursor_text, '-', '+'), '_', '/');
  while length(raw) % 4 <> 0 loop raw := raw || '='; end loop;
  begin decoded := decode(raw, 'base64'); exception when others then perform private.fail('INVALID_CURSOR'); end;
  begin parsed := convert_from(decoded, 'UTF8')::jsonb; exception when others then perform private.fail('INVALID_CURSOR'); end;
  if jsonb_typeof(parsed) <> 'object' or (parsed->>'version')::integer is distinct from 1
    or parsed->>'queryFingerprint' is distinct from expected_fingerprint then perform private.fail('INVALID_CURSOR'); end if;
  foreach key in array required_keys loop
    if not parsed ? key then perform private.fail('INVALID_CURSOR'); end if;
  end loop;
  return parsed;
end; $$;

create function private.coach_cursor_encode(fingerprint text, tuple jsonb) returns text
language sql immutable set search_path = '' as $$
  select translate(encode(convert_to((jsonb_build_object('version',1,'queryFingerprint',fingerprint) || tuple)::text,'UTF8'),'base64'), E'+/=', '-_');
$$;

create function private.coach_list_envelope(items jsonb, page_size integer, fingerprint text, cursor_fields text[])
returns jsonb language plpgsql stable set search_path = '' as $$
declare next_cursor text; last jsonb; tuple jsonb := '{}'::jsonb; field text;
begin
  if coalesce(jsonb_array_length(items), 0) > page_size then
    last := items->(page_size - 1);
    items := items - page_size;
    foreach field in array cursor_fields loop
      if last->field is null then perform private.fail('INVALID_CURSOR'); end if;
      tuple := tuple || jsonb_build_object(field, last->field);
    end loop;
    next_cursor := private.coach_cursor_encode(fingerprint, tuple);
  end if;
  return jsonb_build_object('items',items,'nextCursor',next_cursor,'queryFingerprint',fingerprint,'readAt',to_jsonb(current_timestamp));
end; $$;

create function private.coach_player_reference_match(reference text, player_id uuid) returns boolean
language plpgsql immutable set search_path = '' as $$
declare normalized text := lower(btrim(reference));
begin
  if normalized = '' then return true; end if;
  if normalized ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return player_id = normalized::uuid;
  end if;
  if normalized ~ '^[0-9a-f]{8,32}$' then
    return replace(player_id::text, '-', '') like normalized || '%';
  end if;
  return false;
end; $$;

create function private.coach_campaign_context(campaign_id uuid, coach_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare campaign public.campaigns; competition public.competitions; membership public.campaign_coaches;
  frozen_count bigint;
begin
  if not coalesce(private.can_read_campaign(campaign_id),false) then perform private.fail('NOT_FOUND'); end if;
  select * into campaign from public.campaigns where id = campaign_id;
  if not found then perform private.fail('NOT_FOUND'); end if;
  select * into competition from public.competitions where id = campaign.competition_id;
  select * into membership from public.campaign_coaches where campaign_id = coach_campaign_context.campaign_id and coach_id = coach_campaign_context.coach_id;
  if not found then perform private.fail('NOT_FOUND'); end if;
  if campaign.requirements_frozen_at is null then frozen_count := null;
  else select count(*) into frozen_count from public.final_obligations where campaign_id = coach_campaign_context.campaign_id and coach_id = coach_campaign_context.coach_id;
  end if;
  return jsonb_build_object(
    'campaignId',campaign.id,'name',campaign.name,'teamName',campaign.team_name,'competitionId',competition.id,'competitionName',competition.name,
    'stage',campaign.stage,'version',campaign.version,'membershipActive',membership.is_active,'membershipVersion',membership.version,
    'requirements',jsonb_build_object('scope','self','frozen',campaign.requirements_frozen_at is not null,'frozenRequiredCount',frozen_count),
    'writeKinds',jsonb_build_array('preparation'),'correctionSupport','unavailable');
end; $$;

create function public.list_coach_campaigns(mode text, query text default null, stage public.campaign_stage default null, cursor text default null, page_size integer default 20)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare coach uuid := private.require_enabled_coach(); search text := private.coach_search_query(query);
  fingerprint text; parsed jsonb; cursor_created timestamptz; cursor_id uuid; rows jsonb;
begin
  if mode is null or mode not in ('current','history') then perform private.fail('INVALID_INPUT'); end if;
  if page_size is null or page_size not between 1 and 100 then perform private.fail('INVALID_INPUT'); end if;
  fingerprint := private.coach_query_fingerprint(jsonb_build_object('list','campaigns','mode',mode,'query',search,'stage',stage));
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
      and (stage is null or c.stage = stage)
      and (search is null or c.name ilike '%' || search || '%' or c.team_name ilike '%' || search || '%' or comp.name ilike '%' || search || '%')
      and (parsed is null or (c.created_at,c.id) > (cursor_created,cursor_id))
    order by c.created_at,c.id limit page_size + 1
  ) page;
  return private.coach_list_envelope(rows, page_size, fingerprint, array['createdAt','id']);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then perform private.fail('INVALID_INPUT'); return null;
end; $$;

create function public.get_coach_campaign_context(campaign_id uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
begin
  return private.coach_campaign_context(campaign_id, private.require_enabled_coach());
end; $$;

create function public.list_coach_roster(campaign_id uuid, query text default null, membership text default 'active', drafts text default 'all', cursor text default null, page_size integer default 20)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare coach uuid := private.require_enabled_coach(); search text := private.coach_search_query(query);
  fingerprint text; parsed jsonb; cursor_created timestamptz; cursor_id uuid; rows jsonb;
begin
  if not coalesce(private.can_read_campaign(campaign_id),false) then perform private.fail('NOT_FOUND'); end if;
  if membership is null or membership not in ('all','active','withdrawn') or drafts is null or drafts not in ('all','saved') then perform private.fail('INVALID_INPUT'); end if;
  if page_size is null or page_size not between 1 and 100 then perform private.fail('INVALID_INPUT'); end if;
  fingerprint := private.coach_query_fingerprint(jsonb_build_object('list','roster','campaignId',campaign_id,'query',search,'membership',membership,'drafts',drafts));
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
      and (search is null or p.display_name ilike '%' || search || '%' or private.coach_player_reference_match(search, cp.player_id))
      and (drafts = 'all' or exists (
        select from public.feedback_entries fe where fe.campaign_id = list_coach_roster.campaign_id and fe.player_id = cp.player_id and fe.coach_id = coach
          and fe.kind = 'preparation' and fe.status = 'draft'))
      and (parsed is null or (cp.created_at,cp.player_id) > (cursor_created,cursor_id))
    order by cp.created_at,cp.player_id limit page_size + 1
  ) page;
  return private.coach_list_envelope(rows, page_size, fingerprint, array['createdAt','playerId']);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then perform private.fail('INVALID_INPUT'); return null;
end; $$;

create function public.get_coach_player_context(campaign_id uuid, player_id uuid, query text default null, membership text default 'active', drafts text default 'all')
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare coach uuid := private.require_enabled_coach(); search text := private.coach_search_query(query);
  campaign_ctx jsonb; cp public.campaign_players; p public.profiles; draft_row public.feedback_entries; filter_match boolean; writable boolean;
begin
  if membership is null or membership not in ('all','active','withdrawn') or drafts is null or drafts not in ('all','saved') then perform private.fail('INVALID_INPUT'); end if;
  campaign_ctx := private.coach_campaign_context(campaign_id, coach);
  select * into cp from public.campaign_players where campaign_id = get_coach_player_context.campaign_id and player_id = get_coach_player_context.player_id;
  if not found then perform private.fail('NOT_FOUND'); end if;
  select * into p from public.profiles where id = get_coach_player_context.player_id;
  filter_match := (membership = 'all' or (membership = 'active' and cp.is_active) or (membership = 'withdrawn' and not cp.is_active))
    and (search is null or p.display_name ilike '%' || search || '%' or private.coach_player_reference_match(search, get_coach_player_context.player_id))
    and (drafts = 'all' or exists (
      select from public.feedback_entries fe where fe.campaign_id = get_coach_player_context.campaign_id and fe.player_id = get_coach_player_context.player_id and fe.coach_id = coach
        and fe.kind = 'preparation' and fe.status = 'draft'));
  select * into draft_row from public.feedback_entries where campaign_id = get_coach_player_context.campaign_id and player_id = get_coach_player_context.player_id and coach_id = coach
    and kind = 'preparation' and status = 'draft';
  writable := (campaign_ctx->>'membershipActive')::boolean and (campaign_ctx->>'stage') = 'preparation' and cp.is_active;
  return jsonb_build_object(
    'campaignContext',campaign_ctx,
    'playerId',get_coach_player_context.player_id,'displayName',p.display_name,'membershipActive',cp.is_active,'membershipVersion',cp.version,
    'filterMatch',filter_match,'preparationWritable',writable,
    'draft',case when draft_row.id is null then null else jsonb_build_object(
      'id',draft_row.id,'version',draft_row.version,'updatedAt',draft_row.updated_at,
      'observations',draft_row.observations,'strengths',draft_row.strengths,'developmentFocus',draft_row.development_focus,'observedOn',draft_row.observed_on) end);
end; $$;

create function public.get_coach_roster_neighbors(campaign_id uuid, player_id uuid, query text default null, membership text default 'active', drafts text default 'all')
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare coach uuid := private.require_enabled_coach(); search text := private.coach_search_query(query);
  fingerprint text; ordered uuid[]; idx integer; selected_match boolean; prev jsonb; next_neighbor jsonb;
begin
  if not coalesce(private.can_read_campaign(campaign_id),false) then perform private.fail('NOT_FOUND'); end if;
  if membership is null or membership not in ('all','active','withdrawn') or drafts is null or drafts not in ('all','saved') then perform private.fail('INVALID_INPUT'); end if;
  fingerprint := private.coach_query_fingerprint(jsonb_build_object('list','roster','campaignId',campaign_id,'query',search,'membership',membership,'drafts',drafts));
  select coalesce(array_agg(cp.player_id order by cp.created_at,cp.player_id), array[]::uuid[]) into ordered
    from public.campaign_players cp
    join public.profiles p on p.id = cp.player_id
    where cp.campaign_id = get_coach_roster_neighbors.campaign_id
      and (membership = 'all' or (membership = 'active' and cp.is_active) or (membership = 'withdrawn' and not cp.is_active))
      and (search is null or p.display_name ilike '%' || search || '%' or private.coach_player_reference_match(search, cp.player_id))
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

create function public.list_coach_feedback_history(campaign_id uuid, player_id uuid, observed_from text default null, observed_to text default null, cursor text default null, page_size integer default 20)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare coach uuid := private.require_enabled_coach(); from_date date; to_date date; fingerprint text; parsed jsonb;
  cursor_submitted timestamptz; cursor_id uuid; rows jsonb;
begin
  if not coalesce(private.can_read_campaign(campaign_id),false) then perform private.fail('NOT_FOUND'); end if;
  if not exists (select from public.campaign_players where campaign_id = list_coach_feedback_history.campaign_id and player_id = list_coach_feedback_history.player_id) then perform private.fail('NOT_FOUND'); end if;
  if page_size is null or page_size not between 1 and 100 then perform private.fail('INVALID_INPUT'); end if;
  from_date := case when observed_from is null or btrim(observed_from) = '' then null else private.checked_date(observed_from) end;
  to_date := case when observed_to is null or btrim(observed_to) = '' then null else private.checked_date(observed_to) end;
  if from_date is not null and to_date is not null and from_date > to_date then perform private.fail('INVALID_INPUT'); end if;
  fingerprint := private.coach_query_fingerprint(jsonb_build_object('list','history','campaignId',campaign_id,'playerId',player_id,'observedFrom',from_date,'observedTo',to_date));
  parsed := private.coach_cursor_decode(cursor, fingerprint, array['submittedAt','id']);
  if parsed is not null then
    cursor_submitted := (parsed->>'submittedAt')::timestamptz;
    cursor_id := (parsed->>'id')::uuid;
  end if;
  select coalesce(jsonb_agg(item order by submitted_at desc,id desc),'[]') into rows from (
    select fe.submitted_at,fe.id,jsonb_build_object(
      'feedbackId',fe.id,'id',fe.id,'kind',fe.kind,'observedOn',fe.observed_on,'submittedAt',fe.submitted_at,
      'preview',left(coalesce(fe.observations,''),160),'correctionSupport','unavailable'
    ) as item
    from public.feedback_entries fe
    where fe.campaign_id = list_coach_feedback_history.campaign_id and fe.player_id = list_coach_feedback_history.player_id and fe.coach_id = coach and fe.status = 'submitted'
      and (from_date is null or fe.observed_on >= from_date) and (to_date is null or fe.observed_on <= to_date)
      and (parsed is null or (fe.submitted_at,fe.id) < (cursor_submitted,cursor_id))
    order by fe.submitted_at desc,fe.id desc limit page_size + 1
  ) page;
  return private.coach_list_envelope(rows, page_size, fingerprint, array['submittedAt','id']);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then perform private.fail('INVALID_INPUT'); return null;
end; $$;

create function public.get_coach_feedback_entry(campaign_id uuid, player_id uuid, feedback_id uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare coach uuid := private.require_enabled_coach(); row public.feedback_entries;
begin
  select * into row from public.feedback_entries where id = get_coach_feedback_entry.feedback_id and campaign_id = get_coach_feedback_entry.campaign_id and player_id = get_coach_feedback_entry.player_id
    and coach_id = coach and status = 'submitted';
  if not found then perform private.fail('NOT_FOUND'); end if;
  return jsonb_build_object(
    'feedbackId',row.id,'kind',row.kind,'observedOn',row.observed_on,'submittedAt',row.submitted_at,
    'observations',row.observations,'strengths',row.strengths,'developmentFocus',row.development_focus,
    'correctionSupport','unavailable');
end; $$;

revoke all on function public.list_coach_campaigns(text,text,public.campaign_stage,text,integer),
  public.get_coach_campaign_context(uuid),
  public.list_coach_roster(uuid,text,text,text,text,integer),
  public.get_coach_player_context(uuid,uuid,text,text,text),
  public.get_coach_roster_neighbors(uuid,uuid,text,text,text),
  public.list_coach_feedback_history(uuid,uuid,text,text,text,integer),
  public.get_coach_feedback_entry(uuid,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.list_coach_campaigns(text,text,public.campaign_stage,text,integer),
  public.get_coach_campaign_context(uuid),
  public.list_coach_roster(uuid,text,text,text,text,integer),
  public.get_coach_player_context(uuid,uuid,text,text,text),
  public.get_coach_roster_neighbors(uuid,uuid,text,text,text),
  public.list_coach_feedback_history(uuid,uuid,text,text,text,integer),
  public.get_coach_feedback_entry(uuid,uuid,uuid)
  to authenticated;
