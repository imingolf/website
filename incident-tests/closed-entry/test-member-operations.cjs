// Fictional canonical schema only. No online configuration, SDK or network.
const fs=require('node:fs'),assert=require('node:assert/strict'),vm=require('node:vm');
const {PGlite}=require('@electric-sql/pglite'),{randomBytes,randomUUID}=require('node:crypto');
const {fixture,extract,originalFinish}=require('./test-source-finish.cjs'),guard=require('../../app/entry-guard-client.js');
(async()=>{const db=new PGlite();let checks=0;
 try{
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
   CREATE TABLE public.tens_in_groups(id text PRIMARY KEY,fixture_pin text UNIQUE NOT NULL,enabled boolean DEFAULT true,state jsonb,updated_at timestamptz DEFAULT now());
   ALTER TABLE public.tens_in_groups ENABLE ROW LEVEL SECURITY;
   CREATE TABLE public.fixture_effects(g text PRIMARY KEY,n integer);CREATE TABLE public.fixture_faults(g text PRIMARY KEY);
   CREATE FUNCTION public.fixture_hook() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
    IF EXISTS(SELECT 1 FROM public.fixture_faults WHERE g=NEW.id) THEN RAISE EXCEPTION 'FICTIONAL_AFTER_FAILURE';END IF;
    INSERT INTO public.fixture_effects VALUES(NEW.id,1) ON CONFLICT(g) DO UPDATE SET n=fixture_effects.n+1;RETURN NEW;END$$;
   CREATE TRIGGER unchanged_after AFTER UPDATE ON public.tens_in_groups FOR EACH ROW EXECUTE FUNCTION public.fixture_hook();`);
  for(const f of ['core.sql','validators.sql','boundary.sql'])await db.exec(fs.readFileSync(__dirname+'/../../supabase/closed-entry-candidate/'+f,'utf8'));
  await db.exec(`CREATE OR REPLACE FUNCTION iig_closed_entry.resolve_pin(p_pin text) RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT id FROM public.tens_in_groups WHERE fixture_pin=p_pin AND enabled$$;`);
  async function rpc(name,a){
   const calls={iig_entry_read:['SELECT public.iig_entry_read($1) d',[a.p_pin]],iig_entry_write:['SELECT public.iig_entry_write($1,$2,$3,$4,$5,$6,$7,$8) d',[a.p_pin,a.p_group,a.p_round,a.p_revision,a.p_operation,a.p_state,a.p_credential,a.p_request]],
    iig_entry_check_credential:['SELECT public.iig_entry_check_credential($1,$2,$3) d',[a.p_pin,a.p_group,a.p_credential]],
    iig_entry_check_member:['SELECT public.iig_entry_check_member($1,$2,$3,$4) d',[a.p_pin,a.p_group,a.p_credential,a.p_scope]],
    iig_entry_receipt:['SELECT public.iig_entry_receipt($1,$2,$3,$4) d',[a.p_pin,a.p_group,a.p_request,a.p_credential]]};
   await db.exec('SET SESSION AUTHORIZATION anon');try{const [q,p]=calls[name];return {data:(await db.query(q,p)).rows[0].d,error:null};}catch(e){return {data:null,error:{message:e.message}};}finally{await db.exec('SET SESSION AUTHORIZATION postgres');}
  }
  async function seed(g,pin=g,patch={}){
   const state={...fixture({game:'money',format:'stableford'}),...patch};const admin=randomBytes(32).toString('hex'),tokens={};
   await db.query('INSERT INTO public.tens_in_groups(id,fixture_pin,state) VALUES($1,$2,$3)',[g,pin,state]);
   await db.query("SELECT iig_closed_entry.provision($1,$2,clock_timestamp()+interval '1 day',ARRAY['start','finish','members','settle'])",[g,admin]);
   for(const id of ['a','b','d']){tokens[id]=randomBytes(32).toString('hex');await db.query("SELECT iig_closed_entry.provision_member($1,$2,$3,clock_timestamp()+interval '1 day',ARRAY['profile','sidegame','claim'])",[g,id,tokens[id]]);}
   return {g,pin,state,admin,tokens};
  }
  async function read(x){const r=await rpc('iig_entry_read',{p_pin:x.pin});assert.equal(r.error,null);return r.data;}
  async function write(x,c,op,s,token=x.admin,id=randomUUID()){return rpc('iig_entry_write',{p_pin:x.pin,p_group:x.g,p_round:c.context.roundId,p_revision:c.context.revision,p_operation:op,p_state:s,p_credential:token,p_request:id});}
  async function inventory(){const r=await db.query("SELECT schemaname,tablename FROM pg_tables WHERE schemaname='iig_closed_entry' OR (schemaname='public' AND tablename IN ('tens_in_groups','fixture_effects')) ORDER BY 1,2");const out={};for(const t of r.rows){const name=t.schemaname+'.'+t.tablename;out[name]=(await db.query(`SELECT to_jsonb(t) r FROM ${name} t ORDER BY to_jsonb(t)::text`)).rows;}return out;}
  async function reject(fn,pattern){const b=await inventory(),r=await fn();assert.match(r.error?.message||'',pattern);assert.deepEqual(await inventory(),b);checks++;}
  function app(x,token){return guard.create({rpc},{uuid:randomUUID,promptCredential:async()=>token});}
  async function run(name,x,token,args=[],extras={}){
   const failures=[];const bridge=guard.create({rpc:async(n,a)=>{const r=await rpc(n,a);if(n==='iig_entry_write'&&r.error)failures.push(r.error.message);return r;}},{uuid:randomUUID,promptCredential:async()=>token}),loaded=(await bridge.db.rpc('get_group_state',{p_pin:x.pin})).data;
   const memory=new Map([['iig_sidegame_format_a','stableford']]);
   const c={state:loaded,pin:x.pin,db:bridge.db,iigEntryBridge:bridge,isAdmin:true,myPlayerId:'a',saveActive:false,savePending:0,saveQueue:Promise.resolve(),stateSaveVersion:0,
    Date,JSON,Object,Array,String,Number,Boolean,Math,Promise,URL,demoCanEdit:()=>true,demoReadOnly:()=>false,$:()=>({value:'37',textContent:''}),render(){},show(){},showRoundHistory(){},sideGameHome(){},alert(){},confirm:()=>true,
    localStorage:{getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v)},window:{scrollTo(){}},moneyText:String,appPrompt:async()=> '12.3',...extras};
   vm.createContext(c);for(const f of ['save','ensureSideGameState','validGolfHandicap','validIndividualScore','sideGameResolveBetsForToday'])vm.runInContext(extract(f),c);
   vm.runInContext(extract(name),c);await c[name](...args);assert.deepEqual(failures,[],name);return {state:await read(x),ctx:c,bridge};
  }
  const x=await seed('canonical-a','0007'),y=await seed('canonical-b','0099');
  const ra=await read(x),rb=await read(y);assert.equal(ra.context.groupId,x.g);assert.equal(rb.context.groupId,y.g);assert.deepEqual(ra.state,rb.state);checks++;
  await reject(()=>rpc('iig_entry_read',{p_pin:'7'}),/GROUP_NOT_FOUND/);
  await reject(()=>rpc('iig_entry_read',{p_pin:' 0007'}),/GROUP_NOT_FOUND/);
  await db.query('UPDATE public.tens_in_groups SET enabled=false WHERE id=$1',[y.g]);
  await reject(()=>rpc('iig_entry_read',{p_pin:y.pin}),/GROUP_NOT_FOUND/);
  await reject(()=>write(x,ra,'members',{...ra.state,groupName:'changed'},y.admin),/CREDENTIAL/);
  await reject(()=>write(x,ra,'members',ra.state,x.tokens.a),/CREDENTIAL/);
  const inactive=await seed('profile-unentered');const r=await run('changeMyHandicap',inactive,inactive.tokens.d,[3],{isAdmin:false,myPlayerId:'d'});
  assert.equal(r.state.state.players[3].handicap,12.3);assert.deepEqual(r.state.state.history,inactive.state.history);checks++;
  const before=await read(inactive),other=structuredClone(before.state);other.players[0].handicap=12;
  await reject(()=>write(inactive,before,'profile',other,inactive.tokens.d),/WRONG_PLAYER/);
  const own=structuredClone(before.state);own.players[0].handicap=12;
  await reject(()=>write(inactive,before,'profile',own,inactive.tokens.a),/ENTERED_PROFILE_FROZEN/);
  const forged=structuredClone(before.state);forged.players[3].paid=true;
  await reject(()=>write(inactive,before,'profile',forged,inactive.tokens.d),/COMPETITION_FIELDS/);
  const invalid=structuredClone(before.state);invalid.players[3].handicap=112;
  await reject(()=>write(inactive,before,'profile',invalid,inactive.tokens.d),/INVALID_PROFILE/);
  const removed=structuredClone(before.state);removed.players.splice(0,1);
  await reject(()=>write(inactive,before,'members',removed),/PROTECTED_PLAYER_REMOVAL/);
  // Real organiser add/remove source paths preserve entered players and history.
  const additions=await seed('membership');const answers=['Fictional','Newcomer','11.2'];
  const added=await run('adminAddPlayer',additions,additions.admin,[],{prompt:()=>answers.shift(),iigFreePlan:()=>false});
  assert.equal(added.state.state.players.length,5);assert.equal(added.state.state.players[4].paid,false);checks++;
  const rm=await run('removePlayer',additions,additions.admin,[4],{appConfirm:async()=>true});assert.equal(rm.state.state.players.length,4);assert.deepEqual(rm.state.state.history,additions.state.history);checks++;
  // Legacy saved records without application roundId/playing flag still use the
  // private round/revision. They cannot change identity or admit a late entrant.
  const legacy=structuredClone(x.state);delete legacy.roundId;for(const p of legacy.players)delete p.playingThisRound;
  legacy.players[0].stableford=null;legacy.players[0].scoreSubmitted=false;
  const lg=await seed('legacy-shape','0123',legacy),lr=await read(lg),ls=structuredClone(lr.state);ls.players[0].stableford=31;ls.players[0].scoreSubmitted=true;
  assert.equal((await write(lg,lr,'save',ls,null)).error,null);checks++;
  // Prepare explicit immutable result identity, not name-only guessing.
  const payout={id:'p1',winnerPlayerId:'a',winnerName:'Fictional A',amount:30,status:'awaiting_details',paymentLink:'',paymentProvider:''};
  const history=[{id:'result',course:'Fictional',payouts:[payout]}],pay=await seed('payout','pay',{history,roundOpen:false});
  const claimed=await run('claimWinnerPrize',pay,pay.tokens.a,[0,'p1'],{currentPlayerMatchesPayout:()=>true,chooseWinnerPayoutMethod:async()=> 'bank_transfer'});
  assert.equal(claimed.state.state.history[0].payouts[0].status,'bank_details_needed');assert.equal(claimed.state.context.phase,'finished');checks++;
  const pb=await read(pay),spoof=structuredClone(pb.state);spoof.history[0].payouts[0].paymentLink='https://paypal.me/Fictional';spoof.history[0].payouts[0].paymentProvider='PayPal';spoof.history[0].payouts[0].status='ready';spoof.history[0].payouts[0].claimedAt='fictional';
  await reject(()=>write(pay,pb,'claim',spoof,pay.tokens.b),/IDENTITY_REQUIRED/);
  const badMoney=structuredClone(spoof);badMoney.history[0].payouts[0].amount=999;
  await reject(()=>write(pay,pb,'claim',badMoney,pay.tokens.a),/IMMUTABLE_PAYOUT/);
  for(const link of ['https://paypal.evil.invalid/pay','https://paypal.me@evil.invalid/pay','javascript:alert(1)','https://paypal.me.evil.invalid/pay']){
   const bad=structuredClone(spoof);bad.history[0].payouts[0].paymentLink=link;
   await reject(()=>write(pay,pb,'claim',bad,pay.tokens.a),/INVALID_PAYMENT_LINK/);
  }
  assert.equal((await write(pay,pb,'claim',spoof,pay.tokens.a)).error,null);checks++;
  const paid=await run('markWinnerPaid',pay,pay.admin,[0,'p1']);assert.equal(paid.state.state.history[0].payouts[0].status,'paid');checks++;
  const paidBefore=await read(pay),unpay=structuredClone(paidBefore.state);unpay.history[0].payouts[0].status='ready';
  await reject(()=>write(pay,paidBefore,'claim',unpay,pay.tokens.a),/IMMUTABLE_PAYOUT/);
  await reject(()=>write(pay,paidBefore,'settle',unpay,pay.tokens.a),/CREDENTIAL/);
  // Actual challenge/response/scoring/settlement source functions use the member
  // credential, not client-selected player names as database authority.
  const side=await seed('sidegame','side',{sideGame:{bets:[],scores:[],settlements:[]}});
  const challenge=await run('sideGameSendChallenge',side,side.tokens.a,['b'],{$:id=>id==='sideGameStake'?{value:'10'}:{textContent:''}});
  const bet=challenge.state.state.sideGame.bets[0];assert.equal(bet.status,'pending');checks++;
  const bc=await read(side),wrong=structuredClone(bc.state);wrong.sideGame.bets[0].status='active';wrong.sideGame.bets[0].acceptedAt='fictional';
  await reject(()=>write(side,bc,'sidegame',wrong,side.tokens.a),/IMMUTABLE_SIDEGAME_BET/);
  const accepted=await run('sideGameAcceptChallenge',side,side.tokens.b,[bet.id],{myPlayerId:'b'});assert.equal(accepted.state.state.sideGame.bets[0].status,'active');checks++;
  const formatBefore=await read(side),mixed=structuredClone(formatBefore.state);
  mixed.sideGame.bets.push({id:'mixed-format',player1Id:'d',player1Name:'Fictional D',player2Id:'a',player2Name:'Fictional A',stake:10,format:'net',date:bet.date,status:'pending',setup:'challenge',createdAt:'fictional'});
  assert.equal((await write(side,formatBefore,'sidegame',mixed,side.tokens.d)).error,null);checks++;
  const respondBefore=await read(side),respond=structuredClone(respondBefore.state);respond.sideGame.bets[1].status='active';respond.sideGame.bets[1].acceptedAt='fictional';
  await reject(()=>write(side,respondBefore,'sidegame',respond,side.tokens.a),/FORMAT_CONFLICT/);
  const incomplete=structuredClone(respondBefore.state);incomplete.sideGame.bets.push({id:'missing-setup',player1Id:'a',player1Name:'Fictional A',player2Id:'b',player2Name:'Fictional B',stake:10,format:'stableford',date:'2099-12-31',status:'pending',createdAt:'fictional'});
  await reject(()=>write(side,respondBefore,'sidegame',incomplete,side.tokens.a),/INVALID_SIDEGAME_BET/);
  const injected=structuredClone(respondBefore.state);injected.sideGame.bets.push({...mixed.sideGame.bets[1],id:"bad');injected()",player1Id:'a',player1Name:'Fictional A',player2Id:'d',player2Name:'Fictional D',date:'2099-12-31'});
  await reject(()=>write(side,respondBefore,'sidegame',injected,side.tokens.a),/INVALID_SIDEGAME_BET/);

  await run('sideGameSaveScore',side,side.tokens.a,['stableford'],{$:()=>({value:'37',textContent:''})});
  const result=await run('sideGameSaveScore',side,side.tokens.b,['stableford'],{myPlayerId:'b',$:()=>({value:'35',textContent:''})});
  const resolved=result.state.state.sideGame.bets[0];assert.equal(resolved.status,'resolved');assert.equal(resolved.winnerId,'a');assert.equal(resolved.amount,10);checks++;
  assert.deepEqual(result.state.state.players,side.state.players);assert.deepEqual(result.state.state.history,side.state.history);checks++;
  const sr=await read(side),fake=structuredClone(sr.state);fake.players[3].paid=true;
  await reject(()=>write(side,sr,'sidegame',fake,side.tokens.a),/CHANGED_COMPETITION/);
  const rewrite=structuredClone(sr.state);rewrite.sideGame.bets[0].winnerId='b';await reject(()=>write(side,sr,'sidegame',rewrite,side.tokens.b),/IMMUTABLE_SIDEGAME_BET/);
  const scoreOther=structuredClone(sr.state);scoreOther.sideGame.scores[0].score=99;await reject(()=>write(side,sr,'sidegame',scoreOther,side.tokens.b),/INVALID_SIDEGAME_SCORE/);
  const requested=await run('sideGameRequestSettlement',side,side.tokens.b,['a',10],{myPlayerId:'b'});const settlement=requested.state.state.sideGame.settlements[0];assert.equal(settlement.status,'pending');checks++;
  const conf=await read(side),selfConfirm=structuredClone(conf.state);selfConfirm.sideGame.settlements[0].status='confirmed';selfConfirm.sideGame.settlements[0].confirmedAt='fictional';
  await reject(()=>write(side,conf,'sidegame',selfConfirm,side.tokens.b),/CONFIRMATION/);
  const confirmed=await run('sideGameConfirmSettlement',side,side.tokens.a,[settlement.id]);assert.equal(confirmed.state.state.sideGame.settlements[0].status,'confirmed');checks++;
  const again=await read(side),overpay=structuredClone(again.state);overpay.sideGame.settlements.push({...settlement,id:'overpay'});
  await reject(()=>write(side,again,'sidegame',overpay,side.tokens.b),/EXCEEDS_DEBT/);
  const otherGroup=await seed('other-side');await reject(()=>write(side,again,'sidegame',overpay,otherGroup.tokens.b),/MEMBER_CREDENTIAL/);
  const sid=randomUUID(),updated=structuredClone(again.state);updated.sideGame.scores[0].score=36;updated.sideGame.scores[0].updatedAt='fictional';
  assert.equal((await write(side,again,'sidegame',updated,side.tokens.a,sid)).error,null);checks++;
  const replay=await inventory();assert.equal((await write(side,again,'sidegame',updated,side.tokens.a,sid)).data.replayed,true);assert.deepEqual(await inventory(),replay);checks++;
  await db.query('SELECT iig_closed_entry.revoke_member($1,$2)',[side.g,side.tokens.a]);
  await reject(()=>write(side,again,'sidegame',updated,side.tokens.a,sid),/MEMBER_CREDENTIAL/);
  await reject(()=>rpc('iig_entry_receipt',{p_pin:side.pin,p_group:side.g,p_request:sid,p_credential:side.tokens.a}),/MEMBER_CREDENTIAL/);
  const fault=await seed('fault-member'),fb=await read(fault),fstate=structuredClone(fb.state);fstate.players[3].handicap=12.2;
  await db.query('INSERT INTO fixture_faults VALUES($1)',[fault.g]);await reject(()=>write(fault,fb,'profile',fstate,fault.tokens.d),/FICTIONAL_AFTER_FAILURE/);
  for(const role of ['anon','authenticated','service_role']){
   await db.exec('SET SESSION AUTHORIZATION '+role);
   await assert.rejects(()=>db.query("SELECT iig_closed_entry.provision_member($1,'a',$2,clock_timestamp()+interval '1 day',ARRAY['claim'])",[x.g,randomBytes(32).toString('hex')]),/permission denied/);
   await db.exec('SET SESSION AUTHORIZATION postgres');checks++;
  }
  const person=await seed('in-person','in-person',{sideGame:{bets:[],scores:[],settlements:[]}});
  const agreed=await run('sideGameConfirmBet',person,person.tokens.a,['b'],{$:()=>({value:'10',textContent:''})});
  assert.equal(agreed.state.state.sideGame.bets[0].setup,'in_person');assert.equal(agreed.state.state.sideGame.bets[0].status,'active');
  assert.equal(agreed.ctx.localStorage.getItem('iig_sidegame_bets_in-person_a'),null);checks++;
  const decline=await seed('decline','decline',{sideGame:{bets:[],scores:[],settlements:[]}});
  const incoming=await run('sideGameSendChallenge',decline,decline.tokens.a,['b'],{$:()=>({value:'10',textContent:''})});
  const declined=await run('sideGameDeclineChallenge',decline,decline.tokens.b,[incoming.state.state.sideGame.bets[0].id],{myPlayerId:'b'});
  assert.equal(declined.state.state.sideGame.bets[0].status,'declined');checks++;
  await reject(()=>rpc('iig_entry_check_member',{p_pin:person.pin,p_group:person.g,p_credential:person.admin,p_scope:'sidegame'}),/MEMBER_CREDENTIAL/);
  // Deleted identities must not revive old credentials if their ID is reused.
  const deletion=await seed('revoked-on-removal'),dr=await read(deletion),deleted=structuredClone(dr.state);deleted.players.splice(3,1);
  assert.equal((await write(deletion,dr,'members',deleted)).error,null);checks++;
  const flag=(await db.query('SELECT revoked FROM iig_closed_entry.member_credentials WHERE group_id=$1 AND player_id=$2',[deletion.g,'d'])).rows[0].revoked;
  assert.equal(flag,true);checks++;
  const recovery=await seed('member-recovery'),hash=(await db.query('SELECT iig_closed_entry.token_hash($1) h',[recovery.tokens.a])).rows[0].h,newToken=randomBytes(32).toString('hex');
  const memberBefore=await inventory();
  await assert.rejects(()=>db.query("SELECT iig_closed_entry.replace_member_credentials($1,'a',ARRAY[]::text[],$2,clock_timestamp()+interval '1 day',ARRAY['claim'])",[recovery.g,newToken]),/CREDENTIAL_SET_CHANGED/);
  assert.deepEqual(await inventory(),memberBefore);checks++;
  await db.query("SELECT iig_closed_entry.replace_member_credentials($1,'a',$2,$3,clock_timestamp()+interval '1 day',ARRAY['profile','sidegame','claim'])",[recovery.g,[hash],newToken]);
  assert.equal((await rpc('iig_entry_check_member',{p_pin:recovery.pin,p_group:recovery.g,p_credential:newToken,p_scope:'claim'})).data.playerId,'a');
  await reject(()=>rpc('iig_entry_check_member',{p_pin:recovery.pin,p_group:recovery.g,p_credential:recovery.tokens.a,p_scope:'claim'}),/MEMBER_CREDENTIAL/);
  assert.equal((await rpc('iig_entry_check_member',{p_pin:recovery.pin,p_group:recovery.g,p_credential:recovery.tokens.b,p_scope:'claim'})).data.playerId,'b');checks++;
  const lostGroup=await seed('member-lost-ack','lost',{history,roundOpen:false}),lostRead=await read(lostGroup);let sends=0;
  const lost=guard.create({rpc:async(n,a)=>{const out=await rpc(n,a);if(n==='iig_entry_write'){sends++;throw Error('ACK_LOST');}return out;}},{uuid:randomUUID,promptCredential:async({kind})=>{assert.equal(kind,'player');return lostGroup.tokens.a;}});
  const loaded=(await lost.db.rpc('get_group_state',{p_pin:lostGroup.pin})).data,cap=lost.capture(loaded,lostGroup.pin);
  loaded.history[0].payouts[0]={...loaded.history[0].payouts[0],status:'bank_details_needed',paymentProvider:'Private bank transfer',claimedAt:'fictional'};
  assert.ok((await lost.commit('claim',lostGroup.pin,structuredClone(loaded),cap,loaded)).error);const lostBefore=await inventory();
  assert.equal((await lost.recover()).error,null);assert.equal(sends,1);assert.deepEqual(await inventory(),lostBefore);checks++;
  // Actual newRound creates a validated Trip backup and first planned day.
  let tripTemplate;
  for(const format of ['individual','betterball','pairsaggregate'])for(const comp of ['stableford','net'])for(const game of ['money','points']){
   const old=await originalFinish(fixture({game:'money',format:'stableford'}));
   const trip=await seed('new-trip-'+format+'-'+comp+'-'+game,undefined,old);
   const ids=trip.state.players.map(p=>p.id),teams=format==='individual'?[]:[{id:'ab',playerIds:ids.slice(0,2)},{id:'cd',playerIds:ids.slice(2,4)}];
   const plan=[1,2].map(i=>({format,course:'Fictional Trip '+i,date:'2099-11-0'+i,gameType:game,stake:game==='money'?10:0,splitPrizes:game==='money',secondPrize:game==='money'?2:0,thirdPrize:game==='money'?1:0}));
   const ready=await run('newRound',trip,trip.admin,[],{chooseNewRoundGameType:async()=> '3',tripSetupScreen:async()=>({name:'Fictional Journey',totalRounds:2,competition:comp,tripPointsEnabled:true,playerIds:ids,rounds:plan}),
    tripRoundDaySetup:async()=>({playingIds:ids,groups:[ids],teams}),createRoundId:randomUUID,roundOpenNow:()=>false});
   tripTemplate=structuredClone(ready.state.state);
   assert.equal(ready.state.context.phase,'open');assert.equal(ready.state.state.trip.active,true);assert.equal(ready.state.state.trip.currentFormat,format);
   assert.deepEqual(ready.state.state.history,trip.state.history);assert.deepEqual(ready.state.state.sideGame,trip.state.sideGame);checks++;
  }
  for(const game of ['money','points']){
   const old=fixture({trip:true,game,format:'stableford'});old.roundOpen=false;old.players.forEach(p=>Object.assign(p,{paid:false,stableford:null,netScore:null,noReturn:false,scoreSubmitted:false,competition:null}));
   delete old.trip.plan;old.trip.currentFormat='individual';old.trip.currentRound=2;old.trip.rounds=[{id:'kept-legacy-day'}];
   const legacyTrip=await seed('unplanned-'+game,undefined,old),answers=['Legacy Fictional Course',game==='money'?'1':'2','2','10'];
   const started=await run('nextTripRound',legacyTrip,legacyTrip.admin,[],{prompt:()=>answers.shift(),pickTripDate:async()=> '2099-11-03',createRoundId:randomUUID});
   assert.equal(started.state.context.phase,'open');assert.deepEqual(started.state.state.trip.rounds,old.trip.rounds);assert.equal(started.state.state.trip.competition,'net');checks++;
  }
  for(const [label,tamper] of [
   ['awards',s=>{s.trip.standings={a:99};}],['backup',s=>{s.trip.normalRoundBackup.players[0].wins=999;}],
   ['past',s=>{s.trip.pastTrips=[{name:'forged'}];}],['rounds',s=>{s.trip.rounds=[{winner:'forged'}];}],
   ['format',s=>{s.trip.plan[0].format='unsupported';}],['counter',s=>{s.trip.currentRound=2;}],
   ['entry',s=>{s.players[0].paid=true;}],['history',s=>{s.history=[];}],
   ['attendance',s=>{s.trip.currentPlayingIds=['not-a-member'];}]
  ]){
   const base=await originalFinish(fixture({game:'money',format:'stableford'})),target=await seed('trip-tamper-'+label,undefined,base),readBefore=await read(target),bad=structuredClone(tripTemplate);tamper(bad);
   await reject(()=>write(target,readBefore,'start',bad),/INVALID_|SETUP_|TRIP_/);
  }
  console.log(`PASS: ${checks} canonical member/Side Game/payout/legacy PIN checks; actual client source routes, independent identities, no entry/pot/result edits, immutable payouts, debt confirmation, revocation/replay and downstream rollback. Fictional only; not real owner/player verification.`);
 }finally{await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
