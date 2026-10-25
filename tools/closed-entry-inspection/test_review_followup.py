import contextlib
import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parent))
import review_followup as r

class Review(unittest.TestCase):
 def fixture(self):
  f={'oid':1,'name':'SECRET_NAME','schema':'SECRET_SCHEMA','definition':'SECRET_BODY',
     'configuration':['search_path=SECRET_PATH'],'extension':'SECRET_EXTENSION',
     'security_definer':True,'anon_create_schema':False,'authenticated_create_schema':False}
  t={'table_oid':100,'rls':True,'force_rls':False,'columns':[{'default':'SECRET_DEFAULT'}],
     'constraints':[{'type':'f','validated':True}], 'indexes':[], 'policies':[]}
  rows=[{'section':'candidate_bindings','count':1,'within_reviewed_limit':True,'items':[f]},
    {'section':'target_constraints_indexes','items':[t]},
    {'section':'target_trigger_dependencies','items':[]}]
  report={'project':r.prep.PROJECT,'connections_attempted':1,'group_records_read':0,
     'captured_function_attributes_trigger_definitions_target_fingerprints_match':True,'server_version_matches_saved_capture':True}
  return rows,report,{'table_oids':[100],'function_oids':[1]}
 def test_allowlist_redacts_all_source_text(self):
  out=json.dumps(r.review(*self.fixture()));self.assertNotIn('SECRET',out);self.assertIn('NO-GO',out)
 def test_wrong_project_or_failed_guard_rejected(self):
  for key,value in [('project','OTHER'),('connections_attempted',0),('group_records_read',1),('server_version_matches_saved_capture',False)]:
   rows,report,p=self.fixture();report[key]=value
   with self.assertRaises(ValueError):r.review(rows,report,p)
 def test_null_acl_and_config_allowed(self):
  rows,report,p=self.fixture();rows[0]['items'][0].update(configuration=None,acl=None)
  self.assertFalse(r.review(rows,report,p)['routine_indicators'][0]['explicit_search_path'])
 def test_scope_expansion_rejected(self):
  rows,report,p=self.fixture();rows[1]['items'][0]['table_oid']=999
  with self.assertRaises(ValueError):r.review(rows,report,p)
 def test_malformed_metadata_fails(self):
  rows,report,p=self.fixture();rows[1]['items'][0]['indexes']=None
  with self.assertRaises(ValueError):r.review(rows,report,p)
 def test_offline_main_has_no_process_or_prompt(self):
  rows,report,p=self.fixture()
  with patch.object(r.driver,'load_package',return_value=('',p)),patch.object(r.prep,'private_directory'),patch.object(r.summarise,'read_private',side_effect=[rows,report]),patch.object(r.driver.subprocess,'run',side_effect=AssertionError('process forbidden')),patch('builtins.input',side_effect=AssertionError('prompt forbidden')),contextlib.redirect_stdout(io.StringIO()) as out:
   self.assertEqual(r.main(['--folder','f','--saved-folder','s','--package','p']),0)
  self.assertNotIn('SECRET',out.getvalue())
 def test_trigger_timing_and_generated_columns(self):
  rows,report,p=self.fixture()
  rows[1]['items'][0]['columns'][0].update(generated='s',identity='a')
  rows[2]['items']=[{'table_oid':100,'function_oid':1,'internal':False,
    'enabled':'O','type_bits':7,'definition_body':'SECRET_TRIGGER'}]
  result=r.review(rows,report,p);t=result['targets'][0]
  self.assertEqual(t['generated_columns'],1);self.assertEqual(t['identity_columns'],1)
  self.assertTrue(t['trigger_order'][0]['before']);self.assertTrue(t['trigger_order'][0]['row_level'])
  self.assertNotIn('SECRET',json.dumps(result))
 def test_errors_redacted(self):
  with patch.object(r.driver,'load_package',side_effect=ValueError('SECRET')),contextlib.redirect_stderr(io.StringIO()) as out:
   self.assertEqual(r.main(['--folder','f','--saved-folder','s','--package','p']),1)
  self.assertNotIn('SECRET',out.getvalue())
 def test_unknown_args_redacted(self):
  with contextlib.redirect_stderr(io.StringIO()) as out,self.assertRaises(SystemExit):r.main(['--password','SECRET'])
  self.assertNotIn('SECRET',out.getvalue())
if __name__=='__main__':unittest.main()
