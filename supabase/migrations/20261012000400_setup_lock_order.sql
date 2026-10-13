-- Acquire actor and target locks in UUID order before inspecting a replay.
create or replace function public.begin_setup_link_replacement(parent_id uuid,mutation_id uuid,expected_version integer) returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); parent private.account_setup_operations; child private.account_setup_operations; person public.profiles; replay jsonb; receipt public.mutation_receipts;
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
  insert into private.account_setup_operations(mutation_id,requested_by,kind,parent_id,display_name,intended_role,email_fingerprint,request_hash,planned_auth_id,auth_user_id,profile_version,setup_generation,claim_id,claim_until,last_resumed_by)
    values(mutation_id,actor,'replace_link',parent.id,parent.display_name,parent.intended_role,parent.email_fingerprint,fingerprint,parent.planned_auth_id,parent.auth_user_id,parent.profile_version,parent.setup_generation+1,
      gen_random_uuid(),current_timestamp+interval '30 seconds',actor) returning * into child;
  update private.account_setup_operations set setup_generation = setup_generation+1,current_link_operation_id = child.id,claim_id = null,claim_until = null,version = version+1,updated_at = current_timestamp where id = parent.id;
  receipt := private.setup_intent(actor,mutation_id,'setup_link_replacement_started',fingerprint,child);
  return private.setup_reference(receipt,child,false);
end; $$;

