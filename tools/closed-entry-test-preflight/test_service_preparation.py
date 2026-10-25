import contextlib
import importlib.util
import io
import json
from pathlib import Path
import ssl
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
spec=importlib.util.spec_from_file_location('service_preparation',HERE/'prepare-service.py')
h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
p=h.p

class ServicePreparation(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
        self.service=self.root/'service.conf';self.ca=self.root/'prod-ca-2021 (1).crt'
        self.ca.write_text('-----BEGIN CERTIFICATE-----\nFICTIONAL TEST\n-----END CERTIFICATE-----');self.ca.chmod(0o644)
        self.fields={'host':p.POOLER,'user':'postgres.'+p.PROJECT,'port':'5432','dbname':'postgres','sslmode':'require'}
        self.save()
    def save(self):
        self.service.write_text('[iig-test-only]\n'+'\n'.join(k+'='+v for k,v in self.fields.items())+'\n[other]\npassword=UNRELATED_SECRET\n')
        self.service.chmod(0o600)
    def args(self):return SimpleNamespace(service=self.service,ca=self.ca)
    def run_prepare(self):
        defaults={'capture':self.root/'capture','rollback':self.root/'rollback','backup':self.root/'backup','service':self.service,'out':self.root/'unused'}
        with patch.object(h.ssl,'create_default_context'),patch.object(p,'default_paths',return_value=defaults),patch.object(p,'prepare',side_effect=lambda a:a.out) as prepare,patch('socket.socket',side_effect=AssertionError('network')),patch('subprocess.run',side_effect=AssertionError('external process')),contextlib.redirect_stdout(io.StringIO()) as out:
            folder=h.prepare(self.args())
        return folder,prepare.call_args.args[0],out.getvalue()
    def test_weak_service_strict_private_copy_originals_unchanged(self):
        before=self.service.read_bytes();ca=self.ca.read_bytes();folder,args,out=self.run_prepare()
        self.assertEqual(self.service.read_bytes(),before);self.assertEqual(self.ca.read_bytes(),ca)
        self.assertEqual(args.ca.stat().st_mode&0o777,0o600);self.assertEqual(args.service.stat().st_mode&0o777,0o600)
        self.assertEqual(self.ca.stat().st_mode&0o777,0o644)
        text=args.service.read_text();self.assertIn('sslmode=verify-full',text);self.assertIn('host='+p.HOST,text)
        self.assertNotIn('UNRELATED_SECRET',text);self.assertNotIn('UNRELATED_SECRET',out)
        self.assertIn('sslmode: require',out);self.assertIn('attempted: 0',out)
        self.assertEqual(p.service(args.service)['source_route'],'direct')
    def test_absent_sslmode_reported_not_guessed(self):
        del self.fields['sslmode'];self.save();folder,args,out=self.run_prepare()
        self.assertIn('ABSENT',out);self.assertIn('verify-full',args.service.read_text())
    def test_already_full_still_no_original_change(self):
        self.fields['sslmode']='verify-full';self.save();before=self.service.read_bytes()
        self.run_prepare();self.assertEqual(before,self.service.read_bytes())
    def test_all_recognised_weak_modes_only_strengthened(self):
        for mode in ['disable','allow','prefer','verify-ca']:
            self.fields['sslmode']=mode;self.save();folder,args,out=self.run_prepare();self.assertIn('sslmode=verify-full',args.service.read_text())
    def test_live_host_rejected(self):
        self.fields['host']='db.kzzzputsqxdntfqpprnz.supabase.co';self.save()
        with self.assertRaises(p.Stop):h.prepare(self.args())
    def test_wrong_user_and_overrides_rejected(self):
        for key,value in [('user','postgres.other'),('hostaddr','1.2.3.4'),('options','-c role=x'),('password','SECRET')]:
            original=dict(self.fields);self.fields[key]=value;self.save()
            with self.subTest(key=key),self.assertRaises(p.Stop):h.prepare(self.args())
            self.fields=original
    def test_unknown_mode_not_echoed(self):
        self.fields['sslmode']='PRIVATE_SECRET';self.save()
        with contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(h.main(['--service',str(self.service),'--ca',str(self.ca)]),1)
        self.assertNotIn('PRIVATE_SECRET',out.getvalue())
    def test_public_CA_source_ownership_and_write_restrictions(self):
        for mode in [0o666,0o622]:
            self.ca.chmod(mode)
            with self.subTest(mode=mode),self.assertRaises(p.Stop):h.source_certificate(self.ca)
    def test_CA_source_symlink_rejected(self):
        link=self.root/'link';link.symlink_to(self.ca)
        with self.assertRaises(p.Stop):h.source_certificate(link)
    def test_invalid_or_private_key_CA_stops(self):
        with self.assertRaises(ssl.SSLError):h.source_certificate(self.ca)
        self.ca.write_text('-----BEGIN PRIVATE KEY-----')
        with self.assertRaises(p.Stop):h.source_certificate(self.ca)
    def test_missing_CA_stops_without_output(self):
        self.ca.unlink()
        with self.assertRaises(p.Stop):h.prepare(self.args())
        self.assertFalse(list(self.root.glob('closed-entry-tls-offline-*')))
    def test_no_connection_cli_option(self):
        with contextlib.redirect_stderr(io.StringIO()),self.assertRaises(SystemExit):h.main(['--ca',str(self.ca),'--connect-test-readonly',p.PROJECT])
    def test_normal_runner_still_rejects_weaker_original(self):
        with self.assertRaises(p.Stop):p.service(self.service)

if __name__=='__main__':unittest.main()
