"""Load selected pure comparison/generator functions from the immutable reviewed Git commit.
No reference main(), Docker methods, installer, SQL executor or network code is loaded.
"""
import ast
import json
from pathlib import Path
import subprocess
import types

REF='85e4a129da7d857c7312811af3f5ba96b264b87d'
REPO=Path(__file__).resolve().parents[2]
PREFIX='docs/pr6-test-rollback-preparation/'

def require(ok,message):
    if not ok: raise ValueError(message)

def source(name):
    r=subprocess.run(['git','-C',str(REPO),'show',REF+':'+PREFIX+name],capture_output=True,check=False)
    require(r.returncode==0,'Pinned review source missing; fetch the rollback-preparation Git source before proceeding')
    return r.stdout.decode('utf-8')

def selected(text,functions,constants):
    tree=ast.parse(text);body=[];found=set()
    for node in tree.body:
        if isinstance(node,ast.FunctionDef) and node.name in functions:
            require(not node.decorator_list,'Unexpected reference decorator');body.append(node);found.add(node.name)
        elif isinstance(node,ast.Assign):
            names=[n.id for n in node.targets if isinstance(n,ast.Name)]
            if len(names)==1 and names[0] in constants:
                ast.literal_eval(node.value);body.append(node);found.add(names[0])
    require(found==set(functions)|set(constants),'Incomplete reviewed helper selection')
    namespace={'json':json,'require':require}
    exec(compile(ast.Module(body=body,type_ignores=[]),'<reviewed-pure-helpers>','exec'),namespace)
    return types.SimpleNamespace(**{k:namespace[k] for k in found})

def helpers():
    generator=selected(source('prepare.py'),{'lit','ident','fingerprint','capture_sql','rollback'},
                       {'PROJECT','REQUIRED','OPTIONAL','NEW','TABLES','GUARDED','TRIGGERS'})
    compare=selected(source('local-rehearsal/run-rehearsal.py'),
       {'normalized','function_map','compare_baseline','supplementary_records','compare_supplementary'},
       {'INVENTORIES','MIGRATIONS','COMMIT'})
    return generator,compare
