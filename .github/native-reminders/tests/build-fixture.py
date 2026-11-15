from pathlib import Path
import runpy
here=Path(__file__).parent
base=here.parents[1]/'owner-delete/tests'
runpy.run_path(str(base/'build-fixture.py'))
# Reminder RPCs read golf state only. Fixture state is seeded directly; unrelated
# gameplay-write triggers are excluded, not changed by the reminder migration.
sql='\n'.join(line for line in (base/'fixture.sql').read_text().splitlines() if not line.startswith('CREATE TRIGGER'))
sql+='''
CREATE ROLE service_role;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claims',true),'')::jsonb $$;
'''
(here/'fixture.sql').write_text(sql)
