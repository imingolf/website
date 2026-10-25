const {PGlite}=require('@electric-sql/pglite');
const {createTransitionClient}=require('./client-transition-contract.cjs');
const {fixture,originalFinish}=require('./test-source-finish.cjs');
const fs=require('node:fs'),assert=require('node:assert/strict'),{randomUUID,randomBytes}=require('node:crypto');
(async()=>{
 const db=new PGlite();let count=0;
 try{
  for(const file of ['prototype.sql','legacy-adapter.sql','legacy-finish-result.sql','finish-receipts.sql','five-path-contract.sql'])await db.exec(fs.readFileSync(__dirname+'/'+file,'utf8'));
  await db.exec(`CREATE ROLE five_actor; GRANT USAGE ON SCHEMA iig_legacy_fixture TO five_actor;
   GRANT EXECUTE ON FUNCTION iig_legacy_fixture.finish_five_once(text,text,bigint,text,uuid,jsonb),iig_legacy_fixture.finish_receipt(text,text,uuid) TO five_actor;`);
  async function as(fn){await db.exec('SET SESSION AUTHORIZATION five_actor');try{return await fn();}finally{await db.exec('RESET ROLE;SET SESSION AUTHORIZATION postgres;RESET ROLE');}}
  async function seed(g,options={}){
   const before=fixture({game:'money',format:'stableford',...options}),after=await originalFinish({...before,_entry_revision:0}),cap=randomBytes(32).toString('hex');
   await db.query("INSERT INTO iig_entry_prototype.groups(id,phase,state) VALUES($1,'open',$2)",[g,before]);
   await db.query('INSERT INTO iig_legacy_fixture.tens_in_groups(id,group_pin,state) VALUES($1,$1,$2)',[g,before]);
   await db.query("INSERT INTO iig_legacy_fixture.organiser_capabilities VALUES($1,iig_legacy_fixture.token_hash($2),'2099-01-01',false,ARRAY['finish'])",[g,cap]);
   return {g,before,after,cap,id:randomUUID()};
  }
  async function finish(x){return as(async()=>(await db.query('SELECT iig_legacy_fixture.finish_five_once($1,$2,0,$3,$4,$5) AS result',[x.g,x.before.roundId,x.cap,x.id,x.after])).rows[0].result);}
  async function inventory(){const out={};for(const [schema,tables] of [['iig_entry_prototype',['groups','archives']],['iig_legacy_fixture',['tens_in_groups','result_effects','transition_receipts','history_payment_events','enabled_status','path_effects']]])for(const t of tables)out[t]=(await db.query(`SELECT to_jsonb(r) AS row FROM ${schema}.${t} r ORDER BY to_jsonb(r)::text`)).rows;return out;}
  async function rejected(x){const old=await inventory();await assert.rejects(()=>finish(x),/PATH_POSTCONDITION_FAILED/);assert.deepEqual(await inventory(),old);count++;}
  for(const [i,options] of [{},{game:'points',format:'net'},{trip:true},{trip:true,last:true},{trip:true,last:true,pair:'betterball'}].entries()){
   const x=await seed('complete-'+i,options);await finish(x);
   const written=(await db.query('SELECT path,payload FROM iig_legacy_fixture.path_effects WHERE group_id=$1 ORDER BY path',[x.g])).rows;
   const expected=(await db.query('SELECT * FROM iig_legacy_fixture.expected_paths($1,$2) ORDER BY path',[x.before,x.after])).rows;
   assert.deepEqual(written,expected);count++;
   const beforeRetry=await inventory();assert.equal((await finish(x)).replayed,true);assert.deepEqual(await inventory(),beforeRetry);count++;
  }
  // For each of the five hypothetical paths, fail AFTER writing within the inner
  // exception scope. Compare all state, receipts and effects without deleting data.
  for(const mode of ['return_new','fallthrough'])for(let path=1;path<=5;path++){
   const x=await seed(mode+'-'+path,{game:path===3?'points':'money',trip:path===4});
   await db.query('INSERT INTO iig_legacy_fixture.path_faults VALUES($1,$2,$3)',[x.g,path,mode]);
   await rejected(x);
  }
  for(let path=1;path<=5;path++){
   const x=await seed('conflict-'+path,{game:path===3?'points':'money',trip:path===4});
   await db.query('INSERT INTO iig_legacy_fixture.path_effects VALUES($1,$2,$3,$4)',[x.g,x.before.roundId,path,{wrong:'fictional'}]);
   await rejected(x);
  }
  // An identical preexisting effect is legitimate deduplication, unlike a
  // different payload suppressed by DO NOTHING. Both cases use untouched seeds.
  const identical=await seed('identical-existing');
  await db.query('INSERT INTO iig_legacy_fixture.path_effects SELECT $1,$2,path,payload FROM iig_legacy_fixture.expected_paths($3,$4)',[identical.g,identical.before.roundId,identical.before,identical.after]);
  await finish(identical);assert.equal((await db.query('SELECT count(*)::int AS n FROM iig_legacy_fixture.path_effects WHERE group_id=$1',[identical.g])).rows[0].n,3);count++;
  // Negative controls prove the underlying swallowed exceptions are real:
  // without the outer postcondition, finish can succeed with incomplete effects.
  for(const [mode,expected] of [['return_new',1],['fallthrough',0]]){
   const x=await seed('negative-'+mode,{game:'points'});await db.query('INSERT INTO iig_legacy_fixture.path_faults VALUES($1,3,$2)',[x.g,mode]);
   await db.query('SELECT iig_legacy_fixture.finish_with_result($1,$2,0,$3,$4)',[x.g,x.before.roundId,x.cap,x.after]);
   assert.equal((await db.query('SELECT count(*)::int AS n FROM iig_legacy_fixture.path_effects WHERE group_id=$1',[x.g])).rows[0].n,expected);
   assert.equal((await db.query('SELECT phase FROM iig_entry_prototype.groups WHERE id=$1',[x.g])).rows[0].phase,'finished');count++;
  }
  const notApplicable=await seed('not-applicable',{game:'points'});
  await db.query('INSERT INTO iig_legacy_fixture.path_faults VALUES($1,5,$2)',[notApplicable.g,'fallthrough']);
  await finish(notApplicable);assert.equal((await db.query('SELECT count(*)::int AS n FROM iig_legacy_fixture.path_effects WHERE group_id=$1',[notApplicable.g])).rows[0].n,2);count++;
  await assert.rejects(()=>as(()=>db.exec('SELECT * FROM iig_legacy_fixture.path_effects')),/permission denied/);count++;
  // The client must not report success or replay a finish after a caught legacy
  // error has made an outer postcondition reject the transaction.
  const clientFailure=await seed('client-handler-failure',{game:'points'});
  await db.query('INSERT INTO iig_legacy_fixture.path_faults VALUES($1,3,$2)',[clientFailure.g,'fallthrough']);
  let sent=0;const client=createTransitionClient(async(op,p)=>{
   sent++;assert.equal(op,'finish');return finish({...clientFailure,id:p.requestId});
  });
  client.load({groupId:clientFailure.g,roundId:clientFailure.before.roundId,revision:0});client.authorise(clientFailure.g,clientFailure.cap);
  const beforeClient=await inventory();
  await assert.rejects(()=>client.request('finish',clientFailure.after),/RELOAD_REQUIRED/);
  assert.deepEqual(await inventory(),beforeClient);count++;
  const receipt=(await as(()=>db.query('SELECT iig_legacy_fixture.finish_receipt($1,$2,$3) AS value',
    [clientFailure.g,clientFailure.cap,client.pendingFinishReceipt().requestId]))).rows[0].value;
  assert.equal(receipt.status,'not_found');count++;
  assert.throws(()=>client.acceptFinishReceipt(receipt,{groupId:clientFailure.g,roundId:clientFailure.before.roundId,revision:0}),/RELOAD_REQUIRED/);count++;
  await assert.rejects(()=>client.request('finish',clientFailure.after),/RELOAD_REQUIRED/);assert.equal(sent,1);count++;
  await assert.rejects(()=>as(()=>db.query('SELECT iig_legacy_fixture.finish_once($1,$2,0,$3,$4,$5)',
   [clientFailure.g,clientFailure.before.roundId,clientFailure.cap,randomUUID(),clientFailure.after])),/permission denied/);count++;
  await assert.rejects(()=>as(()=>db.query('SELECT iig_legacy_fixture.finish_with_result($1,$2,0,$3,$4)',
   [clientFailure.g,clientFailure.before.roundId,clientFailure.cap,clientFailure.after])),/permission denied/);count++;
  const wrongGroup=await seed('authority-wrong-group');
  const authorityBefore=await inventory();
  await assert.rejects(()=>as(()=>db.query('SELECT iig_legacy_fixture.finish_five_once($1,$2,0,$3,$4,$5)',
   [wrongGroup.g,wrongGroup.before.roundId,clientFailure.cap,wrongGroup.id,wrongGroup.after])),/ORGANISER_CAPABILITY_REQUIRED/);
  assert.deepEqual(await inventory(),authorityBefore);count++;
  const stored=(await db.query('SELECT token_hash FROM iig_legacy_fixture.organiser_capabilities WHERE group_id=$1',[wrongGroup.g])).rows[0].token_hash;
  assert.equal(stored.length,64);assert.notEqual(stored,wrongGroup.cap);count++;
  await assert.rejects(()=>as(()=>db.exec('UPDATE iig_legacy_fixture.organiser_capabilities SET revoked=false')),/permission denied/);count++;
  console.log(`PASS: ${count} reported-pattern five-path contract checks: source Finish Round/League/Trip snapshots, each handler/failure position, matching-vs-conflicting deduplication and outer transaction rollback. Invented domain mapping; NOT actual LIVE trigger equivalence or concurrency proof.`);
 }finally{await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
