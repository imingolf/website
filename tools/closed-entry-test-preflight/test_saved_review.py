import contextlib
import copy
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import test_preflight as fixtures

spec = importlib.util.spec_from_file_location('saved_test_review', Path(__file__).with_name('review-saved.py'))
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
p = r.p


class SavedReview(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.Safety()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.root = self.fixture.root
        self.folder = self.fixture.prepare()
        review_tmp = tempfile.TemporaryDirectory()
        self.addCleanup(review_tmp.cleanup)
        self.review_root = Path(review_tmp.name)
        self.out = self.review_root / 'review'
        self.data = self.fixture.data()
        self.data['functions']['items'][0].update(schema='public', name='save_group_state',
            effective_owner=True, execute={'anon': True, 'authenticated': True, 'service_role': True})
        self.getter = {'schema':'public', 'name':'get_group_state', 'signature':'public.get_group_state(text)',
            'definition':'CREATE FUNCTION public.get_group_state(p_pin text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$ SELECT state FROM public.tens_in_groups WHERE pin = p_pin AND secret = \'PRIVATE_GETTER_LITERAL\' $$;',
            'owner':'postgres', 'acl_raw':None, 'settings':['search_path=public'],
            'security_definer':True, 'effective_owner':True, 'execute':{'anon':True}}
        self.data['functions']['items'].append(self.getter)
        for table in self.data['tables']['items']:
            table.update(columns=[{'name':'id','type':'uuid'}, {'name':'state','type':'jsonb'}],
                constraints=[], indexes=[], privileges={'anon':{'select':False}})
        self.data['triggers']['items'][0].update(function_signature='public.private_hook()',
            function_definition="PRIVATE_HOOK_PASSWORD_LITERAL",function_config=None,
            function_owner='PRIVATE_OWNER',dependencies=[{'identity':'PRIVATE_DEPENDENCY'}])
        self.data['authority']['memberships'] = [{'role':'PRIVATE_ROLE','member':'PRIVATE_MEMBER'}]
        self.data['platform'].update(extensions=[],event_triggers=[],cron_table_exists=False)
        self.data['writers']['items'] = [{'application':'PRIVATE_APP','address':'PRIVATE_IP'}]
        self.manifest = json.loads((self.folder/'manifest.PRIVATE.json').read_text())
        self.write('connection-attempt.json',{'project':p.PROJECT,'connections_attempted':1})
        self.save_capture()
        self.stack = contextlib.ExitStack()
        self.addCleanup(self.stack.close)
        for target in ['socket.socket','socket.getaddrinfo','subprocess.run','subprocess.Popen','getpass.getpass']:
            self.stack.enter_context(patch(target,side_effect=AssertionError('FORBIDDEN_NETWORK_OR_PROCESS')))
        for name in ['connect','prepare','package','archive_evidence']:
            self.stack.enter_context(patch.object(p,name,side_effect=AssertionError('FORBIDDEN_CONNECTION_OR_PREPARATION')))
        self.stack.enter_context(patch.object(p.ssl,'create_default_context'))
        self.stack.enter_context(patch.object(Path,'home',return_value=self.root))

    def write(self,name,value):
        path=self.folder/name
        path.write_text(json.dumps(value));path.chmod(0o600)

    def save_capture(self):
        self.write('catalog.PRIVATE.json',self.data)
        self.write('report.SANITISED.json',p.report(self.fixture.capture(),self.data,self.manifest))

    def snapshots(self):
        return {str(x):x.read_bytes() for root in [self.root,self.review_root]
                for x in root.rglob('*') if x.is_file() and not x.is_symlink()}

    def bind(self,name='pin-binding-review-20261025T120000.000001Z',**changes):
        folder=self.root/'Documents/ImInGolf-LIVE-Inspection'/name
        folder.mkdir(parents=True,mode=0o700)
        text='-- PRIVATE REVIEW ONLY; fixture\nCREATE OR REPLACE FUNCTION iig_closed_entry.resolve_pin(p_pin text) RETURNS text AS $$ PRIVATE_RESOLVER_SECRET $$;\n'
        manifest={'project':'kzzzputsqxdntfqpprnz','source_definition_sha256':r.sha(self.getter['definition'].encode()),
            'resolver_sql_sha256':r.sha(text.encode()),'source_predicate_and_path_preserved':True,
            'projection_only_change':True,'database_connections':0,'sql_execution_authorised':False}
        manifest.update(changes)
        p.write_new(folder/'resolver.PRIVATE.REVIEW.sql',text)
        p.write_new(folder/'manifest.SANITISED.json',json.dumps(manifest))
        return folder

    def test_successful_saved_review_never_connects_or_modifies_evidence(self):
        before=self.snapshots()
        baseline,safe,plan=r.build_review(self.folder)
        self.assertEqual(before,self.snapshots())
        self.assertEqual(safe['saved_identity_tls_readonly'],'PASS')
        self.assertEqual(safe['installation'],'NO-GO')
        self.assertEqual(safe['database_connections_this_review'],0)
        self.assertFalse(safe['current_online_state_verified'])
        self.assertFalse(safe['executable_install_or_rollback_generated'])
        self.assertEqual(set(baseline['saved_catalog_section_sha256']),p.SECTIONS)
        self.assertEqual(baseline['application_fingerprints'],self.data['fingerprints']['items'])
        adapter='supabase/closed-entry-candidate/authenticated-writers.sql'
        self.assertEqual(baseline['candidate_file_sha256'][adapter],p.digest(p.ROOT/adapter))
        self.assertIn(r.json_sha(baseline),plan)
        self.assertTrue(safe['saved_security_metadata_fields_present'])
        self.assertTrue(safe['canonical_table_shape_supported'])

    def test_private_new_output_modes_and_no_executable_SQL(self):
        before=self.snapshots()
        out,safe=r.prepare_review(self.folder,self.out)
        self.assertEqual(out.stat().st_mode&0o777,0o700)
        self.assertEqual({f.name for f in out.iterdir()},
            {'baseline.PRIVATE.json','review.SANITISED.json','INSTALL-ROLLBACK-PLAN.PRIVATE.md'})
        for f in out.iterdir():self.assertEqual(f.stat().st_mode&0o777,0o600)
        for path,value in before.items():self.assertEqual(Path(path).read_bytes(),value)
        self.assertEqual(json.loads((out/'review.SANITISED.json').read_text()),safe)
        self.assertNotIn('PRIVATE_HOOK_PASSWORD_LITERAL',(out/'INSTALL-ROLLBACK-PLAN.PRIVATE.md').read_text())

    def test_sanitised_output_never_reflects_raw_evidence_or_paths(self):
        self.bind()
        self.write('writers.REVIEW.json',{'arbitrary':'PRIVATE_WRITER_SECRET'})
        with contextlib.redirect_stdout(io.StringIO()) as printed:
            self.assertEqual(r.main(['--package',str(self.folder),'--out',str(self.out)]),0)
        summary=printed.getvalue().split('Share only this sanitised summary:\n')[1]
        for text in ['PRIVATE_GETTER_LITERAL','PRIVATE_RESOLVER_SECRET','PRIVATE_HOOK_PASSWORD_LITERAL',
                     'PRIVATE_OWNER','PRIVATE_ROLE','PRIVATE_IP','PRIVATE_APP','PRIVATE_WRITER_SECRET',str(self.folder)]:
            self.assertNotIn(text,summary)
        safe=json.loads(summary)
        self.assertEqual(safe['saved_session_count'],1)
        self.assertEqual(safe['writer_control'],'UNVERIFIED')
        self.assertFalse(safe['full_restore_proven'])
        self.assertFalse(safe['historical_backup_checksum_available'])

    def test_missing_or_unsafe_saved_file_stops(self):
        for name in r.SAVED_FILES:
            with self.subTest(name=name):
                path=self.folder/name;original=path.read_bytes();path.unlink()
                with self.assertRaises(Exception):r.build_review(self.folder)
                path.write_bytes(original);path.chmod(0o644)
                with self.assertRaises(Exception):r.build_review(self.folder)
                path.chmod(0o600)

    def test_symlinked_package_and_saved_file_rejected(self):
        link=self.root/'link';link.symlink_to(self.folder,target_is_directory=True)
        with self.assertRaises(Exception):r.build_review(link)
        name=self.folder/'catalog.PRIVATE.json';name.rename(self.root/'catalog-copy')
        name.symlink_to(self.root/'catalog-copy')
        with self.assertRaises(Exception):r.build_review(self.folder)

    def test_package_permissions_or_owner_rejected(self):
        self.folder.chmod(0o755)
        with self.assertRaises(Exception):r.build_review(self.folder)
        self.folder.chmod(0o700)
        with patch.object(p.os,'getuid',return_value=-1),self.assertRaises(Exception):r.build_review(self.folder)

    def test_manifest_identity_code_and_scope_drift_rejected(self):
        for key,value in [('project','other'),('mode','INSTALL'),('code_hashes',{}),
                ('table_scope',[]),('input_paths',{}),('input_hashes',{}),
                ('installation_approved',True),('auth_table_rows_read',True),
                ('database_connections',True),('database_connections',1),
                ('original_rollback_reused_as_incident_rollback',True)]:
            with self.subTest(key=key,value=value):
                changed=copy.deepcopy(self.manifest);changed[key]=value
                self.write('manifest.PRIVATE.json',changed)
                with self.assertRaises(Exception):r.build_review(self.folder)
        self.write('manifest.PRIVATE.json',self.manifest)

    def test_original_input_and_query_drift_rejected(self):
        for key,path in self.manifest['input_paths'].items():
            with self.subTest(key=key):
                file=Path(path);original=file.read_bytes();file.write_bytes(b'PRIVATE_DRIFT')
                with self.assertRaises(Exception):r.build_review(self.folder)
                file.write_bytes(original)
        (self.folder/'inspection.READONLY.sql').write_text('PRIVATE_SQL_DRIFT')
        with self.assertRaises(Exception):r.build_review(self.folder)

    def test_failure_or_invalid_attempt_evidence_rejected(self):
        for value in [{'project':p.PROJECT,'connections_attempted':0},
                {'project':p.PROJECT,'connections_attempted':True},
                {'project':'other','connections_attempted':1}]:
            self.write('connection-attempt.json',value)
            with self.assertRaises(Exception):r.build_review(self.folder)
        self.write('connection-attempt.json',{'project':p.PROJECT,'connections_attempted':1})
        self.write(p.FAILURE_FILE,{'category':'TLS_FAILURE'})
        with self.assertRaises(Exception):r.build_review(self.folder)

    def test_saved_identity_checks_remain_strict_even_with_recomputed_report(self):
        original=copy.deepcopy(self.data)
        cases=[('backend_ssl',False),('backend_ssl','true'),('transaction_read_only','off'),
            ('default_transaction_read_only','off'),('database','other'),('role','anon'),
            ('session_role','other'),('project','other'),('version','180000'),('version',170011)]
        for key,value in cases:
            self.data=copy.deepcopy(original);self.data['identity'][key]=value;self.save_capture()
            with self.subTest(key=key,value=value),self.assertRaises(Exception):r.build_review(self.folder)

    def test_report_drift_and_incomplete_saved_catalog_rejected(self):
        report=json.loads((self.folder/'report.SANITISED.json').read_text())
        report['installation']='GO';self.write('report.SANITISED.json',report)
        with self.assertRaises(Exception):r.build_review(self.folder)
        self.save_capture();del self.data['identity'];self.write('catalog.PRIVATE.json',self.data)
        with self.assertRaises(Exception):r.build_review(self.folder)

    def test_baseline_data_and_security_drift_rejected(self):
        original=copy.deepcopy(self.data)
        for section,key,value in [('tables','rls',False),('tables','acl','PRIVATE_CHANGED_ACL'),
                ('functions','owner','PRIVATE_OTHER_OWNER'),('functions','settings',[]),('triggers','enabled','D')]:
            self.data=copy.deepcopy(original);self.data[section]['items'][0][key]=value;self.save_capture()
            with self.subTest(section=section,key=key),self.assertRaises(Exception):r.build_review(self.folder)
        self.data=copy.deepcopy(original);self.data['fingerprints']['items']['public.tens_in_groups']['md5']='b'*32;self.save_capture()
        with self.assertRaises(Exception):r.build_review(self.folder)

    def test_fingerprint_shape_scope_and_counts_not_trusted(self):
        original=copy.deepcopy(self.data)
        for value in [{'rows':True,'md5':'a'*32},{'rows':-1,'md5':'a'*32},
                      {'rows':2,'md5':'PRIVATE_SECRET'},{'rows':2,'md5':'a'*32,'extra':'secret'}]:
            self.data=copy.deepcopy(original);self.data['fingerprints']['items']['public.tens_in_groups']=value;self.save_capture()
            with self.assertRaises(Exception):r.build_review(self.folder)

    def test_insufficient_or_untyped_privilege_and_existing_guard_rejected(self):
        original=copy.deepcopy(self.data)
        for value in [False,'true']:
            self.data=copy.deepcopy(original);self.data['tables']['items'][0]['effective_owner']=value;self.save_capture()
            with self.assertRaises(Exception):r.build_review(self.folder)
        self.data=copy.deepcopy(original);self.data['authority']['guard_schema_exists']=True;self.save_capture()
        with self.assertRaises(Exception):r.build_review(self.folder)

    def test_empty_sessions_or_claimed_writer_controls_never_prove_pause(self):
        self.data['writers']['items']=[];self.save_capture()
        self.write('writers.REVIEW.json',{'all_writers':'APPROVED','recovery':'COMPLETE'})
        _,safe,_=r.build_review(self.folder)
        self.assertEqual(safe['writer_control'],'UNVERIFIED');self.assertFalse(safe['full_restore_proven'])
        self.assertIn('ALL_GROUP_WRITERS_AND_COMPATIBLE_CLIENT_CUTOVER',safe['preinstallation_blockers'])

    def test_pin_binding_reused_and_not_copied_or_regenerated(self):
        binding=self.bind();before=self.snapshots()
        baseline,safe,plan=r.build_review(self.folder)
        self.assertEqual(safe['pin_binding'],'MATCHED_SAVED_TEST_GETTER_REVIEW_REQUIRED')
        self.assertEqual(baseline['saved_pin_binding']['folder'],str(binding))
        self.assertEqual(before,self.snapshots())
        self.assertIn('TEST_PIN_BINDING_SEMANTICS_AND_DEPENDENCIES',safe['preinstallation_blockers'])
        self.assertNotIn('PRIVATE_RESOLVER_SECRET',json.dumps(baseline)+plan)

    def test_original_generator_utf8_bytes_round_trip_without_normalisation(self):
        # Only fictional definitions are derived here; use the actual generator
        # and writer to verify the saved-manifest convention across line endings.
        with patch.object(p.sys,'path',[str(p.ROOT/'tools/closed-entry-inspection'),*p.sys.path]):
            import prepare_pin_binding as generator
        for index,ending in enumerate(['\n','\r\n','\r','\r\n\n']):
            with self.subTest(ending=repr(ending)):
                function={**self.getter,'arguments':'p_pin text','return':'jsonb',
                    'configuration':['search_path=public']}
                function['definition']=('CREATE FUNCTION public.get_group_state(p_pin text) RETURNS jsonb '
                    'LANGUAGE sql SECURITY DEFINER AS $$'+ending+
                    'SELECT state FROM public.tens_in_groups'+ending+
                    "WHERE pin=p_pin AND group_name<>'PRIVATE_£_café' LIMIT 1;"+ending+'$$;')
                table={'schema':'public','name':'tens_in_groups',
                    'columns':[{'name':'id','type':'uuid'},{'name':'state','type':'jsonb'}]}
                sql,manifest=generator.build(function,table)
                binding=self.review_root/('fictional-binding-'+str(index))
                generator.prep.write_new(binding,{'resolver.PRIVATE.REVIEW.sql':sql,
                    'manifest.SANITISED.json':json.dumps(manifest)})
                self.getter['definition']=function['definition'];self.save_capture()
                raw=(binding/'resolver.PRIVATE.REVIEW.sql').read_bytes()
                self.assertEqual(raw,sql.encode('utf-8'))
                self.assertEqual(manifest['resolver_sql_sha256'],r.sha(raw))
                if ending!='\n':
                    self.assertNotEqual(raw,(binding/'resolver.PRIVATE.REVIEW.sql').read_text().encode())
                before=self.snapshots()
                baseline,safe,plan=r.build_review(self.folder,pin_binding=binding)
                self.assertEqual(safe['pin_binding'],'MATCHED_SAVED_TEST_GETTER_REVIEW_REQUIRED')
                self.assertEqual(baseline['saved_pin_binding']['resolver_sql_sha256'],r.sha(raw))
                self.assertEqual(before,self.snapshots())
                self.assertEqual(safe['installation'],'NO-GO')
                self.assertIn('TEST_PIN_BINDING_SEMANTICS_AND_DEPENDENCIES',safe['preinstallation_blockers'])
                self.assertNotIn('PRIVATE_£_café',json.dumps(baseline)+json.dumps(safe)+plan)

    def test_resolver_byte_changes_never_use_a_normalised_hash_fallback(self):
        binding=self.bind();path=binding/'resolver.PRIVATE.REVIEW.sql';original=path.read_bytes()
        for changed in [original.replace(b'\n',b'\r\n'),original.replace(b'\n',b'\r'),
                        original.replace(b'PRIVATE_RESOLVER_SECRET',b'PRIVATE_CHANGED'),original+b'\n']:
            with self.subTest(changed_sha=r.sha(changed)):
                path.write_bytes(changed);before=self.snapshots()
                status,pointers=r.binding_review(self.data,binding)
                self.assertEqual(status,'SAVED_PIN_BINDING_INVALID');self.assertIsNone(pointers)
                self.assertEqual(before,self.snapshots())

    def test_matching_raw_hash_still_requires_utf8_header_and_signature(self):
        binding=self.bind();path=binding/'resolver.PRIVATE.REVIEW.sql';original=path.read_bytes()
        manifest_path=binding/'manifest.SANITISED.json';manifest=json.loads(manifest_path.read_text())
        for raw in [original+b'\xff',b'\xef\xbb\xbf'+original,original.decode().encode('utf-16'),
                    original.replace(b'-- PRIVATE REVIEW ONLY;',b'-- PRIVATE_OTHER_HEADER;'),
                    original.replace(b'p_pin text',b'p_pin varchar')]:
            with self.subTest(raw_sha=r.sha(raw)):
                path.write_bytes(raw);manifest['resolver_sql_sha256']=r.sha(raw)
                manifest_path.write_text(json.dumps(manifest));before=self.snapshots()
                status,pointers=r.binding_review(self.data,binding)
                self.assertEqual(status,'SAVED_PIN_BINDING_INVALID');self.assertIsNone(pointers)
                self.assertEqual(before,self.snapshots())

    def test_saved_test_getter_hash_is_not_normalised(self):
        self.getter['definition']+='\r\n'
        binding=self.bind(source_definition_sha256=r.sha(self.getter['definition'].replace('\r\n','\n').encode()))
        status,_=r.binding_review(self.data,binding)
        self.assertEqual(status,'SAVED_PIN_BINDING_TEST_PARITY_UNPROVEN')

    def test_resolver_line_endings_changed_after_read_fail_integrity_recheck(self):
        binding=self.bind();path=binding/'resolver.PRIVATE.REVIEW.sql'
        original=path.read_bytes();raw=original.replace(b'\n',b'\r\n');path.write_bytes(raw)
        manifest_path=binding/'manifest.SANITISED.json';manifest=json.loads(manifest_path.read_text())
        manifest['resolver_sql_sha256']=r.sha(raw);manifest_path.write_text(json.dumps(manifest))
        original_sha=r.sha;changed=[]
        def change_after_read(value):
            if value==raw and not changed:
                changed.append(True);path.write_bytes(original)
            return original_sha(value)
        with patch.object(r,'sha',side_effect=change_after_read):
            status,pointers=r.binding_review(self.data,binding)
        self.assertEqual(changed,[True])
        self.assertEqual(status,'SAVED_PIN_BINDING_INVALID');self.assertIsNone(pointers)

    def test_missing_or_mismatched_binding_remains_offline_blocker(self):
        _,safe,_=r.build_review(self.folder)
        self.assertEqual(safe['pin_binding'],'SAVED_PIN_BINDING_NOT_FOUND')
        self.bind(source_definition_sha256='b'*64)
        _,safe,_=r.build_review(self.folder)
        self.assertEqual(safe['pin_binding'],'SAVED_PIN_BINDING_TEST_PARITY_UNPROVEN')
        self.assertEqual(safe['database_connections_this_review'],0)

    def test_invalid_newest_binding_never_falls_back(self):
        self.bind()
        self.bind('pin-binding-review-20261025T130000.000001Z',resolver_sql_sha256='bad')
        _,safe,_=r.build_review(self.folder)
        self.assertEqual(safe['pin_binding'],'SAVED_PIN_BINDING_INVALID')

    def test_explicit_binding_can_select_existing_custom_location(self):
        binding=self.bind('custom-existing-binding')
        _,safe,_=r.build_review(self.folder,pin_binding=binding)
        self.assertEqual(safe['pin_binding'],'MATCHED_SAVED_TEST_GETTER_REVIEW_REQUIRED')

    def test_binding_permissions_and_authorisation_mismatch(self):
        binding=self.bind(sql_execution_authorised=True)
        _,safe,_=r.build_review(self.folder,pin_binding=binding)
        self.assertEqual(safe['pin_binding'],'SAVED_PIN_BINDING_INVALID')
        binding.chmod(0o755)
        _,safe,_=r.build_review(self.folder,pin_binding=binding)
        self.assertEqual(safe['pin_binding'],'SAVED_PIN_BINDING_INVALID')

    def test_overloaded_getter_does_not_prove_binding_parity(self):
        self.bind();overload=copy.deepcopy(self.getter);overload['signature']='public.get_group_state(integer)'
        self.data['functions']['items'].append(overload);self.save_capture()
        _,safe,_=r.build_review(self.folder)
        self.assertEqual(safe['pin_binding'],'SAVED_PIN_BINDING_TEST_PARITY_UNPROVEN')

    def test_candidate_name_collision_and_unsupported_shape_are_blockers(self):
        collision=copy.deepcopy(self.getter);collision['name']='iig_entry_write';collision['signature']='public.iig_entry_write(text)'
        self.data['functions']['items'].append(collision)
        self.data['tables']['items'][0]['columns']=[{'name':'id','type':'jsonb'},{'name':'state','type':'text'}]
        self.save_capture();_,safe,_=r.build_review(self.folder)
        self.assertIn('CANDIDATE_OBJECT_NAME_COLLISION',safe['preinstallation_blockers'])
        self.assertIn('CANONICAL_TABLE_SHAPE_UNSUPPORTED_OR_MISSING',safe['preinstallation_blockers'])

    def test_missing_security_metadata_flagged_without_claiming_complete_review(self):
        del self.data['platform']['event_triggers'];self.save_capture()
        _,safe,_=r.build_review(self.folder)
        self.assertFalse(safe['saved_security_metadata_fields_present'])
        self.assertIn('SAVED_CATALOG_SECURITY_METADATA_INCOMPLETE',safe['preinstallation_blockers'])

    def test_authenticated_organiser_rpc_collision_is_a_blocker(self):
        for name in ('iig_operate_owned_group','iig_read_entry_group','iig_prepare_owned_entry'):
            with self.subTest(name=name):
                collision=copy.deepcopy(self.getter)
                collision.update(name=name,signature='public.'+name+'(text)')
                self.data['functions']['items'].append(collision);self.save_capture()
                _,safe,_=r.build_review(self.folder)
                self.assertIn('CANDIDATE_OBJECT_NAME_COLLISION',safe['preinstallation_blockers'])
                self.assertEqual(safe['installation'],'NO-GO')
                self.data['functions']['items'].remove(collision)

    def test_existing_or_source_package_output_never_written(self):
        for out in [self.folder,self.folder/'new-review',self.root]:
            before=self.snapshots()
            with self.subTest(out=out),self.assertRaises(Exception):r.prepare_review(self.folder,out)
            self.assertEqual(before,self.snapshots())

    def test_repeated_review_preserves_previous_review(self):
        r.prepare_review(self.folder,self.out)
        before=self.snapshots()
        with self.assertRaises(Exception):r.prepare_review(self.folder,self.out)
        self.assertEqual(before,self.snapshots())

    def test_plan_preserves_security_and_runtime_data_and_requires_drift_checks(self):
        baseline,safe,plan=r.build_review(self.folder)
        self.assertEqual(set(baseline['retain_private_runtime_tables']),set(r.PRIVATE_TABLES))
        self.assertIn('before checking catalog and row fingerprints',plan)
        self.assertIn('existing group data is rewritten/backfilled',plan)
        self.assertIn('Do not replay obsolete group JSON',plan)
        self.assertIn('ACLs (preserving NULL',plan)
        self.assertIn('never rerun the installer',plan)
        self.assertIn('guard affects all canonical group rows',plan)
        self.assertTrue(safe['outputs_hashed_at_review_not_collection'])
        self.assertFalse(baseline['historical_output_authenticity_proven'])

    def test_changes_during_review_stop_before_output(self):
        def change(data,explicit):
            (self.folder/'catalog.PRIVATE.json').write_text('PRIVATE_CHANGED_EVIDENCE')
            return 'SAVED_PIN_BINDING_NOT_FOUND',None
        with patch.object(r,'binding_review',side_effect=change),self.assertRaises(Exception):
            r.prepare_review(self.folder,self.out)
        self.assertFalse(self.out.exists())

    def test_original_input_changed_during_review_stops(self):
        def change(data,explicit):
            Path(self.manifest['input_paths']['backup']).write_bytes(b'PRIVATE_CHANGED_BACKUP')
            return 'SAVED_PIN_BINDING_NOT_FOUND',None
        with patch.object(r,'binding_review',side_effect=change),self.assertRaises(Exception):
            r.prepare_review(self.folder,self.out)
        self.assertFalse(self.out.exists())

    def test_binding_changed_after_comparison_stops(self):
        folder=self.bind();original=r.binding_review
        def change(data,explicit):
            result=original(data,explicit)
            (folder/'resolver.PRIVATE.REVIEW.sql').write_text('PRIVATE_CHANGED_RESOLVER')
            return result
        with patch.object(r,'binding_review',side_effect=change),self.assertRaises(Exception):
            r.prepare_review(self.folder,self.out)
        self.assertFalse(self.out.exists())

    def test_no_connection_or_install_command_line_option(self):
        for flag in ['--connect-test-readonly','--connect-live-readonly','--install','--execute']:
            with contextlib.redirect_stderr(io.StringIO()) as error,self.assertRaises(SystemExit):
                r.main(['--package',str(self.folder),flag,'PRIVATE_SECRET'])
            self.assertNotIn('PRIVATE_SECRET',error.getvalue())

    def test_failure_CLI_suppresses_raw_exception_and_private_paths(self):
        with patch.object(r,'prepare_review',side_effect=ValueError('PRIVATE_SECRET /private/path')), contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(r.main(['--package',str(self.folder)]),1)
        self.assertEqual(output.getvalue(),'STOP — saved evidence/binding/output validation failed; private details withheld. New database connections: 0\n')


if __name__ == '__main__':
    unittest.main()
