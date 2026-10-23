#!/usr/bin/env python3
"""OFFLINE ONLY: review/filter a pg_restore TOC and prepare local rehearsal files."""
import argparse
import re
from pathlib import Path

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--inventory', type=Path, required=True)
p.add_argument('--repo', type=Path, required=True)
p.add_argument('--out', type=Path, required=True)
a = p.parse_args()
staging = a.repo / 'supabase/staging'
sources = [staging / (n + '.sql') for n in
           ['empty-test-schema', 'organiser-access', 'self-service-registration', 'player-scores']]
text = '\n'.join(f.read_text() for f in sources)
functions = set(re.findall(r'create(?: or replace)? function\s+([\w.]+)\s*\(', text, re.I))
tables = {'public.tens_in_groups', 'public.iig_notification_settings',
          'public.iig_notification_events', 'iig_private.setup_testers',
          'iig_private.group_owners', 'iig_private.group_members',
          'iig_private.registration_settings', 'iig_private.platform_owners'}
indexes = {'iig_group_pin_unique', 'iig_notification_events_due_idx'}
selected = []
seen_tables = set()
seen_functions = set()
seen_sequence = False
unknown = []
for line in a.inventory.read_text().splitlines():
    if not line or line.startswith(';'):
        continue
    m = re.match(r'^\d+;\s+\d+\s+\d+\s+(.+?)\s+(public|iig_private|-)\s+(.+)$', line)
    if not m:
        if re.search(r'\b(public|iig_private)\b',line):
            raise SystemExit('Unrecognised application TOC format; review manually: ' + line)
        continue  # Managed-schema entries are never selected.
    kind, schema, tail = m.groups()
    # An application-only selection: never managed schema definitions or data.
    if schema == '-':
        if kind == 'SCHEMA' and tail.split()[0] == 'iig_private':
            selected.append(line)
        continue
    first = tail.split()[0]
    name = schema + '.' + first
    keep = False
    if kind == 'TABLE' and name in tables:
        seen_tables.add(name)
        keep = True
    elif kind in {'TABLE DATA', 'CONSTRAINT', 'FK CONSTRAINT', 'TRIGGER',
                  'POLICY', 'ROW SECURITY', 'DEFAULT'} and name in tables:
        keep = True
    elif kind in {'SEQUENCE', 'SEQUENCE SET', 'SEQUENCE OWNED BY'} and name == 'public.tens_in_groups_id_seq':
        seen_sequence = seen_sequence or kind == 'SEQUENCE'
        keep = True
    elif kind == 'FUNCTION':
        fn = schema + '.' + tail.split('(')[0]
        if fn in functions:
            keep = True
            seen_functions.add(fn)
    elif kind == 'INDEX' and schema == 'public' and first in indexes:
        keep = True
    elif kind in {'COMMENT', 'ACL', 'DEFAULT ACL'}:
        # Ownership/grants absent in this archive; comments are nonfunctional.
        continue
    if keep:
        selected.append(line)
    else:
        unknown.append(line)
if unknown:
    raise SystemExit('Unexpected application-schema entries: review before selection.\n'+'\n'.join(unknown))
if seen_tables != tables or seen_functions != functions or not seen_sequence:
    raise SystemExit('Incomplete baseline inventory. Missing tables: '+str(tables-seen_tables)
                     +'; missing functions: '+str(functions-seen_functions)
                     +'; identity sequence present: '+str(seen_sequence))
a.out.mkdir(parents=True, exist_ok=True)
(a.out/'restore-selection.app.txt').write_text('; CANDIDATE: inspect schema SQL before execution. Auth/managed objects excluded.\n'+'\n'.join(selected)+'\n')
# Extract only top-level GRANT/REVOKE statements, never the destructive baseline setup.
grants = re.findall(r'^(?:grant|revoke)\b[^;]*;', text, re.M | re.I)
(a.out/'baseline-acl.sql').write_text('-- Intended repository baseline ACLs; not recovered online ACLs.\n'+'\n'.join(grants)+'\n')
base = (a.repo/'docs/pr6-test-rollback-preparation/prepare.py').read_text()
assert "PROJECT = 'nyavvwrsrxqfyhiygkgw'" in base
local = base.replace('nyavvwrsrxqfyhiygkgw', 'ImInGolf-Local-Rehearsal')
(a.out/'prepare-local-rollback.py').write_text(local)
print('Offline candidate selection prepared. Inspect pre/post SQL before any local execution.')
