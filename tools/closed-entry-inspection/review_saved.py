#!/usr/bin/env python3
"""Produce a value-free control-flow sketch from SAVED definitions; never execute SQL.
This is a lexical aid, not a parser or authorisation proof. No network/subprocess.
"""
import argparse
import json
import os
import stat
from pathlib import Path
import re
import sys
import summarise

WORDS=set('begin end if then else elsif return found not null true false and or is distinct from exists select into where update set insert values delete perform execute using raise exception security definer invoker function language plpgsql sql declare for loop while case when limit order by on conflict do nothing returning as join left inner right public pg_catalog auth uid current_user session_user current_setting crypt save_group_state get_group_state owner_update_group owner_reset_admin_pin owner_list_groups p_pin p_state p_creation_code pin_hash state history paid stableford netscore noreturn roundid roundopen adminpin creation_code'.split())
CALLS={'auth.uid','auth.role','crypt','public.crypt','pg_catalog.crypt','current_setting','pg_catalog.current_setting','jsonb_set','pg_catalog.jsonb_set','jsonb_array_elements','pg_catalog.jsonb_array_elements','pg_advisory_xact_lock','pg_catalog.pg_advisory_xact_lock','gen_random_uuid','pg_catalog.gen_random_uuid'}|summarise.NAMES|{'public.'+x for x in summarise.NAMES}

def body(definition):
    # pg_get_functiondef emits an outer AS $tag$ body $tag$ wrapper. Only unwrap
    # that exact matching delimiter. Nested/dynamic quoted SQL remains redacted.
    match=re.search(r'\bAS\s+(\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$)',definition,re.I)
    if not match:return definition
    start=match.end();end=definition.rfind(match.group(1))
    if end<start:raise ValueError('Unmatched body delimiter')
    return definition[start:end]

def sketch(definition):
    source=body(definition);tokens=[];calls=[];i=0;unknown={}
    while i<len(source):
        if source.startswith('--',i):
            end=source.find('\n',i+2);i=len(source) if end<0 else end;continue
        if source.startswith('/*',i):
            depth=1;i+=2
            while i<len(source) and depth:
                if source.startswith('/*',i):depth+=1;i+=2
                elif source.startswith('*/',i):depth-=1;i+=2
                else:i+=1
            if depth:raise ValueError('Unterminated comment')
            continue
        if source[i] in "'\"":
            quote=source[i];i+=1
            while i<len(source):
                if source[i]=='\\':i+=2;continue
                if source[i]==quote:
                    if i+1<len(source) and source[i+1]==quote:i+=2;continue
                    i+=1;break
                i+=1
            else:raise ValueError('Unterminated quote')
            tokens.append('[VALUE]');continue
        dollar=re.match(r'\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$',source[i:])
        if dollar:
            end=source.find(dollar[0],i+len(dollar[0]))
            if end<0:raise ValueError('Unterminated dollar string')
            i=end+len(dollar[0]);tokens.append('[QUOTED_SQL_NOT_REVIEWED]');continue
        word=re.match(r'[A-Za-z_][A-Za-z_0-9]*(?:\.[A-Za-z_][A-Za-z_0-9]*)*',source[i:])
        if word:
            value=word[0].lower();tail=source[i+len(word[0]):]
            if re.match(r'\s*\(',tail) and value not in {'if','exists','in','values','case'}:
                call=value if value in CALLS else unknown.setdefault(value,'unknown_call_'+str(len(unknown)+1))
                if call not in calls:calls.append(call)
            tokens.append(value if value in WORDS or value in CALLS else '[IDENTIFIER]')
            i+=len(word[0]);continue
        if source[i].isdigit():
            num=re.match(r'[0-9.eE+-]+',source[i:]);i+=len(num[0]);tokens.append('[NUMBER]');continue
        if source[i] in '();=<>!:+-*/[],':tokens.append(source[i])
        elif not source[i].isspace():tokens.append('[TOKEN]')
        i+=1
    # Limit evidence volume, but fail rather than silently truncate control flow.
    if len(tokens)>12000:raise ValueError('Definition too large for reviewed output')
    return {'control_flow_NOT_proof':' '.join(tokens),'calls_NOT_complete':calls,
            'unresolved_call_count':len(unknown),'dynamic_quoted_sql_unreviewed':'[QUOTED_SQL_NOT_REVIEWED]' in tokens}

def review(rows):
    output=[]
    for section in rows:
        if section.get('section')=='functions':
            for f in section.get('items',[]):
                if f.get('name') not in summarise.NAMES:raise ValueError('Unknown function')
                output.append({'kind':'function','name':f['name'],**sketch(f['definition'])})
        elif section.get('section')=='triggers':
            for t in section.get('items',[]):
                if t.get('schema')=='public' and t.get('table')=='tens_in_groups':
                    output.append({'kind':'group_trigger','name':'trigger_'+str(len(output)+1),**sketch(t['function_definition'])})
    return {'review_status':'LOCAL LEXICAL AID ONLY — authority and dependencies remain unproven',
            'database_connections':0,'definitions':output}

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--folder',type=Path);a=p.parse_args()
    try:
        if a.folder:folder=a.folder.expanduser()
        else:
            base=Path.home()/'Documents/ImInGolf-LIVE-Inspection'
            folders=[x for x in base.iterdir() if re.fullmatch(r'readonly-\d{8}T\d{6}Z',x.name)]
            if not folders:raise ValueError('Missing evidence')
            folder=max(folders,key=lambda x:x.name)
        if folder.is_symlink() or not folder.is_dir():raise ValueError('Invalid evidence folder')
        info=folder.stat()
        if info.st_uid!=os.getuid() or stat.S_IMODE(info.st_mode)&0o077:raise ValueError('Evidence folder not private')
        rows=summarise.read_private(folder/'catalog-private.json')
        report=summarise.read_private(folder/'report.json')
        summarise.summarise(rows,report)
        print(json.dumps(review(rows),indent=2));return 0
    except Exception:
        print('STOP — saved definition review failed; no raw values displayed.',file=sys.stderr);return 1
if __name__=='__main__':sys.exit(main())
