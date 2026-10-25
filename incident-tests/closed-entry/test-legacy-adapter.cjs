// Synthetic legacy schema/trigger contract, NOT a reproduction of captured LIVE helpers.
const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs'),assert=require('node:assert/strict');
const clone=x=>structuredClone(x);
const fixture=()=>({roundId:'round-old',roundOpen:true,course:'Fictional Course',date:'2026-10-24',stake:10,gameType:'money',pointsCompetition:'stableford',history:[{id:'completed-old-result',payouts:[{amount:20}],players:[{id:'old-player',netScore:70}]}],trip:{},players:['a','b','c','d'].map((id,i)=>({id,name:'Fictional '+id,handicap:10,paid:i<3,playingThisRound:false,stableford:null,netScore:null,noReturn:false,scoreSubmitted:false,paymentMarkedAt:i<3?'fictional-paid-record':null}))});
const CAP='a'.repeat(64),OTHER='b'.repeat(64),EXPIRED='c'.repeat(64),REVOKED='d'.repeat(64),FINISH_ONLY='e'.repeat(64);
(async()=>{
 const db=new PGlite();let count=0;
 try{
  await db.exec(fs.readFileSync(__dirname+'/prototype.sql','utf8'));
  await db.exec(fs.readFileSync(__dirname+'/legacy-adapter.sql','utf8'));
  await db.exec(`CREATE ROLE legacy_player; CREATE ROLE legacy_admin; CREATE ROLE legacy_service;
   GRANT USAGE ON SCHEMA iig_legacy_fixture TO legacy_player,legacy_admin,legacy_service;
   GRANT EXECUTE ON FUNCTION iig_legacy_fixture.get_group_state(text),iig_legacy_fixture.save_group_state(text,jsonb),
    iig_legacy_fixture.finish_round(text,text,bigint,text),iig_legacy_fixture.start_round(text,text,bigint,text,text,text,numeric,text)
    TO legacy_player,legacy_admin;
   GRANT SELECT,UPDATE ON iig_legacy_fixture.tens_in_groups TO legacy_service;`);
  async function as(role,fn){await db.exec('SET SESSION AUTHORIZATION '+role);try{return await fn();}finally{await db.exec('RESET ROLE; SET SESSION AUTHORIZATION postgres; RESET ROLE');}}
  async function get(pin='fictional-1010'){return as('legacy_player',async()=>(await db.query('SELECT iig_legacy_fixture.get_group_state($1) AS state',[pin])).rows[0].state);}
  async function save(state,role='legacy_player',pin='fictional-1010'){return as(role,()=>db.query('SELECT iig_legacy_fixture.save_group_state($1,$2)',[pin,state]));}
  async function reject(fn,pattern){
   const before=(await db.query('SELECT id,revision,closed,phase,state FROM iig_entry_prototype.groups ORDER BY id')).rows;
   const projection=(await db.query('SELECT id,state FROM iig_legacy_fixture.tens_in_groups ORDER BY id')).rows;
   const ledgers=(await db.query('SELECT * FROM iig_legacy_fixture.history_payment_events ORDER BY group_id,round_id,phase,pot')).rows;
   const archives=(await db.query('SELECT * FROM iig_entry_prototype.archives ORDER BY group_id,round_id')).rows;
   const statuses=(await db.query('SELECT * FROM iig_legacy_fixture.enabled_status ORDER BY group_id')).rows;
   await assert.rejects(fn,pattern);
   assert.deepEqual((await db.query('SELECT * FROM iig_entry_prototype.archives ORDER BY group_id,round_id')).rows,archives);
   assert.deepEqual((await db.query('SELECT * FROM iig_legacy_fixture.enabled_status ORDER BY group_id')).rows,statuses);
   assert.deepEqual((await db.query('SELECT id,revision,closed,phase,state FROM iig_entry_prototype.groups ORDER BY id')).rows,before);
   assert.deepEqual((await db.query('SELECT * FROM iig_legacy_fixture.history_payment_events ORDER BY group_id,round_id,phase,pot')).rows,ledgers);
   assert.deepEqual((await db.query('SELECT id,state FROM iig_legacy_fixture.tens_in_groups ORDER BY id')).rows,projection);count++;
  }
  for(const [g,pin] of [['g1','fictional-1010'],['g2','fictional-1260']]){
   await db.query('INSERT INTO iig_entry_prototype.groups(id,phase,state) VALUES($1,$2,$3)',[g,'open',fixture()]);
   await db.query('INSERT INTO iig_legacy_fixture.tens_in_groups(id,group_pin,state) VALUES($1,$2,$3)',[g,pin,fixture()]);
   await db.query("INSERT INTO iig_entry_prototype.principals VALUES('legacy_player',$1,'a',false),('legacy_admin',$1,'a',true)",[g]);
  }
  for(const [g,token,time,revoked,perms] of [['g1',CAP,'2099-01-01',false,['finish','start']],['g2',OTHER,'2099-01-01',false,['finish','start']],['g1',EXPIRED,'2000-01-01',false,['finish','start']],['g1',REVOKED,'2099-01-01',true,['finish','start']],['g1',FINISH_ONLY,'2099-01-01',false,['finish']]])
   await db.query('INSERT INTO iig_legacy_fixture.organiser_capabilities VALUES($1,iig_legacy_fixture.token_hash($2),$3,$4,$5)',[g,token,time,revoked,perms]);
  let state=await get();assert.equal(state._entry_revision,0);assert.equal(JSON.stringify(state).includes(CAP),false);count++;
  let old=clone(state);delete old._entry_revision;
  await reject(()=>save(old),/RELOAD_VERSIONED_STATE/);
  state.players[0].stableford=32;state.players[0].scoreSubmitted=true;await save(state);count++;
  let latest=await get();assert.equal(latest._entry_revision,1);assert.equal(latest.players.filter(p=>p.paid).length*latest.stake,30);count++;
  let late=clone(latest);late.players[3].paid=true;
  await reject(()=>save(late,'legacy_admin'),/ENTRIES_CLOSED/);
  await reject(()=>save(late),/ENTRIES_CLOSED/);
  await reject(()=>save(state),/STALE/);
  let fake=clone(latest);fake.roundOpen=false;fake.history.unshift({id:'forged-finish'});
  await reject(()=>save(fake,'legacy_admin'),/PROTECTED/);
  await reject(()=>as('legacy_service',()=>db.query("UPDATE iig_legacy_fixture.tens_in_groups SET state=jsonb_set(state,'{players,3,paid}','true') WHERE id='g1'")),/USE_GUARDED_SAVE/);
  await reject(()=>as('legacy_admin',()=>db.exec('UPDATE iig_legacy_fixture.organiser_capabilities SET revoked=false')),/permission denied/);
  async function finish(cap=CAP,rev=1){return as('legacy_player',()=>db.query('SELECT iig_legacy_fixture.finish_round($1,$2,$3,$4)',['fictional-1010','round-old',rev,cap]));}
  for(const cap of [null,'platform-owner-code-is-not-group-authority',OTHER,EXPIRED,REVOKED])
   await reject(()=>finish(cap),/ORGANISER_CAPABILITY_REQUIRED/);
  // A caller-set custom GUC or client isAdmin marker cannot replace the capability.
  await reject(()=>as('legacy_admin',async()=>{
   await db.exec("SET iig.is_admin='true'");
   return db.query('SELECT iig_legacy_fixture.finish_round($1,$2,$3,$4)',['fictional-1010','round-old',1,null]);
  }),/ORGANISER_CAPABILITY_REQUIRED/);
  await reject(()=>finish(CAP,null),/STALE/);
  const preFinish=clone(latest);delete preFinish._entry_revision;
  await finish();count++;
  const snap=(await db.query("SELECT snapshot FROM iig_entry_prototype.archives WHERE group_id='g1'")).rows[0].snapshot;
  assert.deepEqual(snap,preFinish);assert.deepEqual((await get()).history,fixture().history);count++;
  const event=(await db.query("SELECT pot FROM iig_legacy_fixture.history_payment_events WHERE group_id='g1' AND phase='finished'")).rows;
  assert.equal(event.length,1);assert.equal(Number(event[0].pot),30);count++;
  const enabled=(await db.query("SELECT enabled FROM iig_legacy_fixture.enabled_status WHERE group_id='g1'")).rows[0].enabled;assert.equal(enabled,false);count++;
  await reject(()=>finish(),/STALE/);
  await reject(()=>save(late,'legacy_admin'),/STALE/);
  async function start(cap=CAP){return as('legacy_player',()=>db.query('SELECT iig_legacy_fixture.start_round($1,$2,$3,$4,$5,$6,$7,$8)',[
   'fictional-1010','round-old',2,cap,'Next Fictional Course','2026-10-25',10,'net']));}
  await reject(()=>start(FINISH_ONLY),/ORGANISER_CAPABILITY_REQUIRED/);
  await reject(()=>start(OTHER),/ORGANISER_CAPABILITY_REQUIRED/);
  await reject(()=>as('legacy_player',()=>db.query('SELECT iig_legacy_fixture.start_round($1,$2,$3,$4,$5,$6,$7,$8)',['fictional-1010','round-old',2,CAP,'Next Fictional Course','2026-10-25','NaN','net'])),/INVALID_SETUP/);
  await start();count++;
  const fresh=await get();assert.notEqual(fresh.roundId,'round-old');assert.equal(fresh.players.filter(p=>p.paid).length,0);assert.deepEqual(fresh.history,fixture().history);count++;
  await reject(()=>save(late,'legacy_admin'),/STALE/);
  assert.deepEqual((await db.query("SELECT snapshot FROM iig_entry_prototype.archives WHERE group_id='g1'")).rows[0].snapshot,snap);count++;
  assert.deepEqual((await get('fictional-1260')).history,fixture().history);assert.equal((await get('fictional-1260'))._entry_revision,0);count++;
  const stored=(await db.query('SELECT token_hash FROM iig_legacy_fixture.organiser_capabilities')).rows;
  assert.equal(stored.some(r=>r.token_hash===CAP),false);count++;
  // A downstream trigger failure must roll back guard metadata, projection and prior trigger events together.
  await db.exec(`CREATE FUNCTION iig_legacy_fixture.injected_failure() RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN IF NEW.id='g2' THEN RAISE EXCEPTION 'FIXTURE_DOWNSTREAM_FAILURE'; END IF; RETURN NEW; END $$;
   CREATE TRIGGER zz_fixture_failure AFTER UPDATE ON iig_legacy_fixture.tens_in_groups
   FOR EACH ROW EXECUTE FUNCTION iig_legacy_fixture.injected_failure();`);
  const other=await get('fictional-1260');other.players[0].stableford=32;other.players[0].scoreSubmitted=true;
  await reject(()=>save(other,'legacy_player','fictional-1260'),/FIXTURE_DOWNSTREAM_FAILURE/);
  // Same late AFTER-trigger failure during protected finish/setup must also
  // unwind archives, revision, closure, ledger and enabled-status writes.
  await db.exec(`CREATE OR REPLACE FUNCTION iig_legacy_fixture.injected_failure() RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN IF NEW.id='g2' AND NEW.state->'roundOpen'='false'::jsonb THEN RAISE EXCEPTION 'FIXTURE_FINISH_FAILURE'; END IF; RETURN NEW; END $$;`);
  await save(other,'legacy_player','fictional-1260');count++;
  const finishOther=()=>as('legacy_player',()=>db.query('SELECT iig_legacy_fixture.finish_round($1,$2,$3,$4)',
    ['fictional-1260','round-old',1,OTHER]));
  await reject(finishOther,/FIXTURE_FINISH_FAILURE/);
  await db.exec(`CREATE OR REPLACE FUNCTION iig_legacy_fixture.injected_failure() RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN IF NEW.id='g2' AND NEW.state->'roundOpen'='true'::jsonb THEN RAISE EXCEPTION 'FIXTURE_START_FAILURE'; END IF; RETURN NEW; END $$;`);
  await finishOther();count++;
  await reject(()=>as('legacy_player',()=>db.query('SELECT iig_legacy_fixture.start_round($1,$2,$3,$4,$5,$6,$7,$8)',
   ['fictional-1260','round-old',2,OTHER,'Next Fictional Course','2026-10-25',10,'net'])),/FIXTURE_START_FAILURE/);
  console.log(`PASS: ${count} fictional legacy-adapter checks; versioned whole-state RPC, central projection guard, group-scoped capabilities, synthetic trigger atomicity. NOT actual LIVE trigger integration.`);
 }finally{await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
