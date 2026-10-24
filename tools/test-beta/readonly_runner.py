#!/usr/bin/env python3
"""Mac Step 2 reviewer. DEFAULT/OFFLINE NEVER CONNECTS. A separate exact TEST flag is mandatory.
No installer, backup creation, service control, migration, mail or deployment capability.
"""
import argparse
import configparser
import datetime as dt
from dataclasses import dataclass
import getpass
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import stat
import ssl
import subprocess
import sys
import warnings

HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
PROJECT='nyavvwrsrxqfyhiygkgw'
POOLER='aws-0-eu-west-1.pooler.supabase.com'
QUERY_HASH='7e5c5ded21f3180ee743438ea7e61630c43d0e1b8bd7e4c918950f90633bd3ed'
PASS_RUN='automated-rehearsal-20261023T115001.671715Z'

class StopReview(Exception): pass

def require(ok,message):
    if not ok: raise StopReview(message)

def load_reference():
    spec=importlib.util.spec_from_file_location('iig_readonly_reference',HERE/'readonly_reference.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module

@dataclass(frozen=True)
class Target:
    host:str
    user:str
    rootcert:str='system'

@dataclass(frozen=True)
class Tools:
    psql:str
    restore:str


def private_file(path,credential=True):
    require(path.is_file() and not path.is_symlink(),'Required private local file is missing or symlinked')
    s=path.stat()
    require(s.st_uid==os.getuid() and stat.S_IMODE(s.st_mode)&(0o077 if credential else 0o022)==0,'Service/password file ownership or permissions are unsafe')


def password_text(value):
    require(isinstance(value,str) and bool(value) and not any(c in value for c in ('\x00','\n','\r')),'Missing or unsupported TEST password; stopped without connecting')
    return value


def pgpass_password(path,target):
    private_file(path)
    entries=[]
    try:text=path.read_text()
    except (OSError,UnicodeError):raise StopReview('TEST password file cannot be read safely') from None
    for line in text.splitlines():
        if not line.strip() or line.startswith('#'): continue
        fields=[];field='';escaped=False
        for c in line:
            if escaped:field+=c;escaped=False
            elif c=='\\':escaped=True
            elif c==':' and len(fields)<4:fields.append(field);field=''
            else:field+=c
        require(not escaped,'Malformed TEST password file')
        fields.append(field)
        require(len(fields)==5 and fields[:4]==[target.host,'5432','postgres',target.user],
                'Password file must contain only an exact TEST entry, without wildcards or other projects')
        entries.append(fields[4])
    require(len(entries)==1,'Require exactly one TEST password-file entry')
    return password_text(entries[0])


def ca_file(path):
    """Offline parsing only; never fetch, learn or automatically trust a server certificate."""
    path=Path(path).expanduser()
    require(path.is_absolute() and path.is_file(),'Explicit trusted CA file is missing or not an absolute file')
    path=path.resolve()
    info=path.stat()
    require(info.st_uid in (0,os.getuid()) and info.st_mode&0o022==0,'CA file is not safely owned or is writable by others')
    require(0<info.st_size<=5*1024*1024,'CA file is empty or unexpectedly large')
    try:
        raw=path.read_bytes()
        require(b'PRIVATE KEY' not in raw,'CA file must not contain private keys')
        # Empty context: no implicit Python/system trust added. This is format validation,
        # not proof of the independent libpq backend or the remote certificate chain.
        context=ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        context.load_verify_locations(cafile=str(path))
        require(context.cert_store_stats()['x509_ca']>0,'Certificate file contains no recognised CA certificates')
    except (ssl.SSLError,UnicodeError,OSError):
        raise StopReview('Invalid or unreadable CA certificate file; stopped offline') from None
    return str(path)


def read_service(path,explicit_ca=None):
    private_file(path,credential=False)
    parser=configparser.ConfigParser(interpolation=None,strict=True)
    try:parser.read_string(path.read_text())
    except (configparser.Error,UnicodeError):raise StopReview('Malformed or ambiguous service configuration; no connection attempted') from None
    require(not parser.defaults() and parser.has_section('iig-test-only'),'Missing iig-test-only service or unreviewed DEFAULT settings')
    if any(parser.get(section,'password',fallback='') for section in parser.sections()):private_file(path)
    c=dict(parser['iig-test-only'])
    allowed={'host','port','dbname','user','sslmode','sslrootcert','password','passfile','application_name','connect_timeout'}
    require(not set(c)-allowed,'Unsupported service option; no connection attempted')
    host,user=c.get('host'),c.get('user')
    direct=host=='db.'+PROJECT+'.supabase.co' and user in ('postgres','postgres.'+PROJECT)
    pooled=host==POOLER and user=='postgres.'+PROJECT
    require(direct or pooled,'Service is not bound to the exact reviewed TEST host/project username')
    require(c.get('port','5432')=='5432' and c.get('dbname','postgres')=='postgres','Only postgres on direct/session port 5432 is permitted')
    require(c.get('sslmode') in ('require','verify-ca','verify-full'),'SSL configuration must require TLS; no plaintext or fallback')
    if 'connect_timeout' in c:require(re.fullmatch(r'[0-9]{1,2}',c['connect_timeout']) and 1<=int(c['connect_timeout'])<=30,'Ambiguous connection timeout')
    root=str(explicit_ca) if explicit_ca is not None else c.get('sslrootcert','system')
    if root!='system':root=ca_file(root)
    require(explicit_ca is None or root!='system','Explicit CA option requires an actual absolute certificate file')
    target=Target(host,user,root)
    inline=c.get('password') or None;passfile=c.get('passfile') or None
    require(not (inline and passfile),'Both password and passfile specified; refuse ambiguous credentials')
    secret=password_text(inline) if inline else None
    if passfile:
        p=Path(passfile).expanduser();require(p.is_absolute(),'TEST passfile must be an absolute local path')
        secret=pgpass_password(p,target)
    return target,secret


def conninfo(target):
    # Revalidate even manually constructed Target objects; no caller-controlled host escape.
    require((target.host=='db.'+PROJECT+'.supabase.co' and target.user in ('postgres','postgres.'+PROJECT))
            or (target.host==POOLER and target.user=='postgres.'+PROJECT),'Invalid TEST target')
    if target.rootcert!='system':ca_file(target.rootcert)
    fields={'host':target.host,'port':'5432','dbname':'postgres','user':target.user,
            'sslmode':'verify-full','sslrootcert':target.rootcert,'gssencmode':'disable',
            'connect_timeout':'10','passfile':os.devnull,'application_name':'iig-step2-readonly',
            'options':'-c default_transaction_read_only=on -c statement_timeout=60000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=60000 -c standard_conforming_strings=on -c client_encoding=UTF8'}
    def quote(s):return "'"+s.replace('\\','\\\\').replace("'","\\'")+"'"
    return ' '.join(k+'='+quote(v) for k,v in fields.items())


def clean_env(secret=None):
    env={k:v for k,v in os.environ.items() if not k.upper().startswith('PG') and k.upper() not in ('SSL_CERT_FILE','SSL_CERT_DIR')}
    env['PGOPTIONS']='-c default_transaction_read_only=on'
    env['PGPASSFILE']=os.devnull
    if secret is not None:env['PGPASSWORD']=password_text(secret)
    return env


def query_registry():
    raw=(HERE/'readonly-queries.json').read_bytes()
    require(hashlib.sha256(raw).hexdigest()==QUERY_HASH,'Read-only query manifest changed; STOP before any connection')
    m=json.loads(raw)
    require(m['project']==PROJECT and set(m['queries'])=={'identity','capture','assessment','audit'},'Unreviewed query IDs')
    for item in m['queries'].values():
        require(hashlib.sha256(item['sql'].encode()).hexdigest()==item['sha256'],'Read-only query changed')
        require('READ ONLY' in item['sql'] and not re.search(r'^\s*\\',item['sql'],re.M),'Unreviewed psql metacommand or transaction')
    return m['queries']


def tool_versions():
    paths={name:shutil.which(name) for name in ('psql','pg_restore')}
    require(all(paths.values()),'Mac psql and pg_restore 18.6 must be installed and on PATH')
    for name,path in paths.items():
        r=subprocess.run([path,'--version'],capture_output=True,text=True,env=clean_env(),timeout=10)
        require(r.returncode==0 and re.search(r'\b18\.6\b',r.stdout),'Require reviewed Mac PostgreSQL client tools 18.6')
    return Tools(paths['psql'],paths['pg_restore'])


def digest(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()


def archive_check(path,manifest,tools):
    require(path.is_file(),'Original TEST backup is missing')
    with path.open('rb') as f:require(f.read(5)==b'PGDMP','Backup is not a PostgreSQL custom-format archive')
    observed=digest(path);anchored=manifest.is_file()
    if anchored:
        lines=manifest.read_text().strip().splitlines()
        require(len(lines)==1 and re.match(r'^[a-fA-F0-9]{64}\s',lines[0]),'Unrecognised previously recorded backup manifest')
        require(lines[0].split()[0].lower()==observed,'Backup checksum differs from existing anchor; STOP')
    # These exact offline pg_restore forms have no -d/--dbname, hence cannot restore or connect.
    results=[]
    commands=[[tools.restore,'--no-password','--list',str(path)],
              [tools.restore,'--no-password','--no-owner','--no-acl','--file',os.devnull,str(path)]]
    for cmd in commands:
        r=subprocess.run(cmd,capture_output=True,text=True,env=clean_env(),timeout=120)
        require(r.returncode==0,'Original backup inventory/traversal failed; no database target was used')
        results.append(r.stdout)
    toc=results[0]
    require(re.search(r'Dumped from database version:\s*17\.11\b',toc),'Backup source version differs from recorded TEST 17.11')
    for table in ('public tens_in_groups','public iig_notification_settings','public iig_notification_events',
                  'iig_private group_owners','iig_private group_members','iig_private setup_testers',
                  'iig_private platform_owners','iig_private registration_settings','auth users','auth identities'):
        require('TABLE DATA '+table+' ' in toc,'Backup lacks required application/Auth data entry')
    require('SEQUENCE public tens_in_groups_id_seq ' in toc,'Backup identity sequence entry missing')
    require(digest(path)==observed,'Backup changed during offline validation')
    return {'status':'PASS','readable':True,'observed_now_sha256':observed,
            'observed_at_utc':dt.datetime.now(dt.timezone.utc).isoformat(),
            'historical_anchor_present':anchored,'historical_integrity_proven':False,
            'limit':'Readability/current identity only; no full hosted Auth/ACL/service restore or historical checksum proof. No new backup or anchor created.'}


def json_file(path):
    require(path.is_file(),'Required original evidence file is missing')
    return json.loads(path.read_text())


def local_evidence(folder,compare):
    require(folder.name==PASS_RUN,'Require the recorded successful local rehearsal folder')
    r=json_file(folder/'report.json')
    require(r.get('result')=='PASS' and r.get('stage')=='complete' and r.get('rollback_completed') is True,'Local rehearsal did not fully PASS')
    require(r.get('migration_commit')==compare.COMMIT and r.get('migration_sha256')==dict(compare.MIGRATIONS),'Rehearsal used different migration source')
    require(r.get('previous_evidence_comparison_passed') is True and r.get('current_database_matches_previous_original_baseline') is True,'Rehearsal lacks original-baseline recovery verification')
    before=json_file(folder/'original-before.json');after=json_file(folder/'after-rollback.json')
    require(before.get('project_attestation')=='ImInGolf-Local-Rehearsal','Rehearsal evidence is not the sanitised local baseline')
    compare.compare_baseline(before,after)
    audit=json_file(folder/'audit-before.json');compare.compare_supplementary(audit,json_file(folder/'audit-after-rollback.json'))
    require(json_file(folder/'installed.json')['fingerprints']==before['fingerprints'],'Local installation changed protected fingerprints')
    return audit


def offline_preflight(args,report=None):
    # NO connection or psql query can occur on this path.
    require(subprocess.run(['git','-C',str(REPO),'branch','--show-current'],capture_output=True,text=True,check=True).stdout.strip()=='improve-new-user-registration','Wrong development branch')
    require(not subprocess.run(['git','-C',str(REPO),'status','--porcelain','--untracked-files=no'],capture_output=True,text=True,check=True).stdout.strip(),'Tracked changes need review before using this runner')
    target,secret=read_service(args.service_file,args.ca_file);conninfo(target)
    if report is not None:report['checks']['target_binding']={'status':'PASS','host':target.host,'user':target.user,'effective_sslmode':'verify-full','fallback':'none'}
    queries=query_registry()
    if report is not None:report['checks']['query_integrity']={'status':'PASS'}
    reference=load_reference();generator,compare=reference.helpers()
    before=json_file(args.capture)
    require(before.get('project_attestation')==PROJECT and before.get('role')=='postgres' and before.get('database')=='postgres','Original capture is not the expected TEST baseline')
    require(args.rollback.is_file() and args.rollback.read_bytes()==generator.rollback(before).encode(),'Original TEST rollback differs; no guard may be weakened')
    if report is not None:report['checks']['original_rollback']={'status':'PASS','unchanged':True}
    audit=local_evidence(args.rehearsal,compare)
    if report is not None:report['checks']['local_rehearsal']={'status':'PASS'}
    for name,expected in compare.MIGRATIONS:
        blob=subprocess.run(['git','-C',str(REPO),'show',compare.COMMIT+':supabase/staging/'+name+'.sql'],capture_output=True,check=True).stdout
        require(hashlib.sha256(blob).hexdigest()==expected,'Pinned migration source mismatch')
    tools=tool_versions()
    backup=archive_check(args.backup,args.historical_manifest,tools)
    if report is not None:report['checks']['backup_evidence']=backup
    return target,secret,queries,generator,compare,before,audit,tools,backup


def redacted(value,secret):
    if isinstance(value,str):return value.replace(secret,'[REDACTED]')
    if isinstance(value,list):return [redacted(v,secret) for v in value]
    if isinstance(value,dict):return {redacted(k,secret):redacted(v,secret) for k,v in value.items()}
    return value


def diagnostic_category(stderr):
    # Whitelisted labels only: libpq/server raw diagnostics are never saved.
    for code,label in [('42501','DATABASE_PERMISSION_DENIED'),('28P01','AUTHENTICATION_FAILED'),('57014','QUERY_TIMEOUT'),('P0001','REVIEW_GUARD_REJECTED')]:
        if re.search(r'\b'+code+r'\b',stderr):return label
    lower=stderr.lower()
    if 'does not match host name' in lower or 'hostname mismatch' in lower:return 'TLS_HOSTNAME_MISMATCH'
    if 'certificate has expired' in lower or 'certificate expired' in lower:return 'TLS_CERTIFICATE_EXPIRED'
    if 'unable to get local issuer' in lower or 'self-signed certificate' in lower:return 'TLS_CA_CHAIN_ERROR'
    for needle,label in [('no password supplied','PASSWORD_MISSING'),('password authentication failed','AUTHENTICATION_FAILED'),
                         ('root certificate','TLS_CA_ERROR'),('certificate verify','TLS_CERTIFICATE_ERROR'),
                         ('ssl error','TLS_ERROR'),('permission denied','DATABASE_PERMISSION_DENIED'),
                         ('statement timeout','QUERY_TIMEOUT'),('could not connect','CONNECTION_FAILED')]:
        if needle in lower:return label
    return 'CLIENT_OR_QUERY_FAILURE'


class Reader:
    """No raw-SQL method. Only names in the hard-pinned read-only registry are accepted."""
    def __init__(self,target,secret,queries,tools,folder,approval,report=None):
        require(approval==PROJECT,'First database connection requires the exact separate TEST-read-only flag')
        require(queries==query_registry(),'Unreviewed query registry')
        self.target=target;self.secret=password_text(secret);self.queries=queries;self.tools=tools;self.folder=folder;self.count=0
        self.info=conninfo(target);self.report=report
    def execute(self,name):
        # Check registry again immediately before each process; no arbitrary SQL/paths/psql flags.
        require(name in self.queries and self.queries==query_registry(),'Unreviewed query or changed manifest; stopped')
        self.info=conninfo(self.target) # Revalidate explicit CA before every process.
        item=self.queries[name];self.count+=1
        args=[self.tools.psql,'-X','-w','-qAt','--dbname',self.info,'-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate','--file=-']
        if self.report is not None:
            self.report['connections_attempted']+=1;self.report['sql_executed']=True
        try:r=subprocess.run(args,input=item['sql'],text=True,encoding='utf-8',capture_output=True,env=clean_env(self.secret),timeout=120)
        except (OSError,subprocess.TimeoutExpired):raise StopReview('Read-only client failed or timed out; stopped without retry') from None
        stdout=r.stdout;category=diagnostic_category(r.stderr)
        prefix=self.folder/(str(self.count).zfill(2)+'-'+name)
        prefix.with_suffix('.client.json').write_text(json.dumps({'exit_code':r.returncode,'category':'OK' if r.returncode==0 else category})+'\n')
        require(r.returncode==0,'Read-only client stopped: '+category+'. No retry, TLS downgrade or permission change attempted')
        try:values=[json.loads(line) for line in stdout.splitlines() if line.strip()]
        except (ValueError,TypeError):raise StopReview('Unexpected read-only response format') from None
        require(len(values)==item['objects'] and all(isinstance(x,dict) for x in values),'Unexpected read-only response count/type')
        prefix.with_suffix('.json').write_text(json.dumps(redacted(values,self.secret),indent=2)+'\n')
        return values


def identity_diagnostics(value):
    """Allowlisted flags only: never echo a returned credential/string/row."""
    def switch(key):
        item=value.get(key)
        return item if type(item) is str and item in ('on','off') else 'MISSING' if key not in value else 'UNEXPECTED'
    ssl_value=value.get('ssl')
    return {
        'database_matches':value.get('database')=='postgres',
        'execution_role_matches':value.get('role')=='postgres',
        'session_role_matches':value.get('session_role')=='postgres',
        'server_version_matches':value.get('version_num')=='170011',
        'project_setting_allowed':value.get('project_setting') in (None,'',PROJECT),
        'backend_ssl':ssl_value if type(ssl_value) is bool else 'MISSING' if 'ssl' not in value else 'UNEXPECTED',
        'transaction_read_only':switch('transaction_read_only'),
        'default_transaction_read_only':switch('default_transaction_read_only'),
        'limit':'backend_ssl describes the database-side connection; through a pooler it is not the client-to-pooler TLS observation.'}


def inspect_identity_evidence(folder):
    """Existing Mac files only; no service parsing, password prompt or client call."""
    values=json_file(folder/'01-identity.json')
    require(isinstance(values,list) and len(values)==1 and isinstance(values[0],dict),'Existing identity evidence has unexpected structure; no raw contents printed')
    client=json_file(folder/'01-identity.client.json')
    require(isinstance(client,dict),'Existing identity client evidence has unexpected structure')
    return {'database_connections_attempted':0,'existing_client_exit_success':type(client.get('exit_code')) is int and client['exit_code']==0,
            'identity':identity_diagnostics(values[0]),'action':'STOP: review diagnostics before any new connection; no safeguards bypassed'}


def verify_identity(value):
    require(value.get('database')=='postgres' and value.get('role')=='postgres' and value.get('session_role')=='postgres','Server database/execution identity mismatch')
    require(value.get('version_num')=='170011','Server version differs from reviewed TEST 17.11; STOP for review')
    require(value.get('ssl') is True,'Database-side TLS confirmation failed (pg_stat_ssl); client-to-pooler TLS is a separate observation. STOP; no TLS bypass')
    require(value.get('transaction_read_only')=='on','Explicit transaction_read_only confirmation failed; STOP before application queries')
    require(value.get('default_transaction_read_only')=='on','Session default_transaction_read_only confirmation failed; STOP before application queries')
    require(value.get('project_setting') in (None,'',PROJECT),'Server project setting contradicts TEST binding')


def permissions(current,catalog,local_audit):
    require(all(current['installation_privileges'].values()),'Missing installation/rollback prerequisite privilege; no grants attempted')
    roles={r['rolname']:r for r in current['inventory']['roles']}
    require(all(r in roles and not roles[r]['rolsuper'] and not roles[r]['rolbypassrls'] for r in ('anon','authenticated')),'Unsafe client-role attributes')
    expected={'public.tens_in_groups','public.iig_notification_settings','public.iig_notification_events',
              'iig_private.group_owners','iig_private.group_members','iig_private.platform_owners','iig_private.setup_testers','iig_private.registration_settings'}
    tables={r['schema']+'.'+r['name']:r for r in current['inventory']['tables']}
    require(expected<=set(tables) and all(tables[t]['rls'] is True for t in expected),'Application RLS missing/disabled')
    original={f['signature']:f for f in local_audit['functions']}
    require(len(catalog['prerequisites'])==14,'Prerequisite inventory incomplete')
    for f in catalog['prerequisites']:
        require(f['exists'] is True,'Required function is missing')
        if not f['requested'].startswith(('public.','iig_private.')):continue
        require(f['owner']=='postgres','Original application function has unexpected owner')
        require(f['requested'] in original and f['definition']==original[f['requested']]['definition'],'Original function differs from the rehearsed archive')
        public_status=f['requested']=='public.get_group_access_status(text)'
        require(f['anon_execute'] is public_status and f['authenticated_execute']==(public_status or f['requested'].startswith('public.')),'Unexpected effective function execute grants')


def catalog_safety(c):
    require(c.get('transaction_read_only')=='on','Catalog transaction was not read only')
    groups={g['pin']:g for g in c['groups']}
    require(set(groups)=={'3520','5021'},'Expected protected TEST groups are missing')
    for g in groups.values():require(g['state_type']=='object' and g['players_type']=='array' and g['history_type']=='array' and g['owners']==1,'Group structure/ownership differs')
    for name in ('owner_accounts','member_accounts'):
        require(all(c[name][k]==0 for k in ('missing_auth','unverified','anonymous','banned')),'Account-health prerequisite failed')
    require(all(v['matches']==1 for v in c['membership_matches']),'Unmatched or ambiguous player membership')
    require(not c['writer_locks'] and c['prepared_transactions']==0,'Writer/DDL locks or prepared transactions observed; no clients stopped')
    require(not c['cron_net'],'Cron/network extension inventory changed; review required')


def authority(d):
    native=d.get('current_role')=='postgres' and (d.get('current_superuser') is True or d.get('owner_usage') is True)
    settings={x['name']:x for x in d.get('settings',[])};grant=settings.get('supautils.drop_trigger_grants',{})
    try:grants=json.loads(grant.get('setting','null'))
    except (ValueError,TypeError):grants=None
    loaded=any('supautils' in [v.strip().strip('"') for v in settings.get(n,{}).get('setting','').split(',')] for n in ('shared_preload_libraries','session_preload_libraries','local_preload_libraries'))
    candidate=loaded and grant.get('context')=='sighup' and grant.get('pending_restart') is False and isinstance(grants,dict) and isinstance(grants.get('postgres'),list) and 'auth.users' in grants['postgres']
    return {'status':'PASS' if native else 'UNVERIFIED','native_authority':native,'managed_grant_candidate':bool(candidate),
            'reason':'Native effective ownership/superuser established' if native else 'No proven original rollback authority. A managed grant setting alone is insufficient; retain Supabase support confirmation gate.'}


def online_review(reader,before,local_audit,compare,report):
    report['checks']['server_identity']={'status':'RUNNING'}
    identity=reader.execute('identity')[0]
    report['checks']['server_identity']['diagnostics']=identity_diagnostics(identity)
    verify_identity(identity);report['checks']['server_identity']['status']='PASS'
    report['checks']['original_baseline']={'status':'RUNNING'}
    current=reader.execute('capture')[0]
    compare.compare_baseline(before,current);report['checks']['original_baseline']={'status':'PASS'}
    # One fixed reviewed packet collects safe metadata, then checks are assessed. No privilege probes/DDL.
    report['checks']['permissions_rls_prerequisites']={'status':'RUNNING'}
    owner,catalog,audit=reader.execute('assessment')
    permissions(current,catalog,local_audit)
    report['checks']['permissions_rls_prerequisites']={'status':'PASS'}
    report['checks']['writer_activity']={'status':'RUNNING'}
    catalog_safety(catalog)
    report['checks']['repeated_baseline_and_inventory']={'status':'RUNNING'}
    for table,fp in before['fingerprints'].items():require(audit['rows'][table]==fp,'Protected fingerprint changed during metadata collection')
    require(audit['sequence']==local_audit['sequence'],'Identity sequence differs from the restored original backup; review, never reset it')
    require(catalog['owner_accounts']['rows']==before['fingerprints']['iig_private.group_owners']['rows'] and catalog['member_accounts']['rows']==before['fingerprints']['iig_private.group_members']['rows'],'Membership counts changed between snapshots')
    for table in ('public.iig_notification_settings','public.iig_notification_events'):
        require(audit['rows'][table]==local_audit['rows'][table],'Notification fingerprint differs from rehearsed backup')
    report['checks']['permissions_rls_prerequisites']={'status':'PASS'}
    report['checks']['writer_activity']={'status':'PASS','limit':'No writer locks/prepared transactions observed; idle sessions do not establish paused external writers. See capture session inventory.'}
    final=reader.execute('capture')[0];compare.compare_baseline(before,final)
    compare.compare_supplementary(audit,reader.execute('audit')[0])
    report['checks']['repeated_baseline_and_inventory']={'status':'PASS'}
    report['checks']['rollback_authority']=authority(owner)
    report['checks']['writer_controls']={'status':'UNVERIFIED','reason':'External TEST writers have not been attested paused/drained. Runner never controls services.'}
    report['checks']['auth_services']={'status':'UNVERIFIED','reason':'Account metadata checked; SMTP, Auth service settings, delivery and real JWT/RLS behaviour are not established by SQL and were not queried through an API.'}
    report['review_complete']=True
    require(report['checks']['rollback_authority']['status']=='PASS','Rollback authority remains unverified; STOP/NO-GO. No managed permission assumption or elevation attempted')


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    mode=parser.add_mutually_exclusive_group();mode.add_argument('--offline',action='store_true');mode.add_argument('--connect-test-readonly',metavar='EXACT_TEST_REFERENCE')
    parser.add_argument('--ca-file',type=Path,help='Explicit official CA file for this run only; does not edit the service')
    parser.add_argument('--service-file',type=Path,default=Path.home()/'.pg_service.conf')
    parser.add_argument('--capture',type=Path,default=REPO/'docs/pr6-test-rollback-preparation/capture.json')
    parser.add_argument('--rollback',type=Path,default=REPO/'docs/pr6-test-rollback-preparation/rollback.TEST.sql')
    parser.add_argument('--backup',type=Path,default=Path.home()/'Documents/ImInGolf-Backups/ImInGolf-Test-2026-10-22.dump')
    parser.add_argument('--historical-manifest',type=Path,default=Path.home()/'Documents/ImInGolf-Local-Rehearsal/local-restore-generated/backup.sha256')
    parser.add_argument('--rehearsal',type=Path,default=Path.home()/'Documents/ImInGolf-Local-Rehearsal/local-restore-generated'/PASS_RUN)
    args=parser.parse_args(argv);os.umask(0o077)
    report={'result':'FAIL','project':PROJECT,'mode':'READ_ONLY' if args.connect_test_readonly else 'OFFLINE',
            'connections_attempted':0,'sql_executed':False,'review_complete':False,'installation_authorised':False,
            'release_readiness':'NO-GO','checks':{key:{'status':'NOT_RUN'} for key in ('target_binding','query_integrity','original_rollback','local_rehearsal','backup_evidence','server_identity','original_baseline','permissions_rls_prerequisites','writer_activity','repeated_baseline_and_inventory','rollback_authority','writer_controls','auth_services')},'stage':'offline preflight'}
    folder=None
    try:
        require(args.connect_test_readonly in (None,PROJECT),'Only the exact TEST reference can authorise a read-only connection')
        base=Path.home()/'Documents/ImInGolf-TEST-Installation';base.mkdir(mode=0o700,parents=True,exist_ok=True)
        require(REPO.resolve() not in base.resolve().parents and not base.is_symlink() and base.stat().st_uid==os.getuid() and stat.S_IMODE(base.stat().st_mode)&0o077==0,'Private evidence directory is not securely owned/mode 0700')
        folder=base/('step2-'+dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ'));folder.mkdir(mode=0o700)
        target,secret,queries,g,compare,before,audit,tools,backup=offline_preflight(args,report)
        report['checks']['tls_configuration']={'status':'PASS','sslmode':'verify-full','hostname_verification':True,'ca_source':target.rootcert,'explicit_ca_sha256':digest(Path(target.rootcert)) if target.rootcert!='system' else None,'limit':'Offline CA parsing is not libpq/server-chain validation'}
        report['checks']['offline_evidence']={'status':'PASS','original_rollback_unchanged':True,'local_pass_revalidated':True}
        report['checks']['backup_evidence']=backup
        report['checks']['target_binding']={'status':'PASS','host':target.host,'user':target.user,'effective_sslmode':'verify-full','fallback':'none'}
        if args.connect_test_readonly:
            report['stage']='approved read-only TEST review'
            if secret is None:
                require(sys.stdin.isatty(),'Password needed: run interactively in Mac Terminal; no echoed input fallback')
                with warnings.catch_warnings():
                    warnings.simplefilter('error',getpass.GetPassWarning)
                    secret=password_text(getpass.getpass('Verified TEST '+PROJECT+' password (hidden): '))
            reader=Reader(target,secret,queries,tools,folder,args.connect_test_readonly,report)
            online_review(reader,before,audit,compare,report)
        report['result']='PASS';report['stage']='read-only review complete; no writes/publication authorised' if args.connect_test_readonly else 'offline preflight complete; NO DATABASE CONNECTION MADE'
    except (Exception,KeyboardInterrupt) as error:
        # No tracebacks/locals/command environments are written. Child diagnostics are separately redacted.
        report['error']=str(error) if isinstance(error,(StopReview,ValueError)) else 'A prerequisite or client operation failed; stopped safely without retry'
        for check in report['checks'].values():
            if check.get('status')=='RUNNING':check.update(status='FAIL',reason=report['error'])
    if folder:
        (folder/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(report['result']+' — '+report['stage'])
    print('Database connections attempted: '+str(report['connections_attempted']))
    if 'error' in report:print(report['error'])
    if folder:print('Private Mac evidence: '+str(folder))
    print('Installation/publication: NOT AUTHORISED. No writes, migrations, backups, permission changes, emails or service control.')
    return 0 if report['result']=='PASS' else 1

if __name__=='__main__':sys.exit(main())
