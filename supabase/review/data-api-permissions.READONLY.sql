-- REVIEW-ONLY supplemental catalog query; not in the approved runner query IDs.
-- Do not run standalone or append to the existing runner without separate review.
-- Future execution must retain exact TEST/TLS/read-only target and transaction guards.
begin read only;
set local search_path=pg_catalog;
-- Relation ACLs/RLS and effective privileges, including BYPASSRLS service_role.
-- No user rows, credentials or function definitions are selected.
select n.nspname as schema,c.relname,c.relkind,pg_get_userbyid(c.relowner) as owner,
 c.relacl::text as acl,c.relrowsecurity,c.relforcerowsecurity,
 r.role,p.privilege,
 case when c.relkind='S' then has_sequence_privilege(r.role::name,c.oid,p.privilege)
 else has_table_privilege(r.role::name,c.oid,p.privilege) end as effective
from pg_class c join pg_namespace n on n.oid=c.relnamespace
cross join (values ('anon'),('authenticated'),('service_role')) r(role)
cross join lateral (
 select unnest(case when c.relkind='S' then array['USAGE','SELECT','UPDATE']
 else array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] end) as privilege
) p
where (n.nspname='public' and c.relname in ('tens_in_groups','tens_in_groups_id_seq','iig_notification_settings','iig_notification_events')
 or n.nspname='iig_private' and c.relname in ('setup_testers','group_owners','group_members','registration_settings','platform_owners','account_deletions','owner_transfers','subscription_bindings'))
 and c.relkind in ('r','p','S') order by 1,2,7,8;
-- Column grants can survive table-level revocation; review them separately.
select n.nspname,c.relname,a.attname,a.attacl::text as column_acl
from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
where n.nspname in ('public','iig_private') and a.attnum>0 and not a.attisdropped and a.attacl is not null
order by 1,2,3;
-- Default ACLs are creator-specific and can change during the platform rollout.
select pg_get_userbyid(d.defaclrole) as creator,n.nspname,d.defaclobjtype,d.defaclacl::text
from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace
where d.defaclnamespace=0 or n.nspname in ('public','iig_private') order by 1,2,3;
select schemaname,tablename,policyname,roles,cmd,qual,with_check
from pg_policies where schemaname in ('public','iig_private') order by 1,2,3;
select n.nspname,r.role,has_schema_privilege(r.role::name,n.oid,'USAGE') as usage,
 has_schema_privilege(r.role::name,n.oid,'CREATE') as create_objects
from pg_namespace n cross join (values ('anon'),('authenticated'),('service_role')) r(role)
where n.nspname in ('public','iig_private') order by 1,2;
commit;
