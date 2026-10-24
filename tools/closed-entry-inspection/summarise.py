#!/usr/bin/env python3
"""Sanitise SAVED incident evidence only. No network, subprocess or SQL execution."""
import argparse
import json
import os
from pathlib import Path
import re
import stat
import sys

PROJECT='kzzzputsqxdntfqpprnz'
NAMES={'get_group_state','save_group_state','owner_update_group','owner_create_group',
       'owner_list_groups','create_group','reset_group','finish_round','start_round',
       'confirm_payment','join_round','submit_score','set_admin_pin','owner_reset_admin_pin',
       'owner_delete_group','create_golf_group'}
ROLES={'postgres','anon','authenticated','service_role'}
SECTIONS={'identity','functions','relations','policies','triggers','role_memberships','role_flags'}

def require(ok):
    if not ok: raise ValueError('Evidence format or private-file validation failed')

def boolean(value):
    require(type(value) is bool)
    return value

def signals(text):
    require(isinstance(text,str))
    # References only, potentially in comments/literals; never proof of enforcement.
    patterns={
      'auth_uid_reference':r'auth\s*\.\s*uid\s*\(',
      'jwt_or_role_reference':r'request\.jwt|auth\s*\.\s*role\s*\(|current_user|session_user',
      'group_pin_reference':r'\bp_pin\b|pin_hash',
      'creation_code_reference':r'creation_code',
      'admin_pin_reference':r'admin_?pin',
      'row_lock_reference':r'for\s+(?:no\s+key\s+)?update',
      'advisory_lock_reference':r'pg_advisory',
      'closure_reference':r'entries.?closed|entry.?closed|round.?locked|closed_at',
      'score_reference':r'stableford|netScore|net_score|noReturn|currentTeamScores',
      'payment_reference':r'\bpaid\b|payment',
      'round_transition_reference':r'roundId|round_id|roundOpen|round_open|finish_round|start_round',
      'history_reference':r'\bhistory\b',
      'dynamic_sql_reference':r'\bexecute\b',
      'whole_state_assignment_reference':r'\bstate\s*=\s*p_state\b'
    }
    return {key:bool(re.search(pattern,text,re.I)) for key,pattern in patterns.items()}

def summarise(rows,report):
    require(isinstance(report,dict) and report.get('project')==PROJECT
            and report.get('connections_attempted')==1 and report.get('group_rows_read')==0)
    require(isinstance(rows,list) and len(rows)==len(SECTIONS)
            and all(isinstance(x,dict) for x in rows)
            and {x.get('section') for x in rows}==SECTIONS)
    sections={x['section']:x for x in rows};identity=sections['identity']
    require(identity.get('database')=='postgres' and identity.get('role')=='postgres'
            and identity.get('read_only')=='on' and identity.get('backend_ssl') is True)
    for name in SECTIONS-{'identity'}:require(isinstance(sections[name].get('items'),list))
    functions=[]
    for f in sections['functions']['items']:
        require(f.get('name') in NAMES)
        functions.append({'name':f['name'],'owner_is_postgres':f.get('owner')=='postgres',
          'security_definer':boolean(f.get('security_definer')),
          'configuration_present':bool(f.get('configuration')),
          'acl_is_null':f.get('acl') is None,
          'execute':{role:boolean(f.get(role+'_execute')) for role in ('anon','authenticated','service_role')},
          'references_NOT_proof':signals(f.get('definition'))})
    require({'get_group_state','save_group_state'} <= {x['name'] for x in functions})
    tables=[]
    for t in sections['relations']['items']:
        if t.get('name')!='tens_in_groups' or t.get('schema')!='public':continue
        access=[]
        for a in t.get('effective_access',[]):
            require(a.get('role') in ROLES)
            access.append({'role':a['role'],**{p:boolean(a.get(p)) for p in ('schema_usage','select','insert','update','delete')}})
        tables.append({'owner_is_postgres':t.get('owner')=='postgres',
          'rls':boolean(t.get('rls')),'force_rls':boolean(t.get('force_rls')),
          'acl_is_null':t.get('acl') is None,'effective_access':access,
          'columns_with_explicit_acl':sum(c.get('acl') is not None for c in t.get('columns',[]))})
    triggers=[]
    for t in sections['triggers']['items']:
        if t.get('schema')=='public' and t.get('table')=='tens_in_groups':
            triggers.append({'enabled_normal':t.get('enabled') in ('O','A'),
              'security_definer':boolean(t.get('security_definer')),
              'references_NOT_proof':signals(t.get('function_definition'))})
    flags=[]
    for role in sections['role_flags']['items']:
        require(role.get('role') in ROLES)
        flags.append({'role':role['role'],**{k:boolean(role.get(k)) for k in ('superuser','inherit','bypass_rls')}})
    return {'summary_version':1,'project':PROJECT,'saved_inspection_identity_passed':True,
      'new_connections_attempted':0,'group_records_read':0,
      'functions':functions,'public_tens_in_groups':tables,
      'group_trigger_indicators':triggers,
      'group_policy_count':sum(p.get('schemaname')=='public' and p.get('tablename')=='tens_in_groups' for p in sections['policies']['items']),
      'role_flags':flags,
      'organiser_authority':'UNVERIFIED — lexical references are not enforcement proof',
      'closure_enforcement':'UNVERIFIED — manual control-flow/dependency review required',
      'release_decision':'NO-GO pending authority, atomic guard, recovery and regression review'}

def read_private(path):
    require(not path.is_symlink() and path.is_file())
    info=path.stat()
    require(info.st_uid==os.getuid() and not stat.S_IMODE(info.st_mode)&0o077 and info.st_size<=16*1024*1024)
    return json.loads(path.read_text())

def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--folder',type=Path)
    args=parser.parse_args(argv)
    try:
        base=Path.home()/'Documents/ImInGolf-LIVE-Inspection'
        if args.folder:
            folder=args.folder.expanduser()
        else:
            require(base.is_dir() and not base.is_symlink())
            candidates=[p for p in base.iterdir() if re.fullmatch(r'readonly-\d{8}T\d{6}Z',p.name)]
            require(bool(candidates));folder=max(candidates,key=lambda p:p.name)
        require(folder.is_dir() and not folder.is_symlink())
        info=folder.stat();require(info.st_uid==os.getuid() and not stat.S_IMODE(info.st_mode)&0o077)
        result=summarise(read_private(folder/'catalog-private.json'),read_private(folder/'report.json'))
        print(json.dumps(result,indent=2,sort_keys=True))
        return 0
    except Exception:
        print('STOP — saved evidence missing, incompatible or not private; no raw contents displayed.',file=sys.stderr)
        return 1

if __name__=='__main__':sys.exit(main())
