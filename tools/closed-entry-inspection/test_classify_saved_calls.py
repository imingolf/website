import contextlib
import io
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parent))
import classify_saved_calls as c

def rows(body,triggers=None):return [{'section':'functions','items':[{'schema':'public','name':'save_group_state','definition':body}]}]+([{'section':'triggers','items':triggers}] if triggers else [])
class Calls(unittest.TestCase):
 def test_now_is_classified_not_assumed_secure(self):
  out=c.classify(rows('AS $$ BEGIN UPDATE public.tens_in_groups SET updated_at=now(); END $$'))
  call=out['routines'][0]['calls'][0];self.assertEqual(call['name'],'now');self.assertFalse(call['resolution_proven']);self.assertEqual(out['uncaptured_call_count'],0)
 def test_comments_literals_not_calls(self):
  calls,_,_,_=c.extract_calls("AS $$ BEGIN -- SECRET_FN()\n PERFORM now(); RAISE EXCEPTION 'SECRET_FN()'; /* SECRET_FN() */ END $$")
  self.assertEqual(calls,['now'])
 def test_unknown_names_and_values_not_exported(self):
  out=str(c.classify(rows("AS $$ BEGIN PERFORM SECRET_HELPER('SECRET_VALUE'); INSERT INTO public.SECRET_TABLE(a) VALUES(1); END $$")))
  self.assertNotIn('SECRET',out);self.assertIn('uncaptured_call_1',out);self.assertIn('private_target_1',out)
 def test_target_not_helper(self):
  calls,effects,_,_=c.extract_calls('AS $$ INSERT INTO public.hidden_target(a,b) VALUES (now(),1) ON CONFLICT DO NOTHING; $$')
  self.assertEqual(calls,['now']);self.assertEqual(effects,[('insert','public.hidden_target')])
 def test_qualified_public_builtin_is_not_catalog(self):
  out=c.classify(rows('AS $$ SELECT public.now(); $$'));self.assertEqual(out['uncaptured_call_count'],1)
 def test_catalog_builtin(self):
  out=c.classify(rows('AS $$ SELECT pg_catalog.now(); $$'));self.assertEqual(out['routines'][0]['calls'][0]['kind'],'explicit_catalog_builtin_spelling')
 def test_captured_trigger_helper_match(self):
  out=c.classify(rows('AS $$ SELECT public.SECRET_HELPER(); $$',[{'schema':'public','table':'tens_in_groups','function_definition':'CREATE FUNCTION public.SECRET_HELPER() RETURNS trigger AS $$ BEGIN RETURN NEW; END $$ LANGUAGE plpgsql;'}]))
  self.assertEqual(out['routines'][0]['calls'][0]['aliases'],['group_trigger_1']);self.assertNotIn('SECRET',str(out))
 def test_dynamic_sql_flag(self):
  out=c.classify(rows('AS $outer$ BEGIN EXECUTE $inner$ SECRET_SQL $inner$; END $outer$'));self.assertTrue(out['routines'][0]['quoted_sql_unreviewed']);self.assertNotIn('SECRET',str(out))
 def test_side_effect_builtin_not_silently_accepted(self):
  out=c.classify(rows("AS $$ SELECT set_config('SECRET_SETTING','SECRET_VALUE',true); $$"));self.assertTrue(out['routines'][0]['calls'][0]['side_effect_possible']);self.assertNotIn('SECRET',str(out))
 def test_nested_comments_and_quoted_names(self):
  out=c.classify(rows('AS $$ /* SECRET /* SECRET */ */ SELECT "SECRET_HELPER"(); $$'));self.assertNotIn('SECRET',str(out));self.assertEqual(out['uncaptured_call_count'],1)
 def test_malformed_fail_closed(self):
  for body in ["'SECRET",'/* SECRET','AS $$ SELECT $bad$ SECRET $$']:
   with self.subTest(body=body),self.assertRaises(ValueError):c.classify(rows(body))
 def test_private_failure_output(self):
  with contextlib.redirect_stderr(io.StringIO()) as out:self.assertEqual(c.main(['--folder','/SECRET_MISSING']),1)
  self.assertNotIn('SECRET',out.getvalue())
class ResolutionEvidence(unittest.TestCase):
 def test_implicit_catalog_first(self):
  v=c.search_path_summary(['search_path=public','PRIVATE=SECRET_VALUE']);self.assertEqual(v['catalog_precedence'],'implicit_catalog_first');self.assertNotIn('SECRET',str(v))
 def test_unsafe_catalog_order_not_approved(self):
  v=c.search_path_summary(['search_path=public, pg_catalog']);self.assertEqual(v['catalog_precedence'],'other_schema_precedes_catalog');self.assertFalse(v['resolution_verified'])
 def test_unknown_schema_hidden(self):
  v=c.search_path_summary(['search_path=SECRET_SCHEMA,pg_catalog']);self.assertTrue(v['has_nonstandard_schema']);self.assertNotIn('SECRET',str(v))
 def test_missing_path_unverified(self):
  self.assertEqual(c.search_path_summary(None)['catalog_precedence'],'caller_inherited_unverified')
 def test_temp_not_function_shadow(self):
  self.assertEqual(c.search_path_summary(['search_path=pg_temp,pg_catalog,public'])['catalog_precedence'],'explicit_catalog_first_for_functions')
 def test_extension_gen_salt_not_proven(self):
  out=c.classify(rows("AS $$ SELECT public.gen_salt('SECRET_VALUE'); $$"));self.assertEqual(out['uncaptured_call_count'],0)
  v=out['routines'][0]['calls'][0];self.assertEqual(v['name'],'gen_salt');self.assertFalse(v['resolution_proven']);self.assertNotIn('SECRET',str(out))
 def test_target_metadata_no_private_names(self):
  data=rows('AS $$ INSERT INTO public.SECRET_TARGET(a) VALUES(1); $$')
  data.append({'section':'relations','items':[{'schema':'public','name':'secret_target','owner':'SECRET_OWNER','rls':True,'columns':[{'name':'title'},{'name':'body'},{'name':'SECRET_COLUMN'}]}]})
  out=c.classify(data);self.assertNotIn('SECRET',str(out));meta=out['routines'][0]['write_targets_NOT_complete'][0]['saved_metadata']
  self.assertTrue(meta['notification_column_pattern_NOT_proof']);self.assertFalse(meta['constraint_index_evidence_available'])
 def test_missing_target_evidence_is_not_success(self):
  m=c.target_metadata([], 'public.missing');self.assertFalse(m['relation_metadata_available'])
if __name__=='__main__':unittest.main()
