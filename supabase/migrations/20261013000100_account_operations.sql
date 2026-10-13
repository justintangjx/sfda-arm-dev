-- Spec 0006. One current password link per account, a private recovery journal and account maintenance guards.
create type private.password_link_kind as enum ('setup','recovery');
create type private.recovery_source as enum ('self_service','admin');
create type private.recovery_status as enum ('reserved','started','accepted','unknown','failed','password_changed');
create type private.recovery_reason as enum ('requested_by_account_owner','link_missing_or_expired','after_access_restoration');
create type private.recovery_error as enum ('PROVIDER_REJECTED','PROVIDER_UNAVAILABLE','IDENTITY_CHANGED','OUTCOME_UNKNOWN','SESSION_REVOCATION_UNKNOWN','SUPERSEDED');

alter table private.account_setup_operations add column account_link_revision bigint check (account_link_revision > 0);
alter table private.account_setup_operations add constraint setup_link_target unique (id,planned_auth_id);

create table private.password_recovery_operations (
  id uuid primary key default gen_random_uuid(),
  target_profile_id uuid not null references public.profiles(id) on delete restrict,
  request_id uuid not null,
  source private.recovery_source not null,
  requested_by uuid references public.profiles(id) on delete restrict,
  reason private.recovery_reason,
  email_fingerprint text not null check (email_fingerprint ~ '^[a-f0-9]{64}$'),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  fingerprint_version integer not null default 1 check (fingerprint_version = 1),
  link_revision bigint not null check (link_revision > 0),
  status private.recovery_status not null default 'reserved',
  capability_digest text check (capability_digest ~ '^[a-f0-9]{64}$'),
  email_attempt_id uuid unique,
  email_started_at timestamptz,
  password_changed_at timestamptz,
  refresh_revoked_at timestamptz,
  safe_error private.recovery_error,
  claim_id uuid,
  claim_until timestamptz,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default current_timestamp,
  updated_at timestamptz not null default current_timestamp,
  unique (id,target_profile_id),
  unique (target_profile_id,link_revision),
  check ((source = 'self_service' and requested_by is null and reason is null) or (source = 'admin' and requested_by is not null and reason is not null)),
  check ((capability_digest is null and email_attempt_id is null and email_started_at is null)
    or (capability_digest is not null and email_attempt_id is not null and email_started_at is not null)),
  check (status <> 'reserved' or email_attempt_id is null),
  check (status in ('reserved','failed') or email_attempt_id is not null),
  check ((status = 'password_changed') = (password_changed_at is not null)),
  check (refresh_revoked_at is null or password_changed_at is not null),
  check ((claim_id is null) = (claim_until is null))
);
create unique index recovery_public_request on private.password_recovery_operations(request_id) where source = 'self_service';
create unique index recovery_admin_request on private.password_recovery_operations(requested_by,request_id) where source = 'admin';
create index recovery_order on private.password_recovery_operations(created_at,id);
create index recovery_target on private.password_recovery_operations(target_profile_id,created_at,id);
create index recovery_requester on private.password_recovery_operations(requested_by);
alter table private.password_recovery_operations enable row level security;
revoke all on private.password_recovery_operations from public,anon,authenticated,service_role;

create function private.guard_recovery_operation() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then perform private.fail('IMMUTABLE_RECORD'); end if;
  if tg_op = 'UPDATE' then
    if (new.id,new.target_profile_id,new.request_id,new.source,new.requested_by,new.reason,new.email_fingerprint,new.request_hash,new.fingerprint_version,new.link_revision,new.created_at)
      is distinct from (old.id,old.target_profile_id,old.request_id,old.source,old.requested_by,old.reason,old.email_fingerprint,old.request_hash,old.fingerprint_version,old.link_revision,old.created_at)
      then perform private.fail('IMMUTABLE_RECORD'); end if;
    if old.email_attempt_id is not null and (new.capability_digest,new.email_attempt_id,new.email_started_at) is distinct from (old.capability_digest,old.email_attempt_id,old.email_started_at)
      then perform private.fail('IMMUTABLE_RECORD'); end if;
    if (old.password_changed_at is not null and new.password_changed_at is distinct from old.password_changed_at)
      or (old.refresh_revoked_at is not null and new.refresh_revoked_at is distinct from old.refresh_revoked_at) then perform private.fail('IMMUTABLE_RECORD'); end if;
    if new.status <> old.status and not (
      (old.status = 'reserved' and new.status in ('started','failed'))
      or (old.status = 'started' and new.status in ('accepted','unknown','failed','password_changed'))
      or (old.status in ('accepted','unknown') and new.status = 'password_changed')
    ) then perform private.fail('RECONCILIATION_REQUIRED'); end if;
    if new.version <> old.version + 1 or new.updated_at <> current_timestamp then perform private.fail('VERSION_CONFLICT'); end if;
  end if;
  return new;
end; $$;
create trigger guard_recovery_operation before insert or update or delete on private.password_recovery_operations for each row execute function private.guard_recovery_operation();

create table private.account_password_state (
  profile_id uuid primary key references public.profiles(id) on delete restrict,
  revision bigint not null default 1 check (revision > 0),
  current_link_kind private.password_link_kind,
  setup_operation_id uuid,
  recovery_operation_id uuid,
  password_initialized_at timestamptz,
  next_email_allowed_at timestamptz,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default current_timestamp,
  updated_at timestamptz not null default current_timestamp,
  -- Deferred so a reservation can point the head at the operation inserted next in the same transaction.
  foreign key (setup_operation_id,profile_id) references private.account_setup_operations(id,planned_auth_id) deferrable initially deferred,
  foreign key (recovery_operation_id,profile_id) references private.password_recovery_operations(id,target_profile_id) deferrable initially deferred,
  check ((current_link_kind is null and setup_operation_id is null and recovery_operation_id is null)
    or (current_link_kind = 'setup' and setup_operation_id is not null and recovery_operation_id is null)
    or (current_link_kind = 'recovery' and recovery_operation_id is not null and setup_operation_id is null))
);
alter table private.account_password_state enable row level security;
revoke all on private.account_password_state from public,anon,authenticated,service_role;

create function private.guard_password_state() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then perform private.fail('IMMUTABLE_RECORD'); end if;
  if tg_op = 'UPDATE' then
    if (new.profile_id,new.created_at) is distinct from (old.profile_id,old.created_at) then perform private.fail('IMMUTABLE_RECORD'); end if;
    if new.revision not in (old.revision,old.revision + 1) then perform private.fail('VERSION_CONFLICT'); end if;
    if (new.current_link_kind,new.setup_operation_id,new.recovery_operation_id) is distinct from (old.current_link_kind,old.setup_operation_id,old.recovery_operation_id)
      and new.revision <> old.revision + 1 then perform private.fail('VERSION_CONFLICT'); end if;
    if old.password_initialized_at is not null and new.password_initialized_at is distinct from old.password_initialized_at then perform private.fail('IMMUTABLE_RECORD'); end if;
    if old.next_email_allowed_at is not null and (new.next_email_allowed_at is null or new.next_email_allowed_at < old.next_email_allowed_at)
      then perform private.fail('IMMUTABLE_RECORD'); end if;
    if new.version <> old.version + 1 or new.updated_at <> current_timestamp then perform private.fail('VERSION_CONFLICT'); end if;
  end if;
  return new;
end; $$;
create trigger guard_password_state before insert or update or delete on private.account_password_state for each row execute function private.guard_password_state();

create function private.create_password_state() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into private.account_password_state(profile_id) values(new.id) on conflict (profile_id) do nothing;
  return null;
end; $$;
create trigger create_password_state after insert on public.profiles for each row execute function private.create_password_state();

-- Earlier setup URLs become invalid: every account starts at revision 1 with no current link.
insert into private.account_password_state(profile_id,password_initialized_at,next_email_allowed_at)
select p.id,
  (select max(o.password_setup_at) from private.account_setup_operations o where o.kind = 'provision' and o.planned_auth_id = p.id),
  (select max(o.email_started_at) + interval '60 seconds' from private.account_setup_operations o where o.planned_auth_id = p.id)
from public.profiles p
on conflict (profile_id) do nothing;

-- The link module. These functions are the only writers of account_password_state after creation.
create function private.link_state(target uuid) returns private.account_password_state language plpgsql set search_path = '' as $$
declare state private.account_password_state;
begin
  select * into state from private.account_password_state s where s.profile_id = target for update;
  if not found then perform private.fail('NOT_FOUND'); end if;
  return state;
end; $$;
create function private.link_current(target uuid,link_kind private.password_link_kind,link_operation uuid,expected_revision bigint) returns boolean
language sql stable set search_path = '' as $$
  select exists(select from private.account_password_state s where s.profile_id = target and s.revision = expected_revision and s.current_link_kind = link_kind
    and (case when link_kind = 'setup' then s.setup_operation_id else s.recovery_operation_id end) = link_operation);
$$;
create function private.link_reserve(target uuid,link_kind private.password_link_kind,link_operation uuid) returns bigint language plpgsql set search_path = '' as $$
declare state private.account_password_state := private.link_state(target);
begin
  if state.next_email_allowed_at > current_timestamp then return null; end if;
  update private.account_password_state s set revision = s.revision + 1,current_link_kind = link_kind,
    setup_operation_id = case when link_kind = 'setup' then link_operation end,
    recovery_operation_id = case when link_kind = 'recovery' then link_operation end,
    next_email_allowed_at = current_timestamp + interval '60 seconds',version = s.version + 1,updated_at = current_timestamp
    where s.profile_id = target returning * into state;
  return state.revision;
end; $$;
create function private.link_start(target uuid,link_kind private.password_link_kind,link_operation uuid,expected_revision bigint) returns boolean language plpgsql set search_path = '' as $$
begin
  perform private.link_state(target);
  if not private.link_current(target,link_kind,link_operation,expected_revision) then return false; end if;
  update private.account_password_state s set next_email_allowed_at = greatest(s.next_email_allowed_at,current_timestamp + interval '60 seconds'),
    version = s.version + 1,updated_at = current_timestamp where s.profile_id = target;
  return true;
end; $$;
-- Without a kind the head is cleared unconditionally. With one, only that exact current link is consumed.
create function private.link_clear(target uuid,link_kind private.password_link_kind default null,link_operation uuid default null) returns boolean language plpgsql set search_path = '' as $$
declare state private.account_password_state := private.link_state(target);
begin
  if link_kind is not null and (state.current_link_kind is distinct from link_kind
    or (case when link_kind = 'setup' then state.setup_operation_id else state.recovery_operation_id end) is distinct from link_operation) then return false; end if;
  update private.account_password_state s set revision = s.revision + 1,current_link_kind = null,setup_operation_id = null,recovery_operation_id = null,
    version = s.version + 1,updated_at = current_timestamp where s.profile_id = target;
  return true;
end; $$;
create function private.link_initialize(target uuid) returns void language plpgsql set search_path = '' as $$
begin
  perform private.link_state(target);
  update private.account_password_state s set password_initialized_at = current_timestamp,version = s.version + 1,updated_at = current_timestamp
    where s.profile_id = target and s.password_initialized_at is null;
end; $$;

create function private.auth_fingerprint(user_id uuid) returns text language sql stable set search_path = '' as $$
  select encode(sha256(convert_to(lower(btrim(u.email)),'UTF8')),'hex') from auth.users u where u.id = user_id;
$$;
create function private.derived_id(source uuid,purpose text) returns uuid language sql immutable set search_path = '' as $$
  select md5(source::text || ':' || purpose)::uuid;
$$;
create function private.setup_pending(target uuid) returns boolean language sql stable set search_path = '' as $$
  select exists(select from private.account_setup_operations o where o.kind = 'provision' and o.planned_auth_id = target and o.checkpoint <> 'ready');
$$;
create function private.account_setup_status(target uuid) returns text language sql stable set search_path = '' as $$
  select case when p.role = 'admin' then 'not_applicable' when o.id is null then 'not_tracked' when o.checkpoint = 'ready' then 'ready'
    when o.status <> 'active' then 'needs_reconciliation' else 'pending' end
  from public.profiles p left join private.account_setup_operations o on o.kind = 'provision' and o.planned_auth_id = p.id where p.id = target;
$$;
-- Null means eligible for recovery. Codes are internal; public callers never see them.
create function private.recovery_block(target uuid) returns text language sql stable set search_path = '' as $$
  select case when p.id is null then 'NOT_FOUND' when not p.access_enabled then 'ACCOUNT_DISABLED'
    when u.email_confirmed_at is null or s.password_initialized_at is null or private.setup_pending(p.id) then 'ACCOUNT_NOT_READY' end
  from (select target as id) t left join public.profiles p on p.id = t.id left join auth.users u on u.id = t.id left join private.account_password_state s on s.profile_id = t.id;
$$;

-- Setup rewiring. Same signatures as 0005, plus the shared head.
create or replace function private.guard_setup_operation() returns trigger language plpgsql set search_path = '' as $$
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
    if old.account_link_revision is not null and new.account_link_revision is distinct from old.account_link_revision then perform private.fail('IMMUTABLE_RECORD'); end if;
    if new.version <> old.version + 1 or new.updated_at <> current_timestamp then perform private.fail('VERSION_CONFLICT'); end if;
  end if;
  return new;
end; $$;

create or replace function private.setup_progress(operation private.account_setup_operations) returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id',operation.id,'kind',operation.kind,'parentId',operation.parent_id,'displayName',operation.display_name,'role',operation.intended_role,
    'targetId',operation.auth_user_id,'checkpoint',operation.checkpoint,'status',operation.status,'version',operation.version,'safeError',operation.safe_error,
    'generation',operation.setup_generation,'currentLinkOperationId',operation.current_link_operation_id,'emailAttemptState',operation.email_attempt_state,
    'createdAt',operation.created_at,'updatedAt',operation.updated_at,'passwordSetupAt',operation.password_setup_at,
    'accessEnabled',(select access_enabled from public.profiles where id = operation.auth_user_id),
    'currentLink',operation.account_link_revision is not null and private.link_current(operation.planned_auth_id,'setup',operation.id,operation.account_link_revision));
$$;

create or replace function public.begin_setup_link_replacement(parent_id uuid,mutation_id uuid,expected_version integer) returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); parent private.account_setup_operations; child private.account_setup_operations; person public.profiles; replay jsonb; receipt public.mutation_receipts;
  child_id uuid := gen_random_uuid(); revision bigint;
  fingerprint text := private.setup_hash('setup_link_replacement_started',jsonb_build_object('parent_id',parent_id,'expected_version',expected_version));
begin
  if actor is null then perform private.fail('AUTH_REQUIRED'); end if;
  parent := private.setup_lock(parent_id,actor);
  replay := private.setup_replay(actor,mutation_id,'setup_link_replacement_started',fingerprint); if replay is not null then return replay; end if;
  perform private.check_version(parent.version,expected_version);
  if parent.kind <> 'provision' then perform private.fail('INVALID_INPUT'); end if;
  perform private.setup_identity(parent);
  select * into person from public.profiles where id = parent.auth_user_id;
  if parent.checkpoint = 'ready' then
    if not person.access_enabled then perform private.fail('ACCOUNT_DISABLED'); end if;
  elsif parent.checkpoint = 'profile_created' then
    if person.access_enabled or person.version is distinct from parent.profile_version then perform private.fail('RECONCILIATION_REQUIRED'); end if;
  else perform private.fail('RECONCILIATION_REQUIRED'); end if;
  revision := private.link_reserve(parent.auth_user_id,'setup',child_id);
  if revision is null then perform private.fail('EMAIL_COOLDOWN'); end if;
  insert into private.account_setup_operations(id,mutation_id,requested_by,kind,parent_id,display_name,intended_role,email_fingerprint,request_hash,planned_auth_id,auth_user_id,profile_version,setup_generation,
    claim_id,claim_until,last_resumed_by,account_link_revision)
    values(child_id,mutation_id,actor,'replace_link',parent.id,parent.display_name,parent.intended_role,parent.email_fingerprint,fingerprint,parent.planned_auth_id,parent.auth_user_id,parent.profile_version,parent.setup_generation+1,
      gen_random_uuid(),current_timestamp+interval '30 seconds',actor,revision) returning * into child;
  update private.account_setup_operations set setup_generation = setup_generation+1,current_link_operation_id = child.id,claim_id = null,claim_until = null,version = version+1,updated_at = current_timestamp where id = parent.id;
  receipt := private.setup_intent(actor,mutation_id,'setup_link_replacement_started',fingerprint,child);
  return private.setup_reference(receipt,child,false);
end; $$;

create or replace function public.record_account_setup_step(operation_id uuid,actor_id uuid,claim_id uuid,expected_version integer,step text,
  capability_digest text default null,attempt_id uuid default null,attempt_generation integer default null,safe_code text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare operation private.account_setup_operations; root private.account_setup_operations; revision bigint;
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
    if operation.kind = 'provision' then
      revision := private.link_reserve(operation.planned_auth_id,'setup',operation.id);
      if revision is null then perform private.fail('EMAIL_COOLDOWN'); end if;
    else revision := operation.account_link_revision; end if;
    if revision is null or not private.link_start(operation.planned_auth_id,'setup',operation.id,revision) then perform private.fail('RECONCILIATION_REQUIRED'); end if;
    update private.account_setup_operations set email_attempt_id = gen_random_uuid(),email_attempt_generation = setup_generation,setup_capability_digest = capability_digest,email_started_at = current_timestamp,
      email_attempt_state = 'started',current_link_operation_id = case when kind = 'provision' then id else null end,account_link_revision = revision,
      version = version+1,updated_at = current_timestamp where id = operation.id;
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

create or replace function public.get_password_setup_context(operation_id uuid,generation integer,capability_digest text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare operation private.account_setup_operations; root private.account_setup_operations;
begin
  select * into operation from private.account_setup_operations where id = operation_id;
  if not found then perform private.fail('LINK_INVALID'); end if;
  select * into root from private.account_setup_operations where id = coalesce(operation.parent_id,operation.id);
  if root.current_link_operation_id is distinct from operation.id or root.setup_generation is distinct from generation or operation.email_attempt_generation is distinct from generation
    or operation.email_attempt_state <> 'accepted' or operation.setup_capability_digest is distinct from capability_digest or operation.account_link_revision is null
    or not private.link_current(root.auth_user_id,'setup',operation.id,operation.account_link_revision) then perform private.fail('LINK_INVALID'); end if;
  if root.checkpoint <> 'ready' or not exists(select from public.profiles where id = root.auth_user_id and access_enabled) then perform private.fail('ACCOUNT_NOT_READY'); end if;
  return jsonb_build_object('targetId',root.auth_user_id,'parentId',root.id,'operationId',operation.id,'generation',generation);
end; $$;

-- A late completion records its facts without requiring, or restoring, the current head.
create or replace function public.record_password_setup_result(operation_id uuid,generation integer,capability_digest text,target_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare operation private.account_setup_operations; root private.account_setup_operations;
begin
  select * into operation from private.account_setup_operations o where o.id = record_password_setup_result.operation_id;
  if not found then perform private.fail('LINK_INVALID'); end if;
  perform 1 from public.profiles p where p.id = record_password_setup_result.target_id for update;
  select * into root from private.account_setup_operations o where o.id = coalesce(operation.parent_id,operation.id) for update;
  if operation.parent_id is not null then select * into operation from private.account_setup_operations o where o.id = record_password_setup_result.operation_id for update; else operation := root; end if;
  if root.auth_user_id is distinct from record_password_setup_result.target_id or operation.account_link_revision is null
    or operation.email_attempt_generation is distinct from record_password_setup_result.generation or operation.email_attempt_state <> 'accepted'
    or operation.setup_capability_digest is distinct from record_password_setup_result.capability_digest then perform private.fail('LINK_INVALID'); end if;
  if not exists(select from public.audit_events e where e.actor_id = record_password_setup_result.target_id and e.mutation_id = operation.email_attempt_id and e.action = 'password_setup_completed') then
    update private.account_setup_operations o set password_setup_at = current_timestamp,version = o.version+1,updated_at = current_timestamp where o.id = root.id;
    perform private.link_initialize(record_password_setup_result.target_id);
    insert into public.audit_events(actor_kind,actor_id,mutation_id,action,target_type,target_id,metadata)
      values('user',record_password_setup_result.target_id,operation.email_attempt_id,'password_setup_completed','account_setup',operation.id,
        jsonb_build_object('operation_id',operation.id,'parent_id',root.id,'profile_id',record_password_setup_result.target_id,'generation',record_password_setup_result.generation));
  end if;
  perform private.link_clear(record_password_setup_result.target_id,'setup',operation.id);
  return jsonb_build_object('outcome','password_set');
end; $$;

create function public.record_setup_sessions_revoked(operation_id uuid,capability_digest text,target_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare operation private.account_setup_operations;
begin
  select * into operation from private.account_setup_operations o where o.id = record_setup_sessions_revoked.operation_id;
  if not found or operation.auth_user_id is distinct from record_setup_sessions_revoked.target_id
    or operation.setup_capability_digest is distinct from record_setup_sessions_revoked.capability_digest
    or not exists(select from public.audit_events e where e.actor_id = record_setup_sessions_revoked.target_id and e.mutation_id = operation.email_attempt_id and e.action = 'password_setup_completed')
    then perform private.fail('LINK_INVALID'); end if;
  insert into public.audit_events(actor_kind,actor_id,mutation_id,action,target_type,target_id,metadata)
    values('user',record_setup_sessions_revoked.target_id,private.derived_id(operation.id,'sessions_revoked'),'password_refresh_sessions_revoked','account_setup',operation.id,
      jsonb_build_object('operation_id',operation.id,'profile_id',record_setup_sessions_revoked.target_id,'source','setup'))
    on conflict (actor_id,mutation_id) do nothing;
  return jsonb_build_object('sessions','refresh_revoked');
end; $$;

-- Recovery journal.
create function private.recovery_reason_label(reason private.recovery_reason) returns text language sql immutable set search_path = '' as $$
  select case reason when 'requested_by_account_owner' then 'Requested by the account owner'
    when 'link_missing_or_expired' then 'Previous link missing or expired' when 'after_access_restoration' then 'After access restoration' end;
$$;
create function private.recovery_progress(operation private.password_recovery_operations) returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id',operation.id,'targetId',operation.target_profile_id,'targetName',p.display_name,'targetRole',p.role,'source',operation.source,
    'requestedBy',operation.requested_by,'reason',operation.reason,'reasonLabel',private.recovery_reason_label(operation.reason),
    'status',case when operation.status = 'started' and (operation.claim_until is null or operation.claim_until <= current_timestamp) then 'unknown' else operation.status::text end,
    'safeError',case when operation.status = 'started' and (operation.claim_until is null or operation.claim_until <= current_timestamp) then 'OUTCOME_UNKNOWN' else operation.safe_error::text end,
    'current',private.link_current(operation.target_profile_id,'recovery',operation.id,operation.link_revision),
    'version',operation.version,'createdAt',operation.created_at,'updatedAt',operation.updated_at,'emailStartedAt',operation.email_started_at,
    'passwordChangedAt',operation.password_changed_at,'refreshRevokedAt',operation.refresh_revoked_at)
  from public.profiles p where p.id = operation.target_profile_id;
$$;
create function private.recovery_driver(operation private.password_recovery_operations) returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('operationId',operation.id,'targetId',operation.target_profile_id,'revision',operation.link_revision,
    'emailFingerprint',operation.email_fingerprint,'claimId',operation.claim_id,'version',operation.version);
$$;
create function private.recovery_hash(target uuid,source private.recovery_source,requester uuid,reason private.recovery_reason,fingerprint text) returns text
language sql immutable set search_path = '' as $$
  select private.setup_hash(case when source = 'admin' then 'admin_recovery_requested' else 'recovery_link_requested' end,
    jsonb_build_object('target_profile_id',target,'source',source,'requested_by',requester,'reason',reason,'email_fingerprint',fingerprint));
$$;

create function public.lookup_recovery_identity(email_fingerprint text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare found uuid;
begin
  if lookup_recovery_identity.email_fingerprint is null or lookup_recovery_identity.email_fingerprint !~ '^[a-f0-9]{64}$' then perform private.fail('INVALID_INPUT'); end if;
  select u.id into found from auth.users u where encode(sha256(convert_to(lower(btrim(u.email)),'UTF8')),'hex') = lookup_recovery_identity.email_fingerprint limit 1;
  return jsonb_build_object('targetId',case when found is not null and private.recovery_block(found) is null then found end);
end; $$;

-- Public outcomes stay internal. The Worker returns the same acknowledgment for every branch.
create function public.begin_public_recovery(request_id uuid,email_fingerprint text,target_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare existing private.password_recovery_operations; operation private.password_recovery_operations; operation_id uuid := gen_random_uuid(); revision bigint;
  fingerprint text := private.recovery_hash(begin_public_recovery.target_id,'self_service',null,null,begin_public_recovery.email_fingerprint);
begin
  if begin_public_recovery.request_id is null or begin_public_recovery.target_id is null or begin_public_recovery.email_fingerprint is null
    or begin_public_recovery.email_fingerprint !~ '^[a-f0-9]{64}$' then perform private.fail('INVALID_INPUT'); end if;
  perform 1 from public.profiles p where p.id = begin_public_recovery.target_id for update;
  perform private.link_state(begin_public_recovery.target_id);
  select * into existing from private.password_recovery_operations o where o.source = 'self_service' and o.request_id = begin_public_recovery.request_id;
  if found then return jsonb_build_object('outcome',case when existing.request_hash = fingerprint then 'replayed' else 'ignored' end); end if;
  if private.recovery_block(begin_public_recovery.target_id) is not null
    or private.auth_fingerprint(begin_public_recovery.target_id) is distinct from begin_public_recovery.email_fingerprint then return jsonb_build_object('outcome','ignored'); end if;
  revision := private.link_reserve(begin_public_recovery.target_id,'recovery',operation_id);
  if revision is null then return jsonb_build_object('outcome','cooldown'); end if;
  insert into private.password_recovery_operations(id,target_profile_id,request_id,source,email_fingerprint,request_hash,link_revision,claim_id,claim_until)
    values(operation_id,begin_public_recovery.target_id,begin_public_recovery.request_id,'self_service',begin_public_recovery.email_fingerprint,fingerprint,revision,
      gen_random_uuid(),current_timestamp + interval '30 seconds') returning * into operation;
  return jsonb_build_object('outcome','reserved','driver',private.recovery_driver(operation));
end; $$;

create function public.begin_admin_recovery(mutation_id uuid,profile_id uuid,expected_profile_version integer,reason text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); person public.profiles; receipt public.mutation_receipts; operation private.password_recovery_operations; operation_id uuid := gen_random_uuid();
  revision bigint; code text; chosen private.recovery_reason; fingerprint text; metadata jsonb;
begin
  if actor is null then perform private.fail('AUTH_REQUIRED'); end if;
  perform private.setup_admin(actor,begin_admin_recovery.profile_id);
  if begin_admin_recovery.mutation_id is null or begin_admin_recovery.profile_id is null
    or begin_admin_recovery.reason is null or begin_admin_recovery.reason not in ('requested_by_account_owner','link_missing_or_expired','after_access_restoration')
    then perform private.fail('INVALID_INPUT'); end if;
  chosen := begin_admin_recovery.reason::private.recovery_reason;
  fingerprint := private.recovery_hash(begin_admin_recovery.profile_id,'admin',actor,chosen,coalesce(private.auth_fingerprint(begin_admin_recovery.profile_id),repeat('0',64)));
  perform private.link_state(begin_admin_recovery.profile_id);
  select * into receipt from public.mutation_receipts r where r.actor_id = actor and r.mutation_id = begin_admin_recovery.mutation_id;
  if found then
    if receipt.action <> 'admin_recovery_requested' or receipt.request_hash <> fingerprint then perform private.fail('IDEMPOTENCY_CONFLICT'); end if;
    select * into operation from private.password_recovery_operations o where o.id = receipt.result_id;
    return jsonb_build_object('outcome','already_committed','mutationId',receipt.mutation_id,'operation',private.recovery_progress(operation));
  end if;
  select * into person from public.profiles p where p.id = begin_admin_recovery.profile_id;
  if not found then perform private.fail('NOT_FOUND'); end if;
  perform private.check_version(person.version,begin_admin_recovery.expected_profile_version);
  code := private.recovery_block(person.id);
  if code is not null then perform private.fail(code); end if;
  revision := private.link_reserve(person.id,'recovery',operation_id);
  if revision is null then perform private.fail('EMAIL_COOLDOWN'); end if;
  insert into private.password_recovery_operations(id,target_profile_id,request_id,source,requested_by,reason,email_fingerprint,request_hash,link_revision,claim_id,claim_until)
    values(operation_id,person.id,begin_admin_recovery.mutation_id,'admin',actor,chosen,private.auth_fingerprint(person.id),fingerprint,revision,
      gen_random_uuid(),current_timestamp + interval '30 seconds') returning * into operation;
  metadata := jsonb_build_object('operation_id',operation.id,'profile_id',person.id,'source','admin','revision',revision);
  insert into public.mutation_receipts(actor_id,mutation_id,action,request_hash,result_type,result_id,result_version,result_metadata)
    values(actor,begin_admin_recovery.mutation_id,'admin_recovery_requested',fingerprint,'password_recovery',operation.id,operation.version,metadata);
  insert into public.audit_events(actor_kind,actor_id,mutation_id,action,target_type,target_id,reason,metadata)
    values('user',actor,begin_admin_recovery.mutation_id,'admin_recovery_requested','password_recovery',operation.id,private.recovery_reason_label(chosen),metadata);
  return jsonb_build_object('outcome','committed','mutationId',begin_admin_recovery.mutation_id,'operation',private.recovery_progress(operation));
end; $$;

create function public.get_worker_recovery_context(operation_id uuid,actor_id uuid default null) returns jsonb language plpgsql security definer set search_path = '' as $$
declare operation private.password_recovery_operations;
begin
  select * into operation from private.password_recovery_operations o where o.id = get_worker_recovery_context.operation_id;
  if not found then perform private.fail('NOT_FOUND'); end if;
  if operation.requested_by is distinct from get_worker_recovery_context.actor_id
    or (operation.source = 'admin' and not exists(select from public.profiles p where p.id = get_worker_recovery_context.actor_id and p.role = 'admin' and p.access_enabled))
    then perform private.fail('FORBIDDEN'); end if;
  if operation.status <> 'reserved' or operation.claim_until is null or operation.claim_until <= current_timestamp then perform private.fail('OPERATION_BUSY'); end if;
  return private.recovery_driver(operation);
end; $$;

create function public.start_recovery_attempt(operation_id uuid,claim_id uuid,expected_version integer,capability_digest text,actor_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare operation private.password_recovery_operations;
begin
  select * into operation from private.password_recovery_operations o where o.id = start_recovery_attempt.operation_id;
  if not found then perform private.fail('NOT_FOUND'); end if;
  perform 1 from public.profiles p where p.id in (operation.target_profile_id,operation.requested_by) order by p.id for update;
  perform private.link_state(operation.target_profile_id);
  select * into operation from private.password_recovery_operations o where o.id = start_recovery_attempt.operation_id for update;
  if start_recovery_attempt.capability_digest is null or start_recovery_attempt.capability_digest !~ '^[a-f0-9]{64}$' then perform private.fail('INVALID_INPUT'); end if;
  if operation.requested_by is distinct from start_recovery_attempt.actor_id
    or (operation.source = 'admin' and not exists(select from public.profiles p where p.id = start_recovery_attempt.actor_id and p.role = 'admin' and p.access_enabled))
    then perform private.fail('FORBIDDEN'); end if;
  perform private.check_version(operation.version,start_recovery_attempt.expected_version);
  if operation.status <> 'reserved' or operation.claim_id is distinct from start_recovery_attempt.claim_id or operation.claim_until <= current_timestamp then perform private.fail('OPERATION_BUSY'); end if;
  if private.recovery_block(operation.target_profile_id) is not null
    or not private.link_start(operation.target_profile_id,'recovery',operation.id,operation.link_revision) then
    update private.password_recovery_operations o set status = 'failed',safe_error = 'SUPERSEDED',claim_id = null,claim_until = null,version = o.version + 1,updated_at = current_timestamp
      where o.id = operation.id;
    return jsonb_build_object('started',false,'code','SUPERSEDED');
  end if;
  update private.password_recovery_operations o set capability_digest = start_recovery_attempt.capability_digest,email_attempt_id = gen_random_uuid(),email_started_at = current_timestamp,
    status = 'started',claim_until = current_timestamp + interval '30 seconds',version = o.version + 1,updated_at = current_timestamp
    where o.id = operation.id returning * into operation;
  return jsonb_build_object('started',true,'attemptId',operation.email_attempt_id,'version',operation.version);
end; $$;

create function public.record_recovery_outcome(operation_id uuid,claim_id uuid,attempt_id uuid,outcome text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare operation private.password_recovery_operations; effective text;
begin
  if record_recovery_outcome.outcome is null or record_recovery_outcome.outcome not in ('accepted','rejected','unavailable','identity_changed','unknown') then perform private.fail('INVALID_INPUT'); end if;
  select * into operation from private.password_recovery_operations o where o.id = record_recovery_outcome.operation_id for update;
  if not found then perform private.fail('NOT_FOUND'); end if;
  if operation.status <> 'started' or operation.email_attempt_id is distinct from record_recovery_outcome.attempt_id
    or operation.claim_id is distinct from record_recovery_outcome.claim_id then perform private.fail('RECONCILIATION_REQUIRED'); end if;
  effective := case when operation.claim_until <= current_timestamp then 'unknown' else record_recovery_outcome.outcome end;
  update private.password_recovery_operations o set
    status = case effective when 'accepted' then 'accepted'::private.recovery_status when 'unknown' then 'unknown'::private.recovery_status else 'failed'::private.recovery_status end,
    safe_error = case effective when 'accepted' then null when 'rejected' then 'PROVIDER_REJECTED'::private.recovery_error when 'unavailable' then 'PROVIDER_UNAVAILABLE'::private.recovery_error
      when 'identity_changed' then 'IDENTITY_CHANGED'::private.recovery_error else 'OUTCOME_UNKNOWN'::private.recovery_error end,
    claim_id = null,claim_until = null,version = o.version + 1,updated_at = current_timestamp where o.id = operation.id returning * into operation;
  if effective = 'accepted' and operation.source = 'admin' then
    insert into public.audit_events(actor_kind,actor_id,mutation_id,action,target_type,target_id,metadata)
      values('user',operation.requested_by,operation.id,'recovery_link_requested','password_recovery',operation.id,
        jsonb_build_object('operation_id',operation.id,'profile_id',operation.target_profile_id,'source','admin','revision',operation.link_revision,'status','accepted'));
  end if;
  return jsonb_build_object('status',operation.status,'safeError',operation.safe_error);
end; $$;

create function public.get_recovery_password_context(operation_id uuid,revision bigint,capability_digest text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare operation private.password_recovery_operations;
begin
  select * into operation from private.password_recovery_operations o where o.id = get_recovery_password_context.operation_id;
  if not found or operation.link_revision is distinct from get_recovery_password_context.revision
    or operation.capability_digest is distinct from get_recovery_password_context.capability_digest
    or operation.status not in ('started','accepted','unknown')
    or not private.link_current(operation.target_profile_id,'recovery',operation.id,operation.link_revision) then perform private.fail('LINK_INVALID'); end if;
  if private.recovery_block(operation.target_profile_id) is not null then perform private.fail('ACCOUNT_NOT_READY'); end if;
  return jsonb_build_object('targetId',operation.target_profile_id,'operationId',operation.id,'revision',operation.link_revision);
end; $$;

create function public.record_recovery_password_result(operation_id uuid,revision bigint,capability_digest text,target_id uuid,result text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare operation private.password_recovery_operations; metadata jsonb;
begin
  select * into operation from private.password_recovery_operations o where o.id = record_recovery_password_result.operation_id;
  if not found or operation.target_profile_id is distinct from record_recovery_password_result.target_id then perform private.fail('LINK_INVALID'); end if;
  perform 1 from public.profiles p where p.id = operation.target_profile_id for update;
  perform private.link_state(operation.target_profile_id);
  select * into operation from private.password_recovery_operations o where o.id = record_recovery_password_result.operation_id for update;
  if operation.link_revision is distinct from record_recovery_password_result.revision or operation.email_attempt_id is null
    or operation.capability_digest is distinct from record_recovery_password_result.capability_digest then perform private.fail('LINK_INVALID'); end if;
  metadata := jsonb_build_object('operation_id',operation.id,'profile_id',operation.target_profile_id,'source',operation.source,'revision',operation.link_revision);
  if record_recovery_password_result.result = 'password_changed' then
    if operation.status <> 'password_changed' then
      if operation.status not in ('started','accepted','unknown') then perform private.fail('LINK_INVALID'); end if;
      update private.password_recovery_operations o set status = 'password_changed',password_changed_at = current_timestamp,claim_id = null,claim_until = null,
        version = o.version + 1,updated_at = current_timestamp where o.id = operation.id returning * into operation;
      insert into public.audit_events(actor_kind,actor_id,mutation_id,action,target_type,target_id,metadata)
        values('user',operation.target_profile_id,operation.email_attempt_id,'password_recovery_completed','password_recovery',operation.id,metadata)
        on conflict (actor_id,mutation_id) do nothing;
    end if;
    perform private.link_clear(operation.target_profile_id,'recovery',operation.id);
  elsif record_recovery_password_result.result = 'refresh_revoked' then
    if operation.status <> 'password_changed' then perform private.fail('LINK_INVALID'); end if;
    if operation.refresh_revoked_at is null then
      update private.password_recovery_operations o set refresh_revoked_at = current_timestamp,version = o.version + 1,updated_at = current_timestamp
        where o.id = operation.id returning * into operation;
    end if;
    insert into public.audit_events(actor_kind,actor_id,mutation_id,action,target_type,target_id,metadata)
      values('user',operation.target_profile_id,private.derived_id(operation.id,'sessions_revoked'),'password_refresh_sessions_revoked','password_recovery',operation.id,metadata)
      on conflict (actor_id,mutation_id) do nothing;
  else perform private.fail('INVALID_INPUT'); end if;
  return jsonb_build_object('status',operation.status,'sessions',case when operation.refresh_revoked_at is null then 'unknown' else 'refresh_revoked' end);
end; $$;

create function public.admin_list_recovery_operations(target_profile_id uuid default null,page_cursor jsonb default null,page_size integer default 20) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare items jsonb; cursor_time timestamptz; cursor_id uuid; next_cursor jsonb;
begin
  if auth.uid() is null then perform private.fail('AUTH_REQUIRED'); end if;
  if private.enabled_role() is distinct from 'admin'::public.account_role then perform private.fail('FORBIDDEN'); end if;
  if page_size is null or page_size not between 1 and 100 then perform private.fail('INVALID_INPUT'); end if;
  if page_cursor is not null then
    if jsonb_typeof(page_cursor) <> 'object' or not page_cursor ?& array['createdAt','id'] or (select count(*) from jsonb_object_keys(page_cursor)) <> 2 then perform private.fail('INVALID_INPUT'); end if;
    cursor_time := (page_cursor->>'createdAt')::timestamptz; cursor_id := (page_cursor->>'id')::uuid;
    if cursor_time is null or not isfinite(cursor_time) or cursor_id is null then perform private.fail('INVALID_INPUT'); end if;
  end if;
  select coalesce(jsonb_agg(private.recovery_progress(o) order by o.created_at,o.id),'[]') into items from (
    select * from private.password_recovery_operations r where (admin_list_recovery_operations.target_profile_id is null or r.target_profile_id = admin_list_recovery_operations.target_profile_id)
      and (page_cursor is null or (r.created_at,r.id) > (cursor_time,cursor_id)) order by r.created_at,r.id limit page_size + 1
  ) o;
  if jsonb_array_length(items) > page_size then
    items := items - page_size; next_cursor := jsonb_build_object('createdAt',items->(page_size-1)->>'createdAt','id',items->(page_size-1)->>'id');
  end if;
  return jsonb_build_object('operations',items,'nextCursor',next_cursor);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then perform private.fail('INVALID_INPUT'); return null;
end; $$;
create function public.admin_get_recovery_operation(operation_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare operation private.password_recovery_operations;
begin
  if auth.uid() is null then perform private.fail('AUTH_REQUIRED'); end if;
  if private.enabled_role() is distinct from 'admin'::public.account_role then perform private.fail('FORBIDDEN'); end if;
  select * into operation from private.password_recovery_operations o where o.id = admin_get_recovery_operation.operation_id;
  if not found then perform private.fail('NOT_FOUND'); end if;
  return private.recovery_progress(operation);
end; $$;

-- Account directory. Never returns email, fingerprints, claims or digests.
create function private.account_summary(person public.profiles) returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id',person.id,'displayName',person.display_name,'role',person.role,'enabled',person.access_enabled,'version',person.version,
    'createdAt',person.created_at,'setupStatus',private.account_setup_status(person.id),
    'passwordInitialized',exists(select from private.account_password_state s where s.profile_id = person.id and s.password_initialized_at is not null));
$$;
create function public.admin_list_accounts(name_query text default null,role_filter public.account_role default null,enabled_filter boolean default null,
  page_cursor jsonb default null,page_size integer default 20) returns jsonb language plpgsql security definer set search_path = '' as $$
declare items jsonb; cursor_time timestamptz; cursor_id uuid; next_cursor jsonb; needle text := lower(nullif(btrim(name_query),''));
begin
  if auth.uid() is null then perform private.fail('AUTH_REQUIRED'); end if;
  if private.enabled_role() is distinct from 'admin'::public.account_role then perform private.fail('FORBIDDEN'); end if;
  if page_size is null or page_size not between 1 and 100 or char_length(name_query) > 160 then perform private.fail('INVALID_INPUT'); end if;
  if page_cursor is not null then
    if jsonb_typeof(page_cursor) <> 'object' or not page_cursor ?& array['createdAt','id'] or (select count(*) from jsonb_object_keys(page_cursor)) <> 2 then perform private.fail('INVALID_INPUT'); end if;
    cursor_time := (page_cursor->>'createdAt')::timestamptz; cursor_id := (page_cursor->>'id')::uuid;
    if cursor_time is null or not isfinite(cursor_time) or cursor_id is null then perform private.fail('INVALID_INPUT'); end if;
  end if;
  -- strpos matches the query literally, so % and _ are ordinary characters.
  select coalesce(jsonb_agg(private.account_summary(p) order by p.created_at,p.id),'[]') into items from (
    select * from public.profiles q where (needle is null or strpos(lower(q.display_name),needle) > 0) and (role_filter is null or q.role = role_filter)
      and (enabled_filter is null or q.access_enabled = enabled_filter) and (page_cursor is null or (q.created_at,q.id) > (cursor_time,cursor_id))
      order by q.created_at,q.id limit page_size + 1
  ) p;
  if jsonb_array_length(items) > page_size then
    items := items - page_size; next_cursor := jsonb_build_object('createdAt',items->(page_size-1)->>'createdAt','id',items->(page_size-1)->>'id');
  end if;
  return jsonb_build_object('items',items,'nextCursor',next_cursor);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then perform private.fail('INVALID_INPUT'); return null;
end; $$;
create function public.admin_find_account(email_fingerprint text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare person public.profiles;
begin
  if auth.uid() is null then perform private.fail('AUTH_REQUIRED'); end if;
  if private.enabled_role() is distinct from 'admin'::public.account_role then perform private.fail('FORBIDDEN'); end if;
  if admin_find_account.email_fingerprint is null or admin_find_account.email_fingerprint !~ '^[a-f0-9]{64}$' then perform private.fail('INVALID_INPUT'); end if;
  select p.* into person from auth.users u join public.profiles p on p.id = u.id
    where encode(sha256(convert_to(lower(btrim(u.email)),'UTF8')),'hex') = admin_find_account.email_fingerprint limit 1;
  return jsonb_build_object('profile',case when person.id is null then null else private.account_summary(person) end);
end; $$;
create function public.admin_get_account(profile_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare person public.profiles; state private.account_password_state;
begin
  if auth.uid() is null then perform private.fail('AUTH_REQUIRED'); end if;
  if private.enabled_role() is distinct from 'admin'::public.account_role then perform private.fail('FORBIDDEN'); end if;
  select * into person from public.profiles p where p.id = admin_get_account.profile_id;
  if not found then perform private.fail('NOT_FOUND'); end if;
  select * into state from private.account_password_state s where s.profile_id = person.id;
  return jsonb_build_object('profile',private.account_summary(person),'currentLinkKind',state.current_link_kind,'nextEmailAllowedAt',state.next_email_allowed_at,
    'recoveryEligible',private.recovery_block(person.id) is null,
    'setupOperations',coalesce((select jsonb_agg(private.setup_progress(o) order by o.created_at,o.id) from private.account_setup_operations o where o.planned_auth_id = person.id),'[]'));
end; $$;

-- Account maintenance guards wrap the 0002 preparation rules rather than copy them.
create or replace function private.apply_action(action text, p jsonb, campaign public.campaigns) returns jsonb
language plpgsql set search_path = '' as $$
declare effect jsonb; target uuid;
begin
  if action in ('advance_campaign_stage','waive_final_obligation','correct_feedback') then return private.apply_lifecycle(action,p,campaign); end if;
  if action = 'update_profile_name' and private.setup_pending((p->>'profile_id')::uuid) then perform private.fail('ACCOUNT_SETUP_PENDING'); end if;
  if action in ('set_campaign_coach','set_campaign_player') and (p->>'active')::boolean then
    target := coalesce((p->>'coach_id')::uuid,(p->>'player_id')::uuid);
    if exists(select from public.profiles q where q.id = target and not q.access_enabled) then perform private.fail('ACCOUNT_DISABLED'); end if;
    if private.setup_pending(target) then perform private.fail('ACCOUNT_SETUP_PENDING'); end if;
  end if;
  effect := private.apply_preparation(action,p,campaign);
  if action = 'set_profile_access' and not (p->>'enabled')::boolean then perform private.link_clear((p->>'profile_id')::uuid); end if;
  return effect;
end; $$;

-- Audits.
create or replace function private.safe_metadata(value jsonb, action text) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(value) = 'object' and not exists (
    select from jsonb_object_keys(value) as k(key) where key <> all (
      case when action in ('account_setup_started','account_setup_resumed','setup_link_replacement_started','setup_link_requested','password_setup_completed')
      then array['operation_id','parent_id','profile_id','generation','checkpoint','version','safe_code']
      when action in ('admin_recovery_requested','recovery_link_requested','password_recovery_completed','password_refresh_sessions_revoked')
      then array['operation_id','profile_id','source','revision','status','safe_code']
      when action = 'admin_bootstrapped' then array['operation_id','profile_id']
      when action in ('save_feedback_draft','discard_feedback_draft','submit_feedback','correct_feedback')
      then array['feedback_id','player_id','coach_id','revision','previous_version','version']
      when action = 'waive_final_obligation' then array['obligation_id','coach_id','player_id','version']
      else array['coach_id','player_id','previous_version','version','before','after','stage','obligations_created','drafts_deleted','required','submitted','waived'] end
    )
  );
$$;
alter table public.audit_events drop constraint audit_events_check;
alter table public.audit_events add constraint audit_events_check check (
  (actor_kind in ('account','user') and actor_id is not null and mutation_id is not null)
  or (actor_kind = 'bootstrap' and actor_id is null and action = 'admin_bootstrapped')
);
create unique index bootstrap_operation on public.audit_events(mutation_id) where actor_kind = 'bootstrap' and mutation_id is not null;
alter table public.audit_events drop constraint audit_events_action_check;
alter table public.audit_events add constraint audit_events_action_check check (action in (
  'admin_bootstrapped','create_profile','update_profile_name','set_profile_access','create_competition','update_competition','create_campaign','update_campaign_metadata',
  'set_campaign_coach','set_campaign_player','advance_campaign_stage','save_feedback_draft','discard_feedback_draft','submit_feedback','waive_final_obligation','correct_feedback',
  'account_setup_started','account_setup_resumed','setup_link_replacement_started','setup_link_requested','password_setup_completed',
  'admin_recovery_requested','recovery_link_requested','password_recovery_completed','password_refresh_sessions_revoked'
));

-- Trusted operator procedure. Database owner only: no role receives these functions.
create function private.operator_establish_admin(operation_id uuid,profile_id uuid,display_name text,verification_reason text) returns jsonb
language plpgsql set search_path = '' as $$
declare existing public.profiles;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sfda_admin_establish',0));
  perform private.check_name(btrim(operator_establish_admin.display_name));
  perform private.check_reason(btrim(operator_establish_admin.verification_reason));
  select * into existing from public.profiles p where p.id = operator_establish_admin.profile_id;
  if exists(select from public.audit_events e where e.actor_kind = 'bootstrap' and e.mutation_id = operator_establish_admin.operation_id) then
    if existing.role = 'admin' and exists(select from public.audit_events e where e.actor_kind = 'bootstrap' and e.mutation_id = operator_establish_admin.operation_id
      and e.target_id = operator_establish_admin.profile_id) then return jsonb_build_object('outcome','already_committed','profileId',existing.id); end if;
    perform private.fail('RECONCILIATION_REQUIRED');
  end if;
  if not exists(select from auth.users u where u.id = operator_establish_admin.profile_id and u.email_confirmed_at is not null
    and u.raw_app_meta_data->>'sfda_admin_bootstrap_operation_id' = operator_establish_admin.operation_id::text) then perform private.fail('RECONCILIATION_REQUIRED'); end if;
  if existing.id is not null then perform private.fail('RECONCILIATION_REQUIRED'); end if;
  insert into public.profiles(id,display_name,role,access_enabled) values(operator_establish_admin.profile_id,btrim(operator_establish_admin.display_name),'admin',true);
  perform private.link_initialize(operator_establish_admin.profile_id);
  insert into public.audit_events(actor_kind,mutation_id,action,target_type,target_id,reason,metadata)
    values('bootstrap',operator_establish_admin.operation_id,'admin_bootstrapped','profile',operator_establish_admin.profile_id,btrim(operator_establish_admin.verification_reason),
      jsonb_build_object('operation_id',operator_establish_admin.operation_id,'profile_id',operator_establish_admin.profile_id));
  return jsonb_build_object('outcome','committed','profileId',operator_establish_admin.profile_id);
end; $$;
create function private.operator_verify_admin(profile_id uuid) returns jsonb language plpgsql set search_path = '' as $$
begin
  if not exists(select from public.profiles p where p.id = operator_verify_admin.profile_id and p.role = 'admin' and p.access_enabled) then perform private.fail('RECONCILIATION_REQUIRED'); end if;
  perform private.link_initialize(operator_verify_admin.profile_id);
  return jsonb_build_object('outcome','verified','profileId',operator_verify_admin.profile_id);
end; $$;

-- Expose only named functions.
revoke all on all functions in schema private from public,anon,authenticated,service_role;
grant execute on function private.enabled_role(),private.can_read_campaign(uuid),private.can_read_profile(uuid) to authenticated;
grant execute on function private.safe_metadata(jsonb,text) to service_role;
revoke all on function public.begin_admin_recovery(uuid,uuid,integer,text),public.admin_list_recovery_operations(uuid,jsonb,integer),public.admin_get_recovery_operation(uuid),
  public.admin_list_accounts(text,public.account_role,boolean,jsonb,integer),public.admin_find_account(text),public.admin_get_account(uuid) from public,anon,service_role;
grant execute on function public.begin_admin_recovery(uuid,uuid,integer,text),public.admin_list_recovery_operations(uuid,jsonb,integer),public.admin_get_recovery_operation(uuid),
  public.admin_list_accounts(text,public.account_role,boolean,jsonb,integer),public.admin_find_account(text),public.admin_get_account(uuid) to authenticated;
revoke all on function public.lookup_recovery_identity(text),public.begin_public_recovery(uuid,text,uuid),public.get_worker_recovery_context(uuid,uuid),
  public.start_recovery_attempt(uuid,uuid,integer,text,uuid),public.record_recovery_outcome(uuid,uuid,uuid,text),public.get_recovery_password_context(uuid,bigint,text),
  public.record_recovery_password_result(uuid,bigint,text,uuid,text),public.record_setup_sessions_revoked(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.lookup_recovery_identity(text),public.begin_public_recovery(uuid,text,uuid),public.get_worker_recovery_context(uuid,uuid),
  public.start_recovery_attempt(uuid,uuid,integer,text,uuid),public.record_recovery_outcome(uuid,uuid,uuid,text),public.get_recovery_password_context(uuid,bigint,text),
  public.record_recovery_password_result(uuid,bigint,text,uuid,text),public.record_setup_sessions_revoked(uuid,text,uuid) to service_role;
