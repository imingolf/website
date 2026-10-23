#!/usr/bin/env python3
"""READ-ONLY ONLINE TEST preflight. This program cannot install or roll back SQL."""
import argparse
import configparser
import datetime
import hashlib
import getpass
import warnings
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import traceback
import types

HERE=Path(__file__).resolve().parent
REPO=HERE.parents[2]
PROJECT='nyavvwrsrxqfyhiygkgw'
PASS_RUN='automated-rehearsal-20261023T115001.671715Z'
SCOPES=['test_browser_mobile_admin_clients','test_dev_preview_ci',
        'test_edge_native_api_integrations','test_scheduled_external_jobs',
        'test_auth_operations','test_manual_sql_and_ddl']

def load(path,name):
    spec=importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module

local=load(HERE.parent/'local-rehearsal/run-rehearsal.py','iig_local_evidence')
g=types.ModuleType('iig_test_generator')
exec(compile((HERE.parent/'prepare.py').read_text(),str(HERE.parent/'prepare.py'),'exec'),g.__dict__)
require=local.require

def run(args,env=None):
    r=subprocess.run(args,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env)
    error=r.stderr
    if env and env.get('PGPASSWORD'): error=error.replace(env['PGPASSWORD'],'[REDACTED]')
    require(r.returncode==0,'Command failed: '+args[0]+'\n'+error[-2000:])
    return r.stdout

def service_config(path):
    require(path.is_file(),'Missing private ~/.pg_service.conf')
    parser=configparser.ConfigParser(interpolation=None)
    parser.read(path)
    require(not parser.defaults(),'Service-file DEFAULT options need review')
    require(parser.has_section('iig-test-only'),'Missing iig-test-only service')
    c=dict(parser['iig-test-only'])
    allowed={'host','port','dbname','user','sslmode','password','passfile','sslrootcert','sslcert','sslkey','connect_timeout','application_name'}
    require(not set(c)-allowed,'Unreviewed libpq service options: '+str(sorted(set(c)-allowed)))
    host=c.get('host',''); user=c.get('user','')
    direct=host=='db.'+PROJECT+'.supabase.co' and user in ('postgres','postgres.'+PROJECT)
    pooler=re.fullmatch(r'aws-[a-z0-9-]+\.pooler\.supabase\.(?:com|co)',host) and user=='postgres.'+PROJECT
    require(direct or pooler,'Connection is not explicitly bound to TEST; no connection attempted')
    require(c.get('port','5432')=='5432' and c.get('dbname','postgres')=='postgres',
            'Require postgres database and port 5432 (direct/session pooler, never transaction pooler)')
    require(c.get('sslmode') in ('require','verify-ca','verify-full'),'SSL must be require or stronger')
    if 'password' in c:
        require(path.stat().st_mode & 0o077==0,'Password-bearing service file must be private (0600)')
    return c

def conninfo(c):
    # Explicit arguments override inherited libpq settings; passwords never enter argv/logs.
    pairs={'host':c['host'],'port':'5432','dbname':'postgres','user':c['user'],
           'sslmode':c['sslmode'],'connect_timeout':'10',
           'application_name':'iig-test-readonly-preflight',
           'options':'-c default_transaction_read_only=on -c statement_timeout=60000 -c lock_timeout=5000 -c standard_conforming_strings=on'}
    for key in ('sslrootcert','sslcert','sslkey'):
        if key in c: pairs[key]=str(Path(c[key]).expanduser())
    def quote(v): return "'"+v.replace('\\','\\\\').replace("'","\\'")+"'"
    return ' '.join(k+'='+quote(v) for k,v in pairs.items())

def evidence(folder):
    report=json.loads((folder/'report.json').read_text())
    require(report.get('result')=='PASS' and report.get('stage')=='complete'
            and report.get('rollback_completed') is True,'Local run did not PASS completely')
    require(report.get('migration_commit')==local.COMMIT and report.get('migration_sha256')==dict(local.MIGRATIONS),
            'Local PASS used different migration sources')
    require(report.get('previous_evidence_comparison_passed') is True and
            report.get('current_database_matches_previous_original_baseline') is True,
            'Local PASS lacks the prior-rollback/current-baseline verification')
    before=json.loads((folder/'original-before.json').read_text())
    after=json.loads((folder/'after-rollback.json').read_text())
    local.compare_baseline(before,after)
    audit=json.loads((folder/'audit-before.json').read_text())
    local.compare_supplementary(audit,json.loads((folder/'audit-after-rollback.json').read_text()))
    installed=json.loads((folder/'installed.json').read_text())
    require(installed['fingerprints']==before['fingerprints'],'Local installation changed protected data')
    return audit

def backup_check(archive,manifest,out,allow_unanchored=False):
    require(archive.is_file(),'Missing TEST archive')
    require(manifest.is_file() or allow_unanchored,
            'Historical backup checksum missing. Review recovery procedure and use --recover-missing-checksum; no historical anchor will be invented')
    expected=None
    if manifest.is_file():
        saved=manifest.read_text().strip().splitlines()
        require(len(saved)==1 and re.match(r'^[a-fA-F0-9]{64}\s',saved[0]),'Unrecognised original backup checksum manifest')
        expected=saved[0].split()[0].lower()
    h=hashlib.sha256()
    with archive.open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''): h.update(chunk)
    require(expected is None or h.hexdigest()==expected,'TEST backup changed since recorded local restore preparation')
    require('18.6' in run(['pg_restore','--version']),'Require Mac pg_restore 18.6')
    toc=run(['pg_restore','--list',str(archive)])
    require(re.search(r'Dumped from database version:\s*17\.11\b',toc),'Archive source version is not expected TEST 17.11')
    (out/'backup-inventory.txt').write_text(toc)
    # Traverse/decompress the full archive with NO database target, not just its TOC.
    run(['pg_restore','--no-owner','--no-acl','--file',os.devnull,str(archive)])
    for table in ['public tens_in_groups','public iig_notification_settings','public iig_notification_events',
                  'iig_private group_owners','iig_private group_members','iig_private setup_testers',
                  'iig_private platform_owners','iig_private registration_settings']:
        require('TABLE DATA '+table+' ' in toc,'Missing archived application data: '+table)
    require('SEQUENCE public tens_in_groups_id_seq ' in toc,'Missing archived identity sequence')
    return h.hexdigest()

def fresh_backup(reader,before,audit,out):
    """New, separately named recovery backup. Never rewrite the original archive/manifest."""
    require('18.6' in run(['pg_dump','--version']),'Require Mac pg_dump 18.6')
    local.compare_baseline(before,reader.capture('before-fresh-backup'))
    local.compare_supplementary(audit,reader.audit('before-fresh-backup-audit'))
    archive=out/'TEST-fresh-preinstall.dump'
    require(not archive.exists(),'Fresh backup path already exists; refuse overwrite')
    # O_EXCL and umask 077 prevent accidental replacement or readable credentials.
    fd=os.open(archive,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    os.close(fd)
    env={k:v for k,v in os.environ.items() if not k.startswith('PG')}
    env['PGOPTIONS']='-c default_transaction_read_only=on'
    if 'password' in reader.c: env['PGPASSWORD']=reader.c['password']
    if 'passfile' in reader.c: env['PGPASSFILE']=str(Path(reader.c['passfile']).expanduser())
    run(['pg_dump','--no-password','--dbname',conninfo(reader.c),'--format=custom',
         '--no-owner','--no-acl','--lock-wait-timeout=5s','--file',str(archive)],env=env)
    # Only after pg_dump succeeds: anchor the NEW archive, explicitly dated now.
    digest=hashlib.sha256(archive.read_bytes()).hexdigest()
    manifest=out/'fresh-backup.sha256'
    manifest.write_text(digest+'  '+archive.name+'\n')
    validation=out/'fresh-backup-validation'; validation.mkdir(mode=0o700)
    backup_check(archive,manifest,validation)
    local.compare_baseline(before,reader.capture('after-fresh-backup'))
    local.compare_supplementary(audit,reader.audit('after-fresh-backup-audit'))
    record={'project':PROJECT,'path':str(archive.resolve()),'sha256':digest,
            'created_at_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'historical_checksum_missing':True,'original_archive_integrity_proven':False,
            'validated':'pg_dump succeeded; full pg_restore traversal; original captured scope unchanged before/after',
            'limits':'Independent consistent dump snapshot; before/after comparisons do not prove absence of transient writers. No full Auth/ACL restore test.'}
    (out/'fresh-backup.json').write_text(json.dumps(record,indent=2)+'\n')
    return record

def writer_controls(path):
    if not path.exists():
        template={'project':PROJECT,'operator':'','confirmed_at_utc':'',
                  'note':'NOT YET CONFIRMED PAUSED. This template is not evidence.',
                  'controls':{s:{'status':'unknown','evidence':''} for s in SCOPES}}
        path.write_text(json.dumps(template,indent=2)+'\n')
        return False,'Writer pause/drain not confirmed; complete controlled-pause.json using the reviewed pause procedure'
    c=json.loads(path.read_text())
    require(c.get('project')==PROJECT,'Writer-control file targets a different project')
    try:
        at=datetime.datetime.fromisoformat(c.get('confirmed_at_utc','').replace('Z','+00:00'))
        age=(datetime.datetime.now(datetime.timezone.utc)-at).total_seconds()
    except (ValueError,TypeError):
        return False,'Writer controls are incomplete/unconfirmed'
    if not (0<=age<=1800 and c.get('operator','').strip()):
        return False,'Writer-control attestation is missing or older than 30 minutes'
    controls=c.get('controls',{})
    ok=set(controls)==set(SCOPES) and all(controls[s].get('status') in ('paused','controlled','absent')
        and len(controls[s].get('evidence','').strip())>=15 for s in SCOPES)
    return ok,('Operator-attested controls; snapshots/locks do not independently prove a pause' if ok
               else 'All TEST writer scopes need specific pause/absence/control evidence')

READ_GUARD="""BEGIN READ ONLY;
DO $$ BEGIN
 IF current_user<>'postgres' OR current_database()<>'postgres'
 OR current_setting('server_version_num')::integer<>170011 THEN
 RAISE EXCEPTION 'Expected TEST postgres PostgreSQL 17.11'; END IF;
 IF coalesce(current_setting('supabase.project_ref',true),'') NOT IN ('','nyavvwrsrxqfyhiygkgw') THEN
 RAISE EXCEPTION 'Project setting contradicts TEST identity'; END IF;
END $$;
COMMIT;
"""

class Reader:
    # Only the read-only capture/audit methods are reused; no install/rollback method.
    capture=local.Runner.capture
    audit=local.Runner.audit
    verify_rls=local.Runner.verify_rls

    def __init__(self,c,out):
        self.c=c; self.run_dir=out; self.generator=g; self.counter=0

    def sql(self,text,label,variables=(),allow_password_prompt=False):
        require(not variables,'Read-only preflight accepts no execution variables')
        self.counter+=1
        prefix=self.run_dir/f'{self.counter:02d}-{label}'
        prefix.with_suffix('.sql').write_text(READ_GUARD+text)
        env={k:v for k,v in os.environ.items() if not k.startswith('PG')}
        env['PGOPTIONS']='-c default_transaction_read_only=on'
        if 'password' in self.c: env['PGPASSWORD']=self.c['password']
        if 'passfile' in self.c: env['PGPASSFILE']=str(Path(self.c['passfile']).expanduser())
        args=['psql','-X','-w','-qAt','--dbname',conninfo(self.c),'-v','ON_ERROR_STOP=1']
        r=subprocess.run(args,input=READ_GUARD+text,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env)
        if (allow_password_prompt and r.returncode!=0 and
                'fe_sendauth: no password supplied' in r.stderr and not self.c.get('password')):
            require(sys.stdin.isatty(),'TEST password required: rerun in an interactive Mac Terminal; no insecure input fallback')
            # getpass must never fall back to echoed stdin. No password in argv or files.
            with warnings.catch_warnings():
                warnings.simplefilter('error',getpass.GetPassWarning)
                secret=getpass.getpass('Password for verified Supabase TEST '+PROJECT+' (hidden): ')
            require(bool(secret),'Empty TEST password; stopped')
            self.c['password']=secret
            env['PGPASSWORD']=secret
            r=subprocess.run(args,input=READ_GUARD+text,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env)
        # Defensive redaction also covers unexpected subprocess diagnostics.
        if self.c.get('password'):
            r.stdout=r.stdout.replace(self.c['password'],'[REDACTED]')
            r.stderr=r.stderr.replace(self.c['password'],'[REDACTED]')
        prefix.with_suffix('.stdout').write_text(r.stdout)
        prefix.with_suffix('.stderr').write_text(r.stderr)
        require(r.returncode==0,'Read-only TEST check failed: '+label+'; see '+str(prefix.with_suffix('.stderr')))
        return r.stdout

OWNERSHIP_SQL="""BEGIN READ ONLY;
SET LOCAL search_path=pg_catalog;
SELECT jsonb_build_object(
 'current_role',current_user,'session_role',session_user,
 'table_owner',(select pg_get_userbyid(relowner) from pg_class where oid='auth.users'::regclass),
 'current_superuser',(select rolsuper from pg_roles where rolname=current_user),
 'owner_usage',(select pg_has_role(current_user,relowner,'USAGE') from pg_class where oid='auth.users'::regclass),
 'owner_member',(select pg_has_role(current_user,relowner,'MEMBER') from pg_class where oid='auth.users'::regclass),
 'owner_set',(select pg_has_role(current_user,relowner,'SET') from pg_class where oid='auth.users'::regclass),
 'trigger_privilege',has_table_privilege(current_user,'auth.users','TRIGGER'),
 'roles',(select coalesce(jsonb_agg(jsonb_build_object('name',rolname,'superuser',rolsuper,'inherit',rolinherit,
 'member',pg_has_role(current_user,oid,'MEMBER'),'usage',pg_has_role(current_user,oid,'USAGE'),
 'set',pg_has_role(current_user,oid,'SET'))),'[]') from pg_roles),
 'memberships',(select coalesce(jsonb_agg(jsonb_build_object('role',pg_get_userbyid(roleid),
 'member',pg_get_userbyid(member),'grantor',pg_get_userbyid(grantor),
 'admin_option',admin_option,'inherit_option',inherit_option,'set_option',set_option)),'[]') from pg_auth_members),
 'settings',(select coalesce(jsonb_agg(jsonb_build_object('name',name,'setting',setting,
 'context',context,'source',source,'pending_restart',pending_restart)),'[]') from pg_settings
 where name in ('shared_preload_libraries','session_preload_libraries','local_preload_libraries',
 'supautils.drop_trigger_grants','supautils.superuser','supautils.privileged_extensions_superuser','supautils.privileged_role')));
COMMIT;
"""

def ownership_diagnostics(reader):
    d=json.loads(reader.sql(OWNERSHIP_SQL,'auth-trigger-ownership'))
    require(d['current_role']=='postgres','Unexpected diagnostic execution role')
    d['native_drop_authority']=d['current_superuser'] is True or d['owner_usage'] is True
    # SET-only membership is diagnostic: the original rollback never SET ROLEs to
    # the Auth owner before DROP TRIGGER. Never treat MEMBER/SET/TRIGGER as USAGE.
    settings={x['name']:x for x in d['settings']}
    grant=settings.get('supautils.drop_trigger_grants',{})
    try:
        grants=json.loads(grant.get('setting','null'))
    except (ValueError,TypeError):
        grants=None
    preloaded=any('supautils' in [v.strip().strip('"') for v in
                  settings.get(name,{}).get('setting','').split(',')]
                  for name in ('shared_preload_libraries','session_preload_libraries','local_preload_libraries'))
    d['supautils_exact_grant_candidate']=(preloaded and grant.get('context')=='sighup'
        and grant.get('pending_restart') is False and isinstance(grants,dict)
        and isinstance(grants.get(d['current_role']),list)
        and 'auth.users' in grants[d['current_role']])
    d['assessment']=('Native effective ownership/superuser authority established' if d['native_drop_authority'] else
        'Supautils exact configured grant found; review managed implementation/support before approving original rollback' if d['supautils_exact_grant_candidate'] else
        'No proven authority for original rollback; contact Supabase support. No privilege/ownership changes authorised')
    (reader.run_dir/'auth-trigger-ownership.json').write_text(json.dumps(d,indent=2)+'\n')
    return d

class OwnershipDiagnosisComplete(Exception):
    pass

def online_checks(reader,before,audit_local):
    current=reader.capture('test-current')
    local.compare_baseline(before,current)  # STOP, never replace the original capture.
    require(all(current['installation_privileges'].values()),'Missing hosted installation privilege, including Auth TRIGGER')
    require(current['role']=='postgres','Require original owner role postgres')
    roles={r['rolname']:r for r in current['inventory']['roles']}
    require(all(name in roles and not roles[name]['rolsuper'] and not roles[name]['rolbypassrls']
                for name in ('anon','authenticated')),'Unsafe hosted client-role attributes')
    for f in current['functions']:
        if f['exists']:
            require(f['meta']['owner']=='postgres','Affected function is not owned by postgres: '+f['requested'])
    reader.verify_rls()
    prerequisites=['auth.uid()','pg_catalog.gen_random_uuid()','pg_catalog.hashtextextended(text,bigint)',
       'iig_private.verified_organiser()','iig_private.check_group_access(text)',
       'public.get_group_access_status(text)','public.iig_create_owned_group(text,text,uuid)',
       'public.iig_get_owned_group()','public.iig_save_owned_group(text,jsonb,bigint)',
       'public.iig_join_owned_group(text,uuid,text,numeric)','public.iig_get_player_group(text)',
       'public.iig_set_my_attendance(text,boolean,bigint)','public.iig_submit_my_score(text,integer,text,bigint)',
       'public.iig_list_registered_groups(integer)']
    sigs=','.join(g.lit(s) for s in prerequisites)
    meta=json.loads(reader.sql(f"BEGIN READ ONLY; SET LOCAL search_path=pg_catalog; SELECT jsonb_agg(jsonb_build_object('requested',s,'exists',p.oid is not null,'signature',p.oid::regprocedure::text,'definition',case when p.oid is not null then pg_get_functiondef(p.oid) end,'owner',pg_get_userbyid(p.proowner),'anon',case when p.oid is not null then has_function_privilege('anon',p.oid,'EXECUTE') end,'auth',case when p.oid is not null then has_function_privilege('authenticated',p.oid,'EXECUTE') end)) FROM unnest(array[{sigs}]) s LEFT JOIN pg_proc p ON p.oid=to_regprocedure(s); COMMIT;",'original-prerequisites-and-access'))
    reference={f['signature']:f for f in audit_local['functions']}
    for f in meta:
        require(f['exists'],'Missing prerequisite: '+f['requested'])
        if f['requested'].startswith(('public.','iig_private.')):
            require(f['owner']=='postgres','Unexpected prerequisite owner: '+f['requested'])
            require(f['signature'] in reference and reference[f['signature']]['definition']==f['definition'],
                    'Original function differs from rehearsed archive definition: '+f['requested'])
            if f['requested']=='public.get_group_access_status(text)':
                require(f['anon'] and f['auth'],'Original public access-status grant differs')
            else:
                require(not f['anon'] and f['auth']==f['requested'].startswith('public.'),
                        'Unexpected original effective function access: '+f['requested'])
    q="""BEGIN READ ONLY;
SELECT jsonb_build_object('locks',(select coalesce(jsonb_agg(jsonb_build_object('pid',l.pid,'table',l.relation::regclass::text,'mode',l.mode)),'[]')
 from pg_locks l where l.pid<>pg_backend_pid() and l.granted and l.relation in
 (select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','iig_private','auth'))
 and l.mode in ('RowExclusiveLock','ShareUpdateExclusiveLock','ShareRowExclusiveLock','ExclusiveLock','AccessExclusiveLock')),
 'prepared',(select count(*) from pg_prepared_xacts where database=current_database()),
 'auth_trigger_drop_authority',(select pg_has_role(current_user,relowner,'USAGE') from pg_class where oid='auth.users'::regclass),
 'extensions',(select coalesce(jsonb_agg(extname),'[]') from pg_extension where extname in ('pg_cron','pg_net')),
 'lock_privileges',(select bool_and(has_table_privilege(t,'SELECT') and has_table_privilege(t,'UPDATE'))
 from unnest(array['public.tens_in_groups','public.iig_notification_settings','public.iig_notification_events',
 'iig_private.group_owners','iig_private.group_members','iig_private.platform_owners','iig_private.setup_testers',
 'iig_private.registration_settings','auth.users','auth.identities']) t),
 'sessions',(select coalesce(jsonb_agg(jsonb_build_object('pid',pid,'role',usename,'application',application_name,
 'state',state,'transaction_start',xact_start,'backend_type',backend_type)),'[]') from pg_stat_activity
 where datname=current_database() and pid<>pg_backend_pid())); COMMIT;
"""
    status=json.loads(reader.sql(q,'writers-and-lock-privileges'))
    status['auth_ownership_diagnostics']=ownership_diagnostics(reader)
    require(not status['locks'] and status['prepared']==0,'Potential writer/DDL locks or prepared transactions exist; STOP')
    require(not status['extensions'],'pg_cron/pg_net infrastructure differs from recorded TEST; review before proceeding')
    require(status['lock_privileges'] is True,'Cannot establish privileges for guarded install/rollback locks')
    require(status['auth_ownership_diagnostics']['native_drop_authority'] is True,
            'Cannot prove native authority to DROP auth.users trigger. See auth-trigger-ownership.json for role inheritance and Supautils evidence; installation remains NO-GO pending supported rollback review. TRIGGER/MEMBER/SET alone are insufficient')
    defaults="""BEGIN READ ONLY; SELECT jsonb_object_agg(schema_name,grants) FROM (
 SELECT schema_name,(SELECT coalesce(jsonb_agg(jsonb_build_object('grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
 'grantor',pg_get_userbyid(a.grantor),'privilege',a.privilege_type,'grantable',a.grantable)),'[]') FROM
 (SELECT x.grantee,x.grantor,x.privilege_type,bool_or(x.is_grantable) grantable FROM aclexplode(
 coalesce((select defaclacl from pg_default_acl where defaclrole='postgres'::regrole and defaclnamespace=0 and defaclobjtype='f'),acldefault('f','postgres'::regrole)) ||
 coalesce((select defaclacl from pg_default_acl where defaclrole='postgres'::regrole and defaclnamespace=to_regnamespace(schema_name) and defaclobjtype='f'),'{}'::aclitem[])) x
 GROUP BY x.grantee,x.grantor,x.privilege_type) a) grants FROM unnest(array['public','iig_private']) schema_name) d; COMMIT;"""
    status['new_function_default_acls']=json.loads(reader.sql(defaults,'effective-new-function-default-acls'))
    # Managed idle sessions are reported, never exempted as proof of maintenance.
    audit=reader.audit('test-full-audit')
    app_source='\n'.join((REPO/'supabase/staging'/f'{name}.sql').read_text() for name in
                         ('empty-test-schema','organiser-access','self-service-registration','player-scores'))
    app_names=set(re.findall(r'create(?: or replace)? function\s+([\w.]+)\s*\(',app_source,re.I))
    archived={f['signature']:f for f in audit_local['functions'] if f['signature'].split('(')[0] in app_names}
    online={f['signature']:f for f in audit['functions'] if f['signature'].split('(')[0] in app_names}
    require(set(archived)==set(online),'Original application overload inventory differs from rehearsed archive')
    for sig,f in archived.items():
        require(online[sig]['definition']==f['definition'] and online[sig]['owner']=='postgres',
                'Original application definition/owner differs from rehearsed archive: '+sig)
    status['prerequisites']=meta
    return current,audit,status

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--capture',type=Path,default=HERE.parent/'capture.json')
    p.add_argument('--rollback',type=Path,default=HERE.parent/'rollback.TEST.sql')
    p.add_argument('--service-file',type=Path,default=Path.home()/'.pg_service.conf')
    p.add_argument('--root',type=Path,default=Path.home()/'Documents/ImInGolf-Local-Rehearsal')
    p.add_argument('--backup',type=Path,default=Path.home()/'Documents/ImInGolf-Backups/ImInGolf-Test-2026-10-22.dump')
    p.add_argument('--recover-missing-checksum',action='store_true',help='Explicitly record missing historical checksum and create a distinct fresh read-only TEST backup')
    p.add_argument('--diagnose-auth-ownership',action='store_true',help='Read-only ownership evidence only; never creates installation package or fresh backup')
    a=p.parse_args(); os.umask(0o077)
    base=Path.home()/'Documents/ImInGolf-TEST-Installation'; base.mkdir(exist_ok=True,mode=0o700)
    out=base/('readonly-preflight-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ'))
    out.mkdir(mode=0o700)
    report={'result':'FAIL','migrations_executed':False,'project':PROJECT,'stage':'offline evidence',
            'evidence':str(out),'remaining_limits':[
              'Local 17.6 versus TEST 17.11 and different managed Auth/roles/services.',
              'Full original Supabase Auth/ACL/service recovery has not been rehearsed.',
              'Checks prove captured scope, not all uncaptured hosted activity; idle sessions do not prove a pause.',
              'No TEST deployment, runtime account/subscription actions or production approval.']}
    try:
        require(run(['git','-C',str(REPO),'branch','--show-current']).strip()=='pr6-test-rollback-preparation','Wrong repository branch')
        require(not run(['git','-C',str(REPO),'status','--porcelain','--untracked-files=no']).strip(),'Tracked repository edits need review')
        before=json.loads(a.capture.read_text())
        rollback=a.rollback.read_text()
        require(rollback==g.rollback(before),'Original TEST rollback differs from original guarded generator')
        require(before['project_attestation']==PROJECT and before['role']=='postgres','Wrong original TEST capture')
        audit_local=evidence(a.root/'local-restore-generated'/PASS_RUN)
        report['local_rehearsal_evidence']='PASS revalidated from saved files'
        historical_manifest=a.root/'local-restore-generated/backup.sha256'
        missing_history=not historical_manifest.is_file()
        report['historical_checksum_missing']=missing_history
        report['original_backup_observed_sha256']=backup_check(a.backup,historical_manifest,out,allow_unanchored=a.recover_missing_checksum)
        report['original_backup_path']=str(a.backup.resolve())
        report['original_backup_observed_at_utc']=datetime.datetime.now(datetime.timezone.utc).isoformat()
        report['original_backup_hash_scope']='Observed now only; NOT historical integrity evidence' if missing_history else 'Matched previously recorded manifest'
        (out/'original-backup-observation.json').write_text(json.dumps({k:v for k,v in report.items() if k.startswith(('original_backup','historical_checksum'))},indent=2))
        report['backup_limit']='Readable original archive; synthetic Auth/local ACL restoration does not prove full hosted Auth recovery'
        originals=[]
        for name,digest in local.MIGRATIONS:
            source=run(['git','-C',str(REPO),'show',f'{local.COMMIT}:supabase/staging/{name}.sql'])
            require(hashlib.sha256(source.encode()).hexdigest()==digest,'Pinned source checksum mismatch: '+name)
            originals.append((name,source))
        c=service_config(a.service_file)
        require('18.6' in run(['psql','--version']),'Require Mac psql 18.6')
        report['connection']={k:c[k] for k in ('host','user','sslmode')}
        report['stage']='read-only TEST comparison'
        reader=Reader(c,out)
        report['connection_diagnostics']=reader.sql('\\conninfo\n','connection-identity',allow_password_prompt=True)
        if a.diagnose_auth_ownership:
            local.compare_baseline(before,reader.capture('ownership-original-baseline'))
            report['baseline_unchanged']=True
            report['auth_ownership_diagnostics']=ownership_diagnostics(reader)
            raise OwnershipDiagnosisComplete()
        current,audit,status=online_checks(reader,before,audit_local)
        report['baseline_unchanged']=True
        for table in ('public.iig_notification_settings','public.iig_notification_events'):
            require(audit['rows'][table]==audit_local['rows'][table],
                    'Notification data differs from rehearsed backup: '+table+'; STOP for review')
        report['background_inventory']=status
        if missing_history:
            report['stage']='fresh read-only TEST recovery backup'
            report['fresh_backup']=fresh_backup(reader,before,audit,out)
        report['stage']='writer controls and final read-only comparison'
        controls_ok,controls_note=writer_controls(base/'controlled-pause.json')
        report['writer_controls']=controls_note
        # A second snapshot detects movement during preparation; it is not proof of a pause.
        time.sleep(1)
        local.compare_baseline(before,reader.capture('test-final-readonly-snapshot'))
        local.compare_supplementary(audit,reader.audit('test-final-full-audit'))
        require(controls_ok,'Writers NOT confirmed paused/controlled. Read-only checks may pass, installation remains NO-GO. See controlled-pause.json and the controlled pause procedure.')
        builder=load(HERE/'guarded-plan.py','iig_guarded_plan')
        builder.prepare(out,before,audit,originals,rollback,g,status['new_function_default_acls'],
                        json.loads((base/'controlled-pause.json').read_text()))
        report.update(result='PASS',stage='read-only preparation complete; installation still requires explicit approval',
                      rollback_sha256=hashlib.sha256(rollback.encode()).hexdigest())
    except OwnershipDiagnosisComplete:
        report.update(result='PASS',stage='read-only ownership evidence collected; installation remains NO-GO pending review',installation_ready=False)
    except (Exception,KeyboardInterrupt) as e:
        report['error']=str(e) or 'Interrupted'
        (out/'exception.txt').write_text(traceback.format_exc())
    (out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    text=report['result']+' — '+report['stage']+'\n'
    text+='Online migrations executed: NO\n'
    if report.get('baseline_unchanged'): text+='Original captured TEST baseline: unchanged\n'
    if 'auth_ownership_diagnostics' in report: text+=report['auth_ownership_diagnostics']['assessment']+'\n'
    if 'error' in report: text+=report['error']+'\n'
    text+='Evidence: '+str(out)+'\n'
    (out/'report.txt').write_text(text); print(text)
    return 0 if report['result']=='PASS' else 1

if __name__=='__main__': sys.exit(main())
