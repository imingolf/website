import contextlib
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import ssl
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('test_only_preflight',Path(__file__).with_name('preflight.py'))
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)

class Safety(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
    def file(self,name,text):
        f=self.root/name;f.write_text(text);f.chmod(0o600);return f
    def capture(self):
        names=[('public','tens_in_groups'),('iig_private','group_owners'),('iig_private','group_members')]
        return {'format':1,'project_attestation':p.PROJECT,'database':'postgres','role':'postgres',
                'fingerprints':{s+'.'+t:{'rows':2,'md5':'a'*32} for s,t in names},
                'functions':[{'requested':'public.save_group_state(text,jsonb)','exists':True,'meta':{'definition':'PRIVATE fictional definition','owner':'postgres','acl_raw':None,'settings':None,'security_definer':True}}],
                'inventory':{'tables':[{'schema':s,'name':t,'owner':'postgres','acl':None,'rls':True,'force_rls':False} for s,t in names],
                'triggers':[{'table':'public.tens_in_groups','name':'fictional','enabled':'O','definition':'PRIVATE fictional trigger'}],
                'schemas':[{'name':s,'owner':'postgres','acl':None} for s in ('public','iig_private')],
                'policies':[],'default_acl':[]}}
    def service(self,**changes):
        s={'host':p.POOLER,'port':'5432','dbname':'postgres','user':'postgres.'+p.PROJECT,'sslmode':'verify-full','sslrootcert':'system'};s.update(changes)
        return self.file('service.conf','[iig-test-only]\n'+'\n'.join(k+'='+v for k,v in s.items()))
    def ca(self):return self.file('ca.crt','-----BEGIN CERTIFICATE-----\nFICTIONAL\n-----END CERTIFICATE-----')
    def args(self):
        return SimpleNamespace(capture=self.file('capture.json',json.dumps(self.capture())),
           service=self.service(),ca=self.ca(),rollback=self.file('rollback.TEST.sql','BEGIN; -- '+p.PROJECT+'\nROLLBACK;'),
           backup=self.file('original.dump','PGDMP fictional archive'),out=self.root/'evidence')
    def prepare(self):
        a=self.args()
        with patch.object(p.ssl,'create_default_context'),patch.object(p.shutil,'which',side_effect=lambda n:'/approved/'+n),patch.object(p.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout='1; 1259 10 TABLE public tens_in_groups postgres\n',stderr='')):
            folder=p.prepare(a)
        return folder
    def data(self):
        c=self.capture()
        return {'identity':{'section':'identity','project':p.PROJECT,'database':'postgres','role':'postgres','session_role':'postgres','version':'170011','transaction_read_only':'on','default_transaction_read_only':'on','backend_ssl':True},
        'functions':{'section':'functions','items':[{'signature':c['functions'][0]['requested'],**c['functions'][0]['meta']}]},
        'tables':{'section':'tables','items':[{**t,'effective_owner':True} for t in c['inventory']['tables']]},
        'triggers':{'section':'triggers','items':c['inventory']['triggers']},'policies':{'section':'policies','items':[]},
        'authority':{'section':'authority','database_create':True,'guard_schema_exists':False,'schemas':[{**s,'create':True} for s in c['inventory']['schemas']]},
        'platform':{'section':'platform','default_acl':[]},'writers':{'section':'writers','items':[]},
        'fingerprints':{'section':'fingerprints','items':c['fingerprints']}}
    def output(self,d=None):return '1\n1\n'+'\n'.join(json.dumps(v) for v in (d or self.data()).values())+'\n'
    def test_exact_scope_no_Auth_rows_or_RPC_calls(self):
        sql=p.build_sql(self.capture());self.assertIn('READ ONLY',sql);self.assertIn('pg_stat_ssl',sql)
        self.assertNotIn('auth.users',sql);self.assertNotIn('auth.identities',sql);self.assertNotIn('PRIVATE fictional',sql)
        self.assertNotIn('save_group_state(',sql);self.assertIn('row_security = off',sql)
        self.assertTrue(sql.endswith('COMMIT;\n'));self.assertIn('"public"."tens_in_groups"',sql)
    def test_relation_guard_precedes_all_application_reads(self):
        sql=p.build_sql(self.capture())
        self.assertIn("rel.relkind='r'",sql);self.assertIn('inhparent=rel.oid',sql)
        self.assertIn("ty.typnamespace<>'pg_catalog'::regnamespace",sql)
        self.assertLess(sql.index('LOCK TABLE ONLY'),sql.index("rel.relkind='r'"))
        self.assertLess(sql.index("rel.relkind='r'"),sql.index('FROM "public"."tens_in_groups"'))
        self.assertIn('IN ACCESS SHARE MODE',sql)
    def test_template_drift(self):
        with patch.object(p,'HERE',self.root):
            self.file('catalog.sql','SELECT dangerous();');self.file('query-manifest.json',json.dumps({'project':p.PROJECT,'sha256':'wrong'}))
            with self.assertRaises(p.Stop):p.approved_template()
    def test_even_rehashed_write_template_rejected(self):
        import hashlib
        text='SELECT 1; DELETE FROM public.tens_in_groups;'
        self.file('catalog.sql',text);self.file('query-manifest.json',json.dumps({'project':p.PROJECT,'sha256':hashlib.sha256(text.encode()).hexdigest()}))
        with patch.object(p,'HERE',self.root),self.assertRaises(p.Stop):p.approved_template()
    def test_client_metacommands_rejected(self):
        import hashlib
        text='SELECT 1;\n\\connect other\n'
        self.file('catalog.sql',text);self.file('query-manifest.json',json.dumps({'project':p.PROJECT,'sha256':hashlib.sha256(text.encode()).hexdigest()}))
        with patch.object(p,'HERE',self.root),self.assertRaises(p.Stop):p.approved_template()
    def test_wrong_capture_project(self):
        c=self.capture();c['project_attestation']='not-test'
        with self.assertRaises(p.Stop):p.build_sql(c)
    def test_unbounded_inventory(self):
        c=self.capture();c['inventory']['tables']*=1
        for i in range(25):c['inventory']['tables'].append({'schema':'public','name':'x'+str(i)})
        with self.assertRaises(p.Stop):p.build_sql(c)
    def test_identifier_injection(self):
        for name in ['x;DELETE FROM x','x"','../x','x.y','x\n','UPPER']:
            c=self.capture();c['inventory']['tables'].append({'schema':'public','name':name})
            with self.subTest(name=name),self.assertRaises(p.Stop):p.build_sql(c)
    def test_missing_core_fingerprint(self):
        c=self.capture();del c['fingerprints']['iig_private.group_members']
        with self.assertRaises(p.Stop):p.scope(c)
    def test_service_pooler_is_only_identity_evidence_not_target(self):
        m=p.service(self.service());self.assertEqual(m['selected_route'],'explicit_direct_TEST_only')
        env=p.environment('/private/test.crt','SECRET');self.assertEqual(env['PGHOST'],p.HOST);self.assertEqual(env['PGUSER'],'postgres')
    def test_service_direct_supported(self):self.assertEqual(p.service(self.service(host=p.HOST,user='postgres'))['source_route'],'direct')
    def test_service_rejects_live_and_overrides(self):
        for change in [{'host':'db.kzzzputsqxdntfqpprnz.supabase.co'},{'user':'postgres.other'}, {'port':'6543'},{'host':'127.0.0.1'},{'dbname':'other'}, {'sslmode':'require'},{'hostaddr':'1.2.3.4'}, {'options':'-c x=y'}, {'password':'SECRET'},{'service':'other'}]:
            with self.subTest(change=change),self.assertRaises(p.Stop):p.service(self.service(**change))
    def test_service_defaults_rejected(self):
        f=self.file('defaults','[DEFAULT]\nhost='+p.HOST+'\n[iig-test-only]\nuser=postgres\n')
        with self.assertRaises(p.Stop):p.service(f)
    def test_service_duplicate_rejected(self):
        f=self.file('duplicate','[iig-test-only]\nhost=x\nhost=y\n')
        with self.assertRaises(Exception):p.service(f)
    def test_missing_private_file(self):
        with self.assertRaises(p.Stop):p.private_file(self.root/'missing','input')
    def test_world_readable_file_rejected(self):
        f=self.ca();f.chmod(0o644)
        with self.assertRaises(p.Stop):p.certificate(f)
    def test_symlink_rejected(self):
        f=self.ca();link=self.root/'link';link.symlink_to(f)
        with self.assertRaises(p.Stop):p.certificate(link)
    def test_wrong_owner_rejected(self):
        f=self.ca()
        with patch.object(p.os,'getuid',return_value=-1),self.assertRaises(p.Stop):p.certificate(f)
    def test_invalid_CA_rejected(self):
        with self.assertRaises(ssl.SSLError):p.certificate(self.ca())
    def test_CA_private_key_rejected(self):
        f=self.file('key','-----BEGIN PRIVATE KEY-----\nsecret')
        with self.assertRaises(p.Stop):p.certificate(f)
    def test_CA_parser_failure_closed(self):
        with patch.object(p.ssl,'create_default_context',side_effect=ssl.SSLError('secret')),self.assertRaises(ssl.SSLError):p.certificate(self.ca())
    def test_valid_CA_canonical_path(self):
        f=self.ca()
        with patch.object(p.ssl,'create_default_context') as trust:
            self.assertEqual(p.certificate(f),f.resolve());trust.assert_called_once_with(cafile=str(f.resolve()))
    def test_environment_no_inherited_PG_or_password_fallback(self):
        with patch.dict(os.environ,{'PGHOST':'LIVE','PGHOSTADDR':'1.1.1.1','PGSERVICE':'live','DATABASE_URL':'secret','PGPASSWORD':'inherited','PGOPTIONS':'write'}):
            e=p.environment('/test-ca','prompted')
            self.assertEqual(e['PGPASSWORD'],'prompted');self.assertEqual(e['PGHOST'],p.HOST)
            for k in ('PGHOSTADDR','DATABASE_URL','PGSERVICE','HOME'):self.assertNotIn(k,e)
            self.assertEqual(e['PGSSLMODE'],'verify-full');self.assertEqual(e['PGGSSENCMODE'],'disable')
            self.assertIn('default_transaction_read_only=on',e['PGOPTIONS'])
    def test_offline_prepare_only_archive_list_no_database(self):
        with patch('socket.socket',side_effect=AssertionError('no network')):
            a=self.args()
            with patch.object(p.ssl,'create_default_context'),patch.object(p.shutil,'which',return_value='/approved/tool'),patch.object(p.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout='TABLE public tens_in_groups postgres',stderr='')) as run:
                out=p.prepare(a)
            self.assertEqual(run.call_count,1);self.assertEqual(run.call_args.args[0][1],'--list')
            m=json.loads((out/'manifest.PRIVATE.json').read_text());self.assertEqual(m['database_connections'],0)
            self.assertFalse(m['backup']['historical_checksum_available']);self.assertFalse(m['backup']['full_restore_proven'])
            self.assertFalse(m['original_rollback_reused_as_incident_rollback'])
            for f in out.iterdir():self.assertEqual(f.stat().st_mode&0o777,0o600)
    def test_archive_list_failure(self):
        a=self.args()
        with patch.object(p.subprocess,'run',return_value=SimpleNamespace(returncode=1,stdout='',stderr='SECRET')),self.assertRaises(p.Stop):p.archive_evidence(a.backup,'pg_restore')
    def test_archive_magic(self):
        f=self.file('bad.dump','wrong')
        with patch.object(p.subprocess,'run') as run,self.assertRaises(p.Stop):p.archive_evidence(f,'pg_restore')
        run.assert_not_called()
    def test_no_overwrite_package(self):
        out=self.prepare();a=self.args();a.out=out
        with patch.object(p.ssl,'create_default_context'),patch.object(p.shutil,'which',return_value='/tool'),patch.object(p.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout='TABLE public tens_in_groups postgres',stderr='')),self.assertRaises(p.Stop):p.prepare(a)
    def test_package_query_tamper(self):
        out=self.prepare();(out/'inspection.READONLY.sql').write_text('DELETE FROM anything;')
        with patch.object(p.ssl,'create_default_context'),self.assertRaises(p.Stop):p.package(out)
    def test_input_drift(self):
        out=self.prepare();(self.root/'capture.json').write_text('{}')
        with self.assertRaises(p.Stop):p.package(out)
    def test_code_drift(self):
        out=self.prepare()
        with patch.object(p,'code_hashes',return_value={}),self.assertRaises(p.Stop):p.package(out)
    def test_parse_valid(self):self.assertEqual(set(p.parse(self.output())),p.SECTIONS)
    def test_parse_TLS_roles_and_readonly_failclosed(self):
        for k,v in [('backend_ssl',False),('transaction_read_only','off'),('default_transaction_read_only','off'),('role','anon'),('session_role','other'),('project','other'),('version','180000')]:
            d=self.data();d['identity'][k]=v
            with self.subTest(k=k),self.assertRaises(p.Stop):p.parse(self.output(d))
    def test_parse_missing_duplicate_or_guard(self):
        for raw in ['',self.output().replace('1\n','0\n',1),'NOTICE secret\n'+self.output(),self.output()+'{}\n']:
            with self.subTest(raw=raw[:12]),self.assertRaises(Exception):p.parse(raw)
    def test_null_inventory_rejected(self):
        d=self.data();d['functions']['items']=None
        with self.assertRaises(p.Stop):p.parse(self.output(d))
    def test_baseline_null_ACL_and_config_preserved(self):self.assertEqual(p.baseline(self.capture(),self.data()),[])
    def test_data_drift(self):
        d=self.data();d['fingerprints']['items']['public.tens_in_groups']['md5']='b'*32
        self.assertIn('protected_fingerprint_changed',p.baseline(self.capture(),d))
    def test_permissions_RLS_trigger_policy_drift(self):
        for section,key,value in [('tables','rls',False),('tables','acl','changed'),('functions','owner','other'),('functions','settings',[]),('triggers','enabled','D')]:
            d=self.data();d[section]['items'][0][key]=value
            with self.subTest(section=section,key=key):self.assertTrue(p.baseline(self.capture(),d))
        d=self.data();d['policies']['items']=[{'schemaname':'public','tablename':'tens_in_groups'}];self.assertTrue(p.baseline(self.capture(),d))
    def test_empty_sessions_never_proves_pause_or_recovery(self):
        report=p.report(self.capture(),self.data(),{'backup':{}})
        self.assertEqual(report['writer_controls'],'UNVERIFIED');self.assertEqual(report['installation'],'NO-GO')
        self.assertIn('UNVERIFIED',report['recovery']);self.assertFalse(report['auth_data_compared'])
    def test_missing_effective_ownership_fails(self):
        d=self.data();d['tables']['items'][0]['effective_owner']=False
        self.assertEqual(p.report(self.capture(),d,{'backup':{}})['candidate_install_privileges'],'FAIL')
    def test_mock_connection_fixed_single_attempt_password_not_saved(self):
        out=self.prepare()
        with patch.object(p.ssl,'create_default_context'),patch.object(p.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout=self.output(),stderr='SECRET')) as run:
            p.connect(out,'PASSWORD_SECRET','/approved/psql')
        self.assertEqual(run.call_count,1);args,kw=run.call_args
        self.assertNotIn('PASSWORD_SECRET',' '.join(args[0]));self.assertNotIn('shell',kw)
        self.assertIn('-X',args[0]);self.assertEqual(kw['env']['PGHOST'],p.HOST)
        self.assertEqual(kw['input'],p.build_sql(self.capture()))
        for f in out.iterdir():self.assertNotIn('PASSWORD_SECRET',f.read_text())
    def test_failure_no_retry_and_no_error_leak(self):
        out=self.prepare()
        with patch.object(p.ssl,'create_default_context'),patch.object(p.subprocess,'run',return_value=SimpleNamespace(returncode=1,stdout='',stderr='SECRET')),self.assertRaises(p.Stop):p.connect(out,'SECRET','psql')
        self.assertFalse((out/'catalog.PRIVATE.json').exists());self.assertTrue((out/'connection-attempt.json').exists())
        with patch.object(p.ssl,'create_default_context'),self.assertRaises(p.Stop):p.package(out)
    def test_drift_preserves_private_evidence_but_stops(self):
        out=self.prepare();d=self.data();d['fingerprints']['items']['public.tens_in_groups']['rows']=999
        with patch.object(p.ssl,'create_default_context'),patch.object(p.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout=self.output(d),stderr='')),self.assertRaises(p.Stop):p.connect(out,'secret','psql')
        r=json.loads((out/'report.SANITISED.json').read_text());self.assertEqual(r['original_application_baseline'],'FAIL')
    def test_existing_guard_stops_after_saving_report(self):
        out=self.prepare();d=self.data();d['authority']['guard_schema_exists']=True
        with patch.object(p.ssl,'create_default_context'),patch.object(p.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout=self.output(d),stderr='')),self.assertRaises(p.Stop):p.connect(out,'secret','psql')
        self.assertTrue((out/'report.SANITISED.json').exists())
    def test_timeout_no_retry_no_raw_diagnostic(self):
        out=self.prepare()
        with patch.object(p.ssl,'create_default_context'),patch.object(p.subprocess,'run',side_effect=p.subprocess.TimeoutExpired('SECRET',1)) as run,self.assertRaises(p.subprocess.TimeoutExpired):p.connect(out,'secret','psql')
        self.assertEqual(run.call_count,1);self.assertTrue((out/'connection-attempt.json').exists())
        self.assertFalse((out/'catalog.PRIVATE.json').exists())
    def test_schema_and_default_grant_drift(self):
        d=self.data();d['authority']['schemas'][0]['acl']='broader'
        self.assertIn('schema_permissions_changed_or_baseline_missing',p.baseline(self.capture(),d))
        d=self.data();d['platform']['default_acl']=[{'defaclacl':'broader'}]
        self.assertIn('default_permissions_changed',p.baseline(self.capture(),d))
    def test_report_never_echoes_private_definitions(self):
        self.assertNotIn('PRIVATE fictional',json.dumps(p.report(self.capture(),self.data(),{'backup':{}})))
    def test_noninteractive_connection_stopped(self):
        with patch.object(p.sys.stdin,'isatty',return_value=False),patch.object(p.subprocess,'run') as run,contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(p.main(['--package','/missing','--connect-test-readonly',p.PROJECT]),1)
        run.assert_not_called()
    def test_missing_CA_offline_no_connection(self):
        with patch.object(p.sys.stdin,'isatty',return_value=False),patch.object(p.subprocess,'run') as run,contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(p.main([]),1)
        run.assert_not_called();self.assertIn('attempted: 0',out.getvalue())

if __name__=='__main__':unittest.main()
