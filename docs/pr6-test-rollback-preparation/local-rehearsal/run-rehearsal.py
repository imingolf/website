#!/usr/bin/env python3
"""Local Docker-only rehearsal. No URLs, online database clients or network changes."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import types
import ipaddress

CONTAINER = 'supabase_db_ImInGolf-Local-Rehearsal'
PROJECT = 'ImInGolf-Local-Rehearsal'
COMMIT = 'eadb4950e8cc1de8046b7654a89a490e6eae6643'
MIGRATIONS = [
 ('integration-hardening', 'd07c6174a5c628041f5e274645297dbfdbfb8b16bba7cbf8f159701f663f8241'),
 ('protected-gameplay', '50257ce7e6cf0e30c876525798ec70422a17ecbcb5b1396892271ca38f6afa7d'),
 ('account-lifecycle', 'c50fc781bba8ee0c5390fde6663fd63d780b660f70b577a23292ba6b66c70945'),
 ('subscription-security', '0f0205e3b603801b9c5145fc5bc0088fc3d30caae289916c458b10fb407c9704'),
]
HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
INVENTORIES = ['policies','default_acl','roles','role_memberships','schemas',
               'tables','extensions','event_triggers','triggers']
RISKS = [
 'Local schema install/rollback only; no online TEST/LIVE approval.',
 'PostgreSQL 17.6 differs from TEST 17.11; managed roles/services may differ.',
 'Fictional users do not test Auth login/OTP, account deletion services, Edge/native wiring or iPhone workflows.',
 'Archive omitted ownership/ACLs: comparisons prove recovery of this local baseline, not original online ACLs.',
 'Runtime-mutating feature tests are excluded; changed data intentionally blocks rollback.',
 'Keep the container isolated and evidence private; no automatic retry, cleanup or network reconnection.',
]

# Only direct service connections can be attributed. Poolers/proxies are excluded:
# their IP/role would not identify the originating client.
SERVICE_RULES = {
 'auth': (('supabase/gotrue:',), {'supabase_auth_admin'}),
 'rest': (('postgrest/postgrest:','supabase/postgrest:'), {'authenticator'}),
 'realtime': (('supabase/realtime:',), {'supabase_admin','supabase_realtime_admin'}),
 'storage': (('supabase/storage-api:',), {'supabase_storage_admin'}),
 'pg_meta': (('supabase/postgres-meta:',), {'supabase_admin','postgres'}),
 'analytics': (('supabase/logflare:',), {'supabase_admin'}),
}

def address(value):
    if not value:
        return None
    try:
        ip=ipaddress.ip_address(value)
        return str(ip.ipv4_mapped) if isinstance(ip,ipaddress.IPv6Address) and ip.ipv4_mapped else str(ip)
    except ValueError:
        return None

def approved_service(c):
    name=c.get('Name','').lstrip('/')
    for kind,(images,roles) in SERVICE_RULES.items():
        if name!='supabase_'+kind+'_'+PROJECT:
            continue
        config=c.get('Config',{})
        if (config.get('Labels') or {}).get('com.supabase.cli.project')!=PROJECT:
            return None
        image=config.get('Image','')
        if image.startswith('public.ecr.aws/'):
            image=image[len('public.ecr.aws/'):]
        if not any(image.startswith(prefix) for prefix in images):
            return None
        if not c.get('State',{}).get('Running') or c.get('HostConfig',{}).get('NetworkMode')=='host':
            return None
        ips=set()
        for network in c.get('NetworkSettings',{}).get('Networks',{}).values():
            for key in ('IPAddress','GlobalIPv6Address'):
                if address(network.get(key)):
                    ips.add(address(network[key]))
        return {'name':name,'id':c['Id'],'image':config['Image'],'ips':sorted(ips),'roles':sorted(roles)}
    return None

def classify_client(client, services):
    matches=[s for s in services if address(client.get('client_addr')) in s['ips']
             and client.get('user') in s['roles']]
    if len(matches)!=1:
        return dict(client,category='unexpected_or_unattributed',
                    reason='No unique verified direct local service IP + role; socket/proxy/role alone is insufficient')
    service=matches[0]
    if client.get('xact_start') is not None or client.get('state')=='idle in transaction':
        return dict(client,category='internal_transaction',service=service['name'],
                    reason='Verified local service has an open transaction; no automatic stop')
    if client.get('state')!='idle':
        return dict(client,category='internal_busy',service=service['name'],
                    reason='Verified local service is busy; wait briefly, never interrupt an active client')
    return dict(client,category='internal_idle',service=service['name'],
                reason='Verified project label, exact service/image, Docker source IP, role; idle with no transaction')

def require(ok, message):
    if not ok:
        raise RuntimeError(message)

def normalized(value):
    return sorted(json.dumps(x,sort_keys=True) for x in value)

def function_map(c):
    out = {}
    for f in c['functions']:
        m = f['meta']
        out[f['requested']] = (f['exists'], None if m is None else
          (m['definition'],m['owner'],m['security_definer'],m['settings'],
           normalized(m['acl'])))
    return out

def compare_baseline(before, after):
    require(before['fingerprints']==after['fingerprints'], 'Protected data/history/identity fingerprints differ')
    require(function_map(before)==function_map(after), 'Function definitions/owners/effective grants differ')
    require(before['new_tables']==after['new_tables'] and
            normalized(before['new_triggers'])==normalized(after['new_triggers']), 'New-object inventory differs')
    for key in INVENTORIES:
        require(normalized(before['inventory'][key])==normalized(after['inventory'][key]),
                'Baseline catalog mismatch: '+key)

def load_generator():
    # Same reviewed local substitution as prepare-local.py; online generator stays unchanged.
    source = (HERE.parent/'prepare.py').read_text()
    require("PROJECT = 'nyavvwrsrxqfyhiygkgw'" in source, 'Unexpected rollback generator')
    module = types.ModuleType('iig_local_generator')
    exec(compile(source.replace('nyavvwrsrxqfyhiygkgw',PROJECT),str(HERE.parent/'prepare.py'),'exec'),module.__dict__)
    return module

def verify_prepared_rollback(generator, before, text):
    require(text==generator.rollback(before), 'Prepared rollback differs from guarded generator output; STOP')

def validate_container(c):
    require(c.get('Name')=='/'+CONTAINER, 'Unexpected Docker container name')
    require(c.get('State',{}).get('Running') is True, 'Local database container is not running')
    require(c.get('HostConfig',{}).get('NetworkMode') not in ('host','none:host') and
            not c.get('HostConfig',{}).get('NetworkMode','').startswith('container:'),
            'Host/shared networking is forbidden')
    require(c.get('NetworkSettings',{}).get('Networks')=={}, 'Container is not isolated: Docker networks are attached')
    require(re.search(r'(?:^|/)supabase/postgres:17\.6(?:[.\-_]|$)',c.get('Config',{}).get('Image','')),
            'Unexpected database image; expected Supabase PostgreSQL 17.6')

def validate_endpoint(endpoint):
    require(endpoint.startswith('unix:///'), 'Docker context is not a local Unix socket; remote Docker is forbidden')

SQL_IDENTITY_GUARD = """
SET lock_timeout='5s'; SET statement_timeout='60s';
SET idle_in_transaction_session_timeout='60s';
DO $local$ BEGIN
 IF inet_server_addr() IS NOT NULL OR current_database()<>'postgres' OR current_user<>'postgres'
 OR current_setting('server_version_num')::integer<>170006 THEN
  RAISE EXCEPTION 'Expected local Unix-socket postgres PostgreSQL 17.6 only'; END IF;
 IF EXISTS(SELECT 1 FROM pg_prepared_xacts WHERE database=current_database()) THEN
  RAISE EXCEPTION 'Prepared transactions exist'; END IF;
END $local$;
"""
SQL_GUARD = SQL_IDENTITY_GUARD + """
DO $clients$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
 AND pid<>pg_backend_pid() AND backend_type='client backend') THEN
  RAISE EXCEPTION 'Other database clients exist; pause/drain them first'; END IF;
END $clients$;
"""
CLIENT_DIAGNOSTICS = "BEGIN READ ONLY;\n"+SQL_IDENTITY_GUARD+"""
SELECT coalesce(jsonb_agg(jsonb_build_object('pid',pid,'user',usename,
 'application',application_name,'client_addr',host(client_addr),'client_port',client_port,
 'state',state,'xact_start',xact_start,'backend_start',backend_start,
 'backend_type',backend_type) order by pid),'[]'::jsonb)
FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()
 AND backend_type='client backend';
COMMIT;
"""

class Runner:
    def __init__(self, root):
        self.root = root
        self.generated = root/'local-restore-generated'
        self.run_dir = self.generated/('automated-rehearsal-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ'))
        self.run_dir.mkdir(parents=True, mode=0o700)
        self.report = {'result':'FAIL','stage':'starting','completed_migrations':[],
                       'rollback_completed':False,'risks':RISKS,'evidence':str(self.run_dir)}
        self.context = None
        self.endpoint = None
        self.container_id = None
        self.counter = 0
        self.generator = load_generator()

    def command(self, args, data=None, timeout=None):
        env = dict(os.environ)
        for key in ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH',
                    'GIT_DIR','GIT_WORK_TREE','GIT_INDEX_FILE']:
            env.pop(key,None)
        result = subprocess.run(args,input=data,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env,timeout=timeout)
        require(result.returncode==0, 'Command failed: '+args[0]+' '+args[1]+'\n'+result.stderr[-4000:])
        return result.stdout

    def docker(self, *args, data=None, timeout=None):
        return self.command(['docker','--context',self.context,*args],data,timeout=timeout)

    def isolated(self):
        # Context inspection is local CLI metadata, before contacting its daemon.
        endpoint=json.loads(self.command(['docker','context','inspect',self.context]))[0]['Endpoints']['docker']['Host']
        validate_endpoint(endpoint)
        require(self.endpoint is None or endpoint==self.endpoint, 'Docker endpoint changed during rehearsal')
        self.endpoint=endpoint
        c = json.loads(self.docker('inspect',CONTAINER))[0]
        validate_container(c)
        if self.container_id is not None:
            require(c['Id']==self.container_id, 'Container changed during rehearsal')
        self.container_id = c['Id']
        return c

    def sql(self, text, label, variables=()):
        return self._psql(SQL_GUARD+'\n'+text,label,variables)

    def _psql(self, text, label, variables=()):
        self.isolated()  # Recheck before EVERY SQL invocation; no host database connections.
        self.counter += 1
        path = self.run_dir/f'{self.counter:02d}-{label}'
        path.with_suffix('.sql').write_text(text)
        args = ['docker','--context',self.context,'exec','-i',CONTAINER,
                'env','-u','PGSERVICE','-u','PGSERVICEFILE','-u','PGOPTIONS','-u','PGPASSFILE',
                'PGAPPNAME=iig-local-automated-rehearsal','psql','-X','-w','-qAt',
                '-h','/var/run/postgresql','-p','5432','-U','postgres','-d','postgres',
                '-v','ON_ERROR_STOP=1']
        for variable in variables:
            args += ['-v',variable]
        # Capture both streams even on failure. No automatic retry of database writes.
        env = dict(os.environ)
        for key in ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH']:
            env.pop(key,None)
        r = subprocess.run(args,input=text,text=True,
                           stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env)
        path.with_suffix('.stdout').write_text(r.stdout)
        path.with_suffix('.stderr').write_text(r.stderr)
        require(r.returncode==0, f'Local SQL failed ({label}); stop. See {path.with_suffix(".stderr")}')
        return r.stdout

    def client_snapshot(self):
        # This dedicated read-only diagnostic must be able to OBSERVE blocked clients.
        # All schema/data/rollback/capture operations still use the zero-client SQL_GUARD.
        return json.loads(self._psql(CLIENT_DIAGNOSTICS,'client-diagnostics'))

    def service_inventory(self):
        self.isolated()
        names=set(self.docker('ps','--format','{{.Names}}').splitlines())
        expected=['supabase_'+kind+'_'+PROJECT for kind in SERVICE_RULES]
        present=[name for name in expected if name in names]
        services=[]
        if present:
            for c in json.loads(self.docker('inspect',*present)):
                service=approved_service(c)
                if service:
                    services.append(service)
        (self.run_dir/'local-service-inventory.json').write_text(json.dumps(services,indent=2))
        return services

    def drain_internal_clients(self):
        self.report['stage']='classify and drain local background clients'
        services=self.service_inventory()
        actions=self.report.setdefault('local_service_stops',[])
        deadline=time.monotonic()+8
        while True:
            clients=self.client_snapshot()
            classified=[classify_client(c,services) for c in clients]
            (self.run_dir/'clients-before-drain.json').write_text(json.dumps(classified,indent=2))
            self.report['clients']=classified
            require(not any(c['category'] in ('unexpected_or_unattributed','internal_transaction') for c in classified),
                    'Unexpected/unattributed client or open transaction: no services stopped. See clients-before-drain.json (PID, role, source, state).')
            if not any(c['category']=='internal_busy' for c in classified):
                break
            require(time.monotonic()<deadline,'Verified local services remain busy; no active client interrupted. See clients-before-drain.json')
            time.sleep(0.5)
        targets=sorted({c['service'] for c in classified})
        original_sessions={(c['pid'],c['backend_start']) for c in classified}
        for name in targets:
            # Recheck identities and all clients immediately before each graceful stop.
            self.isolated()
            old=next(s for s in services if s['name']==name)
            now=approved_service(json.loads(self.docker('inspect',name))[0])
            require(now==old,'Service identity changed; no stop attempted: '+name)
            current=[classify_client(c,services) for c in self.client_snapshot()]
            require(all(c['category']=='internal_idle' for c in current),
                    'Clients changed/became busy before service drain; stop without interrupting sessions')
            reason='Its verified live connections can start transactions during migration/rollback; stop this local service gracefully to drain clients and prevent reconnects.'
            print('Gracefully stopping '+name+': '+reason,flush=True)
            action={'service':name,'id':old['id'],'reason':reason,'status':'requested',
                    'session_pids':[c['pid'] for c in current if c['service']==name]}
            actions.append(action)
            try:
                # -1 means NEVER escalate to SIGKILL. Timeout only abandons waiting;
                # it does not force-kill the service or any PostgreSQL backend.
                self.docker('stop','--time=-1',old['id'],timeout=25)
            except subprocess.TimeoutExpired:
                raise RuntimeError('Graceful service stop is still pending: '+name+'; no forced termination or migrations attempted')
            stopped=json.loads(self.docker('inspect',old['id']))[0]
            require(stopped['State']['Running'] is False,'Local service has not stopped: '+name)
            action['status']='stopped'
        deadline=time.monotonic()+12
        while True:
            remaining=self.client_snapshot()
            self.report['remaining_clients']=[classify_client(c,services) for c in remaining]
            (self.run_dir/'clients-after-drain.json').write_text(json.dumps(remaining,indent=2))
            if not remaining:
                break
            require(all((c['pid'],c['backend_start']) in original_sessions and
                        classify_client(c,services)['category']=='internal_idle' for c in remaining),
                    'A new, busy or unattributed client appeared during drain; no migration attempted. See clients-after-drain.json')
            require(time.monotonic()<deadline,
                    'Clients remain after graceful drain (possibly stale sockets after network isolation). No PostgreSQL sessions were terminated; see clients-after-drain.json. Stop for review.')
            time.sleep(0.5)
        self.report['clients_drained']=True

    def capture(self, label):
        c = json.loads(self.sql(self.generator.capture_sql(),label))
        (self.run_dir/(label+'.json')).write_text(json.dumps(c,indent=2))
        return c

    def audit(self, label):
        # Extra evidence beyond the older before.json: all application rows, all
        # public/private/Auth functions, columns, constraints, indexes and sequence.
        tables = self.generator.GUARDED+['public.iig_notification_settings','public.iig_notification_events']
        fps = ','.join(self.generator.lit(t)+','+self.generator.fingerprint(t) for t in tables)
        q = """BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path=pg_catalog; SET LOCAL timezone='UTC';
SET LOCAL datestyle='ISO, YMD'; SET LOCAL extra_float_digits=3; SET LOCAL row_security=off;
SELECT jsonb_build_object('rows',jsonb_build_object(FINGERPRINTS),
'functions',(select coalesce(jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,
 'definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),
 'acl',(select coalesce(jsonb_agg(jsonb_build_object('grantee',a.grantee,'grantor',a.grantor,
 'privilege',a.privilege_type,'grantable',a.is_grantable)),'[]')
 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a))),'[]')
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('public','iig_private','auth') and p.prokind='f'),
'constraints',(select coalesce(jsonb_agg(jsonb_build_object('table',c.conrelid::regclass::text,
 'name',c.conname,'definition',pg_get_constraintdef(c.oid),'validated',c.convalidated)),'[]')
 from pg_constraint c join pg_namespace n on n.oid=c.connamespace
 where n.nspname in ('public','iig_private','auth')),
'indexes',(select coalesce(jsonb_agg(to_jsonb(i)),'[]') from pg_indexes i
 where schemaname in ('public','iig_private','auth')),
'columns',(select coalesce(jsonb_agg(jsonb_build_object('table',c.oid::regclass::text,'column',a.attname,
 'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'identity',a.attidentity,
 'generated',a.attgenerated,'acl',a.attacl::text,'default',pg_get_expr(d.adbin,d.adrelid))),'[]')
 from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid
 left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum
 where n.nspname in ('public','iig_private','auth') and c.relkind in ('r','p')
 and a.attnum>0 and not a.attisdropped),
'sequence',(select jsonb_build_object('last_value',last_value,'is_called',is_called)
 from public.tens_in_groups_id_seq),
'groups',(select jsonb_agg(jsonb_build_object('pin',group_pin,'history_md5',md5((state->'history')::text)))
 from public.tens_in_groups),
'fixture_ok',(select count(*)=3 and bool_and(email like '%@example.invalid'
 and email_confirmed_at is not null and not coalesce(is_anonymous,false)
 and (banned_until is null or banned_until<=now()) and coalesce(encrypted_password,'')=''
 and not exists(select 1 from jsonb_each(to_jsonb(u)) x where x.key ~ '(token|password)'
 and x.value not in ('null'::jsonb,'""'::jsonb))) from auth.users u),
'owners',(select count(*) from iig_private.group_owners),
'members',(select count(*) from iig_private.group_members)); COMMIT;""".replace('FINGERPRINTS',fps)
        c = json.loads(self.sql(q,label))
        (self.run_dir/(label+'.json')).write_text(json.dumps(c,indent=2))
        return c

    def verify_rls(self):
        self.sql((HERE/'verify-local-rls.sql').read_text(),'verify-baseline-rls')

    def prepare(self):
        self.report['stage']='local preflight'
        require(self.command(['git','-C',str(REPO),'branch','--show-current']).strip()=='pr6-test-rollback-preparation',
                'Run from pr6-test-rollback-preparation only')
        require(not self.command(['git','-C',str(REPO),'status','--porcelain','--untracked-files=no']).strip(),
                'Tracked repository files are modified')
        self.context = self.command(['docker','context','show']).strip()
        endpoint = json.loads(self.command(['docker','context','inspect',self.context]))[0]['Endpoints']['docker']['Host']
        validate_endpoint(endpoint)
        container=self.isolated()
        self.report['target']={'context':self.context,'endpoint':endpoint,
                              'container':CONTAINER,'id':self.container_id,
                              'image':container['Config']['Image'],'networks':[]}
        self.report['migration_commit']=COMMIT
        self.report['migration_sha256']=dict(MIGRATIONS)
        require(self.command(['git','-C',str(REPO),'rev-parse',COMMIT]).strip()==COMMIT, 'Missing pinned migration commit')
        migrations = []
        for name, digest in MIGRATIONS:
            text = self.command(['git','-C',str(REPO),'show',f'{COMMIT}:supabase/staging/{name}.sql'])
            require(hashlib.sha256(text.encode()).hexdigest()==digest, 'Migration checksum mismatch: '+name)
            existing = self.generated/(name+'.sql')
            require(not existing.exists() or existing.read_text()==text, 'Existing extracted migration differs: '+name)
            migrations.append((name,text))
        before_path = self.generated/'before.json'
        rollback_path = self.generated/'rollback.LOCAL.sql'
        require(before_path.is_file() and rollback_path.is_file(), 'Missing before.json or rollback.LOCAL.sql')
        before = json.loads(before_path.read_text())
        require(before.get('role')=='postgres' and before.get('database')=='postgres', 'Wrong baseline identity')
        rollback = rollback_path.read_text()
        verify_prepared_rollback(self.generator,before,rollback)
        (self.run_dir/'original-before.json').write_text(json.dumps(before,indent=2))
        (self.run_dir/'rollback.LOCAL.sql').write_text(rollback)
        self.report['rollback_sha256']=hashlib.sha256(rollback.encode()).hexdigest()
        self.drain_internal_clients()
        self.report['stage']='baseline verification after client drain'
        current = self.capture('current-before')
        compare_baseline(before,current)
        require(all(current['installation_privileges'].values()), 'Missing installation privileges')
        roles={r['rolname']:r for r in current['inventory']['roles']}
        require(all(r in roles and not roles[r]['rolsuper'] and not roles[r]['rolbypassrls']
                    for r in ('anon','authenticated')), 'Unsafe local client role attributes')
        self.verify_rls()
        # Auth credentials/services and SQL jobs are excluded from this rehearsal.
        objects = json.loads(self.sql("BEGIN READ ONLY; SELECT jsonb_build_object('cron',to_regclass('cron.job')::text,'credentials',(select jsonb_agg(format('%I.%I',n.nspname,c.relname)) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='auth' and c.relkind='r' and c.relname in ('identities','sessions','refresh_tokens','mfa_factors','flow_state'))); COMMIT;",'background-inventory'))
        if objects['cron']:
            require(self.sql('BEGIN READ ONLY; SELECT count(*) FROM cron.job WHERE active; COMMIT;','cron-check').strip()=='0', 'Active cron jobs exist')
        for table in objects['credentials'] or []:
            require(self.sql(f'BEGIN READ ONLY; SELECT count(*) FROM {table}; COMMIT;','auth-empty-check').strip()=='0',
                    'Unexpected Auth credentials/service rows: '+table)
        audit = self.audit('audit-before')
        require({g['pin'] for g in audit['groups']}=={'3520','5021'} and len(audit['groups'])==2,
                'Expected exactly groups 3520 and 5021')
        require(audit['owners']==2 and audit['members']==3 and audit['fixture_ok'] is True,
                'Owner/member/fictional-user baseline mismatch')
        return before,audit,migrations,rollback

    def installed_checks(self, before, audit_before):
        c = self.capture('installed')
        require(c['fingerprints']==before['fingerprints'], 'Protected data changed during installation; rollback not attempted')
        self.verify_rls()
        require(all(c['new_tables'].values()) and len(c['new_triggers'])==2, 'Missing new tables/triggers')
        fs = {f['requested']:f for f in c['functions']}
        for sig in self.generator.REQUIRED+self.generator.OPTIONAL+self.generator.NEW:
            f=fs[sig]
            require(f['exists'] and f['meta']['owner']=='postgres', 'Missing function or unexpected owner: '+sig)
            settings=f['meta']['settings'] or []
            require(any(x in ('search_path=','search_path=""') for x in settings), 'Unsafe function search_path: '+sig)
            invoker=sig in self.generator.OPTIONAL
            require(f['meta']['security_definer']==(not invoker), 'Unexpected SECURITY DEFINER setting: '+sig)
        private=self.generator.OPTIONAL+['iig_private.protected_group_limits()',
                 'iig_private.recent_signin()','iig_private.sync_owner_email()','iig_private.verified_organiser()']
        users=[s for s in self.generator.REQUIRED if s.startswith('public.')]+[
          'public.iig_player_action(text,text,jsonb,bigint)','public.iig_request_owner_transfer(text)',
          'public.iig_accept_owner_transfer(uuid)','public.iig_prepare_account_deletion()',
          'public.iig_my_group_identity()']
        service=['public.iig_is_protected_group(text)',
                 'public.iig_apply_verified_subscription(text,uuid,text,timestamp with time zone)']
        sigs=','.join(self.generator.lit(s) for s in private+users+service)
        access=json.loads(self.sql(f"BEGIN READ ONLY; SELECT jsonb_agg(jsonb_build_object('sig',s,'anon',has_function_privilege('anon',s,'EXECUTE'),'auth',has_function_privilege('authenticated',s,'EXECUTE'),'service',has_function_privilege('service_role',s,'EXECUTE'))) FROM unnest(array[{sigs}]) s; COMMIT;",'function-access'))
        for f in access:
            require(not f['anon'] and f['auth']==(f['sig'] in users), 'Unexpected effective client function access: '+f['sig'])
            if f['sig'] in service:
                require(f['service'], 'Missing service-only execute grant')
        for table in self.generator.TABLES:
            q=f"BEGIN READ ONLY; SELECT jsonb_build_object('rows',(select count(*) from {table}),'rls',(select relrowsecurity and not relforcerowsecurity from pg_class where oid='{table}'::regclass),'policies',(select count(*) from pg_policy where polrelid='{table}'::regclass),'anon',has_table_privilege('anon','{table}','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),'auth',has_table_privilege('authenticated','{table}','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')); COMMIT;"
            t=json.loads(self.sql(q,'new-table-access'))
            require(t=={'rows':0,'rls':True,'policies':0,'anon':False,'auth':False}, 'New-table security/content mismatch: '+table)
        audit=self.audit('audit-installed')
        require(audit['rows']==audit_before['rows'] and normalized(audit['groups'])==normalized(audit_before['groups'])
                and audit['sequence']==audit_before['sequence'], 'Application/history/notification/sequence data changed')
        # Existing global settings/policies and original tables must remain unchanged.
        for key in ['policies','default_acl','roles','role_memberships','schemas','extensions','event_triggers']:
            require(normalized(c['inventory'][key])==normalized(before['inventory'][key]), 'Unexpected installed catalog change: '+key)
        new_tables=set(self.generator.TABLES)
        old_tables=[t for t in c['inventory']['tables'] if t['schema']+'.'+t['name'] not in new_tables]
        require(normalized(old_tables)==normalized(before['inventory']['tables']), 'Existing table settings/grants changed')
        expected_triggers=set(self.generator.TRIGGERS)
        old_triggers=[t for t in c['inventory']['triggers'] if (t['table'],t['name']) not in expected_triggers]
        require(normalized(old_triggers)==normalized(before['inventory']['triggers']), 'Existing triggers changed')
        changed_functions=set(s.split('(')[0] for s in self.generator.REQUIRED+self.generator.OPTIONAL+self.generator.NEW)
        def unchanged_functions(items):
            return normalized(dict(x,acl=normalized(x['acl'])) for x in items
                              if x['signature'].split('(')[0] not in changed_functions)
        require(unchanged_functions(audit['functions'])==unchanged_functions(audit_before['functions']),
                'An unrelated function changed')

    def execute(self):
        print('Verifying local isolation, baseline and prepared rollback...',flush=True)
        before,audit,migrations,rollback = self.prepare()
        for name,text in migrations:
            print('Installing locally: '+name,flush=True)
            self.report['stage']='install '+name
            self.sql(text,name)
            self.report['completed_migrations'].append(name)
            snapshot=self.capture('after-'+name)
            require(snapshot['fingerprints']==before['fingerprints'], 'Protected data changed after '+name)
        self.report['stage']='installation checks'
        print('Checking installed objects, permissions and unchanged data...',flush=True)
        self.installed_checks(before,audit)
        self.report['stage']='guarded rollback'
        print('Running the prepared guarded local rollback...',flush=True)
        # Replay the exact pre-existing, revalidated guarded rollback. No replacement guards.
        self.sql(rollback,'rollback',('confirmed_project='+PROJECT,))
        self.report['rollback_completed']=True
        self.report['stage']='post-rollback comparison'
        print('Comparing restored functions, grants, triggers, RLS and data...',flush=True)
        after=self.capture('after-rollback')
        compare_baseline(before,after)
        self.verify_rls()
        after_audit=self.audit('audit-after-rollback')
        require(audit['rows']==after_audit['rows'] and audit['sequence']==after_audit['sequence'], 'Supplementary data/sequence mismatch')
        for key in ['functions','constraints','indexes','columns','groups']:
            def stable(items):
                # Canonicalize ACL array order inside supplementary function records.
                result=[]
                for x in items:
                    x=dict(x)
                    if 'acl' in x:
                        x['acl']=normalized(x['acl'])
                    result.append(x)
                return normalized(result)
            require(stable(audit[key])==stable(after_audit[key]), 'Supplementary catalog mismatch: '+key)
        self.report.update(result='PASS',stage='complete')

    def save_report(self):
        (self.run_dir/'report.json').write_text(json.dumps(self.report,indent=2)+'\n')
        text=self.report['result']+' — '+self.report['stage']+'\n'
        if 'error' in self.report:
            text += self.report['error']+'\nNo automatic recovery/retry was attempted. Earlier file commits may remain installed.\n'
        text += 'Rollback SQL completed: '+str(self.report['rollback_completed'])+'\n'
        for action in self.report.get('local_service_stops',[]):
            text += 'Local service '+action['status']+': '+action['service']+' (graceful stop only)\n'
        if self.report['result']=='FAIL':
            clients=self.report.get('remaining_clients',self.report.get('clients',[]))
            for client in clients:
                text += ('Client PID '+str(client['pid'])+': role='+str(client.get('user'))+
                         ', source='+str(client.get('client_addr') or 'local socket')+
                         ', state='+str(client.get('state'))+', '+str(client.get('category'))+'\n')
        text += 'Evidence: '+str(self.run_dir)+'\nRemaining limits:\n'+'\n'.join('- '+r for r in RISKS)+'\n'
        (self.run_dir/'report.txt').write_text(text)
        print(text)

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--root',type=Path,default=Path.home()/'Documents/ImInGolf-Local-Rehearsal')
    a=p.parse_args()
    os.umask(0o077)
    if not a.root.is_dir() or not (a.root/'local-restore-generated').is_dir():
        print('FAIL — Local rehearsal/baseline folder missing; no SQL attempted.',file=sys.stderr)
        return 1
    lock=a.root/'local-restore-generated/.automated-rehearsal.lock'
    try:
        fd=os.open(str(lock),os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
    except FileExistsError:
        print('FAIL — Rehearsal lock exists. Inspect the previous run/process before retrying; no SQL attempted.',file=sys.stderr)
        return 1
    os.write(fd,str(os.getpid()).encode()); os.close(fd)
    runner=None
    try:
        runner=Runner(a.root)
        runner.execute()
    except (Exception,KeyboardInterrupt) as e:
        if runner is not None:
            runner.report['error']=str(e) or 'Interrupted; database execution state may be uncertain'
        else:
            print('FAIL — '+str(e),file=sys.stderr)
        return 1
    finally:
        if runner is not None:
            runner.save_report()
        lock.unlink()
    return 0

if __name__=='__main__':
    sys.exit(main())
