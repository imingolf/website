#!/usr/bin/env python3
"""Separate follow-up review driver. OFFLINE by default. Never arbitrary SQL.
Connection mode requires separate approval, exact project confirmation and TTY.
The original inspection runner/query registry remain unchanged.
"""
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
from datetime import datetime,timezone
import prepare_followup as prep
import runner as original
import summarise

SECTIONS={'candidate_bindings','target_constraints_indexes','target_trigger_dependencies'}

def latest(base,pattern):
    prep.private_directory(base)
    paths=[p for p in base.iterdir() if re.fullmatch(pattern,p.name)]
    prep.require(bool(paths));return max(paths,key=lambda p:p.name)

def load_package(source,package):
    prep.private_directory(source);prep.private_directory(package)
    rows=summarise.read_private(source/'catalog-private.json');report=summarise.read_private(source/'report.json')
    sql,audit,parameters=prep.build(rows,report)
    manifest=summarise.read_private(package/'manifest.json')
    expected={'project':prep.PROJECT,'sql_sha256':prep.digest(sql),'sql_execution_authorised':False,
       'connection_runner_included':False,
       'template_sha256':prep.digest((prep.HERE/'followup/catalog.READONLY.sql.in').read_text()),
       'source_capture_sha256':prep.digest((source/'catalog-private.json').read_text())}
    prep.require(manifest==expected)
    original.private_file(package/'catalog.READONLY.REVIEW.sql')
    prep.require((package/'catalog.READONLY.REVIEW.sql').read_text()==sql)
    prep.require(summarise.read_private(package/'request-parameters.PRIVATE.json')==parameters)
    prep.require(summarise.read_private(package/'audit.SANITISED.json')==audit)
    return sql,parameters

def parse(raw,parameters):
    lines=raw.strip().splitlines()
    prep.require(len(raw.encode())<=16*1024*1024)
    prep.require(lines[:4]==['1']*4 and len(lines)==7)
    rows=[json.loads(x) for x in lines[4:]]
    prep.require({x.get('section') for x in rows}==SECTIONS)
    parts={x['section']:x for x in rows}
    candidates=parts['candidate_bindings'];items=candidates['items']
    prep.require(candidates.get('within_reviewed_limit') is True and type(candidates.get('count')) is int
                 and candidates['count']==len(items) and 1<=len(items)<=200)
    targets=parts['target_constraints_indexes']['items'];triggers=parts['target_trigger_dependencies']['items']
    prep.require(isinstance(targets,list) and isinstance(triggers,list))
    prep.require(len(targets)==len(parameters['table_oids']) and {prep.oid(x['table_oid']) for x in targets}==set(parameters['table_oids']))
    prep.require(all(prep.oid(x['table_oid']) in parameters['table_oids'] for x in triggers))
    present={prep.oid(x['oid']) for x in items}|{prep.oid(x['function_oid']) for x in triggers}
    prep.require(set(parameters['function_oids'])<=present)
    return rows

def execute(config,sql,parameters,out,password,executable):
    prep.require(bool(password))
    # Exact same scrubbed direct-LIVE libpq environment and verify-full as original.
    result=subprocess.run([executable,'-X','-w','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=terse'],
        input=sql,text=True,capture_output=True,timeout=45,env=original.environment(config,password))
    prep.require(result.returncode==0)  # Raw stderr is never echoed or persisted.
    rows=parse(result.stdout,parameters)
    report={'result':'PASS — bounded catalog follow-up collected; installation remains NO-GO',
        'project':prep.PROJECT,'connections_attempted':1,'group_records_read':0,
        'captured_function_attributes_trigger_definitions_target_fingerprints_match':True,'server_version_matches_saved_capture':True,
        'function_binding_review_complete':False,'trigger_effect_review_complete':False}
    prep.write_new(out,{'catalog-followup.PRIVATE.json':json.dumps(rows,indent=2)+'\n',
                        'report.SANITISED.json':json.dumps(report,indent=2)+'\n'})

def main(argv=None):
    p=prep.QuietParser(description=__doc__)
    p.add_argument('--saved-folder',type=Path);p.add_argument('--package',type=Path)
    p.add_argument('--config',type=Path);p.add_argument('--out',type=Path)
    p.add_argument('--connect-live-followup-readonly',choices=[prep.PROJECT])
    a=p.parse_args(argv);attempted=0
    try:
        base=Path.home()/'Documents/ImInGolf-LIVE-Inspection'
        source=a.saved_folder.expanduser() if a.saved_folder else latest(base,r'readonly-\d{8}T\d{6}Z')
        package=a.package.expanduser() if a.package else latest(base,r'followup-review-\d{8}T\d{6}\.\d{6}Z')
        sql,parameters=load_package(source,package)
        config=original.configuration(a.config) if a.config else None
        if not a.connect_live_followup_readonly:
            print('PASS — follow-up scope/hash validated OFFLINE. Configuration validated: '+str(config is not None)+'. Database connections attempted: 0')
            return 0
        prep.require(config is not None and sys.stdin.isatty())
        executable=shutil.which('psql');prep.require(executable is not None)
        out=a.out.expanduser() if a.out else base/('followup-readonly-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ'))
        prep.require(not out.exists() and not out.is_symlink() and out.parent.is_dir())
        prep.require(not out.absolute().is_relative_to(prep.REPO) and not out.resolve().is_relative_to(prep.REPO))
        prep.require(input('After separate approval, type the exact LIVE project reference: ').strip()==prep.PROJECT)
        prep.require(input('Type READ-ONLY FOLLOWUP to confirm the reviewed metadata-only scope: ').strip()=='READ-ONLY FOLLOWUP')
        password=original.getpass.getpass('LIVE follow-up password (not stored): ');prep.require(bool(password))
        attempted=1
        execute(config,sql,parameters,out,password,executable)
        print('PASS — bounded catalog follow-up saved privately; installation NO-GO. Database connections attempted: 1')
        return 0
    except Exception:
        print('STOP — follow-up validation/connection failed; no retry or raw diagnostics. Database connections attempted: '+str(attempted),file=sys.stderr)
        return 1
if __name__=='__main__':sys.exit(main())
