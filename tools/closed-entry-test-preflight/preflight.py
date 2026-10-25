#!/usr/bin/env python3
"""Offline by default. One separately approved, fixed direct-TEST read-only capture."""
import argparse
import configparser
from datetime import datetime, timezone
import getpass
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import ssl
import stat
import subprocess
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
PROJECT = 'nyavvwrsrxqfyhiygkgw'
HOST = 'db.' + PROJECT + '.supabase.co'
POOLER = 'aws-0-eu-west-1.pooler.supabase.com'
SERVICE = 'iig-test-only'
SECTIONS = {'identity','functions','tables','triggers','policies','authority','platform','writers','fingerprints'}
LIMIT = 32 * 1024 * 1024

class Stop(Exception):
    pass

def require(ok, label):
    if not ok:
        raise Stop(label)

def private_file(path, label):
    p = Path(path).expanduser()
    require(not p.is_symlink() and p.is_file(), label + ': missing/unsafe private file')
    s = p.stat()
    require(s.st_uid == os.getuid() and not stat.S_IMODE(s.st_mode) & 0o077, label + ': ownership/mode must be private')
    return p.resolve()

def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for part in iter(lambda:f.read(1024*1024), b''):
            h.update(part)
    return h.hexdigest()

def read_json(path, label):
    p = private_file(path, label)
    require(p.stat().st_size <= LIMIT, label + ': too large')
    return json.loads(p.read_text())

def service_identity(path):
    p = private_file(path, 'service')
    c = configparser.ConfigParser(interpolation=None, strict=True)
    c.read_string(p.read_text())
    require(not c.defaults() and c.has_section(SERVICE), 'service: missing/ambiguous TEST section')
    s = dict(c[SERVICE])
    require(set(s) <= {'host','port','dbname','user','sslmode','sslrootcert','connect_timeout','application_name'},
            'service: unsupported overrides or stored password')
    require(s.get('port','5432') == '5432' and s.get('dbname') == 'postgres', 'service: database/port mismatch')
    require((s.get('host'),s.get('user')) in [(HOST,'postgres'),(POOLER,'postgres.'+PROJECT)], 'service: TEST identity mismatch')
    return s

def service(path):
    s = service_identity(path)
    p = private_file(path, 'service')
    require(s.get('sslmode') == 'verify-full', 'service: verify-full required; settings not changed')
    return {'service_sha256':digest(p),'source_route':'direct' if s['host']==HOST else 'session_pooler',
            'selected_route':'explicit_direct_TEST_only'}

def certificate(path):
    p = private_file(path, 'TEST direct CA')
    require(p.stat().st_size <= 1024*1024, 'TEST direct CA: too large')
    text = p.read_text()
    require('PRIVATE KEY' not in text and 'BEGIN CERTIFICATE' in text, 'TEST direct CA: PEM certificates only')
    ssl.create_default_context(cafile=str(p))
    return p

def scope(capture):
    require(capture.get('project_attestation')==PROJECT and capture.get('database')=='postgres'
            and capture.get('role')=='postgres' and capture.get('format')==1, 'capture: original TEST identity not established')
    tables = capture.get('inventory',{}).get('tables')
    require(isinstance(tables,list), 'capture: missing original table inventory')
    names = sorted({(t['schema'],t['name']) for t in tables if t['schema'] in ('public','iig_private')})
    require(1<=len(names)<=24 and ('public','tens_in_groups') in names, 'capture: bounded application table scope missing')
    require(all(re.fullmatch('[a-z_][a-z_0-9]{0,62}',s) and re.fullmatch('[a-z_][a-z_0-9]{0,62}',t) for s,t in names),
            'capture: unsupported identifier')
    fps = capture.get('fingerprints',{})
    require(all(k in fps for k in ('public.tens_in_groups','iig_private.group_owners','iig_private.group_members')),
            'capture: original protected fingerprints missing')
    require(all((tuple(k.split('.')) in names) for k in fps if not k.startswith('auth.')), 'capture: fingerprint outside inventory')
    require(isinstance(capture.get('functions'),list) and capture['functions'], 'capture: function baseline missing')
    require(isinstance(capture.get('inventory',{}).get('triggers'),list), 'capture: trigger baseline missing')
    return names

def approved_template():
    raw = (HERE/'catalog.sql').read_bytes()
    m = json.loads((HERE/'query-manifest.json').read_text())
    require(m=={'project':PROJECT,'sha256':hashlib.sha256(raw).hexdigest()}, 'query: reviewed template hash mismatch')
    text = raw.decode()
    # These are fixed reviewed statements, not an arbitrary SQL sanitiser.
    clean = re.sub(r'--[^\n]*','',text)
    clean = re.sub(r"'(?:''|[^'])*'", "''", clean)
    require('\\' not in text and not re.search(r'\b(insert|update|delete|create|alter|drop|grant|revoke|copy|call|do|execute)\b',clean,re.I),
            'query: prohibited statement')
    return text

def build_sql(capture):
    names = scope(capture)
    sql = '''BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL default_transaction_read_only = on;
SET LOCAL search_path = pg_catalog;
SET LOCAL timezone = 'UTC';
SET LOCAL datestyle = 'ISO, YMD';
SET LOCAL extra_float_digits = 3;
SET LOCAL row_security = off;
SET LOCAL statement_timeout = '8s';
SET LOCAL lock_timeout = '500ms';
SET LOCAL idle_in_transaction_session_timeout = '15s';
SELECT 1 / CASE WHEN current_database()='postgres' AND current_user='postgres' AND session_user='postgres'
 AND current_setting('transaction_read_only')='on' AND current_setting('default_transaction_read_only')='on'
 AND current_setting('server_version_num')::integer BETWEEN 170000 AND 179999
 AND coalesce(current_setting('supabase.project_ref',true),'') IN ('','nyavvwrsrxqfyhiygkgw')
 AND EXISTS(SELECT 1 FROM pg_catalog.pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl)
 THEN 1 ELSE 0 END;
'''
    # Fail before application reads if a table became a view/foreign table,
    # acquired descendants, or contains a custom output type.
    values=','.join("('"+s+"','"+t+"')" for s,t in names)
    relation_guard=""" AND (SELECT count(*)=%d FROM (VALUES %s) expected(schema_name,table_name)
 JOIN pg_catalog.pg_namespace ns ON ns.nspname=expected.schema_name
 JOIN pg_catalog.pg_class rel ON rel.relnamespace=ns.oid AND rel.relname=expected.table_name
 WHERE rel.relkind='r' AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_inherits WHERE inhparent=rel.oid)
 AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_type ty ON ty.oid=a.atttypid
 WHERE a.attrelid=rel.oid AND a.attnum>0 AND NOT a.attisdropped AND ty.typnamespace<>'pg_catalog'::regnamespace))
""" % (len(names),values)
    # ACCESS SHARE is the lock ordinary SELECT takes, compatible with DML. Hold it
    # explicitly before the kind/type guard so concurrent DDL cannot swap a scoped
    # relation into a foreign table between validation and fingerprint selection.
    locks=''.join('LOCK TABLE ONLY "'+s+'"."'+t+'" IN ACCESS SHARE MODE;\n' for s,t in names)
    sql += locks+'SELECT 1 / CASE WHEN true'+relation_guard+' THEN 1 ELSE 0 END;\n'

    sql += approved_template()
    # Only validated identifiers from the original TEST inventory are interpolated.
    # Never inserts saved function bodies, resolver SQL, predicates or caller SQL.
    queries=[]
    for s,t in names:
        queries.append("SELECT '"+s+'.'+t+"' AS name,count(*) AS rows,md5(coalesce(string_agg(h,'' ORDER BY h),'')) AS md5 FROM (SELECT md5(to_jsonb(r)::text) AS h FROM \""+s+'"."'+t+'" r) hashes')
    sql += "SELECT jsonb_build_object('section','fingerprints','items',jsonb_object_agg(name,jsonb_build_object('rows',rows,'md5',md5))) FROM (\n"+'\nUNION ALL\n'.join(queries)+') f;\nCOMMIT;\n'
    return sql

def local_environment():
    # In particular no inherited PG*, HOME/passfiles/services, URL or proxy parameters.
    return {'PATH':os.environ.get('PATH','/usr/bin:/bin'), 'LANG':'C'}

def environment(ca, password):
    return {**local_environment(),'PGHOST':HOST,'PGPORT':'5432','PGDATABASE':'postgres','PGUSER':'postgres',
            'PGSSLMODE':'verify-full','PGSSLROOTCERT':str(ca),'PGGSSENCMODE':'disable',
            'PGSERVICEFILE':'/dev/null','PGPASSFILE':'/dev/null','PGCONNECT_TIMEOUT':'8',
            'PGAPPNAME':'iig-closed-entry-TEST-readonly','PGPASSWORD':password,
            'PGOPTIONS':'-c default_transaction_read_only=on -c statement_timeout=8000 -c lock_timeout=500 -c idle_in_transaction_session_timeout=15000'}

def archive_evidence(path, executable):
    p = private_file(path,'original TEST backup')
    require(0 < p.stat().st_size <= 2*1024**3, 'original TEST backup: invalid size')
    with p.open('rb') as f:
        require(f.read(5)==b'PGDMP', 'original TEST backup: not a custom archive')
    run = subprocess.run([executable,'--list',str(p)],capture_output=True,text=True,timeout=30,env=local_environment())
    require(run.returncode==0 and 'TABLE public tens_in_groups ' in run.stdout, 'original TEST backup: inventory validation failed')
    return {'sha256_recorded_now':digest(p),'historical_checksum_available':False,
            'custom_archive_listed':True,'full_restore_proven':False,'inventory_sha256':hashlib.sha256(run.stdout.encode()).hexdigest()}

def write_new(path,text):
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w') as f:f.write(text)

def code_hashes():
    return {n:digest(HERE/n) for n in ('preflight.py','catalog.sql','query-manifest.json')}

def prepare(args):
    cpath=private_file(args.capture,'original capture');capture=read_json(cpath,'original capture')
    sql=build_sql(capture)
    service_meta=service(args.service)
    ca=certificate(args.ca)
    rollback=private_file(args.rollback,'original TEST rollback')
    require(rollback.stat().st_size <= LIMIT, 'original TEST rollback: too large')
    text=rollback.read_text()
    require(PROJECT in text and 'LOCAL' not in rollback.name and re.search(r'\bBEGIN\b',text,re.I),
            'original TEST rollback: project/transaction evidence missing')
    restore=shutil.which('pg_restore');psql=shutil.which('psql')
    require(restore is not None and psql is not None, 'psql/pg_restore missing')
    archive=archive_evidence(args.backup,restore)
    out=Path(args.out).expanduser()
    require(not out.exists() and not out.is_symlink() and out.parent.is_dir(), 'output: require new folder under existing parent')
    require(not out.resolve().is_relative_to(ROOT), 'output: evidence must be outside repository')
    out.mkdir(mode=0o700)
    inputs={k:str(private_file(getattr(args,k),k)) for k in ('capture','rollback','backup','service','ca')}
    manifest={'project':PROJECT,'mode':'READONLY_REVIEW_NOT_INSTALLABLE','database_connections':0,
              'code_hashes':code_hashes(),'input_paths':inputs,'input_hashes':{k:digest(p) for k,p in inputs.items()},
              'sql_sha256':hashlib.sha256(sql.encode()).hexdigest(),'service':service_meta,'backup':archive,
              'table_scope':['.'.join(x) for x in scope(capture)],'auth_table_rows_read':False,
              'installation_approved':False,'original_rollback_reused_as_incident_rollback':False}
    write_new(out/'inspection.READONLY.sql',sql)
    write_new(out/'manifest.PRIVATE.json',json.dumps(manifest,indent=2)+'\n')
    write_new(out/'writers.REVIEW.json',json.dumps({k:'UNVERIFIED — owner confirmation required; this runner stops nothing' for k in
       ('websites_and_old_test_urls','browser_and_iPhone_sessions','Auth_activity','Edge_Functions','scheduled_jobs','API_integrations','CI_and_manual_admin_tools')},indent=2)+'\n')
    return out

def package(folder):
    folder=Path(folder).expanduser()
    require(not folder.is_symlink() and folder.is_dir() and folder.stat().st_uid==os.getuid()
            and not stat.S_IMODE(folder.stat().st_mode)&0o077, 'package: unsafe directory')
    m=read_json(folder/'manifest.PRIVATE.json','package manifest')
    require(m.get('project')==PROJECT and m.get('mode')=='READONLY_REVIEW_NOT_INSTALLABLE'
            and m.get('code_hashes')==code_hashes(), 'package: code/identity drift; prepare again offline')
    for k,p in m['input_paths'].items():
        require(digest(private_file(p,k))==m['input_hashes'][k], 'package: local evidence/configuration changed')
    service(m['input_paths']['service']);ca=certificate(m['input_paths']['ca'])
    capture=read_json(m['input_paths']['capture'],'capture')
    sql=build_sql(capture)
    require(private_file(folder/'inspection.READONLY.sql','query').read_text()==sql and hashlib.sha256(sql.encode()).hexdigest()==m['sql_sha256'],
            'package: query drift')
    require(not (folder/'catalog.PRIVATE.json').exists() and not (folder/'connection-attempt.json').exists(), 'package: already attempted; no automatic retry')
    return folder,m,capture,ca,sql

def parse(raw):
    require(len(raw.encode())<=LIMIT,'response: bounded output exceeded')
    lines=raw.strip().splitlines()
    require(len(lines)>1 and lines[:2]==['1','1'],'response: server TLS/read-only/relation guard failed')
    rows=[json.loads(x) for x in lines[2:]]
    require(len(rows)==len(SECTIONS) and {r.get('section') for r in rows}==SECTIONS,'response: missing/duplicate section')
    data={r['section']:r for r in rows};i=data['identity']
    require(i.get('database')=='postgres' and i.get('role')=='postgres' and i.get('session_role')=='postgres'
            and i.get('transaction_read_only')=='on' and i.get('default_transaction_read_only')=='on'
            and i.get('backend_ssl') is True and i.get('project') in (None,'',PROJECT)
            and 170000<=int(i.get('version',0))<180000,'response: identity/TLS/read-only mismatch')
    for s in SECTIONS-{'identity','authority','platform','fingerprints'}:
        require(isinstance(data[s].get('items'),list) and len(data[s]['items'])<=512,'response: missing/oversize inventory')
    require(isinstance(data['fingerprints'].get('items'),dict),'response: missing fingerprints')
    return data

def baseline(capture,data):
    problems=[]
    for name,old in capture['fingerprints'].items():
        if name.startswith('auth.'):
            continue  # Never reads Auth credentials/identities; coverage explicitly excluded.
        if data['fingerprints']['items'].get(name)!=old:problems.append('protected_fingerprint_changed')
    old_tables=[{k:t[k] for k in ('schema','name','owner','acl','rls','force_rls')} for t in capture['inventory']['tables'] if t['schema'] in ('public','iig_private')]
    current=[{k:t[k] for k in ('schema','name','owner','acl','rls','force_rls')} for t in data['tables']['items']]
    key=lambda t:(t['schema'],t['name'])
    if sorted(old_tables,key=key)!=sorted(current,key=key):problems.append('table_permissions_RLS_or_inventory_changed')
    funcs={f['signature']:f for f in data['functions']['items']}
    for f in capture['functions']:
        now=funcs.get(f['requested'])
        if f['exists'] is False:
            if now is not None:problems.append('original_function_presence_changed')
        else:
            old=f['meta']
            if now is None or any(now[k]!=old[k] for k in ('definition','owner','acl_raw','settings','security_definer')):
                problems.append('original_function_baseline_changed')
    def old_trigger(t):return {k:t[k] for k in ('table','name','enabled','definition')}
    original=[old_trigger(t) for t in capture['inventory']['triggers'] if t['table'].startswith(('public.','iig_private.'))]
    current=[old_trigger(t) for t in data['triggers']['items']]
    if sorted(original,key=lambda t:(t['table'],t['name']))!=sorted(current,key=lambda t:(t['table'],t['name'])):
        problems.append('trigger_baseline_changed')
    oldschemas=[{k:s[k] for k in ('name','owner','acl')} for s in capture['inventory'].get('schemas',[]) if s['name'] in ('public','iig_private')]
    schemas=[{k:s[k] for k in ('name','owner','acl')} for s in (data['authority'].get('schemas') or [])]
    if not oldschemas or sorted(oldschemas,key=lambda s:s['name'])!=sorted(schemas,key=lambda s:s['name']):
        problems.append('schema_permissions_changed_or_baseline_missing')
    if sorted(capture['inventory'].get('default_acl',[]),key=lambda d:json.dumps(d,sort_keys=True))!=sorted(data['platform'].get('default_acl',[]),key=lambda d:json.dumps(d,sort_keys=True)):
        problems.append('default_permissions_changed')
    oldpol=[p for p in capture['inventory'].get('policies',[]) if p['schemaname'] in ('public','iig_private')]
    if sorted(oldpol,key=lambda p:json.dumps(p,sort_keys=True))!=sorted(data['policies']['items'],key=lambda p:json.dumps(p,sort_keys=True)):
        problems.append('policy_baseline_changed')
    return sorted(set(problems))

def report(capture,data,manifest):
    changes=baseline(capture,data)
    group=next((t for t in data['tables']['items'] if (t['schema'],t['name'])==('public','tens_in_groups')),None)
    rights=bool(group and group['effective_owner'] and data['authority'].get('database_create') and
        any(s['name']=='public' and s['create'] for s in (data['authority'].get('schemas') or [])))
    return {'project':PROJECT,'read_only_collection':'PASS','original_application_baseline':'FAIL' if changes else 'PASS',
            'baseline_change_categories':changes,'candidate_install_privileges':'PASS' if rights else 'FAIL',
            'installation':'NO-GO','existing_guard_schema':data['authority'].get('guard_schema_exists'), 'connections_attempted':1,'data_output':'fingerprints/counts only; no group records exported',
            'auth_data_compared':False,'baseline_coverage':'original application fingerprints and captured object permissions only; fresh dependencies require review','new_target_catalog_requires_review':True,'writer_controls':'UNVERIFIED',
            'session_count':len(data['writers']['items']),'backup':manifest['backup'],
            'original_PR6_rollback':'preserved; NOT an incident guard rollback',
            'recovery':'UNVERIFIED — baseline-bound incident rollback and faithful rehearsal required',
            'credential_issuance':'NOT performed; trusted TEST operator and fictional identities required',
            'owner_whole_state_and_delete':'not exempt; keep disabled until compatible protected route reviewed'}

def connect(folder,password,executable):
    folder,m,capture,ca,sql=package(folder)
    require(password,'password: empty')
    write_new(folder/'connection-attempt.json',json.dumps({'project':PROJECT,'connections_attempted':1}))
    result=subprocess.run([executable,'-X','-w','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=terse'],
        input=sql,capture_output=True,text=True,timeout=120,env=environment(ca,password))
    require(result.returncode==0,'connection: TLS/server/read-only failure; no retry; private error withheld')
    data=parse(result.stdout)
    write_new(folder/'catalog.PRIVATE.json',json.dumps(data,indent=2)+'\n')
    summary=report(capture,data,m)
    write_new(folder/'report.SANITISED.json',json.dumps(summary,indent=2)+'\n')
    require(not summary['baseline_change_categories'],'baseline: changed; STOP for private review')
    require(summary['candidate_install_privileges']=='PASS','permissions: insufficient; STOP for review')
    require(summary['existing_guard_schema'] is False,'guard schema: present or unverified; STOP for review')
    return summary

def default_paths():
    h=Path.home()
    return {'capture':h/'Downloads/imingolf-rollback/docs/pr6-test-rollback-preparation/capture.json',
            'rollback':h/'Downloads/imingolf-rollback/docs/pr6-test-rollback-preparation/rollback.TEST.sql',
            'backup':h/'Documents/ImInGolf-Backups/ImInGolf-Test-2026-10-22.dump','service':h/'.pg_service.conf',
            'out':h/'Documents/ImInGolf-TEST-Installation'/('closed-entry-readonly-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ'))}

def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    for k,v in default_paths().items():parser.add_argument('--'+k,type=Path,default=v)
    parser.add_argument('--ca',type=Path)
    parser.add_argument('--package',type=Path)
    parser.add_argument('--connect-test-readonly',choices=[PROJECT])
    args=parser.parse_args(argv);attempted=0
    try:
        if not args.connect_test_readonly:
            require(not args.package,'offline: use preparation inputs, not connection package')
            if args.ca is None:
                require(sys.stdin.isatty(),'offline: supply official TEST direct CA with --ca')
                args.ca=Path(input('Path to the official TEST direct CA downloaded from TEST dashboard (no settings changed): ').strip()).expanduser()
            out=prepare(args)
            print('PASS — OFFLINE package prepared. Database connections attempted: 0')
            print('Private package: '+str(out))
            print('STOP — request separate approval before using --connect-test-readonly. Installation NO-GO.')
            return 0
        require(args.package is not None and sys.stdin.isatty(),'connection: explicit package and interactive approval required')
        package(args.package)
        require(input('After separate approval, type TEST project reference: ').strip()==PROJECT,'connection: project confirmation mismatch')
        password=getpass.getpass('TEST postgres password (hidden, not saved): ')
        require(password,'password: empty')
        executable=shutil.which('psql');require(executable is not None,'psql missing')
        attempted=0
        try:
            connect(args.package,password,executable)
        finally:
            attempted=int((args.package.expanduser()/'connection-attempt.json').exists())
        print('PASS — bounded TEST read-only evidence collected. Installation NO-GO. Database connections attempted: 1')
        return 0
    except Stop as e:
        print('FAIL — '+str(e)+'. Database connections attempted: '+str(attempted))
    except Exception:
        print('FAIL — private validation/connection error withheld; no retry. Database connections attempted: '+str(attempted))
    return 1

if __name__=='__main__':sys.exit(main())
