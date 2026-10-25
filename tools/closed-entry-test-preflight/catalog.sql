-- TEMPLATE: reviewed catalog-only statements, appended inside the fixed read-only transaction.
SELECT jsonb_build_object('section','identity','project',current_setting('supabase.project_ref',true),
 'database',current_database(),'role',current_user,'session_role',session_user,
 'version',current_setting('server_version_num'),'transaction_read_only',current_setting('transaction_read_only'),
 'default_transaction_read_only',current_setting('default_transaction_read_only'),
 'backend_ssl',(SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid=pg_backend_pid()));
SELECT jsonb_build_object('section','functions','items',coalesce(jsonb_agg(jsonb_build_object(
 'signature',p.oid::regprocedure::text,'schema',n.nspname,'name',p.proname,
 'definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),'acl_raw',p.proacl::text,
 'settings',p.proconfig,'security_definer',p.prosecdef,
 'effective_owner',pg_has_role(current_user,p.proowner,'USAGE'),
 'execute',(SELECT jsonb_object_agg(r,has_function_privilege(r,p.oid,'EXECUTE'))
 FROM unnest(ARRAY['anon','authenticated','service_role','postgres']) r)) ORDER BY p.oid),'[]'::jsonb))
FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname IN ('public','iig_private') AND p.prokind='f';
SELECT jsonb_build_object('section','tables','items',coalesce(jsonb_agg(jsonb_build_object(
 'schema',n.nspname,'name',c.relname,'owner',pg_get_userbyid(c.relowner),'acl',c.relacl::text,
 'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,
 'effective_owner',pg_has_role(current_user,c.relowner,'USAGE'),
 'privileges',(SELECT jsonb_object_agg(r,jsonb_build_object(
 'select',has_table_privilege(r,c.oid,'SELECT'),'insert',has_table_privilege(r,c.oid,'INSERT'),
 'update',has_table_privilege(r,c.oid,'UPDATE'),'delete',has_table_privilege(r,c.oid,'DELETE'),
 'trigger',has_table_privilege(r,c.oid,'TRIGGER'))) FROM unnest(ARRAY['anon','authenticated','service_role','postgres']) r),
 'columns',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
 'not_null',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,'acl',a.attacl::text,
 'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum),'[]'::jsonb)
 FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
 WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
 'constraints',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',conname,'type',contype,
 'validated',convalidated,'definition',pg_get_constraintdef(oid,true)) ORDER BY oid),'[]'::jsonb)
 FROM pg_catalog.pg_constraint WHERE conrelid=c.oid),
 'indexes',(SELECT coalesce(jsonb_agg(jsonb_build_object('definition',pg_get_indexdef(indexrelid),
 'valid',indisvalid,'ready',indisready) ORDER BY indexrelid),'[]'::jsonb) FROM pg_catalog.pg_index WHERE indrelid=c.oid)
 ) ORDER BY n.nspname,c.relname),'[]'::jsonb))
FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname IN ('public','iig_private') AND c.relkind IN ('r','p');
SELECT jsonb_build_object('section','triggers','items',coalesce(jsonb_agg(jsonb_build_object(
 'table',t.tgrelid::regclass::text,'name',t.tgname,'enabled',t.tgenabled,
 'definition',pg_get_triggerdef(t.oid),'function_signature',t.tgfoid::regprocedure::text,
 'function_definition',pg_get_functiondef(t.tgfoid),'function_config',p.proconfig,
 'function_owner',pg_get_userbyid(p.proowner),
 'dependencies',(SELECT coalesce(jsonb_agg(jsonb_build_object('class',d.refclassid::regclass::text,
 'identity',pg_describe_object(d.refclassid,d.refobjid,d.refobjsubid))),'[]'::jsonb)
 FROM pg_catalog.pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=t.tgfoid)
 ) ORDER BY t.tgrelid,t.tgname),'[]'::jsonb))
FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid
WHERE n.nspname IN ('public','iig_private') AND NOT t.tgisinternal;
SELECT jsonb_build_object('section','policies','items',coalesce(jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname),'[]'::jsonb))
FROM pg_catalog.pg_policies p WHERE schemaname IN ('public','iig_private');
SELECT jsonb_build_object('section','authority','database_create',has_database_privilege(current_database(),'CREATE'),
 'schemas',(SELECT jsonb_agg(jsonb_build_object('name',nspname,'owner',pg_get_userbyid(nspowner),'acl',nspacl::text,
 'create',has_schema_privilege(oid,'CREATE'),'usage',has_schema_privilege(oid,'USAGE')) ORDER BY nspname)
 FROM pg_catalog.pg_namespace WHERE nspname IN ('public','iig_private')),
 'memberships',(SELECT coalesce(jsonb_agg(jsonb_build_object('role',pg_get_userbyid(roleid),
 'member',pg_get_userbyid(member),'inherit',inherit_option,'set',set_option,'admin',admin_option)),'[]'::jsonb) FROM pg_catalog.pg_auth_members),
 'guard_schema_exists',to_regnamespace('iig_closed_entry') IS NOT NULL);
SELECT jsonb_build_object('section','platform','extensions',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',extname,'version',extversion) ORDER BY extname),'[]'::jsonb) FROM pg_catalog.pg_extension),
 'event_triggers',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',evtname,'enabled',evtenabled,'definition',evtfoid::regprocedure::text)),'[]'::jsonb) FROM pg_catalog.pg_event_trigger),
 'default_acl',(SELECT coalesce(jsonb_agg(to_jsonb(d)),'[]'::jsonb) FROM pg_catalog.pg_default_acl d),
 'cron_table_exists',to_regclass('cron.job') IS NOT NULL);
SELECT jsonb_build_object('section','writers','items',coalesce(jsonb_agg(jsonb_build_object(
 'pid',pid,'role',usename,'application',application_name,'address',client_addr,'state',state,
 'transaction_start',xact_start,'backend_type',backend_type) ORDER BY pid),'[]'::jsonb))
FROM pg_catalog.pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid();
