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
   const calls={iig_entry_prepare:['SELECT public.iig_entry_prepare($1,$2,$3,$4,$5,$6,$7) d',[a.p_pin,a.p_group,a.p_round,a.p_revision,a.p_operation,a.p_credential,a.p_selection]],iig_entry_read:['SELECT public.iig_entry_read($1) d',[a.p_pin]],iig_entry_write:['SELECT public.iig_entry_write($1,$2,$3,$4,$5,$6,$7,$8) d',[a.p_pin,a.p_group,a.p_round,a.p_revision,a.p_operation,a.p_state,a.p_credential,a.p_request]],
    iig_entry_check_credential:['SELECT public.iig_entry_check_credential($1,$2,$3) d',[a.p_pin,a.p_group,a.p_credential]],
    iig_entry_check_member:['SELECT public.iig_entry_check_member($1,$2,$3,$4) d',[a.p_pin,a.p_group,a.p_credential,a.p_scope]],
    iig_entry_receipt:['SELECT public.iig_entry_receipt($1,$2,$3,$4) d',[a.p_pin,a.p_group,a.p_request,a.p_credential]]};
   await db.exec('SET SESSION AUTHORIZATION anon');try{const [q,p]=calls[name];return {data:(await db.query(q,p)).rows[0].d,error:null};}catch(e){return {data:null,error:{message:e.message}};}finally{await db.exec('SET SESSION AUTHORIZATION postgres');}
  }
  async function seed(g,pin=g,patch={}){
   const state={...fixture({game:'money',format:'stableford'}),...patch};const admin=randomBytes(32).toString('hex'),tokens={};
   await db.query('INSERT INTO public.tens_in_groups(id,fixture_pin,state) VALUES($1,$2,$3)',[g,pin,state]);
   await db.query("SELECT iig_closed_entry.provision($1,$2,clock_timestamp()+interval '1 day',ARRAY['start','finish','settings','members','settle','tripreturn','tripcancel','resetscores','resetpayments','deletelast','clearleague','deletepasttrip','configure'])",[g,admin]);
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
   const c={state:loaded,pin:x.pin,db:bridge.db,iigEntryBridge:bridge,isAdmin:true,myPlayerId:'a',saveActive:false,savePending:0,saveQueue:Promise.resolve(),stateSaveVersion:0,scoreDraftActive:false,
    Date,JSON,Object,Array,String,Number,Boolean,Math,Promise,URL,demoCanEdit:()=>true,demoReadOnly:()=>false,$:()=>({value:'37',textContent:''}),render(){},show(){},showRoundHistory(){},sideGameHome(){},alert(){},confirm:()=>true,
    localStorage:{getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v)},window:{scrollTo(){}},moneyText:String,appPrompt:async()=> '12.3',...extras};
   vm.createContext(c);for(const f of ['sideGameToday','save','applyGuardedOperation','createWinnerPayouts','currentPlayerMatchesPayout','ensureSideGameState','validGolfHandicap','validIndividualScore','sideGameResolveBetsForToday'])vm.runInContext(extract(f),c);
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
  const activeProfile=await seed('entered-profile'),apr=await read(activeProfile),aps=structuredClone(apr.state);aps.players[0].handicap=12.2;
  assert.equal((await write(activeProfile,apr,'profile',aps,activeProfile.tokens.a)).error,null);const apAfter=await read(activeProfile);assert.equal(apAfter.context.closed,true);assert.equal(apAfter.state.players[0].paid,true);assert.equal(apAfter.state.players[0].stableford,apr.state.players[0].stableford);assert.deepEqual(apAfter.state.history,apr.state.history);checks++;
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
   if(game==='points')old.stake=10;
   delete old.trip.plan;old.trip.currentFormat='individual';old.trip.currentRound=2;old.trip.rounds=[{id:'kept-legacy-day'}];
   const legacyTrip=await seed('unplanned-'+game,undefined,old),answers=['Legacy Fictional Course',game==='money'?'1':'2','2','10'];
   const started=await run('nextTripRound',legacyTrip,legacyTrip.admin,[],{prompt:()=>answers.shift(),pickTripDate:async()=> '2099-11-03',createRoundId:randomUUID});
   assert.equal(started.state.context.phase,'open');assert.deepEqual(started.state.state.trip.rounds,old.trip.rounds);assert.equal(started.state.state.trip.competition,'net');assert.equal(started.state.state.pointsCompetition,'net');checks++;
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
  // Lossless restoration uses actual guarded Trip controls, including legacy
  // backups, new/deleted members, changed profiles and complete audit/receipt data.
  for(const pair of [null,'betterball','pairsaggregate'])for(const action of ['cancelTrip','finishTrip']){
   const beforeTrip=fixture({trip:true,last:true,pair,format:'stableford'});
   const current=action==='finishTrip'?await originalFinish(beforeTrip):beforeTrip;
   const normal=fixture({game:'money',format:'net'});
   normal.course='Normal fictional course';normal.date='2099-11-01';
   normal.players=current.players.map((p,i)=>({...p,name:'Original '+p.name,paid:i<3,playingThisRound:i<3,stableford:null,netScore:i<3?70+i:null,noReturn:false,scoreSubmitted:i<3,wins:7,leaguePoints:25,netWinnings:15}));
   normal.roundOpen=true;normal.players[0].netScore=0;
   current.trip.normalRoundBackup=structuredClone(normal);current.trip.pastTrips=[{name:'Older kept trip',rounds:[{id:'kept'}]}];
   current.players[0].name='Renamed fictional golfer';current.players[0].handicap=8.5;current.players[0].opaque={keep:true};
   current.players=current.players.filter(p=>p.id!=='c');
   current.players.push({id:'new-member',name:'New fictional member',handicap:11.2,paid:false,playingThisRound:false,stableford:null,netScore:null,noReturn:false,scoreSubmitted:false,wins:0,leaguePoints:0,netWinnings:0});
   const target=await seed('restore-'+pair+'-'+action,undefined,current),prior=await read(target);
   const restored=await run(action,target,target.admin);
   const out=restored.state.state;
   assert.deepEqual(out.players.map(p=>p.id),current.players.map(p=>p.id));assert.equal(out.players[0].name,current.players[0].name);assert.equal(out.players[0].handicap,8.5);assert.deepEqual(out.players[0].opaque,{keep:true});
   assert.equal(out.players[0].wins,7);assert.equal(out.players[0].leaguePoints,25);assert.equal(out.players[0].netWinnings,15);
   assert.deepEqual(out.history,current.history);assert.deepEqual(out.sideGame,current.sideGame);assert.equal(out.splitPrizes,normal.splitPrizes);assert.equal(out.secondPrize,normal.secondPrize);
   assert.equal(out.players.at(-1).paid,false);assert.notEqual(restored.state.context.roundId,prior.context.roundId);assert.equal(restored.state.context.closed,true);
   if(action==='cancelTrip'){assert.equal(out.players[0].netScore,0);assert.equal(out.players[0].paid,true);assert.equal(restored.state.context.phase,'open');assert.deepEqual(out.trip.pastTrips,current.trip.pastTrips);}
   else{assert.equal(out.players[0].netScore,null);assert.equal(out.roundOpen,false);assert.equal(out.date,'');assert.equal(out.trip.pastTrips.length,2);assert.deepEqual(out.trip.pastTrips[0].rounds,current.trip.rounds);assert.deepEqual(out.trip.pastTrips[0].normalRoundBackup,normal);}
   assert.deepEqual((await db.query('SELECT state FROM iig_closed_entry.operation_audit WHERE group_id=$1',[target.g])).rows[0].state,current);checks++;
   const stale=structuredClone(current);stale.players.at(-1).paid=true;
   await reject(()=>write(target,prior,'save',stale,null),/STALE/);
   if(action==='cancelTrip'){const latest=await read(target),late=structuredClone(latest.state);late.players.at(-1).paid=true;await reject(()=>write(target,latest,'save',late,null),/ENTRIES_CLOSED/);}
  }
  const reset=await seed('reset-controls'),oldReset=await read(reset);
  const resetOut=await run('resetScores',reset,reset.admin);
  assert.equal(resetOut.state.context.closed,true);assert.equal(resetOut.state.state.players[0].stableford,null);assert.equal(resetOut.state.state.players[0].paid,true);checks++;
  const rr=await read(reset),lateAfterReset=structuredClone(rr.state);lateAfterReset.players.at(-1).paid=true;
  await reject(()=>write(reset,rr,'save',lateAfterReset,null),/ENTRIES_CLOSED/);
  await reject(()=>rpc('iig_entry_prepare',{p_pin:reset.pin,p_group:reset.g,p_round:rr.context.roundId,p_revision:rr.context.revision,p_operation:'resetpayments',p_credential:reset.admin,p_selection:null}),/ENTRIES_CLOSED/);
  const noScores=fixture({game:'money'});noScores.players.forEach(p=>Object.assign(p,{stableford:null,netScore:null,noReturn:false,scoreSubmitted:false}));
  const payReset=await seed('reset-before-score',undefined,noScores),payResetOut=await run('resetPayments',payReset,payReset.admin);assert.equal(payResetOut.state.state.players.filter(p=>p.paid).length,0);checks++;
  const oldDelete=await seed('history-delete'),deletedRound=await run('deleteLastRound',oldDelete,oldDelete.admin,[],{formatDate:String});
  assert.equal(deletedRound.state.state.history.length,0);assert.deepEqual(deletedRound.state.state.sideGame,oldDelete.state.sideGame);assert.deepEqual((await db.query('SELECT state FROM iig_closed_entry.operation_audit WHERE group_id=$1',[oldDelete.g])).rows[0].state.history,oldDelete.state.history);checks++;
  const league=await seed('league-reset'),cleared=await run('clearLeague',league,league.admin);assert.equal(cleared.state.state.history.length,0);assert.ok(cleared.state.state.players.every(p=>p.wins===0&&p.leaguePoints===0&&p.netWinnings===0));assert.deepEqual(cleared.state.state.trip,league.state.trip);checks++;
  const pastTarget=await seed('past-trip-delete',undefined,{trip:{active:false,pastTrips:[{name:'One'},{name:'Two'}]}});
  const pastDeleted=await run('deletePastTrip',pastTarget,pastTarget.admin,[],{prompt:()=> '1'});assert.deepEqual(pastDeleted.state.state.trip.pastTrips,[{name:'Two'}]);checks++;
  const denied=await seed('denied-maintenance'),deniedRead=await read(denied);
  await reject(()=>rpc('iig_entry_prepare',{p_pin:denied.pin,p_group:denied.g,p_round:deniedRead.context.roundId,p_revision:deniedRead.context.revision,p_operation:'clearleague',p_credential:denied.tokens.a,p_selection:null}),/CREDENTIAL/);
  const configure=await seed('configure-format',undefined,noScores);
  const configured=await run('changeCurrentRoundCompetition',configure,configure.admin,[],{roundOpenNow:()=>true,roundLocked:()=>false,settingsPage(){}});
  assert.equal(configured.state.state.pointsCompetition,'net');assert.ok(configured.state.state.players.every(p=>p.competition==='net'));assert.deepEqual(configured.state.state.history,configure.state.history);checks++;
  const cr=await read(configure),badConfig=structuredClone(cr.state);badConfig.players.at(-1).paid=true;
  await reject(()=>write(configure,cr,'configure',badConfig),/CONFIGURATION_CHANGED_PLAYER/);
  const configuredScore=structuredClone(cr.state);configuredScore.players[0].netScore=70;configuredScore.players[0].scoreSubmitted=true;assert.equal((await write(configure,cr,'save',configuredScore,null)).error,null);
  const scoredConfig=await read(configure),lateConfig=structuredClone(scoredConfig.state);lateConfig.stake=999;
  await reject(()=>write(configure,scoredConfig,'configure',lateConfig),/ENTRIES_CLOSED/);
  const linked=await run('changePaymentLink',configure,configure.admin,[],{detectPaymentProvider:()=>'',organiserPaymentSetup:async()=>({link:'https://paypal.me/FictionalGroup',provider:'paypal'}),paymentProviderLabel:()=> 'PayPal'});
  assert.equal(linked.state.state.paymentLink,'https://paypal.me/FictionalGroup');assert.deepEqual(linked.state.state.players,scoredConfig.state.players);checks++;
  // Historical snapshots can prove stable identity; matching a current name alone
  // cannot. No economic backfill or recipient mutation is used.
  const oldPayout={...payout,winnerPlayerId:null};
  const historicPlayers=fixture({game:'money'}).players;
  const legacyName=await seed('legacy-recipient',undefined,{history:[{id:'old-result',gameType:'money',players:historicPlayers,payouts:[oldPayout]}],roundOpen:false});
  const legacyClaim=await run('claimWinnerPrize',legacyName,legacyName.tokens.a,[0,'p1'],{chooseWinnerPayoutMethod:async()=> 'bank_transfer'});
  assert.equal(legacyClaim.state.state.history[0].payouts[0].status,'bank_details_needed');assert.equal(legacyClaim.state.state.history[0].payouts[0].winnerPlayerId,null);checks++;
  const unproved=await seed('name-only-unproved',undefined,{history:[{id:'no-ids',gameType:'money',players:historicPlayers.map(({id,...p})=>p),payouts:[oldPayout]}],roundOpen:false});
  const up=await read(unproved),upState=structuredClone(up.state);Object.assign(upState.history[0].payouts[0],{status:'bank_details_needed',paymentProvider:'Private bank transfer',claimedAt:'fictional'});
  await reject(()=>write(unproved,up,'claim',upState,unproved.tokens.a),/PAYOUT_IDENTITY_REQUIRED/);
  const manuallyPaid=await run('markWinnerPaid',unproved,unproved.admin,[0,'p1',true]);assert.equal(manuallyPaid.state.state.history[0].payouts[0].status,'paid');assert.equal(manuallyPaid.state.state.history[0].payouts[0].amount,30);checks++;
  const materialRecord={id:'legacy-material',gameType:'money',pointsCompetition:'stableford',splitPrizes:false,stablefordPot:30,netPot:0,stablefordWinnerNames:['Fictional A'],netWinnerNames:[],players:historicPlayers};
  const material=await seed('legacy-material',undefined,{history:[materialRecord],roundOpen:false});
  const mc=await run('claimWinnerPrize',material,material.tokens.a,[0,'stableford-0-fictional-a'],{chooseWinnerPayoutMethod:async()=> 'bank_transfer'});
  assert.equal(mc.state.state.history[0].payouts[0].amount,30);assert.equal(mc.state.state.history[0].payouts[0].status,'bank_details_needed');assert.deepEqual({...mc.state.state.history[0],payouts:null},{...materialRecord,payouts:null});checks++;
  const half={...materialRecord,stablefordPot:2.01,stablefordWinnerNames:['Fictional A','Fictional B']};
  const hp=(await db.query('SELECT iig_closed_entry.legacy_payouts($1) p',[half])).rows[0].p;assert.equal(hp[0].amount,Number((2.01/2).toFixed(2)));checks++;
  for(const amount of [0,0.005,0.125,1.005,1.015,2.675,10.075,999999.995]){assert.equal(Number((await db.query('SELECT iig_closed_entry.js_money_round($1) m',[amount])).rows[0].m),Number(amount.toFixed(2)));checks++;}
  const tripNormal=fixture({game:'money',format:'net'}),tripCurrent=fixture({trip:true});tripCurrent.trip.normalRoundBackup=tripNormal;tripCurrent.trip.pastTrips=[];
  const previewOnly=await seed('trip-preview-only',undefined,tripCurrent),po=await read(previewOnly),beforePreview=await inventory();
  const preview=await rpc('iig_entry_prepare',{p_pin:previewOnly.pin,p_group:previewOnly.g,p_round:po.context.roundId,p_revision:po.context.revision,p_operation:'tripcancel',p_credential:previewOnly.admin,p_selection:null});
  assert.equal(preview.error,null);assert.deepEqual(await inventory(),beforePreview);checks++;
  const invented=structuredClone(preview.data.state);invented.history=[];
  await reject(()=>write(previewOnly,po,'tripcancel',invented),/INVALID_TRIP_RESTORE/);
  const faulty=await seed('trip-downstream-fault',undefined,tripCurrent),fRead=await read(faulty);
  const fp=(await db.query("SELECT iig_closed_entry.derive_operation($1,'tripcancel') p",[fRead.state])).rows[0].p;
  await db.query('INSERT INTO fixture_faults VALUES($1)',[faulty.g]);await reject(()=>write(faulty,fRead,'tripcancel',fp),/FICTIONAL_AFTER_FAILURE/);
  const auditFault=await seed('trip-audit-fault',undefined,tripCurrent),ar=await read(auditFault);
  const ap=(await db.query("SELECT iig_closed_entry.derive_operation($1,'tripcancel') p",[ar.state])).rows[0].p;
  await db.exec(`CREATE FUNCTION public.fixture_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.group_id='trip-audit-fault' THEN RAISE EXCEPTION 'FICTIONAL_AUDIT_FAILURE';END IF;RETURN NEW;END$$;
   CREATE TRIGGER fixture_audit_failure BEFORE INSERT ON iig_closed_entry.operation_audit FOR EACH ROW EXECUTE FUNCTION public.fixture_audit_failure();`);
  await reject(()=>write(auditFault,ar,'tripcancel',ap),/FICTIONAL_AUDIT_FAILURE/);
  const ackTrip=await seed('trip-lost-ack',undefined,tripCurrent);let tripSends=0;
  const tripBridge=guard.create({rpc:async(n,a)=>{const out=await rpc(n,a);if(n==='iig_entry_write'){tripSends++;throw Error('LOST_ACK');}return out;}},{uuid:randomUUID,promptCredential:async()=>ackTrip.admin});
  const tripRead=(await tripBridge.db.rpc('get_group_state',{p_pin:ackTrip.pin})).data;
  const tripPrepared=await tripBridge.prepare('tripcancel',ackTrip.pin,tripRead);assert.equal(tripPrepared.error,null);
  const tripCapture=tripBridge.capture(tripRead,ackTrip.pin);
  for(const k of Object.keys(tripRead))if(!(k in tripPrepared.data))delete tripRead[k];Object.assign(tripRead,tripPrepared.data);
  assert.ok((await tripBridge.commit('tripcancel',ackTrip.pin,structuredClone(tripRead),tripCapture,tripRead)).error);
  const afterAckLoss=await inventory();const reconciled=await tripBridge.recover();assert.equal(reconciled.error,null);assert.equal(tripSends,1);assert.deepEqual(await inventory(),afterAckLoss);assert.equal(reconciled.data.players[0].netScore,tripNormal.players[0].netScore);checks++;
  // Routine entry/scoring needs no organiser/member credential pairing prompt.
  const simple=await seed('simple-scoring',undefined,noScores);let prompts=0;
  const simpleBridge=guard.create({rpc},{uuid:randomUUID,promptCredential:async()=>{prompts++;throw Error('No extra step');}});
  const simpleState=(await simpleBridge.db.rpc('get_group_state',{p_pin:simple.pin})).data;simpleState.players[0].stableford=31;simpleState.players[0].scoreSubmitted=true;
  assert.equal((await simpleBridge.db.rpc('save_group_state',{p_pin:simple.pin,p_state:simpleState})).error,null);assert.equal(prompts,0);checks++;
  const joinTarget=await seed('join-finished-round',undefined,{roundOpen:false}),joinBefore=await read(joinTarget);
  const joined=await run('addPlayer',joinTarget,null,[],{myPlayerId:null,iigFreePlan:()=>false,playerJoinForm:async()=>({first:'Fictional',surname:'Joiner',handicap:11.2}),saveMyPlayerForGroup(){},clearMyPlayerForGroup(){},showInstallHelp(){},document:{querySelector:()=>({style:{}})}});
  assert.equal(joined.state.state.players.length,joinBefore.state.players.length+1);assert.equal(joined.state.state.players.at(-1).paid,false);assert.deepEqual(joined.state.state.players.slice(0,-1),joinBefore.state.players);assert.deepEqual(joined.state.state.history,joinBefore.state.history);assert.equal(joined.state.context.phase,'finished');assert.equal(joined.state.context.closed,true);checks++;
  const jv=await read(joinTarget),entryThroughJoin=structuredClone(jv.state);entryThroughJoin.players.push({id:'forged-new-entry',name:'Forged entrant',handicap:12,paid:true,playingThisRound:true,stableford:null,netScore:null,noReturn:false,scoreSubmitted:false,wins:0,leaguePoints:0,netWinnings:0});
  await reject(()=>write(joinTarget,jv,'join',entryThroughJoin,null),/INVALID_NEW_MEMBER/);
  const mixJoin=structuredClone(jv.state);mixJoin.players[0].paid=false;mixJoin.players.push({...mixJoin.players.at(-1),id:'another',name:'Another golfer'});
  await reject(()=>write(joinTarget,jv,'join',mixJoin,null),/JOIN_MUST_ONLY_APPEND/);
  const freeBase=fixture({game:'money',format:'stableford'});Object.assign(freeBase,{stake:0,splitPrizes:false,firstPrize:0,secondPrize:0,thirdPrize:0});freeBase.players.forEach(p=>Object.assign(p,{paid:false,playingThisRound:false,stableford:null,netScore:null,noReturn:false,scoreSubmitted:false}));
  const free=await seed('free-entry-snapshot',undefined,freeBase),fr=await read(free),firstFree=structuredClone(fr.state);Object.assign(firstFree.players[0],{stableford:31,scoreSubmitted:true});
  assert.equal((await write(free,fr,'save',firstFree,null)).error,null);let freeRead=await read(free);assert.deepEqual(freeRead.context.entrantIds,['a','b','c','d']);checks++;
  const freeJoin=structuredClone(freeRead.state);freeJoin.players.push({id:'late-free',name:'Late fictional member',handicap:12,paid:false,playingThisRound:false,stableford:null,netScore:null,noReturn:false,scoreSubmitted:false,wins:0,leaguePoints:0,netWinnings:0});
  assert.equal((await write(free,freeRead,'join',freeJoin,null)).error,null);freeRead=await read(free);assert.deepEqual(freeRead.context.entrantIds,['a','b','c','d']);checks++;
  const lateFreeScore=structuredClone(freeRead.state);lateFreeScore.players.at(-1).stableford=40;lateFreeScore.players.at(-1).scoreSubmitted=true;
  await reject(()=>write(free,freeRead,'save',lateFreeScore,null),/INELIGIBLE_SCORER/);
  const existingFree=structuredClone(freeRead.state);for(const [i,p] of existingFree.players.entries())if(i>0&&i<4)Object.assign(p,{stableford:34-i,scoreSubmitted:true});
  assert.equal((await write(free,freeRead,'save',existingFree,null)).error,null);checks++;
  const freeBridge=app(free,free.admin),freeLoaded=(await freeBridge.db.rpc('get_group_state',{p_pin:free.pin})).data;
  const nextCtx={state:freeLoaded,pin:free.pin,iigEntryBridge:freeBridge,isAdmin:false,demoReadOnly:()=>false,myPlayerId:'late-free',tripPlayerIsPlaying:()=>true,tripTeamRoundActive:()=>false,roundLocked:()=>true,esc:String};
  vm.createContext(nextCtx);vm.runInContext(extract('accountEntryStatus')+'\n'+extract('playerNextActionHtml'),nextCtx);
  assert.match(nextCtx.playerNextActionHtml(),/Entries Closed/);assert.doesNotMatch(nextCtx.playerNextActionHtml(),/Enter My Score|Pay .*Join/);checks++;
  nextCtx.myPlayerId='a';assert.match(nextCtx.playerNextActionHtml(),/View Leaderboard/);checks++;
  const freeFinished=await originalFinish(freeLoaded,{bridge:freeBridge,pin:free.pin});assert.equal((await read(free)).state.history.length,freeBase.history.length+1);assert.deepEqual(freeFinished.history[0].winners,['Fictional B']);assert.equal(freeFinished.history[0].stablefordPot,0);checks++;
  const beforeStat=await read(simple),fakeStats=structuredClone(beforeStat.state);fakeStats.players[0].leaguePoints=99999;
  await reject(()=>write(simple,beforeStat,'save',fakeStats,null),/PROTECTED_PLAYER_FIELDS/);
  const unfinishedState=fixture({game:'money'});unfinishedState.players[1].stableford=null;unfinishedState.players[1].scoreSubmitted=false;
  const unfinished=await seed('unfinished-round',undefined,unfinishedState),unr=await read(unfinished),premature=await originalFinish(fixture({game:'money'}));
  await reject(()=>write(unfinished,unr,'finish',premature),/INCOMPLETE_ROUND/);
  const reusedId=await read(deletion),reuse=structuredClone(reusedId.state);reuse.players.push({...freeBase.players[3],id:'d',name:'Different fictional person'});
  await reject(()=>write(deletion,reusedId,'join',reuse,null),/MEMBER_ID_ALREADY_USED/);
  const unsafeJoin=structuredClone(jv.state);unsafeJoin.players.push({...jv.state.players.at(-1),id:"x');injected()",name:'Unsafe fictional ID'});
  await reject(()=>write(joinTarget,jv,'join',unsafeJoin,null),/INVALID_NEW_MEMBER/);
  const duplicatePayment=await seed('duplicate-paid-return',undefined,noScores);let clearedJourney=0,raceFailure;
  const yes={},no={},overlay={style:{},querySelector:selector=>selector==='#paymentReturnYes'?yes:no,remove(){}};
  const documentStub={visibilityState:'visible',createElement:()=>overlay,body:{appendChild(){queueMicrotask(async()=>{
   try{
    let live=await read(duplicatePayment),paid=structuredClone(live.state);paid.players[3].paid=true;
    assert.equal((await write(duplicatePayment,live,'save',paid,null)).error,null);
    live=await read(duplicatePayment);const score=structuredClone(live.state);score.players[0].stableford=31;score.players[0].scoreSubmitted=true;
    assert.equal((await write(duplicatePayment,live,'save',score,null)).error,null);yes.onclick();
   }catch(e){raceFailure=e;no.onclick();}
  });}}};
  const duplicate=await run('recognisePaymentReturn',duplicatePayment,null,[],{paymentReturnBusy:false,poller:null,document:documentStub,
   readPaymentJourney:()=>({playerId:'d',startedAt:Date.now()-5000,groupPin:duplicatePayment.pin,roundId:noScores.roundId,course:noScores.course,roundDate:noScores.date,stake:noScores.stake}),
   clearPaymentJourney(){clearedJourney++;},entryClosed:()=>false,entryClosedMessage(){throw Error('Existing entrant must retain confirmation');},refreshEntryState:async()=>true,
   sameEntryRound:(a,b)=>a.roundId===b.roundId,showAppToast(){},startPolling(){}});
  assert.equal(raceFailure,undefined);assert.equal(duplicate.state.state.players[3].paid,true);assert.equal(duplicate.state.context.closed,true);assert.equal(duplicate.state.context.revision,2);assert.equal(clearedJourney,1);checks++;
  const nullable=structuredClone(noScores);Object.assign(nullable.players[3],{paid:null,playingThisRound:null,noReturn:null,scoreSubmitted:null});
  const legacyNull=await seed('legacy-null-flags',undefined,nullable),ln=await read(legacyNull),lnScore=structuredClone(ln.state);lnScore.players[0].stableford=31;lnScore.players[0].scoreSubmitted=true;
  assert.equal((await write(legacyNull,ln,'save',lnScore,null)).error,null);assert.equal((await read(legacyNull)).state.players[3].paid,null);checks++;
  const remainingNull=await read(legacyNull),lnRest=structuredClone(remainingNull.state);for(const i of [1,2])Object.assign(lnRest.players[i],{stableford:33-i,scoreSubmitted:true});
  assert.equal((await write(legacyNull,remainingNull,'save',lnRest,null)).error,null);
  const nullBridge=app(legacyNull,legacyNull.admin),nullLoaded=(await nullBridge.db.rpc('get_group_state',{p_pin:legacyNull.pin})).data;
  await originalFinish(nullLoaded,{bridge:nullBridge,pin:legacyNull.pin});assert.equal((await read(legacyNull)).state.history.length,nullable.history.length+1);checks++;
  console.log(`PASS: ${checks} canonical member/Side Game/payout/legacy PIN checks; actual client source routes, independent identities, frozen-entry protection, audited maintenance, immutable payouts, lossless Trip restoration, revocation/replay and rollback. Fictional only; not real owner/player verification.`);
 }finally{await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
