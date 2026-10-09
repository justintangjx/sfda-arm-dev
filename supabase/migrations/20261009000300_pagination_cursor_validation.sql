-- Validate cursor values before querying, even when a plan skips row comparisons.
create or replace function public.admin_list_profiles(role_filter public.account_role default null, page_cursor jsonb default null, page_size integer default 20)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare rows jsonb; cursor jsonb; cursor_time timestamptz; cursor_id uuid;
begin
  if auth.uid() is null then perform private.fail('AUTH_REQUIRED'); end if;
  if private.enabled_role() is distinct from 'admin'::public.account_role then perform private.fail('FORBIDDEN'); end if;
  if page_size is null or page_size not between 1 and 100 then perform private.fail('INVALID_INPUT'); end if;
  if page_cursor is not null then
    if jsonb_typeof(page_cursor) <> 'object' then perform private.fail('INVALID_INPUT'); end if;
    if not page_cursor ?& array['createdAt','id'] or (select count(*) from jsonb_object_keys(page_cursor)) <> 2 or
      jsonb_typeof(page_cursor->'createdAt') is distinct from 'string' or jsonb_typeof(page_cursor->'id') is distinct from 'string'
      then perform private.fail('INVALID_INPUT'); end if;
    cursor_time := (page_cursor->>'createdAt')::timestamptz;
    cursor_id := (page_cursor->>'id')::uuid;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'displayName',display_name,'role',role,'enabled',access_enabled,'version',version,'createdAt',created_at) order by created_at,id),'[]') into rows
    from (select * from public.profiles where (role_filter is null or role = role_filter) and
      (page_cursor is null or (created_at,id) > (cursor_time,cursor_id)) order by created_at,id limit page_size + 1) p;
  if jsonb_array_length(rows) > page_size then
    rows := rows - page_size;
    cursor := jsonb_build_object('createdAt',rows->(page_size-1)->'createdAt','id',rows->(page_size-1)->'id');
  end if;
  return jsonb_build_object('items',rows,'nextCursor',cursor);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then perform private.fail('INVALID_INPUT'); return null;
end; $$;

create or replace function public.list_final_obligations(campaign_id uuid, status_filter text default null, page_cursor jsonb default null, page_size integer default 20)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare rows jsonb; cursor jsonb; scoped_coach uuid; cursor_time timestamptz; cursor_id uuid;
begin
  if auth.uid() is null then perform private.fail('AUTH_REQUIRED'); end if;
  if not coalesce(private.can_read_campaign(campaign_id),false) or not exists (select from public.campaigns where id = campaign_id) then perform private.fail('NOT_FOUND'); end if;
  if page_size is null or page_size not between 1 and 100 or (status_filter is not null and status_filter not in ('outstanding','submitted','waived'))
    then perform private.fail('INVALID_INPUT'); end if;
  if page_cursor is not null then
    if jsonb_typeof(page_cursor) <> 'object' then perform private.fail('INVALID_INPUT'); end if;
    if not page_cursor ?& array['frozenAt','id'] or (select count(*) from jsonb_object_keys(page_cursor)) <> 2 or
      jsonb_typeof(page_cursor->'frozenAt') is distinct from 'string' or jsonb_typeof(page_cursor->'id') is distinct from 'string'
      then perform private.fail('INVALID_INPUT'); end if;
    cursor_time := (page_cursor->>'frozenAt')::timestamptz;
    cursor_id := (page_cursor->>'id')::uuid;
  end if;
  scoped_coach := case when private.enabled_role() = 'coach' then auth.uid() else null end;
  select coalesce(jsonb_agg(item order by frozen_at,id),'[]') into rows from (
    select o.frozen_at,o.id,jsonb_build_object('id',o.id,'coachId',o.coach_id,'playerId',o.player_id,'frozenAt',o.frozen_at,
      'status',case when f.id is not null then 'submitted' when w.obligation_id is not null then 'waived' else 'outstanding' end,
      'submissionId',f.id,'waiverId',w.obligation_id) as item
    from public.final_obligations o
    left join public.feedback_entries f on f.final_obligation_id = o.id and f.status = 'submitted'
    left join public.final_waivers w on w.obligation_id = o.id
    where o.campaign_id = list_final_obligations.campaign_id and (scoped_coach is null or o.coach_id = scoped_coach)
      and (status_filter is null or status_filter = case when f.id is not null then 'submitted' when w.obligation_id is not null then 'waived' else 'outstanding' end)
      and (page_cursor is null or (o.frozen_at,o.id) > (cursor_time,cursor_id))
    order by o.frozen_at,o.id limit page_size + 1
  ) page;
  if jsonb_array_length(rows) > page_size then
    rows := rows - page_size;
    cursor := jsonb_build_object('frozenAt',rows->(page_size-1)->'frozenAt','id',rows->(page_size-1)->'id');
  end if;
  return jsonb_build_object('items',rows,'nextCursor',cursor);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then perform private.fail('INVALID_INPUT'); return null;
end; $$;
