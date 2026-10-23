#!/usr/bin/env python3
"""Offline only; all command/database boundaries mocked. No SQL is executed."""
import copy
import datetime
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module
p=load('prep',HERE/'prepare-test.py')
b=load('builder',HERE/'guarded-plan.py')
fixtures=load('fixtures',HERE.parent/'local-rehearsal/test-automation.py')

class PreparationTests(unittest.TestCase):
    def config(self):
        return {'host':'aws-1-eu-west-2.pooler.supabase.com','port':'5432',
                'user':'postgres.'+p.PROJECT,'dbname':'postgres','sslmode':'require'}

    def service(self,root,changes=None):
        c=self.config(); c.update(changes or {})
        path=root/'service.conf'
        path.write_text('[iig-test-only]\n'+'\n'.join(k+'='+v for k,v in c.items())+'\n')
        path.chmod(0o600)
        return path

    def test_only_explicit_test_target_and_ssl_accepted(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            self.assertEqual(p.service_config(self.service(root))['user'],'postgres.'+p.PROJECT)
            direct={'host':'db.'+p.PROJECT+'.supabase.co','user':'postgres'}
            p.service_config(self.service(root,direct))
            for change in [{'user':'postgres.live-project'},{'host':'db.live-project.supabase.co'},
                           {'hostaddr':'127.0.0.1'},{'options':'-c role=other'},
                           {'port':'6543'},{'dbname':'other'},{'sslmode':'prefer'}]:
                with self.subTest(change=change),self.assertRaises(RuntimeError):
                    p.service_config(self.service(root,change))

    def test_readonly_connection_cannot_use_inherited_pg_environment(self):
        with tempfile.TemporaryDirectory() as d:
            reader=p.Reader(self.config(),Path(d))
            with patch.dict(p.os.environ,{'PGHOST':'live.example','PGSERVICE':'live','PGPASSWORD':'wrong'}),patch.object(p.subprocess,'run') as run:
                run.return_value.returncode=0; run.return_value.stdout='{}'; run.return_value.stderr=''
                reader.sql('BEGIN READ ONLY; SELECT 1; COMMIT;','offline-fixture')
                args=run.call_args.args[0]; env=run.call_args.kwargs['env']
                self.assertNotIn('live.example',' '.join(args))
                self.assertNotIn('PGHOST',env); self.assertNotIn('PGSERVICE',env)
                self.assertNotIn('PGPASSWORD',env)
                self.assertIn('default_transaction_read_only=on',env['PGOPTIONS'])
                self.assertIn('default_transaction_read_only=on',args[args.index('--dbname')+1])

    def test_missing_password_prompts_once_and_never_persists_secret(self):
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); reader=p.Reader(self.config(),root)
            secret='offline-secret-DoNotPersist'
            replies=[SimpleNamespace(returncode=2,stdout='',stderr='fe_sendauth: no password supplied'),
                     SimpleNamespace(returncode=0,stdout='verified '+secret,stderr='diagnostic '+secret)]
            with patch.object(p.subprocess,'run',side_effect=replies) as command, \
                 patch.object(p.sys.stdin,'isatty',return_value=True), \
                 patch.object(p.getpass,'getpass',return_value=secret) as prompt:
                result=reader.sql('\\conninfo\n','identity',allow_password_prompt=True)
                prompt.assert_called_once()
                self.assertNotIn(secret,result)
                self.assertEqual(reader.c['password'],secret)
                self.assertEqual(command.call_args.kwargs['env']['PGPASSWORD'],secret)
                self.assertNotIn(secret,' '.join(command.call_args.args[0]))
                self.assertIn(p.PROJECT,' '.join(command.call_args.args[0]))
                self.assertIn('default_transaction_read_only=on',' '.join(command.call_args.args[0]))
            for path in root.iterdir(): self.assertNotIn(secret,path.read_text())

    def test_no_password_prompt_for_other_errors_or_ordinary_queries(self):
        from types import SimpleNamespace
        for error,allowed in [('password authentication failed',True),('fe_sendauth: no password supplied',False)]:
            with tempfile.TemporaryDirectory() as d, \
                 patch.object(p.subprocess,'run',return_value=SimpleNamespace(returncode=2,stdout='',stderr=error)), \
                 patch.object(p.getpass,'getpass') as prompt:
                with self.assertRaises(RuntimeError):
                    p.Reader(self.config(),Path(d)).sql('SELECT 1;','test',allow_password_prompt=allowed)
                prompt.assert_not_called()

    def test_noninteractive_password_input_fails_closed(self):
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as d, \
             patch.object(p.subprocess,'run',return_value=SimpleNamespace(returncode=2,stdout='',stderr='fe_sendauth: no password supplied')), \
             patch.object(p.sys.stdin,'isatty',return_value=False),patch.object(p.getpass,'getpass') as prompt:
            with self.assertRaisesRegex(RuntimeError,'interactive Mac Terminal'):
                p.Reader(self.config(),Path(d)).sql('SELECT 1;','identity',allow_password_prompt=True)
            prompt.assert_not_called()

    def test_unconfirmed_or_stale_writers_block_readiness(self):
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'controlled-pause.json'
            self.assertFalse(p.writer_controls(path)[0])
            value=json.loads(path.read_text())
            value.update(operator='test operator',confirmed_at_utc=datetime.datetime.now(datetime.timezone.utc).isoformat())
            for scope in p.SCOPES:
                value['controls'][scope]={'status':'paused','evidence':'Specific verified TEST-only pause evidence'}
            path.write_text(json.dumps(value))
            self.assertTrue(p.writer_controls(path)[0])
            value['controls'][p.SCOPES[0]]['status']='unknown'; path.write_text(json.dumps(value))
            self.assertFalse(p.writer_controls(path)[0])
            value['project']='live'; path.write_text(json.dumps(value))
            with self.assertRaises(RuntimeError): p.writer_controls(path)

    def test_all_pinned_bodies_parsed_and_acl_semantics_preserved(self):
        sigs=p.g.REQUIRED+p.g.OPTIONAL+p.g.NEW
        seen=set()
        for name,digest in p.local.MIGRATIONS:
            source=(p.REPO/'supabase/staging'/f'{name}.sql').read_text()
            self.assertEqual(p.hashlib.sha256(source.encode()).hexdigest(),digest)
            seen.update(b.sources(source,sigs))
        self.assertEqual(seen,set(sigs))
        defaults={schema:[{'grantor':'postgres','grantee':who,'privilege':'EXECUTE','grantable':False}
                           for who in ('postgres','PUBLIC','authenticated','service_role')]
                  for schema in ('public','iig_private')}
        private=b.expected_acl('iig_private.golf_view(jsonb,integer)',None,defaults)
        self.assertFalse(any(a['grantee'] in ('PUBLIC','anon','authenticated') for a in private))
        service=b.expected_acl('public.iig_is_protected_group(text)',None,defaults)
        self.assertTrue(any(a['grantee']=='service_role' for a in service))
        self.assertFalse(any(a['grantee']=='authenticated' for a in service))

    def test_guarded_files_keep_individual_transactions_and_original_rollback(self):
        before=fixtures.capture_fixture(); before['project_attestation']=p.PROJECT
        for f in before['functions']:
            if f['exists']: f['meta']['definition']+=' $iig_guard$ in captured text'
        defaults={schema:[{'grantor':'postgres','grantee':'postgres','privilege':'EXECUTE','grantable':False},
                          {'grantor':'postgres','grantee':'PUBLIC','privilege':'EXECUTE','grantable':False}]
                  for schema in ('public','iig_private')}
        audit=fixtures.AutomationTests().supplementary_fixture()
        audit['rows'].update({t:{'rows':0,'md5':'offline'} for t in ('public.iig_notification_settings','public.iig_notification_events')})
        pause={'confirmed_at_utc':datetime.datetime.now(datetime.timezone.utc).isoformat()}
        originals=[(n,(p.REPO/'supabase/staging'/f'{n}.sql').read_text()) for n,_ in p.local.MIGRATIONS]
        rollback=p.g.rollback(before)
        with tempfile.TemporaryDirectory() as d:
            out=Path(d); b.prepare(out,before,audit,originals,rollback,p.g,defaults,pause)
            package=json.loads((out/'package.json').read_text())
            self.assertEqual([x['source'] for x in package['migrations']],[n for n,_ in originals])
            self.assertEqual((out/'rollback.TEST.sql').read_text(),rollback)
            for item in package['migrations']:
                text=(out/item['file']).read_text()
                self.assertEqual(text.count('\nbegin;\n'),1)
                self.assertEqual(text.count('\ncommit;\n'),1)
                self.assertEqual(text.count("actual := (SELECT jsonb_build_object("),2)
                self.assertIn('share row exclusive mode;',text)
                self.assertIn('Protected data changed; STOP',text)
                self.assertIn('Notification data changed',text)
                self.assertIn('Separate TEST installation approval required',text)
                self.assertIn('Function grants differ',text)
                self.assertIn('Writer-control window expired',text)
                self.assertNotIn('do $iig_guard$',text)
                self.assertIn('$iig_guard$ in captured text',text)
                self.assertEqual(p.hashlib.sha256(text.encode()).hexdigest(),item['sha256'])

    def test_backup_anchor_mismatch_stops_before_pg_restore(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); archive=root/'test.dump'; archive.write_bytes(b'offline fixture')
            manifest=root/'backup.sha256'; manifest.write_text('0'*64+'  test.dump\n')
            with patch.object(p,'run') as run,self.assertRaises(RuntimeError):
                p.backup_check(archive,manifest,root,allow_unanchored=True)
            run.assert_not_called()

    def test_missing_history_requires_explicit_recovery_and_never_writes_old_manifest(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); archive=root/'original.dump'; archive.write_bytes(b'fixture')
            manifest=root/'backup.sha256'
            with patch.object(p,'run') as command:
                with self.assertRaisesRegex(RuntimeError,'Historical backup checksum missing'):
                    p.backup_check(archive,manifest,root)
                command.assert_not_called()
                toc='Dumped from database version: 17.11\n'
                tables=['public tens_in_groups','public iig_notification_settings','public iig_notification_events',
                        'iig_private group_owners','iig_private group_members','iig_private setup_testers',
                        'iig_private platform_owners','iig_private registration_settings']
                toc+=''.join('TABLE DATA '+t+' postgres\n' for t in tables)
                toc+='SEQUENCE public tens_in_groups_id_seq postgres\n'
                command.side_effect=['pg_restore (PostgreSQL) 18.6',toc,'']
                observed=p.backup_check(archive,manifest,root,allow_unanchored=True)
                self.assertEqual(observed,p.hashlib.sha256(b'fixture').hexdigest())
                self.assertFalse(manifest.exists())
                self.assertEqual(archive.read_bytes(),b'fixture')
                self.assertEqual(command.call_args.args[0][-2:], [p.os.devnull,str(archive)])

    def test_fresh_dump_is_test_readonly_and_comparisons_remain_mandatory(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); before=fixtures.capture_fixture()
            audit=fixtures.AutomationTests().supplementary_fixture()
            class FakeReader:
                c=self.config()
                def capture(self,*args): return copy.deepcopy(before)
                def audit(self,*args): return copy.deepcopy(audit)
            def command(args,env=None):
                if args==['pg_dump','--version']: return 'pg_dump (PostgreSQL) 18.6'
                self.assertEqual(args[0],'pg_dump')
                self.assertIn('--no-password',args)
                self.assertIn('default_transaction_read_only=on',args[args.index('--dbname')+1])
                self.assertIn(p.PROJECT,args[args.index('--dbname')+1])
                self.assertNotIn('PGHOST',env)
                Path(args[-1]).write_bytes(b'new archive fixture')
                return ''
            with patch.object(p,'run',side_effect=command),patch.object(p,'backup_check') as validate, \
                 patch.dict(p.os.environ,{'PGHOST':'forbidden.example'}):
                result=p.fresh_backup(FakeReader(),before,audit,root)
                self.assertTrue(result['historical_checksum_missing'])
                self.assertFalse(result['original_archive_integrity_proven'])
                validate.assert_called_once()
                self.assertTrue((root/'fresh-backup.sha256').exists())
                self.assertFalse((root/'backup.sha256').exists())
                with self.assertRaisesRegex(RuntimeError,'refuse overwrite'):
                    p.fresh_backup(FakeReader(),before,audit,root)

    def test_failed_dump_or_changed_post_dump_baseline_cannot_be_promoted(self):
        for failure in ('dump','changed'):
            with self.subTest(failure=failure),tempfile.TemporaryDirectory() as d:
                root=Path(d); before=fixtures.capture_fixture()
                audit=fixtures.AutomationTests().supplementary_fixture()
                class FakeReader:
                    c=self.config()
                    calls=0
                    def capture(self,*args):
                        self.calls+=1
                        value=copy.deepcopy(before)
                        if self.calls>1: value['fingerprints']={}
                        return value
                    def audit(self,*args): return copy.deepcopy(audit)
                def command(args,env=None):
                    if args==['pg_dump','--version']: return 'pg_dump (PostgreSQL) 18.6'
                    if failure=='dump': raise RuntimeError('fixture dump failed')
                    Path(args[-1]).write_bytes(b'fresh fixture')
                    return ''
                with patch.object(p,'run',side_effect=command),patch.object(p,'backup_check'):
                    with self.assertRaises(RuntimeError):
                        p.fresh_backup(FakeReader(),before,audit,root)
                self.assertFalse((root/'fresh-backup.json').exists())

    def test_fresh_backup_stops_if_original_capture_changed(self):
        with tempfile.TemporaryDirectory() as d:
            before=fixtures.capture_fixture()
            class ChangedReader:
                def capture(self,*args):
                    changed=copy.deepcopy(before); changed['fingerprints']={}; return changed
            with patch.object(p,'run',return_value='pg_dump (PostgreSQL) 18.6') as command:
                with self.assertRaises(RuntimeError):
                    p.fresh_backup(ChangedReader(),before,{},Path(d))
                self.assertEqual(command.call_count,1) # version check only, no dump

    def test_unconfirmed_writers_produce_fail_without_install_package(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); (root/'Documents').mkdir()
            before=fixtures.capture_fixture(); before['project_attestation']=p.PROJECT
            capture=root/'capture.json'; capture.write_text(json.dumps(before))
            rollback=root/'rollback.TEST.sql'; rollback.write_text(p.g.rollback(before))
            audit=fixtures.AutomationTests().supplementary_fixture()
            for table in ('public.iig_notification_settings','public.iig_notification_events'):
                audit['rows'][table]={'rows':0,'md5':'offline'}
            class FakeReader:
                def __init__(self,*args): pass
                def capture(self,*args): return copy.deepcopy(before)
                def audit(self,*args): return copy.deepcopy(audit)
                def sql(self,*args,**kwargs): return 'Offline fake TEST SSL connection'
            def command(args,env=None):
                if args[-2:]==['branch','--show-current']: return 'pr6-test-rollback-preparation\n'
                if 'status' in args: return ''
                if 'show' in args:
                    name=args[-1].split('/')[-1]
                    return (p.REPO/'supabase/staging'/name).read_text()
                if args==['psql','--version']: return 'psql (PostgreSQL) 18.6'
                raise AssertionError('Unexpected command boundary: '+str(args))
            argv=['prepare-test.py','--capture',str(capture),'--rollback',str(rollback),'--root',str(root)]
            with patch.object(p.Path,'home',return_value=root),patch.object(p.sys,'argv',argv),\
                 patch.object(p,'run',side_effect=command),patch.object(p,'evidence',return_value=audit),\
                 patch.object(p,'backup_check',return_value='offline-backup-hash'),patch.object(p,'fresh_backup',return_value={'offline':True}),\
                 patch.object(p,'service_config',return_value=self.config()),patch.object(p,'Reader',FakeReader),\
                 patch.object(p,'online_checks',return_value=(before,audit,{})),patch.object(p.time,'sleep'),\
                 patch('builtins.print'):
                self.assertEqual(p.main(),1)
            reports=list((root/'Documents/ImInGolf-TEST-Installation').glob('*/report.json'))
            self.assertEqual(len(reports),1)
            report=json.loads(reports[0].read_text())
            self.assertEqual(report['result'],'FAIL')
            self.assertFalse(report['migrations_executed'])
            self.assertTrue(report['baseline_unchanged'])
            self.assertIn('Writers NOT confirmed',report['error'])
            self.assertFalse((reports[0].parent/'package.json').exists())

if __name__=='__main__': unittest.main()
