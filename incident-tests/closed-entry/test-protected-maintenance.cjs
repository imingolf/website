// Candidate ONLY, fictional embedded database. No Supabase/network/activation.
const fs=require('node:fs'),assert=require('node:assert/strict'),vm=require('node:vm');
const {PGlite}=require('@electric-sql/pglite');
const {randomBytes,randomUUID}=require('node:crypto');
const {fixture,extract,originalFinish}=require('./test-source-finish.cjs');
const guard=require('../../app/entry-guard-client.js');
(async()=>{
 const db=new PGlite();let count=0;
 try{
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
   CREATE TABLE public.tens_in_groups(id text PRIMARY KEY,state jsonb NOT NULL,updated_at timestamptz DEFAULT now());
   ALTER TABLE public.tens_in_groups ENABLE ROW LEVEL SECURITY;
   CREATE SCHEMA fictional;CREATE TABLE fictional.effects(g text PRIMARY KEY,n integer);CREATE TABLE fictional.faults(g text PRIMARY KEY);
   CREATE FUNCTION fictional.hook() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF EXISTS(SELECT 1 FROM fictional.faults WHERE g=NEW.id) THEN RAISE EXCEPTION 'FICTIONAL_FAILURE';END IF;
    INSERT INTO fictional.effects VALUES(NEW.id,1) ON CONFLICT(g) DO UPDATE SET n=fictional.effects.n+1;RETURN NEW;END $$;
   CREATE TRIGGER unchanged_after_hook AFTER UPDATE ON public.tens_in_groups FOR EACH ROW EXECUTE FUNCTION fictional.hook();`);
  for(const f of ['core.sql','validators.sql','boundary.sql'])await db.exec(fs.readFileSync(__dirname+'/../../supabase/closed-entry-candidate/'+f,'utf8'));
  // Fixture identity is intentionally NOT an assertion about any existing project.
  await db.exec(`CREATE OR REPLACE FUNCTION iig_closed_entry.resolve_pin(p_pin text) RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT id FROM public.tens_in_groups WHERE id=p_pin$$;`);
  async function rpc(n,a){
   const calls={iig_entry_read:['SELECT public.iig_entry_read($1) d',[a.p_pin]],
    iig_entry_write:['SELECT public.iig_entry_write($1,$2,$3,$4,$5,$6,$7,$8) d',[a.p_pin,a.p_group,a.p_round,a.p_revision,a.p_operation,a.p_state,a.p_credential,a.p_request]],
    iig_entry_check_credential:['SELECT public.iig_entry_check_credential($1,$2,$3) d',[a.p_pin,a.p_group,a.p_credential]],
    iig_entry_receipt:['SELECT public.iig_entry_receipt($1,$2,$3,$4) d',[a.p_pin,a.p_group,a.p_request,a.p_credential]]};
   await db.exec('SET SESSION AUTHORIZATION anon');
   try{const [q,p]=calls[n];return {data:(await db.query(q,p)).rows[0].d,error:null};}
   catch(e){return {data:null,error:{message:e.message}};}finally{await db.exec('SET SESSION AUTHORIZATION postgres');}
  }
  const raw={rpc};
  async function seed(g,options={}){
   const state=fixture(options),token=randomBytes(32).toString('hex');
   await db.query('INSERT INTO public.tens_in_groups(id,state) VALUES($1,$2)',[g,state]);
   await db.query("SELECT iig_closed_entry.provision($1,$2,clock_timestamp()+interval '1 day',ARRAY['start','finish','correct','cancel','settings'])",[g,token]);
   return {g,token,state};
  }
  async function read(x){return (await rpc('iig_entry_read',{p_pin:x.g})).data;}
  function write(x,b,op,state,nonce=randomUUID(),token=x.token){return rpc('iig_entry_write',{p_pin:x.g,p_group:x.g,p_round:b.context.roundId,p_revision:b.context.revision,p_operation:op,p_state:state,p_request:nonce,p_credential:token});}
  async function inventory(){const out={};for(const table of ['public.tens_in_groups','iig_closed_entry.rounds','iig_closed_entry.permits','iig_closed_entry.archives','iig_closed_entry.receipts','iig_closed_entry.credentials','fictional.effects'])out[table]=(await db.query(`SELECT to_jsonb(t) r FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows;return out;}
  async function reject(action,match){const before=await inventory(),r=await action();assert.match(r.error?.message||'',match);assert.deepEqual(await inventory(),before);count++;}
  function bridge(x,token=x.token){return guard.create(raw,{uuid:randomUUID,promptCredential:async()=>token});}
  function context(state,b,extra={}){
   const c={state,pin:extra.pin,isAdmin:true,iigEntryBridge:b,db:b.db,saveActive:false,savePending:0,saveQueue:Promise.resolve(),stateSaveVersion:0,
    Number,String,Boolean,JSON,Object,Array,Math,Date,Promise,demoCanEdit:()=>true,demoReadOnly:()=>false,
    $:()=>({textContent:''}),appPrompt:async()=>extra.answer,appConfirm:async()=>true,confirm:()=>true,render(){},show(){},alert(){},scoreDraftActive:false,validIndividualScore:(r,t)=>(t==='stableford'?/^[0-9]{1,2}$/:/^[0-9]{1,3}$/).test(r),tripTeamName:()=> 'Fictional Pair',...extra};
   vm.createContext(c);vm.runInContext(extract('save'),c);return c;
  }
  for(const format of ['stableford','net']){
   const x=await seed('individual-'+format,{format}),b=bridge(x),state=(await b.db.rpc('get_group_state',{p_pin:x.g})).data;
   const c=context(state,b,{pin:x.g,answer:format==='stableford'?'34':'NR'});
   vm.runInContext(extract('adminEditSubmittedScore'),c);await c.adminEditSubmittedScore(0,format);
   const current=await read(x);assert.equal(current.context.closed,true);assert.equal(current.context.revision,1);
   assert.deepEqual(current.state.history,x.state.history);assert.deepEqual(current.state.sideGame,x.state.sideGame);
   assert.equal(current.state.players.filter(p=>p.paid).length,x.state.players.filter(p=>p.paid).length);
   assert.equal(format==='net'?current.state.players[0].noReturn:current.state.players[0].stableford,format==='net'?true:34);count++;
   if(format==='net'){c.appPrompt=async()=> '68';await c.adminEditSubmittedScore(0,'net');assert.equal((await read(x)).state.players[0].netScore,68);count++;}
   const before=await read(x),late=structuredClone(before.state);late.players.at(-1).paid=true;
   await reject(()=>write(x,before,'correct',late),/PROTECTED_FIELDS/);
   const changed=structuredClone(before.state);changed.players[0][format==='net'?'netScore':'stableford']=format==='net'?69:35;
   await reject(()=>write(x,before,'save',changed),/CORRECTION_REQUIRES/);
   await reject(()=>write(x,before,'correct',changed,randomUUID(),randomBytes(32).toString('hex')),/CREDENTIAL/);
   const other=await seed('other-'+format,{format});await reject(()=>write(x,before,'correct',changed,randomUUID(),other.token),/CREDENTIAL/);
   const scopeToken=randomBytes(32).toString('hex');
   await db.query("SELECT iig_closed_entry.provision($1,$2,clock_timestamp()+interval '1 day',ARRAY['start','finish'])",[x.g,scopeToken]);
   await reject(()=>write(x,before,'correct',changed,randomUUID(),scopeToken),/CREDENTIAL/);
   const invalid=structuredClone(changed);invalid.players[0][format==='net'?'netScore':'stableford']=1.2;
   await reject(()=>write(x,before,'correct',invalid),/INVALID_CORRECTED_SCORE/);
   const ineligible=structuredClone(before.state);Object.assign(ineligible.players.at(-1),{stableford:30,noReturn:false,scoreSubmitted:true});
   await reject(()=>write(x,before,'correct',ineligible),/EXISTING_SUBMITTED_SCORE/);
   const erased=structuredClone(before.state);Object.assign(erased.players[0],{stableford:null,netScore:null,noReturn:false,scoreSubmitted:false});
   await reject(()=>write(x,before,'correct',erased),/EXISTING_SUBMITTED_SCORE/);
  }
  for(const [i,options] of [{trip:true,pair:'betterball'},{trip:true,pair:'pairsaggregate'}, {trip:true,pair:'pairsaggregate',format:'net'}].entries()){
   const x=await seed('pair-'+i,options),b=bridge(x),state=(await b.db.rpc('get_group_state',{p_pin:x.g})).data;
   const c=context(state,b,{pin:x.g,answer:'42'});vm.runInContext(extract('editTripTeamScore'),c);await c.editTripTeamScore('ab');
   const after=await read(x);assert.equal(after.state.trip.currentTeamScores.ab,42);assert.equal(after.context.closed,true);
   assert.deepEqual({...after.state.trip,currentTeamScores:null},{...x.state.trip,currentTeamScores:null});count++;
   const unscore=structuredClone(after.state);unscore.trip.currentTeamScores.ab=null;
   await reject(()=>write(x,after,'correct',unscore),/INVALID_PAIR_CORRECTION/);
   const remove=structuredClone(after.state);delete remove.trip.currentTeamScores.cd;
   await reject(()=>write(x,after,'correct',remove),/TEAM_KEYS/);
   const added=structuredClone(after.state);added.trip.currentTeamScores.fake=45;
   await reject(()=>write(x,after,'correct',added),/TEAM_KEYS/);
  }
  const cancel=await seed('cancel'),b=bridge(cancel),before=await read(cancel),loaded=(await b.db.rpc('get_group_state',{p_pin:cancel.g})).data;
  const c=context(loaded,b,{pin:cancel.g});vm.runInContext(extract('cancelCurrentRound'),c);await c.cancelCurrentRound();
  const cancelled=await read(cancel);assert.equal(cancelled.context.phase,'finished');assert.equal(cancelled.context.closed,true);
  assert.deepEqual(cancelled.state.history,before.state.history);assert.deepEqual(cancelled.state.sideGame,before.state.sideGame);
  assert.deepEqual((await db.query('SELECT state FROM iig_closed_entry.archives WHERE group_id=$1',[cancel.g])).rows[0].state,before.state);
  assert.equal(cancelled.state.players.filter(p=>p.paid).length,0);count++;
  await reject(()=>write(cancel,before,'save',before.state),/STALE/);
  await reject(()=>write(cancel,cancelled,'cancel',before.state),/NO_OPEN_ROUND/);
  const trip=await seed('trip-cancel',{trip:true}),tb=await read(trip),tstate=structuredClone(cancelled.state);
  await reject(()=>write(trip,tb,'cancel',tstate),/TRIP_CANCELLATION/);
  const receipt=await seed('lost-cancel'),rb=bridge(receipt),rs=(await rb.db.rpc('get_group_state',{p_pin:receipt.g})).data;
  const cc=context(rs,rb,{pin:receipt.g});vm.runInContext(extract('cancelCurrentRound'),cc);
  // Produce the exact source cancellation payload, then simulate a committed RPC
  // whose ACK is lost, and reconcile without a second cancellation write.
  let proposal;cc.save=async()=>{proposal=structuredClone(cc.state);return true;};await cc.cancelCurrentRound();
  const once=randomUUID();let sends=0;
  const lost=guard.create({rpc:async(n,a)=>{const out=await rpc(n,a);if(n==='iig_entry_write'){sends++;throw Error('ACK_LOST');}return out;}},{uuid:()=>once,promptCredential:async()=>receipt.token});
  const lostState=(await lost.db.rpc('get_group_state',{p_pin:receipt.g})).data,lc=lost.capture(lostState,receipt.g);Object.assign(lostState,proposal);
  assert.ok((await lost.commit('cancel',receipt.g,proposal,lc,lostState)).error);const inv=await inventory();
  assert.equal((await lost.recover()).error,null);assert.equal(sends,1);assert.deepEqual(await inventory(),inv);count++;
  const fault=await seed('fault-cancel'),f=await read(fault);await db.query('INSERT INTO fictional.faults VALUES($1)',[fault.g]);
  await reject(()=>write(fault,f,'cancel',proposal),/FICTIONAL_FAILURE/);
  const broken=await seed('corrupt-history'),bh=await read(broken),bad=structuredClone(proposal);bad.history=[];
  await reject(()=>write(broken,bh,'cancel',bad),/INVALID_CANCELLATION/);
  const stale=await seed('stale-correct'),s0=await read(stale),s1=structuredClone(s0.state);s1.players[0].stableford=30;
  const request=randomUUID();assert.equal((await write(stale,s0,'correct',s1,request)).error,null);count++;
  const replayBefore=await inventory();assert.equal((await write(stale,s0,'correct',s1,request)).data.replayed,true);assert.deepEqual(await inventory(),replayBefore);count++;
  await reject(()=>write(stale,s0,'correct',s1),/STALE/);
  await db.query('SELECT iig_closed_entry.revoke($1,$2)',[stale.g,stale.token]);
  await reject(()=>write(stale,s0,'correct',s1,request),/CREDENTIAL/);
  await reject(()=>rpc('iig_entry_receipt',{p_pin:stale.g,p_group:stale.g,p_request:request,p_credential:stale.token}),/CREDENTIAL/);
  // Correction must preserve legitimate finishing, payouts, League and history.
  const fin=await seed('after-correction'),fin0=await read(fin),finState=structuredClone(fin0.state);finState.players[0].stableford=36;
  assert.equal((await write(fin,fin0,'correct',finState)).error,null);
  const fin1=await read(fin),finished=await originalFinish(fin1.state);assert.equal((await write(fin,fin1,'finish',finished)).error,null);count++;
  const settings=await seed('settings'),sb=bridge(settings),ss=(await sb.db.rpc('get_group_state',{p_pin:settings.g})).data;
  const sc=context(ss,sb,{pin:settings.g,prompt:()=> 'Fictional Golfers',changeAdminPinModal:async()=> '1846',showAppToast(){}});
  vm.runInContext(extract('changeGroupName'),sc);vm.runInContext(extract('changeAdminPin'),sc);
  await sc.changeGroupName();await sc.changeAdminPin();
  const setAfter=await read(settings);assert.equal(setAfter.state.groupName,'Fictional Golfers');assert.equal(setAfter.state.adminPin,'1846');
  assert.equal(setAfter.context.closed,true);assert.deepEqual(setAfter.state.players,settings.state.players);assert.deepEqual(setAfter.state.history,settings.state.history);count++;
  for(const patch of [{stake:0},{history:[]},{players:[]},{adminPin:'123'},{groupName:''},{groupName:'x'.repeat(81)}]){
   const altered={...setAfter.state,...patch};await reject(()=>write(settings,setAfter,'settings',altered),/SETTINGS_CHANGED|INVALID_/);
  }
  const setCancelled=structuredClone(proposal);setCancelled.groupName=setAfter.state.groupName;setCancelled.adminPin=setAfter.state.adminPin;
  assert.equal((await write(settings,setAfter,'cancel',setCancelled)).error,null);
  const setFinished=await read(settings);const renamed={...setFinished.state,groupName:'Finished fictional group'};
  assert.equal((await write(settings,setFinished,'settings',renamed)).error,null);count++;
  const noManage=randomBytes(32).toString('hex');await db.query("SELECT iig_closed_entry.provision($1,$2,clock_timestamp()+interval '1 day',ARRAY['finish','start'])",[settings.g,noManage]);
  const newest=await read(settings);await reject(()=>write(settings,newest,'settings',{...newest.state,adminPin:'9999'},randomUUID(),noManage),/CREDENTIAL/);
  // Operator-only compare-and-swap replacement: no self-service issuance by
  // group PIN, Admin flag, token hash possession or API role.
  const recovery=await seed('operator-recovery'),oldHash=(await db.query('SELECT iig_closed_entry.token_hash($1) h',[recovery.token])).rows[0].h;
  const newToken=randomBytes(32).toString('hex');
  for(const role of ['anon','authenticated','service_role']){
   await db.exec('SET SESSION AUTHORIZATION '+role);
   await assert.rejects(()=>db.query("SELECT iig_closed_entry.replace_credentials($1,$2,$3,clock_timestamp()+interval '1 day',ARRAY['finish','start'])",[recovery.g,[oldHash],newToken]),/permission denied/);
   await db.exec('SET SESSION AUTHORIZATION postgres');count++;
  }
  const capBefore=await inventory();
  await assert.rejects(()=>db.query("SELECT iig_closed_entry.replace_credentials($1,ARRAY[]::text[],$2,clock_timestamp()+interval '1 day',ARRAY['finish','start'])",[recovery.g,newToken]),/CREDENTIAL_SET_CHANGED/);
  assert.deepEqual(await inventory(),capBefore);count++;
  await assert.rejects(()=>db.query("SELECT iig_closed_entry.replace_credentials($1,$2,$3,clock_timestamp()+interval '91 days',ARRAY['finish','start'])",[recovery.g,[oldHash],newToken]),/INVALID_CREDENTIAL/);
  assert.deepEqual(await inventory(),capBefore);count++;
  await assert.rejects(()=>db.query("SELECT iig_closed_entry.replace_credentials($1,$2,$3,clock_timestamp()+interval '1 day',ARRAY['all'])",[recovery.g,[oldHash],newToken]),/check constraint/);
  assert.deepEqual(await inventory(),capBefore);count++;
  await db.query("SELECT iig_closed_entry.replace_credentials($1,$2,$3,clock_timestamp()+interval '1 day',ARRAY['finish','start','correct','cancel','settings'])",[recovery.g,[oldHash],newToken]);
  assert.equal((await rpc('iig_entry_check_credential',{p_pin:recovery.g,p_group:recovery.g,p_credential:newToken})).data,true);
  assert.match((await rpc('iig_entry_check_credential',{p_pin:recovery.g,p_group:recovery.g,p_credential:recovery.token})).error.message,/CREDENTIAL/);
  assert.equal((await db.query('SELECT count(*)::int n FROM iig_closed_entry.credentials WHERE group_id=$1',[recovery.g])).rows[0].n,2);count++;
  const newHash=(await db.query('SELECT iig_closed_entry.token_hash($1) h',[newToken])).rows[0].h,rotated=await inventory();
  await assert.rejects(()=>db.query("SELECT iig_closed_entry.replace_credentials($1,$2,$3,clock_timestamp()+interval '1 day',ARRAY['finish','start'])",[recovery.g,[newHash],newToken]),/duplicate key/);
  assert.deepEqual(await inventory(),rotated);count++;
  console.log(`PASS: ${count} protected maintenance checks; actual app correction/cancel/settings routes, credential replacement, frozen entrants, pair variants, archive preservation, stale saves, lost ACK, revoked replay and downstream rollback. Fictional embedded DB only.`);
 }finally{await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
