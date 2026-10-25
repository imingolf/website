import contextlib
import io
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parent))
import prepare_pin_binding as p
class Binding(unittest.TestCase):
 def fixture(self,body=None):
  body=body or "SELECT state FROM public.tens_in_groups WHERE fixture_pin=p_pin AND group_name<>'SECRET_FILTER' LIMIT 1;"
  return {'schema':'public','name':'get_group_state','arguments':'p_pin text','return':'jsonb','owner':'postgres','security_definer':True,'configuration':['search_path=public,extensions'],
   'definition':'CREATE FUNCTION public.get_group_state(p_pin text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$'+body+'$$;'}, {'schema':'public','name':'tens_in_groups','columns':[{'name':'id','type':'uuid'},{'name':'state','type':'jsonb'}]}
 def test_only_projection_changed_private_predicate_preserved(self):
  f,t=self.fixture();sql,manifest=p.build(f,t)
  self.assertIn('SELECT id::text FROM public.tens_in_groups',sql);self.assertIn("group_name<>'SECRET_FILTER' LIMIT 1",sql)
  self.assertIn('search_path = public,extensions',sql);self.assertNotIn('SECRET',str(manifest));self.assertFalse(manifest['sql_execution_authorised'])
 def test_alias_shape(self):
  sql,_=p.build(*self.fixture('SELECT g.state FROM public.tens_in_groups AS g WHERE g.fixture_pin=p_pin;'));self.assertIn('SELECT g.id::text',sql)
 def test_unqualified_inherited_or_complex_path_rejected(self):
  for config in [None,[],['search_path=$user,public'],['search_path=public','row_security=off']]:
   f,t=self.fixture();f['configuration']=config
   with self.assertRaises(ValueError):p.build(f,t)
 def test_unsafe_or_unproved_shapes_rejected(self):
  for body in ['SELECT state FROM tens_in_groups WHERE fixture_pin=p_pin;', 'SELECT state FROM public.tens_in_groups WHERE fixture_pin=p_pin; DELETE FROM public.tens_in_groups;',
   'SELECT state FROM public.tens_in_groups g JOIN other_table x ON true WHERE fixture_pin=p_pin;',
   'SELECT state FROM public.tens_in_groups WHERE fixture_pin=(SELECT p_pin);',
   'SELECT state FROM public.tens_in_groups WHERE set_config(p_pin,p_pin,true) IS NOT NULL;',
   'SELECT state FROM public.tens_in_groups WHERE fixture_pin=p_pin FOR UPDATE;']:
   with self.assertRaises(ValueError):p.build(*self.fixture(body))
 def test_wrong_owner_type_language(self):
  for key,value in [('owner','anon'),('security_definer',False),('return','text'),('arguments','p_pin uuid')]:
   f,t=self.fixture();f[key]=value
   with self.assertRaises(ValueError):p.build(f,t)
  f,t=self.fixture();f['definition']=f['definition'].replace('LANGUAGE sql','LANGUAGE plpgsql')
  with self.assertRaises(ValueError):p.build(f,t)
 def test_cli_error_no_connect_no_secret(self):
  with patch.object(p.driver,'load_package',side_effect=ValueError('SECRET')),patch.object(p.driver.subprocess,'run',side_effect=AssertionError('No process')),patch('socket.socket',side_effect=AssertionError('No network')),contextlib.redirect_stderr(io.StringIO()) as out:
   self.assertEqual(p.main(['--saved-folder','s','--package','p']),1)
  self.assertNotIn('SECRET',out.getvalue())
if __name__=='__main__':unittest.main()
