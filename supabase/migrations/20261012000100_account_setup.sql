-- Spec 0005. Private durable account setup with caller authorised atomic steps.
create table private.account_setup_operations (
  id uuid primary key default gen_random_uuid(),
  mutation_id uuid not null,
  requested_by uuid not null references public.profiles(id) on delete restrict,
  kind text not null check (kind in ('provision','replace_link')),
  parent_id uuid references private.account_setup_operations(id) on delete restrict,
  display_name text not null check (display_name = btrim(display_name) and char_length(display_name) between 1 and 160),
  intended_role public.account_role not null check (intended_role in ('coach','player')),
  email_fingerprint text not null check (email_fingerprint ~ '^[a-f0-9]{64}$'),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  fingerprint_version integer not null default 1 check (fingerprint_version = 1),
  planned_auth_id uuid not null,
  auth_user_id uuid references auth.users(id) on delete restrict,
  profile_version integer check (profile_version > 0),
  checkpoint text not null default 'planned' check (checkpoint in ('planned','auth_confirmed','profile_created','link_requested','ready')),
  status text not null default 'active' check (status in ('active','needs_reconciliation','blocked')),
  safe_error text check (safe_error in ('PROVIDER_UNAVAILABLE','RECONCILIATION_REQUIRED','EMAIL_EXISTS','OUTCOME_UNKNOWN')),
  setup_generation integer not null default 1 check (setup_generation > 0),
  current_link_operation_id uuid references private.account_setup_operations(id) on delete restrict,
  setup_capability_digest text check (setup_capability_digest ~ '^[a-f0-9]{64}$'),
  email_attempt_id uuid unique,
  email_attempt_generation integer check (email_attempt_generation > 0),
  email_attempt_state text not null default 'not_started' check (email_attempt_state in ('not_started','started','accepted','unknown','failed')),
  email_started_at timestamptz,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default current_timestamp,
  updated_at timestamptz not null default current_timestamp,
  claim_id uuid,
  claim_until timestamptz,
  last_resumed_by uuid references public.profiles(id) on delete restrict,
  password_setup_at timestamptz,
  step_references jsonb not null default '{}' check (jsonb_typeof(step_references) = 'object' and octet_length(step_references::text) <= 8192),
  unique (requested_by,mutation_id),
  check ((kind = 'provision' and parent_id is null) or (kind = 'replace_link' and parent_id is not null)),
  check (auth_user_id is null or auth_user_id = planned_auth_id),
  check ((email_attempt_state = 'not_started' and email_attempt_id is null and email_attempt_generation is null and setup_capability_digest is null and email_started_at is null)
    or (email_attempt_state <> 'not_started' and email_attempt_id is not null and email_attempt_generation is not null and setup_capability_digest is not null and email_started_at is not null)),
  check ((claim_id is null and claim_until is null) or (claim_id is not null and claim_until is not null and last_resumed_by is not null)),
  check (kind = 'provision' or password_setup_at is null)
);
create unique index setup_reserved_email on private.account_setup_operations(email_fingerprint) where kind = 'provision';
create unique index setup_planned_identity on private.account_setup_operations(planned_auth_id) where kind = 'provision';
create index setup_progress_order on private.account_setup_operations(created_at,id);
alter table private.account_setup_operations enable row level security;
revoke all on private.account_setup_operations from public,anon,authenticated,service_role;

create function private.guard_setup_operation() returns trigger language plpgsql set search_path = '' as $$
declare parent private.account_setup_operations;
begin
  if tg_op = 'DELETE' then perform private.fail('IMMUTABLE_RECORD'); end if;
  if new.kind = 'replace_link' then
    select * into parent from private.account_setup_operations where id = new.parent_id;
    if parent.kind is distinct from 'provision' or
      (new.planned_auth_id,new.email_fingerprint,new.display_name,new.intended_role)
      is distinct from (parent.planned_auth_id,parent.email_fingerprint,parent.display_name,parent.intended_role)
      then perform private.fail('INVALID_INPUT'); end if;
  end if;
  if new.current_link_operation_id is not null and new.current_link_operation_id <> new.id and not exists (
    select from private.account_setup_operations where id = new.current_link_operation_id and parent_id = new.id
  ) then perform private.fail('INVALID_INPUT'); end if;
  if tg_op = 'UPDATE' then
    if (new.id,new.mutation_id,new.requested_by,new.kind,new.parent_id,new.display_name,new.intended_role,new.email_fingerprint,new.request_hash,new.fingerprint_version,new.planned_auth_id,new.created_at)
      is distinct from (old.id,old.mutation_id,old.requested_by,old.kind,old.parent_id,old.display_name,old.intended_role,old.email_fingerprint,old.request_hash,old.fingerprint_version,old.planned_auth_id,old.created_at)
      then perform private.fail('IMMUTABLE_RECORD'); end if;
    if old.email_attempt_state <> 'not_started' and
      (new.email_attempt_id,new.email_attempt_generation,new.setup_capability_digest,new.email_started_at)
      is distinct from (old.email_attempt_id,old.email_attempt_generation,old.setup_capability_digest,old.email_started_at)
      then perform private.fail('IMMUTABLE_RECORD'); end if;
    if new.version <> old.version + 1 or new.updated_at <> current_timestamp then perform private.fail('VERSION_CONFLICT'); end if;
  end if;
  return new;
end; $$;
create trigger guard_setup_operation before insert or update or delete on private.account_setup_operations for each row execute function private.guard_setup_operation();

create or replace function private.safe_metadata(value jsonb, action text) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(value) = 'object' and not exists (
    select from jsonb_object_keys(value) as k(key) where key <> all (
      case when action in ('account_setup_started','account_setup_resumed','setup_link_replacement_started','setup_link_requested','password_setup_completed')
      then array['operation_id','parent_id','profile_id','generation','checkpoint','version','safe_code']
      when action in ('save_feedback_draft','discard_feedback_draft','submit_feedback','correct_feedback')
      then array['feedback_id','player_id','coach_id','revision','previous_version','version']
      when action = 'waive_final_obligation' then array['obligation_id','coach_id','player_id','version']
      else array['coach_id','player_id','previous_version','version','before','after','stage','obligations_created','drafts_deleted','required','submitted','waived'] end
    )
  );
$$;
alter table public.audit_events drop constraint audit_events_actor_kind_check;
alter table public.audit_events add constraint audit_events_actor_kind_check check (actor_kind in ('account','user','bootstrap'));
alter table public.audit_events drop constraint audit_events_check;
alter table public.audit_events add constraint audit_events_check check (
  (actor_kind in ('account','user') and actor_id is not null and mutation_id is not null)
  or (actor_kind = 'bootstrap' and actor_id is null and mutation_id is null and action = 'admin_bootstrapped')
);
alter table public.audit_events drop constraint audit_events_action_check;
alter table public.audit_events add constraint audit_events_action_check check (action in (
  'admin_bootstrapped','create_profile','update_profile_name','set_profile_access','create_competition','update_competition','create_campaign','update_campaign_metadata',
  'set_campaign_coach','set_campaign_player','advance_campaign_stage','save_feedback_draft','discard_feedback_draft','submit_feedback','waive_final_obligation','correct_feedback',
  'account_setup_started','account_setup_resumed','setup_link_replacement_started','setup_link_requested','password_setup_completed'
));

create function private.setup_hash(action text, input jsonb) returns text language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(jsonb_build_object('fingerprintVersion',1,'action',action,'input',input)::text,'UTF8')),'hex');
$$;
create function private.setup_admin(actor uuid, target uuid default null) returns void language plpgsql set search_path = '' as $$
begin
  perform 1 from public.profiles where id in (actor,target) order by id for update;
  if not exists (select from public.profiles where id = actor and role = 'admin' and access_enabled) then perform private.fail('FORBIDDEN'); end if;
end; $$;
create function private.setup_progress(operation private.account_setup_operations) returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id',operation.id,'kind',operation.kind,'parentId',operation.parent_id,'displayName',operation.display_name,'role',operation.intended_role,
    'targetId',operation.auth_user_id,'checkpoint',operation.checkpoint,'status',operation.status,'version',operation.version,'safeError',operation.safe_error,
    'generation',operation.setup_generation,'currentLinkOperationId',operation.current_link_operation_id,'emailAttemptState',operation.email_attempt_state,
    'createdAt',operation.created_at,'updatedAt',operation.updated_at,'passwordSetupAt',operation.password_setup_at,
    'accessEnabled',(select access_enabled from public.profiles where id = operation.auth_user_id));
$$;
create function private.setup_reference(receipt public.mutation_receipts, operation private.account_setup_operations, replay boolean) returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('outcome',case when replay then 'already_committed' else 'committed' end,'mutationId',receipt.mutation_id,
    'result',jsonb_build_object('type','account_setup','id',receipt.result_id,'version',receipt.result_version,'exists',true,'metadata',receipt.result_metadata),
    'operation',private.setup_progress(operation));
$$;
create function private.setup_intent(actor uuid, mutation uuid, action text, fingerprint text, operation private.account_setup_operations)
returns public.mutation_receipts language plpgsql set search_path = '' as $$
declare receipt public.mutation_receipts; metadata jsonb := jsonb_build_object('operation_id',operation.id,'generation',operation.setup_generation,'checkpoint',operation.checkpoint,'version',operation.version);
begin
  insert into public.mutation_receipts(actor_id,mutation_id,action,request_hash,result_type,result_id,result_version,result_metadata)
    values(actor,mutation,action,fingerprint,'account_setup',operation.id,operation.version,metadata) returning * into receipt;
  insert into public.audit_events(actor_kind,actor_id,mutation_id,action,target_type,target_id,metadata)
    values('user',actor,mutation,action,'account_setup',operation.id,metadata);
  return receipt;
end; $$;
create function private.setup_replay(actor uuid, mutation uuid, action text, fingerprint text) returns jsonb language plpgsql set search_path = '' as $$
declare receipt public.mutation_receipts; operation private.account_setup_operations;
begin
  if mutation is null then perform private.fail('INVALID_INPUT'); end if;
  select * into receipt from public.mutation_receipts where actor_id = actor and mutation_id = mutation;
  if not found then return null; end if;
  if receipt.action <> action or receipt.request_hash <> fingerprint then perform private.fail('IDEMPOTENCY_CONFLICT'); end if;
  select * into operation from private.account_setup_operations where id = receipt.result_id;
  return private.setup_reference(receipt,operation,true);
end; $$;

create function public.begin_account_setup(mutation_id uuid, display_name text, role public.account_role, email_fingerprint text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); operation private.account_setup_operations; replay jsonb; receipt public.mutation_receipts;
  fingerprint text := private.setup_hash('account_setup_started',jsonb_build_object('display_name',btrim(display_name),'role',role,'email_fingerprint',email_fingerprint));
begin
  if actor is null then perform private.fail('AUTH_REQUIRED'); end if;
  perform private.setup_admin(actor);
  replay := private.setup_replay(actor,mutation_id,'account_setup_started',fingerprint); if replay is not null then return replay; end if;
  perform private.check_name(btrim(display_name));
  if role is null or role not in ('coach','player') or email_fingerprint is null or email_fingerprint !~ '^[a-f0-9]{64}$' then perform private.fail('INVALID_INPUT'); end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(email_fingerprint,0));
  if exists (select from private.account_setup_operations o where o.kind = 'provision' and o.email_fingerprint = begin_account_setup.email_fingerprint) then perform private.fail('SETUP_EXISTS'); end if;
  if exists (select from auth.users u where encode(sha256(convert_to(lower(btrim(u.email)),'UTF8')),'hex') = email_fingerprint) then perform private.fail('EMAIL_EXISTS'); end if;
  insert into private.account_setup_operations(mutation_id,requested_by,kind,display_name,intended_role,email_fingerprint,request_hash,planned_auth_id,claim_id,claim_until,last_resumed_by)
    values(mutation_id,actor,'provision',btrim(display_name),role,email_fingerprint,fingerprint,gen_random_uuid(),gen_random_uuid(),current_timestamp + interval '30 seconds',actor) returning * into operation;
  receipt := private.setup_intent(actor,mutation_id,'account_setup_started',fingerprint,operation);
  return private.setup_reference(receipt,operation,false);
end; $$;

create function public.get_account_setup_progress(operation_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare operation private.account_setup_operations;
begin
  if private.enabled_role() is distinct from 'admin'::public.account_role then perform private.fail('FORBIDDEN'); end if;
  select * into operation from private.account_setup_operations where id = operation_id;
  if not found then perform private.fail('NOT_FOUND'); end if;
  return private.setup_progress(operation);
end; $$;
create function public.list_account_setup_operations(page_cursor jsonb default null,page_size integer default 20) returns jsonb language plpgsql security definer set search_path = '' as $$
declare items jsonb; cursor_time timestamptz; cursor_id uuid; next_cursor jsonb;
begin
  if private.enabled_role() is distinct from 'admin'::public.account_role then perform private.fail('FORBIDDEN'); end if;
  if page_size is null or page_size not between 1 and 100 then perform private.fail('INVALID_INPUT'); end if;
  if page_cursor is not null then
    if jsonb_typeof(page_cursor) <> 'object' or not page_cursor ?& array['createdAt','id'] then perform private.fail('INVALID_INPUT'); end if;
    cursor_time := (page_cursor->>'createdAt')::timestamptz; cursor_id := (page_cursor->>'id')::uuid;
    if cursor_time is null or not isfinite(cursor_time) or cursor_id is null then perform private.fail('INVALID_INPUT'); end if;
  end if;
  select coalesce(jsonb_agg(private.setup_progress(o) order by o.created_at,o.id),'[]') into items from (
    select * from private.account_setup_operations where page_cursor is null or (created_at,id) > (cursor_time,cursor_id) order by created_at,id limit page_size + 1
  ) o;
  if jsonb_array_length(items) > page_size then
    items := items - page_size; next_cursor := jsonb_build_object('createdAt',items->(page_size-1)->>'createdAt','id',items->(page_size-1)->>'id');
  end if;
  return jsonb_build_object('operations',items,'nextCursor',next_cursor);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then perform private.fail('INVALID_INPUT'); return null;
end; $$;

create function public.claim_account_setup(operation_id uuid,mutation_id uuid,expected_version integer) returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); operation private.account_setup_operations; replay jsonb; receipt public.mutation_receipts;
  fingerprint text := private.setup_hash('account_setup_resumed',jsonb_build_object('operation_id',operation_id,'expected_version',expected_version));
begin
  if actor is null then perform private.fail('AUTH_REQUIRED'); end if;
  perform private.setup_admin(actor);
  replay := private.setup_replay(actor,mutation_id,'account_setup_resumed',fingerprint); if replay is not null then return replay; end if;
  select * into operation from private.account_setup_operations where id = operation_id for update;
  if not found then perform private.fail('NOT_FOUND'); end if;
  perform private.check_version(operation.version,expected_version);
  if operation.claim_until > current_timestamp then perform private.fail('OPERATION_BUSY'); end if;
  update private.account_setup_operations set claim_id = gen_random_uuid(),claim_until = current_timestamp + interval '30 seconds',last_resumed_by = actor,
    email_attempt_state = case when email_attempt_state = 'started' then 'unknown' else email_attempt_state end,
    status = case when email_attempt_state = 'started' then 'needs_reconciliation' else status end,
    safe_error = case when email_attempt_state = 'started' then 'OUTCOME_UNKNOWN' else safe_error end,
    version = version + 1,updated_at = current_timestamp where id = operation_id returning * into operation;
  receipt := private.setup_intent(actor,mutation_id,'account_setup_resumed',fingerprint,operation);
  return private.setup_reference(receipt,operation,false);
end; $$;

create function private.setup_identity(operation private.account_setup_operations) returns void language plpgsql set search_path = '' as $$
declare root uuid := coalesce(operation.parent_id,operation.id);
begin
  if not exists (select from auth.users u where u.id = operation.planned_auth_id and u.raw_app_meta_data->>'sfda_setup_operation_id' = root::text
    and encode(sha256(convert_to(lower(btrim(u.email)),'UTF8')),'hex') = operation.email_fingerprint) then perform private.fail('RECONCILIATION_REQUIRED'); end if;
end; $$;
create function private.setup_lock(operation_id uuid,actor_id uuid) returns private.account_setup_operations language plpgsql set search_path = '' as $$
declare operation private.account_setup_operations;
begin
  select * into operation from private.account_setup_operations where id = operation_id;
  if not found then perform private.fail('NOT_FOUND'); end if;
  perform private.setup_admin(actor_id,operation.auth_user_id);
  if operation.parent_id is not null then perform 1 from private.account_setup_operations where id = operation.parent_id for update; end if;
  select * into operation from private.account_setup_operations where id = operation_id for update;
  return operation;
end; $$;

create function public.begin_setup_link_replacement(parent_id uuid,mutation_id uuid,expected_version integer) returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); parent private.account_setup_operations; child private.account_setup_operations; person public.profiles; replay jsonb; receipt public.mutation_receipts;
  fingerprint text := private.setup_hash('setup_link_replacement_started',jsonb_build_object('parent_id',parent_id,'expected_version',expected_version));
begin
  if actor is null then perform private.fail('AUTH_REQUIRED'); end if;
  perform private.setup_admin(actor);
  replay := private.setup_replay(actor,mutation_id,'setup_link_replacement_started',fingerprint); if replay is not null then return replay; end if;
  parent := private.setup_lock(parent_id,actor);
  perform private.check_version(parent.version,expected_version);
  if parent.kind <> 'provision' then perform private.fail('INVALID_INPUT'); end if;
  perform private.setup_identity(parent);
  select * into person from public.profiles where id = parent.auth_user_id;
  if parent.checkpoint = 'ready' then
    if not person.access_enabled then perform private.fail('ACCOUNT_DISABLED'); end if;
  elsif parent.checkpoint = 'profile_created' then
    if person.access_enabled or person.version is distinct from parent.profile_version then perform private.fail('RECONCILIATION_REQUIRED'); end if;
  else perform private.fail('RECONCILIATION_REQUIRED'); end if;
  insert into private.account_setup_operations(mutation_id,requested_by,kind,parent_id,display_name,intended_role,email_fingerprint,request_hash,planned_auth_id,auth_user_id,profile_version,setup_generation,claim_id,claim_until,last_resumed_by)
    values(mutation_id,actor,'replace_link',parent.id,parent.display_name,parent.intended_role,parent.email_fingerprint,fingerprint,parent.planned_auth_id,parent.auth_user_id,parent.profile_version,parent.setup_generation+1,
      gen_random_uuid(),current_timestamp+interval '30 seconds',actor) returning * into child;
  update private.account_setup_operations set setup_generation = setup_generation+1,current_link_operation_id = child.id,claim_id = null,claim_until = null,version = version+1,updated_at = current_timestamp where id = parent.id;
  receipt := private.setup_intent(actor,mutation_id,'setup_link_replacement_started',fingerprint,child);
  return private.setup_reference(receipt,child,false);
end; $$;

create function public.create_account_setup_profile(operation_id uuid,expected_version integer) returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); operation private.account_setup_operations; step uuid := gen_random_uuid(); result jsonb;
begin
  if actor is null then perform private.fail('AUTH_REQUIRED'); end if;
  operation := private.setup_lock(operation_id,actor);
  if operation.step_references ? 'profile' then return jsonb_build_object('reference',operation.step_references->'profile','operation',private.setup_progress(operation)); end if;
  perform private.check_version(operation.version,expected_version);
  if operation.kind <> 'provision' or operation.checkpoint <> 'auth_confirmed' then perform private.fail('RECONCILIATION_REQUIRED'); end if;
  perform private.setup_identity(operation);
  if exists(select from public.profiles where id = operation.planned_auth_id) then perform private.fail('RECONCILIATION_REQUIRED'); end if;
  result := private.mutate('create_profile',step,jsonb_build_object('profile_id',operation.planned_auth_id,'display_name',operation.display_name,'role',operation.intended_role));
  update private.account_setup_operations set checkpoint = 'profile_created',profile_version = 1,
    step_references = step_references || jsonb_build_object('profile',jsonb_build_object('actorId',actor,'mutationId',step,'result',result)),
    version = version+1,updated_at = current_timestamp where id = operation.id returning * into operation;
  return jsonb_build_object('reference',operation.step_references->'profile','operation',private.setup_progress(operation));
end; $$;

create function private.guard_initial_account_access() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.access_enabled and not old.access_enabled and exists (
    select from private.account_setup_operations where kind = 'provision' and planned_auth_id = new.id and checkpoint <> 'ready'
  ) then perform private.fail('ACCOUNT_SETUP_PENDING'); end if;
  return new;
end; $$;
create trigger guard_initial_account_access before update on public.profiles for each row execute function private.guard_initial_account_access();

create function public.complete_account_setup(operation_id uuid,expected_version integer) returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); operation private.account_setup_operations; root private.account_setup_operations; person public.profiles; step uuid := gen_random_uuid(); result jsonb;
begin
  if actor is null then perform private.fail('AUTH_REQUIRED'); end if;
  operation := private.setup_lock(operation_id,actor);
  if operation.kind = 'replace_link' then select * into root from private.account_setup_operations where id = operation.parent_id; else root := operation; end if;
  if root.checkpoint = 'ready' then
    if operation.kind = 'replace_link' and operation.email_attempt_state = 'accepted' and operation.checkpoint <> 'ready' then
      update private.account_setup_operations set checkpoint = 'ready',claim_id = null,claim_until = null,version = version+1,updated_at = current_timestamp where id = operation.id returning * into operation;
    end if;
    return jsonb_build_object('reference',root.step_references->'activation','operation',private.setup_progress(operation));
  end if;
  perform private.check_version(operation.version,expected_version);
  if root.checkpoint <> 'link_requested' or operation.email_attempt_state <> 'accepted' or root.current_link_operation_id is distinct from operation.id
    or root.setup_generation <> operation.email_attempt_generation then perform private.fail('RECONCILIATION_REQUIRED'); end if;
  perform private.setup_identity(root);
  select * into person from public.profiles where id = root.auth_user_id;
  if person.id is null or person.access_enabled or person.version is distinct from root.profile_version or person.role <> root.intended_role or person.display_name <> root.display_name
    then perform private.fail('RECONCILIATION_REQUIRED'); end if;
  update private.account_setup_operations set checkpoint = 'ready',version = version+1,updated_at = current_timestamp where id = root.id;
  result := private.mutate('set_profile_access',step,jsonb_build_object('profile_id',person.id,'enabled',true,'expected_version',person.version,'reason','Initial account setup completed'));
  update private.account_setup_operations set step_references = step_references || jsonb_build_object('activation',jsonb_build_object('actorId',actor,'mutationId',step,'result',result)),
    claim_id = null,claim_until = null,version = version+1,updated_at = current_timestamp where id = root.id returning * into root;
  if operation.kind = 'replace_link' then
    update private.account_setup_operations set checkpoint = 'ready',claim_id = null,claim_until = null,version = version+1,updated_at = current_timestamp where id = operation.id returning * into operation;
  else operation := root; end if;
  return jsonb_build_object('reference',root.step_references->'activation','operation',private.setup_progress(operation));
end; $$;

-- Service observations contain no raw email. The Worker verifies the actual admin first.
create function public.lookup_setup_auth_identity(email_fingerprint text default null,planned_id uuid default null) returns jsonb language plpgsql security definer set search_path = '' as $$
declare person auth.users; operation private.account_setup_operations; profile public.profiles;
begin
  if email_fingerprint is not null and email_fingerprint !~ '^[a-f0-9]{64}$' then perform private.fail('INVALID_INPUT'); end if;
  select * into operation from private.account_setup_operations o where o.kind = 'provision' and o.email_fingerprint = lookup_setup_auth_identity.email_fingerprint;
  select * into person from auth.users u where (planned_id is not null and u.id = planned_id) or
    (planned_id is null and encode(sha256(convert_to(lower(btrim(u.email)),'UTF8')),'hex') = email_fingerprint) limit 1;
  select * into profile from public.profiles where id = person.id;
  return jsonb_build_object('authId',person.id,'operationId',operation.id,'operationVersion',operation.version,
    'profile',case when profile.id is null then null else jsonb_build_object('id',profile.id,'displayName',profile.display_name,'role',profile.role,'accessEnabled',profile.access_enabled,'version',profile.version) end);
end; $$;
create function public.get_worker_account_setup(operation_id uuid,actor_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare operation private.account_setup_operations;
begin
  if not exists(select from public.profiles where id = actor_id and role = 'admin' and access_enabled) then perform private.fail('FORBIDDEN'); end if;
  select * into operation from private.account_setup_operations where id = operation_id;
  if not found then perform private.fail('NOT_FOUND'); end if;
  if operation.last_resumed_by is distinct from actor_id then perform private.fail('FORBIDDEN'); end if;
  return to_jsonb(operation);
end; $$;
create function public.renew_account_setup_claim(operation_id uuid,actor_id uuid,claim_id uuid,expected_version integer) returns jsonb language plpgsql security definer set search_path = '' as $$
declare operation private.account_setup_operations;
begin
  operation := private.setup_lock(operation_id,actor_id);
  perform private.check_version(operation.version,expected_version);
  if operation.claim_id is distinct from claim_id or operation.last_resumed_by is distinct from actor_id or operation.claim_until <= current_timestamp then perform private.fail('OPERATION_BUSY'); end if;
  update private.account_setup_operations set claim_until = current_timestamp+interval '30 seconds',version = version+1,updated_at = current_timestamp where id = operation.id returning * into operation;
  return to_jsonb(operation);
end; $$;
create function public.record_account_setup_step(operation_id uuid,actor_id uuid,claim_id uuid,expected_version integer,step text,
  capability_digest text default null,attempt_id uuid default null,attempt_generation integer default null,safe_code text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare operation private.account_setup_operations; root private.account_setup_operations;
begin
  operation := private.setup_lock(operation_id,actor_id);
  perform private.check_version(operation.version,expected_version);
  if operation.claim_id is distinct from claim_id or operation.last_resumed_by is distinct from actor_id or operation.claim_until <= current_timestamp then perform private.fail('OPERATION_BUSY'); end if;
  if operation.parent_id is null then root := operation; else select * into root from private.account_setup_operations where id = operation.parent_id; end if;
  if root.setup_generation <> operation.setup_generation then perform private.fail('RECONCILIATION_REQUIRED'); end if;
  if step = 'auth_confirmed' then
    if operation.kind <> 'provision' or operation.checkpoint <> 'planned' then perform private.fail('RECONCILIATION_REQUIRED'); end if;
    perform private.setup_identity(operation);
    update private.account_setup_operations set auth_user_id = planned_auth_id,checkpoint = 'auth_confirmed',status = 'active',safe_error = null,version = version+1,updated_at = current_timestamp where id = operation.id;
  elsif step = 'email_started' then
    perform private.setup_identity(operation);
    if operation.email_attempt_state <> 'not_started' or (operation.kind = 'provision' and operation.checkpoint <> 'profile_created')
      or (operation.kind = 'replace_link' and root.current_link_operation_id is distinct from operation.id)
      or capability_digest is null or capability_digest !~ '^[a-f0-9]{64}$' then perform private.fail('RECONCILIATION_REQUIRED'); end if;
    update private.account_setup_operations set email_attempt_id = gen_random_uuid(),email_attempt_generation = setup_generation,setup_capability_digest = capability_digest,email_started_at = current_timestamp,
      email_attempt_state = 'started',current_link_operation_id = case when kind = 'provision' then id else null end,version = version+1,updated_at = current_timestamp where id = operation.id;
  elsif step in ('email_accepted','email_unknown','email_failed') then
    if operation.email_attempt_state <> 'started' or operation.email_attempt_id is distinct from attempt_id or operation.email_attempt_generation is distinct from attempt_generation
      or root.setup_generation <> attempt_generation or root.current_link_operation_id is distinct from operation.id then perform private.fail('RECONCILIATION_REQUIRED'); end if;
    update private.account_setup_operations set email_attempt_state = case step when 'email_accepted' then 'accepted' when 'email_unknown' then 'unknown' else 'failed' end,
      checkpoint = case when step = 'email_accepted' then 'link_requested' else checkpoint end,
      status = case when step = 'email_accepted' then 'active' else 'needs_reconciliation' end,
      safe_error = case when step = 'email_accepted' then null when step = 'email_unknown' then 'OUTCOME_UNKNOWN' else 'PROVIDER_UNAVAILABLE' end,
      version = version+1,updated_at = current_timestamp where id = operation.id;
    if step = 'email_accepted' then
      if operation.parent_id is not null and root.checkpoint = 'profile_created' then
        update private.account_setup_operations set checkpoint = 'link_requested',version = version+1,updated_at = current_timestamp where id = root.id;
      end if;
      insert into public.audit_events(actor_kind,actor_id,mutation_id,action,target_type,target_id,metadata)
        values('user',actor_id,operation.email_attempt_id,'setup_link_requested','account_setup',operation.id,
          jsonb_build_object('operation_id',operation.id,'generation',operation.email_attempt_generation,'checkpoint','link_requested'));
    end if;
  elsif step = 'blocked' then
    if safe_code is null or safe_code not in ('PROVIDER_UNAVAILABLE','RECONCILIATION_REQUIRED','EMAIL_EXISTS','OUTCOME_UNKNOWN') then perform private.fail('INVALID_INPUT'); end if;
    update private.account_setup_operations set status = 'needs_reconciliation',safe_error = safe_code,claim_id = null,claim_until = null,version = version+1,updated_at = current_timestamp where id = operation.id;
  else perform private.fail('INVALID_INPUT'); end if;
  select * into operation from private.account_setup_operations where id = operation_id;
  return to_jsonb(operation);
end; $$;
create function public.get_password_setup_context(operation_id uuid,generation integer,capability_digest text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare operation private.account_setup_operations; root private.account_setup_operations;
begin
  select * into operation from private.account_setup_operations where id = operation_id;
  if not found then perform private.fail('LINK_INVALID'); end if;
  select * into root from private.account_setup_operations where id = coalesce(operation.parent_id,operation.id);
  if root.current_link_operation_id is distinct from operation.id or root.setup_generation is distinct from generation or operation.email_attempt_generation is distinct from generation
    or operation.email_attempt_state <> 'accepted' or operation.setup_capability_digest is distinct from capability_digest then perform private.fail('LINK_INVALID'); end if;
  if root.checkpoint <> 'ready' or not exists(select from public.profiles where id = root.auth_user_id and access_enabled) then perform private.fail('ACCOUNT_NOT_READY'); end if;
  return jsonb_build_object('targetId',root.auth_user_id,'parentId',root.id,'operationId',operation.id,'generation',generation);
end; $$;
create function public.record_password_setup_result(operation_id uuid,generation integer,capability_digest text,target_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare operation private.account_setup_operations; root private.account_setup_operations; context jsonb;
begin
  select * into operation from private.account_setup_operations where id = operation_id;
  if not found then perform private.fail('LINK_INVALID'); end if;
  perform 1 from public.profiles where id = target_id for update;
  select * into root from private.account_setup_operations where id = coalesce(operation.parent_id,operation.id) for update;
  if operation.parent_id is not null then select * into operation from private.account_setup_operations where id = operation_id for update; else operation := root; end if;
  context := public.get_password_setup_context(operation_id,generation,capability_digest);
  if (context->>'targetId')::uuid is distinct from target_id then perform private.fail('LINK_INVALID'); end if;
  if not exists(select from public.audit_events where actor_id = target_id and mutation_id = operation.email_attempt_id and action = 'password_setup_completed') then
    update private.account_setup_operations set password_setup_at = current_timestamp,version = version+1,updated_at = current_timestamp where id = root.id;
    insert into public.audit_events(actor_kind,actor_id,mutation_id,action,target_type,target_id,metadata)
      values('user',target_id,operation.email_attempt_id,'password_setup_completed','account_setup',operation.id,
        jsonb_build_object('operation_id',operation.id,'parent_id',root.id,'profile_id',target_id,'generation',generation));
  end if;
  return jsonb_build_object('outcome','password_set');
end; $$;

-- Expose only named functions. No caller can supply a provider success or read claims.
revoke all on all functions in schema private from public,anon,authenticated,service_role;
grant execute on function private.enabled_role(),private.can_read_campaign(uuid),private.can_read_profile(uuid) to authenticated;
revoke all on function public.begin_account_setup(uuid,text,public.account_role,text),public.get_account_setup_progress(uuid),public.list_account_setup_operations(jsonb,integer),
  public.claim_account_setup(uuid,uuid,integer),public.begin_setup_link_replacement(uuid,uuid,integer),public.create_account_setup_profile(uuid,integer),public.complete_account_setup(uuid,integer)
  from public,anon,service_role;
grant execute on function public.begin_account_setup(uuid,text,public.account_role,text),public.get_account_setup_progress(uuid),public.list_account_setup_operations(jsonb,integer),
  public.claim_account_setup(uuid,uuid,integer),public.begin_setup_link_replacement(uuid,uuid,integer),public.create_account_setup_profile(uuid,integer),public.complete_account_setup(uuid,integer) to authenticated;
revoke all on function public.lookup_setup_auth_identity(text,uuid),public.get_worker_account_setup(uuid,uuid),public.renew_account_setup_claim(uuid,uuid,uuid,integer),
  public.record_account_setup_step(uuid,uuid,uuid,integer,text,text,uuid,integer,text),public.get_password_setup_context(uuid,integer,text),public.record_password_setup_result(uuid,integer,text,uuid) from public,anon,authenticated;
grant execute on function public.lookup_setup_auth_identity(text,uuid),public.get_worker_account_setup(uuid,uuid),public.renew_account_setup_claim(uuid,uuid,uuid,integer),
  public.record_account_setup_step(uuid,uuid,uuid,integer,text,text,uuid,integer,text),public.get_password_setup_context(uuid,integer,text),public.record_password_setup_result(uuid,integer,text,uuid) to service_role;
