-- Read-only schema/grant inventory. Contains no player data or function bodies.
-- Review actual hosted output privately before release; this file is NOT a migration.
select n.nspname as schema,p.proname,pg_get_function_identity_arguments(p.oid) as arguments,
 p.prosecdef as security_definer,p.proconfig,
 has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','iig_private') order by 1,2,3;
select schemaname,tablename,policyname,roles,cmd,qual,with_check
from pg_policies where schemaname in ('public','iig_private') order by 1,2,3;
select table_schema,table_name,grantee,privilege_type from information_schema.role_table_grants
where table_schema in ('public','iig_private') and grantee in ('anon','authenticated','PUBLIC') order by 1,2,3,4;
