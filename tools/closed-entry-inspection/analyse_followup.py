#!/usr/bin/env python3
"""OFFLINE joins of saved definitions and follow-up metadata. No SQL execution.
Reports bounded evidence, not a PostgreSQL parser or runtime resolver.
"""
import json
import re
from pathlib import Path
import sys
import classify_saved_calls as calls
import followup_runner as driver
import prepare_followup as prep
import review_followup as reviewer
import summarise


def trim_syntax(definition):
    # PostgreSQL's unqualified TRIM special form lowers to btrim/ltrim/rtrim.
    # A schema-qualified or quoted identifier remains an ordinary routine call.
    masked,_=calls.mask_values(definition)
    forms=[]
    for m in re.finditer(r'(?<![A-Za-z_0-9$.\"])\btrim\s*\(\s*(?:(leading|trailing|both)\b)?',masked,re.I):
        forms.append({'leading':'ltrim','trailing':'rtrim'}.get((m[1] or '').lower(),'btrim'))
    return sorted(set(forms))


def analyse(source, rows, report, parameters):
    reviewer.review(rows,report,parameters)
    parts={x['section']:x for x in rows}
    candidates=parts['candidate_bindings']['items']
    tables=parts['target_constraints_indexes']['items']
    triggers=parts['target_trigger_dependencies']['items']
    names={t['schema']+'.'+t['name']:t for t in tables}
    by_oid={prep.oid(t['table_oid']):i+1 for i,t in enumerate(tables)}
    routines=[]
    # Captured selected RPCs plus group trigger bodies. Downstream targets/triggers
    # are separately flagged; never assume they are harmless because not in roots.
    for name,alias,definition,config in calls.captured(source):
        extracted,effects,quoted,dynamic=calls.extract_calls(definition)
        path=[x.split('=',1)[1] for x in config or [] if x.startswith('search_path=')]
        fixed=len(path)==1
        schemas=[calls.normalise(x.strip()) for x in path[0].split(',')] if fixed else []
        if fixed and 'pg_catalog' not in schemas:schemas.insert(0,'pg_catalog')
        bindings=[]
        for call in extracted:
            if call in prep.SQL_SYNTAX:continue
            pieces=call.split('.')
            trim_form=call=='trim' and bool(trim_syntax(definition)) and not re.search(r'"trim"\s*\(',calls.mask_values(definition)[0],re.I)
            pool=[f for f in candidates if f['name']==pieces[-1] and
                  (f['schema']==pieces[0] if len(pieces)==2 else not fixed or f['schema'] in schemas)]
            bindings.append({'call_number':len(bindings)+1,
              'known_builtin_spelling':pieces[-1] if pieces[-1] in calls.BUILTINS else None,
              'qualified':len(pieces)==2,'candidate_count':len(pool),
              'candidate_schemas_in_fixed_path':fixed,
              'extension_candidate_count':sum(f.get('extension') is not None for f in pool),
              'all_candidate_bodies_available':bool(pool) and all(f.get('definition') is not None or f.get('definition_already_saved') is True or f['schema']=='pg_catalog' for f in pool),
              'trim_parser_lowering_candidates':trim_syntax(definition) if trim_form else [],
              'status':'SQL_TRIM_SPECIAL_FORM_NOT_A_TRIM_CATALOG_LOOKUP' if trim_form else 'MISSING_CANDIDATE' if not pool else 'TYPES_AND_CALL_EXPRESSION_REVIEW_REQUIRED'})
        writes=[]
        for operation,target in effects:
            possible=[t for key,t in names.items() if key==target] if '.' in target else [t for t in tables if t['name']==target]
            writes.append({'operation':operation,'qualified':'.' in target,
              'candidate_targets':[by_oid[prep.oid(t['table_oid'])] for t in possible],
              'qualified_target_matches_saved_relation':len(possible)==1 and '.' in target})
        routines.append({'routine':alias,'search_path':calls.search_path_summary(config),
          'calls':bindings,'writes_lexical_NOT_complete':writes,
          'dynamic_or_quoted_sql':quoted or dynamic,
          'on_conflict_present':bool(re.search(r'\bon\s+conflict\b',calls.mask_values(definition)[0],re.I))})
    ordering=[]
    for t in tables:
        local=sorted([x for x in triggers if prep.oid(x['table_oid'])==prep.oid(t['table_oid'])],key=lambda x:x['name'])
        for event,bit in [('insert',4),('delete',8),('update',16),('truncate',32)]:
            for timing in ('before','after','instead_of'):
                for row_level in (False,True):
                    matched=[x for x in local if int(x['type_bits'])&bit and bool(int(x['type_bits'])&1)==row_level
                      and ('instead_of' if int(x['type_bits'])&64 else 'before' if int(x['type_bits'])&2 else 'after')==timing]
                    if not matched:continue
                    ordering.append({'target':by_oid[prep.oid(t['table_oid'])],'event':event,'timing':timing,'row_level':row_level,
                      'name_order_positions_in_table':[local.index(x)+1 for x in matched],
                      'constraint_timing_requires_review':any(int(x.get('constraint_oid',0))!=0 for x in matched),
                      'all_enabled_normal_or_always':all(x['enabled'] in ('O','A') for x in matched)})
    return {'project':prep.PROJECT,'database_connections':0,'group_records_read':0,
      'routines':routines,'trigger_event_timing_groups':ordering,
      'foreign_keys_outside_captured_targets':sum(c.get('type')=='f' and prep.oid(c['referenced_relation_oid']) not in by_oid for t in tables for c in t['constraints']),
      'limitations':['No runtime overload proof: implicit casts, default/variadic arguments, operators and expression types need private review.',
        'Trigger name order applies within the same event/timing/level; constraint deferral, WHEN and UPDATE OF clauses still require review.',
        'Lexical writes do not establish ON CONFLICT arbiter, values, exactly-once semantics or complete side effects.'],
      'release_decision':'NO-GO; no further database inspection requested by this tool'}


def main(argv=None):
    p=prep.QuietParser(description=__doc__)
    for arg in ('folder','saved-folder','package'):p.add_argument('--'+arg,type=Path)
    args=p.parse_args(argv)
    try:
        base=Path.home()/'Documents/ImInGolf-LIVE-Inspection'
        source=args.saved_folder.expanduser() if args.saved_folder else driver.latest(base,r'readonly-\d{8}T\d{6}Z')
        package=args.package.expanduser() if args.package else driver.latest(base,r'followup-review-\d{8}T\d{6}\.\d{6}Z')
        folder=args.folder.expanduser() if args.folder else driver.latest(base,r'followup-readonly-\d{8}T\d{6}\.\d{6}Z')
        _,params=driver.load_package(source,package);prep.private_directory(folder)
        original=summarise.read_private(source/'catalog-private.json')
        result=analyse(original,summarise.read_private(folder/'catalog-followup.PRIVATE.json'),summarise.read_private(folder/'report.SANITISED.json'),params)
        print(json.dumps(result,indent=2,sort_keys=True));return 0
    except Exception:
        print('STOP — saved dependency analysis failed; no private contents displayed. Database connections: 0',file=sys.stderr);return 1
if __name__=='__main__':sys.exit(main())
