from pathlib import Path
import json,runpy
here=Path(__file__).parent
old=here.parents[1]/'organiser-player/tests'
runpy.run_path(str(old/'build-fixture.py'))
text='CREATE ROLE service_role;\n'+(old/'fixture.sql').read_text()
rows=json.loads((here.parent/'baseline/functions.json').read_text())+json.loads((here.parent/'baseline/writers.json').read_text())
text+='\nSET check_function_bodies=false;\n'
text+='\n'.join(x['definition']+';' for x in rows)
text+='\nSET check_function_bodies=true;\n'
# Preserve the actual RPC/private-schema permissions for the affected entry points.
for x in rows:
 text+='REVOKE ALL ON FUNCTION '+x['signature']+' FROM PUBLIC,anon,authenticated;\n'
 if 'authenticated=X' in (x['acl'] or ''): text+='GRANT EXECUTE ON FUNCTION '+x['signature']+' TO authenticated;\n'
(here/'fixture.sql').write_text(text)
print('Synthetic fixture uses audited LIVE functions; contains no customer data.')
