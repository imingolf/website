"""Offline source/ACL-contract tests. No PostgreSQL, SQL execution or network calls."""
import importlib.util
import re
from pathlib import Path
import unittest

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
spec=importlib.util.spec_from_file_location('acl_review_reference',HERE/'readonly_reference.py')
reference=importlib.util.module_from_spec(spec);spec.loader.exec_module(reference)
g,comparison=reference.helpers()
STAGING=ROOT/'supabase/staging'
DRAFT=ROOT/'supabase/review/registration-object-acls.DRAFT.sql'
ROLES={'public','anon','authenticated','service_role'}
PUBLIC_TABLES={'public.tens_in_groups','public.iig_notification_settings','public.iig_notification_events'}
PRIVATE_TABLES={'iig_private.'+n for n in ('setup_testers','group_owners','group_members','registration_settings','platform_owners','account_deletions','owner_transfers','subscription_bindings')}


def outside_bodies(sql):
    text=re.sub(r'(\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$).*?\1','',sql,flags=re.S)
    return re.sub(r'--[^\n]*','',text).lower()


def split_signatures(text):
    out=[];start=depth=0
    for i,char in enumerate(text):
        if char=='(':depth+=1
        elif char==')':depth-=1
        elif char==',' and depth==0:out.append(text[start:i].strip());start=i+1
    out.append(text[start:].strip())
    return {re.sub(r'\s+',' ',v).replace('timestamptz','timestamp with time zone') for v in out}


def acl_statements(sql,kind):
    # Intentionally only the literal object ACL syntax used by the reviewed files.
    # Not an SQL parser or assertion about inherited privileges in a real database.
    text=outside_bodies(sql)
    pattern=rf'\b(revoke\s+all|grant\s+execute)\s+on\s+{kind}\s+(.+?)\s+(from|to)\s+([^;]+);'
    for action,objects,direction,roles in re.findall(pattern,text,re.S):
        yield action,split_signatures(objects),{r.strip() for r in roles.split(',')}


class MigrationPermissionTests(unittest.TestCase):
    def test_four_rehearsed_files_are_byte_identical_to_pinned_commit(self):
        import hashlib
        for name,sha in comparison.MIGRATIONS:
            self.assertEqual(hashlib.sha256((STAGING/(name+'.sql')).read_bytes()).hexdigest(),sha)
    def test_all_table_creations_are_classified_and_have_explicit_rls(self):
        found=set()
        for path in STAGING.glob('*.sql'):
            sql=outside_bodies(path.read_text())
            tables=set(re.findall(r'\bcreate table (?:if not exists )?([\w.]+)',sql))
            found|=tables
            for table in tables:self.assertIn('alter table '+table+' enable row level security;',sql)
            if path.stem in dict(comparison.MIGRATIONS):self.assertFalse(tables&PUBLIC_TABLES)
        self.assertEqual(found,PUBLIC_TABLES|PRIVATE_TABLES)
    def test_new_three_tables_are_private_and_have_no_direct_browser_policy(self):
        source='\n'.join((STAGING/(n+'.sql')).read_text() for n,_ in comparison.MIGRATIONS)
        tables=set(re.findall(r'\bcreate table ([\w.]+)',outside_bodies(source)))
        self.assertEqual(tables,set(g.TABLES));self.assertNotRegex(outside_bodies(source),r'\bcreate policy\b')
        self.assertNotRegex(outside_bodies(source),r'\bgrant\b[^;]*\bon (?:table )?(?:public|iig_private)\.')
    def test_clean_public_tables_deny_all_api_roles_with_either_default_model(self):
        for name in ('empty-test-schema.sql','setup-test-project.sql'):
            text=outside_bodies((STAGING/name).read_text())
            statements=re.findall(r'\brevoke all on (?!function|sequence|schema|all)([^;]+?) from ([^;]+);',text)
            for inherited in (False,True):
                acl={t:set(ROLES) if inherited else set() for t in PUBLIC_TABLES}
                for objects,roles in statements:
                    for obj in objects.split(','):
                        if obj.strip() in acl:acl[obj.strip()]-={r.strip() for r in roles.split(',')}
                self.assertTrue(all(not roles for roles in acl.values()),(name,inherited,acl))
            self.assertIn('revoke all on sequence public.tens_in_groups_id_seq from service_role;',text)
            self.assertIn('revoke all on sequence public.tens_in_groups_id_seq from public,anon,authenticated;',text)
            self.assertNotRegex(text,r'\bgrant\b[^;]*\bon (?:table )?public\.tens_in_groups')
    def test_combined_bootstrap_keeps_templates_exactly_in_sync(self):
        combined=(STAGING/'setup-test-project.sql').read_text()
        self.assertIn((STAGING/'empty-test-schema.sql').read_text(),combined)
        org=(STAGING/'organiser-access.sql').read_text().replace('begin;\n','',1).removesuffix('commit;\n')
        self.assertIn(org,combined)
        self.assertIn('this database already has app tables',combined)
    def test_clean_private_schema_denies_direct_service_access(self):
        sql=outside_bodies((STAGING/'organiser-access.sql').read_text())
        for kind in ('schema iig_private','all tables in schema iig_private','all functions in schema iig_private'):
            self.assertIn('revoke all on '+kind+' from public, anon, authenticated, service_role;',sql)
    def test_legacy_bootstrap_rpcs_explicitly_granted_without_public_function_defaults(self):
        text=(STAGING/'organiser-access.sql').read_text()
        for sig in ('public.get_group_state(text)','public.save_group_state(text,jsonb)'):
            roles=set(ROLES)
            for action,objects,grantees in acl_statements(text,'function'):
                if sig in objects:roles=roles-grantees if action.startswith('revoke') else roles|grantees
            self.assertEqual(roles,{'anon','authenticated'})
        self.assertEqual(text.count("then raise exception 'Use the secure group client'"),2)
    def test_draft_only_changes_objects_that_original_rollback_removes(self):
        text=DRAFT.read_text();functions=set();tables=set()
        for action,objects,roles in acl_statements(text,'function'):functions|=objects
        for action,objects,roles in acl_statements(text,'table'):tables|=objects
        self.assertEqual(functions,set(g.NEW));self.assertEqual(tables,set(g.TABLES))
        self.assertNotRegex(outside_bodies(text),r'\b(create|alter|drop|insert|update|delete|truncate)\b')
        self.assertNotIn('cascade',outside_bodies(text));self.assertNotIn('alter default privileges',text.lower())
    def test_draft_rpc_matrix_under_permissive_and_empty_function_defaults(self):
        users={'public.iig_player_action(text,text,jsonb,bigint)','public.iig_request_owner_transfer(text)',
               'public.iig_accept_owner_transfer(uuid)','public.iig_prepare_account_deletion()','public.iig_my_group_identity()'}
        service={'public.iig_is_protected_group(text)','public.iig_apply_verified_subscription(text,uuid,text,timestamp with time zone)'}
        for inherited in (False,True):
            acl={s:set(ROLES) if inherited else {'public'} for s in g.NEW}
            for action,objects,roles in acl_statements(DRAFT.read_text(),'function'):
                for obj in objects:acl[obj]=acl[obj]-roles if action.startswith('revoke') else acl[obj]|roles
            for sig,roles in acl.items():self.assertEqual(roles,{'authenticated'} if sig in users else {'service_role'} if sig in service else set(),sig)
        for action,objects,roles in acl_statements(DRAFT.read_text(),'table'):self.assertEqual(roles,ROLES)
    def test_draft_and_inventory_have_no_execution_path_or_broad_default_grants(self):
        sql=DRAFT.read_text()
        self.assertIn("current_setting('iig.reviewed_acl_target',true) is distinct from 'nyavvwrsrxqfyhiygkgw'",sql)
        self.assertIn('database-side TLS is required',sql)
        audit=outside_bodies((ROOT/'supabase/review/data-api-permissions.READONLY.sql').read_text())
        self.assertIn('begin read only;',audit);self.assertIn('pg_default_acl',audit)
        self.assertIn('attacl',audit);self.assertIn('has_sequence_privilege',audit);self.assertIn('service_role',audit)
        self.assertNotRegex(audit,r'\b(create|alter|drop|grant|revoke|insert|update|delete|truncate)\s+(?:table|schema|on|into|from)')
        registry=(HERE/'readonly-queries.json').read_text()
        self.assertNotIn('reviewed_acl_target',registry)
        self.assertNotIn('data-api-permissions.READONLY.sql',registry)
    def test_obsolete_setup_is_not_a_reset_instruction(self):
        legacy=(ROOT/'app/supabase-setup.sql').read_text()
        self.assertTrue(legacy.startswith('-- OBSOLETE'));self.assertNotIn('Run this entire file once',legacy)
        self.assertNotIn('Run once in Supabase SQL Editor',(ROOT/'app/README.txt').read_text())


if __name__=='__main__':unittest.main()
