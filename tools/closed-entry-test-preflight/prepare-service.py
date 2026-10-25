#!/usr/bin/env python3
"""OFFLINE only: inspect TEST service, create a strict private copy, prepare package.
Never edits the original service/certificate. No database connection option exists.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import ssl
import stat
from types import SimpleNamespace
import preflight as p

MODES={'disable','allow','prefer','require','verify-ca','verify-full'}

def source_certificate(path):
    path=Path(path).expanduser()
    p.require(not path.is_symlink() and path.is_file(),'TEST CA source: missing/unsafe file')
    info=path.stat()
    # A root CA is public, not a secret. Read-only sharing is acceptable for the
    # downloaded source; the runner receives a new owner-only copy, never this file.
    p.require(info.st_uid==os.getuid() and not stat.S_IMODE(info.st_mode)&0o022,
              'TEST CA source: owner must be you; no group/world write permission')
    p.require(0<info.st_size<=1024*1024,'TEST CA source: invalid size')
    data=path.read_bytes();text=data.decode()
    p.require('PRIVATE KEY' not in text and 'BEGIN CERTIFICATE' in text,'TEST CA source: PEM certificates only')
    ssl.create_default_context(cadata=text)
    return data

def prepare(args):
    original=p.private_file(args.service,'original TEST service')
    before=p.digest(original)
    fields=p.service_identity(original)  # exact TEST identity and override restrictions, TLS assessed below
    mode=fields.get('sslmode')
    p.require(mode is None or mode in MODES,'service: unsupported TLS setting; value withheld')
    data=source_certificate(args.ca)
    defaults=p.default_paths()
    out=defaults['out'].with_name('closed-entry-tls-offline-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ'))
    p.require(not out.exists() and not out.is_symlink() and out.parent.is_dir(),'output: new private folder required')
    p.require(not out.resolve().is_relative_to(p.ROOT),'output: must be outside repository')
    out.mkdir(mode=0o700)
    ca=out/'TEST-direct-ca.crt';p.write_new(ca,data.decode())
    p.certificate(ca)  # same strict permissions/parser as the actual runner
    profile=out/'service.TEST-direct.conf'
    text='[iig-test-only]\nhost='+p.HOST+'\nport=5432\ndbname=postgres\nuser=postgres\nsslmode=verify-full\nsslrootcert='+str(ca.resolve())+'\n'
    p.write_new(profile,text)
    p.service(profile)
    p.require(p.digest(original)==before,'original service changed during inspection; stop')
    p.write_new(out/'service-review.SANITISED.json',json.dumps({
        'project':p.PROJECT,'original_sslmode':mode if mode is not None else 'ABSENT',
        'finding':'explicit verify-full already present' if mode=='verify-full' else 'explicit verify-full missing; previous runner correctly stopped',
        'original_service_sha256':before,'original_service_changed':False,'original_certificate_changed':False,
        'downloaded_TEST_CA_sha256':hashlib.sha256(data).hexdigest(),
        'private_copy_sslmode':'verify-full','route':'explicit TEST direct only','database_connections':0,
        'installation_approved':False},indent=2)+'\n')
    args2=SimpleNamespace(**defaults,ca=ca)
    args2.service=profile;args2.out=out/'preflight-package'
    package=p.prepare(args2)
    print('Original TEST service sslmode: '+(mode if mode is not None else 'ABSENT (no explicit verification policy)'))
    print('Original service/certificate unchanged; private TEST direct copy uses verify-full.')
    print('PASS — OFFLINE package prepared. Database connections attempted: 0')
    print('Private package: '+str(package))
    print('STOP — separate approval required before any database connection.')
    return package

def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--service',type=Path,default=Path.home()/'.pg_service.conf')
    parser.add_argument('--ca',type=Path,required=True)
    args=parser.parse_args(argv)
    try:
        prepare(args);return 0
    except p.Stop as e:
        print('FAIL — '+str(e)+'. Database connections attempted: 0')
    except Exception:
        print('FAIL — offline certificate/configuration validation stopped; private details withheld. Database connections attempted: 0')
    return 1

if __name__=='__main__':raise SystemExit(main())
