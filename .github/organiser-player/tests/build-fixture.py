"""Empty schema plus audited production functions. Synthetic local tests only."""
from pathlib import Path
import json
p=Path(__file__).parent
c=json.loads((p.parents[1]/'owner-delete/tests/catalog.json').read_text())
f=json.loads((p/'audited-functions.json').read_text())
sql=["CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE SCHEMA iig_private; CREATE SCHEMA iig_closed_entry;",
"CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,is_anonymous boolean DEFAULT false,banned_until timestamptz); CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid,not_after timestamptz);",
"CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;"]
for t in c['tables']:
 cols=[]
 for x in t['columns']:
  default=x['default']
  typ='bigserial' if x['name']=='id' and x['type']=='bigint' and default is None else x['type']
  cols.append('"'+x['name']+'" '+typ+(' DEFAULT '+default if default else '')+(' NOT NULL' if x['not_null'] else ''))
 sql.append('CREATE TABLE '+t['schema']+'.'+t['name']+'('+','.join(cols)+');')
for x in sorted(c['constraints'],key=lambda x:x['type']=='f'):
 sql.append('ALTER TABLE '+x['schema']+'.'+x['table']+' ADD CONSTRAINT '+x['name']+' '+x['definition']+';')
sql.append('SET check_function_bodies=false;')
for x in f: sql.append(x['definition']+';')
sql.append('SET check_function_bodies=true;')
for t in c['triggers']: sql.append(t['definition']+';')
sql.append('GRANT USAGE ON SCHEMA public TO authenticated,anon; INSERT INTO iig_private.registration_settings(singleton,enabled) VALUES(true,true);')
(p/'fixture.sql').write_text('\n'.join(sql))
print('Empty fixture written, with '+str(len(f))+' audited functions')
