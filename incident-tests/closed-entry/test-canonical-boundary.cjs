// Fresh local fictional DB ONLY. Tests candidate SQL on ONE canonical public row;
// no legacy projection mirror, lab principals or online Supabase project.
const fs=require('node:fs'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite');
const {fixture,originalFinish,originalSetup,leagueMoney,extract}=require('./test-source-finish.cjs');
const guard=require('../../app/entry-guard-client.js');
const {randomUUID,randomBytes}=require('node:crypto');
(async()=>{
 const db=new PGlite();let count=0;const TEST='nyavvwrsrxqfyhiygkgw';
 try{
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
   CREATE TABLE public.tens_in_groups(id text PRIMARY KEY,fixture_pin text UNIQUE NOT NULL,group_name text,state jsonb NOT NULL,updated_at timestamptz DEFAULT now());
   ALTER TABLE public.tens_in_groups ENABLE ROW LEVEL SECURITY;REVOKE ALL ON public.tens_in_groups FROM PUBLIC,anon,authenticated;GRANT SELECT,UPDATE ON public.tens_in_groups TO service_role;
   CREATE SCHEMA fixture_notifications;
   CREATE TABLE fixture_notifications.events(group_id text PRIMARY KEY,updates integer NOT NULL,round_open boolean);
   CREATE TABLE fixture_notifications.faults(group_id text PRIMARY KEY);
   CREATE FUNCTION fixture_notifications.hook() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
   BEGIN IF EXISTS(SELECT 1 FROM fixture_notifications.faults WHERE group_id=NEW.id) THEN RAISE EXCEPTION 'FIXTURE_NOTIFICATION_FAILURE';END IF;
    INSERT INTO fixture_notifications.events VALUES(NEW.id,1,NEW.state->'roundOpen'='true'::jsonb)
    ON CONFLICT(group_id) DO UPDATE SET updates=fixture_notifications.events.updates+1,round_open=excluded.round_open;RETURN NEW;END $$;
   CREATE TRIGGER unchanged_after_hook AFTER UPDATE ON public.tens_in_groups FOR EACH ROW EXECUTE FUNCTION fixture_notifications.hook();
   CREATE FUNCTION public.save_group_state(p_pin text,p_state jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
   BEGIN UPDATE public.tens_in_groups SET state=p_state WHERE fixture_pin=p_pin;RETURN FOUND;END $$;
   REVOKE ALL ON FUNCTION public.save_group_state(text,jsonb) FROM PUBLIC;GRANT EXECUTE ON FUNCTION public.save_group_state(text,jsonb) TO anon;`);
  const hookBefore=(await db.query("SELECT pg_get_functiondef('fixture_notifications.hook()'::regprocedure) AS definition")).rows[0].definition;
  for(const file of ['core.sql','validators.sql','boundary.sql'])await db.exec(fs.readFileSync(__dirname+'/../../supabase/closed-entry-candidate/'+file,'utf8'));
  const raw={rpc:async(name,a)=>{
   await db.exec('SET SESSION AUTHORIZATION anon');try{
    const calls={
     iig_entry_read:['SELECT public.iig_entry_read($1) AS data',[a.p_pin]],
     iig_entry_check_credential:['SELECT public.iig_entry_check_credential($1,$2,$3) AS data',[a.p_pin,a.p_group,a.p_credential]],
     iig_entry_write:['SELECT public.iig_entry_write($1,$2,$3,$4,$5,$6,$7,$8) AS data',[a.p_pin,a.p_group,a.p_round,a.p_revision,a.p_operation,a.p_state,a.p_credential,a.p_request]],
     iig_entry_receipt:['SELECT public.iig_entry_receipt($1,$2,$3,$4) AS data',[a.p_pin,a.p_group,a.p_request,a.p_credential]],
     save_group_state:['SELECT public.save_group_state($1,$2) AS data',[a.p_pin,a.p_state]]};
    const [q,p]=calls[name];return {data:(await db.query(q,p)).rows[0].data,error:null};
   }catch(e){return {data:null,error:{message:e.message}};}finally{await db.exec('RESET ROLE;SET SESSION AUTHORIZATION postgres;RESET ROLE');}
  }};
  async function seed(g,options={},unscored=false,initial=null){
   const s=fixture({game:'money',format:'stableford',...options});if(unscored)s.players.forEach(p=>{p.stableford=null;p.netScore=null;p.noReturn=false;p.scoreSubmitted=false;});
   if(initial)Object.assign(s,initial);
   await db.query('INSERT INTO public.tens_in_groups(id,fixture_pin,group_name,state) VALUES($1,$1,$1,$2)',[g,s]);
   const token=randomBytes(32).toString('hex');await db.query("SELECT iig_closed_entry.provision($1,$2,clock_timestamp()+interval '30 days',ARRAY['finish','start'])",[g,token]);
   return {g,s,token};
  }
  async function read(g){const r=await raw.rpc('iig_entry_read',{p_pin:g});assert.equal(r.error,null);return r.data;}
  async function write(x,c,op,state,id=randomUUID(),token=x.token){return raw.rpc('iig_entry_write',{p_pin:x.g,p_group:x.g,p_round:c.roundId,p_revision:c.revision,p_operation:op,p_state:state,p_credential:token,p_request:id});}
  async function inventory(){const out={};for(const t of ['public.tens_in_groups','iig_closed_entry.rounds','iig_closed_entry.receipts','iig_closed_entry.archives','iig_closed_entry.permits','iig_closed_entry.credentials','fixture_notifications.events'])out[t]=(await db.query(`SELECT to_jsonb(t) AS row FROM ${t} t ORDER BY to_jsonb(t)::text`)).rows;return out;}
  async function reject(fn,pattern){const before=await inventory();const r=await fn();assert.match(r.error?.message||'',pattern);assert.deepEqual(await inventory(),before);count++;}
  const x=await seed('incident',{},true);
  await reject(()=>raw.rpc('iig_entry_read',{p_pin:x.g}),/PIN_RESOLVER_NOT_BOUND/);
  await db.exec(`CREATE FUNCTION public.get_group_state(p_pin text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT state FROM public.tens_in_groups WHERE fixture_pin=p_pin $$;`);
  // Derive the fixture resolver through the SAME offline binder used for saved
  // evidence; no hand-written PIN/hash assumption in the candidate itself.
  const getter=(await db.query("SELECT pg_get_functiondef('public.get_group_state(text)'::regprocedure) AS definition")).rows[0].definition;
  const payload=[{schema:'public',name:'get_group_state',arguments:'p_pin text',return:'jsonb',owner:'postgres',security_definer:true,configuration:['search_path=pg_catalog'],definition:getter},
   {schema:'public',name:'tens_in_groups',columns:[{name:'id',type:'text'},{name:'state',type:'jsonb'}]}];
  const os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'iig-pin-fixture-'));fs.chmodSync(folder,0o700);
  try{
   const file=path.join(folder,'fixture.json');fs.writeFileSync(file,JSON.stringify(payload),{mode:0o600});
   const bound=spawnSync('python3',['-B','-c',"import sys,json;sys.path.insert(0,sys.argv[1]);import prepare_pin_binding as p;print(p.build(*json.load(open(sys.argv[2])))[0])",path.resolve(__dirname,'../../tools/closed-entry-inspection'),file],{encoding:'utf8',timeout:10000});
   assert.equal(bound.status,0,bound.stderr);await db.exec(bound.stdout);count++;
  }finally{fs.rmSync(folder,{recursive:true,force:true});}
  let c=await read(x.g);const score=structuredClone(x.s);score.players[0].stableford=32;score.players[0].scoreSubmitted=true;
  const ack=await write(x,c.context,'save',score);assert.equal(ack.error,null);assert.equal(ack.data.closed,true);count++;
  c=await read(x.g);const late=structuredClone(c.state);late.players[3].paid=true;
  await reject(()=>write(x,c.context,'save',late),/ENTRIES_CLOSED/);
  await reject(()=>raw.rpc('save_group_state',{p_pin:x.g,p_state:late}),/VERSIONED_WRITE_REQUIRED/);
  await db.exec('SET SESSION AUTHORIZATION service_role');
  await assert.rejects(()=>db.query('UPDATE public.tens_in_groups SET state=$1 WHERE id=$2',[late,x.g]),/VERSIONED_WRITE_REQUIRED/);
  await db.exec('SET SESSION AUTHORIZATION postgres');count++;
  const second=structuredClone(c.state);second.players[1].stableford=30;second.players[1].scoreSubmitted=true;
  assert.equal((await write(x,c.context,'save',second)).error,null);count++;
  await reject(()=>write(x,c.context,'save',late),/STALE/);
  await db.exec("SET iig.is_admin='true'");await reject(()=>raw.rpc('save_group_state',{p_pin:x.g,p_state:late}),/VERSIONED_WRITE_REQUIRED/);
  for(const [i,options] of [{},{game:'points',format:'net'},{trip:true},{trip:true,last:true},{trip:true,last:true,pair:'betterball'}].entries()){
   const g=await seed('source-'+i,options),before=await read(g.g),after=await originalFinish(before.state),id=randomUUID();
   const finished=await write(g,before.context,'finish',after,id);assert.equal(finished.error,null,finished.error?.message);
   const persisted=await read(g.g);assert.deepEqual(persisted.state,after);assert.deepEqual(leagueMoney(persisted.state),leagueMoney(after));count++;
   const snap=await inventory();assert.equal((await write(g,before.context,'finish',after,id)).data.replayed,true);assert.deepEqual(await inventory(),snap);count++;
   const setup=await originalSetup(after,g.s.pointsCompetition);const started=await write(g,persisted.context,'start',setup);assert.equal(started.error,null,started.error?.message);
   const current=await read(g.g);assert.equal(current.context.revision,2);assert.notEqual(current.context.roundId,before.context.roundId);
   const expected=structuredClone(setup);expected.roundId=started.data.applicationRoundId;assert.deepEqual(current.state,expected);count++;
   await reject(()=>write(g,persisted.context,'save',after),/STALE/);
  }
  const fault=await seed('fault');const f=await read(fault.g),finished=await originalFinish(f.state);
  await db.query('INSERT INTO fixture_notifications.faults VALUES($1)',[fault.g]);
  await reject(()=>write(fault,f.context,'finish',finished),/FIXTURE_NOTIFICATION_FAILURE/);
  const finalReceipt=await seed('receipt-failure');const rf=await read(finalReceipt.g),proposed=await originalFinish(rf.state);
  await db.exec(`CREATE FUNCTION fixture_notifications.receipt_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.group_id='receipt-failure' THEN RAISE EXCEPTION 'FIXTURE_RECEIPT_FAILURE';END IF;RETURN NEW;END $$;
   CREATE TRIGGER receipt_failure BEFORE INSERT ON iig_closed_entry.receipts FOR EACH ROW EXECUTE FUNCTION fixture_notifications.receipt_failure();`);
  await reject(()=>write(finalReceipt,rf.context,'finish',proposed),/FIXTURE_RECEIPT_FAILURE/);
  // Bind the actual app adapter to these candidate RPCs, not a fixture-only client.
  const appGroup=await seed('app');let discard=false,sends=0;
  const transport={rpc:async(n,a)=>{const r=await raw.rpc(n,a);if(n==='iig_entry_write'){sends++;if(discard)throw Error('ACK_LOST');}return r;}};
  const app=guard.create(transport,{uuid:randomUUID,promptCredential:async()=>appGroup.token});
  const appRead=await app.db.rpc('get_group_state',{p_pin:appGroup.g});assert.equal(appRead.error,null);
  const appAfter=await originalFinish(appRead.data);Object.assign(appRead.data,appAfter);
  const captured=app.capture(appRead.data,appGroup.g);discard=true;
  assert.ok((await app.commit('finish',appGroup.g,structuredClone(appRead.data),captured,appRead.data)).error);assert.equal(app.hasPending(),true);count++;
  const recovered=await app.recover();assert.equal(recovered.error,null);assert.deepEqual(recovered.data,appAfter);assert.equal(sends,1);count++;
  for(const [j,options] of [{},{game:'points',format:'net'},{trip:true},{trip:true,last:true,pair:'betterball'}].entries()){
   const routed=await seed('routed-'+j,options);
   const bridge=guard.create(raw,{uuid:randomUUID,promptCredential:async()=>routed.token});
   const loaded=await bridge.db.rpc('get_group_state',{p_pin:routed.g});const operations=[];
   const actualAfter=await originalFinish(loaded.data,{bridge,pin:routed.g,operations});
   assert.deepEqual(operations,['finish']);
   const actualPersisted=await bridge.db.rpc('get_group_state',{p_pin:routed.g});assert.deepEqual(actualPersisted.data,actualAfter);count++;
   const actualSetup=await originalSetup(actualPersisted.data,routed.s.pointsCompetition,{bridge,pin:routed.g,operations});
   assert.deepEqual(operations,['finish','start']);
   assert.deepEqual((await read(routed.g)).state,actualSetup);count++;
  }
  const stale=structuredClone(appAfter);stale.players[3].paid=true;
  assert.ok((await app.db.rpc('save_group_state',{p_pin:appGroup.g,p_state:stale})).error);assert.equal(sends,1);count++;
  const initial=fixture({game:'money',format:'stableford'});initial.players.forEach(p=>{p.paid=false;p.playingThisRound=false;p.stableford=null;p.netScore=null;p.noReturn=false;p.scoreSubmitted=false;});
  const first=await seed('first-round',{},false,{...initial,course:'',date:'',history:[],roundOpen:false,paymentLink:'https://fictional.invalid/pay'});
  const fb=guard.create(raw,{uuid:randomUUID,promptCredential:async()=>first.token});
  const freshFirst=(await fb.db.rpc('get_group_state',{p_pin:first.g})).data;
  const vm=require('node:vm');const fields={firstRoundCourse:{value:'First Fictional Course'},firstRoundDate:{value:'2099-11-05'},firstRoundCompetition:{value:'stableford'},firstRoundStake:{value:'10'},firstRoundSplitPrizes:{checked:false},firstRoundSecondPrize:{value:''},firstRoundThirdPrize:{value:''}};
  const ctx={state:freshFirst,db:fb.db,pin:first.g,isAdmin:true,iigEntryBridge:fb,saveActive:false,savePending:0,saveQueue:Promise.resolve(),stateSaveVersion:0,
   Date,JSON,Number,Boolean,String,Object,Array,Promise,createRoundId:randomUUID,demoReadOnly:()=>false,$:id=>fields[id]||{textContent:''},render(){},alert(m){throw Error(m);}};
  vm.createContext(ctx);vm.runInContext(extract('save'),ctx);vm.runInContext(extract('setupFirstRound'),ctx);
  await ctx.setupFirstRound();const firstPersisted=await read(first.g);
  assert.equal(firstPersisted.context.phase,'open');assert.equal(firstPersisted.context.revision,1);assert.equal(firstPersisted.state.course,'First Fictional Course');count++;
  const queued=await seed('queued',{},true);const qb=guard.create(raw,{uuid:randomUUID,promptCredential:async()=>queued.token});
  const qa=(await qb.db.rpc('get_group_state',{p_pin:queued.g})).data;
  const qz=(await qb.db.rpc('get_group_state',{p_pin:queued.g})).data;
  const ca=qb.capture(qa,queued.g),cz=qb.capture(qz,queued.g);
  qa.players[0].stableford=31;qa.players[0].scoreSubmitted=true;qz.players[3].paid=true;
  assert.equal((await qb.commit('save',queued.g,structuredClone(qa),ca,qa)).error,null);
  const queuedBefore=await inventory();assert.ok((await qb.commit('save',queued.g,structuredClone(qz),cz,qz)).error);
  assert.deepEqual(await inventory(),queuedBefore);count++;
  const lockedView=(await qb.db.rpc('get_group_state',{p_pin:queued.g})).data;
  lockedView.players.forEach(p=>{p.stableford=null;p.netScore=null;p.noReturn=false;});
  const ui={state:lockedView,pin:queued.g,iigEntryBridge:qb,Object,String};
  vm.createContext(ui);for(const name of ['roundLocked','roundOpenNow','entryClosed'])vm.runInContext(extract(name),ui);
  assert.equal(ui.entryClosed(),true);count++;
  const paymentView=(await qb.db.rpc('get_group_state',{p_pin:queued.g})).data;paymentView.players[3].paid=true;
  const paymentContext={state:paymentView,db:qb.db,pin:queued.g,iigEntryBridge:qb,Date,JSON,Promise,
   saveActive:false,savePending:0,saveQueue:Promise.resolve(),stateSaveVersion:0,demoReadOnly:()=>false,$:()=>({textContent:''}),render(){}};
  vm.createContext(paymentContext);vm.runInContext(extract('save'),paymentContext);
  const paymentBefore=await inventory();assert.equal(await paymentContext.save(),false);
  assert.equal(paymentContext.state.players[3].paid,false);assert.deepEqual(await inventory(),paymentBefore);count++;
  const foreign=await seed('foreign');const fc=await read(foreign.g);
  const foreignProposal=await originalFinish(fc.state);
  await reject(()=>write(foreign,fc.context,'finish',foreignProposal,randomUUID(),x.token),/ORGANISER_CREDENTIAL_REQUIRED/);
  assert.equal(guard.validateBuild(undefined,{},'https://fixture.invalid'),false);
  assert.throws(()=>guard.validateBuild({mode:'test-only',projectRef:TEST,origin:'https://fixture.invalid'},{supabaseUrl:'https://kzzzputsqxdntfqpprnz.supabase.co'},'https://fixture.invalid'),/GUARDED_TEST_CONFIG_REQUIRED/);count++;
  assert.equal(guard.validateBuild({mode:'test-only',projectRef:TEST,origin:'https://fixture.invalid'},{supabaseUrl:'https://'+TEST+'.supabase.co'},'https://fixture.invalid'),true);count++;
  await db.exec('SET SESSION AUTHORIZATION anon');await assert.rejects(()=>db.exec('SELECT * FROM iig_closed_entry.credentials'),/permission denied/);await db.exec('SET SESSION AUTHORIZATION postgres');count++;
  const secured=await seed('revoked');const sc=await read(secured.g),sp=await originalFinish(sc.state),nonce=randomUUID();
  assert.equal((await write(secured,sc.context,'finish',sp,nonce)).error,null);
  await db.query('SELECT iig_closed_entry.revoke($1,$2)',[secured.g,secured.token]);
  await reject(()=>write(secured,sc.context,'finish',sp,nonce),/ORGANISER_CREDENTIAL_REQUIRED/);
  await reject(()=>raw.rpc('iig_entry_receipt',{p_pin:secured.g,p_group:secured.g,p_request:nonce,p_credential:secured.token}),/ORGANISER_CREDENTIAL_REQUIRED/);
  const stored=(await db.query('SELECT token_hash FROM iig_closed_entry.credentials WHERE group_id=$1',[secured.g])).rows[0].token_hash;
  assert.notEqual(stored,secured.token);count++;
  await db.exec('SET SESSION AUTHORIZATION anon');await assert.rejects(()=>db.query("SELECT iig_closed_entry.provision('revoked',$1,clock_timestamp()+interval '30 days',ARRAY['finish'])",[secured.token]),/permission denied/);await db.exec('SET SESSION AUTHORIZATION postgres');count++;
  const hookAfter=(await db.query("SELECT pg_get_functiondef('fixture_notifications.hook()'::regprocedure) AS definition")).rows[0].definition;assert.equal(hookAfter,hookBefore);count++;
  for(const [snapshot,expected] of [
   [{course:'',date:'',players:[],history:[]},false],
   [{roundOpen:null,course:'',date:'',players:[],history:[]},false],
   [{course:'Legacy',date:'2099-01-01',players:[{paid:true,stableford:0}],history:[]},true],
   [{course:'Legacy',date:'2099-01-01',players:[{paid:false,stableford:null,netScore:null}],history:[{course:'Legacy',date:'2099-01-01'}]},false],
   [{roundOpen:true,players:[],trip:{active:false,completed:true}},false]
  ]){assert.equal((await db.query('SELECT iig_closed_entry.round_is_open($1) AS value',[snapshot])).rows[0].value,expected);count++;}
  // Post-runtime fallback must fail closed, retaining populated security data.
  const retained=await inventory();await db.exec('REVOKE EXECUTE ON FUNCTION public.iig_entry_write(text,text,uuid,bigint,text,jsonb,text,uuid) FROM anon,authenticated');
  await reject(()=>raw.rpc('save_group_state',{p_pin:x.g,p_state:late}),/VERSIONED_WRITE_REQUIRED/);
  const retired=await write(foreign,fc.context,'finish',foreignProposal);assert.match(retired.error.message,/permission denied/);assert.deepEqual(await inventory(),retained);count++;
  console.log(`PASS: ${count} canonical-row candidate checks: central guard, legacy/direct bypass denial, source Finish/Trip/setup, actual app adapter, TEST-only gate, lost ACK, private credentials, notification/receipt rollback. Resolver fixture-only; production validation/coverage gates remain open.`);
 }finally{await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
