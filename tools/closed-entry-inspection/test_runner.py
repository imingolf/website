import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('incident_runner',Path(__file__).with_name('runner.py'))
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)

class Safety(unittest.TestCase):
 def config(self,root,**changes):
  ca=root/'ca.pem';ca.write_text('-----BEGIN CERTIFICATE-----\nfictional\n-----END CERTIFICATE-----');ca.chmod(0o600)
  c=dict(project=r.PROJECT,host=r.DIRECT,port=5432,database='postgres',user='postgres',ca_file=str(ca));c.update(changes)
  path=root/'config.json';path.write_text(json.dumps(c));path.chmod(0o600);return path
 def test_offline_never_connects(self):
  with patch.object(r.subprocess,'run',side_effect=AssertionError('connection')),patch.object(r.getpass,'getpass',side_effect=AssertionError('password')),contextlib.redirect_stdout(io.StringIO()) as out:
   self.assertEqual(r.main([]),0);self.assertIn('attempted: 0',out.getvalue())
 def test_fixed_sql(self):
  text=r.approved_sql();self.assertIn('REPEATABLE READ READ ONLY',text);self.assertIn('pg_stat_ssl',text);self.assertIn('search_path = pg_catalog',text)
  self.assertNotIn('public.tens_in_groups',text);self.assertNotIn('auth.users',text)
 def test_tamper_rejected(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);(root/'inspection.sql').write_text('DELETE FROM public.tens_in_groups;')
   (root/'query-manifest.json').write_text(json.dumps({'sha256':'wrong','project':r.PROJECT}))
   with patch.object(r,'HERE',root),self.assertRaises(ValueError):r.approved_sql()
 def test_wrong_targets(self):
  with tempfile.TemporaryDirectory() as d:
   for change in [{'project':'nyavvwrsrxqfyhiygkgw'},{'host':'db.nyavvwrsrxqfyhiygkgw.supabase.co'},{'host':'aws-0-eu-west-1.pooler.supabase.com'},{'host':'127.0.0.1'},{'port':6543},{'user':'anon'},{'database':'other'},{'hostaddr':'127.0.0.1'},{'password':'secret'},{'sslmode':'require'}]:
    with self.subTest(change=change),self.assertRaises(ValueError):r.configuration(self.config(Path(d),**change))
 def test_missing_config(self):
  with self.assertRaises(ValueError):r.configuration('/does-not-exist')
 def test_private_modes(self):
  with tempfile.TemporaryDirectory() as d:
   p=self.config(Path(d));p.chmod(0o644)
   with self.assertRaises(ValueError):r.configuration(p)
 def test_wrong_owner(self):
  with tempfile.TemporaryDirectory() as d:
   p=self.config(Path(d))
   with patch.object(r.os,'getuid',return_value=-1),self.assertRaises(ValueError):r.configuration(p)
 def test_symlink_rejected(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);p=self.config(root);link=root/'link';link.symlink_to(p)
   with self.assertRaises(ValueError):r.configuration(link)
 def test_missing_ca(self):
  with tempfile.TemporaryDirectory() as d:
   with self.assertRaises(ValueError):r.configuration(self.config(Path(d),ca_file='/missing'))
 def test_invalid_ca(self):
  with tempfile.TemporaryDirectory() as d:
   with self.assertRaises(Exception):r.configuration(self.config(Path(d)))
 def test_ca_parsed_with_ssl(self):
  with tempfile.TemporaryDirectory() as d:
   p=self.config(Path(d))
   with patch.object(r.ssl,'create_default_context') as trust:r.configuration(p);trust.assert_called_once_with(cafile=str((Path(d)/'ca.pem').resolve()))
 def test_tls_failure_closed(self):
  with tempfile.TemporaryDirectory() as d:
   p=self.config(Path(d))
   with patch.object(r.ssl,'create_default_context',side_effect=ValueError('bad certificate')),self.assertRaises(ValueError):r.configuration(p)
 def test_env_no_fallback(self):
  with patch.dict(os.environ,{'PGHOSTADDR':'evil','PGSERVICE':'evil','PGSSLMODE':'disable','DATABASE_URL':'secret'}):
   c={'host':r.DIRECT,'ca_file':'/private/ca.pem'};env=r.environment(c,'fictional-password')
   self.assertNotIn('PGHOSTADDR',env);self.assertNotIn('PGSERVICE',env);self.assertNotIn('DATABASE_URL',env)
   self.assertEqual(env['PGSSLMODE'],'verify-full');self.assertEqual(env['PGHOST'],r.DIRECT)
   self.assertIn('default_transaction_read_only=on',env['PGOPTIONS'])
 def rows(self):
  return [dict(section='identity',database='postgres',role='postgres',read_only='on',backend_ssl=True)]+[
   dict(section=s,items=([{'name':'get_group_state'},{'name':'save_group_state'}] if s=='functions' else [])) for s in sorted(r.SECTIONS-{'identity'})]
 def output(self,rows=None):return '1\n'+'\n'.join(json.dumps(x) for x in (rows or self.rows()))+'\n'
 def test_complete_parse(self):self.assertEqual(len(r.parse_output(self.output())),7)
 def test_failed_guard(self):
  for raw in ['', '0\n','NOTICE: secret\n'+self.output()]:
   with self.subTest(raw=raw),self.assertRaises(Exception):r.parse_output(raw)
 def test_failed_identity(self):
  for key,value in [('backend_ssl',False),('read_only','off'),('role','anon'),('database','other')]:
   rows=self.rows();rows[0][key]=value
   with self.subTest(key=key),self.assertRaises(ValueError):r.parse_output(self.output(rows))
 def test_partial_missing_rpc(self):
  rows=self.rows();next(x for x in rows if x['section']=='functions')['items']=[]
  with self.assertRaises(ValueError):r.parse_output(self.output(rows))
 def test_mock_connection_single_fixed_input(self):
  with tempfile.TemporaryDirectory() as d:
   out=Path(d)/'evidence';c={'host':r.DIRECT,'ca_file':'/private/ca.pem'}
   result=type('Result',(),dict(returncode=0,stdout=self.output(),stderr=''))()
   with patch.object(r.subprocess,'run',return_value=result) as run:
    r.connect(c,r.approved_sql(),out,'fictional-password','/usr/bin/psql')
    self.assertEqual(run.call_count,1);args,kw=run.call_args
    self.assertNotIn('fictional-password',' '.join(args[0]));self.assertNotIn('shell',kw)
    self.assertEqual(kw['input'],r.approved_sql());self.assertIn('-X',args[0]);self.assertIn('-w',args[0])
    self.assertEqual((out/'catalog-private.json').stat().st_mode & 0o777,0o600)
    for p in out.iterdir():self.assertNotIn('fictional-password',p.read_text())
 def test_server_error_no_retry_no_evidence(self):
  with tempfile.TemporaryDirectory() as d:
   out=Path(d)/'evidence';result=type('Result',(),dict(returncode=1,stdout='',stderr='credential PRIVATE'))()
   with patch.object(r.subprocess,'run',return_value=result) as run,self.assertRaises(ValueError):r.connect({'host':r.DIRECT,'ca_file':'ca'},r.approved_sql(),out,'secret','psql')
   self.assertEqual(run.call_count,1);self.assertEqual(list(out.iterdir()),[])
 def test_cli_failures_do_not_leak(self):
  with patch.object(r,'configuration',side_effect=ValueError('PASSWORD-SECRET')),contextlib.redirect_stdout(io.StringIO()) as out:
   self.assertEqual(r.main(['--config','anything']),1);self.assertNotIn('PASSWORD-SECRET',out.getvalue());self.assertIn('attempted: 0',out.getvalue())
 def test_no_noninteractive_connection(self):
  with patch.object(r,'configuration',return_value={'host':r.DIRECT}),patch.object(r.sys.stdin,'isatty',return_value=False),patch.object(r.subprocess,'run') as run,contextlib.redirect_stdout(io.StringIO()):
   self.assertEqual(r.main(['--config','private','--out','private','--connect-live-readonly',r.PROJECT]),1);run.assert_not_called()

if __name__=='__main__':unittest.main()
