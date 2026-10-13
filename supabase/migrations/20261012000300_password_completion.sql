-- Qualify the target parameter so it cannot collide with audit_events.target_id.
create or replace function public.record_password_setup_result(operation_id uuid,generation integer,capability_digest text,target_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare operation private.account_setup_operations; root private.account_setup_operations; context jsonb;
begin
  select * into operation from private.account_setup_operations where id = operation_id;
  if not found then perform private.fail('LINK_INVALID'); end if;
  perform 1 from public.profiles p where p.id = record_password_setup_result.target_id for update;
  select * into root from private.account_setup_operations where id = coalesce(operation.parent_id,operation.id) for update;
  if operation.parent_id is not null then select * into operation from private.account_setup_operations where id = operation_id for update; else operation := root; end if;
  context := public.get_password_setup_context(operation_id,generation,capability_digest);
  if (context->>'targetId')::uuid is distinct from target_id then perform private.fail('LINK_INVALID'); end if;
  if not exists(select from public.audit_events e where e.actor_id = record_password_setup_result.target_id and e.mutation_id = operation.email_attempt_id and e.action = 'password_setup_completed') then
    update private.account_setup_operations set password_setup_at = current_timestamp,version = version+1,updated_at = current_timestamp where id = root.id;
    insert into public.audit_events(actor_kind,actor_id,mutation_id,action,target_type,target_id,metadata)
      values('user',target_id,operation.email_attempt_id,'password_setup_completed','account_setup',operation.id,
        jsonb_build_object('operation_id',operation.id,'parent_id',root.id,'profile_id',target_id,'generation',generation));
  end if;
  return jsonb_build_object('outcome','password_set');
end; $$;
