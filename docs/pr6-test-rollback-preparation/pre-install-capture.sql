\set ON_ERROR_STOP on
-- Invoke psql -X -qAt; output is one sensitive JSON capture. No application RPCs.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL timezone = 'UTC';
SET LOCAL datestyle = 'ISO, YMD';
SET LOCAL extra_float_digits = 3;
SET LOCAL row_security = off;
SELECT jsonb_build_object(
 'format',1,'commit','eadb495','project_attestation','nyavvwrsrxqfyhiygkgw',
 'captured_at',clock_timestamp(),'database',current_database(),'role',current_user,
 'server_address',inet_server_addr(),'server_version',version(),
 'project_setting',current_setting('supabase.project_ref',true),
 'installation_privileges',jsonb_build_object('database_create',has_database_privilege(current_database(),'CREATE'),'public_create',has_schema_privilege('public','CREATE'),'private_create',has_schema_privilege('iig_private','CREATE'),'auth_trigger',has_table_privilege('auth.users','TRIGGER')),
 'functions',(select jsonb_agg(jsonb_build_object('requested',s.sig,'exists',p.oid is not null,'meta',case when p.oid is not null then jsonb_build_object('schema',n.nspname,'name',p.proname,'signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),'acl_raw',p.proacl::text,'security_definer',p.prosecdef,'settings',p.proconfig,'owner_membership',pg_has_role(current_user,p.proowner,'MEMBER'),'acl',coalesce((select jsonb_agg(jsonb_build_object('grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'grantor',pg_get_userbyid(a.grantor),'grantable',a.is_grantable,'privilege',a.privilege_type)) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a),'[]'::jsonb)) end) order by s.sig)
 from unnest(array['public.iig_join_owned_group(text,uuid,text,numeric)','public.iig_set_my_attendance(text,boolean,bigint)','public.iig_submit_my_score(text,integer,text,bigint)','public.iig_get_player_group(text)','public.iig_get_owned_group()','iig_private.verified_organiser()','iig_private.player_result(jsonb)','iig_private.golf_view(jsonb,integer)','public.iig_player_action(text,text,jsonb,bigint)','iig_private.protected_group_limits()','iig_private.recent_signin()','public.iig_request_owner_transfer(text)','public.iig_accept_owner_transfer(uuid)','public.iig_prepare_account_deletion()','iig_private.sync_owner_email()','public.iig_my_group_identity()','public.iig_is_protected_group(text)','public.iig_apply_verified_subscription(text,uuid,text,timestamp with time zone)']::text[]) s(sig)
 left join pg_proc p on p.oid=to_regprocedure(s.sig) left join pg_namespace n on n.oid=p.pronamespace),
 'new_tables',(select jsonb_object_agg(t,to_regclass(t) is not null) from unnest(array['iig_private.subscription_bindings','iig_private.owner_transfers','iig_private.account_deletions']) t),
 'new_triggers',(select coalesce(jsonb_agg(jsonb_build_object('table',t.tgrelid::regclass::text,'name',t.tgname)),'[]') from pg_trigger t where (t.tgrelid='auth.users'::regclass and t.tgname='iig_sync_owner_email') or (t.tgrelid='public.tens_in_groups'::regclass and t.tgname='iig_protected_group_limits')),
 'fingerprints',jsonb_build_object('public.tens_in_groups', (select jsonb_build_object('rows',count(*),'md5',md5(coalesce(string_agg(h,'' order by h),''))) from (select md5(to_jsonb(r)::text) h from public.tens_in_groups r) hashes),
'iig_private.group_owners', (select jsonb_build_object('rows',count(*),'md5',md5(coalesce(string_agg(h,'' order by h),''))) from (select md5(to_jsonb(r)::text) h from iig_private.group_owners r) hashes),
'iig_private.group_members', (select jsonb_build_object('rows',count(*),'md5',md5(coalesce(string_agg(h,'' order by h),''))) from (select md5(to_jsonb(r)::text) h from iig_private.group_members r) hashes),
'iig_private.platform_owners', (select jsonb_build_object('rows',count(*),'md5',md5(coalesce(string_agg(h,'' order by h),''))) from (select md5(to_jsonb(r)::text) h from iig_private.platform_owners r) hashes),
'iig_private.setup_testers', (select jsonb_build_object('rows',count(*),'md5',md5(coalesce(string_agg(h,'' order by h),''))) from (select md5(to_jsonb(r)::text) h from iig_private.setup_testers r) hashes),
'iig_private.registration_settings', (select jsonb_build_object('rows',count(*),'md5',md5(coalesce(string_agg(h,'' order by h),''))) from (select md5(to_jsonb(r)::text) h from iig_private.registration_settings r) hashes),
'auth.users', (select jsonb_build_object('rows',count(*),'md5',md5(coalesce(string_agg(h,'' order by h),''))) from (select md5(to_jsonb(r)::text) h from auth.users r) hashes),
'auth.identities', (select jsonb_build_object('rows',count(*),'md5',md5(coalesce(string_agg(h,'' order by h),''))) from (select md5(to_jsonb(r)::text) h from auth.identities r) hashes)),
 'inventory',jsonb_build_object(
 'triggers',(select coalesce(jsonb_agg(jsonb_build_object('table',tgrelid::regclass::text,'name',tgname,'enabled',tgenabled,'definition',pg_get_triggerdef(oid))),'[]') from pg_trigger where not tgisinternal),
 'event_triggers',(select coalesce(jsonb_agg(to_jsonb(e)),'[]') from pg_event_trigger e),
 'policies',(select coalesce(jsonb_agg(to_jsonb(p)),'[]') from pg_policies p),
 'default_acl',(select coalesce(jsonb_agg(to_jsonb(d)),'[]') from pg_default_acl d),
 'roles',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from pg_roles r),
 'role_memberships',(select coalesce(jsonb_agg(to_jsonb(m)),'[]') from pg_auth_members m),
 'extensions',(select coalesce(jsonb_agg(to_jsonb(e)),'[]') from pg_extension e),
 'schemas',(select coalesce(jsonb_agg(jsonb_build_object('name',nspname,'owner',pg_get_userbyid(nspowner),'acl',nspacl::text)),'[]') from pg_namespace where nspname in ('public','iig_private','auth')),
 'tables',(select coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'owner',pg_get_userbyid(c.relowner),'acl',c.relacl::text,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity)),'[]') from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p') and n.nspname in ('public','iig_private','auth')),
 'sessions',(select coalesce(jsonb_agg(jsonb_build_object('pid',pid,'user',usename,'application',application_name,'client',client_addr,'state',state,'transaction_start',xact_start)),'[]') from pg_stat_activity where datname=current_database())
 ));
COMMIT;
