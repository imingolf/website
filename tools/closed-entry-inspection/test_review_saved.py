import importlib.util
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parent))
import review_saved as r
class Review(unittest.TestCase):
 def test_secret_values_comments_identifiers_redacted(self):
  s="""CREATE FUNCTION public.save_group_state() RETURNS void AS $function$
  BEGIN -- SECRET_COMMENT
  /* SECRET /* NESTED_SECRET */ */ IF secret_parameter <> 'SECRET_PASSWORD' THEN
  RAISE EXCEPTION 'SECRET_ERROR'; END IF; PERFORM secret_helper('SECRET_LITERAL');
  UPDATE public.secret_table SET state=p_state; END $function$ LANGUAGE plpgsql;"""
  value=str(r.sketch(s));self.assertNotIn('SECRET',value.upper());self.assertNotIn('secret_helper',value);self.assertIn('unknown_call_1',value);self.assertIn('if',value);self.assertIn('update',value)
 def test_dollar_quoted_dynamic_sql(self):
  s='AS $outer$ BEGIN EXECUTE $inner$ SECRET_PASSWORD $inner$; END $outer$'
  out=r.sketch(s);self.assertNotIn('SECRET',str(out));self.assertTrue(out['dynamic_quoted_sql_unreviewed'])
 def test_auth_reference_not_proof(self):
  out=r.sketch('AS $$ BEGIN IF auth.uid() IS NULL THEN RETURN; END IF; END $$');self.assertIn('auth.uid',out['calls_NOT_complete'])
 def test_quotes_and_numbers(self):
  out=r.sketch('AS $$ BEGIN IF "SECRET_COLUMN" = 987654 THEN RETURN \'SEC\'\'RET\'; END IF; END $$')
  self.assertNotIn('987654',str(out));self.assertNotIn('SECRET_COLUMN',str(out))
 def test_unknown_name_rejected(self):
  with self.assertRaises(ValueError):r.review([{'section':'functions','items':[{'name':'secret_name','definition':'secret'}]}])
 def test_malformed_comments_and_quotes(self):
  for s in ["'SECRET",'/* SECRET','AS $$ BEGIN $bad$ SECRET $$']:
   with self.subTest(s=s),self.assertRaises(ValueError):r.sketch(s)
if __name__=='__main__':unittest.main()
