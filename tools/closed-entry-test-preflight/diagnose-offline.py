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
        failure=folder/p.FAILURE_FILE
        has_failure=failure.exists() or failure.is_symlink()
        if not marker.exists() and not marker.is_symlink():
            return 'LOCAL_ATTEMPT_EVIDENCE_INVALID' if has_failure else 'NO_RECORDED_CONNECTION_ATTEMPT'
        attempt=p.read_json(marker,'attempt')
        p.require(attempt=={'project':p.PROJECT,'connections_attempted':1}
                  and type(attempt['connections_attempted']) is int,'attempt mismatch')
        if has_failure:
            p.require(not (folder/'catalog.PRIVATE.json').exists()
                      and not (folder/'catalog.PRIVATE.json').is_symlink()
                      and not (folder/'report.SANITISED.json').exists()
                      and not (folder/'report.SANITISED.json').is_symlink(),'conflicting evidence')
            p.require(p.private_file(failure,'failure').stat().st_size<=4096,'failure size')
            saved=p.read_json(failure,'failure')
            p.require(isinstance(saved,dict) and type(saved.get('format')) is int
                      and type(saved.get('connections_attempted')) is int
                      and saved==p.failure_record(folder,saved.get('category')),'failure mismatch')
            return saved['category']
        if (folder/'catalog.PRIVATE.json').exists():
            return 'POST_COLLECTION_FAILURE_REQUIRES_SAVED_REPORT_REVIEW'
    except Exception:
        return 'LOCAL_ATTEMPT_EVIDENCE_INVALID'
    # Missing retained diagnostics cannot be reconstructed from a marker or CA.
    # Historical packages still require their matching code/query hashes; never
    # rewrite old evidence or relax package validation to manufacture a diagnosis.
    return 'UNDETERMINED_ORIGINAL_ERROR_NOT_RETAINED'


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--package',type=Path,required=True)
    args=parser.parse_args(argv)
    print('Failure category: '+diagnose(args.package))
    return 0

if __name__=='__main__':raise SystemExit(main())
