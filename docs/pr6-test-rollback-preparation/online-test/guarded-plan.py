"""Offline generation of guarded TEST files. Never connects to a database."""
import copy
import datetime
import hashlib
import json
import re

PROJECT='nyavvwrsrxqfyhiygkgw'

def sources(source,signatures):
    out={}
    pattern=r'create(?: or replace)? function\s+([\w.]+)\s*\([^)]*\)(.*?)\bas\s+\$\$(.*?)\$\$;'
    for match in re.finditer(pattern,source,re.I|re.S):
        name,header,body=match.groups()
        matches=[s for s in signatures if s.split('(')[0]==name]
        if len(matches)!=1: raise ValueError('Unknown/ambiguous pinned function: '+name)
        lang=re.search(r'language\s+(\w+)',header,re.I)
        if lang is None: raise ValueError('Missing function language')
        out[matches[0]]={'src':body,'language':lang.group(1).lower(),
                         'security_definer':bool(re.search(r'security\s+definer',header,re.I)),
                         'volatility':'i' if re.search(r'\bimmutable\b',header,re.I) else 'v'}
    if not out: raise ValueError('No pinned functions parsed')
    return out

def expected_acl(sig,old,defaults):
    acl=copy.deepcopy(old if old is not None else defaults[sig.split('.')[0]])
    if sig.startswith('iig_private.') and sig!='iig_private.verified_organiser()':
        acl=[a for a in acl if a['grantee'] not in ('PUBLIC','anon','authenticated')]
    elif old is None:
        service=sig.startswith(('public.iig_is_protected_group(','public.iig_apply_verified_subscription('))
        removed=('PUBLIC','anon','authenticated') if service else ('PUBLIC','anon')
        acl=[a for a in acl if a['grantee'] not in removed]
        role='service_role' if service else 'authenticated'
        if not any(a['grantee']==role and a['privilege']=='EXECUTE' for a in acl):
            acl.append({'grantee':role,'grantor':'postgres','privilege':'EXECUTE','grantable':False})
    if any(a['grantor']!='postgres' for a in acl): raise ValueError('Unexpected planned ACL grantor')
    return acl

def guard(before,states,tables,triggers,g,pause,extra_rows):
    capture=g.capture_sql()
    query=capture[capture.index('SELECT jsonb_build_object('):capture.rindex(';\nCOMMIT;')]
    deadline=datetime.datetime.fromisoformat(pause['confirmed_at_utc'].replace('Z','+00:00'))+datetime.timedelta(minutes=30)
    lit=g.lit
    lines=[
      "set local lock_timeout='5s'; set local statement_timeout='60s';",
      "set local standard_conforming_strings=on; set local timezone='UTC';",
      "set local datestyle='ISO, YMD'; set local extra_float_digits=3; set local row_security=off;",
      "set local search_path=pg_catalog;",
      'lock table '+','.join(g.GUARDED+['public.iig_notification_settings','public.iig_notification_events']+tables)+' in share row exclusive mode;',
      'do $iig_guard$ declare actual jsonb; expected jsonb := '+lit(json.dumps(before))+'::jsonb; k text; a jsonb; b jsonb; f jsonb; begin',
      "if current_user<>'postgres' or current_database()<>'postgres' or current_setting('server_version_num')::integer<>170011 then raise exception 'Wrong TEST installation role/version'; end if;",
      "if current_setting('iig.approved_test_project',true) is distinct from "+lit(PROJECT)+" then raise exception 'Separate TEST installation approval required'; end if;",
      "if coalesce(current_setting('supabase.project_ref',true),'') not in ('',"+lit(PROJECT)+") then raise exception 'Wrong project setting'; end if;",
      "if clock_timestamp()>"+lit(deadline.isoformat())+"::timestamptz then raise exception 'Writer-control window expired; repeat read-only preparation'; end if;",
      'actual := ('+query+');',
      "if actual->'fingerprints' is distinct from expected->'fingerprints' then raise exception 'Protected data changed; STOP'; end if;",
      "foreach k in array array['policies','default_acl','roles','role_memberships','schemas','extensions','event_triggers'] loop a:=actual->'inventory'->k; b:=expected->'inventory'->k; if not(a @> b and b @> a) then raise exception 'Original catalog changed: %',k; end if; end loop;",
      "select coalesce(jsonb_agg(v),'[]') into a from jsonb_array_elements(actual->'inventory'->'tables') v where (v->>'schema')||'.'||(v->>'name') <> all("+lit('{'+','.join(tables)+'}')+"::text[]); b:=expected->'inventory'->'tables'; if not(a @> b and b @> a) then raise exception 'Original tables/RLS/grants changed'; end if;",
      "select coalesce(jsonb_agg(v),'[]') into a from jsonb_array_elements(actual->'inventory'->'triggers') v where not ((v->>'table'='auth.users' and v->>'name'='iig_sync_owner_email') or (v->>'table'='public.tens_in_groups' and v->>'name'='iig_protected_group_limits')); b:=expected->'inventory'->'triggers'; if not(a @> b and b @> a) then raise exception 'Original triggers changed'; end if;"]
    for table in ('public.iig_notification_settings','public.iig_notification_events'):
        lines.append('if '+g.fingerprint(table)+' is distinct from '+lit(json.dumps(extra_rows[table]))+"::jsonb then raise exception 'Notification data changed'; end if;")
    for sig,state in states.items():
        lines.append("select v into f from jsonb_array_elements(actual->'functions') v where v->>'requested'="+lit(sig)+';')
        if not state['exists']:
            lines.append("if f->'exists' is distinct from 'false'::jsonb then raise exception 'Unexpected new function'; end if;")
            continue
        lines.append("if f->'exists' is distinct from 'true'::jsonb or f->'meta'->>'owner'<>'postgres' then raise exception 'Missing function/wrong owner'; end if;")
        if 'definition' in state:
            lines.append("if f->'meta'->>'definition' is distinct from "+lit(state['definition'])+" then raise exception 'Original function changed'; end if;")
        else:
            lines.append("if not exists(select 1 from pg_proc p join pg_language l on l.oid=p.prolang where p.oid="+lit(sig)+'::regprocedure and p.prosrc='+lit(state['src'])+' and p.prosecdef='+str(state['security_definer']).lower()+
              ' and p.provolatile='+lit(state['volatility'])+' and l.lanname='+lit(state['language'])+
              " and cardinality(p.proconfig)=1 and p.proconfig <@ array['search_path=','search_path=\"\"']) then raise exception 'Pinned function/security mismatch'; end if;")
        lines.append("a:=f->'meta'->'acl'; b:="+lit(json.dumps(state['acl']))+"::jsonb; if not(a @> b and b @> a) then raise exception 'Function grants differ'; end if;")
        service=sig.startswith(('public.iig_is_protected_group(','public.iig_apply_verified_subscription('))
        client=sig.startswith('public.') and not service
        lines.append("if has_function_privilege('anon',"+lit(sig)+",'EXECUTE') or has_function_privilege('authenticated',"+lit(sig)+",'EXECUTE') is distinct from "+str(client).lower()+" then raise exception 'Unexpected client function access'; end if;")
        if service: lines.append("if not has_function_privilege('service_role',"+lit(sig)+",'EXECUTE') then raise exception 'Missing service-only grant'; end if;")
    for table in g.TABLES:
        if table not in tables:
            lines.append('if to_regclass('+lit(table)+") is not null then raise exception 'Unexpected new table'; end if;")
        else:
            lines.append('if exists(select 1 from '+table+") or not exists(select 1 from pg_class where oid="+lit(table)+"::regclass and relrowsecurity and not relforcerowsecurity and relowner='postgres'::regrole) or exists(select 1 from pg_policy where polrelid="+lit(table)+"::regclass) or has_table_privilege('anon',"+lit(table)+",'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or has_table_privilege('authenticated',"+lit(table)+",'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then raise exception 'New table content/security mismatch'; end if;")
    for table,name in g.TRIGGERS:
        if name not in triggers:
            lines.append('if exists(select 1 from pg_trigger where tgrelid='+lit(table)+'::regclass and tgname='+lit(name)+") then raise exception 'Unexpected new trigger'; end if;")
        else:
            fn='iig_private.sync_owner_email()' if table=='auth.users' else 'iig_private.protected_group_limits()'
            column='email' if table=='auth.users' else 'state'
            bits=17 if table=='auth.users' else 19
            lines.append('if not exists(select 1 from pg_trigger where tgrelid='+lit(table)+'::regclass and tgname='+lit(name)+' and tgfoid='+lit(fn)+"::regprocedure and tgenabled='O' and tgtype="+str(bits)+" and tgattr::text=(select attnum::text from pg_attribute where attrelid="+lit(table)+'::regclass and attname='+lit(column)+")) then raise exception 'Pinned trigger mismatch'; end if;")
    lines.append('end $iig_guard$;')
    text='\n'.join(lines)+'\n'
    # Captured text must never be able to close the outer dollar-quoted DO body.
    tag='$iig_'+hashlib.sha256(text.encode()).hexdigest()+'$'
    if tag in text: raise ValueError('Unexpected guard delimiter collision')
    text=text.replace('do $iig_guard$','do '+tag,1)
    head,tail=text.rsplit('end $iig_guard$;',1)
    return head+'end '+tag+';'+tail

def prepare(out,before,audit,originals,rollback,g,defaults,pause):
    signatures=g.REQUIRED+g.OPTIONAL+g.NEW
    states={f['requested']:({'exists':True,'definition':f['meta']['definition'],'acl':copy.deepcopy(f['meta']['acl'])}
                            if f['exists'] else {'exists':False}) for f in before['functions']}
    tables=[]; triggers=[]; files=[]
    for index,(name,source) in enumerate(originals,1):
        pre=guard(before,states,tables,triggers,g,pause,audit['rows'])
        for sig,body in sources(source,signatures).items():
            old=states[sig]['acl'] if states[sig]['exists'] else None
            states[sig]=dict(body,exists=True,acl=expected_acl(sig,old,defaults))
        if index==2: triggers.append('iig_protected_group_limits')
        if index==3:
            tables+=['iig_private.account_deletions','iig_private.owner_transfers']
            triggers.append('iig_sync_owner_email')
        if index==4: tables.append('iig_private.subscription_bindings')
        post=guard(before,states,tables,triggers,g,pause,audit['rows'])
        if len(re.findall(r'^begin;$',source,re.M))!=1 or len(re.findall(r'^commit;$',source,re.M))!=1:
            raise ValueError('Unexpected transaction structure in pinned source')
        guarded=re.sub(r'^begin;$',lambda m:m.group(0)+'\n'+pre,source,count=1,flags=re.M)
        guarded=re.sub(r'^commit;$',lambda m:post+m.group(0),guarded,count=1,flags=re.M)
        filename=f'{index:02d}-{name}.guarded.sql'
        (out/filename).write_text('\\set ON_ERROR_STOP on\n'+guarded)
        files.append({'file':filename,'sha256':hashlib.sha256((out/filename).read_bytes()).hexdigest(),
                      'source':name,'source_sha256':hashlib.sha256(source.encode()).hexdigest()})
    for filename,value in [('original-capture.json',before),('preflight-audit.json',audit),('controlled-pause.json',pause)]:
        (out/filename).write_text(json.dumps(value,indent=2))
    (out/'rollback.TEST.sql').write_text(rollback)
    (out/'package.json').write_text(json.dumps({'project':PROJECT,'migrations':files,
       'rollback_sha256':hashlib.sha256(rollback.encode()).hexdigest(),
       'created_at':datetime.datetime.now(datetime.timezone.utc).isoformat()},indent=2))
