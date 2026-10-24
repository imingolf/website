#!/usr/bin/env python3
"""Classify calls in saved incident evidence, never connect or execute SQL.
Exports only fixed built-in spellings and anonymous identifiers. Not a SQL resolver.
"""
import argparse
import json
import os
from pathlib import Path
import re
import stat
import sys
import summarise
import review_saved

# PostgreSQL-documented built-in spellings only; unqualified spelling is not proof
# of actual overload/search_path resolution. public.now is NOT pg_catalog.now.
BUILTINS=set('now clock_timestamp statement_timestamp transaction_timestamp current_setting set_config coalesce nullif greatest least jsonb_array_elements jsonb_array_elements_text jsonb_each jsonb_each_text jsonb_object_keys jsonb_array_length jsonb_typeof jsonb_build_object jsonb_build_array jsonb_agg jsonb_object_agg jsonb_set jsonb_insert jsonb_strip_nulls jsonb_path_query jsonb_path_exists to_jsonb to_json row_to_json json_build_object json_agg json_array_elements json_array_length array_agg array_length array_position array_append cardinality unnest string_agg format format_type quote_ident quote_literal quote_nullable pg_get_functiondef pg_get_triggerdef pg_get_userbyid lower upper length char_length octet_length trim btrim ltrim rtrim replace regexp_replace regexp_match split_part concat concat_ws substring substr left right position extract date_part date_trunc to_timestamp to_date to_char make_interval round trunc ceil ceiling floor abs sum count min max avg bool_and bool_or gen_random_uuid md5 sha256 encode decode convert_to pg_advisory_xact_lock pg_try_advisory_xact_lock pg_backend_pid txid_current pg_current_xact_id pg_notify has_function_privilege has_table_privilege'.split())
SYNTAX=set('if in exists values case over partition filter select as using return when raise table numeric decimal varchar char character timestamp time bit interval conflict key primary unique check precision'.split())
SIDE_EFFECT_BUILTINS={'set_config','pg_notify','pg_advisory_xact_lock','pg_try_advisory_xact_lock'}
ID=r'(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z_0-9$]*)(?:\s*\.\s*(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z_0-9$]*))*'

def normalise(identifier):
    return '.'.join(part.strip().strip('"').replace('""','"').lower() for part in identifier.split('.'))

def mask_values(text):
    """Mask comments/literals, retaining quoted identifiers privately for matching."""
    text=review_saved.body(text);out=list(text);i=0;dynamic=False
    while i<len(text):
        start=i
        if text.startswith('--',i):
            end=text.find('\n',i+2);i=len(text) if end<0 else end
        elif text.startswith('/*',i):
            depth=1;i+=2
            while i<len(text) and depth:
                if text.startswith('/*',i):depth+=1;i+=2
                elif text.startswith('*/',i):depth-=1;i+=2
                else:i+=1
            if depth:raise ValueError('Unterminated comment')
        elif text[i]=="'":
            i+=1
            while i<len(text):
                if text[i]=='\\':i+=2;continue
                if text[i]=="'":
                    if i+1<len(text) and text[i+1]=="'":i+=2;continue
                    i+=1;break
                i+=1
            else:raise ValueError('Unterminated literal')
        else:
            dollar=re.match(r'\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$',text[i:])
            if dollar:
                end=text.find(dollar[0],i+len(dollar[0]))
                if end<0:raise ValueError('Unterminated dollar literal')
                i=end+len(dollar[0]);dynamic=True
            elif text[i]=='"':
                quoted=re.match(r'"(?:[^"]|"")+"',text[i:])
                if not quoted:raise ValueError('Unterminated identifier')
                i+=len(quoted[0]);continue
            else:i+=1;continue
        for k in range(start,min(i,len(out))):
            if out[k]!='\n':out[k]=' '
    return ''.join(out),dynamic

def extract_calls(text):
    source,dynamic=mask_values(text);calls=[]
    for match in re.finditer(ID+r'\s*\(',source):
        raw=re.match(ID,match[0])[0];name=normalise(raw)
        if name in SYNTAX:continue
        prefix=source[:match.start()].rstrip()
        # INSERT INTO table(columns), WITH name(columns) etc are not helper calls.
        if re.search(r'\b(?:into|table|with)\s*$',prefix,re.I):continue
        if name not in calls:calls.append(name)
    effects=[]
    for match in re.finditer(r'\b(insert\s+into|update|delete\s+from)\s+('+ID+r')',source,re.I):
        operation=match[1].lower().split()[0]
        if operation=='update' and normalise(match[2]) in {'set','of'}:continue
        effects.append((operation,normalise(match[2])))
    return calls,effects,dynamic,bool(re.search(r'\bexecute\b',source,re.I))

def search_path_summary(configuration):
    values=[] if configuration is None else configuration
    if not isinstance(values,list):raise ValueError('Invalid routine configuration')
    matches=[x.split('=',1)[1] for x in values if isinstance(x,str) and x.startswith('search_path=')]
    if not matches:return {'fixed_path_present':False,'catalog_precedence':'caller_inherited_unverified','resolution_verified':False}
    if len(matches)!=1:raise ValueError('Ambiguous routine configuration')
    names=[normalise(x.strip()) for x in matches[0].split(',')]
    # Never reflect arbitrary schema names or any other configuration values.
    if 'pg_catalog' not in names:mode='implicit_catalog_first'
    elif all(x=='pg_temp' for x in names[:names.index('pg_catalog')]):mode='explicit_catalog_first_for_functions'
    else:mode='other_schema_precedes_catalog'
    return {'fixed_path_present':True,'catalog_precedence':mode,
            'has_nonstandard_schema':any(x not in {'pg_catalog','public','pg_temp','iig_private'} for x in names),
            'resolution_verified':False}

def target_metadata(rows,key):
    matches=[x for section in rows if section.get('section')=='relations' for x in section.get('items',[])
             if normalise(x.get('schema','')+'.'+x.get('name',''))==key]
    if len(matches)!=1:return {'relation_metadata_available':False,'constraint_index_evidence_available':False}
    table=matches[0];columns={x.get('name','').lower() for x in table.get('columns',[])}
    return {'relation_metadata_available':True,'owner_is_postgres':table.get('owner')=='postgres',
            'rls_enabled':table.get('rls') is True,'force_rls':table.get('force_rls') is True,
            'column_count':len(columns),
            'notification_column_pattern_NOT_proof':{'title','body'} <= columns,
            'status_column_pattern_NOT_proof':bool(columns & {'enabled','status'}),
            'payment_column_pattern_NOT_proof':bool(columns & {'amount','paid','payment_status'}),
            'history_column_pattern_NOT_proof':bool(columns & {'history','round_id','round_state'}),
            'captured_noninternal_trigger_count':sum(1 for section in rows if section.get('section')=='triggers'
              for t in section.get('items',[]) if normalise(t.get('schema','')+'.'+t.get('table',''))==key),
            'constraint_index_evidence_available':False}

def captured(rows):
    result=[]
    for section in rows:
        if section['section']=='functions':
            for f in section['items']:
                if f['name'] not in summarise.NAMES:raise ValueError('Unexpected routine')
                result.append((f['schema']+'.'+f['name'],f['name'],f['definition'],f.get('configuration')))
        elif section['section']=='triggers':
            counter=0
            for t in section['items']:
                if t.get('schema')!='public' or t.get('table')!='tens_in_groups':continue
                counter+=1;definition=t['function_definition']
                header=re.search(r'\bFUNCTION\s+('+ID+r')\s*\(',definition,re.I)
                if not header:raise ValueError('Missing function header')
                result.append((normalise(header[1]),'group_trigger_'+str(counter),definition,t.get('configuration')))
    return result

def classify(rows):
    entries=captured(rows);index={};unknown={};targets={};output=[]
    for name,alias,text,configuration in entries:index.setdefault(normalise(name),[]).append(alias)
    for name,alias,text,configuration in entries:
        calls,effects,quoted,dynamic=extract_calls(text);classified=[]
        for call in calls:
            qualified=call if '.' in call else 'public.'+call
            if call in index or qualified in index:
                classified.append({'kind':'captured_routine_candidate','aliases':index.get(call,index.get(qualified)),
                                   'resolution_proven':False})
            elif call.startswith('pg_catalog.') and call.split('.')[1] in BUILTINS:
                short=call.split('.')[1]
                classified.append({'kind':'explicit_catalog_builtin_spelling','name':short,
                                   'side_effect_possible':short in SIDE_EFFECT_BUILTINS,'resolution_proven':False})
            elif '.' not in call and call in BUILTINS:
                classified.append({'kind':'unqualified_builtin_spelling','name':call,
                                   'side_effect_possible':call in SIDE_EFFECT_BUILTINS,'resolution_proven':False})
            elif call in {prefix+name for name in ('crypt','gen_salt','digest') for prefix in ('','public.','extensions.')} :
                classified.append({'kind':'extension_candidate','name':call.split('.')[-1],'resolution_proven':False})
            else:
                node=unknown.setdefault(call,'uncaptured_call_'+str(len(unknown)+1))
                classified.append({'kind':'unresolved_not_in_saved_routine_index','alias':node,'resolution_proven':False})
        writes=[]
        for operation,target in effects:
            key=target if '.' in target else 'public.'+target
            label='public.tens_in_groups' if key=='public.tens_in_groups' else targets.setdefault(key,'private_target_'+str(len(targets)+1))
            writes.append({'operation':operation,'target':label,'schema_qualified_in_source':'.' in target,
                           'saved_metadata':target_metadata(rows,key)})
        output.append({'routine':alias,'search_path':search_path_summary(configuration),'calls':classified,'write_targets_NOT_complete':writes,
                       'quoted_sql_unreviewed':quoted,'execute_keyword_present':dynamic})
    return {'status':'SAVED EVIDENCE ONLY — lexical classification, not authorisation proof',
            'database_connections':0,'routines':output,'uncaptured_call_count':len(unknown),
            'next_gate':'Resolve non-builtin helpers, actual search_path/overloads, and trigger effects before migration'}

def main(argv=None):
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--folder',type=Path);a=p.parse_args(argv)
    try:
        if a.folder:folder=a.folder.expanduser()
        else:
            base=Path.home()/'Documents/ImInGolf-LIVE-Inspection'
            choices=[x for x in base.iterdir() if re.fullmatch(r'readonly-\d{8}T\d{6}Z',x.name)]
            if not choices:raise ValueError('Missing saved evidence')
            folder=max(choices,key=lambda x:x.name)
        if folder.is_symlink() or not folder.is_dir():raise ValueError('Invalid folder')
        info=folder.stat()
        if info.st_uid!=os.getuid() or stat.S_IMODE(info.st_mode)&0o077:raise ValueError('Private folder required')
        rows=summarise.read_private(folder/'catalog-private.json');report=summarise.read_private(folder/'report.json')
        summarise.summarise(rows,report)
        print(json.dumps(classify(rows),indent=2));return 0
    except Exception:
        print('STOP — saved call classification failed; no raw names or values displayed.',file=sys.stderr);return 1
if __name__=='__main__':sys.exit(main())
