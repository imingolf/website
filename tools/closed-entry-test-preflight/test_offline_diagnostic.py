import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
spec=importlib.util.spec_from_file_location('offline_diagnostic',HERE/'diagnose-offline.py')
d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d)
p=d.p

class OfflineDiagnostic(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.folder=self.root/'package';self.folder.mkdir(mode=0o700)
        self.paths={}
        for k in ('capture','rollback','backup','service','ca'):
            path=self.root/k;path.write_text('{}' if k=='capture' else 'PRIVATE_SECRET');path.chmod(0o600);self.paths[k]=str(path)
        self.sql='FICTIONAL_REVIEWED_QUERY'
        self.manifest={'project':p.PROJECT,'mode':'READONLY_REVIEW_NOT_INSTALLABLE','code_hashes':p.code_hashes(),
          'input_paths':self.paths,'input_hashes':{k:p.digest(v) for k,v in self.paths.items()},
          'sql_sha256':hashlib.sha256(self.sql.encode()).hexdigest()}
        self.write('manifest.PRIVATE.json',self.manifest)
        self.write('connection-attempt.json',{'project':p.PROJECT,'connections_attempted':1})
        p.write_new(self.folder/'inspection.READONLY.sql',self.sql)
    def write(self,name,data):
        path=self.folder/name;path.write_text(json.dumps(data));path.chmod(0o600)
    def run_diagnostic(self,**changes):
        with patch('socket.socket',side_effect=AssertionError('NO NETWORK')),patch('socket.getaddrinfo',side_effect=AssertionError('NO DNS')),patch('subprocess.run',side_effect=AssertionError('NO PROCESS')),patch.object(p,'service'),patch.object(p,'certificate'),patch.object(p,'build_sql',return_value=self.sql):
            return d.diagnose(self.folder)
    def test_no_invented_failure_category(self):
        self.assertEqual(self.run_diagnostic(),'UNDETERMINED_ORIGINAL_ERROR_NOT_RETAINED')
    def test_reads_only_no_new_files_or_modified_evidence(self):
        before={str(x):x.read_bytes() for x in self.root.rglob('*') if x.is_file()}
        self.run_diagnostic()
        after={str(x):x.read_bytes() for x in self.root.rglob('*') if x.is_file()}
        self.assertEqual(before,after)
    def test_input_drift(self):
        Path(self.paths['ca']).write_text('different')
        self.assertEqual(self.run_diagnostic(),'LOCAL_PACKAGE_OR_INPUT_VALIDATION_FAILED')
    def test_wrong_project(self):
        self.manifest['project']='not-test';self.write('manifest.PRIVATE.json',self.manifest)
        self.assertEqual(self.run_diagnostic(),'LOCAL_PACKAGE_OR_INPUT_VALIDATION_FAILED')
    def test_local_CA_invalid(self):
        with patch.object(p,'service'),patch.object(p,'certificate',side_effect=ValueError('SECRET')):
            self.assertEqual(d.diagnose(self.folder),'LOCAL_CA_CONFIGURATION_INVALID')
    def test_local_service_invalid(self):
        with patch.object(p,'service',side_effect=ValueError('SECRET')):
            self.assertEqual(d.diagnose(self.folder),'LOCAL_TEST_SERVICE_CONFIGURATION_INVALID')
    def test_query_drift(self):
        (self.folder/'inspection.READONLY.sql').write_text('modified')
        self.assertEqual(self.run_diagnostic(),'LOCAL_QUERY_OR_BASELINE_VALIDATION_FAILED')
    def test_missing_marker(self):
        (self.folder/'connection-attempt.json').unlink()
        self.assertEqual(self.run_diagnostic(),'NO_RECORDED_CONNECTION_ATTEMPT')
    def test_wrong_attempt_marker(self):
        self.write('connection-attempt.json',{'project':'other','connections_attempted':1})
        self.assertEqual(self.run_diagnostic(),'LOCAL_ATTEMPT_EVIDENCE_INVALID')
    def test_after_collection_not_misclassified_as_TLS(self):
        self.write('catalog.PRIVATE.json',{'private':'SECRET'})
        self.assertEqual(self.run_diagnostic(),'POST_COLLECTION_FAILURE_REQUIRES_SAVED_REPORT_REVIEW')
    def test_only_fixed_label_output_no_private_values(self):
        with patch.object(d,'diagnose',return_value='UNDETERMINED_ORIGINAL_ERROR_NOT_RETAINED'),contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(d.main(['--package',str(self.folder)]),0)
        self.assertEqual(out.getvalue(),'Failure category: UNDETERMINED_ORIGINAL_ERROR_NOT_RETAINED\n')
        self.assertNotIn(str(self.folder),out.getvalue())
    def test_no_connect_switch(self):
        with contextlib.redirect_stderr(io.StringIO()),self.assertRaises(SystemExit):d.main(['--package',str(self.folder),'--connect-test-readonly',p.PROJECT])
    def test_private_directory_required(self):
        self.folder.chmod(0o755)
        self.assertEqual(self.run_diagnostic(),'LOCAL_PACKAGE_OR_INPUT_VALIDATION_FAILED')

    def test_all_retained_categories_read_without_process_network_or_writes(self):
        for category in p.FAILURE_CATEGORIES:
            with self.subTest(category=category):
                (self.folder/p.FAILURE_FILE).unlink(missing_ok=True)
                with self.assertRaises(p.DiagnosticStop):p.stop_with_failure(self.folder,category)
                before={str(x):x.read_bytes() for x in self.root.rglob('*') if x.is_file()}
                self.assertEqual(self.run_diagnostic(),category)
                self.assertEqual(before,{str(x):x.read_bytes() for x in self.root.rglob('*') if x.is_file()})

    def test_rejects_unknown_category_extra_fields_and_wrong_binding(self):
        valid=p.failure_record(self.folder,'TLS_FAILURE')
        cases=[{**valid,'category':'PRIVATE_SECRET'}, {**valid,'stderr':'PRIVATE_SECRET'},
            {**valid,'manifest_sha256':'f'*64}, {**valid,'project':'other'},
            {**valid,'format':True}, {**valid,'connections_attempted':True},
            {**valid,'connections_attempted':2}, {**valid,'format':2},
            {k:v for k,v in valid.items() if k!='manifest_sha256'},[],None]
        for value in cases:
            with self.subTest(value=value):
                self.write(p.FAILURE_FILE,value)
                self.assertEqual(self.run_diagnostic(),'LOCAL_ATTEMPT_EVIDENCE_INVALID')

    def test_rejects_malformed_oversized_and_public_failure_file(self):
        self.write(p.FAILURE_FILE,p.failure_record(self.folder,'TLS_FAILURE'))
        path=self.folder/p.FAILURE_FILE
        for value in ['PRIVATE_SECRET','x'*4097]:
            path.write_text(value)
            self.assertEqual(self.run_diagnostic(),'LOCAL_ATTEMPT_EVIDENCE_INVALID')
        self.write(p.FAILURE_FILE,p.failure_record(self.folder,'TLS_FAILURE'));path.chmod(0o644)
        self.assertEqual(self.run_diagnostic(),'LOCAL_ATTEMPT_EVIDENCE_INVALID')

    def test_rejects_symlinked_failure_or_attempt_evidence(self):
        for name in [p.FAILURE_FILE,'connection-attempt.json']:
            with self.subTest(name=name):
                path=self.folder/name;path.unlink(missing_ok=True);path.symlink_to(self.root/'absent')
                self.assertEqual(self.run_diagnostic(),'LOCAL_ATTEMPT_EVIDENCE_INVALID')
                path.unlink()
        self.write('connection-attempt.json',{'project':p.PROJECT,'connections_attempted':True})
        self.assertEqual(self.run_diagnostic(),'LOCAL_ATTEMPT_EVIDENCE_INVALID')

    def test_missing_attempt_with_diagnostic_is_invalid(self):
        self.write(p.FAILURE_FILE,p.failure_record(self.folder,'TLS_FAILURE'))
        (self.folder/'connection-attempt.json').unlink()
        self.assertEqual(self.run_diagnostic(),'LOCAL_ATTEMPT_EVIDENCE_INVALID')

    def test_conflicting_collection_or_report_not_treated_as_TLS(self):
        self.write(p.FAILURE_FILE,p.failure_record(self.folder,'TLS_FAILURE'))
        for name in ['catalog.PRIVATE.json','report.SANITISED.json']:
            self.write(name,{'private':'PRIVATE_SECRET'})
            self.assertEqual(self.run_diagnostic(),'LOCAL_ATTEMPT_EVIDENCE_INVALID')
            (self.folder/name).unlink()

    def test_retained_category_does_not_bypass_code_input_or_query_integrity(self):
        self.write(p.FAILURE_FILE,p.failure_record(self.folder,'TLS_FAILURE'))
        self.manifest['code_hashes']['preflight.py']='old-runner-hash'
        self.write('manifest.PRIVATE.json',self.manifest)
        self.assertEqual(self.run_diagnostic(),'LOCAL_PACKAGE_OR_INPUT_VALIDATION_FAILED')
        self.manifest['code_hashes']=p.code_hashes();self.write('manifest.PRIVATE.json',self.manifest)
        (self.folder/'inspection.READONLY.sql').write_text('PRIVATE_QUERY_DRIFT')
        self.assertEqual(self.run_diagnostic(),'LOCAL_QUERY_OR_BASELINE_VALIDATION_FAILED')

    def test_saved_record_cannot_be_overwritten(self):
        self.write(p.FAILURE_FILE,p.failure_record(self.folder,'TLS_FAILURE'))
        before=(self.folder/p.FAILURE_FILE).read_bytes()
        with self.assertRaises(FileExistsError):p.stop_with_failure(self.folder,'AUTHENTICATION_FAILURE')
        self.assertEqual((self.folder/p.FAILURE_FILE).read_bytes(),before)

if __name__=='__main__':unittest.main()
