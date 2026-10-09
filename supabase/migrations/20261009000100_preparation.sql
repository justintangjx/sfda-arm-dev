-- Spec 0002, preparation path. All writes go through named authenticated functions.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema private revoke execute on functions from public, anon, authenticated;

create type public.account_role as enum ('admin', 'coach', 'player');
create type public.campaign_stage as enum ('setup', 'preparation', 'competition', 'final_feedback', 'closed');
create type public.feedback_kind as enum ('preparation', 'final');
create type public.feedback_status as enum ('draft', 'submitted');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  display_name text not null check (display_name = btrim(display_name) and char_length(display_name) between 1 and 160),
  role public.account_role not null,
  access_enabled boolean not null default false,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default current_timestamp,
  updated_at timestamptz not null default current_timestamp
);
create table public.competitions (
  id uuid primary key default gen_random_uuid(),
  name text not null check (name = btrim(name) and char_length(name) between 1 and 160),
  starts_on date check (isfinite(starts_on)),
  ends_on date check (isfinite(ends_on)),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default current_timestamp,
  updated_at timestamptz not null default current_timestamp,
  check (ends_on >= starts_on)
);
create unique index competition_name on public.competitions (lower(btrim(name)));
create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions(id) on delete restrict,
  name text not null check (name = btrim(name) and char_length(name) between 1 and 160),
  team_name text not null check (team_name = btrim(team_name) and char_length(team_name) between 1 and 160),
  stage public.campaign_stage not null default 'setup',
  planned_preparation_start_on date check (isfinite(planned_preparation_start_on)),
  requirements_frozen_at timestamptz,
  closed_at timestamptz,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default current_timestamp,
  updated_at timestamptz not null default current_timestamp,
  unique (id, competition_id)
);
create unique index campaign_team on public.campaigns (competition_id, lower(btrim(team_name)));
create table public.campaign_coaches (
  campaign_id uuid not null references public.campaigns(id) on delete restrict,
  coach_id uuid not null references public.profiles(id) on delete restrict,
  is_active boolean not null,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default current_timestamp,
  updated_at timestamptz not null default current_timestamp,
  primary key (campaign_id, coach_id)
);
create table public.campaign_players (
  campaign_id uuid not null references public.campaigns(id) on delete restrict,
  player_id uuid not null references public.profiles(id) on delete restrict,
  is_active boolean not null,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default current_timestamp,
  updated_at timestamptz not null default current_timestamp,
  primary key (campaign_id, player_id)
);
create index coach_campaigns on public.campaign_coaches (coach_id, campaign_id);
create index player_campaigns on public.campaign_players (player_id, campaign_id);
create table public.competition_pairings (
  competition_id uuid not null,
  coach_id uuid not null,
  player_id uuid not null,
  campaign_id uuid not null,
  created_at timestamptz not null default current_timestamp,
  primary key (competition_id, coach_id, player_id),
  unique (competition_id, coach_id, player_id, campaign_id),
  foreign key (campaign_id, competition_id) references public.campaigns(id, competition_id) on delete restrict,
  foreign key (campaign_id, coach_id) references public.campaign_coaches(campaign_id, coach_id) on delete restrict,
  foreign key (campaign_id, player_id) references public.campaign_players(campaign_id, player_id) on delete restrict
);
create table public.feedback_entries (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null,
  competition_id uuid not null,
  coach_id uuid not null,
  player_id uuid not null,
  kind public.feedback_kind not null,
  status public.feedback_status not null,
  observations text check (char_length(observations) <= 10000),
  strengths text check (char_length(strengths) <= 5000),
  development_focus text check (char_length(development_focus) <= 5000),
  observed_on date check (isfinite(observed_on)),
  submitted_at timestamptz,
  reviewed_at timestamptz not null default current_timestamp,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default current_timestamp,
  updated_at timestamptz not null default current_timestamp,
  constraint preparation_only check (kind = 'preparation'),
  check ((status = 'draft' and submitted_at is null) or
    (status = 'submitted' and submitted_at is not null and observed_on is not null and
     observations is not null and observations ~ '[^[:space:]]')),
  foreign key (competition_id, coach_id, player_id, campaign_id)
    references public.competition_pairings(competition_id, coach_id, player_id, campaign_id) on delete restrict
);
create unique index single_draft on public.feedback_entries (campaign_id, coach_id, player_id, kind) where status = 'draft';
create unique index single_final on public.feedback_entries (competition_id, coach_id, player_id) where kind = 'final' and status = 'submitted';
create index feedback_history on public.feedback_entries (campaign_id, coach_id, player_id, submitted_at desc, id desc) where status = 'submitted';

create function private.safe_metadata(value jsonb, action text) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(value) = 'object' and not exists (
    select from jsonb_object_keys(value) as k(key) where key <> all (
      case when action in ('save_feedback_draft','discard_feedback_draft','submit_feedback','correct_feedback')
      then array['feedback_id','player_id','coach_id','revision','previous_version','version']
      when action = 'waive_final_obligation' then array['obligation_id','coach_id','player_id','version']
      else array['coach_id','player_id','previous_version','version','before','after','stage','obligations_created','drafts_deleted','required','submitted','waived'] end
    )
  );
$$;
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_kind text not null check (actor_kind in ('account','bootstrap')),
  actor_id uuid references public.profiles(id) on delete restrict,
  action text not null check (action in ('admin_bootstrapped','create_profile','update_profile_name','set_profile_access','create_competition','update_competition','create_campaign','update_campaign_metadata','set_campaign_coach','set_campaign_player','advance_campaign_stage','save_feedback_draft','discard_feedback_draft','submit_feedback','waive_final_obligation','correct_feedback')),
  target_type text not null,
  target_id uuid not null,
  campaign_id uuid references public.campaigns(id) on delete restrict,
  mutation_id uuid,
  reason text check (reason = btrim(reason) and char_length(reason) between 1 and 2000),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default current_timestamp,
  check ((actor_kind = 'account' and actor_id is not null and mutation_id is not null) or
    (actor_kind = 'bootstrap' and actor_id is null and mutation_id is null and action = 'admin_bootstrapped')),
  check (private.safe_metadata(metadata, action)),
  check (target_type not in ('campaign_coach','campaign_player') or
    (target_id = campaign_id and metadata ? case target_type when 'campaign_coach' then 'coach_id' else 'player_id' end)),
  unique (actor_id, mutation_id)
);
create index campaign_audit on public.audit_events (campaign_id, created_at desc, id desc);
create table public.mutation_receipts (
  actor_id uuid not null references public.profiles(id) on delete restrict,
  mutation_id uuid not null,
  action text not null,
  fingerprint_version integer not null default 1 check (fingerprint_version = 1),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  result_type text not null,
  result_id uuid not null,
  result_version integer not null check (result_version > 0),
  result_metadata jsonb not null default '{}',
  campaign_id uuid references public.campaigns(id) on delete restrict,
  created_at timestamptz not null default current_timestamp,
  primary key (actor_id, mutation_id),
  check (private.safe_metadata(result_metadata, action)),
  check (result_type not in ('campaign_coach','campaign_player') or
    (result_id = campaign_id and result_metadata ? case result_type when 'campaign_coach' then 'coach_id' else 'player_id' end))
);

create function private.fail(code text) returns void language plpgsql set search_path = '' as $$
begin
  case
    when code = 'AUTH_REQUIRED' then raise sqlstate 'PT401' using message = code;
    when code = 'FORBIDDEN' then raise sqlstate 'PT403' using message = code;
    when code = 'NOT_FOUND' then raise sqlstate 'PT404' using message = code;
    when code in ('INVALID_INPUT','AUTH_USER_MISSING') then raise sqlstate 'PT422' using message = code;
    when code = 'DATABASE_ERROR' then raise sqlstate 'PT500' using message = code;
    else raise sqlstate 'PT409' using message = code;
  end case;
end; $$;
create function private.enabled_role() returns public.account_role
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid() and access_enabled;
$$;
create function private.can_read_campaign(subject uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.enabled_role() = 'admin' or (private.enabled_role() = 'coach' and exists (
    select from public.campaign_coaches where campaign_id = subject and coach_id = auth.uid()
  ));
$$;
create function private.can_read_profile(subject uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.enabled_role() = 'admin' or (private.enabled_role() = 'coach' and (
    subject = auth.uid() or exists (
      select from public.campaign_players p join public.campaign_coaches c using (campaign_id)
      where p.player_id = subject and c.coach_id = auth.uid()
    )
  ));
$$;

create function private.guard_row() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name in ('competition_pairings','audit_events','mutation_receipts') then
    perform private.fail('IMMUTABLE_RECORD');
  elsif tg_op = 'DELETE' then
    if tg_table_name <> 'feedback_entries' or old.status <> 'draft' then perform private.fail('IMMUTABLE_RECORD'); end if;
    return old;
  elsif tg_table_name = 'feedback_entries' then
    if old.status = 'submitted' or
      (new.id,new.campaign_id,new.competition_id,new.coach_id,new.player_id,new.kind,new.created_at)
      is distinct from (old.id,old.campaign_id,old.competition_id,old.coach_id,old.player_id,old.kind,old.created_at)
      then perform private.fail('IMMUTABLE_RECORD'); end if;
  elsif tg_table_name = 'profiles' then
    if (new.id,new.role,new.created_at) is distinct from (old.id,old.role,old.created_at) then perform private.fail('IMMUTABLE_RECORD'); end if;
  elsif tg_table_name = 'campaigns' then
    if (new.id,new.competition_id,new.created_at) is distinct from (old.id,old.competition_id,old.created_at) then perform private.fail('IMMUTABLE_RECORD'); end if;
  elsif tg_table_name = 'competitions' then
    if (new.id,new.created_at) is distinct from (old.id,old.created_at) then perform private.fail('IMMUTABLE_RECORD'); end if;
  elsif tg_table_name = 'campaign_coaches' then
    if (new.campaign_id,new.coach_id,new.created_at) is distinct from (old.campaign_id,old.coach_id,old.created_at) then perform private.fail('IMMUTABLE_RECORD'); end if;
  elsif tg_table_name = 'campaign_players' then
    if (new.campaign_id,new.player_id,new.created_at) is distinct from (old.campaign_id,old.player_id,old.created_at) then perform private.fail('IMMUTABLE_RECORD'); end if;
  end if;
  if new.version <> old.version + 1 or new.updated_at <> current_timestamp then perform private.fail('VERSION_CONFLICT'); end if;
  return new;
end; $$;
create function private.guard_member() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'campaign_coaches' then
    if not exists (select from public.profiles where id = new.coach_id and role = 'coach') then perform private.fail('INVALID_INPUT'); end if;
  else
    if not exists (select from public.profiles where id = new.player_id and role = 'player') then perform private.fail('INVALID_INPUT'); end if;
  end if;
  return new;
end; $$;

do $$ declare t text; begin
  foreach t in array array['profiles','competitions','campaigns','campaign_coaches','campaign_players','competition_pairings','feedback_entries','audit_events','mutation_receipts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('create trigger guard_row before update or delete on public.%I for each row execute function private.guard_row()', t);
  end loop;
end $$;
create trigger guard_member before insert or update on public.campaign_coaches for each row execute function private.guard_member();
create trigger guard_member before insert or update on public.campaign_players for each row execute function private.guard_member();

create policy profile_reads on public.profiles for select to authenticated using (private.can_read_profile(id));
create policy competition_reads on public.competitions for select to authenticated using (
  private.enabled_role() = 'admin' or exists (select from public.campaigns c where c.competition_id = competitions.id and private.can_read_campaign(c.id))
);
create policy campaign_reads on public.campaigns for select to authenticated using (private.can_read_campaign(id));
create policy coach_reads on public.campaign_coaches for select to authenticated using (
  private.enabled_role() = 'admin' or (private.enabled_role() = 'coach' and coach_id = auth.uid())
);
create policy roster_reads on public.campaign_players for select to authenticated using (private.can_read_campaign(campaign_id));
create policy pairing_reads on public.competition_pairings for select to authenticated using (
  private.enabled_role() = 'admin' or (coach_id = auth.uid() and private.can_read_campaign(campaign_id))
);
create policy feedback_reads on public.feedback_entries for select to authenticated using (
  (private.enabled_role() = 'admin' and status = 'submitted') or
  (private.enabled_role() = 'coach' and coach_id = auth.uid() and private.can_read_campaign(campaign_id))
);
create policy audit_reads on public.audit_events for select to authenticated using (private.enabled_role() = 'admin');
create policy receipt_reads on public.mutation_receipts for select to authenticated using (
  private.enabled_role() = 'admin' or (actor_id = auth.uid() and private.can_read_campaign(campaign_id))
);
grant select (id, display_name) on public.profiles to authenticated;
grant select on public.competitions, public.campaigns, public.campaign_coaches, public.campaign_players,
  public.competition_pairings, public.feedback_entries, public.audit_events to authenticated;
grant select (actor_id, mutation_id, action, result_type, result_id, result_version, result_metadata, campaign_id, created_at)
  on public.mutation_receipts to authenticated;
-- Policy helpers are private, caller scoped and return no records.
grant usage on schema private to authenticated;
grant execute on function private.enabled_role(), private.can_read_campaign(uuid), private.can_read_profile(uuid) to authenticated;

create function private.clean_text(value text) returns text language sql immutable set search_path = '' as $$
  select nullif(regexp_replace(value, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
$$;
create function private.checked_date(value text) returns date language plpgsql set search_path = '' as $$
declare result date;
begin
  if value is null then return null; end if;
  if value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then perform private.fail('INVALID_INPUT'); end if;
  result := value::date;
  if not isfinite(result) or to_char(result, 'YYYY-MM-DD') <> value then perform private.fail('INVALID_INPUT'); end if;
  return result;
exception when invalid_datetime_format or datetime_field_overflow then perform private.fail('INVALID_INPUT'); return null;
end; $$;
create function private.normalize_input(value jsonb) returns jsonb language plpgsql set search_path = '' as $$
declare result jsonb := value; k text; c jsonb;
begin
  foreach k in array array['name','team_name','display_name','reason'] loop
    if result ? k then result := jsonb_set(result, array[k], coalesce(to_jsonb(btrim(result->>k)), 'null'::jsonb)); end if;
  end loop;
  if result ? 'content' then
    c := result->'content';
    if jsonb_typeof(c) <> 'object' or not c ?& array['observations','strengths','development_focus','observed_on']
      or exists (select from jsonb_object_keys(c) as x(key) where key <> all(array['observations','strengths','development_focus','observed_on']))
      then perform private.fail('INVALID_INPUT'); end if;
    foreach k in array array['observations','strengths','development_focus','observed_on'] loop
      if jsonb_typeof(c->k) not in ('string','null') then perform private.fail('INVALID_INPUT'); end if;
      if k <> 'observed_on' then c := jsonb_set(c, array[k], coalesce(to_jsonb(private.clean_text(c->>k)), 'null'::jsonb)); end if;
    end loop;
    result := jsonb_set(result, '{content}', c);
  end if;
  return result;
end; $$;
create function private.check_name(value text) returns void language plpgsql set search_path = '' as $$
begin if value is null or private.clean_text(value) is null or char_length(value) not between 1 and 160 then perform private.fail('INVALID_INPUT'); end if; end; $$;
create function private.check_reason(value text) returns void language plpgsql set search_path = '' as $$
begin if value is null or private.clean_text(value) is null or char_length(value) not between 1 and 2000 then perform private.fail('INVALID_INPUT'); end if; end; $$;
create function private.check_version(actual integer, expected integer) returns void language plpgsql set search_path = '' as $$
begin if expected is null or expected < 1 then perform private.fail('INVALID_INPUT'); end if;
  if actual <> expected then perform private.fail('VERSION_CONFLICT'); end if; end; $$;
create function private.singapore_today(at_time timestamptz) returns date language sql immutable set search_path = '' as $$
  select (at_time at time zone 'Asia/Singapore')::date;
$$;
create function private.check_content(content jsonb, submitted boolean) returns void language plpgsql set search_path = '' as $$
declare d date := private.checked_date(content->>'observed_on');
begin
  if char_length(content->>'observations') > 10000 or char_length(content->>'strengths') > 5000
    or char_length(content->>'development_focus') > 5000 then perform private.fail('INVALID_INPUT'); end if;
  if submitted and (content->>'observations' is null or d is null) then perform private.fail('INVALID_INPUT'); end if;
  if d > private.singapore_today(current_timestamp) then perform private.fail('INVALID_INPUT'); end if;
end; $$;
create function private.effect(t text, id uuid, v integer, metadata jsonb default '{}', reason text default null)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('type',t,'id',id,'version',v,'auditMetadata',metadata,
    'resultMetadata',metadata - 'before' - 'after' - 'previous_version','reason',reason);
$$;

create function private.feedback_permission(campaign uuid, player uuid, kind public.feedback_kind) returns uuid
language plpgsql set search_path = '' as $$
begin
  if kind is distinct from 'preparation'::public.feedback_kind then perform private.fail('STAGE_CLOSED'); end if;
  if not exists (select from public.campaigns where id = campaign and stage = 'preparation') then perform private.fail('STAGE_CLOSED'); end if;
  if not exists (select from public.campaign_coaches where campaign_id = campaign and coach_id = auth.uid() and is_active)
    then perform private.fail('FORBIDDEN'); end if;
  if not exists (select from public.campaign_players where campaign_id = campaign and player_id = player and is_active)
    then perform private.fail('NOT_FOUND'); end if;
  return null;
end; $$;
create function private.write_feedback(action text, p jsonb, campaign public.campaigns) returns jsonb
language plpgsql set search_path = '' as $$
declare entry public.feedback_entries; draft public.feedback_entries; id uuid; v integer; content jsonb := p->'content';
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
  perform private.feedback_permission(campaign.id,player,entry_kind);
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
    insert into public.feedback_entries(campaign_id,competition_id,coach_id,player_id,kind,status,observations,strengths,development_focus,observed_on,submitted_at)
      values (campaign.id,campaign.competition_id,auth.uid(),player,entry_kind,
        case when action = 'submit_feedback' then 'submitted'::public.feedback_status else 'draft'::public.feedback_status end,
        content->>'observations',content->>'strengths',content->>'development_focus',private.checked_date(content->>'observed_on'),
        case when action = 'submit_feedback' then current_timestamp else null end) returning * into entry;
  end if;
  return private.effect('feedback_entry',entry.id,entry.version,jsonb_build_object('coach_id',auth.uid(),'player_id',player,'version',entry.version));
end; $$;

create function private.apply_preparation(action text, p jsonb, campaign public.campaigns) returns jsonb
language plpgsql set search_path = '' as $$
declare person public.profiles; competition public.competitions; previous jsonb; target uuid;
  id uuid; v integer; target_role public.account_role; expected integer := (p->>'expected_version')::integer;
  active boolean := (p->>'active')::boolean; reason text := p->>'reason'; metadata jsonb;
  starts date; ends date;
begin
  if action in ('save_feedback_draft','submit_feedback','discard_feedback_draft') then
    return private.write_feedback(action,p,campaign);
  end if;
  if private.enabled_role() is distinct from 'admin'::public.account_role then perform private.fail('FORBIDDEN'); end if;
  if action not in ('create_profile','create_competition','create_campaign') then perform private.check_reason(reason); end if;
  if action = 'create_profile' then
    target := (p->>'profile_id')::uuid; target_role := (p->>'role')::public.account_role;
    if target_role is null or target_role = 'admin' or target is null then perform private.fail('INVALID_INPUT'); end if;
    perform private.check_name(p->>'display_name');
    if not exists (select from auth.users where auth.users.id = target) then perform private.fail('AUTH_USER_MISSING'); end if;
    if exists (select from public.profiles where profiles.id = target) then perform private.fail('PROFILE_EXISTS'); end if;
    insert into public.profiles(id,display_name,role) values (target,p->>'display_name',target_role);
    return private.effect('profile',target,1,jsonb_build_object('version',1,'after',jsonb_build_object('display_name',p->>'display_name','role',target_role,'access_enabled',false)));
  elsif action in ('update_profile_name','set_profile_access') then
    select * into person from public.profiles where profiles.id = (p->>'profile_id')::uuid;
    if not found then perform private.fail('NOT_FOUND'); end if;
    if person.role = 'admin' then perform private.fail('FORBIDDEN'); end if;
    perform private.check_version(person.version,expected);
    previous := jsonb_build_object('display_name',person.display_name,'access_enabled',person.access_enabled);
    if action = 'update_profile_name' then
      perform private.check_name(p->>'display_name'); person.display_name := p->>'display_name';
    else
      if p->>'enabled' is null then perform private.fail('INVALID_INPUT'); end if;
      person.access_enabled := (p->>'enabled')::boolean;
    end if;
    update public.profiles set display_name = person.display_name, access_enabled = person.access_enabled,
      version = version + 1, updated_at = current_timestamp where profiles.id = person.id returning version into v;
    return private.effect('profile',person.id,v,jsonb_build_object('previous_version',person.version,'version',v,'before',previous,
      'after',jsonb_build_object('display_name',person.display_name,'access_enabled',person.access_enabled)),reason);
  elsif action in ('create_competition','update_competition') then
    perform private.check_name(p->>'name'); starts := private.checked_date(p->>'starts_on'); ends := private.checked_date(p->>'ends_on');
    if ends < starts then perform private.fail('INVALID_INPUT'); end if;
    if exists (select from public.competitions where lower(btrim(name)) = lower(btrim(p->>'name')) and competitions.id is distinct from (p->>'competition_id')::uuid)
      then perform private.fail('NAME_CONFLICT'); end if;
    if action = 'create_competition' then
      insert into public.competitions(name,starts_on,ends_on) values(p->>'name',starts,ends) returning competitions.id,version into id,v;
      previous := null;
    else
      select * into competition from public.competitions where competitions.id = (p->>'competition_id')::uuid;
      if not found then perform private.fail('NOT_FOUND'); end if;
      perform private.check_version(competition.version,expected);
      previous := jsonb_build_object('name',competition.name,'starts_on',competition.starts_on,'ends_on',competition.ends_on);
      update public.competitions set name = p->>'name',starts_on = starts,ends_on = ends,version = version + 1,updated_at = current_timestamp
        where competitions.id = competition.id returning competitions.id,version into id,v;
    end if;
    return private.effect('competition',id,v,jsonb_build_object('version',v,'before',previous,'after',jsonb_build_object('name',p->>'name','starts_on',starts,'ends_on',ends)),reason);
  elsif action in ('create_campaign','update_campaign_metadata') then
    perform private.check_name(p->>'name'); perform private.check_name(p->>'team_name');
    target := coalesce(campaign.competition_id,(p->>'competition_id')::uuid);
    if not exists (select from public.competitions where competitions.id = target) then perform private.fail('NOT_FOUND'); end if;
    if exists (select from public.campaigns where competition_id = target and lower(btrim(team_name)) = lower(btrim(p->>'team_name')) and campaigns.id is distinct from campaign.id)
      then perform private.fail('NAME_CONFLICT'); end if;
    if action = 'create_campaign' then
      insert into public.campaigns(competition_id,name,team_name,planned_preparation_start_on)
        values(target,p->>'name',p->>'team_name',private.checked_date(p->>'planned_preparation_start_on')) returning campaigns.id,version into id,v;
      previous := null;
    else
      perform private.check_version(campaign.version,expected);
      previous := jsonb_build_object('name',campaign.name,'team_name',campaign.team_name,'planned_preparation_start_on',campaign.planned_preparation_start_on);
      update public.campaigns set name = p->>'name',team_name = p->>'team_name',planned_preparation_start_on = private.checked_date(p->>'planned_preparation_start_on'),
        version = version + 1,updated_at = current_timestamp where campaigns.id = campaign.id returning campaigns.id,version into id,v;
    end if;
    return private.effect('campaign',id,v,jsonb_build_object('version',v,'before',previous,'after',jsonb_build_object('name',p->>'name','team_name',p->>'team_name','planned_preparation_start_on',p->>'planned_preparation_start_on')),reason);
  elsif action in ('set_campaign_coach','set_campaign_player') then
    target := coalesce((p->>'coach_id')::uuid,(p->>'player_id')::uuid);
    target_role := case when action = 'set_campaign_coach' then 'coach'::public.account_role else 'player'::public.account_role end;
    if active is null or not exists (select from public.profiles where profiles.id = target and profiles.role = target_role) then perform private.fail('INVALID_INPUT'); end if;
    if target_role = 'coach' then
      select version,to_jsonb(is_active) into v,previous from public.campaign_coaches where campaign_id = campaign.id and coach_id = target for update;
    else
      select version,to_jsonb(is_active) into v,previous from public.campaign_players where campaign_id = campaign.id and player_id = target for update;
    end if;
    if v is null then
      if expected is not null or not active then perform private.fail('INVALID_INPUT'); end if;
      if campaign.stage not in ('setup','preparation') then perform private.fail('STAGE_LOCKED'); end if;
      if target_role = 'coach' then insert into public.campaign_coaches(campaign_id,coach_id,is_active) values(campaign.id,target,active);
      else insert into public.campaign_players(campaign_id,player_id,is_active) values(campaign.id,target,active); end if;
      v := 1;
    else
      perform private.check_version(v,expected);
      if target_role = 'player' and active and campaign.stage not in ('setup','preparation') then perform private.fail('STAGE_LOCKED'); end if;
      if campaign.stage = 'closed' then perform private.fail('STAGE_LOCKED'); end if;
      if target_role = 'coach' then update public.campaign_coaches set is_active = active,version = version + 1,updated_at = current_timestamp where campaign_id = campaign.id and coach_id = target;
      else update public.campaign_players set is_active = active,version = version + 1,updated_at = current_timestamp where campaign_id = campaign.id and player_id = target; end if;
      v := v + 1;
    end if;
    if active then
      if exists (select from public.campaign_coaches c cross join public.campaign_players r join public.competition_pairings b on b.coach_id = c.coach_id and b.player_id = r.player_id
          where c.campaign_id = campaign.id and r.campaign_id = campaign.id and c.is_active and r.is_active and b.competition_id = campaign.competition_id and b.campaign_id <> campaign.id)
        then perform private.fail('PAIR_CONFLICT'); end if;
      insert into public.competition_pairings(competition_id,coach_id,player_id,campaign_id)
        select campaign.competition_id,c.coach_id,r.player_id,campaign.id from public.campaign_coaches c cross join public.campaign_players r
        where c.campaign_id = campaign.id and r.campaign_id = campaign.id and c.is_active and r.is_active
        on conflict (competition_id,coach_id,player_id) do nothing;
    end if;
    metadata := jsonb_build_object(case when target_role = 'coach' then 'coach_id' else 'player_id' end,target,'version',v,'before',previous,'after',active);
    return private.effect(case when target_role = 'coach' then 'campaign_coach' else 'campaign_player' end,campaign.id,v,metadata,reason);
  elsif action = 'advance_campaign_stage' then
    perform private.check_version(campaign.version,expected);
    if campaign.stage <> 'setup' or p->>'next_stage' <> 'preparation' then perform private.fail('STAGE_CONFLICT'); end if;
    update public.campaigns set stage = 'preparation', version = version + 1, updated_at = current_timestamp where campaigns.id = campaign.id returning version into v;
    return private.effect('campaign',campaign.id,v,jsonb_build_object('stage','preparation','obligations_created',0,'drafts_deleted',0),reason);
  end if;
  perform private.fail('INVALID_INPUT'); return null;
end; $$;
create function private.apply_action(action text, p jsonb, campaign public.campaigns) returns jsonb
language sql set search_path = '' as $$ select private.apply_preparation(action,p,campaign); $$;

create function private.receipt_result(r public.mutation_receipts) returns jsonb language plpgsql set search_path = '' as $$
declare available boolean; result jsonb;
begin
  case r.result_type
    when 'profile' then available := exists (select from public.profiles where id = r.result_id);
    when 'competition' then available := exists (select from public.competitions where id = r.result_id);
    when 'campaign' then available := exists (select from public.campaigns where id = r.result_id);
    when 'campaign_coach' then available := exists (select from public.campaign_coaches where campaign_id = r.result_id and coach_id = (r.result_metadata->>'coach_id')::uuid);
    when 'campaign_player' then available := exists (select from public.campaign_players where campaign_id = r.result_id and player_id = (r.result_metadata->>'player_id')::uuid);
    when 'feedback_entry' then available := exists (select from public.feedback_entries where id = r.result_id);
    else available := false;
  end case;
  result := jsonb_build_object('type',r.result_type,'version',r.result_version,'exists',available,'metadata',r.result_metadata);
  if r.result_type = 'campaign_coach' then return result || jsonb_build_object('campaignId',r.result_id,'coachId',r.result_metadata->>'coach_id'); end if;
  if r.result_type = 'campaign_player' then return result || jsonb_build_object('campaignId',r.result_id,'playerId',r.result_metadata->>'player_id'); end if;
  return result || jsonb_build_object('id',r.result_id);
end; $$;

create function private.mutate(action text, mutation uuid, input jsonb) returns jsonb
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
  if action = 'discard_feedback_draft' then
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

create function public.get_my_access() returns jsonb language plpgsql security definer set search_path = '' as $$
declare p public.profiles;
begin
  if auth.uid() is null then perform private.fail('AUTH_REQUIRED'); end if;
  select * into p from public.profiles where id = auth.uid();
  if not found then return jsonb_build_object('status','missing'); end if;
  return jsonb_build_object('status','present','id',p.id,'displayName',p.display_name,'role',p.role,'enabled',p.access_enabled,'version',p.version);
end; $$;
create function public.admin_list_profiles(role_filter public.account_role default null, page_cursor jsonb default null, page_size integer default 20)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare rows jsonb; cursor jsonb;
begin
  if auth.uid() is null then perform private.fail('AUTH_REQUIRED'); end if;
  if private.enabled_role() is distinct from 'admin'::public.account_role then perform private.fail('FORBIDDEN'); end if;
  if page_size is null or page_size not between 1 and 100 or (page_cursor is not null and
    (jsonb_typeof(page_cursor) <> 'object' or not page_cursor ?& array['createdAt','id'] or
     (select count(*) from jsonb_object_keys(page_cursor)) <> 2)) then perform private.fail('INVALID_INPUT'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'displayName',display_name,'role',role,'enabled',access_enabled,'version',version,'createdAt',created_at) order by created_at,id),'[]') into rows
    from (select * from public.profiles where (role_filter is null or role = role_filter) and
      (page_cursor is null or (created_at,id) > ((page_cursor->>'createdAt')::timestamptz,(page_cursor->>'id')::uuid)) order by created_at,id limit page_size + 1) p;
  if jsonb_array_length(rows) > page_size then
    rows := rows - page_size;
    cursor := jsonb_build_object('createdAt',rows->(page_size-1)->'createdAt','id',rows->(page_size-1)->'id');
  end if;
  return jsonb_build_object('items',rows,'nextCursor',cursor);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then perform private.fail('INVALID_INPUT'); return null;
end; $$;

create function public.create_profile(mutation_id uuid, profile_id uuid, display_name text, role public.account_role) returns jsonb
language sql security definer set search_path = '' as $$
  select private.mutate('create_profile',mutation_id,jsonb_build_object('profile_id',profile_id,'display_name',display_name,'role',role));
$$;
revoke all on function public.create_profile(uuid,uuid,text,public.account_role) from public, anon, authenticated;
grant execute on function public.create_profile(uuid,uuid,text,public.account_role) to authenticated;

create function public.update_profile_name(mutation_id uuid, profile_id uuid, display_name text, expected_version integer, reason text) returns jsonb
language sql security definer set search_path = '' as $$
  select private.mutate('update_profile_name',mutation_id,jsonb_build_object('profile_id',profile_id,'display_name',display_name,'expected_version',expected_version,'reason',reason));
$$;
revoke all on function public.update_profile_name(uuid,uuid,text,integer,text) from public, anon, authenticated;
grant execute on function public.update_profile_name(uuid,uuid,text,integer,text) to authenticated;

create function public.set_profile_access(mutation_id uuid, profile_id uuid, enabled boolean, expected_version integer, reason text) returns jsonb
language sql security definer set search_path = '' as $$
  select private.mutate('set_profile_access',mutation_id,jsonb_build_object('profile_id',profile_id,'enabled',enabled,'expected_version',expected_version,'reason',reason));
$$;
revoke all on function public.set_profile_access(uuid,uuid,boolean,integer,text) from public, anon, authenticated;
grant execute on function public.set_profile_access(uuid,uuid,boolean,integer,text) to authenticated;

create function public.create_competition(mutation_id uuid, name text, starts_on text, ends_on text) returns jsonb
language sql security definer set search_path = '' as $$
  select private.mutate('create_competition',mutation_id,jsonb_build_object('name',name,'starts_on',starts_on,'ends_on',ends_on));
$$;
revoke all on function public.create_competition(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.create_competition(uuid,text,text,text) to authenticated;

create function public.update_competition(mutation_id uuid, competition_id uuid, name text, starts_on text, ends_on text, expected_version integer, reason text) returns jsonb
language sql security definer set search_path = '' as $$
  select private.mutate('update_competition',mutation_id,jsonb_build_object('competition_id',competition_id,'name',name,'starts_on',starts_on,'ends_on',ends_on,'expected_version',expected_version,'reason',reason));
$$;
revoke all on function public.update_competition(uuid,uuid,text,text,text,integer,text) from public, anon, authenticated;
grant execute on function public.update_competition(uuid,uuid,text,text,text,integer,text) to authenticated;

create function public.create_campaign(mutation_id uuid, competition_id uuid, name text, team_name text, planned_preparation_start_on text) returns jsonb
language sql security definer set search_path = '' as $$
  select private.mutate('create_campaign',mutation_id,jsonb_build_object('competition_id',competition_id,'name',name,'team_name',team_name,'planned_preparation_start_on',planned_preparation_start_on));
$$;
revoke all on function public.create_campaign(uuid,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.create_campaign(uuid,uuid,text,text,text) to authenticated;

create function public.update_campaign_metadata(mutation_id uuid, campaign_id uuid, name text, team_name text, planned_preparation_start_on text, expected_version integer, reason text) returns jsonb
language sql security definer set search_path = '' as $$
  select private.mutate('update_campaign_metadata',mutation_id,jsonb_build_object('campaign_id',campaign_id,'name',name,'team_name',team_name,'planned_preparation_start_on',planned_preparation_start_on,'expected_version',expected_version,'reason',reason));
$$;
revoke all on function public.update_campaign_metadata(uuid,uuid,text,text,text,integer,text) from public, anon, authenticated;
grant execute on function public.update_campaign_metadata(uuid,uuid,text,text,text,integer,text) to authenticated;

create function public.set_campaign_coach(mutation_id uuid, campaign_id uuid, coach_id uuid, active boolean, expected_version integer, reason text) returns jsonb
language sql security definer set search_path = '' as $$
  select private.mutate('set_campaign_coach',mutation_id,jsonb_build_object('campaign_id',campaign_id,'coach_id',coach_id,'active',active,'expected_version',expected_version,'reason',reason));
$$;
revoke all on function public.set_campaign_coach(uuid,uuid,uuid,boolean,integer,text) from public, anon, authenticated;
grant execute on function public.set_campaign_coach(uuid,uuid,uuid,boolean,integer,text) to authenticated;

create function public.set_campaign_player(mutation_id uuid, campaign_id uuid, player_id uuid, active boolean, expected_version integer, reason text) returns jsonb
language sql security definer set search_path = '' as $$
  select private.mutate('set_campaign_player',mutation_id,jsonb_build_object('campaign_id',campaign_id,'player_id',player_id,'active',active,'expected_version',expected_version,'reason',reason));
$$;
revoke all on function public.set_campaign_player(uuid,uuid,uuid,boolean,integer,text) from public, anon, authenticated;
grant execute on function public.set_campaign_player(uuid,uuid,uuid,boolean,integer,text) to authenticated;

create function public.advance_campaign_stage(mutation_id uuid, campaign_id uuid, expected_version integer, next_stage public.campaign_stage, reason text) returns jsonb
language sql security definer set search_path = '' as $$
  select private.mutate('advance_campaign_stage',mutation_id,jsonb_build_object('campaign_id',campaign_id,'expected_version',expected_version,'next_stage',next_stage,'reason',reason));
$$;
revoke all on function public.advance_campaign_stage(uuid,uuid,integer,public.campaign_stage,text) from public, anon, authenticated;
grant execute on function public.advance_campaign_stage(uuid,uuid,integer,public.campaign_stage,text) to authenticated;

create function public.save_feedback_draft(mutation_id uuid, campaign_id uuid, player_id uuid, kind public.feedback_kind, content jsonb, review_confirmed boolean, draft_id uuid, expected_version integer) returns jsonb
language sql security definer set search_path = '' as $$
  select private.mutate('save_feedback_draft',mutation_id,jsonb_build_object('campaign_id',campaign_id,'player_id',player_id,'kind',kind,'content',content,'review_confirmed',review_confirmed,'draft_id',draft_id,'expected_version',expected_version));
$$;
revoke all on function public.save_feedback_draft(uuid,uuid,uuid,public.feedback_kind,jsonb,boolean,uuid,integer) from public, anon, authenticated;
grant execute on function public.save_feedback_draft(uuid,uuid,uuid,public.feedback_kind,jsonb,boolean,uuid,integer) to authenticated;

create function public.discard_feedback_draft(mutation_id uuid, draft_id uuid, expected_version integer) returns jsonb
language sql security definer set search_path = '' as $$
  select private.mutate('discard_feedback_draft',mutation_id,jsonb_build_object('draft_id',draft_id,'expected_version',expected_version));
$$;
revoke all on function public.discard_feedback_draft(uuid,uuid,integer) from public, anon, authenticated;
grant execute on function public.discard_feedback_draft(uuid,uuid,integer) to authenticated;

create function public.submit_feedback(mutation_id uuid, campaign_id uuid, player_id uuid, kind public.feedback_kind, content jsonb, review_confirmed boolean, draft_id uuid, expected_version integer) returns jsonb
language sql security definer set search_path = '' as $$
  select private.mutate('submit_feedback',mutation_id,jsonb_build_object('campaign_id',campaign_id,'player_id',player_id,'kind',kind,'content',content,'review_confirmed',review_confirmed,'draft_id',draft_id,'expected_version',expected_version));
$$;
revoke all on function public.submit_feedback(uuid,uuid,uuid,public.feedback_kind,jsonb,boolean,uuid,integer) from public, anon, authenticated;
grant execute on function public.submit_feedback(uuid,uuid,uuid,public.feedback_kind,jsonb,boolean,uuid,integer) to authenticated;

revoke all on function public.get_my_access(), public.admin_list_profiles(public.account_role,jsonb,integer) from public, anon, authenticated;
grant execute on function public.get_my_access(), public.admin_list_profiles(public.account_role,jsonb,integer) to authenticated;
