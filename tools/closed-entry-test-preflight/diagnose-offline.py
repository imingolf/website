#!/usr/bin/env python3
"""Read existing failed-package evidence only; no subprocess, network or SQL execution.
Emits one fixed category. No passwords, paths, private definitions or raw exceptions.
"""
import argparse
import hashlib
from pathlib import Path
import stat
import preflight as p


def diagnose(folder):
    folder=Path(folder).expanduser()
    try:
        p.require(not folder.is_symlink() and folder.is_dir() and folder.stat().st_uid==p.os.getuid()
                  and not stat.S_IMODE(folder.stat().st_mode)&0o077,'private folder')
        m=p.read_json(folder/'manifest.PRIVATE.json','manifest')
        p.require(m.get('project')==p.PROJECT and m.get('mode')=='READONLY_REVIEW_NOT_INSTALLABLE'
                  and m.get('code_hashes')==p.code_hashes(),'package identity/code drift')
        p.require(set(m.get('input_paths',{}))=={'capture','rollback','backup','service','ca'},'input scope')
        for key,path in m['input_paths'].items():
            p.require(p.digest(p.private_file(path,key))==m['input_hashes'][key],'input drift')
    except Exception:
        return 'LOCAL_PACKAGE_OR_INPUT_VALIDATION_FAILED'
    try:
        p.service(m['input_paths']['service'])
    except Exception:
        return 'LOCAL_TEST_SERVICE_CONFIGURATION_INVALID'
    try:
        p.certificate(m['input_paths']['ca'])
    except Exception:
        return 'LOCAL_CA_CONFIGURATION_INVALID'
    try:
        capture=p.read_json(m['input_paths']['capture'],'capture')
        sql=p.build_sql(capture)
        p.require(p.private_file(folder/'inspection.READONLY.sql','query').read_text()==sql
                  and hashlib.sha256(sql.encode()).hexdigest()==m['sql_sha256'],'query drift')
    except Exception:
        return 'LOCAL_QUERY_OR_BASELINE_VALIDATION_FAILED'
    try:
        marker=folder/'connection-attempt.json'
        if not marker.exists():return 'NO_RECORDED_CONNECTION_ATTEMPT'
        attempt=p.read_json(marker,'attempt')
        p.require(attempt=={'project':p.PROJECT,'connections_attempted':1},'attempt mismatch')
        if (folder/'catalog.PRIVATE.json').exists():
            return 'POST_COLLECTION_FAILURE_REQUIRES_SAVED_REPORT_REVIEW'
    except Exception:
        return 'LOCAL_ATTEMPT_EVIDENCE_INVALID'
    # preflight.connect discarded stderr/stdout on nonzero psql exit. A marker
    # confirms an attempted command, not successful transport, authentication or TLS.
    # Local CA parsing cannot reconstruct a remote handshake/authentication outcome.
    return 'UNDETERMINED_ORIGINAL_ERROR_NOT_RETAINED'


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--package',type=Path,required=True)
    args=parser.parse_args(argv)
    print('Failure category: '+diagnose(args.package))
    return 0

if __name__=='__main__':raise SystemExit(main())
