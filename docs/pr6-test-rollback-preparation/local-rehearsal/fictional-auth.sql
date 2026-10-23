-- LOCAL ONLY. Run after application data and BEFORE post-data constraints/triggers.
-- Preserve referenced UUIDs; create no real passwords, tokens, MFA or identities.
do $$ begin
 if exists(select 1 from auth.users) or exists(select 1 from auth.identities) then
  raise exception 'Expected empty local Auth tables; stop';
 end if;
end $$;
with ids as (
 select owner_id id from iig_private.group_owners
 union select user_id from iig_private.group_members
 union select user_id from iig_private.setup_testers
 union select user_id from iig_private.platform_owners
)
insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous,
 raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select id,'authenticated','authenticated',id::text || '@example.invalid',now(),false,
 '{}'::jsonb,'{"local_rehearsal":true}'::jsonb,now(),now() from ids;
-- auth.identities intentionally remains empty: database RPC rehearsal, not Auth login.
