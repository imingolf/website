\set ON_ERROR_STOP on
-- PREPARED ONLY. Execute later only through a separately approved TEST-target-validated reader.
-- No application RPCs, account emails, data changes, role changes or privilege grants.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path=pg_catalog;
SET LOCAL timezone='UTC';
SET LOCAL datestyle='ISO, YMD';
SET LOCAL extra_float_digits=3;
SET LOCAL row_security=off;
SELECT jsonb_build_object(
 'database',current_database(),'role',current_user,'server_version',current_setting('server_version'),
 'transaction_read_only',current_setting('transaction_read_only'),
 'groups',(select coalesce(jsonb_agg(jsonb_build_object(
   'pin',g.group_pin,'state_type',jsonb_typeof(g.state),'state_md5',md5(g.state::text),
   'row_md5',md5(to_jsonb(g)::text),'state_bytes',octet_length(g.state::text),
   'players_type',jsonb_typeof(g.state->'players'),'history_type',jsonb_typeof(g.state->'history'),
   'players',case when jsonb_typeof(g.state->'players')='array' then jsonb_array_length(g.state->'players') end,
   'history',case when jsonb_typeof(g.state->'history')='array' then jsonb_array_length(g.state->'history') end,
   'owners',(select count(*) from iig_private.group_owners o where o.group_id=g.id),
   'members',(select count(*) from iig_private.group_members m where m.group_id=g.id)) order by g.group_pin),'[]')
   from public.tens_in_groups g where g.group_pin in ('3520','5021')),
 'owner_accounts',(select jsonb_build_object('rows',count(*),'missing_auth',count(*) filter(where u.id is null),
   'unverified',count(*) filter(where u.id is not null and u.email_confirmed_at is null),
   'anonymous',count(*) filter(where u.is_anonymous),'banned',count(*) filter(where u.banned_until>now()))
   from iig_private.group_owners o left join auth.users u on u.id=o.owner_id),
 'member_accounts',(select jsonb_build_object('rows',count(*),'missing_auth',count(*) filter(where u.id is null),
   'unverified',count(*) filter(where u.id is not null and u.email_confirmed_at is null),
   'anonymous',count(*) filter(where u.is_anonymous),'banned',count(*) filter(where u.banned_until>now()))
   from iig_private.group_members m left join auth.users u on u.id=m.user_id),
 'membership_matches',(select coalesce(jsonb_agg(jsonb_build_object('matches',matches,'members',members)),'[]') from (
   select matches,count(*) members from (
     select (select count(*) from jsonb_array_elements(g.state->'players') p where p->>'id'=m.player_id::text) matches
     from iig_private.group_members m join public.tens_in_groups g on g.id=m.group_id
   ) q group by matches) summary),
 'ownership_constraints',(select coalesce(jsonb_agg(jsonb_build_object('name',conname,'type',contype,'definition',pg_get_constraintdef(oid))),'[]')
   from pg_constraint where conrelid='iig_private.group_owners'::regclass),
 'ownership_columns',(select coalesce(jsonb_agg(jsonb_build_object('name',attname,'type',format_type(atttypid,atttypmod)) order by attnum),'[]')
   from pg_attribute where attrelid='iig_private.group_owners'::regclass and attnum>0 and not attisdropped),
 'prerequisites',(select jsonb_agg(jsonb_build_object('requested',sig,'exists',p.oid is not null,
   'owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,'settings',p.proconfig,
   'definition',case when p.oid is not null then pg_get_functiondef(p.oid) end,
   'anon_execute',case when p.oid is not null then has_function_privilege('anon',p.oid,'EXECUTE') end,
   'authenticated_execute',case when p.oid is not null then has_function_privilege('authenticated',p.oid,'EXECUTE') end))
   from unnest(array['auth.uid()','pg_catalog.gen_random_uuid()','pg_catalog.hashtextextended(text,bigint)',
   'iig_private.verified_organiser()','iig_private.check_group_access(text)',
   'public.get_group_access_status(text)','public.iig_create_owned_group(text,text,uuid)',
   'public.iig_get_owned_group()','public.iig_save_owned_group(text,jsonb,bigint)',
   'public.iig_join_owned_group(text,uuid,text,numeric)','public.iig_get_player_group(text)',
   'public.iig_set_my_attendance(text,boolean,bigint)','public.iig_submit_my_score(text,integer,text,bigint)',
   'public.iig_list_registered_groups(integer)']) sig left join pg_proc p on p.oid=to_regprocedure(sig)),
 'prepared_transactions',(select count(*) from pg_prepared_xacts where database=current_database()),
 'writer_locks',(select coalesce(jsonb_agg(jsonb_build_object('pid',l.pid,'relation',l.relation::regclass::text,'mode',l.mode)),'[]')
   from pg_locks l where l.pid<>pg_backend_pid() and l.granted
   and l.relation in(select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','iig_private','auth'))
   and l.mode in ('RowExclusiveLock','ShareUpdateExclusiveLock','ShareRowExclusiveLock','ExclusiveLock','AccessExclusiveLock')),
 'cron_net',(select coalesce(jsonb_agg(extname),'[]') from pg_extension where extname in ('pg_cron','pg_net'))
);
COMMIT;
