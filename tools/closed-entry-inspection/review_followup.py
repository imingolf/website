#!/usr/bin/env python3
"""OFFLINE saved catalog review. Prints allowlisted facts only; never connects."""
import json
from pathlib import Path
import sys
import followup_runner as driver
import prepare_followup as prep
import summarise


def review(rows, report, parameters):
    prep.require(isinstance(report, dict))
    for key, expected in {'project':prep.PROJECT, 'connections_attempted':1,
        'group_records_read':0,
        'captured_function_attributes_trigger_definitions_target_fingerprints_match':True,
        'server_version_matches_saved_capture':True}.items():
        prep.require(type(report.get(key)) is type(expected) and report[key] == expected)
    driver.parse('\n'.join(['1']*4+[json.dumps(x) for x in rows]), parameters)
    parts={x['section']:x for x in rows}
    candidates=parts['candidate_bindings']['items']
    tables=parts['target_constraints_indexes']['items']
    triggers=parts['target_trigger_dependencies']['items']
    # Never copy source names, definitions, defaults, ACL text or arbitrary values.
    routines=[]
    for f in candidates:
        prep.require(isinstance(f.get('name'),str) and isinstance(f.get('schema'),str))
        config=f.get('configuration')
        prep.require(config is None or isinstance(config,list))
        routines.append({'candidate_number':len(routines)+1,
          'same_name_candidates_in_reviewed_scope':sum(x.get('name')==f['name'] for x in candidates),
          'in_pg_catalog':f['schema']=='pg_catalog',
          'extension_membership_present':f.get('extension') is not None,
          'is_pgcrypto_gen_salt':f['name']=='gen_salt' and f.get('extension')=='pgcrypto',
          'body_captured':f.get('definition') is not None,
          'body_previously_saved':f.get('definition_already_saved') is True,
          'security_definer':summarise.boolean(f.get('security_definer')),
          'explicit_search_path':any(isinstance(x,str) and x.startswith('search_path=') for x in config or []),
          'anon_can_create_in_schema':summarise.boolean(f.get('anon_create_schema')),
          'authenticated_can_create_in_schema':summarise.boolean(f.get('authenticated_create_schema'))})
    targets=[]
    for t in tables:
        for key in ('columns','constraints','indexes','policies'):prep.require(isinstance(t.get(key),list))
        local=[x for x in triggers if prep.oid(x['table_oid'])==prep.oid(t['table_oid'])]
        targets.append({'target_number':len(targets)+1,'rls':summarise.boolean(t.get('rls')),
          'force_rls':summarise.boolean(t.get('force_rls')),
          'column_count':len(t['columns']),
          'columns_with_default':sum(x.get('default') is not None for x in t['columns']),
          'generated_columns':sum(bool(x.get('generated')) for x in t['columns']),
          'identity_columns':sum(bool(x.get('identity')) for x in t['columns']),
          'constraint_count':len(t['constraints']),
          'foreign_keys':sum(x.get('type')=='f' for x in t['constraints']),
          'deferred_constraints':sum(x.get('initially_deferred') is True for x in t['constraints']),
          'unvalidated_constraints':sum(x.get('validated') is not True for x in t['constraints']),
          'index_count':len(t['indexes']),
          'invalid_or_unready_indexes':sum(x.get('valid') is not True or x.get('ready') is not True for x in t['indexes']),
          'policy_count':len(t['policies']),
          'trigger_order':[{'position':i+1,'internal':summarise.boolean(x.get('internal')),
            'enabled_normal_or_always':x.get('enabled') in ('O','A'),
            'row_level':bool(int(x['type_bits'])&1),
            'before':bool(int(x['type_bits'])&2),
            'instead_of':bool(int(x['type_bits'])&64),
            'body_captured':x.get('definition_body') is not None,
            'body_previously_saved':x.get('definition_already_saved') is True} for i,x in enumerate(local)]})
    return {'project':prep.PROJECT,'new_database_connections':0,'group_records_read':0,
      'saved_collection_guards_passed':True,'candidate_count':len(candidates),
      'routine_indicators':routines,'targets':targets,
      'limitations':['Saved evidence provenance checked against original package; not cryptographic attestation of the server.',
        'Candidate presence is not proof of actual overload resolution.',
        'Trigger list order is name order within a table; execution order also depends on event and timing.',
        'Private function bodies and defaults require local control-flow review; counts do not prove side-effect safety.'],
      'binding_and_trigger_effects':'UNVERIFIED','release_decision':'NO-GO'}


def main(argv=None):
    parser=prep.QuietParser(description=__doc__)
    for arg in ('folder','saved-folder','package'):parser.add_argument('--'+arg,type=Path)
    args=parser.parse_args(argv)
    try:
        base=Path.home()/'Documents/ImInGolf-LIVE-Inspection'
        source=args.saved_folder.expanduser() if args.saved_folder else driver.latest(base,r'readonly-\d{8}T\d{6}Z')
        package=args.package.expanduser() if args.package else driver.latest(base,r'followup-review-\d{8}T\d{6}\.\d{6}Z')
        folder=args.folder.expanduser() if args.folder else driver.latest(base,r'followup-readonly-\d{8}T\d{6}\.\d{6}Z')
        _,parameters=driver.load_package(source,package)
        prep.private_directory(folder)
        result=review(summarise.read_private(folder/'catalog-followup.PRIVATE.json'),
                       summarise.read_private(folder/'report.SANITISED.json'),parameters)
        print(json.dumps(result,indent=2,sort_keys=True));return 0
    except Exception:
        print('STOP — incompatible, changed or non-private saved evidence; no contents displayed. Connections attempted: 0',file=sys.stderr)
        return 1
if __name__=='__main__':sys.exit(main())
