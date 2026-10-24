#!/usr/bin/env python3
"""OFFLINE audit/export only. Reads saved catalog, writes a new private review package.
No DB client, subprocess, network, credentials, SQL execution or connection option.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import classify_saved_calls as classifier
import summarise

HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
PROJECT=summarise.PROJECT
SAFE_PART=re.compile(r'^[a-z_][a-z0-9_$]{0,62}$')
SQL_SYNTAX={'coalesce','nullif','greatest','least','extract','substring','position'}
KNOWN_TYPES={'text','uuid','integer','bigint','jsonb','boolean','timestamp with time zone','timestamp without time zone'}

def require(condition):
    if not condition:raise ValueError('Offline evidence/parameter validation failed')

def digest(text):return hashlib.sha256(text.encode()).hexdigest()

def pg_json(value):
    # JSONB text key order is byte-length then byte order; values here contain
    # catalog arrays/nulls/strings/bools only, never raw group records or credentials.
    def ordered(x):
        if isinstance(x,dict):return {k:ordered(x[k]) for k in sorted(x,key=lambda k:(len(k.encode()),k.encode()))}
        if isinstance(x,list):return [ordered(i) for i in x]
        return x
    return json.dumps(ordered(value),ensure_ascii=False,separators=(', ',': '))

def oid(value):
    # PostgreSQL may serialise oid values as decimal JSON strings. Accept only
    # bounded digits, never SQL fragments, booleans, floats or arbitrary casts.
    if isinstance(value,str):
        require(bool(re.fullmatch(r'[1-9][0-9]{0,9}',value)))
        value=int(value)
    require(type(value) is int and 0<value<2**32)
    return value

def safe_name(value):
    require(isinstance(value,str) and bool(SAFE_PART.fullmatch(value)))
    return value

def boolean(value):
    require(type(value) is bool);return value

def array_or_null(value):
    require(value is None or isinstance(value,list) and all(isinstance(x,str) for x in value));return value

def literal(value):
    # SQL quoting, not shell interpolation; standard_conforming_strings is pinned.
    require(isinstance(value,str) and '\x00' not in value)
    return "'"+value.replace("'","''")+"'"

def sql_value(value):
    if value is None:return 'NULL::boolean'
    if type(value) is bool:return 'true' if value else 'false'
    if type(value) is int:return str(oid(value))
    require(isinstance(value,str));return literal(value)

def values(rows):
    require(bool(rows));return 'VALUES\n '+',\n '.join('('+','.join(sql_value(x) for x in row)+')' for row in rows)

def build(rows,report):
    summarise.summarise(rows,report)
    sections={x['section']:x for x in rows}
    server_version=sections['identity'].get('version')
    require(isinstance(server_version,str) and bool(re.match(r'^17\.\d+',server_version)))
    relations={oid(t['oid']):{**t,'oid':oid(t['oid'])} for t in sections['relations']['items']}
    functions=sections['functions']['items'];triggers=sections['triggers']['items']
    require(0<len(functions)<=32)
    require(any(t.get('schema')=='public' and t.get('name')=='tens_in_groups' for t in relations.values()))
    by_name={}
    for t in relations.values():
        key=classifier.normalise(t['schema']+'.'+t['name']);by_name.setdefault(key,[]).append(t)
    selected={}
    # Root table plus write targets of selected RPCs and reachable row triggers.
    for t in relations.values():
        if t['schema']=='public' and t['name']=='tens_in_groups':selected[t['oid']]=t
    bodies=[(f['definition'],f.get('configuration')) for f in functions]
    reachable_triggers=[];seen_triggers=set()
    while bodies:
        text,configuration=bodies.pop(0)
        calls,effects,quoted,dynamic=classifier.extract_calls(text)
        require(not quoted and not dynamic)  # No guessed resolution of dynamic SQL.
        for operation,target in effects:
            if '.' in target:
                candidates=by_name.get(target,[])
            else:
                candidates=[t for t in relations.values() if classifier.normalise(t['name'])==target]
            require(bool(candidates))  # Unknown target needs offline scope review, not a wider query.
            for t in candidates:selected[t['oid']]=t
        require(len(selected)<=12)
        for t in triggers:
            matches=[r for r in selected.values() if r['schema']==t.get('schema') and r['name']==t.get('table')]
            key=(t.get('schema'),t.get('table'),t.get('name'))
            if matches and key not in seen_triggers:
                seen_triggers.add(key);reachable_triggers.append((matches[0],t))
                require(len(reachable_triggers)<=32)
                bodies.append((t['function_definition'],t.get('configuration')))
    require(bool(reachable_triggers))
    fseeds={}
    def add_function(ident,definition,owner,config,acl,definer,execs):
        ident=oid(ident)
        require(isinstance(definition,str) and isinstance(owner,str))
        seed=(oid(ident),digest(definition),digest(owner),digest(pg_json(array_or_null(config))),
              digest(pg_json(array_or_null(acl))),boolean(definer),*execs)
        if ident in fseeds:
            require(fseeds[ident][:6]==seed[:6])
        else:fseeds[ident]=seed
    for f in functions:
        add_function(f['oid'],f['definition'],f['owner'],f.get('configuration'),f.get('acl'),f['security_definer'],
                     tuple(boolean(f[k]) for k in ('anon_execute','authenticated_execute','service_role_execute')))
    tseeds=[]
    for table,t in reachable_triggers:
        require(isinstance(t.get('name'),str) and isinstance(t.get('definition'),str))
        require(t.get('enabled') in ('O','D','R','A'))
        tseeds.append((table['oid'],digest(t['name']),digest(t['definition']),t['enabled'],oid(t['function_oid'])))
        add_function(t['function_oid'],t['function_definition'],t['owner'],t.get('configuration'),t.get('acl'),t['security_definer'],(None,None,None))
    require(len(fseeds)<=64)
    tables=[]
    for t in selected.values():
        columns=t.get('columns');require(isinstance(columns,list))
        for col in columns:require(set(col)=={'name','type','acl'})
        tables.append((digest(t['schema']),digest(t['name']),t['oid'],digest(t['owner']),
          digest(pg_json(array_or_null(t.get('acl')))),digest(pg_json(array_or_null(t.get('schema_acl')))),
          boolean(t['rls']),boolean(t['force_rls']),digest(pg_json(columns)),
          str(sum(1 for tr in triggers if tr.get('schema')==t['schema'] and tr.get('table')==t['name']))))
    names=set();schemas={'pg_catalog','public','extensions','iig_private'}
    source_texts=[(f['definition'],f.get('configuration')) for f in functions]+[(t['function_definition'],t.get('configuration')) for _,t in reachable_triggers]
    for definition,config in source_texts:
        calls,effects,quoted,dynamic=classifier.extract_calls(definition);require(not quoted and not dynamic)
        for call in calls:
            parts=call.split('.');require(len(parts) in (1,2));[safe_name(x) for x in parts]
            if len(parts)==2:schemas.add(parts[0])
            if parts[-1] not in SQL_SYNTAX:names.add(parts[-1])
        for setting in config or []:
            if setting.startswith('search_path='):
                for n in setting.split('=',1)[1].split(','):
                    normal=classifier.normalise(n.strip())
                    # $user/complex identifiers need explicit private review.
                    schemas.add(safe_name(normal))
    # Include source routine names to refresh exact signatures/namespace rights, not all application routines.
    for f in functions:names.add(safe_name(f['name']));schemas.add(safe_name(f['schema']))
    require(0<len(names)<=80 and len(schemas)<=10)
    template=(HERE/'followup/catalog.READONLY.sql.in').read_text()
    template_manifest=json.loads((HERE/'followup/template-manifest.json').read_text())
    require(template_manifest=={'project':PROJECT,'sha256':digest(template),'execution_authorised':False})
    replacements={
      'FUNCTION_BASELINE':values(list(fseeds.values())),
      'TRIGGER_BASELINE':values(tseeds),
      'TABLE_BASELINE':values(tables),
      'CALL_NAMES':values([(n,) for n in sorted(names)]),
      'SCHEMAS':values([(n,) for n in sorted(schemas)]),
      'TABLE_OIDS':values([(n,) for n in sorted(selected)]),
      'FUNCTION_OIDS':values([(n,) for n in sorted(fseeds)]),
      'SERVER_VERSION_SHA':literal(digest(server_version))}
    sql=template
    for key,value in replacements.items():sql=sql.replace('/*__'+key+'__*/',value)
    require('/*__' not in sql)
    analysis=classifier.classify(rows)
    group=next(t for t in relations.values() if t['schema']=='public' and t['name']=='tens_in_groups')
    shared={
      'audit_version':1,'project':PROJECT,'new_database_connections':0,'group_records_read':0,
      'saved_evidence':{
        'server_version':re.match(r'^17\.\d+',server_version)[0],
        'routine_search_paths':[{'routine':r['routine'],**r['search_path']} for r in analysis['routines']],
        'owner_guard_sketches_NOT_proof':[{'routine':f['name'],'control_flow':classifier.review_saved.sketch(f['definition'])['control_flow_NOT_proof']}
           for f in functions if f['name'].startswith('owner_') or f['name']=='create_golf_group'],
        'group_table_columns':[{'name':c['name'],'type':c['type'] if c['type'] in KNOWN_TYPES else 'custom_or_other_type'}
          for c in group['columns'] if c['name'] in {'id','state','pin_hash','group_pin','updated_at'}],
        'reachable_captured_trigger_count':len(reachable_triggers),
        'target_relation_count':len(selected),
        'creation_helper_classification':next((r['calls'] for r in analysis['routines'] if r['routine']=='create_golf_group'),[])
      },
      'not_in_original_capture':['full candidate overload/extension bindings','target indexes and constraints','complete type/default/generated-column metadata'],
      'planned_scope':{'source_routines':len(fseeds),'target_tables':len(selected),'call_names':len(names),'schemas':len(schemas)},
      'another_current_catalog_review_needed_before_installation':True,
      'actual_binding_verified':False,'trigger_effects_verified':False,
      'release':'NO-GO; packet is review-only and does not authorise a connection'}
    parameters={'function_oids':sorted(fseeds),'table_oids':sorted(selected),'routine_names':sorted(names),'schemas':sorted(schemas)}
    return sql,shared,parameters

def private_directory(path):
    require(path.is_dir() and not path.is_symlink())
    info=path.stat();require(info.st_uid==os.getuid() and not stat.S_IMODE(info.st_mode)&0o077)

def write_new(folder,items):
    require(not folder.exists() and not folder.is_symlink() and folder.parent.is_dir())
    require(not folder.absolute().is_relative_to(REPO) and not folder.resolve().is_relative_to(REPO))
    folder.mkdir(mode=0o700)
    for name,text in items.items():
        fd=os.open(folder/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,'w') as f:f.write(text)

class QuietParser(argparse.ArgumentParser):
    def error(self,message):
        self.exit(2,'STOP — unsupported offline arguments; no connection option exists.\n')

def main(argv=None):
    p=QuietParser(description=__doc__)
    p.add_argument('--saved-folder',type=Path);p.add_argument('--out',type=Path);args=p.parse_args(argv)
    try:
        base=Path.home()/'Documents/ImInGolf-LIVE-Inspection'
        if args.saved_folder:source=args.saved_folder.expanduser()
        else:
            private_directory(base)
            candidates=[x for x in base.iterdir() if re.fullmatch(r'readonly-\d{8}T\d{6}Z',x.name)]
            require(bool(candidates));source=max(candidates,key=lambda x:x.name)
        private_directory(source)
        rows=summarise.read_private(source/'catalog-private.json');report=summarise.read_private(source/'report.json')
        sql,shared,parameters=build(rows,report)
        out=args.out.expanduser() if args.out else base/('followup-review-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ'))
        manifest={'project':PROJECT,'sql_sha256':digest(sql),'sql_execution_authorised':False,
          'connection_runner_included':False,'template_sha256':digest((HERE/'followup/catalog.READONLY.sql.in').read_text()),'source_capture_sha256':digest((source/'catalog-private.json').read_text())}
        write_new(out,{'catalog.READONLY.REVIEW.sql':sql,'request-parameters.PRIVATE.json':json.dumps(parameters,indent=2)+'\n',
          'audit.SANITISED.json':json.dumps(shared,indent=2)+'\n','manifest.json':json.dumps(manifest,indent=2)+'\n'})
        print(json.dumps(shared,indent=2));print('PASS — offline audit/review package prepared. Database connections attempted: 0')
        return 0
    except Exception:
        print('STOP — offline evidence/scope validation failed; no raw names, paths or values displayed.',file=sys.stderr);return 1
if __name__=='__main__':sys.exit(main())
