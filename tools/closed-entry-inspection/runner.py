#!/usr/bin/env python3
"""Fixed catalog-only inspection. Offline by default; no shell or SQL inputs."""
import argparse
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
from datetime import datetime, timezone

HERE = Path(__file__).resolve().parent
PROJECT = 'kzzzputsqxdntfqpprnz'
DIRECT = 'db.' + PROJECT + '.supabase.co'
SECTIONS = {'identity','functions','relations','policies','triggers','role_memberships','role_flags'}

def require(ok, message):
    if not ok:
        raise ValueError(message)

def private_file(path):
    p = Path(path).expanduser()
    require(not p.is_symlink() and p.is_file(), 'Missing or symlink private file')
    info = p.stat()
    require(info.st_uid == os.getuid() and not stat.S_IMODE(info.st_mode) & 0o077,
            'Private file must be owned by you with mode 600 or stricter')
    return p.resolve()

def configuration(path):
    p = private_file(path)
    c = json.loads(p.read_text())
    require(set(c) == {'project','host','port','database','user','ca_file'}, 'Unexpected/missing configuration field')
    require(c['project'] == PROJECT and c['host'] == DIRECT and c['port'] == 5432
            and c['database'] == 'postgres' and c['user'] == 'postgres',
            'Unapproved connection identity; direct LIVE endpoint only, no fallback')
    ca = private_file(c['ca_file'])
    require(ca.stat().st_size <= 1024*1024, 'CA file too large')
    # PEM certificates only; rejects a private key or arbitrary SSL config.
    pem = ca.read_text()
    require('PRIVATE KEY' not in pem and 'BEGIN CERTIFICATE' in pem, 'Invalid CA file')
    ssl.create_default_context(cafile=str(ca))
    c['ca_file'] = str(ca)
    return c

def approved_sql():
    sql = (HERE/'inspection.sql').read_bytes()
    manifest = json.loads((HERE/'query-manifest.json').read_text())
    require(manifest == {'sha256':hashlib.sha256(sql).hexdigest(), 'project':PROJECT},
            'Query hash/identity changed: offline review required')
    # Secondary structural check, not a general-purpose SQL sandbox.
    text = sql.decode()
    require(text.startswith('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n') and text.endswith('COMMIT;\n'),
            'Missing read-only transaction boundary')
    statements = re.sub(r"'(?:''|[^'])*'", "''", text)
    require(not re.search(r'\b(insert|update|delete|create|alter|drop|grant|revoke|copy|call|do|execute)\b', statements, re.I),
            'Unexpected write/call statement')
    require('\\' not in text and 'pg_stat_ssl' in text and 'safety_guard' in text, 'Unexpected client command/missing guard')
    return text

def environment(c, password):
    # No inherited PG*, services, passfiles, options or database URL.
    return {'PATH':os.environ.get('PATH','/usr/bin:/bin'), 'LANG':'C',
            'PGHOST':c['host'], 'PGPORT':'5432', 'PGDATABASE':'postgres', 'PGUSER':'postgres',
            'PGSSLMODE':'verify-full', 'PGSSLROOTCERT':c['ca_file'],
            'PGSERVICEFILE':'/dev/null', 'PGPASSFILE':'/dev/null',
            'PGCONNECT_TIMEOUT':'8', 'PGPASSWORD':password,
            'PGOPTIONS':'-c default_transaction_read_only=on -c statement_timeout=8000 -c lock_timeout=500 -c idle_in_transaction_session_timeout=15000'}

def parse_output(raw):
    lines = raw.strip().splitlines()
    require(lines and lines[0] == '1', 'TLS/read-only/role/version guard not confirmed')
    rows = [json.loads(line) for line in lines[1:]]
    require(len(rows) == len(SECTIONS) and {r.get('section') for r in rows} == SECTIONS,
            'Missing or unexpected evidence section')
    identity = next(r for r in rows if r['section']=='identity')
    require(identity.get('database')=='postgres' and identity.get('role')=='postgres'
            and identity.get('read_only')=='on' and identity.get('backend_ssl') is True,
            'Identity confirmation failed')
    functions = next(r['items'] for r in rows if r['section']=='functions')
    require({'get_group_state','save_group_state'} <= {r['name'] for r in functions},
            'Required RPC absent: stop for review')
    return rows

def connect(c, sql, out, password, executable):
    # Caller must separately approve mode and verified identity before this point.
    require(password, 'Empty password')
    folder = Path(out).expanduser()
    require(not folder.exists() and not folder.is_symlink(), 'Evidence folder must be new')
    require(folder.parent.is_dir(), 'Evidence parent directory must exist')
    require(not folder.resolve().is_relative_to(HERE.parents[1]), 'Evidence must be outside repository')
    folder.mkdir(mode=0o700)
    result = subprocess.run([executable,'-X','-w','-q','-A','-t','-v','ON_ERROR_STOP=1',
                             '-v','VERBOSITY=terse'], input=sql, text=True,
                            capture_output=True, timeout=45, env=environment(c,password))
    # Do not print/store stderr: it can contain connection details or query context.
    require(result.returncode == 0, 'Server/TLS/read-only inspection failed; no retry; stderr withheld')
    rows = parse_output(result.stdout)
    output = folder/'catalog-private.json'
    fd = os.open(output, os.O_WRONLY|os.O_CREAT|os.O_EXCL, 0o600)
    with os.fdopen(fd,'w') as f:
        json.dump(rows,f,indent=2)
    report = {'result':'PASS — catalog evidence collected; guard installation NOT approved',
              'connections_attempted':1,'project':PROJECT,'group_rows_read':0,
              'baseline_verified':False,'closure_enforced':False,
              'captured_at':datetime.now(timezone.utc).isoformat()}
    fd = os.open(folder/'report.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w') as f: json.dump(report,f,indent=2)

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config')
    parser.add_argument('--out')
    parser.add_argument('--connect-live-readonly', choices=[PROJECT])
    args = parser.parse_args(argv)
    attempted = 0
    try:
        sql = approved_sql()
        c = configuration(args.config) if args.config else None
        if not args.connect_live_readonly:
            print('PASS — offline package/config validation only. Database connections attempted: 0')
            return 0
        require(c and args.out, 'Explicit private config and new private evidence folder required')
        require(sys.stdin.isatty(), 'Interactive private password prompt required')
        executable = shutil.which('psql')
        require(executable is not None, 'psql missing')
        require(input('After separate approval, type the exact LIVE project reference: ').strip()==PROJECT,
                'Project confirmation failed')
        password = getpass.getpass('LIVE read-only inspection password (not stored): ')
        require(password, 'Empty password')
        attempted = 1
        connect(c,sql,args.out,password,executable)
        print('PASS — private catalog collected; installation remains NO-GO. Database connections attempted: 1')
        return 0
    except Exception:
        # Never echo exceptions from subprocess, JSON, SSL, credentials or database output.
        print('FAIL — inspection stopped; no retry. Database connections attempted: '+str(attempted))
        return 1

if __name__ == '__main__':
    sys.exit(main())
