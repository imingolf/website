// Isolated parser evidence only; no online database or real saved definitions.
const {PGlite}=require('@electric-sql/pglite');
const assert=require('node:assert/strict');
(async()=>{
 const db=new PGlite();
 try{
  await db.exec(`CREATE FUNCTION public.trim(text) RETURNS text LANGUAGE sql AS $$ SELECT 'fictional-custom-trim'::text $$;
   CREATE VIEW public.fixture_trim AS SELECT trim(' x ') AS both_sides,
    trim(leading 'x' from 'xxgolf') AS leading_side,trim(trailing 'x' from 'golfxx') AS trailing_side,
    public.trim(' x ') AS qualified;`);
  const definition=(await db.query("SELECT pg_get_viewdef('public.fixture_trim'::regclass,true) AS definition")).rows[0].definition;
  assert.match(definition,/TRIM\(BOTH/);
  const bindings=(await db.query(`SELECT DISTINCT p.proname FROM pg_catalog.pg_rewrite r
    CROSS JOIN LATERAL regexp_matches(r.ev_action::text, ':funcid ([0-9]+)', 'g') AS m
    JOIN pg_catalog.pg_proc p ON p.oid=(m[1])::oid
    WHERE r.ev_class='public.fixture_trim'::regclass`)).rows.map(x=>x.proname);
  for(const builtin of ['btrim','ltrim','rtrim','trim'])assert.ok(bindings.includes(builtin));
  const row=(await db.query('SELECT * FROM public.fixture_trim')).rows[0];
  assert.deepEqual(row,{both_sides:'x',leading_side:'golf',trailing_side:'golf',qualified:'fictional-custom-trim'});
  console.log('PASS: local PostgreSQL parser lowers unqualified TRIM to btrim/ltrim/rtrim; qualified custom trim remains distinct. Actual LIVE overload bindings NOT proved.');
 }finally{await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
