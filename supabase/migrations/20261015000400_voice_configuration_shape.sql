-- Spec 0008. Required configuration facts reject explicit JSON null.
create or replace function private.voice_config(value jsonb) returns private.voice_config_facts
language plpgsql immutable set search_path = '' as $$
declare keys constant text[] := array['fingerprint','agentId','agentVersionId','credentialRule','captureRule',
  'dispatchToIssuanceSeconds','redemptionSeconds','limits'];
begin
  if value is null or value = 'null'::jsonb then return null; end if;
  if exists (select from unnest(array['fingerprint','agentId','agentVersionId','credentialRule','captureRule']) k
      where jsonb_typeof(value->k) is distinct from 'string') then perform private.fail('INVALID_INPUT'); end if;
  if jsonb_typeof(value) <> 'object' or not value ?& keys
    or exists (select from jsonb_object_keys(value) k where k <> all(keys))
    or value->>'fingerprint' !~ '^[a-f0-9]{64}$'
    or value->>'agentId' !~ '^[A-Za-z0-9_-]{1,128}$' or value->>'agentVersionId' !~ '^[A-Za-z0-9_-]{1,128}$'
    or value->>'credentialRule' not in ('hold_only','terminal_consumes')
    or value->>'captureRule' not in ('mute_stops_capture','unproven')
    or jsonb_typeof(value->'limits') <> 'object'
    or (value->'dispatchToIssuanceSeconds' <> 'null'::jsonb and (value->>'dispatchToIssuanceSeconds')::integer not between 1 and 3600)
    or (value->'redemptionSeconds' <> 'null'::jsonb and (value->>'redemptionSeconds')::integer not between 1 and 3600)
    then perform private.fail('INVALID_INPUT'); end if;
  return row(value->>'fingerprint', value->>'agentId', value->>'agentVersionId', value->>'credentialRule', value->>'captureRule',
    (value->>'dispatchToIssuanceSeconds')::integer, (value->>'redemptionSeconds')::integer, value->'limits')::private.voice_config_facts;
end; $$;
