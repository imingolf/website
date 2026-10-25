#!/usr/bin/env python3
"""OFFLINE review inventory only. No connection, SQL execution or install option.
Keeps the original private resolver in place. Does not emit executable migrations.
"""
import json
from pathlib import Path
import re
import sys
import prepare_followup as prep
import summarise

TEST='nyavvwrsrxqfyhiygkgw'
ROOT=Path(__file__).resolve().parents[2]
FILES=['supabase/closed-entry-candidate/core.sql','supabase/closed-entry-candidate/validators.sql',
       'supabase/closed-entry-candidate/boundary.sql','app/entry-guard-client.js','app/index.html']
GATES=['current_TEST_catalog_and_data_baseline_not_verified',
       'full_operation_and_adversarial_result_coverage_not_complete',
       'verified_organiser_and_player_rosters_and_delivery_not_confirmed',
       'all_writers_and_native_asset_compatibility_not_confirmed',
       'baseline_bound_install_and_runtime_retaining_rollback_not_approved']

def build(folder):
    prep.private_directory(folder)
    manifest=summarise.read_private(folder/'manifest.SANITISED.json')
    resolver=folder/'resolver.PRIVATE.REVIEW.sql'
    # read_private expects JSON: use the same private regular-file guard for SQL.
    import runner
    runner.private_file(resolver)
    sql=resolver.read_text()
    prep.require(manifest.get('project')==prep.PROJECT and manifest.get('source_predicate_and_path_preserved') is True
       and manifest.get('projection_only_change') is True and manifest.get('database_connections')==0
       and manifest.get('sql_execution_authorised') is False)
    prep.require(re.fullmatch(r'[a-f0-9]{64}',manifest.get('source_definition_sha256','')) is not None)
    prep.require(manifest.get('resolver_sql_sha256')==prep.digest(sql))
    prep.require(sql.startswith('-- PRIVATE REVIEW ONLY;') and 'FUNCTION iig_closed_entry.resolve_pin(p_pin text) RETURNS text' in sql)
    hashes={name:prep.digest((ROOT/name).read_text()) for name in FILES}
    return {'format':1,'status':'REVIEW_ONLY_NOT_INSTALLABLE','source_pin_capture_project':prep.PROJECT,'target_project':TEST,
      'connections_attempted':0,'sql_execution_authorised':False,'guarded_mode_activation_authorised':False,
      'source_predicate_and_path_preserved':True,'projection_only_change':True,
      'source_definition_sha256':manifest['source_definition_sha256'],'resolver_sql_sha256':prep.digest(sql),
      'candidate_file_sha256':hashes,'unresolved_gates':list(GATES),
      'test_baseline_verified':False,'rollback_verified_for_target':False,
      'private_resolver_copied_or_published':False}

def main(argv=None):
    parser=prep.QuietParser(description=__doc__)
    parser.add_argument('--pin-binding-folder',type=Path,required=True)
    parser.add_argument('--out',type=Path,required=True)
    args=parser.parse_args(argv)
    try:
        report=build(args.pin_binding_folder.expanduser())
        prep.write_new(args.out.expanduser(),{'review.SANITISED.json':json.dumps(report,indent=2)+'\n',
         'STOP-NOT-INSTALLABLE.txt':'This is an offline inventory, not an installation package.\nNo current TEST baseline or install/rollback authority established.\nDo not execute candidate SQL or activate guarded mode.\nThe private PIN resolver remains in its original Mac folder.\n'})
        print('PASS — offline review inventory prepared; installation NO-GO. Database connections: 0')
        return 0
    except Exception:
        print('STOP — private binding/hash/output validation failed. No SQL or private values displayed. Database connections: 0',file=sys.stderr)
        return 1
if __name__=='__main__':sys.exit(main())
