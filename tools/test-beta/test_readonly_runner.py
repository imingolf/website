"""Offline only. Every database/client boundary is mocked. No SQL is executed."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('iig_readonly_runner',HERE/'readonly_runner.py')
m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)
reference=m.load_reference();g,compare=reference.helpers()
SECRET='offline-only-password-"\\$do-not-persist'


def baseline(project=m.PROJECT):
    functions=[]
    for sig in g.REQUIRED+g.OPTIONAL+g.NEW:
        exists=sig in g.REQUIRED
        meta={'definition':'-- offline fixture, never execute','owner':'postgres','signature':sig,
              'security_definer':True,'settings':['search_path=""'],
              'acl':[{'grantor':'postgres','grantee':'postgres','privilege':'EXECUTE','grantable':False}]} if exists else None
        functions.append({'requested':sig,'exists':exists,'meta':meta})
    fps={table:{'rows':0,'md5':'offline-only'} for table in g.GUARDED}
    fps['iig_private.group_owners']['rows']=2;fps['iig_private.group_members']['rows']=3
    value={'format':1,'commit':'eadb495','project_attestation':project,'project_setting':None,'role':'postgres','database':'postgres',
            'installation_privileges':{'database_create':True,'public_create':True,'private_create':True,'auth_trigger':True},
            'functions':functions,'new_tables':{t:False for t in g.TABLES},'new_triggers':[],'fingerprints':fps,
            'inventory':{k:[] for k in compare.INVENTORIES}}
    value['inventory']['roles']=[{'rolname':name,'rolsuper':False,'rolbypassrls':False} for name in ('anon','authenticated')]
    value['inventory']['tables']=[{'schema':t.split('.')[0],'name':t.split('.')[1],'rls':True} for t in
        ('public.tens_in_groups','public.iig_notification_settings','public.iig_notification_events','iig_private.group_owners',
         'iig_private.group_members','iig_private.platform_owners','iig_private.setup_testers','iig_private.registration_settings')]
    return value


def catalog():
    names=['auth.uid()','pg_catalog.gen_random_uuid()','pg_catalog.hashtextextended(text,bigint)','iig_private.verified_organiser()',
      'iig_private.check_group_access(text)','public.get_group_access_status(text)','public.iig_create_owned_group(text,text,uuid)',
      'public.iig_get_owned_group()','public.iig_save_owned_group(text,jsonb,bigint)','public.iig_join_owned_group(text,uuid,text,numeric)',
      'public.iig_get_player_group(text)','public.iig_set_my_attendance(text,boolean,bigint)','public.iig_submit_my_score(text,integer,text,bigint)',
      'public.iig_list_registered_groups(integer)']
    return {'transaction_read_only':'on','groups':[{'pin':pin,'state_type':'object','players_type':'array','history_type':'array','owners':1} for pin in ('3520','5021')],
            'owner_accounts':dict(rows=2,missing_auth=0,unverified=0,anonymous=0,banned=0),
            'member_accounts':dict(rows=3,missing_auth=0,unverified=0,anonymous=0,banned=0),
            'membership_matches':[{'matches':1,'members':3}],'writer_locks':[],'prepared_transactions':0,'cron_net':[],
            'prerequisites':[{'requested':name,'exists':True,'definition':'-- offline fixture, never execute','owner':'postgres',
                  'anon_execute':name=='public.get_group_access_status(text)',
                  'authenticated_execute':name.startswith('public.')} for name in names]}


def audit(before=None):
    c=catalog();rows=copy.deepcopy((before or baseline())['fingerprints'])
    rows.update({t:{'rows':0,'md5':'offline-notifications'} for t in ('public.iig_notification_settings','public.iig_notification_events')})
    return {'rows':rows,'sequence':{'last_value':2,'is_called':True},
            'functions':[{'signature':f['requested'],'definition':f['definition'],'owner':'postgres','acl':[]} for f in c['prerequisites']],
            'constraints':[],'indexes':[],'columns':[{'table':'public.tens_in_groups','column':'state','acl':None}],'groups':[]}


def identity():
    return dict(database='postgres',role='postgres',session_role='postgres',version_num='170011',transaction_read_only='on',default_transaction_read_only='on',project_setting=None,ssl=True)


def owner(native=True):
    return {'current_role':'postgres','current_superuser':False,'owner_usage':native,'owner_member':True,'owner_set':True,'trigger_privilege':True,
            'settings':[{'name':'shared_preload_libraries','setting':'supautils'},
                        {'name':'supautils.drop_trigger_grants','setting':json.dumps({'postgres':['auth.users']}),'context':'sighup','pending_restart':False}]}


class RunnerTests(unittest.TestCase):
    def service(self,root,changes=None,extra=''):
        c={'host':m.POOLER,'port':'5432','dbname':'postgres','user':'postgres.'+m.PROJECT,'sslmode':'require'};c.update(changes or {})
        path=root/'service.conf';path.write_text('[iig-test-only]\n'+''.join(k+'='+v+'\n' for k,v in c.items())+extra);path.chmod(0o600);return path
    def reader(self,root,approval=m.PROJECT):
        return m.Reader(m.Target(m.POOLER,'postgres.'+m.PROJECT),SECRET,m.query_registry(),m.Tools('/offline/psql','/offline/pg_restore'),root,approval)
    def test_exact_test_targets_only(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            t,_=m.read_service(self.service(root));self.assertEqual(t.host,m.POOLER)
            m.read_service(self.service(root,{'host':'db.'+m.PROJECT+'.supabase.co','user':'postgres'}))
            for change in [{'host':'db.kzzzputsqxdntfqpprnz.supabase.co'},{'user':'postgres.kzzzputsqxdntfqpprnz'},
                           {'user':'postgres'},{'hostaddr':'1.2.3.4'},{'options':'-c default_transaction_read_only=off'},
                           {'host':m.POOLER+',other.invalid'},{'host':'127.0.0.1'},{'host':'/tmp'},
                           {'port':'6543'},{'dbname':'other'},{'sslmode':'prefer'},{'sslmode':'disable'},
                           {'sslkey':'/unreviewed/key'},{'service':'live'}]:
                with self.subTest(change=change),self.assertRaises(m.StopReview):m.read_service(self.service(root,change))
    def test_missing_defaults_duplicate_and_malformed_services_fail_without_password_leak(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);path=root/'service.conf'
            for text in ['', '[other]\nhost=somewhere\n', '[DEFAULT]\nhost=live\n[iig-test-only]\n',
                         '[iig-test-only]\nhost=x\nhost=y\n', 'password='+SECRET]:
                path.write_text(text);path.chmod(0o600)
                with self.assertRaises(m.StopReview) as error:m.read_service(path)
                self.assertNotIn(SECRET,str(error.exception))
    def test_other_service_credentials_never_become_test_password(self):
        with tempfile.TemporaryDirectory() as d:
            path=self.service(Path(d),extra='[live]\nhost=live.invalid\npassword=unrelated-live-secret\n')
            target,secret=m.read_service(path);self.assertIsNone(secret);self.assertEqual(target.host,m.POOLER)
    def test_private_password_files_exact_no_wildcards_or_other_projects(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);p=root/'pgpass';target=m.Target(m.POOLER,'postgres.'+m.PROJECT)
            p.write_text(m.POOLER+':5432:postgres:'+target.user+':test\\:password\\\\literal\n');p.chmod(0o600)
            self.assertEqual(m.pgpass_password(p,target),'test:password\\literal')
            for text in ['*:5432:postgres:'+target.user+':secret\n',m.POOLER+':5432:postgres:postgres.live:secret\n',
                         m.POOLER+':5432:postgres:'+target.user+':one\n'+m.POOLER+':5432:postgres:'+target.user+':two\n']:
                p.write_text(text)
                with self.assertRaises(m.StopReview):m.pgpass_password(p,target)
            p.chmod(0o644)
            with self.assertRaises(m.StopReview):m.pgpass_password(p,target)
    def test_both_credentials_and_insecure_service_password_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            with self.assertRaises(m.StopReview):m.read_service(self.service(root,{'password':SECRET,'passfile':'/tmp/other'}))
            p=self.service(root,{'password':SECRET});p.chmod(0o644)
            with self.assertRaises(m.StopReview):m.read_service(p)
    def test_environment_argv_tls_and_readonly_are_test_scoped(self):
        with tempfile.TemporaryDirectory() as d,patch.dict(os.environ,{'PGHOST':'live.invalid','PGSERVICE':'live','PGPASSWORD':'unrelated-secret','PGOPTIONS':'-c default_transaction_read_only=off'}):
            reader=self.reader(Path(d))
            with patch.object(m.subprocess,'run',return_value=subprocess.CompletedProcess([],0,stdout=json.dumps(identity()),stderr='')) as command:
                reader.execute('identity')
            args=command.call_args.args[0];env=command.call_args.kwargs['env'];sql=command.call_args.kwargs['input']
            self.assertNotIn(SECRET,' '.join(args));self.assertNotIn('live.invalid',' '.join(args));self.assertIn(m.PROJECT,' '.join(args))
            self.assertIn("sslmode='verify-full'",reader.info);self.assertIn("sslrootcert='system'",reader.info)
            self.assertIn("passfile='"+os.devnull+"'",reader.info);self.assertEqual(env['PGPASSWORD'],SECRET)
            self.assertNotIn('PGHOST',env);self.assertNotIn('PGSERVICE',env);self.assertIn('read_only=on',env['PGOPTIONS'])
            self.assertIn('read_only=on',reader.info);self.assertIn('-X',args);self.assertIn('-w',args);self.assertIn('ON_ERROR_STOP=1',args)
            self.assertEqual(sql,m.query_registry()['identity']['sql']);self.assertIn('READ ONLY',sql)
            self.assertEqual(os.environ['PGPASSWORD'],'unrelated-secret')
    def test_no_exact_connection_approval_no_reader(self):
        with tempfile.TemporaryDirectory() as d,patch.object(m.subprocess,'run') as command:
            for flag in [None,'','live',m.PROJECT+'x']:
                with self.assertRaises(m.StopReview):self.reader(Path(d),flag)
            command.assert_not_called()
    def test_raw_sql_or_unreviewed_query_cannot_run(self):
        with tempfile.TemporaryDirectory() as d,patch.object(m.subprocess,'run') as command:
            r=self.reader(Path(d))
            for sql in ['DROP TABLE public.tens_in_groups','SELECT pg_terminate_backend(1)','SET default_transaction_read_only=off','capture;DELETE','rollback']:
                with self.assertRaises(m.StopReview):r.execute(sql)
            malicious=copy.deepcopy(m.query_registry());malicious['identity']['sql']='BEGIN; DELETE FROM auth.users; COMMIT;'
            with self.assertRaises(m.StopReview):m.Reader(r.target,SECRET,malicious,r.tools,Path(d),m.PROJECT)
            command.assert_not_called()
    def test_query_manifest_mutation_stops_even_if_inner_checksum_recomputed(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);data=json.loads((HERE/'readonly-queries.json').read_text());data['queries']['identity']['sql']='SELECT pg_terminate_backend(1);'
            data['queries']['identity']['sha256']=m.hashlib.sha256(data['queries']['identity']['sql'].encode()).hexdigest()
            (root/'readonly-queries.json').write_text(json.dumps(data))
            with patch.object(m,'HERE',root),self.assertRaises(m.StopReview):m.query_registry()
    def test_credentials_and_raw_diagnostics_never_written(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);r=self.reader(root);value={**identity(),'credential_probe':SECRET}
            with patch.object(m.subprocess,'run',return_value=subprocess.CompletedProcess([],0,stdout=json.dumps(value),stderr=SECRET)):
                result=r.execute('identity')[0]
            self.assertEqual(result['credential_probe'],SECRET) # comparison input is never modified by redaction
            for p in root.iterdir():
                self.assertNotIn(SECRET,p.read_text());self.assertNotIn(json.dumps(SECRET)[1:-1],p.read_text())
            with patch.object(m.subprocess,'run',return_value=subprocess.CompletedProcess([],2,stdout='',stderr='password authentication failed '+SECRET)) as command:
                with self.assertRaisesRegex(m.StopReview,'AUTHENTICATION_FAILED'):r.execute('identity')
                self.assertEqual(command.call_count,1)
            for p in root.iterdir():self.assertNotIn(SECRET,p.read_text())
    def test_identity_guards_before_application_queries(self):
        for field,value in [('database','other'),('role','supabase_admin'),('session_role','other'),('version_num','170012'),('ssl',False),('transaction_read_only','off'),('default_transaction_read_only','off'),('project_setting','another-project')]:
            changed=identity();changed[field]=value
            with self.subTest(field=field),self.assertRaises(m.StopReview):m.verify_identity(changed)
    def test_changed_baseline_stops_before_assessment(self):
        events=[]
        class Fake:
            def execute(self,key):
                events.append(key)
                if key=='identity':return [identity()]
                changed=baseline();changed['fingerprints']['public.tens_in_groups']['md5']='changed';return [changed]
        with self.assertRaises(ValueError):m.online_review(Fake(),baseline(),audit(),compare,{'checks':{}})
        self.assertEqual(events,['identity','capture'])
    def test_readonly_review_passes_without_false_release_authorisation(self):
        before=baseline();a=audit(before);report={'checks':{},'installation_authorised':False,'release_readiness':'NO-GO'}
        class Fake:
            def execute(self,key):return {'identity':[identity()],'capture':[copy.deepcopy(before)],'assessment':[owner(),catalog(),copy.deepcopy(a)],'audit':[copy.deepcopy(a)]}[key]
        m.online_review(Fake(),before,a,compare,report)
        self.assertTrue(report['review_complete']);self.assertEqual(report['checks']['rollback_authority']['status'],'PASS')
        self.assertEqual(report['checks']['auth_services']['status'],'UNVERIFIED');self.assertFalse(report['installation_authorised'])
    def test_supautils_setting_and_member_set_trigger_are_not_authority(self):
        d=owner(False);result=m.authority(d)
        self.assertTrue(result['managed_grant_candidate']);self.assertEqual(result['status'],'UNVERIFIED')
        d['settings']=[];self.assertEqual(m.authority(d)['status'],'UNVERIFIED')
        before=baseline();a=audit();report={'checks':{}}
        class Fake:
            def execute(self,key):return {'identity':[identity()],'capture':[copy.deepcopy(before)],'assessment':[owner(False),catalog(),copy.deepcopy(a)],'audit':[copy.deepcopy(a)]}[key]
        with self.assertRaisesRegex(m.StopReview,'Rollback authority'):m.online_review(Fake(),before,a,compare,report)
        self.assertTrue(report['review_complete'])
    def test_writer_locks_prepared_transactions_missing_accounts_extensions_stop_no_control(self):
        for field,value in [('writer_locks',[{'pid':123}]),('prepared_transactions',1),('cron_net',['pg_cron'])]:
            c=catalog();c[field]=value
            with self.subTest(field=field),self.assertRaises(m.StopReview):m.catalog_safety(c)
        c=catalog();c['member_accounts']['unverified']=1
        with self.assertRaises(m.StopReview):m.catalog_safety(c)
    def test_permissions_fail_without_grants_or_role_changes(self):
        for mutate in ['rls','role','privilege','function','grant']:
            before=baseline();c=catalog()
            if mutate=='rls':before['inventory']['tables'][0]['rls']=False
            if mutate=='role':before['inventory']['roles'][0]['rolsuper']=True
            if mutate=='privilege':before['installation_privileges']['auth_trigger']=False
            if mutate=='function':c['prerequisites'][3]['definition']='changed'
            if mutate=='grant':c['prerequisites'][3]['anon_execute']=True
            with self.subTest(mutate=mutate),self.assertRaises(m.StopReview):m.permissions(before,c,audit())
    def test_null_column_acls_preserved_in_snapshot_comparison(self):
        a=audit();compare.compare_supplementary(a,copy.deepcopy(a))
        b=copy.deepcopy(a);b['columns'][0]['acl']='{}'
        with self.assertRaises(ValueError):compare.compare_supplementary(a,b)
    def test_reference_loading_has_no_imported_executor_or_installer(self):
        self.assertFalse(hasattr(g,'main'));self.assertFalse(hasattr(compare,'Runner'))
        for name in ['prepare','load_generator','installed_checks','command','sql','Reader']:self.assertFalse(hasattr(compare,name))

    def archive_toc(self):
        tables=('public tens_in_groups','public iig_notification_settings','public iig_notification_events',
                'iig_private group_owners','iig_private group_members','iig_private setup_testers',
                'iig_private platform_owners','iig_private registration_settings','auth users','auth identities')
        return 'Dumped from database version: 17.11\n'+''.join('TABLE DATA '+t+' postgres\n' for t in tables)+'SEQUENCE public tens_in_groups_id_seq postgres\n'
    def test_backup_readthrough_never_connects_and_does_not_invent_anchor(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);archive=root/'original.dump';archive.write_bytes(b'PGDMPoffline-fixture')
            manifest=root/'backup.sha256';cmds=[]
            def fake(args,**kw):
                cmds.append(args);self.assertNotIn('--dbname',args);self.assertNotIn('-d',args)
                self.assertEqual(args[0],'/offline/pg_restore');self.assertNotIn('PGHOST',kw['env'])
                return subprocess.CompletedProcess(args,0,stdout=self.archive_toc() if '--list' in args else '',stderr='')
            with patch.object(m.subprocess,'run',side_effect=fake):
                result=m.archive_check(archive,manifest,m.Tools('/offline/psql','/offline/pg_restore'))
            self.assertFalse(result['historical_anchor_present']);self.assertFalse(result['historical_integrity_proven'])
            self.assertFalse(manifest.exists());self.assertEqual(archive.read_bytes(),b'PGDMPoffline-fixture')
            self.assertEqual(cmds[1][-2:], [os.devnull,str(archive)])
    def test_existing_anchor_mismatch_stops_before_any_tool(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);archive=root/'original.dump';archive.write_bytes(b'PGDMPfixture');manifest=root/'backup.sha256';manifest.write_text('0'*64+'  original.dump\n')
            with patch.object(m.subprocess,'run') as command,self.assertRaises(m.StopReview):m.archive_check(archive,manifest,m.Tools('psql','pg_restore'))
            command.assert_not_called()
    def test_backup_wrong_version_or_corruption_stops(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);archive=root/'original.dump';archive.write_bytes(b'PGDMPfixture')
            for reply in [subprocess.CompletedProcess([],0,stdout='Dumped from database version: 18.0',stderr=''),subprocess.CompletedProcess([],1,stdout='',stderr='corrupt')]:
                with patch.object(m.subprocess,'run',return_value=reply),self.assertRaises(m.StopReview):m.archive_check(archive,root/'no-anchor',m.Tools('psql','pg_restore'))
    def write_evidence(self,root):
        capture=root/'capture.json';capture.write_text(json.dumps(baseline()))
        rollback=root/'rollback.TEST.sql';rollback.write_text(g.rollback(baseline()))
        archive=root/'original.dump';archive.write_bytes(b'PGDMPoffline-only')
        rehearsal=root/m.PASS_RUN;rehearsal.mkdir()
        local=baseline('ImInGolf-Local-Rehearsal');extra=audit(local)
        report={'result':'PASS','stage':'complete','rollback_completed':True,'migration_commit':compare.COMMIT,
                'migration_sha256':dict(compare.MIGRATIONS),'previous_evidence_comparison_passed':True,
                'current_database_matches_previous_original_baseline':True}
        for name,value in {'report.json':report,'original-before.json':local,'after-rollback.json':copy.deepcopy(local),
                           'installed.json':copy.deepcopy(local),'audit-before.json':extra,'audit-after-rollback.json':copy.deepcopy(extra)}.items():
            (rehearsal/name).write_text(json.dumps(value))
        return capture,rollback,archive,rehearsal
    def test_local_rehearsal_failures_stop_without_connection(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);_,_,_,folder=self.write_evidence(root)
            m.local_evidence(folder,compare)
            value=json.loads((folder/'after-rollback.json').read_text());value['fingerprints']={};(folder/'after-rollback.json').write_text(json.dumps(value))
            with self.assertRaises(ValueError):m.local_evidence(folder,compare)
    def fake_process(self):
        # Cache immutable source blobs BEFORE the mock; only these git reads are allowed.
        originals={}
        for name in ('prepare.py','local-rehearsal/run-rehearsal.py'):
            originals[reference.REF+':'+reference.PREFIX+name]=reference.source(name).encode()
        for name,_ in compare.MIGRATIONS:
            key=compare.COMMIT+':supabase/staging/'+name+'.sql'
            originals[key]=subprocess.run(['git','-C',str(m.REPO),'show',key],capture_output=True,check=True).stdout
        queries=m.query_registry();events=[]
        def run(args,**kw):
            events.append((args,kw))
            if args[0]=='git':
                if args[-2:]==['branch','--show-current']:out='improve-new-user-registration\n'
                elif 'status' in args:out=''
                elif args[3]=='show':return subprocess.CompletedProcess(args,0,stdout=originals[args[4]],stderr=b'')
                else:raise AssertionError('Unreviewed git call')
                return subprocess.CompletedProcess(args,0,stdout=out,stderr='')
            if args[-1]=='--version':return subprocess.CompletedProcess(args,0,stdout='PostgreSQL 18.6',stderr='')
            if args[0]=='/offline/pg_restore':
                self.assertNotIn('--dbname',args);self.assertNotIn('-d',args)
                return subprocess.CompletedProcess(args,0,stdout=self.archive_toc() if '--list' in args else '',stderr='')
            if args[0]=='/offline/psql':
                key=next((k for k,v in queries.items() if v['sql']==kw['input']),None)
                self.assertIsNotNone(key);self.assertIn("sslmode='verify-full'",args[args.index('--dbname')+1])
                values={'identity':[identity()],'capture':[baseline()],'assessment':[owner(),catalog(),audit()],'audit':[audit()]}[key]
                return subprocess.CompletedProcess(args,0,stdout='\n'.join(json.dumps(v) for v in values),stderr='')
            raise AssertionError('Unknown external command blocked in offline test')
        return events,run
    def test_default_and_offline_cli_cannot_connect_or_prompt_and_preserve_evidence(self):
        for mode in ([],['--offline']):
            with self.subTest(mode=mode),tempfile.TemporaryDirectory() as d:
                root=Path(d);capture,rollback,archive,rehearsal=self.write_evidence(root);service=self.service(root)
                original={p:p.read_bytes() for p in [capture,rollback,archive]}
                events,fake=self.fake_process()
                argv=mode+['--service-file',str(service),'--capture',str(capture),'--rollback',str(rollback),'--backup',str(archive),'--rehearsal',str(rehearsal),'--historical-manifest',str(root/'missing.sha256')]
                with patch.object(m.Path,'home',return_value=root),patch.object(m.subprocess,'run',side_effect=fake),\
                     patch.object(m.shutil,'which',side_effect=lambda name:'/offline/'+name),patch.object(m.getpass,'getpass') as prompt,\
                     patch.object(m,'Reader') as reader,patch('builtins.print'):
                    self.assertEqual(m.main(argv),0);prompt.assert_not_called();reader.assert_not_called()
                self.assertFalse(any(args[0]=='/offline/psql' and args[-1]!='--version' for args,_ in events))
                report=json.loads(next((root/'Documents/ImInGolf-TEST-Installation').glob('*/report.json')).read_text())
                self.assertEqual(report['connections_attempted'],0);self.assertFalse(report['sql_executed']);self.assertFalse(report['installation_authorised'])
                for p,value in original.items():self.assertEqual(p.read_bytes(),value)
    def test_wrong_approval_cannot_even_start_preflight(self):
        with patch.object(m,'offline_preflight') as preflight,patch.object(m.subprocess,'run') as command,patch('builtins.print'):
            self.assertEqual(m.main(['--connect-test-readonly','wrong-project']),1)
            preflight.assert_not_called();command.assert_not_called()
    def test_first_connection_mode_entirely_mocked_has_hidden_prompt_and_no_secret_files(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);capture,rollback,archive,rehearsal=self.write_evidence(root);service=self.service(root);events,fake=self.fake_process()
            argv=['--connect-test-readonly',m.PROJECT,'--service-file',str(service),'--capture',str(capture),'--rollback',str(rollback),'--backup',str(archive),'--rehearsal',str(rehearsal),'--historical-manifest',str(root/'missing.sha256')]
            with patch.object(m.Path,'home',return_value=root),patch.object(m.subprocess,'run',side_effect=fake),\
                 patch.object(m.shutil,'which',side_effect=lambda name:'/offline/'+name),patch.object(m.sys.stdin,'isatty',return_value=True),\
                 patch.object(m.getpass,'getpass',return_value=SECRET) as prompt,patch('builtins.print'):
                self.assertEqual(m.main(argv),0);prompt.assert_called_once()
            reports=list((root/'Documents/ImInGolf-TEST-Installation').glob('*/report.json'));report=json.loads(reports[0].read_text())
            self.assertEqual(report['connections_attempted'],5);self.assertTrue(report['review_complete']);self.assertFalse(report['installation_authorised'])
            self.assertEqual(report['release_readiness'],'NO-GO')
            for p in reports[0].parent.rglob('*'):
                if p.is_file():self.assertNotIn(SECRET,p.read_text());self.assertEqual(p.stat().st_mode&0o077,0)
            for args,kw in events:self.assertNotIn(SECRET,' '.join(args))

if __name__=='__main__':unittest.main()
