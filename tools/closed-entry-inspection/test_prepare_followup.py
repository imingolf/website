import contextlib
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parent))
import prepare_followup as p

def fixture():
 def f(name,ident,definition):
  return dict(name=name,oid=ident,schema='public',owner='postgres',definition=definition,security_definer=True,
   configuration=['search_path=public'],acl=None,anon_execute=True,authenticated_execute=True,service_role_execute=True)
 functions=[f('get_group_state',1,'AS $$ SELECT state FROM public.tens_in_groups WHERE group_pin=p_pin; $$'),
  f('save_group_state',2,'AS $$ UPDATE public.tens_in_groups SET state=p_state,updated_at=now(); $$'),
  f('create_golf_group',3,"AS $$ SELECT extensions.gen_salt('SECRET_BODY_LITERAL'); $$")]
 root=dict(oid=100,schema='public',name='tens_in_groups',owner='postgres',rls=True,force_rls=False,acl=None,schema_acl=None,
  columns=[dict(name='id',type='integer',acl=None),dict(name='state',type='jsonb',acl=None)])
 target=dict(root,oid=101,schema='iig_private',name='private_events',columns=[dict(name='title',type='text',acl=None),dict(name='body',type='text',acl=None)])
 def t(name,ident,table,schema,body):return dict(name=name,enabled='O',function_oid=ident,table=table,schema=schema,owner='postgres',security_definer=True,
  configuration=['search_path=pg_catalog, public'],acl=None,definition='CREATE TRIGGER '+name+' ON '+schema+'.'+table,
  function_definition='CREATE FUNCTION public.'+name+'() RETURNS trigger AS $$ '+body+' $$ LANGUAGE plpgsql;')
 triggers=[t('SECRET_TRIGGER_ONE',4,'tens_in_groups','public','BEGIN INSERT INTO iig_private.private_events(title,body) VALUES(\'SECRET_VALUE\',\'SECRET_VALUE\'); RETURN NEW; END'),
  t('SECRET_TRIGGER_TWO',5,'tens_in_groups','public','BEGIN RETURN NEW; END'),
  t('SECRET_DOWNSTREAM',6,'private_events','iig_private','BEGIN RETURN NEW; END')]
 rows=[dict(section='identity',database='postgres',role='postgres',version='17.11',read_only='on',backend_ssl=True),
  dict(section='functions',items=functions),dict(section='relations',items=[root,target]),dict(section='triggers',items=triggers),
  dict(section='policies',items=[]),dict(section='role_flags',items=[]),dict(section='role_memberships',items=[])]
 return rows,dict(project=p.PROJECT,connections_attempted=1,group_rows_read=0)

class Followup(unittest.TestCase):
 def test_audits_without_db_and_maps_downstream(self):
  sql,summary,params=p.build(*fixture());self.assertEqual(summary['new_database_connections'],0)
  self.assertEqual(summary['saved_evidence']['reachable_captured_trigger_count'],3)
  self.assertEqual(params['table_oids'],[100,101]);self.assertTrue(summary['another_current_catalog_review_needed_before_installation'])
 def test_source_values_never_exported(self):
  sql,summary,params=p.build(*fixture())
  self.assertNotIn('SECRET',sql);self.assertNotIn('SECRET',json.dumps(summary));self.assertNotIn('SECRET',json.dumps(params))
 def test_preserves_sql_readonly_guards(self):
  sql,_,_=p.build(*fixture());self.assertIn('REPEATABLE READ READ ONLY',sql);self.assertIn('pg_stat_ssl',sql)
  self.assertIn('original_function_baseline_guard',sql);self.assertIn('original_trigger_baseline_guard',sql)
  self.assertIn('standard_conforming_strings = on',sql);self.assertTrue(sql.endswith('COMMIT;\n'))
  self.assertNotIn('/*__',sql);self.assertNotIn('FROM public.',sql);self.assertNotIn('SELECT public.',sql)
 def test_fixed_scope_candidates(self):
  _,_,params=p.build(*fixture());self.assertIn('gen_salt',params['routine_names']);self.assertIn('extensions',params['schemas'])
  self.assertNotIn('SECRET_BODY_LITERAL',params['routine_names']);self.assertEqual(params['function_oids'],[1,2,3,4,5,6])
 def test_wrong_project_rejected(self):
  rows,r=fixture();r['project']='nyavvwrsrxqfyhiygkgw'
  with self.assertRaises(ValueError):p.build(rows,r)
 def test_postgres_decimal_string_oids(self):
  rows,r=fixture()
  for section in rows:
   for item in section.get('items',[]):
    for key in ('oid','function_oid'):
     if key in item:item[key]=str(item[key])
  _,_,params=p.build(rows,r);self.assertEqual(params['table_oids'],[100,101]);self.assertEqual(params['function_oids'],[1,2,3,4,5,6])
 def test_invalid_oid_not_interpolated(self):
  for invalid in [True,0,-1,'1); DROP TABLE x;']:
   rows,r=fixture();next(x for x in rows if x['section']=='functions')['items'][0]['oid']=invalid
   with self.subTest(value=invalid),self.assertRaises(ValueError):p.build(rows,r)
 def test_dynamic_sql_stops_scope_guess(self):
  rows,r=fixture();next(x for x in rows if x['section']=='functions')['items'][0]['definition']="AS $$ BEGIN EXECUTE 'SECRET_SQL'; END $$"
  with self.assertRaises(ValueError):p.build(rows,r)
 def test_unknown_target_stops_broadening(self):
  rows,r=fixture();next(x for x in rows if x['section']=='functions')['items'][1]['definition']='AS $$ UPDATE missing_schema.missing_table SET x=1; $$'
  with self.assertRaises(ValueError):p.build(rows,r)
 def test_ambiguous_nonstandard_path_stops(self):
  rows,r=fixture();next(x for x in rows if x['section']=='functions')['items'][0]['configuration']=['search_path=$user,public']
  with self.assertRaises(ValueError):p.build(rows,r)
 def test_source_acl_config_hash_changes(self):
  rows,r=fixture();sql,_,_=p.build(rows,r);rows[1]['items'][0]['configuration']=['search_path=pg_catalog,public']
  sql2,_,_=p.build(rows,r);self.assertNotEqual(sql,sql2)
 def test_no_overwrite_and_private_files(self):
  with tempfile.TemporaryDirectory() as d:
   out=Path(d)/'new';p.write_new(out,{'packet':'review only'})
   self.assertEqual(out.stat().st_mode&0o777,0o700);self.assertEqual((out/'packet').stat().st_mode&0o777,0o600)
   with self.assertRaises(ValueError):p.write_new(out,{'packet':'changed'})
   self.assertEqual((out/'packet').read_text(),'review only')
 def test_repository_output_rejected(self):
  with self.assertRaises(ValueError):p.write_new(p.REPO/'must-not-create-private-evidence',{'packet':'private'})
 def test_parent_symlink_cannot_hide_repository_output(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);repo=root/'repo';repo.mkdir();outside=root/'outside';outside.mkdir();(repo/'link').symlink_to(outside)
   with patch.object(p,'REPO',repo),self.assertRaises(ValueError):p.write_new(repo/'link'/'private-evidence',{'packet':'private'})
 def test_template_tampering_rejected(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);(root/'followup').mkdir()
   (root/'followup/template-manifest.json').write_text((p.HERE/'followup/template-manifest.json').read_text())
   (root/'followup/catalog.READONLY.sql.in').write_text((p.HERE/'followup/catalog.READONLY.sql.in').read_text()+'DELETE FROM public.tens_in_groups;')
   with patch.object(p,'HERE',root),self.assertRaises(ValueError):p.build(*fixture())
 def test_output_symlink_rejected(self):
  with tempfile.TemporaryDirectory() as d:
   target=Path(d)/'target';target.mkdir();link=Path(d)/'link';link.symlink_to(target)
   with self.assertRaises(ValueError):p.write_new(link,{'packet':'private'})
 def test_pg_json_key_order(self):
  self.assertEqual(p.pg_json([{'type':'jsonb','name':'state','acl':None}]),'[{"acl": null, "name": "state", "type": "jsonb"}]')
 def test_invalid_names_no_sql_injection(self):
  for name in ['bad;delete','bad\\name',"a'b",'$user','quoted name']:
   with self.subTest(name=name),self.assertRaises(ValueError):p.safe_name(name)
 def test_complete_cli_zero_network_and_no_evidence_mutation(self):
  with tempfile.TemporaryDirectory() as d:
   source=Path(d)/'saved';source.mkdir(mode=0o700);rows,r=fixture()
   for name,value in [('catalog-private.json',rows),('report.json',r)]:
    path=source/name;path.write_text(json.dumps(value));path.chmod(0o600)
   before={path.name:path.read_bytes() for path in source.iterdir()}
   with patch('subprocess.run',side_effect=AssertionError('No processes')),patch('socket.socket',side_effect=AssertionError('No network')),contextlib.redirect_stdout(io.StringIO()) as console:
    self.assertEqual(p.main(['--saved-folder',str(source),'--out',str(Path(d)/'new')]),0)
   self.assertNotIn('SECRET',console.getvalue());self.assertIn('attempted: 0',console.getvalue())
   self.assertEqual(before,{path.name:path.read_bytes() for path in source.iterdir()})
   manifest=json.loads((Path(d)/'new/manifest.json').read_text());self.assertFalse(manifest['sql_execution_authorised']);self.assertFalse(manifest['connection_runner_included'])
 def test_failure_does_not_leak(self):
  with contextlib.redirect_stderr(io.StringIO()) as error:
   self.assertEqual(p.main(['--saved-folder','/SECRET_PATH']),1)
  self.assertNotIn('SECRET',error.getvalue())
 def test_excessive_source_scope_rejected(self):
  rows,r=fixture();functions=next(x for x in rows if x['section']=='functions')['items']
  functions.extend([{**functions[0],'oid':1000+i} for i in range(33)])
  with self.assertRaises(ValueError):p.build(rows,r)
 def test_saved_owner_control_flow_is_value_free(self):
  rows,report=fixture();functions=next(x for x in rows if x['section']=='functions')['items']
  functions.append({**functions[0],'name':'owner_list_groups','oid':7,'definition':"AS $$ BEGIN IF p_creation_code <> current_setting('SECRET_SETTING',true) THEN RAISE EXCEPTION 'SECRET_AUTH'; END IF; RETURN; END $$"})
  _,shared,_=p.build(rows,report);sketches=shared['saved_evidence']['owner_guard_sketches_NOT_proof']
  self.assertTrue(any(x['routine']=='owner_list_groups' and 'p_creation_code' in x['control_flow'] for x in sketches));self.assertNotIn('SECRET',json.dumps(shared))
 def test_unknown_arguments_do_not_echo_values(self):
  with contextlib.redirect_stderr(io.StringIO()) as out,self.assertRaises(SystemExit):p.main(['--password','SECRET_VALUE'])
  self.assertNotIn('SECRET',out.getvalue())
if __name__=='__main__':unittest.main()
