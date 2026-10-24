BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL default_transaction_read_only = on;
SET LOCAL search_path = pg_catalog;
SET LOCAL statement_timeout = '8s';
SET LOCAL lock_timeout = '500ms';
SET LOCAL idle_in_transaction_session_timeout = '15s';
SELECT 1 / CASE WHEN
 current_database() = 'postgres' AND current_user = 'postgres' AND session_user = 'postgres'
 AND current_setting('transaction_read_only') = 'on'
 AND current_setting('default_transaction_read_only') = 'on'
 AND current_setting('server_version_num')::integer BETWEEN 170000 AND 179999
 AND EXISTS (SELECT 1 FROM pg_catalog.pg_stat_ssl WHERE pid = pg_backend_pid() AND ssl)
 THEN 1 ELSE 0 END AS safety_guard;
SELECT jsonb_build_object('section','identity','database',current_database(),
 'role',current_user,'version',current_setting('server_version'),
 'read_only',current_setting('transaction_read_only'),'backend_ssl',true);
SELECT jsonb_build_object('section','functions','items',coalesce(jsonb_agg(jsonb_build_object(
 'oid',p.oid,'schema',n.nspname,'name',p.proname,
 'arguments',pg_get_function_identity_arguments(p.oid),'return',pg_get_function_result(p.oid),
 'owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,
 'configuration',p.proconfig,'acl',p.proacl,'definition',pg_get_functiondef(p.oid),
 'anon_execute',has_function_privilege('anon',p.oid,'EXECUTE'),
 'authenticated_execute',has_function_privilege('authenticated',p.oid,'EXECUTE'),
 'service_role_execute',has_function_privilege('service_role',p.oid,'EXECUTE')
 ) ORDER BY p.oid),'[]'::jsonb))
FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname IN ('public','iig_private') AND p.prokind='f' AND p.proname IN
 ('get_group_state','save_group_state','owner_update_group','owner_create_group',
 'owner_list_groups','create_group','reset_group','finish_round','start_round',
 'confirm_payment','join_round','submit_score','set_admin_pin','owner_reset_admin_pin',
 'owner_delete_group','create_golf_group');
SELECT jsonb_build_object('section','relations','items',coalesce(jsonb_agg(jsonb_build_object(
 'oid',c.oid,'schema',n.nspname,'name',c.relname,'kind',c.relkind,
 'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,
 'acl',c.relacl,'effective_access',(SELECT jsonb_agg(jsonb_build_object(
 'role',role_name,'schema_usage',has_schema_privilege(role_name,n.oid,'USAGE'),
 'select',has_table_privilege(role_name,c.oid,'SELECT'),
 'insert',has_table_privilege(role_name,c.oid,'INSERT'),
 'update',has_table_privilege(role_name,c.oid,'UPDATE'),
 'delete',has_table_privilege(role_name,c.oid,'DELETE')))
 FROM (VALUES ('anon'),('authenticated'),('service_role'),('postgres')) AS roles(role_name)),
 'columns',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',a.attname,
 'type',format_type(a.atttypid,a.atttypmod),'acl',a.attacl)),'[]'::jsonb)
 FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
 'schema_acl',n.nspacl,'schema_owner',pg_get_userbyid(n.nspowner)
 ) ORDER BY c.oid),'[]'::jsonb))
FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname IN ('public','iig_private') AND c.relkind IN ('r','p');
SELECT jsonb_build_object('section','policies','items',coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb))
FROM pg_catalog.pg_policies p WHERE schemaname IN ('public','iig_private');
SELECT jsonb_build_object('section','triggers','items',coalesce(jsonb_agg(jsonb_build_object(
 'table',c.relname,'schema',n.nspname,'name',t.tgname,'enabled',t.tgenabled,
 'definition',pg_get_triggerdef(t.oid,true),'function_oid',p.oid,
 'function_definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),
 'security_definer',p.prosecdef,'configuration',p.proconfig,'acl',p.proacl
 ) ORDER BY t.oid),'[]'::jsonb))
FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid
WHERE n.nspname IN ('public','iig_private') AND NOT t.tgisinternal;
SELECT jsonb_build_object('section','role_memberships','items',coalesce(jsonb_agg(jsonb_build_object(
 'role',r.rolname,'member',m.rolname,'inherit',a.inherit_option,'set',a.set_option,
 'admin',a.admin_option)),'[]'::jsonb))
FROM pg_catalog.pg_auth_members a JOIN pg_catalog.pg_roles r ON r.oid=a.roleid
JOIN pg_catalog.pg_roles m ON m.oid=a.member;
SELECT jsonb_build_object('section','role_flags','items',coalesce(jsonb_agg(jsonb_build_object(
 'role',rolname,'superuser',rolsuper,'inherit',rolinherit,'bypass_rls',rolbypassrls)),'[]'::jsonb))
FROM pg_catalog.pg_roles WHERE rolname IN ('postgres','anon','authenticated','service_role');
COMMIT;
