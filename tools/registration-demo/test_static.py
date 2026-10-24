"""Offline static-package isolation tests. No sockets, database or deployment."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('static_demo',HERE/'build_static.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class StaticDemoTests(unittest.TestCase):
 def test_allowlist_no_credentials_database_or_repository_files(self):
  files=m.assets('https://iig-demo.example.test')
  self.assertEqual(set(files),{'index.html','404.html','robots.txt','_headers','_redirects','app/index.html','app/handicap-input.js','app/secure-organiser.js','app/secure-player.js','app/account-controls.js','app/self-service.js','app/icon-192.png','app/apple-touch-icon.png','demo/review.js','demo/review.css','demo/host-boundary.js','demo/hosted-review.js','demo/hosted-review.css'})
  for name,body in files.items():
   for token in (b'sb_publishable_',b'sb_secret_',b'nyavvwrsrxqfyhiygkgw',b'kzzzputsqxdntfqpprnz',b'imingolf.co.uk',b'super-quokka-51747d'):
    self.assertNotIn(token,body,name)
  self.assertNotIn(b'./config.js',files['app/index.html']);self.assertNotIn(b'cdn.jsdelivr.net',files['app/index.html'])
  self.assertNotIn(b'window.location.assign(link)',files['app/index.html'])
 def test_https_origin_required_and_production_database_origins_rejected(self):
  for origin in ['http://demo.example.test','https://imingolf.co.uk','https://www.imingolf.co.uk','https://super-quokka-51747d.netlify.app','https://deploy-preview-9--super-quokka-51747d.netlify.app','https://nyavvwrsrxqfyhiygkgw.supabase.co','https://supabase.co','https://supabase.com','https://db.other.supabase.co','https://u:p@demo.test','https://demo.test/x','https://demo.test?a=1','https://demo.test#x','https://demo.test:5432']:
   with self.subTest(origin=origin),self.assertRaises(ValueError):m.checked_origin(origin)
 def test_independent_csp_headers_and_meta_no_storage_or_workers(self):
  files=m.assets('https://demo.example.test');headers=files['_headers'].decode()
  for rule in ["connect-src 'none'","worker-src 'none'","form-action 'none'","frame-ancestors 'none'","object-src 'none'",'Cache-Control: no-store','X-Robots-Tag: noindex']:
   self.assertIn(rule,headers)
  for name in ('index.html','app/index.html'):self.assertIn(b'http-equiv="Content-Security-Policy"',files[name])
  self.assertIn(b"location.origin===\"https://demo.example.test\"",files['demo/host-boundary.js'])
  self.assertIn(b'window.IIG_DEMO.storage',files['app/index.html'])
  self.assertNotIn(b'https://wa.me',files['app/secure-organiser.js'])
 def test_build_has_exact_hashes_outside_repo_no_overwrite_and_no_network_process(self):
  with tempfile.TemporaryDirectory() as d:
   out=Path(d)/'generated'
   with patch.object(m.subprocess,'run',return_value=subprocess.CompletedProcess([],0,stdout='improve-new-user-registration\n')) as command:
    result=m.build(out,'https://demo.example.test')
    command.assert_called_once();self.assertEqual(command.call_args.args[0][:4],['git','-C',str(m.demo.REPO),'branch'])
   self.assertFalse(result['deployed']);self.assertFalse(result['database_connections'])
   for name,sha in result['sha256'].items():self.assertEqual(hashlib.sha256((out/name).read_bytes()).hexdigest(),sha)
   with self.assertRaises(ValueError):m.build(out,'https://demo.example.test')
   with self.assertRaises(ValueError):m.build(m.demo.REPO/'unsafe-demo-output','https://demo.example.test')
 def test_verifier_rejects_tampering_unknown_files_symlinks_and_wrong_origin(self):
  with tempfile.TemporaryDirectory() as d:
   out=Path(d)/'site'
   with patch.object(m.subprocess,'run',return_value=subprocess.CompletedProcess([],0,stdout='improve-new-user-registration\n')):m.build(out,'https://demo.example.test')
   m.verify(out,'https://demo.example.test')
   original=(out/'app/self-service.js').read_bytes();(out/'app/self-service.js').write_bytes(original+b'changed')
   with self.assertRaises(ValueError):m.verify(out,'https://demo.example.test')
   (out/'app/self-service.js').write_bytes(original);(out/'accidental-backup.dump').write_text('fictional test fixture')
   with self.assertRaises(ValueError):m.verify(out,'https://demo.example.test')
   (out/'accidental-backup.dump').unlink();(out/'linked').symlink_to(out/'index.html')
   with self.assertRaises(ValueError):m.verify(out,'https://demo.example.test')
   (out/'linked').unlink()
   with self.assertRaises(ValueError):m.verify(out,'https://different.example.test')
 def test_wrong_branch_and_source_drift_stop_before_output(self):
  with tempfile.TemporaryDirectory() as d:
   out=Path(d)/'output'
   with patch.object(m.subprocess,'run',return_value=subprocess.CompletedProcess([],0,stdout='main\n')),self.assertRaises(ValueError):m.build(out,'https://demo.example.test')
   self.assertFalse(out.exists())
   with patch.object(m.demo,'build_assets',side_effect=ValueError('source drift')),self.assertRaises(ValueError):m.build(out,'https://demo.example.test')
   self.assertFalse(out.exists())
 def test_landing_is_fictional_and_feedback_is_manual(self):
  files=m.assets('https://demo.example.test')
  self.assertIn(b'@example.test',files['index.html']);self.assertIn(b'123456',files['index.html'])
  self.assertIn(b'/app/?scenario=friend',files['index.html']);self.assertIn(b'DEMONSTRATION',files['index.html'])
  self.assertIn(b'Nothing here is sent or saved online',files['demo/hosted-review.js'])
  self.assertNotIn(b'data-netlify',files['demo/hosted-review.js'])

if __name__=='__main__':unittest.main()
