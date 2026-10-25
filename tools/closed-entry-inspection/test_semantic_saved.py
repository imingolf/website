import contextlib
import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parent))
import semantic_saved as s
import test_review_followup as fixtures

class Semantic(unittest.TestCase):
 def fixture(self,body=None):
  rows,report,params=fixtures.Review().fixture()
  rows[0]['items'][0].update(definition=None,definition_already_saved=True)
  t=rows[1]['items'][0];t.update(schema='private_schema',name='private_ledger')
  t['constraints']=[{'name':'SECRET_CONSTRAINT','type':'u','validated':True,'deferrable':False,
    'initially_deferred':False,'definition':'UNIQUE (group_key, round_key)'}]
  t['indexes']=[{'unique':True,'valid':True,'ready':True,'predicate':None,
    'definition':'CREATE UNIQUE INDEX SECRET_INDEX ON private_schema.private_ledger USING btree (group_key, round_key)'}]
  body=body or """BEGIN
   IF NEW.state->'history' IS DISTINCT FROM OLD.state->'history' THEN
    INSERT INTO private_schema.private_ledger (group_key,round_key) VALUES ('SECRET_GROUP','SECRET_ROUND')
    ON CONFLICT (group_key,round_key) DO NOTHING;
   ELSIF NEW.state->'trip' IS DISTINCT FROM OLD.state->'trip' THEN
    UPDATE private_schema.private_ledger SET round_key='SECRET_VALUE' WHERE group_key='SECRET_GROUP';
   ELSE RETURN NEW; END IF;
   RETURN NEW;
  END;"""
  definition='CREATE FUNCTION private_schema.SECRET_FUNCTION() RETURNS trigger LANGUAGE plpgsql AS $body$'+body+'$body$;'
  original=[{'section':'functions','items':[]},{'section':'triggers','items':[{'function_oid':1,'function_definition':definition}]}]
  rows[2]['items']=[{'table_oid':100,'function_oid':1,'internal':False,'enabled':'O','type_bits':17,
    'definition':'CREATE TRIGGER SECRET_TRIGGER AFTER UPDATE ON private_schema.private_ledger FOR EACH ROW EXECUTE FUNCTION private_schema.SECRET_FUNCTION()'}]
  return original,rows,report,params
 def test_branch_paths_conflict_and_no_private_values(self):
  result=s.analyse(*self.fixture());raw=json.dumps(result)
  for secret in ['SECRET','private_schema','private_ledger','group_key','round_key']:self.assertNotIn(secret,raw)
  trigger=result['triggers'][0];self.assertEqual(trigger['status'],'STRUCTURAL_PATHS_EXTRACTED_NOT_SEMANTIC_PROOF')
  writes=[x for x in trigger['events'] if x['kind']=='write'];self.assertEqual(len(writes),2)
  self.assertEqual(writes[0]['conflict']['matching_constraints'],[1])
  self.assertFalse(writes[0]['conflict']['arbiter_verified'])
  self.assertEqual(len(writes[1]['branch_path'][0]['earlier_conditions_false']),1)
  self.assertIn('history',writes[0]['branch_path'][0]['topics_NOT_effect_proof'])
 def test_else_and_nested_loop_paths(self):
  result=s.analyse(*self.fixture("""DECLARE rec record; BEGIN
   FOR rec IN SELECT * FROM private_schema.private_ledger LOOP
    IF NEW.state->'paid'='true' THEN
     IF OLD.state->'trip' IS NULL THEN RETURN NEW; ELSE RETURN OLD; END IF;
    ELSE UPDATE private_schema.private_ledger SET round_key='SECRET'; END IF;
   END LOOP; RETURN NEW; END;"""))
  events=result['triggers'][0]['events'];write=next(x for x in events if x['kind']=='write')
  self.assertEqual(len(write['iteration_context']),1);self.assertIn('else_of',write['branch_path'][0])
  nested=[x for x in events if len(x['branch_path'])==2];self.assertEqual(len(nested),2)
 def test_exception_dynamic_and_statement_case_not_silently_skipped(self):
  for body in ["BEGIN EXECUTE 'SECRET_SQL'; RETURN NEW; END;",
    'BEGIN RETURN NEW; EXCEPTION WHEN others THEN RETURN OLD; END;',
    'BEGIN CASE WHEN true THEN RETURN NEW; END CASE; END;']:
   result=s.analyse(*self.fixture(body));self.assertEqual(result['triggers'][0]['status'],'UNSUPPORTED_REQUIRES_PRIVATE_REVIEW')
   self.assertNotIn('events',result['triggers'][0])
 def test_sql_case_in_guard_preserves_outer_then(self):
  result=s.analyse(*self.fixture('BEGIN IF CASE WHEN true THEN false ELSE true END THEN RETURN NEW; ELSE RETURN OLD; END IF; END;'))
  self.assertEqual(len(result['triggers'][0]['events']),2)
 def test_constraint_name_and_update_conflict(self):
  result=s.analyse(*self.fixture('BEGIN INSERT INTO private_schema.private_ledger VALUES (1,2) ON CONFLICT ON CONSTRAINT "SECRET_CONSTRAINT" DO UPDATE SET round_key=excluded.round_key; RETURN NEW; END;'))
  conflict=result['triggers'][0]['events'][0]['conflict']
  self.assertEqual(conflict['action'],'update');self.assertEqual(conflict['matching_constraints'],[1])
 def test_targetless_and_partial_target_not_overclaimed(self):
  for target in ['', '(group_key) WHERE round_key IS NOT NULL']:
   result=s.analyse(*self.fixture('BEGIN INSERT INTO private_schema.private_ledger VALUES (1,2) ON CONFLICT '+target+' DO NOTHING; RETURN NEW; END;'))
   conflict=result['triggers'][0]['events'][0]['conflict'];self.assertFalse(conflict['arbiter_verified'])
   self.assertEqual(conflict['matching_constraints'],[])
 def test_wrong_project_rejected(self):
  original,rows,report,params=self.fixture();report['project']='OTHER'
  with self.assertRaises(ValueError):s.analyse(original,rows,report,params)
 def test_lexer_comments_quoted_ids_and_literals_redacted(self):
  symbols=s.Symbols();tokens=s.lex("/* SECRET /* nested */ */ \"SECRET_ID\" = 'SECRET''VALUE' -- SECRET\n AND x=1010")
  raw=json.dumps(symbols.render(tokens));self.assertNotIn('SECRET',raw);self.assertNotIn('1010',raw)
  self.assertEqual(symbols.render(s.lex("'same' = 'same'")),['constant_3','=','constant_3'])
 def test_malformed_and_oversized_lexing_rejected(self):
  for text in ["'unterminated",'/* open',"E'back\\slash'",'$x$inner$x$', '@bad']:
   with self.assertRaises(s.Unsupported):s.lex(text)
  with self.assertRaises(s.Unsupported):s.Symbols().render(s.lex('x '*401))
 def test_metadata_body_mismatch_rejected(self):
  original,rows,report,params=self.fixture();rows[2]['items'][0]['definition_body']='SECRET_OTHER'
  with self.assertRaises(ValueError):s.analyse(original,rows,report,params)
 def test_scope_change_rejected(self):
  original,rows,report,params=self.fixture();rows[1]['items'][0]['table_oid']=999
  with self.assertRaises(ValueError):s.analyse(original,rows,report,params)
 def test_main_offline_no_process_or_prompt(self):
  original,rows,report,params=self.fixture()
  with patch.object(s.driver,'load_package',return_value=('',params)),patch.object(s.prep,'private_directory'),patch.object(s.summarise,'read_private',side_effect=[original,rows,report]),patch.object(s.driver.subprocess,'run',side_effect=AssertionError('No process')),patch('socket.socket',side_effect=AssertionError('No network')),patch('builtins.input',side_effect=AssertionError('No prompt')),contextlib.redirect_stdout(io.StringIO()) as out:
   self.assertEqual(s.main(['--folder','f','--saved-folder','s','--package','p']),0)
  self.assertNotIn('SECRET',out.getvalue());self.assertIn('NO-GO',out.getvalue())
 def test_cli_errors_and_exceptions_redacted(self):
  with patch.object(s.driver,'load_package',side_effect=ValueError('SECRET')),contextlib.redirect_stderr(io.StringIO()) as out:
   self.assertEqual(s.main(['--folder','f','--saved-folder','s','--package','p']),1)
  self.assertNotIn('SECRET',out.getvalue())
  with contextlib.redirect_stderr(io.StringIO()) as out,self.assertRaises(SystemExit):s.main(['--password','SECRET'])
  self.assertNotIn('SECRET',out.getvalue())
 def test_early_return_reachability_not_overclaimed(self):
  result=s.analyse(*self.fixture("BEGIN IF NEW.state->'history' IS NULL THEN RETURN NEW; END IF; INSERT INTO private_schema.private_ledger VALUES (1,2); RETURN NEW; END;"))
  write=next(x for x in result['triggers'][0]['events'] if x['kind']=='write')
  self.assertFalse(write['reachability_verified']);self.assertEqual(write['preceding_control_event_numbers'],[1])
 def test_key_case_and_secret_never_conflated(self):
  tokens=s.Symbols().render(s.lex("'roundOpen' = 'roundopen' AND 'SECRET_PASSWORD' = 'SECRET_PASSWORD'"))
  self.assertNotEqual(tokens[0],tokens[2]);self.assertNotIn('SECRET',json.dumps(tokens))
 def test_different_event_flags(self):
  original,rows,report,params=self.fixture();rows[2]['items'][0]['type_bits']=5
  result=s.analyse(original,rows,report,params)['triggers'][0]
  self.assertTrue(result['insert_event']);self.assertFalse(result['update_event']);self.assertTrue(result['after'])
 def test_missing_body_explicit(self):
  original,rows,report,params=self.fixture();original=[]
  result=s.analyse(original,rows,report,params)
  self.assertEqual(result['triggers'][0]['reason'],'missing_saved_body')
if __name__=='__main__':unittest.main()
