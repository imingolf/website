#!/usr/bin/env python3
"""Offline TOC-selection regression tests; never executes SQL or connects to a DB."""
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]

class SelectionTests(unittest.TestCase):
    def run_helper(self, extra=(), omit_rls=False):
        tables = ['public.tens_in_groups','public.iig_notification_settings',
                  'public.iig_notification_events','iig_private.setup_testers',
                  'iig_private.group_owners','iig_private.group_members',
                  'iig_private.registration_settings','iig_private.platform_owners']
        text='\n'.join((REPO/'supabase/staging'/f'{n}.sql').read_text() for n in
                       ['empty-test-schema','organiser-access','self-service-registration','player-scores'])
        functions=sorted(set(re.findall(r'create(?: or replace)? function\s+([\w.]+)\s*\(',text,re.I)))
        entries=['SCHEMA - iig_private postgres','SEQUENCE public tens_in_groups_id_seq postgres',
                 'TABLE DATA auth users supabase_auth_admin']
        for table in tables:
            schema,name=table.split('.')
            entries.append(f'TABLE {schema} {name} postgres')
            if not omit_rls or table!=tables[0]:
                entries.append(f'ROW SECURITY {schema} {name} postgres')
        for fn in functions:
            schema,name=fn.split('.')
            entries.append(f'FUNCTION {schema} {name}() postgres')
        entries+=list(extra)
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            toc=root/'toc.txt'
            toc.write_text('\n'.join(f'{i}; 1255 {17000+i} {v}' for i,v in enumerate(entries,1))+'\n')
            result=subprocess.run([sys.executable,str(HERE/'prepare-local.py'),
                '--inventory',str(toc),'--repo',str(REPO),'--out',str(root/'out')],capture_output=True,text=True)
            outputs={p.name:p.read_text() for p in (root/'out').glob('*')} if (root/'out').exists() else {}
        return result,outputs

    def test_exact_managed_pair_excluded_and_logged(self):
        result,out=self.run_helper(['FUNCTION public rls_auto_enable() postgres',
                                   'EVENT TRIGGER - ensure_rls postgres'])
        self.assertEqual(result.returncode,0,result.stderr)
        selection=out['restore-selection.app.txt']
        self.assertNotIn('rls_auto_enable',selection)
        self.assertNotIn('EVENT TRIGGER',selection)
        self.assertNotIn('TABLE DATA auth',selection)
        self.assertEqual(selection.count('ROW SECURITY'),8)
        self.assertIn('rls_auto_enable()',out['excluded-managed-rls.txt'])
        self.assertIn('ensure_rls',out['excluded-managed-rls.txt'])

    def test_other_objects_and_overloads_rejected(self):
        for entry in ['FUNCTION public rls_auto_enable(integer) postgres',
                      'FUNCTION public rls_auto_enable_extra() postgres',
                      'EVENT TRIGGER - ensure_rls_extra postgres',
                      'FUNCTION public unexpected() postgres',
                      'TABLE iig_private unexpected postgres']:
            with self.subTest(entry=entry):
                result,_=self.run_helper([entry])
                self.assertNotEqual(result.returncode,0)
                self.assertIn('Unexpected application-schema',result.stderr)

    def test_missing_explicit_rls_rejected(self):
        result,_=self.run_helper(omit_rls=True)
        self.assertNotEqual(result.returncode,0)
        self.assertIn('Missing explicit baseline ROW SECURITY',result.stderr)

    def test_six_additional_managed_event_triggers_excluded(self):
        names=['issue_graphql_placeholder','issue_pg_cron_access',
               'issue_pg_graphql_access','issue_pg_net_access',
               'pgrst_ddl_watch','pgrst_drop_watch']
        entries=[f'EVENT TRIGGER - {name} supabase_admin' for name in names]
        result,out=self.run_helper(entries)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertNotIn('EVENT TRIGGER',out['restore-selection.app.txt'])
        for entry in entries:
            self.assertIn(entry,out['excluded-managed-rls.txt'])
        for name in names:
            for entry in [f'EVENT TRIGGER - {name}_extra postgres',
                          f'EVENT TRIGGER - prefix_{name} postgres',
                          f'EVENT TRIGGER public {name} postgres',
                          f'EVENT TRIGGER auth {name} postgres',
                          f'FUNCTION public {name}() postgres']:
                with self.subTest(entry=entry):
                    result,_=self.run_helper([entry])
                    self.assertNotEqual(result.returncode,0)

    def test_unknown_event_and_application_triggers_rejected(self):
        for entry in ['EVENT TRIGGER - unknown_trigger postgres',
                      'TRIGGER public tens_in_groups unknown_trigger postgres']:
            with self.subTest(entry=entry):
                result,_=self.run_helper([entry])
                self.assertNotEqual(result.returncode,0)
        entries=['TRIGGER public tens_in_groups iig_create_notification_events_trigger postgres',
                 'TRIGGER public tens_in_groups iig_enable_notifications_for_new_group_trigger postgres']
        result,out=self.run_helper(entries)
        self.assertEqual(result.returncode,0,result.stderr)
        for entry in entries:
            self.assertIn(entry,out['restore-selection.app.txt'])

if __name__=='__main__':
    unittest.main()
