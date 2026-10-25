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
    def output(self,d=None):return '\n'.join(p.GUARD_OUTPUT)+'\n'+'\n'.join(json.dumps(v) for v in (d or self.data()).values())+'\n'
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
        with patch.object(p.ssl,'create_default_context'),patch.object(p.subprocess,'run',side_effect=p.subprocess.TimeoutExpired('SECRET',1)) as run,self.assertRaises(p.DiagnosticStop) as error:p.connect(out,'secret','psql')
        self.assertEqual(error.exception.category,'CONNECTION_TIMEOUT_UNDETERMINED')
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

    def test_all_guard_predicates_and_order_preserved(self):
        sql=p.build_sql(self.capture())
        labels=['IIG_PREFLIGHT_SERVER_IDENTITY','IIG_PREFLIGHT_READ_ONLY_TRANSACTION',
                'IIG_PREFLIGHT_TLS','IIG_PREFLIGHT_RELATION_GUARD']
        positions=[sql.index("SELECT '"+name+"';") for name in labels]
        self.assertEqual(positions,sorted(positions))
        self.assertLess(positions[2],sql.index('LOCK TABLE ONLY'))
        self.assertLess(sql.index('LOCK TABLE ONLY'),positions[3])
        self.assertLess(positions[3],sql.index("'section','identity'"))
        for predicate in ["current_database()='postgres'","current_user='postgres'","session_user='postgres'",
                "current_setting('transaction_read_only')='on'","current_setting('default_transaction_read_only')='on'",
                "current_setting('server_version_num')::integer BETWEEN 170000 AND 179999",
                "coalesce(current_setting('supabase.project_ref',true),'') IN ('','"+p.PROJECT+"')",
                'FROM pg_catalog.pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl']:
            self.assertIn(predicate,sql)
        self.assertEqual(sql.count('SELECT 1 / CASE WHEN'),4)
        self.assertNotIn('\\',sql)

    def test_guard_failures_require_exact_progress_and_SQLSTATE(self):
        expected=['SERVER_IDENTITY_FAILURE','READ_ONLY_TRANSACTION_FAILURE','TLS_FAILURE','RELATION_GUARD_FAILURE']
        for index,category in enumerate(expected):
            raw='\n'.join(p.GUARD_OUTPUT[:2*index+1])+'\n'
            for stderr in ['ERROR:  22012\n','psql:<stdin>:17: ERROR:  22012\n']:
                with self.subTest(category=category,stderr=stderr):
                    self.assertEqual(p.failure_category(raw,stderr),category)
            self.assertEqual(p.failure_category(raw,'ERROR:  42501\n'),'SQL_OR_PERMISSION_FAILURE')
            self.assertEqual(p.failure_category(raw,'PRIVATE_SECRET'),'UNDETERMINED_CONNECTION_FAILURE')
            self.assertEqual(p.failure_category('PRIVATE_SECRET\n'+raw,'ERROR:  22012\n'),'SQL_OR_PERMISSION_FAILURE')
        self.assertEqual(p.failure_category(self.output(),'ERROR:  22012\n'),'SQL_OR_PERMISSION_FAILURE')

    def test_connection_error_classification_does_not_reflect_private_text(self):
        prefix='psql: error: connection to server at "PRIVATE_HOST" (192.0.2.1), port 5432 failed: '
        examples=[
            ('SSL error: certificate verify failed','TLS_FAILURE'),
            ('server certificate for "PRIVATE_CERT" does not match host name "PRIVATE_HOST"','TLS_FAILURE'),
            ('server does not support SSL, but SSL was required','TLS_FAILURE'),
            ('root certificate file "/PRIVATE_PATH" does not exist','TLS_FAILURE'),
            ('Network is unreachable','NETWORK_FAILURE'),('No route to host','NETWORK_FAILURE'),
            ('Connection refused','NETWORK_FAILURE'),('timeout expired','NETWORK_FAILURE'),
            ('Connection timed out','NETWORK_FAILURE'),
            ('FATAL:  password authentication failed for user "PRIVATE_USER"','AUTHENTICATION_FAILURE'),
            ('FATAL:  no pg_hba.conf entry for host "PRIVATE_HOST", user "PRIVATE_USER", database "PRIVATE_DB", SSL encryption','AUTHENTICATION_FAILURE'),
            ('FATAL:  database "PRIVATE_DB" does not exist','SERVER_IDENTITY_FAILURE'),
            ('SSL SYSCALL error: EOF detected','UNDETERMINED_CONNECTION_FAILURE'),
            ('PRIVATE_SECRET','UNDETERMINED_CONNECTION_FAILURE')]
        for message,category in examples:
            with self.subTest(message=message):
                self.assertEqual(p.failure_category('',prefix+message+'\n'),category)
        self.assertEqual(p.failure_category('','psql: error: could not translate host name "PRIVATE_HOST" to address: nodename nor servname provided, or not known\n'),'NETWORK_FAILURE')
        for code,category in [('28P01','AUTHENTICATION_FAILURE'),('28000','AUTHENTICATION_FAILURE'),
                ('25006','READ_ONLY_TRANSACTION_FAILURE'),('3D000','SERVER_IDENTITY_FAILURE'),
                ('42501','SQL_OR_PERMISSION_FAILURE'),('57014','SQL_OR_PERMISSION_FAILURE'),
                ('08006','UNDETERMINED_CONNECTION_FAILURE')]:
            self.assertEqual(p.failure_category('','FATAL:  '+code+': PRIVATE_SECRET\n'),category)

    def test_ambiguous_unrecognised_and_oversize_errors_never_guess(self):
        for stderr in ['SSL error: certificate verify failed\nFATAL: password authentication failed for user "secret"',
                'SSL error: certificate verify failed\nFATAL: unknown private failure',
                'DETAIL: password authentication failed for user "SECRET"',
                'NOTICE: SSL error: certificate verify failed',
                'PRIVATE_SECRET 25006 28P01 TLS NETWORK READ_ONLY', '']:
            self.assertEqual(p.failure_category('',stderr),'UNDETERMINED_CONNECTION_FAILURE')
        with patch.object(p,'LIMIT',8):
            self.assertEqual(p.failure_category('','ERROR:  25006'),'UNDETERMINED_CONNECTION_FAILURE')
        for invalid in [None,b'SECRET',{}]:
            self.assertEqual(p.failure_category('',invalid),'UNDETERMINED_CONNECTION_FAILURE')

    def test_retained_failure_single_attempt_private_no_partial_catalog(self):
        out=self.prepare()
        result=SimpleNamespace(returncode=2,stdout='PRIVATE_BODY',
            stderr='psql: error: connection to server at "PRIVATE_HOST" (192.0.2.1), port 5432 failed: SSL error: certificate verify failed PRIVATE_SECRET')
        with patch('socket.socket',side_effect=AssertionError('NO NETWORK')),patch('socket.getaddrinfo',side_effect=AssertionError('NO DNS')),patch.object(p.ssl,'create_default_context'),patch.object(p.subprocess,'run',return_value=result) as run,self.assertRaises(p.DiagnosticStop) as error:
            p.connect(out,'PASSWORD_SECRET','/approved/psql')
        self.assertEqual(error.exception.category,'TLS_FAILURE')
        self.assertNotIn('PRIVATE',str(error.exception).replace('private',''))
        self.assertEqual(run.call_count,1)
        args,kw=run.call_args
        self.assertEqual(args[0],['/approved/psql','-X','-w','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate'])
        self.assertEqual(kw['timeout'],120);self.assertEqual(kw['env']['PGCONNECT_TIMEOUT'],'8')
        self.assertEqual(kw['env']['PGSSLMODE'],'verify-full');self.assertEqual(kw['env']['PGHOST'],p.HOST)
        self.assertEqual(kw['env']['PGSSLROOTCERT'],str(self.root/'ca.crt'))
        self.assertEqual(kw['input'],p.build_sql(self.capture()))
        saved=json.loads((out/p.FAILURE_FILE).read_text())
        self.assertEqual(saved,p.failure_record(out,'TLS_FAILURE'))
        self.assertEqual((out/p.FAILURE_FILE).stat().st_mode&0o777,0o600)
        for f in out.iterdir():
            for secret in ['PASSWORD_SECRET','PRIVATE_BODY','PRIVATE_HOST','PRIVATE_SECRET']:
                self.assertNotIn(secret,f.read_text())
        self.assertFalse((out/'catalog.PRIVATE.json').exists())
        self.assertFalse((out/'report.SANITISED.json').exists())
        before={f.name:f.read_bytes() for f in out.iterdir()}
        with patch.object(p.ssl,'create_default_context'),patch.object(p.subprocess,'run') as run,self.assertRaises(p.Stop):p.connect(out,'PASSWORD_SECRET','psql')
        run.assert_not_called()
        self.assertEqual(before,{f.name:f.read_bytes() for f in out.iterdir()})

    def test_each_guard_failure_saved_instead_of_partial_stdout(self):
        for index,name in enumerate(p.GUARDS):
            with self.subTest(name=name),tempfile.TemporaryDirectory() as tmp:
                self.root=Path(tmp);out=self.prepare()
                result=SimpleNamespace(returncode=3,stdout='\n'.join(p.GUARD_OUTPUT[:2*index+1])+'\n',stderr='ERROR:  22012\n')
                with patch.object(p.ssl,'create_default_context'),patch.object(p.subprocess,'run',return_value=result) as run,self.assertRaises(p.DiagnosticStop) as error:p.connect(out,'SECRET','psql')
                self.assertEqual(error.exception.category,name+'_FAILURE');self.assertEqual(run.call_count,1)
                self.assertEqual(json.loads((out/p.FAILURE_FILE).read_text())['category'],name+'_FAILURE')
                self.assertFalse((out/'catalog.PRIVATE.json').exists())

    def test_response_mismatches_and_malformed_data_are_saved_safely(self):
        cases=[('database','other','SERVER_IDENTITY_FAILURE'),('role','anon','SERVER_IDENTITY_FAILURE'),
            ('session_role','other','SERVER_IDENTITY_FAILURE'),('project','other','SERVER_IDENTITY_FAILURE'),
            ('version','SECRET','SERVER_IDENTITY_FAILURE'),('version','180000','SERVER_IDENTITY_FAILURE'),
            ('transaction_read_only','off','READ_ONLY_TRANSACTION_FAILURE'),
            ('default_transaction_read_only','off','READ_ONLY_TRANSACTION_FAILURE'),('backend_ssl',False,'TLS_FAILURE')]
        for key,value,category in cases:
            with self.subTest(key=key,value=value),tempfile.TemporaryDirectory() as tmp:
                self.root=Path(tmp);out=self.prepare();data=self.data();data['identity'][key]=value
                result=SimpleNamespace(returncode=0,stdout=self.output(data),stderr='SECRET')
                with patch.object(p.ssl,'create_default_context'),patch.object(p.subprocess,'run',return_value=result),self.assertRaises(p.DiagnosticStop) as error:p.connect(out,'SECRET','psql')
                self.assertEqual(error.exception.category,category)
                self.assertEqual(json.loads((out/p.FAILURE_FILE).read_text())['category'],category)
                self.assertFalse((out/'catalog.PRIVATE.json').exists())
        data=self.data();data['identity']['role']='other';data['identity']['backend_ssl']=False
        with self.assertRaises(p.DiagnosticStop) as error:p.parse(self.output(data))
        self.assertEqual(error.exception.category,'RESPONSE_VALIDATION_FAILURE')
        with tempfile.TemporaryDirectory() as tmp:
            self.root=Path(tmp);out=self.prepare()
            with patch.object(p.ssl,'create_default_context'),patch.object(p.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout='PRIVATE_BODY',stderr='SECRET')),self.assertRaises(p.DiagnosticStop) as error:p.connect(out,'SECRET','psql')
            self.assertEqual(error.exception.category,'RESPONSE_VALIDATION_FAILURE')
            self.assertNotIn('PRIVATE_BODY',(out/p.FAILURE_FILE).read_text())

    def test_timeout_and_client_errors_retained_without_raw_exception(self):
        cases=[(p.subprocess.TimeoutExpired('PRIVATE_COMMAND',120,output=b'PRIVATE_BODY',stderr=b'SECRET'),'CONNECTION_TIMEOUT_UNDETERMINED'),
            (FileNotFoundError('PRIVATE_PATH'),'LOCAL_CLIENT_EXECUTION_FAILURE'),
            (UnicodeError('PRIVATE_BODY'),'UNDETERMINED_CONNECTION_FAILURE')]
        for exception,category in cases:
            with self.subTest(category=category),tempfile.TemporaryDirectory() as tmp:
                self.root=Path(tmp);out=self.prepare()
                with patch.object(p.ssl,'create_default_context'),patch.object(p.subprocess,'run',side_effect=exception) as run,self.assertRaises(p.DiagnosticStop) as error:p.connect(out,'PASSWORD_SECRET','psql')
                self.assertEqual(run.call_count,1);self.assertEqual(error.exception.category,category)
                self.assertEqual(json.loads((out/p.FAILURE_FILE).read_text())['category'],category)
                for f in out.iterdir():
                    for secret in ['PRIVATE_COMMAND','PRIVATE_PATH','PRIVATE_BODY','PASSWORD_SECRET']:
                        self.assertNotIn(secret,f.read_text())

    def test_diagnostic_write_failure_still_consumes_package(self):
        out=self.prepare();original_write=p.write_new
        def fail_diagnostic(path,text):
            if path.name==p.FAILURE_FILE:raise OSError('PRIVATE_DISK_ERROR')
            return original_write(path,text)
        with patch.object(p,'write_new',side_effect=fail_diagnostic),patch.object(p.ssl,'create_default_context'),patch.object(p.subprocess,'run',return_value=SimpleNamespace(returncode=1,stdout='',stderr='SECRET')) as run,self.assertRaises(OSError):p.connect(out,'SECRET','psql')
        self.assertEqual(run.call_count,1);self.assertTrue((out/'connection-attempt.json').exists())
        with patch.object(p.ssl,'create_default_context'),patch.object(p.subprocess,'run') as run,self.assertRaises(p.Stop):p.connect(out,'SECRET','psql')
        run.assert_not_called()

    def test_diagnostic_alone_or_dangling_marker_blocks_connection(self):
        out=self.prepare();p.write_new(out/p.FAILURE_FILE,'{}')
        for name in [p.FAILURE_FILE,'connection-attempt.json']:
            (out/p.FAILURE_FILE).unlink(missing_ok=True)
            marker=out/name;marker.symlink_to(self.root/'missing')
            with patch.object(p.ssl,'create_default_context'),patch.object(p.subprocess,'run') as run,self.assertRaises(p.Stop):p.connect(out,'SECRET','psql')
            run.assert_not_called();marker.unlink()

    def test_failed_CLI_only_prints_category_and_attempt_count(self):
        out=self.prepare()
        with patch.object(p.sys.stdin,'isatty',return_value=True),patch('builtins.input',return_value=p.PROJECT),patch.object(p.getpass,'getpass',return_value='PASSWORD_SECRET'),patch.object(p.shutil,'which',return_value='/approved/psql'),patch.object(p.ssl,'create_default_context'),patch.object(p.subprocess,'run',return_value=SimpleNamespace(returncode=1,stdout='PRIVATE_BODY',stderr='FATAL: password authentication failed for user "PRIVATE_USER"')) as run,contextlib.redirect_stdout(io.StringIO()) as printed:
            self.assertEqual(p.main(['--package',str(out),'--connect-test-readonly',p.PROJECT]),1)
        self.assertEqual(run.call_count,1)
        self.assertEqual(printed.getvalue(),'FAIL — connection: AUTHENTICATION_FAILURE; no retry; private error withheld. Database connections attempted: 1\n')

if __name__=='__main__':unittest.main()
