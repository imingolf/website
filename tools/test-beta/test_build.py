"""Offline packaging tests. No sockets, databases, credentials from disk, SQL or hosting."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import os
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('test_beta_build',HERE/'build.py')
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
TEST_KEY='sb_publishable_fDGji75-j3GP5VeAAIAdZg_f9TNmtWL' # TEST public fixture, never used online.

def config():
    return {'projectRef':b.PROJECT,'supabaseUrl':b.TEST_URL,'publishableKey':TEST_KEY,'betaOrigin':'https://iig-isolated-beta.invalid'}

class BuildTests(unittest.TestCase):
    def test_only_exact_test_project_and_reviewed_public_key(self):
        self.assertEqual(b.validate_config(config()),config())
        for changes in [{'projectRef':'another-project'},{'supabaseUrl':'https://kzzzputsqxdntfqpprnz.supabase.co'},
                        {'supabaseUrl':b.TEST_URL+'/'},{'supabaseUrl':b.TEST_URL+'@evil.invalid'},
                        {'publishableKey':'sb_secret_fake'},{'publishableKey':'production-public-key'},
                        {'publishableKey':''},{'publishableKey':'eyJ.service_role.not-a-real-token'},
                        {'projectRef':''},{'extra':'unreviewed'}]:
            with self.subTest(changes=changes),self.assertRaises(ValueError):
                b.validate_config({**config(),**changes})
    def test_production_hosts_and_ambiguous_origins_rejected(self):
        for origin in ['https://imingolf.co.uk','https://www.imingolf.co.uk','https://beta.imingolf.co.uk',
                       'https://super-quokka-51747d.netlify.app','https://deploy-preview-6--super-quokka-51747d.netlify.app',
                       'https://nyavvwrsrxqfyhiygkgw.supabase.co','http://beta.invalid','https://localhost','https://127.0.0.1',
                       'https://beta.invalid/','https://beta.invalid?x=y','https://beta.invalid#x','https://user:pass@beta.invalid',
                       'https://beta.invalid:443','https://beta.invalid:443/','https://bad_host.invalid','https://-bad.invalid','https://evil";alert(1);varx=".invalid']:
            with self.subTest(origin=origin),self.assertRaises(ValueError):b.validate_config({**config(),'betaOrigin':origin})
    def test_missing_configuration_has_no_key_fallback(self):
        assets=b.build_assets()
        self.assertEqual(assets['beta/config.js'],b'window.IIG_TEST_BETA_CONFIG=null;\n')
        self.assertNotIn(TEST_KEY.encode(),b'\n'.join(assets.values()))
        self.assertFalse(json.loads(assets['build-manifest.json'])['configured'])
    def test_allowlist_excludes_original_config_demo_sql_and_tools(self):
        assets=b.build_assets(config());b.audit_assets(assets)
        for name in ['app/config.js','app/organiser-test.html','app/player-test.html','app/manifest.webmanifest',
                     'app/notification-sw.js','app/group-setup-preview.html','tools/registration-demo/review.js',
                     'capture.json','rollback.TEST.sql','.git/config']:
            self.assertNotIn(name,assets)
        self.assertNotIn(b'IIG_DEMO',b'\n'.join(assets.values()))
        self.assertNotIn(b'c2JfcHVibGlzaGFibGVfOF9zT2drVGJUaUt5',b'\n'.join(assets.values()))
    def test_production_client_and_pin_autoconnect_removed(self):
        assets=b.build_assets(config());page=assets['app/index.html']
        for value in [b'supabase.createClient',b'src="./config.js"',b'cdn.jsdelivr.net',b'const saved=localStorage.getItem("tensInPin")',
                      b'const setupTokenFromUrl=',b'window.location.assign(link);']:
            self.assertFalse(value in page,value.decode())
        self.assertIn(b'IIG_TEST_BETA.routePin',page)
        self.assertNotIn(b'demoMoneyExample',page)
        self.assertNotIn(b'name:"Greg A"',page)
        self.assertNotIn(b'pin==="2026"',page)
        self.assertNotIn(b'ownerCodeInput").addEventListener',assets['app/owner-dashboard.html'])
        self.assertNotIn(b'OWNER_REMEMBER_KEY',assets['app/owner-dashboard.html'])
    def test_backend_route_and_header_defence(self):
        assets=b.build_assets(config());headers=assets['_headers'].decode();runtime=assets['beta/isolation.js'].decode()
        self.assertIn("connect-src "+b.TEST_URL,headers)
        for rule in ["worker-src 'none'","form-action 'none'","frame-ancestors 'none'",'X-DNS-Prefetch-Control: off','Cache-Control: no-store']:
            self.assertIn(rule,headers)
        for defence in ["redirect:'error'","credentials:'omit'","url.origin!==BASE","jwtIsTest","config.betaOrigin+'/app/'","navigator.serviceWorker?.controller"]:
            self.assertIn(defence,runtime)
    def test_compiled_asset_manifest_checksums(self):
        assets=b.build_assets(config());manifest=json.loads(assets['build-manifest.json'])
        self.assertEqual(manifest['mode'],'TEST_ONLY');self.assertFalse(manifest['deployed'])
        for name,digest in manifest['files'].items():self.assertEqual(hashlib.sha256(assets[name]).hexdigest(),digest)
    def test_source_drift_and_output_injections_are_rejected(self):
        with self.assertRaises(ValueError):b.replace_once('different','expected','new')
        assets=b.build_assets(config());assets['app/config.js']=b'original production configuration'
        with self.assertRaises(ValueError):b.audit_assets(assets)
        assets=b.build_assets(config());assets['app/self-service.js']+=b' kzzzputsqxdntfqpprnz'
        with self.assertRaises(ValueError):b.audit_assets(assets)
    def test_unreviewed_source_hash_fails(self):
        original=Path.read_bytes
        def read(path):
            data=original(path)
            return data+b'\n' if path==b.REPO/'app/index.html' else data
        with patch.object(Path,'read_bytes',read),self.assertRaises(ValueError):b.pinned_sources()
    def test_environment_cannot_supply_a_fallback_configuration(self):
        with patch.dict(os.environ,{'SUPABASE_URL':'https://kzzzputsqxdntfqpprnz.supabase.co','SUPABASE_KEY':'production-fixture','IIG_TEST_BETA_CONFIG':'unreviewed'}):
            assets=b.build_assets()
            self.assertEqual(assets['beta/config.js'],b'window.IIG_TEST_BETA_CONFIG=null;\n')
    def test_artifact_verification_rejects_modified_files_even_with_rewritten_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);assets=b.build_assets(config())
            for name,body in assets.items():
                p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(body)
            self.assertTrue(b.verify_artifact(root)['configured'])
            target=root/'app/self-service.js';target.write_bytes(target.read_bytes()+b'\n// unreviewed code')
            manifest=json.loads((root/'build-manifest.json').read_text())
            manifest['files']['app/self-service.js']=hashlib.sha256(target.read_bytes()).hexdigest()
            (root/'build-manifest.json').write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError,'changed or stale'):b.verify_artifact(root)
    def test_artifact_verification_rejects_extra_production_config(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            for name,body in b.build_assets().items():
                p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(body)
            self.assertFalse(b.verify_artifact(root)['configured'])
            (root/'app/config.js').write_text('must not ship')
            with self.assertRaisesRegex(ValueError,'Unexpected or missing'):b.verify_artifact(root)
    def test_shared_development_configuration_has_no_live_fallback(self):
        source=(b.REPO/'app/config.js').read_text()
        self.assertIn('Object.freeze({supabaseUrl:"",supabaseKey:""})',source)
        for value in ('kzzzputsqxdntfqpprnz','sb_publishable_','atob('):self.assertNotIn(value,source)
    def test_app_sources_and_demonstration_stay_unchanged(self):
        paths=[b.REPO/'app'/n for n in b.APP_FILES]+[b.REPO/'tools/registration-demo/source-sha256.json']
        before={p:p.read_bytes() for p in paths};b.build_assets(config())
        for p,data in before.items():self.assertEqual(p.read_bytes(),data)

if __name__=='__main__':unittest.main()
