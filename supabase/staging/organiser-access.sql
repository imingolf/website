-- STAGING ONLY. Not a production migration: the legacy client has no v2 adapter.
-- Apply once to a disposable copy of the inventoried schema, never the live project.
begin;

create schema iig_private;
revoke all on schema iig_private from public, anon, authenticated;

-- An explicit tester allowlist keeps registration closed during integration.
create table iig_private.setup_testers (
  user_id uuid primary key references auth.users(id) on delete cascade
);
create table iig_private.group_owners (
  group_id bigint primary key references public.tens_in_groups(id) on delete cascade,
  owner_id uuid not null unique references auth.users(id) on delete restrict,
  request_id uuid not null,
  requested_name text not null,
  invite_token uuid not null default gen_random_uuid(),
  revision bigint not null default 0,
  created_at timestamptz not null default now()
);
create table iig_private.group_members (
  group_id bigint not null references iig_private.group_owners(group_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  player_id uuid not null default gen_random_uuid(),
  primary key(group_id,user_id),
  unique(group_id,player_id)
);
alter table iig_private.setup_testers enable row level security;
alter table iig_private.group_owners enable row level security;
alter table iig_private.group_members enable row level security;
revoke all on all tables in schema iig_private from public, anon, authenticated;

-- Fail rather than silently deleting/renumbering a pre-existing duplicate.
create unique index iig_group_pin_unique on public.tens_in_groups(group_pin);

create function iig_private.verified_organiser() returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not exists (
    select 1 from auth.users where id=v_uid and email_confirmed_at is not null
      and email is not null and coalesce(is_anonymous,false)=false
      and (banned_until is null or banned_until <= now())
  ) then raise exception 'Verified organiser sign-in required' using errcode='42501'; end if;
  return v_uid;
end $$;

create function iig_private.check_group_access(p_pin text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce((select access_allowed from public.get_group_access_status(p_pin) limit 1),false)
  then raise exception 'Group access unavailable' using errcode='42501'; end if;
end $$;

create function public.iig_create_owned_group(p_name text,p_organiser_name text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := iig_private.verified_organiser();
  v_existing iig_private.group_owners%rowtype;
  v_pin text; v_id bigint; v_try integer; v_name text := btrim(p_name);
begin
  if not exists(select 1 from iig_private.setup_testers where user_id=v_uid)
  then raise exception 'Registration is not open yet' using errcode='42501'; end if;
  if p_request_id is null or v_name is null or length(v_name) not between 1 and 80
    or p_organiser_name is null or length(btrim(p_organiser_name)) not between 1 and 80
  then raise exception 'Enter a group name and organiser name (1–80 characters)'; end if;
  -- Serialise requests by account, including requests with different idempotency keys.
  perform 1 from auth.users where id=v_uid for update;
  select * into v_existing from iig_private.group_owners where owner_id=v_uid;
  if found then
    if v_existing.request_id<>p_request_id or v_existing.requested_name<>v_name
    then raise exception 'This organiser already has a group'; end if;
    select group_pin into v_pin from public.tens_in_groups where id=v_existing.group_id;
    return jsonb_build_object('group_pin',v_pin,'group_id',v_existing.group_id);
  end if;
  for v_try in 1..100 loop
    v_pin := (1000+floor(random()*9000))::integer::text;
    begin
      -- Preserve existing trial/plan defaults and notification triggers.
      insert into public.tens_in_groups(group_name,group_pin,state,admin_name,admin_contact)
      values(v_name,v_pin,jsonb_build_object('groupName',v_name,'course','','date','',
        'stake',0,'gameType','money','roundOpen',false,'pointsCompetition','stableford',
        'pointsValue',10,'players','[]'::jsonb,'history','[]'::jsonb),
        btrim(p_organiser_name),(select email from auth.users where id=v_uid)) returning id into v_id;
      exit;
    exception when unique_violation then
      if not exists(select 1 from public.tens_in_groups where group_pin=v_pin) then raise; end if;
      v_id := null;
    end;
  end loop;
  if v_id is null then raise exception 'No group PIN available; try again'; end if;
  insert into iig_private.group_owners(group_id,owner_id,request_id,requested_name)
  values(v_id,v_uid,p_request_id,v_name);
  return jsonb_build_object('group_pin',v_pin,'group_id',v_id);
end $$;

create function public.iig_get_owned_group() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := iig_private.verified_organiser(); v_result jsonb;
begin
  select jsonb_build_object('group_pin',g.group_pin,'group_id',g.id,'state',g.state,
    'revision',o.revision,'invite_token',o.invite_token) into v_result
  from iig_private.group_owners o join public.tens_in_groups g on g.id=o.group_id
  where o.owner_id=v_uid;
  if v_result is not null then perform iig_private.check_group_access(v_result->>'group_pin'); end if;
  return v_result;
end $$;

create function public.iig_save_owned_group(p_pin text,p_state jsonb,p_revision bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := iig_private.verified_organiser(); v_id bigint; v_revision bigint;
begin
  select o.group_id,o.revision into v_id,v_revision from iig_private.group_owners o
    join public.tens_in_groups g on g.id=o.group_id
    where g.group_pin=p_pin and o.owner_id=v_uid for update of o;
  if not found then raise exception 'Organiser access required' using errcode='42501'; end if;
  perform iig_private.check_group_access(p_pin);
  if p_revision is null or p_revision<>v_revision
  then raise exception 'Group changed; reload before saving' using errcode='40001'; end if;
  if p_state is null or jsonb_typeof(p_state)<>'object'
    or jsonb_typeof(p_state->'players') is distinct from 'array'
    or jsonb_typeof(p_state->'history') is distinct from 'array'
    or p_state ?| array['adminPin','adminSetupToken'] or octet_length(p_state::text)>1048576
  then raise exception 'Invalid group state'; end if;
  update public.tens_in_groups set state=p_state,updated_at=now() where id=v_id;
  update iig_private.group_owners set revision=revision+1 where group_id=v_id returning revision into v_revision;
  return v_revision;
end $$;

-- Players use a signed device identity, not a user-supplied player ID.
-- In staging only, enable Supabase anonymous auth + CAPTCHA for account-free joining.
create function public.iig_join_owned_group(p_pin text,p_invite uuid,p_name text,p_handicap numeric)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_id bigint; v_player uuid; v_state jsonb;
begin
  if v_uid is null then raise exception 'Player session required' using errcode='42501'; end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 80 or p_handicap is null
    or p_handicap not between -10 and 60 or p_handicap<>round(p_handicap,1)
  then raise exception 'Invalid player name or handicap'; end if;
  select o.group_id into v_id from iig_private.group_owners o
    join public.tens_in_groups g on g.id=o.group_id
    where g.group_pin=p_pin and o.invite_token=p_invite for update of o;
  if not found then raise exception 'Invitation is invalid' using errcode='42501'; end if;
  perform iig_private.check_group_access(p_pin);
  select player_id into v_player from iig_private.group_members where group_id=v_id and user_id=v_uid;
  if found then return v_player; end if;
  select state into v_state from public.tens_in_groups where id=v_id;
  if jsonb_array_length(v_state->'players')>=200 then raise exception 'Test group capacity reached'; end if;
  insert into iig_private.group_members(group_id,user_id) values(v_id,v_uid) returning player_id into v_player;
  update public.tens_in_groups set state=jsonb_set(state,'{players}',(state->'players') ||
    jsonb_build_array(jsonb_build_object('id',v_player,'name',btrim(p_name),'handicap',p_handicap,
      'paid',false,'stableford',null,'netScore',null,'playingThisRound',false))),updated_at=now() where id=v_id;
  update iig_private.group_owners set revision=revision+1 where group_id=v_id;
  return v_player;
end $$;

create function public.iig_get_player_group(p_pin text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_state jsonb; v_player uuid; v_out jsonb; v_revision bigint;
begin
  select g.state,m.player_id,o.revision into v_state,v_player,v_revision
    from public.tens_in_groups g join iig_private.group_owners o on o.group_id=g.id
    join iig_private.group_members m on m.group_id=g.id
    where g.group_pin=p_pin and m.user_id=auth.uid();
  if not found then raise exception 'Group membership required' using errcode='42501'; end if;
  perform iig_private.check_group_access(p_pin);
  -- Explicit projections: future admin-only fields cannot leak by default.
  select coalesce(jsonb_object_agg(key,value),'{}') into v_out from jsonb_each(v_state)
    where key=any(array['groupName','course','date','roundOpen','pointsCompetition','gameType']);
  return jsonb_build_object('state',v_out || jsonb_build_object('players',(
    select coalesce(jsonb_agg(jsonb_build_object('id',p->'id','name',p->'name','handicap',p->'handicap',
      'playingThisRound',p->'playingThisRound','stableford',p->'stableford','netScore',p->'netScore',
      'scoreSubmitted',p->'scoreSubmitted')),'[]') from jsonb_array_elements(v_state->'players') p)),
    'player_id',v_player,'revision',v_revision);
end $$;

-- Narrow first player action; scores/payments/trips must get dedicated endpoints.
-- Do NOT fall back to whole-state writes for unsupported actions.
create function public.iig_set_my_attendance(p_pin text,p_attending boolean,p_revision bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_id bigint; v_player uuid; v_state jsonb; v_revision bigint; v_players jsonb;
begin
  select o.group_id,o.revision,m.player_id into v_id,v_revision,v_player
    from iig_private.group_owners o join public.tens_in_groups g on g.id=o.group_id
    join iig_private.group_members m on m.group_id=g.id
    where g.group_pin=p_pin and m.user_id=auth.uid() for update of o;
  if not found then raise exception 'Group membership required' using errcode='42501'; end if;
  perform iig_private.check_group_access(p_pin);
  if p_attending is null or p_revision is null or p_revision<>v_revision
  then raise exception 'Group changed; reload before saving' using errcode='40001'; end if;
  select state into v_state from public.tens_in_groups where id=v_id;
  if v_state->'roundOpen' is distinct from 'true'::jsonb or exists(
    select 1 from jsonb_array_elements(v_state->'players') p
    where p->'scoreSubmitted'='true'::jsonb or p->'noReturn'='true'::jsonb
      or (p->>'stableford') is not null or (p->>'netScore') is not null)
  then raise exception 'Entries are closed'; end if;
  if not exists(select 1 from jsonb_array_elements(v_state->'players') p where p->>'id'=v_player::text)
  then raise exception 'Player no longer in group' using errcode='42501'; end if;
  select jsonb_agg(case when p->>'id'=v_player::text
    then p || jsonb_build_object('playingThisRound',p_attending) else p end order by pos)
    into v_players from jsonb_array_elements(v_state->'players') with ordinality as entries(p,pos);
  update public.tens_in_groups set state=jsonb_set(state,'{players}',v_players),updated_at=now() where id=v_id;
  update iig_private.group_owners set revision=revision+1 where group_id=v_id returning revision into v_revision;
  return v_revision;
end $$;

-- Close the legacy RPC bypass FOR OWNED TEST GROUPS ONLY. Existing groups retain
-- their exact old path until every client action and organiser migration is ready.
create or replace function public.get_group_state(p_pin text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if exists(select 1 from public.tens_in_groups g join iig_private.group_owners o on o.group_id=g.id where g.group_pin=p_pin)
  then raise exception 'Use the secure group client' using errcode='42501'; end if;
  return (select state from public.tens_in_groups where group_pin=p_pin order by id limit 1);
end $$;
create or replace function public.save_group_state(p_pin text,p_state jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if exists(select 1 from public.tens_in_groups g join iig_private.group_owners o on o.group_id=g.id where g.group_pin=p_pin)
  then raise exception 'Use the secure group client' using errcode='42501'; end if;
  update public.tens_in_groups set state=p_state,updated_at=now()
    where id=(select id from public.tens_in_groups where group_pin=p_pin order by id limit 1);
  return found;
end $$;

revoke all on all functions in schema iig_private from public, anon, authenticated;
revoke all on function public.iig_create_owned_group(text,text,uuid),public.iig_get_owned_group(),
  public.iig_save_owned_group(text,jsonb,bigint),public.iig_join_owned_group(text,uuid,text,numeric),
  public.iig_get_player_group(text),public.iig_set_my_attendance(text,boolean,bigint) from public,anon;
grant execute on function public.iig_create_owned_group(text,text,uuid),public.iig_get_owned_group(),
  public.iig_save_owned_group(text,jsonb,bigint),public.iig_join_owned_group(text,uuid,text,numeric),
  public.iig_get_player_group(text),public.iig_set_my_attendance(text,boolean,bigint) to authenticated;
commit;
