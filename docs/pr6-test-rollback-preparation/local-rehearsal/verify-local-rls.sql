-- READ ONLY, LOCAL CONTAINER ONLY. Run after baseline restore, installation and rollback.
\set ON_ERROR_STOP on
begin read only;
select n.nspname as schema_name,c.relname,c.relrowsecurity,c.relforcerowsecurity
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where (n.nspname='public' and c.relname in
 ('tens_in_groups','iig_notification_settings','iig_notification_events'))
or (n.nspname='iig_private' and c.relname in
 ('setup_testers','group_owners','group_members','registration_settings','platform_owners'))
order by n.nspname,c.relname;
do $$
declare t text; r record;
begin
 foreach t in array array[
 'public.tens_in_groups','public.iig_notification_settings','public.iig_notification_events',
 'iig_private.setup_testers','iig_private.group_owners','iig_private.group_members',
 'iig_private.registration_settings','iig_private.platform_owners'] loop
  select relkind,relrowsecurity,relforcerowsecurity into r from pg_class where oid=to_regclass(t);
  if not found then raise exception 'Missing baseline table: %',t; end if;
  if r.relkind<>'r' or not r.relrowsecurity or r.relforcerowsecurity then
   raise exception 'Unexpected baseline RLS settings: % (expected enabled, not forced)',t;
  end if;
 end loop;
end $$;
commit;
