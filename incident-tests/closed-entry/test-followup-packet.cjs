// Only local synthetic catalog metadata; full online TLS guard is NEVER disabled
// in the exported file. This test runs its catalog statements AFTER that guard.
const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..');
(async()=>{
 const db=new PGlite();const dir=fs.mkdtempSync(path.join(os.tmpdir(),'iig-followup-fixture-'));fs.chmodSync(dir,0o700);
 try{
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
   CREATE SCHEMA iig_private;
   CREATE TABLE public.tens_in_groups(id bigint PRIMARY KEY,group_pin text,state jsonb,updated_at timestamptz);
   CREATE TABLE iig_private.fixture_events(id bigint REFERENCES public.tens_in_groups(id),kind text,title text,body text,UNIQUE(id,kind));
   CREATE FUNCTION public.get_group_state(p_pin text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
    SELECT state FROM public.tens_in_groups WHERE group_pin=p_pin $$;
   CREATE FUNCTION public.save_group_state(p_pin text,p_state jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
    BEGIN UPDATE public.tens_in_groups SET state=p_state,updated_at=now() WHERE group_pin=p_pin; RETURN FOUND; END $$;
   CREATE FUNCTION public.fixture_salt(value text) RETURNS text LANGUAGE sql AS $$ SELECT value $$;
   CREATE FUNCTION public.fixture_salt(value integer) RETURNS text LANGUAGE sql AS $$ SELECT value::text $$;
   CREATE FUNCTION public.create_golf_group() RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$ SELECT public.fixture_salt('fictional') $$;
   CREATE FUNCTION public.fixture_hook() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
    BEGIN CASE WHEN TG_OP='UPDATE' THEN BEGIN PERFORM sum(x) FROM generate_series(1,2) x; INSERT INTO iig_private.fixture_events(id,kind) VALUES(NEW.id,'fictional') ON CONFLICT DO NOTHING; EXCEPTION WHEN unique_violation THEN RAISE; END; ELSE RETURN NEW; END CASE; RETURN NEW; END $$;
   CREATE TRIGGER fixture_hook AFTER UPDATE ON public.tens_in_groups FOR EACH ROW EXECUTE FUNCTION public.fixture_hook();`);
  await db.exec('REVOKE EXECUTE ON FUNCTION public.save_group_state(text,jsonb) FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.save_group_state(text,jsonb) TO anon,authenticated,service_role; GRANT SELECT,UPDATE ON public.tens_in_groups TO service_role;');
  const original=fs.readFileSync(path.join(root,'tools/closed-entry-inspection/inspection.sql'),'utf8');
  const metadata=original.slice(original.indexOf("SELECT jsonb_build_object('section','identity'"),original.lastIndexOf('COMMIT;'));
  await db.exec('BEGIN READ ONLY; SET LOCAL default_transaction_read_only=on; SET LOCAL search_path=pg_catalog;');
  const results=await db.exec(metadata);await db.exec('COMMIT');const rows=results.map(x=>x.rows[0].jsonb_build_object);
  // Simulated successful PG17/TLS saved identity ONLY in this fictional unit
  // fixture. Embedded PGlite can use a different server major; the exported
  // identity/TLS/version guard remains intact and is not executed here.
  rows.find(x=>x.section==='identity').version='17.11';
  const saved=path.join(dir,'saved');fs.mkdirSync(saved,{mode:0o700});
  for(const [name,value] of [['catalog-private.json',rows],['report.json',{project:'kzzzputsqxdntfqpprnz',connections_attempted:1,group_rows_read:0}]]){
   fs.writeFileSync(path.join(saved,name),JSON.stringify(value),{mode:0o600});
  }
  const out=path.join(dir,'package');
  const result=spawnSync('python3',[path.join(root,'tools/closed-entry-inspection/prepare_followup.py'),'--saved-folder',saved,'--out',out],{encoding:'utf8',timeout:10000});
  assert.equal(result.status,0,result.stderr);
  const packet=fs.readFileSync(path.join(out,'catalog.READONLY.REVIEW.sql'),'utf8');
  assert.match(packet,/pg_stat_ssl/);assert.match(packet,/identity_readonly_tls_guard/);
  // Test SAME exported SQL after its identity/TLS guard in a local READ ONLY tx.
  // PGlite has no TLS socket. No edited packet is written or made executable.
  const afterGuard=packet.slice(packet.indexOf('-- Stop on changed/missing'));
  await db.exec('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL search_path=pg_catalog;');
  const followup=await db.exec(afterGuard);
  const sections=followup.flatMap(r=>r.rows).map(x=>x.jsonb_build_object).filter(Boolean);
  assert.equal(sections.length,3);
  const candidates=sections.find(x=>x.section==='candidate_bindings');
  assert.equal(candidates.within_reviewed_limit,true);
  assert.equal(candidates.items.filter(x=>x.name==='fixture_salt').length,2);
  assert.equal(candidates.items.filter(x=>x.name==='fixture_salt').every(x=>x.extension===null),true);
  const tables=sections.find(x=>x.section==='target_constraints_indexes').items;
  const events=tables.find(x=>x.name==='fixture_events');assert.ok(events.constraints.some(x=>x.type==='u'));assert.ok(events.constraints.some(x=>x.type==='f'));
  assert.ok(events.indexes.some(x=>x.unique));
  const raw=['1',...followup.filter(x=>x.rows.length).map(x=>{
   const value=Object.values(x.rows[0])[0];return typeof value==='object'?JSON.stringify(value):String(value);
  })].join('\n');
  const rawFile=path.join(dir,'synthetic-followup.jsonl');fs.writeFileSync(rawFile,raw,{mode:0o600});
  const parsed=spawnSync('python3',['-c',"import sys,json;sys.path.insert(0,sys.argv[1]);import followup_runner as r;print(len(r.parse(open(sys.argv[3]).read(),json.load(open(sys.argv[2])))))",path.join(root,'tools/closed-entry-inspection'),path.join(out,'request-parameters.PRIVATE.json'),rawFile],{encoding:'utf8',timeout:10000});
  assert.equal(parsed.status,0,parsed.stderr);assert.equal(parsed.stdout.trim(),'3');

  // Full offline reviewer path: real generated package + synthetic saved catalog.
  const savedFollowup=path.join(dir,'saved-followup');fs.mkdirSync(savedFollowup,{mode:0o700});
  fs.writeFileSync(path.join(savedFollowup,'catalog-followup.PRIVATE.json'),JSON.stringify(sections),{mode:0o600});
  fs.writeFileSync(path.join(savedFollowup,'report.SANITISED.json'),JSON.stringify({
   project:'kzzzputsqxdntfqpprnz',connections_attempted:1,group_records_read:0,
   captured_function_attributes_trigger_definitions_target_fingerprints_match:true,server_version_matches_saved_capture:true
  }),{mode:0o600});
  const semantic=spawnSync('python3',[path.join(root,'tools/closed-entry-inspection/semantic_saved.py'),
   '--saved-folder',saved,'--package',out,'--folder',savedFollowup,'--after-update-only'],{encoding:'utf8',timeout:10000});
  assert.equal(semantic.status,0,semantic.stderr);
  const review=JSON.parse(semantic.stdout);assert.equal(review.database_connections,0);assert.equal(review.scope,'AFTER_UPDATE_ONLY');
  assert.equal(review.triggers.length,1);
  assert.equal(review.triggers[0].status,'STRUCTURAL_PATHS_EXTRACTED_NOT_SEMANTIC_PROOF');
  assert.equal(review.triggers[0].statement_cases.length,1);
  assert.equal(review.triggers[0].exception_blocks.filter(x=>x.handlers.length).length,1);
  assert.ok(review.triggers[0].events.some(x=>x.kind==='write'&&x.conflict.targetless));
  for(const privateText of ['fixture_events','fixture_hook','fictional','iig_private','generate_series'])assert.equal(semantic.stdout.includes(privateText),false);

  // A changed original definition stops the packet before new collection.
  await db.exec(`CREATE OR REPLACE FUNCTION public.get_group_state(p_pin text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$ SELECT '{}'::jsonb $$;`);
  await db.exec('BEGIN READ ONLY; SET LOCAL search_path=pg_catalog;');
  await assert.rejects(()=>db.exec(afterGuard),/division by zero/);await db.exec('ROLLBACK');
  console.log('PASS: generated metadata packet syntax, source/config/ACL/column fingerprints, two overload candidates, uniqueness/FK/index evidence, sanitised semantic review and drift rejection in local fictional PostgreSQL. Online TLS/identity guard retained; no online connections.');
 }finally{await db.close();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
