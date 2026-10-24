import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parent))
import followup_runner as r
class FollowupRunner(unittest.TestCase):
 def params(self):return {'table_oids':[100],'function_oids':[1,2]}
 def output(self):return '\n'.join(['1']*4+[
  json.dumps(dict(section='candidate_bindings',count=2,within_reviewed_limit=True,items=[{'oid':'1'},{'oid':'2'}])),
  json.dumps(dict(section='target_constraints_indexes',items=[{'table_oid':'100'}])),
  json.dumps(dict(section='target_trigger_dependencies',items=[]))])
 def test_default_offline_never_connects_or_prompts(self):
  with patch.object(r,'load_package',return_value=('SELECT metadata;',self.params())),patch.object(r.subprocess,'run',side_effect=AssertionError('No process')),patch('builtins.input',side_effect=AssertionError('No prompt')),contextlib.redirect_stdout(io.StringIO()) as out:
   self.assertEqual(r.main(['--saved-folder','source','--package','package']),0)
  self.assertIn('attempted: 0',out.getvalue())
 def test_parse_strict_guards(self):
  self.assertEqual(len(r.parse(self.output(),self.params())),3)
  for bad in [self.output().replace('1\n','0\n',1),'NOTICE\n'+self.output(),self.output()+'\n{}']:
   with self.subTest(bad=bad),self.assertRaises(Exception):r.parse(bad,self.params())
 def test_target_scope_not_expandable(self):
  raw=self.output().replace('"100"','"999"')
  with self.assertRaises(ValueError):r.parse(raw,self.params())
 def test_missing_original_function_rejected(self):
  params=self.params();params['function_oids']=[1,2,3]
  with self.assertRaises(ValueError):r.parse(self.output(),params)
 def test_limit_and_false_marker_rejected(self):
  raw=self.output().replace('"within_reviewed_limit": true','"within_reviewed_limit": false')
  with self.assertRaises(ValueError):r.parse(raw,self.params())
 def test_execute_single_process_direct_verifyfull_no_secret_files(self):
  result=type('Result',(),dict(returncode=0,stdout=self.output(),stderr=''))()
  with tempfile.TemporaryDirectory() as d,patch.object(r.subprocess,'run',return_value=result) as run:
   out=Path(d)/'new';r.execute({'host':r.original.DIRECT,'ca_file':'/private/official.crt'},'FIXED METADATA',self.params(),out,'SECRET_PASSWORD','/usr/bin/psql')
   self.assertEqual(run.call_count,1);args,kw=run.call_args
   self.assertNotIn('SECRET_PASSWORD',' '.join(args[0]));self.assertNotIn('shell',kw)
   self.assertEqual(kw['env']['PGSSLMODE'],'verify-full');self.assertEqual(kw['env']['PGHOST'],r.original.DIRECT)
   for file in out.iterdir():self.assertNotIn('SECRET_PASSWORD',file.read_text());self.assertEqual(file.stat().st_mode&0o777,0o600)
 def test_error_no_retry_no_raw_stderr(self):
  result=type('Result',(),dict(returncode=1,stdout='',stderr='SECRET_RAW_ERROR'))()
  with tempfile.TemporaryDirectory() as d,patch.object(r.subprocess,'run',return_value=result) as run,self.assertRaises(ValueError):
   r.execute({'host':r.original.DIRECT,'ca_file':'ca'},'FIXED',self.params(),Path(d)/'new','SECRET','psql')
  self.assertEqual(run.call_count,1)
 def test_noninteractive_connection_rejected_before_process(self):
  with patch.object(r,'load_package',return_value=('SQL',self.params())),patch.object(r.original,'configuration',return_value={'host':r.original.DIRECT}),patch.object(r.sys.stdin,'isatty',return_value=False),patch.object(r.subprocess,'run') as run,contextlib.redirect_stderr(io.StringIO()):
   self.assertEqual(r.main(['--saved-folder','source','--package','package','--config','private','--connect-live-followup-readonly',r.prep.PROJECT]),1);run.assert_not_called()
 def test_real_package_regeneration_and_tamper_rejection(self):
  from test_prepare_followup import fixture
  with tempfile.TemporaryDirectory() as d:
   source=Path(d)/'saved';source.mkdir(mode=0o700);rows,report=fixture()
   for name,data in [('catalog-private.json',rows),('report.json',report)]:
    path=source/name;path.write_text(json.dumps(data));path.chmod(0o600)
   package=Path(d)/'package'
   with contextlib.redirect_stdout(io.StringIO()):self.assertEqual(r.prep.main(['--saved-folder',str(source),'--out',str(package)]),0)
   sql,params=r.load_package(source,package);self.assertIn('identity_readonly_tls_guard',sql)
   file=package/'catalog.READONLY.REVIEW.sql';file.write_text(sql+'SELECT 1;')
   with self.assertRaises(ValueError):r.load_package(source,package)
 def test_changed_source_and_manifest_rejected(self):
  from test_prepare_followup import fixture
  with tempfile.TemporaryDirectory() as d:
   source=Path(d)/'saved';source.mkdir(mode=0o700);rows,report=fixture()
   for name,data in [('catalog-private.json',rows),('report.json',report)]:
    path=source/name;path.write_text(json.dumps(data));path.chmod(0o600)
   package=Path(d)/'package'
   with contextlib.redirect_stdout(io.StringIO()):self.assertEqual(r.prep.main(['--saved-folder',str(source),'--out',str(package)]),0)
   file=package/'manifest.json';original=file.read_text();manifest=json.loads(original);manifest['sql_execution_authorised']=True;file.write_text(json.dumps(manifest))
   with self.assertRaises(ValueError):r.load_package(source,package)
   file.write_text(original);rows[1]['items'][0]['definition']='AS $$ SELECT 1 $$';(source/'catalog-private.json').write_text(json.dumps(rows))
   with self.assertRaises(ValueError):r.load_package(source,package)
 def test_unknown_cli_secret_redacted(self):
  with contextlib.redirect_stderr(io.StringIO()) as out,self.assertRaises(SystemExit):r.main(['--password','SECRET_VALUE'])
  self.assertNotIn('SECRET',out.getvalue())
if __name__=='__main__':unittest.main()
