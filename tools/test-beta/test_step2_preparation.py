"""Offline package review only: never connects to PostgreSQL or executes SQL."""
import ast
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('step2',HERE/'prepare-step2.py')
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)

class PreparationTests(unittest.TestCase):
    def test_queries_and_manifest_are_readonly_preparation_not_execution(self):
        files=p.package();self.assertEqual(set(files),{'01-original-capture.sql','02-auth-ownership.sql','03-beta-catalog.sql','manifest.json'})
        manifest=json.loads(files['manifest.json']);self.assertFalse(manifest['installation_authorised']);self.assertTrue(manifest['requires_connection_identity_guard'])
        self.assertEqual(manifest['reviewed_preparation_commit'],p.REF)
        for name,text in files.items():
            if not name.endswith('.sql'):continue
            self.assertIn('READ ONLY',text);self.assertIn('ON_ERROR_STOP on',text)
            self.assertNotRegex(text,re.compile(r'^\s*(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|COPY|CALL|EXECUTE)\s',re.I|re.M))
            self.assertEqual(hashlib.sha256(text.encode()).hexdigest(),manifest['sha256'][name])
    def test_only_local_git_show_is_used(self):
        original=p.subprocess.run
        with patch.object(p.subprocess,'run',wraps=original) as command:p.package()
        self.assertTrue(command.call_count)
        for call in command.call_args_list:
            args=call.args[0];self.assertEqual(args[:4],['git','-C',str(p.REPO),'show']);self.assertTrue(args[4].startswith(p.REF+':'))
    def test_sql_literals_are_extracted_without_running_python(self):
        self.assertEqual(p.literal("READ_GUARD='BEGIN READ ONLY;'",'READ_GUARD'),'BEGIN READ ONLY;')
        with self.assertRaises(ValueError):p.literal("READ_GUARD=arbitrary_function()",'READ_GUARD')
        with self.assertRaises(ValueError):p.literal("OTHER='query'",'READ_GUARD')
    def test_catalog_contains_counts_fingerprints_roles_constraints_and_no_pii_projection(self):
        sql=(HERE/'step2-catalog.sql').read_text()
        for field in ['3520','5021','state_md5','row_md5','membership_matches','ownership_constraints','anon_execute','authenticated_execute','writer_locks','prepared_transactions']:
            self.assertIn(field,sql)
        for expression in ['u.email,','u.encrypted_password','u.raw_user_meta_data']:self.assertNotIn(expression,sql)
    def test_original_capture_query_preserved_after_guard(self):
        files=p.package();capture=p.source('pre-install-capture.sql').removeprefix('\\set ON_ERROR_STOP on\n')
        self.assertTrue(files['01-original-capture.sql'].endswith(capture))

if __name__=='__main__':unittest.main()
