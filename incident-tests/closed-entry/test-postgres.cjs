// Embedded local PostgreSQL only; no TCP or hosted database URL.
const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs'),assert=require('node:assert/strict');
const prototype=fs.readFileSync(__dirname+'/prototype.sql','utf8');
const clone=x=>structuredClone(x);
const base=(scored=false)=>({roundId:'round-old',roundOpen:true,course:'Fictional Course',date:'2026-10-24',stake:10,gameType:'money',pointsCompetition:'stableford',history:[{id:'preserved-history',pot:20}],trip:{},players:['a','b','c','d'].map((id,i)=>({id,name:'Fictional '+id,handicap:10,paid:i<3,playingThisRound:false,stableford:i===0&&scored?32:null,netScore:null,noReturn:false,scoreSubmitted:i===0&&scored,paymentMarkedAt:i<3?'fictional-payment-record':null}))});
(async()=>{
 const db=new PGlite();let count=0;
 try{
  await db.exec(prototype);
  await db.exec(`CREATE ROLE fixture_admin; CREATE ROLE fixture_a; CREATE ROLE fixture_b; CREATE ROLE fixture_d;
  GRANT USAGE ON SCHEMA iig_entry_prototype TO fixture_admin,fixture_a,fixture_b,fixture_d;
  GRANT EXECUTE ON FUNCTION iig_entry_prototype.save(text,text,bigint,jsonb),iig_entry_prototype.finish(text,text,bigint),iig_entry_prototype.correct_score(text,text,bigint,text,integer),iig_entry_prototype.start(text,text,bigint,text,text,numeric,text)
    TO fixture_admin,fixture_a,fixture_b,fixture_d;`);
  async function seed(id='1010',scored=false){
   await db.query('INSERT INTO iig_entry_prototype.groups(id,phase,state) VALUES($1,$2,$3)',[id,'open',base(scored)]);
   for(const [role,player,admin] of [['fixture_admin','a',true],['fixture_a','a',false],['fixture_b','b',false],['fixture_d','d',false]])
    await db.query('INSERT INTO iig_entry_prototype.principals VALUES($1,$2,$3,$4)',[role,id,player,admin]);
  }
  async function as(role,fn){await db.exec('SET SESSION AUTHORIZATION '+role);try{return await fn();}finally{await db.exec('RESET ROLE; SET SESSION AUTHORIZATION postgres; RESET ROLE');}}
  async function row(id='1010'){return (await db.query('SELECT * FROM iig_entry_prototype.groups WHERE id=$1',[id])).rows[0];}
  async function save(state,rev=0,role='fixture_admin',id='1010',rid='round-old'){
   return as(role,()=>db.query('SELECT iig_entry_prototype.save($1,$2,$3,$4)',[id,rid,rev,state]));
  }
  async function reject(fn,pattern){await assert.rejects(fn,pattern);count++;}
  await seed();
  let s=base();s.players[0].stableford=32;s.players[0].scoreSubmitted=true;
  await save(s,0,'fixture_a');assert.equal((await row()).closed,true);count++;
  let late=clone(s);late.players[3].paid=true;
  await reject(()=>save(late,1,'fixture_d'),/ENTRIES_CLOSED/);
  await reject(()=>save(late,1,'fixture_admin'),/ENTRIES_CLOSED/);
  await reject(()=>save(late,0),/STALE/);
  assert.equal((await row()).state.players.filter(x=>x.paid).length*10,30);count++;
  let next=clone(s);next.players[1].stableford=35;next.players[1].scoreSubmitted=true;
  await save(next,1,'fixture_b');assert.equal((await row()).state.players[1].stableford,35);count++;
  await reject(()=>save(base(),2),/CORRECTION|CLOSED/);
  let forged=clone(next);forged.roundId='forged';await reject(()=>save(forged,2),/PROTECTED/);
  forged=clone(next);forged.history.push({fake:true});await reject(()=>save(forged,2),/PROTECTED/);
  forged=clone(next);forged.stake=20;await reject(()=>save(forged,2),/PROTECTED/);
  await reject(()=>as('fixture_d',()=>db.query('SELECT iig_entry_prototype.finish($1,$2,$3)',['1010','round-old',2])),/ORGANISER/);
  await reject(()=>as('fixture_d',()=>db.exec("UPDATE iig_entry_prototype.groups SET closed=false")),/permission denied/);
  await reject(()=>as('fixture_d',()=>db.exec("UPDATE iig_entry_prototype.principals SET organiser=true")),/permission denied/);
  const beforeFinish=clone((await row()).state);
  await as('fixture_admin',()=>db.query('SELECT iig_entry_prototype.finish($1,$2,$3)',['1010','round-old',2]));
  const archive=(await db.query('SELECT snapshot FROM iig_entry_prototype.archives WHERE group_id=$1',['1010'])).rows[0].snapshot;
  assert.deepEqual(archive,beforeFinish);assert.equal((await row()).phase,'finished');count++;
  await reject(()=>save(late,3),/STALE/);
  await reject(()=>as('fixture_admin',()=>db.query('SELECT iig_entry_prototype.finish($1,$2,$3)',['1010','round-old',3])),/STALE/);
  await as('fixture_admin',()=>db.query('SELECT iig_entry_prototype.start($1,$2,$3,$4,$5,$6,$7)',['1010','round-old',3,'Next fictional course','2026-10-25',10,'net']));
  const fresh=await row();assert.notEqual(fresh.state.roundId,'round-old');assert.equal(fresh.closed,false);assert.equal(fresh.state.players.filter(x=>x.paid).length,0);
  assert.deepEqual(fresh.state.history,base().history);count++;
  await reject(()=>save(late,4,'fixture_d'),/STALE/);
  assert.deepEqual((await db.query('SELECT snapshot FROM iig_entry_prototype.archives WHERE group_id=$1',['1010'])).rows[0].snapshot,archive);count++;
  await seed('1260');assert.equal((await row('1260')).closed,false);assert.deepEqual((await row('1260')).state,base());count++;
  await reject(()=>as('fixture_admin',()=>db.query('SELECT iig_entry_prototype.finish($1,$2,$3)',['unknown','round-old',0])),/NOT_AUTHORISED/);
  // Legacy round already scored before the latch exists: closure is derived under lock.
  await seed('already-scored',true);late=base(true);late.players[3].paid=true;
  await reject(()=>save(late,0,'fixture_admin','already-scored'),/ENTRIES_CLOSED/);
  await seed('bundle');let bundled=base();bundled.players[0].stableford=0;bundled.players[3].paid=true;
  await reject(()=>save(bundled,0,'fixture_admin','bundle'),/ENTRIES_CLOSED/);
  // Deterministic race order 1: score commits first, stale entry loses.
  await seed('race-score');let scored=base();scored.players[0].stableford=0;
  await save(scored,0,'fixture_a','race-score');let entry=base();entry.players[3].paid=true;
  await reject(()=>save(entry,0,'fixture_d','race-score'),/STALE/);
  // Order 2: legitimate entry commits before first score; old score snapshot loses.
  await seed('race-entry');await save(entry,0,'fixture_d','race-entry');
  await reject(()=>save(scored,0,'fixture_a','race-entry'),/STALE/);
  let updated=clone((await row('race-entry')).state);updated.players[0].stableford=32;
  await save(updated,1,'fixture_a','race-entry');assert.equal((await row('race-entry')).state.players.filter(x=>x.paid).length,4);count++;
  // Net, NR and pair score closure, including zero and wrong-player denial.
  for(const kind of ['net','nr','pair']){
   await seed(kind);let f=base();
   if(kind==='net'||kind==='nr'){
    await db.query("UPDATE iig_entry_prototype.groups SET state=jsonb_set(state,'{pointsCompetition}','\"net\"') WHERE id=$1",[kind]);f.pointsCompetition='net';
    if(kind==='net')f.players[0].netScore=70;else f.players[0].noReturn=true;
   }else{
    f.trip={currentTeams:[{id:'pair-ab',playerIds:['a','b']}],currentTeamScores:{}};
    await db.query('UPDATE iig_entry_prototype.groups SET state=$1 WHERE id=$2',[f,kind]);f=clone(f);f.trip.currentTeamScores['pair-ab']=0;
   }
   await save(f,0,'fixture_admin',kind);assert.equal((await row(kind)).closed,true);count++;
  }
  await seed('wrong-player');let wrong=base();wrong.players[1].stableford=35;
  await reject(()=>save(wrong,0,'fixture_a','wrong-player'),/NOT_AUTHORISED/);
  // Protected correction can clear a score without clearing the closure latch.
  await seed('correction',true);
  await as('fixture_admin',()=>db.query('SELECT iig_entry_prototype.correct_score($1,$2,$3,$4,$5)',['correction','round-old',0,'a',null]));
  assert.equal((await row('correction')).closed,true);count++;
  let correctionLate=clone((await row('correction')).state);correctionLate.players[3].paid=true;
  await reject(()=>save(correctionLate,1,'fixture_admin','correction'),/ENTRIES_CLOSED/);
  await reject(()=>as('fixture_d',()=>db.query('SELECT iig_entry_prototype.correct_score($1,$2,$3,$4,$5)',['correction','round-old',1,'a',35])),/ORGANISER/);
  // Unpaid membership additions do not enter a scored competition or affect its pot.
  await seed('member',true);let member=base(true);member.players.push({...base().players[3],id:'new-member'});
  await save(member,0,'fixture_admin','member');assert.equal((await row('member')).state.players.filter(x=>x.paid).length,3);count++;
  // Payment metadata and Trip eligibility cannot be edited after closure.
  await seed('metadata',true);let meta=base(true);meta.players[0].paymentMarkedAt='changed';
  await reject(()=>save(meta,0,'fixture_admin','metadata'),/ENTRIES_CLOSED/);
  meta=base(true);meta.trip={active:true,playerIds:['a','b','c','d']};
  await reject(()=>save(meta,0,'fixture_admin','metadata'),/PROTECTED/);
  // Invalid score input leaves the state/revision untouched.
  await seed('bad-score');let bad=base();bad.players[0].stableford=112;
  await reject(()=>save(bad,0,'fixture_a','bad-score'),/INVALID_SCORE/);
  assert.equal((await row('bad-score')).revision,0);count++;
  // Free Points competition: attendance, not payment, determines existing eligibility.
  await seed('points');let points=base();points.gameType='points';points.stake=0;
  points.players.forEach((p,i)=>{p.paid=false;p.playingThisRound=i<3;});
  await db.query('UPDATE iig_entry_prototype.groups SET state=$1 WHERE id=$2',[points,'points']);
  points=clone(points);points.players[0].stableford=32;await save(points,0,'fixture_a','points');
  let latePoints=clone(points);latePoints.players[3].playingThisRound=true;
  await reject(()=>save(latePoints,1,'fixture_admin','points'),/ENTRIES_CLOSED/);
  console.log(`PASS: ${count} embedded PostgreSQL checks. Prototype only; no online connections. Race orderings simulated; multi-session locking NOT proved.`);
 }finally{await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
