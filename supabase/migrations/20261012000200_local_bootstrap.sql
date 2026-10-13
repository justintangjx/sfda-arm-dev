-- Preserve the service role's existing audit constraint evaluation permission.
grant execute on function private.safe_metadata(jsonb,text) to service_role;

-- Trusted local tooling only. Profile and bootstrap audit commit together.
create function public.bootstrap_local_admin(profile_id uuid,display_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sfda_first_admin',0));
  perform private.check_name(btrim(display_name));
  if exists(select from public.profiles where role = 'admin') then perform private.fail('ADMIN_EXISTS'); end if;
  if not exists(select from auth.users where id = profile_id and raw_app_meta_data->>'sfda_local_bootstrap_id' = profile_id::text)
    then perform private.fail('RECONCILIATION_REQUIRED'); end if;
  insert into public.profiles(id,display_name,role,access_enabled) values(profile_id,btrim(display_name),'admin',true);
  insert into public.audit_events(actor_kind,action,target_type,target_id,metadata) values('bootstrap','admin_bootstrapped','profile',profile_id,'{}');
  return jsonb_build_object('id',profile_id,'role','admin','enabled',true,'version',1);
end; $$;
revoke all on function public.bootstrap_local_admin(uuid,text) from public,anon,authenticated;
grant execute on function public.bootstrap_local_admin(uuid,text) to service_role;
