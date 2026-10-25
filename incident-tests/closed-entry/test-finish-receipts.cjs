const {PGlite}=require('@electric-sql/pglite');
const {createTransitionClient}=require('./client-transition-contract.cjs');
const {fixture,originalFinish,originalSetup,leagueMoney}=require('./test-source-finish.cjs');
const fs=require('node:fs'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
(async()=>{
 const db=new PGlite();let count=0;
 const cap='a'.repeat(64),other='b'.repeat(64);
 try{
  for(const file of ['prototype.sql','legacy-adapter.sql','legacy-finish-result.sql','legacy-start-result.sql','finish-receipts.sql'])await db.exec(fs.readFileSync(__dirname+'/'+file,'utf8'));
  await db.exec(`CREATE ROLE receipt_organiser;GRANT USAGE ON SCHEMA iig_legacy_fixture TO receipt_organiser;
   GRANT EXECUTE ON FUNCTION iig_legacy_fixture.finish_once(text,text,bigint,text,uuid,jsonb),
   iig_legacy_fixture.finish_receipt(text,text,uuid) TO receipt_organiser;`);
  async function as(fn){await db.exec('SET SESSION AUTHORIZATION receipt_organiser');try{return await fn();}finally{await db.exec('RESET ROLE;SET SESSION AUTHORIZATION postgres;RESET ROLE');}}
  async function seed(g,options={},credential=cap){
   const before=fixture({game:'money',format:'stableford',...options}),after=await originalFinish({...before,_entry_revision:0});
   await db.query("INSERT INTO iig_entry_prototype.groups(id,phase,state) VALUES($1,'open',$2)",[g,before]);
   await db.query('INSERT INTO iig_legacy_fixture.tens_in_groups(id,group_pin,state) VALUES($1,$1,$2)',[g,before]);
   await db.query("INSERT INTO iig_legacy_fixture.organiser_capabilities VALUES($1,iig_legacy_fixture.token_hash($2),'2099-01-01',false,ARRAY['finish','start'])",[g,credential]);
   return {g,before,after,id:randomUUID()};
  }
  async function finish(x,{token=cap,id=x.id,proposal=x.after}={}){return as(async()=>(await db.query('SELECT iig_legacy_fixture.finish_once($1,$2,0,$3,$4,$5) AS result',[x.g,x.before.roundId,token,id,proposal])).rows[0].result);}
  async function lookup(x,token=cap){return as(async()=>(await db.query('SELECT iig_legacy_fixture.finish_receipt($1,$2,$3) AS result',[x.g,token,x.id])).rows[0].result);}
  async function inventory(){const out={};for(const [schema,tables] of [['iig_entry_prototype',['groups','archives']],['iig_legacy_fixture',['tens_in_groups','result_effects','transition_receipts','history_payment_events','enabled_status']]])for(const table of tables)out[table]=(await db.query(`SELECT to_jsonb(t) AS row FROM ${schema}.${table} t ORDER BY to_jsonb(t)::text`)).rows;return out;}
  async function reject(fn,error){const before=await inventory();await assert.rejects(fn,error);assert.deepEqual(await inventory(),before);count++;}
  for(const [i,options] of [{},{game:'points'}, {format:'net'}, {trip:true}, {trip:true,last:true}, {trip:true,pair:'betterball'}].entries()){
   const x=await seed('receipt-'+i,options);
   assert.deepEqual(await lookup(x),{status:'not_found'});count++;
   const ack=await finish(x);const committed=await inventory();
   assert.equal(ack.replayed,false);assert.equal(ack.revision,1);count++;
   const reordered=Object.fromEntries(Object.entries(x.after).reverse());
   const replay=await finish(x,{proposal:reordered});assert.equal(replay.replayed,true);assert.deepEqual(await inventory(),committed);count++;
   assert.equal((await lookup(x)).response.requestId,x.id);count++;
   const effects=(await db.query('SELECT * FROM iig_legacy_fixture.result_effects WHERE group_id=$1',[x.g])).rows;
   assert.equal(effects.length,1);assert.deepEqual(effects[0].before_snapshot,x.before);
   const expected=structuredClone(x.after);delete expected._entry_revision;
   assert.deepEqual(effects[0].finished_snapshot,expected);
   assert.deepEqual(effects[0].before_snapshot.players.map(p=>p.paymentMarkedAt),x.before.players.map(p=>p.paymentMarkedAt));
   assert.deepEqual(leagueMoney(effects[0].finished_snapshot),leagueMoney(expected));count++;
   const bad=structuredClone(x.after);bad.lastActivityAt='different';
   await reject(()=>finish(x,{proposal:bad}),/REQUEST_ID_REUSED/);
   await reject(()=>finish(x,{id:randomUUID()}),/STALE/);
   await reject(()=>lookup(x,other),/ORGANISER_CAPABILITY_REQUIRED/);
   await db.query('UPDATE iig_legacy_fixture.organiser_capabilities SET revoked=true WHERE group_id=$1',[x.g]);
   await reject(()=>lookup(x),/ORGANISER_CAPABILITY_REQUIRED/);
   await reject(()=>finish(x),/ORGANISER_CAPABILITY_REQUIRED/);
  }
  const foreign=await seed('foreign-scope',{},other);
  await reject(()=>finish(foreign),/ORGANISER_CAPABILITY_REQUIRED/);
  assert.deepEqual(await lookup(foreign,other),{status:'not_found'});count++;
  const expired=await seed('expired-after-commit');await finish(expired);
  await db.query("UPDATE iig_legacy_fixture.organiser_capabilities SET expires_at='2000-01-01' WHERE group_id=$1",[expired.g]);
  await reject(()=>finish(expired),/ORGANISER_CAPABILITY_REQUIRED/);
  await reject(()=>lookup(expired),/ORGANISER_CAPABILITY_REQUIRED/);
  // A swallowed trigger failure must not produce a success receipt or any other
  // persisted changes. Separate groups avoid deleting/resetting test data.
  const failed=await seed('caught-failure');
  await db.query('INSERT INTO iig_legacy_fixture.receipt_faults VALUES($1,true)',[failed.g]);
  await reject(()=>finish(failed),/RESULT_POSTCONDITION_FAILED/);
  assert.deepEqual(await lookup(failed),{status:'not_found'});count++;
  const conflict=await seed('conflicting-result');
  await db.query('INSERT INTO iig_legacy_fixture.result_effects VALUES($1,$2,$3,$4)',[conflict.g,conflict.before.roundId,{different:true},{different:true}]);
  await reject(()=>finish(conflict),/RESULT_POSTCONDITION_FAILED/);
  // A final receipt insert failure must roll back successful result/award writes.
  const receiptFailure=await seed('receipt-failure');
  await db.exec(`CREATE FUNCTION iig_legacy_fixture.fail_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.group_id='receipt-failure' THEN RAISE EXCEPTION 'FICTIONAL_RECEIPT_FAILURE'; END IF;RETURN NEW;END $$;
   CREATE TRIGGER fail_receipt BEFORE INSERT ON iig_legacy_fixture.transition_receipts FOR EACH ROW EXECUTE FUNCTION iig_legacy_fixture.fail_receipt();`);
  await reject(()=>finish(receiptFailure),/FICTIONAL_RECEIPT_FAILURE/);
  await reject(()=>as(()=>db.query('SELECT * FROM iig_legacy_fixture.transition_receipts')),/permission denied/);
  const advanced=await seed('advanced');await finish(advanced);
  const setup=await originalSetup({...advanced.after,_entry_revision:1},'stableford');
  await db.query('SELECT iig_legacy_fixture.start_with_setup($1,$2,1,$3,$4)',[advanced.g,advanced.before.roundId,cap,setup]);
  const afterStart=await inventory();assert.equal((await finish(advanced)).replayed,true);assert.deepEqual(await inventory(),afterStart);count++;
  // Join the client contract to actual local fixture RPCs, then lose the ACK.
  const lost=await seed('lost-client-ack');let writes=0;
  const client=createTransitionClient(async(op,p)=>{
   assert.equal(op,'finish');writes++;
   await finish(lost,{token:p.organiserCredential,id:p.requestId,proposal:p.proposal});
   throw Error('FICTIONAL_ACK_LOSS');
  });
  client.load({groupId:lost.g,roundId:lost.before.roundId,revision:0});client.authorise(lost.g,cap);
  await assert.rejects(()=>client.request('finish',lost.after),/RELOAD_REQUIRED/);count++;
  const pending=client.pendingFinishReceipt();const setupAfterLost=await originalSetup({...lost.after,_entry_revision:1},'stableford');
  await db.query('SELECT iig_legacy_fixture.start_with_setup($1,$2,1,$3,$4)',[lost.g,lost.before.roundId,cap,setupAfterLost]);
  const metadata=(await db.query('SELECT revision,state FROM iig_entry_prototype.groups WHERE id=$1',[lost.g])).rows[0];
  const beforeRecovery=await inventory();
  const recovered=client.acceptFinishReceipt(await lookup({...lost,id:pending.requestId}),
   {groupId:lost.g,roundId:metadata.state.roundId,revision:Number(metadata.revision)});
  assert.equal(recovered.revision,2);assert.equal(recovered.roundId,metadata.state.roundId);
  assert.equal(writes,1);assert.deepEqual(await inventory(),beforeRecovery);count++;
  console.log(`PASS: ${count} fictional finish-receipt checks: actual-source Money/Points/Net/Trip results, single application, exact retry, payload binding, current capability checks, caught-write/conflict postconditions and complete failure rollback. NOT faithful LIVE trigger or multi-session concurrency proof.`);
 }finally{await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
