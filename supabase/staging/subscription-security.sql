-- STAGING ONLY. Apply before testing the changed Apple verification Edge Function.
begin;
create table iig_private.subscription_bindings(
 original_transaction_id text primary key,group_id bigint not null references public.tens_in_groups(id) on delete restrict,
 expires_at timestamptz not null,updated_at timestamptz not null default now()
);
alter table iig_private.subscription_bindings enable row level security;
revoke all on iig_private.subscription_bindings from public,anon,authenticated;
-- Identity-only view remains available to the owner when a trial expires, for renewal.
create function public.iig_my_group_identity() returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid=iig_private.verified_organiser(); out jsonb;
begin
 select jsonb_build_object('group_pin',g.group_pin,'plan_type',g.plan_type) into out
 from public.tens_in_groups g join iig_private.group_owners o on o.group_id=g.id where o.owner_id=uid;
 return out;
end $$;
revoke all on function public.iig_my_group_identity() from public,anon;
grant execute on function public.iig_my_group_identity() to authenticated;
create function public.iig_is_protected_group(p_pin text) returns boolean
language sql security definer set search_path='' as $$
 select exists(select 1 from public.tens_in_groups g join iig_private.group_owners o on o.group_id=g.id where g.group_pin=p_pin);
$$;
create function public.iig_apply_verified_subscription(p_pin text,p_user_id uuid,p_original_id text,p_expires_at timestamptz)
returns boolean language plpgsql security definer set search_path='' as $$
declare gid bigint; owner_uid uuid;
begin
 -- Only the server-side Apple verifier may invoke this after verifying Apple's response.
 if p_original_id is null or length(p_original_id) not between 1 and 200 or p_expires_at is null or p_expires_at<=now() then raise exception 'Invalid verified subscription'; end if;
 select id into gid from public.tens_in_groups where group_pin=p_pin;
 select owner_id into owner_uid from iig_private.group_owners where group_id=gid for update;
 perform 1 from public.tens_in_groups where id=gid for update;
 if gid is null then raise exception 'Group not found'; end if;
 if owner_uid is not null and (p_user_id is distinct from owner_uid or not exists(select 1 from auth.users u where u.id=p_user_id and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=now())) or exists(select 1 from iig_private.account_deletions where user_id=p_user_id)) then raise exception 'Verified group organiser required' using errcode='42501'; end if;
 if owner_uid is not null and exists(select 1 from public.tens_in_groups where id=gid and status='suspended') then raise exception 'This group is suspended; contact I’m In Golf before renewal'; end if;
 insert into iig_private.subscription_bindings(original_transaction_id,group_id,expires_at) values(p_original_id,gid,p_expires_at)
 on conflict(original_transaction_id) do update set expires_at=greatest(iig_private.subscription_bindings.expires_at,excluded.expires_at),updated_at=now()
 where iig_private.subscription_bindings.group_id=excluded.group_id;
 if not found then raise exception 'This subscription is already linked to a different group'; end if;
 update public.tens_in_groups set plan_type='plus',paid_status='paid',renewal_date=greatest(renewal_date,(p_expires_at at time zone 'UTC')::date),status='active',updated_at=now() where id=gid;
 return true;
end $$;
revoke all on function public.iig_is_protected_group(text),public.iig_apply_verified_subscription(text,uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.iig_is_protected_group(text),public.iig_apply_verified_subscription(text,uuid,text,timestamptz) to service_role;
commit;
