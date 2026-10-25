#!/usr/bin/env python3
"""OFFLINE resolver derivation from the existing saved SQL getter. Never connects.
Only a narrow single-table SQL SELECT shape is supported; no guessed PIN hashing.
Generated SQL is private, REVIEW ONLY, and never executed by this tool.
"""
import json
from pathlib import Path
import re
import sys
import followup_runner as driver
import prepare_followup as prep
import semantic_saved as semantic
import summarise


def build(function,table):
    prep.require(function.get('schema')=='public' and function.get('name')=='get_group_state'
      and function.get('owner')=='postgres' and function.get('security_definer') is True)
    prep.require(re.fullmatch(r'p_pin\s+text',function.get('arguments','')) is not None)
    prep.require(function.get('return')=='jsonb')
    prep.require(table.get('schema')=='public' and table.get('name')=='tens_in_groups')
    columns={c['name']:c['type'] for c in table['columns']}
    prep.require(columns.get('id') in ('uuid','text','integer','bigint') and columns.get('state')=='jsonb')
    config=function.get('configuration');prep.require(isinstance(config,list) and len(config)==1 and config[0].startswith('search_path='))
    paths=[x.strip() for x in config[0].split('=',1)[1].split(',')]
    for path in paths:prep.safe_name(path)
    definition=function['definition'];m=re.search(r'\bAS\s+(\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$)',definition,re.I)
    prep.require(m is not None);end=definition.rfind(m[1]);prep.require(end>=m.end())
    header=definition[:m.start()]+definition[end+len(m[1]):]
    prep.require(re.search(r'\bLANGUAGE\s+sql\b',header,re.I) is not None)
    body=definition[m.end():end];prep.require(len(body)<=20000)
    tokens=semantic.lex(body)
    prep.require(sum(semantic.word(t,'select') for t in tokens)==1)
    forbidden={'join','union','intersect','except','with','insert','update','delete','execute','copy','call','for','into','returning','set_config','pg_notify'}
    prep.require(not any(k=='word' and v in forbidden for k,v in tokens))
    semis=[i for i,t in enumerate(tokens) if t==('operator',';')]
    prep.require(not semis or semis==[len(tokens)-1])
    # Exact root projection + relation, optional simple alias. The WHERE, function
    # calls, literal filters, LIMIT/ORDER and original path remain byte-for-byte.
    pattern=r'^\s*SELECT\s+(?P<projection>(?:(?P<qual>[a-z_][a-z0-9_]*)\.)?state)\s+FROM\s+public\.tens_in_groups(?:\s+(?:AS\s+)?(?P<alias>(?!where\b)[a-z_][a-z0-9_]*))?\s+WHERE\b'
    match=re.match(pattern,body,re.I);prep.require(match is not None)
    prep.require(match['qual'] is None or match['qual'].lower()==(match['alias'] or '').lower())
    prep.require(('word','p_pin') in tokens)
    projection=(match['qual']+'.' if match['qual'] else '')+'id::text'
    derived=body[:match.start('projection')]+projection+body[match.end('projection'):]
    delimiter='$iig_bound_pin$';prep.require(delimiter not in derived)
    sql='-- PRIVATE REVIEW ONLY; derived from saved getter, not current online verification.\n'
    sql+='CREATE OR REPLACE FUNCTION iig_closed_entry.resolve_pin(p_pin text) RETURNS text\n'
    sql+='LANGUAGE sql SECURITY DEFINER SET search_path = '+','.join(paths)+'\nAS '+delimiter+derived+delimiter+';\n'
    sql+='REVOKE ALL ON FUNCTION iig_closed_entry.resolve_pin(text) FROM PUBLIC,anon,authenticated,service_role;\n'
    return sql,{'project':prep.PROJECT,'source_definition_sha256':prep.digest(definition),
      'resolver_sql_sha256':prep.digest(sql),'source_predicate_and_path_preserved':True,
      'projection_only_change':True,'database_connections':0,'sql_execution_authorised':False,
      'remaining_review':'Confirm saved all-group PIN semantics and baseline ownership/bindings; install only after separate approval.'}


def main(argv=None):
    parser=prep.QuietParser(description=__doc__)
    for arg in ('saved-folder','package','out'):parser.add_argument('--'+arg,type=Path)
    args=parser.parse_args(argv)
    stage='saved_evidence_validation'
    try:
        base=Path.home()/'Documents/ImInGolf-LIVE-Inspection'
        source=args.saved_folder.expanduser() if args.saved_folder else driver.latest(base,r'readonly-\d{8}T\d{6}Z')
        package=args.package.expanduser() if args.package else driver.latest(base,r'followup-review-\d{8}T\d{6}\.\d{6}Z')
        driver.load_package(source,package)
        original=summarise.read_private(source/'catalog-private.json')
        functions=[f for section in original if section['section']=='functions' for f in section['items'] if f['schema']=='public' and f['name']=='get_group_state']
        tables=[t for section in original if section['section']=='relations' for t in section['items'] if t['schema']=='public' and t['name']=='tens_in_groups']
        prep.require(len(functions)==len(tables)==1)
        stage='supported_getter_derivation'
        sql,manifest=build(functions[0],tables[0])
        from datetime import datetime,timezone
        out=args.out.expanduser() if args.out else base/('pin-binding-review-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ'))
        stage='new_private_output'
        prep.write_new(out,{'resolver.PRIVATE.REVIEW.sql':sql,'manifest.SANITISED.json':json.dumps(manifest,indent=2)+'\n'})
        print('PASS — private PIN binding prepared OFFLINE; not installed. Database connections: 0')
        print('Private review folder: '+str(out))
        print('Share only manifest.SANITISED.json; keep resolver.PRIVATE.REVIEW.sql on your Mac.')
        return 0
    except Exception:
        print('STOP — '+stage+' failed; no SQL/values displayed. Database connections: 0',file=sys.stderr);return 1
if __name__=='__main__':sys.exit(main())
