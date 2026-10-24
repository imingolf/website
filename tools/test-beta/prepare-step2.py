#!/usr/bin/env python3
"""Offline export of read-only review queries. NEVER connects to PostgreSQL or runs SQL."""
import argparse
import ast
import hashlib
import json
from pathlib import Path
import subprocess
import sys

HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
REF='85e4a129da7d857c7312811af3f5ba96b264b87d'
PREFIX='docs/pr6-test-rollback-preparation/'

def source(path):
    result=subprocess.run(['git','-C',str(REPO),'show',REF+':'+PREFIX+path],capture_output=True,text=True,check=True)
    return result.stdout

def literal(source_text,name):
    matches=[node.value for node in ast.parse(source_text).body if isinstance(node,ast.Assign)
             and any(isinstance(target,ast.Name) and target.id==name for target in node.targets)]
    if len(matches)!=1: raise ValueError('Reviewed SQL literal changed: '+name)
    text=ast.literal_eval(matches[0])
    if not isinstance(text,str): raise ValueError('SQL literal is not text')
    return text

def package():
    reviewed=source('online-test/prepare-test.py')
    guard=literal(reviewed,'READ_GUARD')
    capture=source('pre-install-capture.sql')
    capture=capture.removeprefix('\\set ON_ERROR_STOP on\n')
    files={'01-original-capture.sql':'\\set ON_ERROR_STOP on\n'+guard+capture,
           '02-auth-ownership.sql':'\\set ON_ERROR_STOP on\n'+guard+literal(reviewed,'OWNERSHIP_SQL'),
           '03-beta-catalog.sql':'\\set ON_ERROR_STOP on\n'+guard+(HERE/'step2-catalog.sql').read_text().removeprefix('\\set ON_ERROR_STOP on\n')}
    for name,text in files.items():
        if 'READ ONLY' not in text or 'ON_ERROR_STOP on' not in text: raise ValueError('Missing read-only guard: '+name)
    manifest={'purpose':'PREPARED ONLY; no database connection or execution',
              'project':'nyavvwrsrxqfyhiygkgw','reviewed_preparation_commit':REF,
              'requires_connection_identity_guard':True,'installation_authorised':False,
              'sha256':{name:hashlib.sha256(text.encode()).hexdigest() for name,text in files.items()}}
    files['manifest.json']=json.dumps(manifest,indent=2)+'\n'
    return files

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--out',type=Path,required=True);args=parser.parse_args()
    if args.out.exists(): raise ValueError('Refuse to overwrite an existing review package')
    files=package();args.out.mkdir(parents=True,mode=0o700)
    for name,text in files.items():
        target=args.out/name;target.write_text(text);target.chmod(0o600)
    print('PASS — offline Step 2 query package prepared. No SQL executed; no database connection made.')
    print('Do not run these files directly: approval and the TEST service/TLS identity guard are required first.')
    print(args.out)

if __name__=='__main__':
    try: main()
    except (ValueError,OSError,subprocess.CalledProcessError) as error:
        print('FAIL — '+str(error),file=sys.stderr);sys.exit(1)
