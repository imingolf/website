const assert=require('node:assert/strict');
const {create}=require('../../app/entry-guard-client.js');
const context={groupId:'fictional',roundId:'server-round',revision:0,phase:'open',closed:false};
const cap='a'.repeat(64);
(async()=>{
 let release,checks=0,writes=0;
 const raw={rpc:async(n)=>{
  if(n==='iig_entry_read')return {data:{context,state:{roundId:'legacy-round',players:[],history:[]}},error:null};
  if(n==='iig_entry_check_credential')return {data:true,error:null};
  writes++;throw Error('Unexpected send');
 }};
 const bridge=create(raw,{uuid:()=> 'fixture-nonce',promptCredential:()=>new Promise(r=>{release=r;})});
 const source=(await bridge.db.rpc('get_group_state',{p_pin:'fictional'})).data;
 const pending=bridge.commit('finish','fictional',structuredClone(source),bridge.capture(source,'fictional'),source);
 bridge.clearCredential();release(cap);
 assert.ok((await pending).error);assert.equal(writes,0);checks++;
 const refreshed=(await bridge.db.rpc('get_group_state',{p_pin:'fictional'})).data;
 const old=bridge.capture(refreshed,'fictional');bridge.clear();
 assert.ok((await bridge.commit('save','fictional',structuredClone(refreshed),old,refreshed)).error);assert.equal(writes,0);checks++;
 class Branded{#value=42;from(){return this.#value;}rpc(){return {data:null,error:null};}}
 const branded=create(new Branded(),{uuid:()=> 'fixture-nonce'});assert.equal(branded.db.from(),42);checks++;
 let rev=0;const prompts=[];
 const cached=create({rpc:async(n,a)=>{
  if(n==='iig_entry_read')return {data:{context:{...context,revision:rev},state:{players:[],history:[]}},error:null};
  if(n==='iig_entry_check_credential')return {data:true,error:null};
  if(n==='iig_entry_check_member')return {data:{playerId:'fictional-player'},error:null};
  if(n==='iig_entry_write')return {data:{...context,revision:++rev,ok:true,replayed:false,requestId:a.p_request},error:null};
  throw Error('Unexpected fake RPC');
 }},{uuid:require('node:crypto').randomUUID,promptCredential:async({kind})=>{prompts.push(kind);return kind==='player'?'b'.repeat(64):cap;}});
 const cachedState=(await cached.db.rpc('get_group_state',{p_pin:'fictional'})).data;
 for(const op of ['settings','claim','settings','claim']){
  cachedState.marker=op+rev;assert.equal((await cached.commit(op,'fictional',structuredClone(cachedState),cached.capture(cachedState,'fictional'),cachedState)).error,null);
 }
 assert.deepEqual(prompts,['organiser','player']);checks++;
 cached.clearCredential();cachedState.marker='after logout';
 assert.equal((await cached.commit('settings','fictional',structuredClone(cachedState),cached.capture(cachedState,'fictional'),cachedState)).error,null);
 assert.deepEqual(prompts,['organiser','player','organiser']);checks++;
 console.log(`PASS: ${checks} actual-adapter session checks: logout invalidates pending credential prompts, group clear blocks old captured writes, Supabase-like private-field methods retain their receiver. No network.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
