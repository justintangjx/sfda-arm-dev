create or replace function public.list_coach_feedback_history(campaign_id uuid, player_id uuid, observed_from text default null, observed_to text default null, cursor text default null, page_size integer default 20)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare coach uuid := private.require_enabled_coach(); from_date date; to_date date; fingerprint text; parsed jsonb;
  cursor_submitted timestamptz; cursor_id uuid; rows jsonb;
begin
  if not coalesce(private.can_read_campaign(list_coach_feedback_history.campaign_id),false) then perform private.fail('NOT_FOUND'); end if;
  if not exists (select from public.campaign_players where campaign_id = list_coach_feedback_history.campaign_id and player_id = list_coach_feedback_history.player_id) then perform private.fail('NOT_FOUND'); end if;
  if page_size is null or page_size not between 1 and 100 then perform private.fail('INVALID_INPUT'); end if;
  from_date := case when observed_from is null or btrim(observed_from) = '' then null else private.checked_date(observed_from) end;
  to_date := case when observed_to is null or btrim(observed_to) = '' then null else private.checked_date(observed_to) end;
  if from_date is not null and to_date is not null and from_date > to_date then perform private.fail('INVALID_INPUT'); end if;
  fingerprint := private.coach_query_fingerprint(jsonb_build_object('list','history','campaignId',list_coach_feedback_history.campaign_id,'playerId',list_coach_feedback_history.player_id,'observedFrom',from_date,'observedTo',to_date));
  parsed := private.coach_cursor_decode(cursor, fingerprint, array['submittedAt','id']);
  if parsed is not null then
    cursor_submitted := (parsed->>'submittedAt')::timestamptz;
    cursor_id := (parsed->>'id')::uuid;
  end if;
  select coalesce(jsonb_agg(item order by submitted_at desc,id desc),'[]') into rows from (
    select fe.submitted_at,fe.id,jsonb_build_object(
      'feedbackId',fe.id,'id',fe.id,'kind',fe.kind,'observedOn',fe.observed_on::text,'submittedAt',fe.submitted_at,
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
