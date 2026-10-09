-- Spec 0002, frozen final obligations, permanent waivers and correction history.
create table public.final_obligations (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null,
  competition_id uuid not null,
  coach_id uuid not null,
  player_id uuid not null,
  frozen_at timestamptz not null default current_timestamp,
  unique (competition_id,coach_id,player_id),
  unique (id,campaign_id,competition_id,coach_id,player_id),
  foreign key (competition_id,coach_id,player_id,campaign_id)
    references public.competition_pairings(competition_id,coach_id,player_id,campaign_id) on delete restrict
);
create index campaign_obligations on public.final_obligations (campaign_id,coach_id,frozen_at,id);
create table public.final_waivers (
  obligation_id uuid primary key references public.final_obligations(id) on delete restrict,
  admin_id uuid not null references public.profiles(id) on delete restrict,
  reason text not null check (reason = btrim(reason) and reason ~ '[^[:space:]]' and char_length(reason) between 1 and 2000),
  created_at timestamptz not null default current_timestamp
);
create table public.feedback_corrections (
  id uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references public.feedback_entries(id) on delete restrict,
  admin_id uuid not null references public.profiles(id) on delete restrict,
  revision integer not null check (revision > 0),
  observations text not null check (char_length(observations) between 1 and 10000 and observations ~ '[^[:space:]]'),
  observed_on date not null check (isfinite(observed_on)),
  strengths text check (char_length(strengths) <= 5000),
  development_focus text check (char_length(development_focus) <= 5000),
  reason text not null check (reason = btrim(reason) and reason ~ '[^[:space:]]' and char_length(reason) between 1 and 2000),
  created_at timestamptz not null default current_timestamp,
  unique (feedback_id,revision)
);
create index correction_history on public.feedback_corrections (feedback_id,revision);
alter table public.feedback_entries drop constraint preparation_only;
alter table public.feedback_entries add column final_obligation_id uuid;
alter table public.feedback_entries add constraint feedback_obligation foreign key
  (final_obligation_id,campaign_id,competition_id,coach_id,player_id)
  references public.final_obligations(id,campaign_id,competition_id,coach_id,player_id) on delete restrict;
alter table public.feedback_entries add constraint feedback_kind_obligation check (
  (kind = 'preparation' and final_obligation_id is null) or (kind = 'final' and final_obligation_id is not null)
);

create function private.immutable_row() returns trigger language plpgsql security definer set search_path = '' as $$
begin perform private.fail('IMMUTABLE_RECORD'); return null; end; $$;
create function private.guard_final_identity() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.final_obligation_id is distinct from old.final_obligation_id then perform private.fail('IMMUTABLE_RECORD'); end if;
  return new;
end; $$;
create trigger guard_final_identity before update on public.feedback_entries for each row execute function private.guard_final_identity();
create function private.guard_admin_record() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select from public.profiles where id = new.admin_id and role = 'admin') then perform private.fail('INVALID_INPUT'); end if;
  if tg_table_name = 'feedback_corrections' then
    if not exists (select from public.feedback_entries where id = new.feedback_id and status = 'submitted') then perform private.fail('INVALID_INPUT'); end if;
    if new.observed_on > private.singapore_today(current_timestamp) then perform private.fail('INVALID_INPUT'); end if;
  end if;
  return new;
end; $$;
create trigger guard_admin_record before insert on public.feedback_corrections for each row execute function private.guard_admin_record();
create trigger guard_admin_record before insert on public.final_waivers for each row execute function private.guard_admin_record();
do $$ declare t text; begin
  foreach t in array array['final_obligations','final_waivers','feedback_corrections'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public, anon, authenticated',t);
    execute format('create trigger immutable_row before update or delete on public.%I for each row execute function private.immutable_row()',t);
  end loop;
end $$;
create policy obligation_reads on public.final_obligations for select to authenticated using (
  private.enabled_role() = 'admin' or (coach_id = auth.uid() and private.can_read_campaign(campaign_id))
);
create policy waiver_reads on public.final_waivers for select to authenticated using (
  private.enabled_role() = 'admin' or exists (
    select from public.final_obligations o where o.id = final_waivers.obligation_id and o.coach_id = auth.uid() and private.can_read_campaign(o.campaign_id)
  )
);
create policy correction_reads on public.feedback_corrections for select to authenticated using (
  private.enabled_role() = 'admin' or exists (
    select from public.feedback_entries f where f.id = feedback_corrections.feedback_id and f.coach_id = auth.uid() and private.can_read_campaign(f.campaign_id)
  )
);
grant select on public.final_obligations,public.final_waivers,public.feedback_corrections to authenticated;

create or replace function private.feedback_permission(campaign uuid, player uuid, kind public.feedback_kind) returns uuid
language plpgsql set search_path = '' as $$
declare stage public.campaign_stage; obligation uuid;
begin
  select c.stage into stage from public.campaigns c where c.id = campaign;
  if not exists (select from public.campaign_coaches where campaign_id = campaign and coach_id = auth.uid() and is_active)
    then perform private.fail('FORBIDDEN'); end if;
  if kind = 'preparation' then
    if stage <> 'preparation' then perform private.fail('STAGE_CLOSED'); end if;
    if not exists (select from public.campaign_players where campaign_id = campaign and player_id = player and is_active)
      then perform private.fail('NOT_FOUND'); end if;
    return null;
  elsif kind = 'final' then
    if stage <> 'final_feedback' then perform private.fail('STAGE_CLOSED'); end if;
    select id into obligation from public.final_obligations where campaign_id = campaign and player_id = player and coach_id = auth.uid();
    if not found then perform private.fail('NOT_FOUND'); end if;
    if exists (select from public.final_waivers where obligation_id = obligation) then perform private.fail('OBLIGATION_WAIVED'); end if;
    if exists (select from public.feedback_entries where final_obligation_id = obligation and status = 'submitted') then perform private.fail('ALREADY_SUBMITTED'); end if;
    return obligation;
  end if;
  perform private.fail('INVALID_INPUT'); return null;
end; $$;

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


create function private.completion(campaign uuid, coach uuid) returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('required',count(*),'submitted',count(f.id),'waived',count(w.obligation_id),
    'outstanding',count(*) filter (where f.id is null and w.obligation_id is null))
  from public.final_obligations o
  left join public.feedback_entries f on f.final_obligation_id = o.id and f.status = 'submitted'
  left join public.final_waivers w on w.obligation_id = o.id
  where o.campaign_id = campaign and (coach is null or o.coach_id = coach);
$$;
create function private.apply_lifecycle(action text, p jsonb, campaign public.campaigns) returns jsonb
language plpgsql set search_path = '' as $$
declare next_stage public.campaign_stage; new_version integer; obligations integer := 0; drafts integer := 0;
  counts jsonb; reason text := p->>'reason'; obligation public.final_obligations; feedback public.feedback_entries;
  correction public.feedback_corrections; revision integer;
begin
  if private.enabled_role() is distinct from 'admin'::public.account_role then perform private.fail('FORBIDDEN'); end if;
  perform private.check_reason(reason);
  if action = 'advance_campaign_stage' then
    perform private.check_version(campaign.version,(p->>'expected_version')::integer);
    next_stage := case campaign.stage when 'setup' then 'preparation'::public.campaign_stage
      when 'preparation' then 'competition'::public.campaign_stage when 'competition' then 'final_feedback'::public.campaign_stage
      when 'final_feedback' then 'closed'::public.campaign_stage else null end;
    if next_stage is null or (p->>'next_stage')::public.campaign_stage is distinct from next_stage then perform private.fail('STAGE_CONFLICT'); end if;
    if next_stage = 'competition' then
      insert into public.final_obligations(campaign_id,competition_id,coach_id,player_id)
        select campaign.id,campaign.competition_id,c.coach_id,r.player_id
        from public.campaign_coaches c cross join public.campaign_players r
        where c.campaign_id = campaign.id and r.campaign_id = campaign.id and c.is_active and r.is_active;
      get diagnostics obligations = row_count;
      delete from public.feedback_entries where campaign_id = campaign.id and kind = 'preparation' and status = 'draft';
      get diagnostics drafts = row_count;
    elsif next_stage = 'closed' then
      counts := private.completion(campaign.id,null);
      if (counts->>'outstanding')::integer <> 0 then perform private.fail('OUTSTANDING_FINALS'); end if;
      delete from public.feedback_entries where campaign_id = campaign.id and kind = 'final' and status = 'draft';
      get diagnostics drafts = row_count;
    end if;
    update public.campaigns set stage = next_stage,version = version + 1,updated_at = current_timestamp,
      requirements_frozen_at = case when next_stage = 'competition' then current_timestamp else requirements_frozen_at end,
      closed_at = case when next_stage = 'closed' then current_timestamp else closed_at end
      where id = campaign.id returning version into new_version;
    return private.effect('campaign',campaign.id,new_version,
      jsonb_build_object('stage',next_stage,'obligations_created',obligations,'drafts_deleted',drafts,'before',campaign.stage,'after',next_stage)
      || case when counts is not null then counts - 'outstanding' else '{}'::jsonb end,reason);
  elsif action = 'waive_final_obligation' then
    select * into obligation from public.final_obligations where id = (p->>'obligation_id')::uuid for update;
    if not found then perform private.fail('NOT_FOUND'); end if;
    if campaign.stage <> 'final_feedback' then perform private.fail('STAGE_CLOSED'); end if;
    if exists (select from public.feedback_entries where final_obligation_id = obligation.id and status = 'submitted') then perform private.fail('ALREADY_SUBMITTED'); end if;
    if exists (select from public.final_waivers where obligation_id = obligation.id) then perform private.fail('ALREADY_WAIVED'); end if;
    insert into public.final_waivers(obligation_id,admin_id,reason) values(obligation.id,auth.uid(),reason);
    return private.effect('final_waiver',obligation.id,1,jsonb_build_object('obligation_id',obligation.id,'coach_id',obligation.coach_id,'player_id',obligation.player_id));
  elsif action = 'correct_feedback' then
    select * into feedback from public.feedback_entries where id = (p->>'feedback_id')::uuid and status = 'submitted' for update;
    if not found then perform private.fail('NOT_FOUND'); end if;
    perform private.check_content(p->'content',true);
    if p->>'expected_revision' is null or (p->>'expected_revision')::integer < 0 then perform private.fail('INVALID_INPUT'); end if;
    select coalesce(max(c.revision),0) into revision from public.feedback_corrections c where feedback_id = feedback.id;
    if revision <> (p->>'expected_revision')::integer then perform private.fail('VERSION_CONFLICT'); end if;
    insert into public.feedback_corrections(feedback_id,admin_id,revision,observations,observed_on,strengths,development_focus,reason)
      values(feedback.id,auth.uid(),revision+1,p->'content'->>'observations',private.checked_date(p->'content'->>'observed_on'),
        p->'content'->>'strengths',p->'content'->>'development_focus',reason) returning * into correction;
    return private.effect('feedback_correction',correction.id,correction.revision,
      jsonb_build_object('feedback_id',feedback.id,'revision',correction.revision,'coach_id',feedback.coach_id,'player_id',feedback.player_id));
  end if;
  perform private.fail('INVALID_INPUT'); return null;
end; $$;
create or replace function private.apply_action(action text, p jsonb, campaign public.campaigns) returns jsonb
language plpgsql set search_path = '' as $$
begin
  if action in ('advance_campaign_stage','waive_final_obligation','correct_feedback') then return private.apply_lifecycle(action,p,campaign); end if;
  return private.apply_preparation(action,p,campaign);
end; $$;

create or replace function private.receipt_result(r public.mutation_receipts) returns jsonb language plpgsql set search_path = '' as $$
declare available boolean; result jsonb;
begin
  case r.result_type
    when 'profile' then available := exists (select from public.profiles where id = r.result_id);
    when 'competition' then available := exists (select from public.competitions where id = r.result_id);
    when 'campaign' then available := exists (select from public.campaigns where id = r.result_id);
    when 'campaign_coach' then available := exists (select from public.campaign_coaches where campaign_id = r.result_id and coach_id = (r.result_metadata->>'coach_id')::uuid);
    when 'campaign_player' then available := exists (select from public.campaign_players where campaign_id = r.result_id and player_id = (r.result_metadata->>'player_id')::uuid);
    when 'feedback_entry' then available := exists (select from public.feedback_entries where id = r.result_id);
    when 'final_waiver' then available := exists (select from public.final_waivers where obligation_id = r.result_id);
    when 'feedback_correction' then available := exists (select from public.feedback_corrections where id = r.result_id);
    else available := false;
  end case;
  result := jsonb_build_object('type',r.result_type,'version',r.result_version,'exists',available,'metadata',r.result_metadata);
  if r.result_type = 'campaign_coach' then return result || jsonb_build_object('campaignId',r.result_id,'coachId',r.result_metadata->>'coach_id'); end if;
  if r.result_type = 'campaign_player' then return result || jsonb_build_object('campaignId',r.result_id,'playerId',r.result_metadata->>'player_id'); end if;
  return result || jsonb_build_object('id',r.result_id);
end; $$;

create or replace function private.mutate(action text, mutation uuid, input jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); person public.profiles; campaign public.campaigns; campaign_id uuid;
  competition_id uuid; target_profile uuid := (input->>'profile_id')::uuid;
  p jsonb; fingerprint text; receipt public.mutation_receipts; effect jsonb;
begin
  if actor is null then perform private.fail('AUTH_REQUIRED'); end if;
  -- Profile management takes both locks in UUID order. Other actions lock their caller first.
  perform 1 from public.profiles where id = actor or (action in ('update_profile_name','set_profile_access') and id = target_profile) order by id for update;
  select * into person from public.profiles where id = actor;
  if not found or not person.access_enabled then perform private.fail('FORBIDDEN'); end if;
  if mutation is null then perform private.fail('INVALID_INPUT'); end if;
  p := private.normalize_input(input);
  fingerprint := encode(sha256(convert_to(jsonb_build_object('fingerprintVersion',1,'action',action,'input',p)::text,'UTF8')),'hex');
  select * into receipt from public.mutation_receipts where actor_id = actor and mutation_id = mutation;
  if found then
    if receipt.campaign_id is not null then
      if not coalesce(private.can_read_campaign(receipt.campaign_id),false) then perform private.fail('NOT_FOUND'); end if;
    elsif person.role <> 'admin' then perform private.fail('FORBIDDEN'); end if;
    if receipt.action <> action or receipt.request_hash <> fingerprint then perform private.fail('IDEMPOTENCY_CONFLICT'); end if;
    return jsonb_build_object('outcome','already_committed','mutationId',mutation,'result',private.receipt_result(receipt));
  end if;
  if action in ('save_feedback_draft','submit_feedback','discard_feedback_draft') then
    if person.role <> 'coach' then perform private.fail('FORBIDDEN'); end if;
  elsif person.role <> 'admin' then perform private.fail('FORBIDDEN'); end if;
  campaign_id := (p->>'campaign_id')::uuid;
  if action = 'waive_final_obligation' then
    select o.campaign_id into campaign_id from public.final_obligations o where o.id = (p->>'obligation_id')::uuid;
    if not found then perform private.fail('NOT_FOUND'); end if;
  elsif action = 'correct_feedback' then
    select f.campaign_id into campaign_id from public.feedback_entries f where f.id = (p->>'feedback_id')::uuid and f.status = 'submitted';
    if not found then perform private.fail('NOT_FOUND'); end if;
  elsif action = 'discard_feedback_draft' then
    select f.campaign_id into campaign_id from public.feedback_entries f where f.id = (p->>'draft_id')::uuid and f.coach_id = actor and f.status = 'draft';
    if not found then perform private.fail('NOT_FOUND'); end if;
  end if;
  if campaign_id is not null then
    if not coalesce(private.can_read_campaign(campaign_id),false) then perform private.fail('NOT_FOUND'); end if;
    select c.competition_id into competition_id from public.campaigns c where c.id = campaign_id;
    if not found then perform private.fail('NOT_FOUND'); end if;
  else competition_id := (p->>'competition_id')::uuid; end if;
  if competition_id is not null then
    perform 1 from public.competitions where id = competition_id for update;
    if not found then perform private.fail('NOT_FOUND'); end if;
  end if;
  if campaign_id is not null then select * into campaign from public.campaigns where id = campaign_id for update; end if;
  -- Caller lock also serializes all receipt keys for that actor. Recheck after scope locks.
  select * into receipt from public.mutation_receipts where actor_id = actor and mutation_id = mutation;
  if found then
    if receipt.action <> action or receipt.request_hash <> fingerprint then perform private.fail('IDEMPOTENCY_CONFLICT'); end if;
    return jsonb_build_object('outcome','already_committed','mutationId',mutation,'result',private.receipt_result(receipt));
  end if;
  effect := private.apply_action(action,p,campaign);
  if action = 'create_campaign' then campaign_id := (effect->>'id')::uuid; end if;
  insert into public.mutation_receipts(actor_id,mutation_id,action,request_hash,result_type,result_id,result_version,result_metadata,campaign_id)
    values(actor,mutation,action,fingerprint,effect->>'type',(effect->>'id')::uuid,(effect->>'version')::integer,effect->'resultMetadata',campaign_id) returning * into receipt;
  insert into public.audit_events(actor_kind,actor_id,action,target_type,target_id,campaign_id,mutation_id,reason,metadata)
    values('account',actor,action,effect->>'type',(effect->>'id')::uuid,campaign_id,mutation,effect->>'reason',effect->'auditMetadata');
  return jsonb_build_object('outcome','committed','mutationId',mutation,'result',private.receipt_result(receipt));
exception
  when sqlstate 'PT401' or sqlstate 'PT403' or sqlstate 'PT404' or sqlstate 'PT409' or sqlstate 'PT422' then raise;
  when deadlock_detected or serialization_failure then raise;
  when unique_violation then
    if action = 'create_profile' then perform private.fail('PROFILE_EXISTS');
    elsif action in ('create_competition','update_competition','create_campaign','update_campaign_metadata') then perform private.fail('NAME_CONFLICT');
    else perform private.fail('IDEMPOTENCY_CONFLICT'); end if;
    return null;
  when invalid_text_representation or check_violation or not_null_violation or numeric_value_out_of_range or invalid_parameter_value then perform private.fail('INVALID_INPUT'); return null;
  when others then perform private.fail('DATABASE_ERROR'); return null;
end; $$;

create function public.waive_final_obligation(mutation_id uuid, obligation_id uuid, reason text) returns jsonb
language sql security definer set search_path = '' as $$
  select private.mutate('waive_final_obligation',mutation_id,jsonb_build_object('obligation_id',obligation_id,'reason',reason));
$$;
create function public.correct_feedback(mutation_id uuid, feedback_id uuid, content jsonb, reason text, expected_revision integer) returns jsonb
language sql security definer set search_path = '' as $$
  select private.mutate('correct_feedback',mutation_id,jsonb_build_object('feedback_id',feedback_id,'content',content,'reason',reason,'expected_revision',expected_revision));
$$;
create function public.get_campaign_completion(campaign_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare campaign public.campaigns; scoped_coach uuid;
begin
  if auth.uid() is null then perform private.fail('AUTH_REQUIRED'); end if;
  if not coalesce(private.can_read_campaign(campaign_id),false) then perform private.fail('NOT_FOUND'); end if;
  select * into campaign from public.campaigns where id = campaign_id;
  if not found then perform private.fail('NOT_FOUND'); end if;
  scoped_coach := case when private.enabled_role() = 'coach' then auth.uid() else null end;
  return jsonb_build_object('frozen',campaign.requirements_frozen_at is not null,'stage',campaign.stage,
    'scope',case when scoped_coach is null then 'campaign' else 'self' end) || private.completion(campaign_id,scoped_coach);
end; $$;
create function public.list_final_obligations(campaign_id uuid, status_filter text default null, page_cursor jsonb default null, page_size integer default 20)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare rows jsonb; cursor jsonb; scoped_coach uuid;
begin
  if auth.uid() is null then perform private.fail('AUTH_REQUIRED'); end if;
  if not coalesce(private.can_read_campaign(campaign_id),false) or not exists (select from public.campaigns where id = campaign_id) then perform private.fail('NOT_FOUND'); end if;
  if page_size is null or page_size not between 1 and 100 or (status_filter is not null and status_filter not in ('outstanding','submitted','waived')) or
    (page_cursor is not null and (jsonb_typeof(page_cursor) <> 'object' or not page_cursor ?& array['frozenAt','id'] or
      (select count(*) from jsonb_object_keys(page_cursor)) <> 2 or page_cursor->>'frozenAt' is null or page_cursor->>'id' is null))
    then perform private.fail('INVALID_INPUT'); end if;
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
      and (page_cursor is null or (o.frozen_at,o.id) > ((page_cursor->>'frozenAt')::timestamptz,(page_cursor->>'id')::uuid))
    order by o.frozen_at,o.id limit page_size + 1
  ) page;
  if jsonb_array_length(rows) > page_size then
    rows := rows - page_size;
    cursor := jsonb_build_object('frozenAt',rows->(page_size-1)->'frozenAt','id',rows->(page_size-1)->'id');
  end if;
  return jsonb_build_object('items',rows,'nextCursor',cursor);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then perform private.fail('INVALID_INPUT'); return null;
end; $$;
revoke all on function public.waive_final_obligation(uuid,uuid,text),public.correct_feedback(uuid,uuid,jsonb,text,integer),
  public.get_campaign_completion(uuid),public.list_final_obligations(uuid,text,jsonb,integer) from public,anon,authenticated;
grant execute on function public.waive_final_obligation(uuid,uuid,text),public.correct_feedback(uuid,uuid,jsonb,text,integer),
  public.get_campaign_completion(uuid),public.list_final_obligations(uuid,text,jsonb,integer) to authenticated;

-- The caller's policies apply to both the original and the correction lookup.
alter index public.feedback_history rename to feedback_history_order;
create view public.feedback_history with (security_invoker = true) as
select f.id,f.campaign_id,f.competition_id,f.coach_id,f.player_id,f.kind,f.submitted_at,f.observed_on,f.version,
  jsonb_build_object('observations',f.observations,'strengths',f.strengths,'developmentFocus',f.development_focus,'observedOn',f.observed_on) as original,
  case when c.id is null then
    jsonb_build_object('observations',f.observations,'strengths',f.strengths,'developmentFocus',f.development_focus,'observedOn',f.observed_on)
  else jsonb_build_object('observations',c.observations,'strengths',c.strengths,'developmentFocus',c.development_focus,'observedOn',c.observed_on) end as latest,
  coalesce(c.revision,0) as correction_revision,
  case when c.id is not null then 'Admin' else null end as correction_attribution
from public.feedback_entries f
left join lateral (
  select * from public.feedback_corrections where feedback_id = f.id order by revision desc limit 1
) c on true
where f.status = 'submitted';
revoke all on public.feedback_history from public,anon,authenticated;
grant select on public.feedback_history to authenticated;
