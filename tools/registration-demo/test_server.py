"""Offline server security checks: loopback only, no database/Internet requests."""
import http.client
import importlib.util
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
import subprocess

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('demo_server',HERE/'serve.py')
demo=importlib.util.module_from_spec(spec);spec.loader.exec_module(demo)

class DemoTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.assets=demo.build_assets()
        cls.server=demo.make_server('127.0.0.1',0,cls.assets)
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start()
    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown();cls.server.server_close();cls.thread.join()
    def request(self,path,method='GET',headers=None):
        connection=http.client.HTTPConnection('127.0.0.1',self.server.server_port,timeout=3)
        connection.request(method,path,headers=headers or {})
        response=connection.getresponse();result=(response.status,dict(response.headers),response.read());connection.close();return result
    def test_actual_screens_with_filtered_configuration(self):
        status,headers,body=self.request('/app/')
        self.assertEqual(status,200)
        self.assertIn(b'window.IIG_DEMO.storage',body)
        self.assertIn(b'self-service.js',body)
        self.assertIn(b'<title>DEMONSTRATION',body)
        self.assertNotIn(b'cdn.jsdelivr.net',body)
        self.assertNotIn(b'src="./config.js"',body)
        self.assertNotIn(b'VAPID_PUBLIC_KEY="BB',body)
        for name,(_,content) in self.assets.items():
            self.assertNotIn(b'sb_publishable_',content,name)
            self.assertNotIn(b'sb_secret_',content,name)
            self.assertNotIn(b'https://nyavvwrsrxqfyhiygkgw.supabase.co',content,name)
        self.assertIn("connect-src 'none'",headers['Content-Security-Policy'])
        self.assertIn("worker-src 'none'",headers['Content-Security-Policy'])
        self.assertIn("form-action 'none'",headers['Content-Security-Policy'])
        self.assertEqual(headers['Cache-Control'],'no-store')
        self.assertEqual(headers['Referrer-Policy'],'no-referrer')
        self.assertEqual(headers['X-DNS-Prefetch-Control'],'off')
        self.assertEqual(headers['Cross-Origin-Resource-Policy'],'same-origin')
        self.assertNotIn(b'https://wa.me',self.assets['/app/secure-organiser.js'][1])
        self.assertNotIn(b'navigator.share',body)
        self.assertNotIn(b'window.open(',body)
        self.assertNotIn('Access-Control-Allow-Origin',headers)
    def test_explicit_asset_allowlist_rejects_sensitive_and_unknown_paths(self):
        for path in ['/app/config.js','/app/notification-sw.js','/app/manifest.webmanifest','/.git/config',
                     '/docs/pr6-test-rollback-preparation/capture.json','/backup.dump','/app/../config.js',
                     '/app/%2e%2e/%2e%2e/.git/config','/tools/registration-demo/serve.py','/app/owner-dashboard.html']:
            with self.subTest(path=path):self.assertEqual(self.request(path)[0],404)
        for path in self.assets:
            self.assertEqual(self.request(path)[0],200,path)
    def test_no_writable_or_remote_auth_endpoints(self):
        for method in ['POST','PUT','PATCH','DELETE','OPTIONS']:
            self.assertEqual(self.request('/auth/v1/otp',method)[0],405)
        self.assertEqual(self.request('/auth/v1/otp')[0],404)
    def test_dns_rebinding_and_foreign_origins_rejected(self):
        for headers in [{'Host':'evil.example'},{'Host':'0.0.0.0:8765'},{'Origin':'https://evil.example'},
                        {'Origin':'null'},{'Sec-Fetch-Site':'cross-site'},{'Host':'nyavvwrsrxqfyhiygkgw.supabase.co'}]:
            self.assertEqual(self.request('/app/',headers=headers)[0],403)
    def test_only_specific_private_ipv4_bindings(self):
        for host in ['0.0.0.0','8.8.8.8','::','::1','localhost','100.64.0.1']:
            with self.assertRaises(ValueError):demo.make_server(host,0,{})
        for host in ['127.0.0.1','192.168.1.22','10.0.0.2','172.16.5.1']:self.assertTrue(demo.private_ipv4(host))
    def test_source_drift_fails_closed(self):
        with self.assertRaises(ValueError):demo.replace_once('changed','expected','replacement')
        with self.assertRaises(ValueError):demo.replace_once('x x','x','replacement')
    def test_symlink_assets_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'source').write_text('fixture');(root/'linked').symlink_to(root/'source')
            with self.assertRaises(ValueError):demo.read_approved(root,'linked')
    def test_all_app_asset_hashes_are_pinned_not_just_replacement_markers(self):
        original=demo.read_approved
        def changed(directory,name):
            body=original(directory,name)
            return body+b'\n' if directory==demo.REPO/'app' and name=='index.html' else body
        with patch.object(demo,'read_approved',side_effect=changed):
            with self.assertRaisesRegex(ValueError,'Approved app asset changed'):
                demo.build_assets()
    def test_startup_refuses_other_branch_before_building_or_binding(self):
        with patch.object(demo.sys,'argv',['serve.py']), \
             patch.object(demo.subprocess,'run',return_value=subprocess.CompletedProcess([],0,stdout='main\n')), \
             patch.object(demo,'build_assets') as build,patch.object(demo,'make_server') as bind:
            with self.assertRaisesRegex(ValueError,'Switch to improve-new-user-registration'):
                demo.main()
            build.assert_not_called();bind.assert_not_called()
    def test_mac_address_discovery_reads_only_local_interface_settings(self):
        responses=[subprocess.CompletedProcess([],0,stdout='203.0.113.5\n'),
                   subprocess.CompletedProcess([],0,stdout='192.168.4.12\n')]
        with patch.object(demo.sys,'platform','darwin'),patch.object(demo.subprocess,'run',side_effect=responses) as command:
            self.assertEqual(demo.local_address(),'192.168.4.12')
            self.assertEqual([c.args[0] for c in command.call_args_list],
                             [['/usr/sbin/ipconfig','getifaddr','en0'],['/usr/sbin/ipconfig','getifaddr','en1']])
    def test_original_sources_and_private_files_are_not_modified(self):
        before={name:path.read_bytes() for name in ('index.html','self-service.js','config.js') if (path:=demo.REPO/'app'/name).is_file()}
        demo.build_assets()
        for name,value in before.items():self.assertEqual((demo.REPO/'app'/name).read_bytes(),value)

if __name__=='__main__':unittest.main()
