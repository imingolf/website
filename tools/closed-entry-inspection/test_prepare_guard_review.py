import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import prepare_guard_review as p
class Review(unittest.TestCase):
 def source(self,root):
  folder=root/'binding';folder.mkdir(mode=0o700)
  sql='-- PRIVATE REVIEW ONLY; SECRET_PRIVATE_FILTER\nCREATE FUNCTION iig_closed_entry.resolve_pin(p_pin text) RETURNS text LANGUAGE sql AS $$SELECT id::text FROM fictional WHERE secret_value=\'SECRET\'$$;'
  m={'project':p.prep.PROJECT,'source_predicate_and_path_preserved':True,'projection_only_change':True,'database_connections':0,'sql_execution_authorised':False,'source_definition_sha256':'a'*64,'resolver_sql_sha256':p.prep.digest(sql)}
  for name,value in [('resolver.PRIVATE.REVIEW.sql',sql),('manifest.SANITISED.json',json.dumps(m))]:
   path=folder/name;path.write_text(value);path.chmod(0o600)
  return folder,m
 def test_report_no_private_sql_and_no_install_authority(self):
  with tempfile.TemporaryDirectory() as tmp:
   folder,m=self.source(Path(tmp))
   with patch('socket.socket',side_effect=AssertionError('No network')),patch('subprocess.run',side_effect=AssertionError('No process')):
    report=p.build(folder)
   self.assertNotIn('SECRET',json.dumps(report));self.assertFalse(report['sql_execution_authorised']);self.assertFalse(report['test_baseline_verified'])
   self.assertEqual(report['target_project'],p.TEST);self.assertEqual(report['source_pin_capture_project'],p.prep.PROJECT)
 def test_hash_drift_stops(self):
  with tempfile.TemporaryDirectory() as tmp:
   folder,m=self.source(Path(tmp));(folder/'resolver.PRIVATE.REVIEW.sql').write_text('SECRET_CHANGED')
   with self.assertRaises(ValueError):p.build(folder)
 def test_public_or_symlink_input_stops(self):
  with tempfile.TemporaryDirectory() as tmp:
   folder,m=self.source(Path(tmp));path=folder/'resolver.PRIVATE.REVIEW.sql';path.chmod(0o644)
   with self.assertRaises(ValueError):p.build(folder)
   path.chmod(0o600);link=Path(tmp)/'alias';link.symlink_to(folder)
   with self.assertRaises(ValueError):p.build(link)
 def test_invalid_manifest_assertions_stop(self):
  with tempfile.TemporaryDirectory() as tmp:
   folder,m=self.source(Path(tmp))
   for key,value in [('project',p.TEST),('projection_only_change',False),('sql_execution_authorised',True),('database_connections',1)]:
    changed={**m,key:value};(folder/'manifest.SANITISED.json').write_text(json.dumps(changed))
    with self.assertRaises(ValueError):p.build(folder)
 def test_cli_new_private_output_never_overwrites_or_copies_resolver(self):
  with tempfile.TemporaryDirectory() as tmp:
   folder,m=self.source(Path(tmp));out=Path(tmp)/'review'
   args=['--pin-binding-folder',str(folder),'--out',str(out)]
   with patch('socket.socket',side_effect=AssertionError('No network')),patch('subprocess.run',side_effect=AssertionError('No process')),contextlib.redirect_stdout(io.StringIO()):
    self.assertEqual(p.main(args),0)
   self.assertEqual(set(x.name for x in out.iterdir()),{'review.SANITISED.json','STOP-NOT-INSTALLABLE.txt'})
   for x in out.iterdir():self.assertEqual(x.stat().st_mode&0o777,0o600);self.assertNotIn('SECRET',x.read_text())
   with contextlib.redirect_stderr(io.StringIO()) as err:self.assertEqual(p.main(args),1)
   self.assertNotIn('SECRET',err.getvalue())
if __name__=='__main__':unittest.main()
