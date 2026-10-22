-- TEST PROJECT ONLY: nyavvwrsrxqfyhiygkgw. Never run on production.
-- Incremental migration after setup-test-project.sql. Does not reset groups.
begin;
-- Require the protected-group schema; a live legacy database must fail here.
do $$ begin
 if to_regclass('iig_private.group_owners') is null then
   raise exception 'STOP: protected test schema is required';
 end if;
end $$;
create table if not exists iig_private.registration_settings (
 singleton boolean primary key default true check(singleton), enabled boolean not null default false
);
create table if not exists iig_private.platform_owners (
 user_id uuid primary key references auth.users(id) on delete cascade
);
alter table iig_private.registration_settings enable row level security;
alter table iig_private.platform_owners enable row level security;
revoke all on iig_private.registration_settings,iig_private.platform_owners from public,anon,authenticated;
-- Open self-service in the isolated test project. Existing account and per-account limits remain.
insert into iig_private.registration_settings values(true,true) on conflict(singleton) do nothing;
create or replace function public.iig_create_owned_group(p_name text,p_organiser_name text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := iig_private.verified_organiser();
  v_existing iig_private.group_owners%rowtype;
  v_pin text; v_id bigint; v_try integer; v_name text := btrim(p_name);
begin
  if not exists(select 1 from iig_private.registration_settings where singleton and enabled)
     and not exists(select 1 from iig_private.setup_testers where user_id=v_uid)
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


create or replace function public.iig_list_registered_groups(p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := iig_private.verified_organiser(); v_result jsonb;
begin
 if not exists(select 1 from iig_private.platform_owners where user_id=v_uid)
 then raise exception 'Platform owner access required' using errcode='42501'; end if;
 if p_offset is null or p_offset < 0 then raise exception 'Invalid offset'; end if;
 select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_result from (
   select g.group_pin,g.group_name,g.admin_name,g.admin_contact,g.created_at,
     g.plan_type,g.trial_expiry_date,g.paid_status,g.renewal_date,g.status,g.updated_at
   from public.tens_in_groups g join iig_private.group_owners o on o.group_id=g.id
   order by g.created_at desc,g.id desc limit 100 offset p_offset
 ) r;
 return v_result;
end $$;
revoke all on function public.iig_list_registered_groups(integer) from public,anon;
grant execute on function public.iig_list_registered_groups(integer) to authenticated;
-- Only the already-verified test account Greg supplied receives owner visibility.
insert into iig_private.platform_owners(user_id)
select id from auth.users
where id='fe686929-8e8a-408a-b1f5-f1129fcfa50b' and email_confirmed_at is not null
 and coalesce(is_anonymous,false)=false
on conflict do nothing;
commit;
