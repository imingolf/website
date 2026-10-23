#!/usr/bin/env python3
"""FUTURE use only after separate explicit approval. Not invoked by read-only preparation."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import traceback
import importlib.util

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('test_preparation',HERE/'prepare-test.py')
pmod=importlib.util.module_from_spec(spec); spec.loader.exec_module(pmod)
require=pmod.require

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--package',type=Path,required=True)
    parser.add_argument('--approve-project',required=True)
    args=parser.parse_args(); os.umask(0o077)
    require(args.approve_project==pmod.PROJECT,'Only explicit TEST project approval is accepted')
    folder=args.package.resolve()
    manifest=json.loads((folder/'package.json').read_text())
    preflight=json.loads((folder/'report.json').read_text())
    require(manifest['project']==pmod.PROJECT and preflight['result']=='PASS'
            and preflight['migrations_executed'] is False,'Require successful read-only TEST package')
    if preflight.get('historical_checksum_missing'):
        backup=preflight.get('fresh_backup',{})
        require(backup.get('project')==pmod.PROJECT and backup.get('historical_checksum_missing') is True,
                'Missing distinct fresh TEST recovery backup evidence')
        archive=Path(backup.get('path',''))
        require(archive.is_file() and hashlib.sha256(archive.read_bytes()).hexdigest()==backup.get('sha256'),
                'Fresh TEST recovery backup missing or changed; STOP')
    controls_ok,_=pmod.writer_controls(folder/'controlled-pause.json')
    require(controls_ok,'Pause evidence expired/incomplete; repeat read-only preparation')
    expected=dict(pmod.local.MIGRATIONS)
    require([x['source'] for x in manifest['migrations']]==list(expected),'Wrong migration order')
    for item in manifest['migrations']:
        require(Path(item['file']).name==item['file'],'Unexpected package path')
        require(item['source_sha256']==expected[item['source']],'Wrong pinned migration source')
        require(hashlib.sha256((folder/item['file']).read_bytes()).hexdigest()==item['sha256'],
                'Guarded file changed since preparation')
    rollback=(folder/'rollback.TEST.sql').read_text()
    require(hashlib.sha256(rollback.encode()).hexdigest()==manifest['rollback_sha256'],'Original rollback changed')
    before=json.loads((folder/'original-capture.json').read_text())
    require(rollback==pmod.g.rollback(before),'Original rollback guards differ')
    run_dir=folder/('installation-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ'))
    run_dir.mkdir(mode=0o700)
    report={'result':'FAIL','project':pmod.PROJECT,'completed_files':[],'rollback_executed':False,
            'note':'No automatic rollback. Earlier commits remain if a later file fails.'}
    try:
        require(pmod.run(['git','-C',str(pmod.REPO),'branch','--show-current']).strip()=='pr6-test-rollback-preparation','Wrong branch')
        require(not pmod.run(['git','-C',str(pmod.REPO),'status','--porcelain','--untracked-files=no']).strip(),'Tracked edits need review')
        c=pmod.service_config(Path.home()/'.pg_service.conf')
        require({k:c[k] for k in ('host','user','sslmode')}==preflight['connection'],'TEST connection changed')
        reader=pmod.Reader(c,run_dir)
        audit_before=json.loads((folder/'preflight-audit.json').read_text())
        _,audit,_=pmod.online_checks(reader,before,audit_before)
        pmod.local.compare_supplementary(audit_before,audit)
        for item in manifest['migrations']:
            controls_ok,_=pmod.writer_controls(folder/'controlled-pause.json')
            require(controls_ok,'Writer-control window expired')
            # Same explicit validated TEST-only connection; ONLY this future command enables writes.
            info=pmod.conninfo(c).replace('default_transaction_read_only=on','default_transaction_read_only=off')
            env={k:v for k,v in os.environ.items() if not k.startswith('PG')}
            if 'password' in c: env['PGPASSWORD']=c['password']
            if 'passfile' in c: env['PGPASSFILE']=str(Path(c['passfile']).expanduser())
            sql="select set_config('iig.approved_test_project','"+pmod.PROJECT+"',false);\n"+(folder/item['file']).read_text()
            result=subprocess.run(['psql','-X','-w','-qAt','--dbname',info,'-v','ON_ERROR_STOP=1'],
                                  input=sql,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env)
            (run_dir/(item['source']+'.stdout')).write_text(result.stdout)
            (run_dir/(item['source']+'.stderr')).write_text(result.stderr)
            require(result.returncode==0,'File failed; STOP: '+item['source'])
            report['completed_files'].append(item['source'])
            captured=reader.capture('after-'+item['source'])
            require(captured['fingerprints']==before['fingerprints'],'Protected data changed; STOP')
        final=reader.audit('post-install-audit')
        require(final['rows']==audit_before['rows'] and final['sequence']==audit_before['sequence'],
                'Post-install application/Auth data or sequence changed')
        reader.verify_rls()
        report.update(result='PASS',note='TEST schema installation only. Keep writers paused pending review; original rollback remains guarded.')
    except (Exception,KeyboardInterrupt) as e:
        report['error']=str(e) or 'Interrupted; inspect execution state'
        (run_dir/'exception.txt').write_text(traceback.format_exc())
    (run_dir/'report.json').write_text(json.dumps(report,indent=2))
    text=report['result']+' — TEST installation\n'+report.get('error',report['note'])+'\nEvidence: '+str(run_dir)+'\n'
    (run_dir/'report.txt').write_text(text); print(text)
    return 0 if report['result']=='PASS' else 1

if __name__=='__main__': sys.exit(main())
