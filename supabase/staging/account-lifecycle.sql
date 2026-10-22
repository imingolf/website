-- STAGING ONLY. Prepared source, never executed against a hosted database by this change.
begin;
create table iig_private.account_deletions(user_id uuid primary key,requested_at timestamptz not null default now());
create table iig_private.owner_transfers(
 token uuid primary key default gen_random_uuid(),group_id bigint not null references iig_private.group_owners(group_id) on delete cascade,
 from_user uuid not null references auth.users(id) on delete cascade,to_user uuid not null references auth.users(id) on delete cascade,
 expires_at timestamptz not null default now()+interval '24 hours',accepted_at timestamptz
);
alter table iig_private.account_deletions enable row level security;
alter table iig_private.owner_transfers enable row level security;
revoke all on iig_private.account_deletions,iig_private.owner_transfers from public,anon,authenticated;
create or replace function iig_private.verified_organiser() returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid=auth.uid();
begin
 perform 1 from auth.users where id=uid for update;
 if uid is null or exists(select 1 from iig_private.account_deletions where user_id=uid) or not exists(
 select 1 from auth.users where id=uid and email_confirmed_at is not null and email is not null and coalesce(is_anonymous,false)=false and (banned_until is null or banned_until<=now()))
 then raise exception 'Verified organiser sign-in required' using errcode='42501'; end if;
 return uid;
end $$;
create function iig_private.recent_signin() returns void language plpgsql security definer set search_path='' as $$
declare claims jsonb=coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;
begin
 if not exists(select 1 from jsonb_array_elements(coalesce(claims->'amr','[]')) a where a->>'method'='otp'
 and (a->>'timestamp')::numeric between extract(epoch from now())-600 and extract(epoch from now())+30)
 then raise exception 'Sign out and verify a fresh email code within ten minutes before this account change' using errcode='42501'; end if;
end $$;
create function public.iig_request_owner_transfer(p_email text) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid=iig_private.verified_organiser(); target uuid; gid bigint; tok uuid;
begin
 perform iig_private.recent_signin();
 select id into target from auth.users where lower(email)=lower(btrim(p_email)) and email_confirmed_at is not null and not coalesce(is_anonymous,false) and (banned_until is null or banned_until<=now());
 if target is null or target=uid then raise exception 'Choose another verified member email'; end if;
 perform pg_advisory_xact_lock(hashtextextended(x::text,0)) from unnest(array[uid,target]) x order by x;
 select group_id into gid from iig_private.group_owners where owner_id=uid for update;
 if gid is null or not exists(select 1 from iig_private.group_members where group_id=gid and user_id=target)
 or exists(select 1 from iig_private.group_owners where owner_id=target) or exists(select 1 from iig_private.account_deletions where user_id=target)
 then raise exception 'Choose a verified member who does not already own a group'; end if;
 delete from iig_private.owner_transfers where group_id=gid and accepted_at is null;
 insert into iig_private.owner_transfers(group_id,from_user,to_user) values(gid,uid,target) returning token into tok;
 return tok;
end $$;
create function public.iig_accept_owner_transfer(p_token uuid) returns text
language plpgsql security definer set search_path='' as $$
declare uid uuid=iig_private.verified_organiser(); t iig_private.owner_transfers; pin text;
begin
 perform iig_private.recent_signin();
 select * into t from iig_private.owner_transfers where token=p_token and to_user=uid;
 if not found then raise exception 'No ownership transfer for your account' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(x::text,0)) from unnest(array[t.from_user,uid]) x order by x;
 perform 1 from iig_private.group_owners where group_id=t.group_id and owner_id=t.from_user for update;
 if not found or t.accepted_at is not null or t.expires_at<=now() or not exists(select 1 from iig_private.owner_transfers where token=p_token and accepted_at is null)
 or exists(select 1 from iig_private.group_owners where owner_id=uid) or exists(select 1 from iig_private.account_deletions where user_id=uid)
 then raise exception 'Ownership transfer expired or no longer available'; end if;
 update iig_private.group_owners set owner_id=uid,invite_token=gen_random_uuid(),revision=revision+1 where group_id=t.group_id;
 update public.tens_in_groups g set admin_contact=u.email,admin_name=coalesce((select p->>'name' from jsonb_array_elements(g.state->'players') p join iig_private.group_members m on m.player_id::text=p->>'id' where m.group_id=g.id and m.user_id=uid),g.admin_name)
 from auth.users u where g.id=t.group_id and u.id=uid;
 update iig_private.owner_transfers set accepted_at=now() where token=p_token;
 select group_pin into pin from public.tens_in_groups where id=t.group_id;
 return pin;
end $$;
create function public.iig_prepare_account_deletion() returns boolean
language plpgsql security definer set search_path='' as $$
declare uid uuid=auth.uid();
begin
 -- Retries remain possible after access has been revoked but before Auth deletion succeeds.
 if uid is null or not exists(select 1 from auth.users where id=uid and email_confirmed_at is not null and not coalesce(is_anonymous,false) and (banned_until is null or banned_until<=now())) then raise exception 'Verified account required' using errcode='42501'; end if;
 perform iig_private.recent_signin();
 perform 1 from auth.users where id=uid for update;
 perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
 if exists(select 1 from iig_private.group_owners where owner_id=uid) then raise exception 'Transfer your group to another verified member before deleting your account'; end if;
 if exists(select 1 from iig_private.platform_owners where user_id=uid) then raise exception 'Transfer platform ownership before deleting this account'; end if;
 insert into iig_private.account_deletions(user_id) values(uid) on conflict do nothing;
 -- Golf players and historical rows remain. Auth's deletion cascades identity mappings only.
 return true;
end $$;
-- Supabase changes auth.users.email only after the configured confirmation flow.
-- Keep the private owner register in sync without rewriting any golf JSON.
create function iig_private.sync_owner_email() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.email is distinct from old.email and new.email_confirmed_at is not null then
  update public.tens_in_groups g set admin_contact=new.email from iig_private.group_owners o
  where g.id=o.group_id and o.owner_id=new.id;
 end if;
 return new;
end $$;
create trigger iig_sync_owner_email after update of email on auth.users for each row execute function iig_private.sync_owner_email();
revoke all on function iig_private.sync_owner_email() from public,anon,authenticated;
revoke all on function iig_private.recent_signin() from public,anon,authenticated;
revoke all on function public.iig_request_owner_transfer(text),public.iig_accept_owner_transfer(uuid),public.iig_prepare_account_deletion() from public,anon;
grant execute on function public.iig_request_owner_transfer(text),public.iig_accept_owner_transfer(uuid),public.iig_prepare_account_deletion() to authenticated;
commit;
