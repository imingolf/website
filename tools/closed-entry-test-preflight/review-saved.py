#!/usr/bin/env python3
"""Review an existing successful TEST capture OFFLINE. Never connect or execute SQL.

The consumed package and its inputs remain unchanged. New private JSON/Markdown
plans bind saved evidence and candidate source hashes; they are NOT installers.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import stat
import preflight as p

BASE_COMMIT = '8eda5d8799419d5b575418f2f70a9066f7b85f6d'
INPUTS = {'capture', 'rollback', 'backup', 'service', 'ca'}
SAVED_FILES = ('manifest.PRIVATE.json', 'inspection.READONLY.sql',
               'connection-attempt.json', 'catalog.PRIVATE.json',
               'report.SANITISED.json', 'writers.REVIEW.json')
CANDIDATE_FILES = ('supabase/closed-entry-candidate/core.sql',
                   'supabase/closed-entry-candidate/validators.sql',
                   'supabase/closed-entry-candidate/boundary.sql',
                   'supabase/closed-entry-candidate/authenticated-writers.sql',
                   'app/entry-guard-client.js', 'app/index.html', 'app/config.js',
                   'app/secure-organiser.js', 'app/secure-player.js',
                   'app/self-service.js', 'app/account-controls.js', 'app/handicap-input.js')
PLAN_FILE = 'docs/incident-closed-entry/SAVED-TEST-INSTALL-ROLLBACK-PLAN.md'
PUBLIC_RPCS = {'iig_entry_prepare', 'iig_entry_read', 'iig_entry_check_credential',
               'iig_entry_check_member', 'iig_entry_write', 'iig_entry_receipt',
               'iig_operate_owned_group', 'iig_read_entry_group', 'iig_prepare_owned_entry'}
PRIVATE_TABLES = ('rounds', 'credentials', 'permits', 'receipts', 'archives',
                  'member_credentials', 'operation_audit', 'identity_ids')
PREINSTALL_GATES = (
    'SAVED_OUTPUT_PROVENANCE_REVIEW',
    'TEST_PIN_BINDING_SEMANTICS_AND_DEPENDENCIES',
    'EXACT_TEST_HOOKS_AND_ADVERSARIAL_RESULTS_REHEARSAL',
    'BASELINE_BOUND_INSTALLER_AND_RETAINING_ROLLBACK_REHEARSAL',
    'BACKUP_RESTORE_AND_SECURITY_RECOVERY',
    'ALL_GROUP_WRITERS_AND_COMPATIBLE_CLIENT_CUTOVER',
    'TRUSTED_TEST_IDENTITY_ISSUANCE_AND_RECOVERY_PLAN',
    'SEPARATE_INSTALL_APPROVAL_AND_TRANSACTIONAL_DRIFT_RECHECK',
)
ACTIVATION_GATES = ('REAL_TEST_ROLE_AND_PERMISSION_VALIDATION',
                    'BROWSER_IPHONE_AND_NATIVE_ASSET_VALIDATION',
                    'SEPARATE_GUARDED_BUILD_AND_ACTIVATION_APPROVAL')


def require(ok):
    p.require(ok, 'saved review validation failed')


def sha(value):
    return hashlib.sha256(value).hexdigest()


def json_sha(value):
    return sha(json.dumps(value, sort_keys=True, separators=(',', ':'),
                          ensure_ascii=True, allow_nan=False).encode())


def private_directory(folder):
    folder = Path(folder).expanduser().absolute()
    require(folder.resolve() == folder and not folder.is_symlink() and folder.is_dir())
    info = folder.stat()
    require(info.st_uid == p.os.getuid() and not stat.S_IMODE(info.st_mode) & 0o077)
    return folder


def saved_json(folder, name):
    value = p.read_json(folder / name, 'saved evidence')
    require(isinstance(value, dict))
    return value


def load_saved(folder):
    """Validate consumed evidence without calling package(), prepare() or connect()."""
    folder = private_directory(folder)
    require(not (folder / p.FAILURE_FILE).exists() and not (folder / p.FAILURE_FILE).is_symlink())
    hashes = {}
    for name in SAVED_FILES:
        path = p.private_file(folder / name, 'saved evidence')
        require(path.stat().st_size <= p.LIMIT)
        hashes[name] = p.digest(path)
    m = saved_json(folder, 'manifest.PRIVATE.json')
    require(m.get('project') == p.PROJECT and m.get('mode') == 'READONLY_REVIEW_NOT_INSTALLABLE')
    require(m.get('code_hashes') == p.code_hashes())
    require(type(m.get('database_connections')) is int and m['database_connections'] == 0)
    require(m.get('installation_approved') is False and m.get('auth_table_rows_read') is False
            and m.get('original_rollback_reused_as_incident_rollback') is False)
    require(set(m.get('input_paths', {})) == INPUTS and set(m.get('input_hashes', {})) == INPUTS)
    for key in INPUTS:
        path = p.private_file(m['input_paths'][key], 'original input')
        require(p.digest(path) == m['input_hashes'][key])
    require(p.service(m['input_paths']['service']) == m['service'])
    p.certificate(m['input_paths']['ca'])
    capture = p.read_json(m['input_paths']['capture'], 'original capture')
    sql = p.build_sql(capture)
    require((folder / 'inspection.READONLY.sql').read_text() == sql and sha(sql.encode()) == m['sql_sha256'])
    names = {'.'.join(item) for item in p.scope(capture)}
    require(m.get('table_scope') == sorted(names))
    backup = m.get('backup', {})
    require(backup.get('custom_archive_listed') is True
            and backup.get('sha256_recorded_now') == m['input_hashes']['backup']
            and backup.get('historical_checksum_available') is False
            and backup.get('full_restore_proven') is False)
    attempt = saved_json(folder, 'connection-attempt.json')
    require(attempt == {'project': p.PROJECT, 'connections_attempted': 1}
            and type(attempt['connections_attempted']) is int)
    data = saved_json(folder, 'catalog.PRIVATE.json')
    require(set(data) == p.SECTIONS)
    for section in p.SECTIONS:
        require(isinstance(data[section], dict) and data[section].get('section') == section)
    identity = data['identity']
    require(identity.get('database') == 'postgres' and identity.get('role') == 'postgres'
            and identity.get('session_role') == 'postgres' and identity.get('project') in (None, '', p.PROJECT)
            and identity.get('backend_ssl') is True and identity.get('transaction_read_only') == 'on'
            and identity.get('default_transaction_read_only') == 'on'
            and isinstance(identity.get('version'), str)
            and re.fullmatch(r'17[0-9]{4}', identity['version']) is not None)
    for section in p.SECTIONS - {'identity', 'authority', 'platform', 'fingerprints'}:
        items = data[section].get('items')
        require(isinstance(items, list) and len(items) <= 512 and all(isinstance(x, dict) for x in items))
    fingerprints = data['fingerprints'].get('items')
    require(isinstance(fingerprints, dict) and set(fingerprints) == names)
    for value in fingerprints.values():
        require(isinstance(value, dict) and set(value) == {'rows', 'md5'}
                and type(value['rows']) is int and value['rows'] >= 0
                and isinstance(value['md5'], str) and re.fullmatch(r'[a-f0-9]{32}', value['md5']) is not None)
    computed = p.report(capture, data, m)
    require(saved_json(folder, 'report.SANITISED.json') == computed)
    require(computed['read_only_collection'] == 'PASS' and computed['original_application_baseline'] == 'PASS'
            and computed['candidate_install_privileges'] == 'PASS' and computed['existing_guard_schema'] is False
            and computed['installation'] == 'NO-GO' and not computed['baseline_change_categories'])
    require(data['authority'].get('database_create') is True
            and all(t.get('effective_owner') is True for t in data['tables']['items'])
            and any(s.get('name') == 'public' and s.get('create') is True
                    for s in data['authority'].get('schemas', []) if isinstance(s, dict)))
    # These are private local hashes recorded NOW, not a retroactive signature of
    # the collection. No output checksum was sealed by the 8eda5d8 collector.
    return folder, m, data, hashes


def binding_review(data, explicit=None):
    """Reuse an existing Mac-local derivation only; never derive or run resolver SQL.

    The historical folder name contains LIVE, but this is saved local evidence,
    not access to a LIVE database. Invalid newest evidence never falls back.
    """
    folder = None
    if explicit is not None:
        folder = Path(explicit).expanduser()
    else:
        parent = Path.home() / 'Documents/ImInGolf-LIVE-Inspection'
        if parent.is_symlink():
            return 'SAVED_PIN_BINDING_INVALID', None
        if parent.exists():
            found = sorted(x for x in parent.iterdir()
                           if re.fullmatch(r'pin-binding-review-\d{8}T\d{6}\.\d{6}Z', x.name))
            if found:
                folder = found[-1]
    if folder is None:
        return 'SAVED_PIN_BINDING_NOT_FOUND', None
    try:
        folder = private_directory(folder)
        manifest_hash = p.digest(p.private_file(folder / 'manifest.SANITISED.json', 'saved binding'))
        m = saved_json(folder, 'manifest.SANITISED.json')
        path = p.private_file(folder / 'resolver.PRIVATE.REVIEW.sql', 'saved binding')
        require(path.stat().st_size <= p.LIMIT)
        # The generator hashes the original UTF-8 text before writing it. Bind
        # these exact saved bytes; read_text() would normalise CR/CRLF to LF.
        raw = path.read_bytes()
        resolver_hash = sha(raw)
        require(m.get('project') in (p.PROJECT, 'kzzzputsqxdntfqpprnz')
                and m.get('source_predicate_and_path_preserved') is True and m.get('projection_only_change') is True
                and type(m.get('database_connections')) is int and m['database_connections'] == 0
                and m.get('sql_execution_authorised') is False)
        require(isinstance(m.get('source_definition_sha256'), str)
                and re.fullmatch(r'[a-f0-9]{64}', m['source_definition_sha256']) is not None
                and m.get('resolver_sql_sha256') == resolver_hash)
        text = raw.decode('utf-8')  # Strict decoding of the same verified bytes.
        require(text.startswith('-- PRIVATE REVIEW ONLY;')
                and 'FUNCTION iig_closed_entry.resolve_pin(p_pin text) RETURNS text' in text)
        getters = [f for f in data['functions']['items']
                   if f.get('schema') == 'public' and f.get('name') == 'get_group_state']
        matched = (len(getters) == 1 and getters[0].get('signature') == 'public.get_group_state(text)'
                   and isinstance(getters[0].get('definition'), str)
                   and sha(getters[0]['definition'].encode()) == m['source_definition_sha256'])
        require(p.digest(folder / 'manifest.SANITISED.json') == manifest_hash and p.digest(path) == resolver_hash)
        pointers = {'folder': str(folder), 'manifest_sha256': manifest_hash,
                    'resolver_sql_sha256': resolver_hash, 'source_definition_sha256': m['source_definition_sha256']}
        return ('MATCHED_SAVED_TEST_GETTER_REVIEW_REQUIRED' if matched else 'SAVED_PIN_BINDING_TEST_PARITY_UNPROVEN'), pointers
    except Exception:
        return 'SAVED_PIN_BINDING_INVALID', None


def build_review(folder, pin_binding=None):
    folder, manifest, data, saved_hashes = load_saved(folder)
    binding_status, binding = binding_review(data, pin_binding)
    group = [t for t in data['tables']['items'] if (t.get('schema'), t.get('name')) == ('public', 'tens_in_groups')]
    require(len(group) == 1)
    columns = group[0].get('columns')
    supported = (isinstance(columns, list) and all(isinstance(c, dict) for c in columns)
                 and len({c.get('name') for c in columns}) == len(columns)
                 and any(c.get('name') == 'id' and c.get('type') in ('uuid', 'text', 'integer', 'bigint') for c in columns)
                 and any(c.get('name') == 'state' and c.get('type') == 'jsonb' for c in columns))
    collisions = any(f.get('schema') == 'public' and f.get('name') in PUBLIC_RPCS for f in data['functions']['items'])
    collisions = collisions or any(t.get('table') == 'public.tens_in_groups' and t.get('name') == 'iig_entry_before_write'
                                   for t in data['triggers']['items'])
    gates = list(PREINSTALL_GATES)
    if binding_status != 'MATCHED_SAVED_TEST_GETTER_REVIEW_REQUIRED':
        gates.insert(0, binding_status)
    if not supported:
        gates.insert(0, 'CANONICAL_TABLE_SHAPE_UNSUPPORTED_OR_MISSING')
    if collisions:
        gates.insert(0, 'CANDIDATE_OBJECT_NAME_COLLISION')
    complete = all({'schema','name','signature','definition','owner','acl_raw','settings',
                    'security_definer','effective_owner','execute'} <= set(f) for f in data['functions']['items'])
    complete = complete and all({'columns','constraints','indexes','privileges','acl','rls','force_rls','owner'} <= set(t)
                                for t in data['tables']['items'])
    complete = complete and all({'enabled','definition','function_signature','function_definition','function_config',
                                 'function_owner','dependencies'} <= set(t) for t in data['triggers']['items'])
    complete = complete and {'extensions','event_triggers','default_acl','cron_table_exists'} <= set(data['platform'])
    complete = complete and 'memberships' in data['authority']
    if not complete:
        gates.insert(0, 'SAVED_CATALOG_SECURITY_METADATA_INCOMPLETE')
    candidate_hashes = {name: p.digest(p.ROOT / name) for name in CANDIDATE_FILES}
    template = (p.ROOT / PLAN_FILE).read_text()
    baseline = {
        'format': 1, 'project': p.PROJECT, 'source_development_base': BASE_COMMIT,
        'saved_package': str(folder), 'saved_file_sha256': saved_hashes,
        'original_input_paths': manifest['input_paths'], 'original_input_sha256': manifest['input_hashes'],
        'collector_code_sha256': manifest['code_hashes'], 'reviewer_sha256': p.digest(Path(__file__)),
        'plan_template_sha256': sha(template.encode()), 'candidate_file_sha256': candidate_hashes,
        'saved_catalog_section_sha256': {name: json_sha(data[name]) for name in sorted(p.SECTIONS)},
        'application_fingerprints': data['fingerprints']['items'],
        'saved_pin_binding': binding, 'pin_binding_status': binding_status,
        'hashes_recorded_at_review_not_collection': True, 'historical_output_authenticity_proven': False,
        'current_online_state_verified': False, 'database_connections_this_review': 0,
        'installation': 'NO-GO', 'sql_execution_authorised': False, 'rollback_executable': False,
        'preserve_existing_security_metadata': True, 'retain_private_runtime_tables': list(PRIVATE_TABLES),
        'preinstallation_blockers': gates, 'activation_blockers': list(ACTIVATION_GATES),
    }
    baseline_id = json_sha(baseline)
    # This entire shareable object is constructed from fixed labels, booleans and
    # bounded counts. Never copy arbitrary catalog/report/writer text into it.
    safe = {'format': 1, 'project': p.PROJECT, 'status': 'OFFLINE_REVIEW_PREPARED',
            'installation': 'NO-GO', 'database_connections_this_review': 0,
            'saved_inspection_attempts': 1, 'saved_identity_tls_readonly': 'PASS',
            'saved_baseline_and_report_consistency': 'PASS',
            'saved_install_privilege_checks': 'PASS_NOT_COMPLETE_DDL_AUTHORITY_PROOF',
            'current_online_state_verified': False, 'outputs_hashed_at_review_not_collection': True,
            'fingerprinted_tables': len(data['fingerprints']['items']),
            'saved_function_count': len(data['functions']['items']), 'saved_trigger_count': len(data['triggers']['items']),
            'saved_session_count': len(data['writers']['items']), 'writer_control': 'UNVERIFIED',
            'full_restore_proven': False, 'historical_backup_checksum_available': False,
            'pin_binding': binding_status, 'canonical_table_shape_supported': supported,
            'saved_security_metadata_fields_present': complete,
            'candidate_object_collision': collisions, 'preinstallation_blockers': gates,
            'activation_blockers': list(ACTIVATION_GATES), 'executable_install_or_rollback_generated': False}
    plan = ('# Private saved TEST baseline review\n\n'
            'Installation NO-GO. This document is not SQL and is not executable.\n\n'
            'Baseline SHA-256: `' + baseline_id + '`\n\n'
            'Exact source file and section hashes, original input pointers and saved fingerprints '
            'are in `baseline.PRIVATE.json`. Read definitions and security metadata only from '
            'the matching original `catalog.PRIVATE.json`; no source SQL is copied or executed.\n\n'
            '## Blockers for this saved package\n\n' +
            '\n'.join('- ' + gate for gate in gates) + '\n\n' + template)
    for name, expected in saved_hashes.items():
        require(p.digest(p.private_file(folder / name, 'saved evidence')) == expected)
    for key in INPUTS:
        require(p.digest(p.private_file(manifest['input_paths'][key], 'original input')) == manifest['input_hashes'][key])
    for name, expected in candidate_hashes.items():
        require(p.digest(p.ROOT / name) == expected)
    require(p.digest(p.ROOT / PLAN_FILE) == baseline['plan_template_sha256'])
    if binding is not None:
        saved_binding = private_directory(binding['folder'])
        for name, key in [('manifest.SANITISED.json', 'manifest_sha256'),
                          ('resolver.PRIVATE.REVIEW.sql', 'resolver_sql_sha256')]:
            require(p.digest(p.private_file(saved_binding / name, 'saved binding')) == binding[key])
    return baseline, safe, plan


def prepare_review(folder, out=None, pin_binding=None):
    baseline, safe, plan = build_review(folder, pin_binding)
    source = Path(baseline['saved_package'])
    if out is None:
        out = Path.home() / 'Documents/ImInGolf-TEST-Installation' / (
            'closed-entry-saved-review-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ'))
    out = Path(out).expanduser().absolute()
    require(not out.exists() and not out.is_symlink() and out.parent.is_dir() and out.resolve() == out)
    require(not out.is_relative_to(p.ROOT) and not out.is_relative_to(source.parent))
    require(not any(Path(path).resolve().is_relative_to(out) for path in baseline['original_input_paths'].values()))
    out.mkdir(mode=0o700)
    for name, value in (('baseline.PRIVATE.json', json.dumps(baseline, indent=2, allow_nan=False) + '\n'),
                        ('review.SANITISED.json', json.dumps(safe, indent=2) + '\n'),
                        ('INSTALL-ROLLBACK-PLAN.PRIVATE.md', plan)):
        p.write_new(out / name, value)
    return out, safe


class QuietParser(argparse.ArgumentParser):
    def error(self, message):
        self.exit(2, 'STOP — invalid offline-review arguments; private values withheld.\n')


def main(argv=None):
    parser = QuietParser(description=__doc__)
    parser.add_argument('--package', type=Path, required=True)
    parser.add_argument('--pin-binding-folder', type=Path)
    parser.add_argument('--out', type=Path)
    args = parser.parse_args(argv)
    try:
        out, safe = prepare_review(args.package, args.out, args.pin_binding_folder)
        print('PASS — saved TEST evidence reviewed OFFLINE. Installation NO-GO. New database connections: 0')
        print('Private review folder: ' + str(out))
        print('Share only this sanitised summary:')
        print(json.dumps(safe, indent=2))
        return 0
    except Exception:
        print('STOP — saved evidence/binding/output validation failed; private details withheld. New database connections: 0')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
