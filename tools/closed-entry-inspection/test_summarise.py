import contextlib
import copy
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
spec=importlib.util.spec_from_file_location('summary',Path(__file__).with_name('summarise.py'))
s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s)
SECRET='DO_NOT_SHARE_SECRET'
def fixture():
 sections=[{'section':k,'items':[]} for k in sorted(s.SECTIONS-{'identity'})]
 sections.append(dict(section='identity',database='postgres',role='postgres',read_only='on',backend_ssl=True,version=SECRET))
 fn=dict(owner=SECRET,security_definer=True,configuration=[SECRET],acl=[SECRET],anon_execute=True,authenticated_execute=True,service_role_execute=True,definition="state = p_state; p_pin; auth.uid(); '"+SECRET+"'")
 next(x for x in sections if x['section']=='functions')['items']=[dict(fn,name=n) for n in ('save_group_state','get_group_state')]
 return sections,dict(project=s.PROJECT,connections_attempted=1,group_rows_read=0,result=SECRET)
class Safety(unittest.TestCase):
 def test_raw_secrets_never_reflected(self):
  result=s.summarise(*fixture());text=json.dumps(result);self.assertNotIn(SECRET,text);self.assertNotIn('definition',text)
 def test_reference_is_not_proof(self):
  result=s.summarise(*fixture());self.assertIn('UNVERIFIED',result['organiser_authority']);self.assertTrue(result['functions'][0]['references_NOT_proof']['auth_uid_reference'])
 def test_null_acl(self):
  rows,r=fixture();next(x for x in rows if x['section']=='functions')['items'][0]['acl']=None
  self.assertTrue(s.summarise(rows,r)['functions'][0]['acl_is_null'])
 def test_bad_identity(self):
  for field,value in [('role','anon'),('backend_ssl',False),('read_only','off')]:
   rows,r=fixture();next(x for x in rows if x['section']=='identity')[field]=value
   with self.subTest(field=field),self.assertRaises(ValueError):s.summarise(rows,r)
 def test_wrong_project(self):
  rows,r=fixture();r['project']='nyavvwrsrxqfyhiygkgw'
  with self.assertRaises(ValueError):s.summarise(rows,r)
 def test_unknown_name_not_reflected(self):
  rows,r=fixture();next(x for x in rows if x['section']=='functions')['items'][0]['name']=SECRET
  with self.assertRaises(ValueError):s.summarise(rows,r)
 def test_string_boolean_rejected(self):
  rows,r=fixture();next(x for x in rows if x['section']=='functions')['items'][0]['anon_execute']=SECRET
  with self.assertRaises(ValueError):s.summarise(rows,r)
 def test_missing_section(self):
  rows,r=fixture()
  with self.assertRaises(ValueError):s.summarise(rows[:-1],r)
 def test_private_file(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'evidence';p.write_text('{}');p.chmod(0o600);self.assertEqual(s.read_private(p),{})
   p.chmod(0o644)
   with self.assertRaises(ValueError):s.read_private(p)
 def test_symlink_rejected(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'evidence';p.write_text('{}');p.chmod(0o600);link=Path(d)/'link';link.symlink_to(p)
   with self.assertRaises(ValueError):s.read_private(link)
 def test_complete_cli_no_write(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);root.chmod(0o700);rows,r=fixture()
   for name,data in [('catalog-private.json',rows),('report.json',r)]:
    p=root/name;p.write_text(json.dumps(data));p.chmod(0o600)
   before={p.name:p.read_bytes() for p in root.iterdir()}
   with contextlib.redirect_stdout(io.StringIO()) as out:self.assertEqual(s.main(['--folder',d]),0)
   self.assertNotIn(SECRET,out.getvalue());self.assertEqual(before,{p.name:p.read_bytes() for p in root.iterdir()})
 def test_failure_sanitised(self):
  with contextlib.redirect_stderr(io.StringIO()) as out:self.assertEqual(s.main(['--folder','/'+SECRET]),1)
  self.assertNotIn(SECRET,out.getvalue())
if __name__=='__main__':unittest.main()
