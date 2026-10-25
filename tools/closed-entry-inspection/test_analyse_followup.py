import contextlib
import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parent))
import analyse_followup as a
import test_review_followup as fixtures

class Analysis(unittest.TestCase):
 def fixture(self):
  rows,report,params=fixtures.Review().fixture()
  rows[0]['items'][0].update(name='now',schema='pg_catalog')
  rows[1]['items'][0]['constraints'][0]['referenced_relation_oid']=100
  rows[1]['items'][0].update(schema='private_schema',name='private_target')
  source=[{'section':'functions','items':[{'name':'save_group_state','schema':'public',
    'definition':"CREATE FUNCTION public.save_group_state() RETURNS void AS $$ BEGIN UPDATE private_schema.private_target SET payload='SECRET_VALUE'; PERFORM now(); END $$ LANGUAGE plpgsql;",
    'configuration':['search_path=public']}]}]
  return source,rows,report,params
 def test_fixed_path_implicit_catalog_and_qualified_target(self):
  result=a.analyse(*self.fixture());routine=result['routines'][0]
  self.assertEqual(routine['search_path']['catalog_precedence'],'implicit_catalog_first')
  self.assertEqual(routine['calls'][0]['candidate_count'],1)
  self.assertTrue(routine['writes_lexical_NOT_complete'][0]['qualified_target_matches_saved_relation'])
  self.assertNotIn('SECRET',json.dumps(result));self.assertNotIn('private_target',json.dumps(result))
  self.assertIn('TYPES_AND_CALL_EXPRESSION_REVIEW_REQUIRED',json.dumps(result))
 def test_missing_candidate_never_guessed(self):
  source,rows,r,p=self.fixture();rows[0]['items'][0]['name']='other'
  self.assertEqual(a.analyse(source,rows,r,p)['routines'][0]['calls'][0]['status'],'MISSING_CANDIDATE')
 def test_inherited_path_never_verified(self):
  source,rows,r,p=self.fixture();source[0]['items'][0]['configuration']=None
  self.assertFalse(a.analyse(source,rows,r,p)['routines'][0]['calls'][0]['candidate_schemas_in_fixed_path'])
 def test_overloads_not_resolved_by_catalog_precedence(self):
  source,rows,r,p=self.fixture();rows[0]['items'].append({**rows[0]['items'][0],'oid':2,'schema':'public'});rows[0]['count']=2
  self.assertEqual(a.analyse(source,rows,r,p)['routines'][0]['calls'][0]['candidate_count'],2)
 def test_trigger_order_grouped_by_event_timing_level(self):
  source,rows,r,p=self.fixture()
  def trigger(name,bits):return {'name':name,'type_bits':bits,'table_oid':100,'function_oid':1,'internal':False,'enabled':'O','constraint_oid':0}
  rows[2]['items']=[trigger('z_SECRET',17),trigger('a_SECRET',17),trigger('b_SECRET',19)]
  groups=a.analyse(source,rows,r,p)['trigger_event_timing_groups']
  self.assertEqual(len(groups),2)
  self.assertEqual(next(x for x in groups if x['timing']=='after')['name_order_positions_in_table'],[1,3])
  self.assertNotIn('SECRET',json.dumps(groups))
 def test_external_fk_flagged(self):
  source,rows,r,p=self.fixture();rows[1]['items'][0]['constraints'][0]['referenced_relation_oid']='999'
  self.assertEqual(a.analyse(source,rows,r,p)['foreign_keys_outside_captured_targets'],1)
 def test_unqualified_write_not_marked_bound(self):
  source,rows,r,p=self.fixture();source[0]['items'][0]['definition']=source[0]['items'][0]['definition'].replace('private_schema.private_target','private_target')
  self.assertFalse(a.analyse(source,rows,r,p)['routines'][0]['writes_lexical_NOT_complete'][0]['qualified_target_matches_saved_relation'])
 def test_trim_special_form_not_missing_routine(self):
  source,rows,r,p=self.fixture()
  source[0]['items'][0]['definition']="CREATE FUNCTION public.save_group_state() RETURNS void AS $$ BEGIN PERFORM trim('SECRET'); END $$ LANGUAGE plpgsql;"
  entry=a.analyse(source,rows,r,p)['routines'][0]['calls'][0]
  self.assertEqual(entry['status'],'SQL_TRIM_SPECIAL_FORM_NOT_A_TRIM_CATALOG_LOOKUP')
  self.assertEqual(entry['trim_parser_lowering_candidates'],['btrim'])
 def test_trim_forms_and_qualified_call_remain_distinct(self):
  self.assertEqual(a.trim_syntax("AS $$ SELECT trim(leading 'SECRET' from 'X'), trim(trailing from 'X'), trim(both from 'X') $$"),['btrim','ltrim','rtrim'])
  self.assertEqual(a.trim_syntax('AS $$ SELECT public.trim(x), "trim"(x) $$'),[])
  self.assertEqual(a.trim_syntax("AS $$ SELECT 'trim(leading from x)' $$"),[])
 def test_main_offline_error_redacted(self):
  with patch.object(a.driver,'load_package',side_effect=ValueError('SECRET')),patch.object(a.driver.subprocess,'run',side_effect=AssertionError('No process')),contextlib.redirect_stderr(io.StringIO()) as out:
   self.assertEqual(a.main(['--saved-folder','s','--package','p','--folder','f']),1)
  self.assertNotIn('SECRET',out.getvalue())
if __name__=='__main__':unittest.main()
