#!/usr/bin/env python3
"""Offline only: fake Docker/SQL results; no SQL, Docker or network invocation."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('runner',HERE/'run-rehearsal.py')
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

def capture_fixture():
    g=m.load_generator()
    funcs=[]
    for s in g.REQUIRED+g.OPTIONAL+g.NEW:
        exists=s in g.REQUIRED
        meta={'definition':'-- Offline synthetic fixture, never execute', 'owner':'postgres',
              'signature':s,'security_definer':True,'settings':['search_path=""'],
              'acl':[{'grantor':'postgres','grantee':'postgres','privilege':'EXECUTE','grantable':False}]} if exists else None
        funcs.append({'requested':s,'exists':exists,'meta':meta})
    return {'format':1,'commit':'eadb495','project_attestation':m.PROJECT,
            'role':'postgres','database':'postgres','project_setting':None,
            'functions':funcs,'new_tables':{t:False for t in g.TABLES},'new_triggers':[],
            'fingerprints':{t:{'rows':0,'md5':'offline-fixture'} for t in g.GUARDED},
            'inventory':{k:[] for k in m.INVENTORIES}}

class FakeRunner(m.Runner):
    """Replace all boundary operations: tests must never invoke SQL or Docker."""
    def __init__(self,root,fail=None):
        super().__init__(root)
        self.events=[]
        self.fail=fail
        self.baseline=capture_fixture()
        self.extra={'rows':{},'sequence':{},'functions':[],'constraints':[],
                    'indexes':[],'columns':[],'groups':[]}

    def command(self,*args,**kwargs):
        raise AssertionError('External command forbidden in offline fake')

    def prepare(self):
        self.events.append('prepare')
        if self.fail=='preflight': raise RuntimeError('preflight mismatch')
        return self.baseline,self.extra,[(n,'-- fake') for n,_ in m.MIGRATIONS],'-- fake rollback'

    def sql(self,text,label,variables=()):
        self.events.append(label)
        if self.fail==label: raise RuntimeError('simulated execution error')
        return ''

    def capture(self,label):
        self.events.append(label)
        c=copy.deepcopy(self.baseline)
        if self.fail=='data' and label=='after-integration-hardening':
            c['fingerprints']['public.tens_in_groups']['md5']='changed'
        if self.fail=='post' and label=='after-rollback':
            c['inventory']['triggers'].append({'changed':True})
        return c

    def installed_checks(self,*args):
        self.events.append('checks')
        if self.fail=='checks': raise RuntimeError('security mismatch')

    def verify_rls(self):
        self.events.append('rls')

    def audit(self,label):
        return copy.deepcopy(self.extra)

class AutomationTests(unittest.TestCase):
    def setUp(self):
        quiet=patch('builtins.print')
        quiet.start()
        self.addCleanup(quiet.stop)

    def test_local_target_constraints(self):
        c={'Name':'/'+m.CONTAINER,'Id':'fixture','State':{'Running':True},
           'HostConfig':{'NetworkMode':'supabase_network_ImInGolf-Local-Rehearsal'},
           'NetworkSettings':{'Networks':{}},
           'Config':{'Image':'public.ecr.aws/supabase/postgres:17.6.1.000'}}
        m.validate_container(c)
        for path,value in [(('Name',),'/other'),(('State','Running'),False),
                           (('HostConfig','NetworkMode'),'host'),
                           (('HostConfig','NetworkMode'),'container:other'),
                           (('NetworkSettings','Networks'),{'bridge':{}}),
                           (('Config','Image'),'postgres:17.6')]:
            changed=copy.deepcopy(c); obj=changed
            for key in path[:-1]: obj=obj[key]
            obj[path[-1]]=value
            with self.subTest(path=path,value=value),self.assertRaises(RuntimeError):
                m.validate_container(changed)

    def test_remote_docker_endpoint_rejected(self):
        m.validate_endpoint('unix:///Users/example/.docker/run/docker.sock')
        for host in ['tcp://localhost:2375','ssh://example','tcp://online:2376']:
            with self.subTest(host=host),self.assertRaises(RuntimeError): m.validate_endpoint(host)

    def test_baseline_checks_reject_changes(self):
        before=capture_fixture(); m.compare_baseline(before,copy.deepcopy(before))
        for key in ['fingerprints','functions','triggers','policies','tables','event_triggers']:
            after=copy.deepcopy(before)
            if key=='fingerprints': after[key]['public.tens_in_groups']['md5']='changed'
            elif key=='functions': after[key][0]['meta']['owner']='someone_else'
            else: after['inventory'][key].append({'changed':True})
            with self.subTest(key=key),self.assertRaises(RuntimeError): m.compare_baseline(before,after)

    def test_generated_local_rollback_retains_guards(self):
        g=m.load_generator(); s=g.rollback(capture_fixture())
        self.assertEqual(g.PROJECT,m.PROJECT)
        self.assertIn('LOCK TABLE',s)
        self.assertIn('Data changed:',s)
        self.assertIn('New table is not empty:',s)
        self.assertIn("confirmed_project",s)
        self.assertIn('RESTRICT;',s)
        self.assertNotIn('CASCADE','\n'.join(line for line in s.splitlines() if not line.startswith('--')))
        self.assertTrue(s.endswith('COMMIT;\n'))
        m.verify_prepared_rollback(g,capture_fixture(),s)
        with self.assertRaises(RuntimeError):
            m.verify_prepared_rollback(g,capture_fixture(),s.replace('RESTRICT;',';'))

    def test_migration_checksums(self):
        for name,digest in m.MIGRATIONS:
            data=(m.REPO/'supabase/staging'/f'{name}.sql').read_bytes()
            self.assertEqual(m.hashlib.sha256(data).hexdigest(),digest)

    def test_installed_security_checks_and_failures(self):
        for failure in [None,'function-access','new-table-access','rows']:
            with self.subTest(failure=failure),tempfile.TemporaryDirectory() as d:
                r=FakeRunner(Path(d))
                baseline=r.baseline
                installed=copy.deepcopy(baseline)
                for f in installed['functions']:
                    f['exists']=True
                    f['meta']={'owner':'postgres','settings':['search_path=""'],
                               'security_definer':f['requested'] not in r.generator.OPTIONAL}
                installed['new_tables']={t:True for t in r.generator.TABLES}
                installed['new_triggers']=[{'table':t,'name':n} for t,n in r.generator.TRIGGERS]
                installed['inventory']['triggers']=installed['new_triggers']
                installed['inventory']['tables']=[{'schema':t.split('.')[0],'name':t.split('.')[1]}
                                                  for t in r.generator.TABLES]
                r.capture=lambda label: installed
                def responses(text,label,variables=()):
                    if label=='function-access':
                        out=[]
                        for f in installed['functions']:
                            sig=f['requested']; service=sig.startswith(('public.iig_is_protected_group(',
                                'public.iig_apply_verified_subscription('))
                            auth=sig.startswith('public.') and not service
                            if failure=='function-access' and sig=='iig_private.verified_organiser()': auth=True
                            out.append({'sig':sig,'anon':False,'auth':auth,'service':True})
                        return json.dumps(out)
                    if label=='new-table-access':
                        return json.dumps({'rows':0,'rls':failure!='new-table-access',
                                           'policies':0,'anon':False,'auth':False})
                    raise AssertionError(label)
                r.sql=responses
                if failure=='rows':
                    r.audit=lambda label: dict(r.extra,rows={'changed':True})
                if failure is None:
                    m.Runner.installed_checks(r,baseline,r.extra)
                else:
                    with self.assertRaises(RuntimeError):
                        m.Runner.installed_checks(r,baseline,r.extra)

    def test_success_orders_files_then_checks_then_rollback(self):
        with tempfile.TemporaryDirectory() as d:
            r=FakeRunner(Path(d)); r.execute()
            names=[n for n,_ in m.MIGRATIONS]
            self.assertEqual([e for e in r.events if e in names],names)
            self.assertLess(r.events.index('checks'),r.events.index('rollback'))
            self.assertEqual(r.report['result'],'PASS')
            self.assertTrue(r.report['rollback_completed'])

    def test_preflight_install_data_and_checks_fail_without_rollback(self):
        for failure in ['preflight','integration-hardening','protected-gameplay','data','checks']:
            with self.subTest(failure=failure),tempfile.TemporaryDirectory() as d:
                r=FakeRunner(Path(d),failure)
                with self.assertRaises(RuntimeError): r.execute()
                self.assertNotIn('rollback',r.events)
                self.assertFalse(r.report['rollback_completed'])
                self.assertEqual(r.report['result'],'FAIL')

    def test_failed_rollback_and_post_check_never_pass(self):
        for failure in ['rollback','post']:
            with self.subTest(failure=failure),tempfile.TemporaryDirectory() as d:
                r=FakeRunner(Path(d),failure)
                with self.assertRaises(RuntimeError): r.execute()
                self.assertEqual(r.report['result'],'FAIL')
                self.assertEqual(r.report['rollback_completed'],failure=='post')

    def test_boundary_never_uses_host_database_client(self):
        with tempfile.TemporaryDirectory() as d:
            r=m.Runner(Path(d)); r.context='desktop-linux'
            with patch.object(r,'isolated'),patch.object(m.subprocess,'run') as run:
                run.return_value.returncode=0
                run.return_value.stdout=''
                run.return_value.stderr=''
                r.sql('-- inert offline fixture','boundary')
                args=run.call_args.args[0]
                self.assertEqual(args[:6],['docker','--context','desktop-linux','exec','-i',m.CONTAINER])
                self.assertEqual(args[args.index('-h')+1],'/var/run/postgresql')
                self.assertNotIn('--host',args)
                self.assertIn('ON_ERROR_STOP=1',args)

    def service_fixture(self):
        return {'Name':'/supabase_auth_'+m.PROJECT,'Id':'local-auth-id',
                'Config':{'Image':'public.ecr.aws/supabase/gotrue:v2.0',
                          'Labels':{'com.supabase.cli.project':m.PROJECT}},
                'State':{'Running':True},'HostConfig':{'NetworkMode':'local-project'},
                'NetworkSettings':{'Networks':{'local-project':{'IPAddress':'172.20.0.5'}}}}

    def client_fixture(self):
        return {'pid':123,'backend_start':'2026-10-23T12:00:00Z',
                'user':'supabase_auth_admin','application':'not-used-for-trust',
                'client_addr':'172.20.0.5','client_port':40000,
                'state':'idle','xact_start':None}

    def test_service_and_client_attribution_is_narrow(self):
        c=self.service_fixture(); service=m.approved_service(c)
        self.assertIsNotNone(service)
        client=self.client_fixture()
        self.assertEqual(m.classify_client(client,[service])['category'],'internal_idle')
        mapped=dict(client,client_addr='::ffff:172.20.0.5')
        self.assertEqual(m.classify_client(mapped,[service])['category'],'internal_idle')
        for change in [{'client_addr':None},{'client_addr':'127.0.0.1'},
                       {'client_addr':'172.20.0.99'},{'user':'postgres'}]:
            self.assertEqual(m.classify_client(dict(client,**change),[service])['category'],
                             'unexpected_or_unattributed')
        self.assertEqual(m.classify_client(dict(client,state='active'),[service])['category'],'internal_busy')
        self.assertEqual(m.classify_client(dict(client,xact_start='now'),[service])['category'],'internal_transaction')
        for change in ['label','name','image','stopped','pooler']:
            invalid=copy.deepcopy(c)
            if change=='label': invalid['Config']['Labels']['com.supabase.cli.project']='another-project'
            if change=='name': invalid['Name']='/supabase_auth_other'
            if change=='image': invalid['Config']['Image']='untrusted/gotrue:v2'
            if change=='stopped': invalid['State']['Running']=False
            if change=='pooler': invalid['Name']='/supabase_pooler_'+m.PROJECT
            self.assertIsNone(m.approved_service(invalid))

    def test_graceful_local_service_drain_and_blocked_clients(self):
        for scenario in ['idle','external','transaction','orphan','timeout']:
            with self.subTest(scenario=scenario),tempfile.TemporaryDirectory() as d:
                r=m.Runner(Path(d)); container=self.service_fixture()
                service=m.approved_service(container); client=self.client_fixture(); actions=[]
                if scenario=='external': client['client_addr']='10.0.0.20'
                if scenario=='transaction': client['xact_start']='now'
                r.service_inventory=lambda:[service]
                r.isolated=lambda:None
                r.client_snapshot=lambda:([copy.deepcopy(client)] if container['State']['Running'] or scenario=='orphan' else [])
                def docker(*args,**kwargs):
                    actions.append(args)
                    if args[0]=='inspect': return json.dumps([container])
                    if args[0]=='stop':
                        self.assertEqual(args,('stop','--time=-1','local-auth-id'))
                        self.assertEqual(kwargs['timeout'],25)
                        if scenario=='timeout': raise m.subprocess.TimeoutExpired('docker',25)
                        container['State']['Running']=False
                        return 'local-auth-id'
                    raise AssertionError(args)
                r.docker=docker
                with patch.object(m.time,'monotonic',side_effect=range(0,10000,100)),patch.object(m.time,'sleep'):
                    if scenario=='idle':
                        r.drain_internal_clients()
                        self.assertTrue(r.report['clients_drained'])
                        self.assertEqual(r.report['local_service_stops'][0]['status'],'stopped')
                    else:
                        with self.assertRaises(RuntimeError): r.drain_internal_clients()
                        self.assertNotIn('clients_drained',r.report)
                        self.assertEqual(r.report['completed_migrations'],[])
                if scenario in ('external','transaction'):
                    self.assertFalse(any(a[0]=='stop' for a in actions))

    def test_client_diagnostics_cannot_weaken_migration_guard(self):
        self.assertIn('Other database clients exist',m.SQL_GUARD)
        self.assertIn('BEGIN READ ONLY;',m.CLIENT_DIAGNOSTICS)
        self.assertNotIn('pg_terminate_backend',m.CLIENT_DIAGNOSTICS)
        with tempfile.TemporaryDirectory() as d:
            r=m.Runner(Path(d))
            with patch.object(r,'_psql',return_value='[]') as execute:
                self.assertEqual(r.client_snapshot(),[])
                self.assertEqual(execute.call_args.args[0],m.CLIENT_DIAGNOSTICS)
                r.sql('-- inert offline fixture','guard-check')
                self.assertTrue(execute.call_args.args[0].startswith(m.SQL_GUARD))

if __name__=='__main__':
    unittest.main()
