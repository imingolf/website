"""Build an empty local schema from the inspected LIVE definitions; no customer data."""
from pathlib import Path
import json
p=Path(__file__).parent
c=json.loads((p/'catalog.json').read_text())
g=json.loads((p/'guards.json').read_text())
sql=["CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE SCHEMA iig_private; CREATE SCHEMA iig_closed_entry;",
"CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,is_anonymous boolean DEFAULT false,banned_until timestamptz); CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid,not_after timestamptz);",
"CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;"]
for t in c['tables']:
 cols=[]
 for x in t['columns']:
  default=x['default']
  if x['name']=='id' and x['type']=='bigint' and default is None: default=None
  cols.append('"'+x['name']+'" '+x['type']+(' DEFAULT '+default if default else '')+(' NOT NULL' if x['not_null'] else ''))
 sql.append('CREATE TABLE '+t['schema']+'.'+t['name']+'('+','.join(cols)+');')
for x in sorted(c['constraints'],key=lambda x:x['type']=='f'):
 sql.append('ALTER TABLE '+x['schema']+'.'+x['table']+' ADD CONSTRAINT '+x['name']+' '+x['definition']+';')
for f in g+c['functions']:
 if f['name'] in ['verified_organiser','recent_signin','guard_row','release_hold']:
  sql.append(f['definition']+';')
for t in c['triggers']:
 if 'guard_row' in t['definition'] or 'release_hold' in t['definition']: sql.append(t['definition']+';')
sql.append('GRANT USAGE ON SCHEMA public TO authenticated,anon;')
(p/'fixture.sql').write_text('\n'.join(sql))
