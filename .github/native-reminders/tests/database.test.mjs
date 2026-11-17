import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const root=new URL('../',import.meta.url);
test('native reminder database contract',async t=>{
 const db=new PGlite();
 const q=(sql,args=[])=>db.query(sql,args), v=async(sql,args=[])=>(await q(sql,args)).rows[0]?.v;
 const rpc=async(user,session,name,args=[],role='authenticated')=>{
  await q("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:user,session_id:session})]);
  await db.exec('set role '+role);
  try{return await v('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') v',args);}finally{await db.exec('reset role');}
 };
 const worker=(name,args=[])=>rpc(null,null,name,args,'service_role');
 const user=async(verified=true)=>{const id=randomUUID(),sid=randomUUID();await q('insert into auth.users(id,email,email_confirmed_at) values($1,$2,$3)',[id,id+'@example.test',verified?new Date():null]);await q('insert into auth.sessions(id,user_id) values($1,$2)',[sid,id]);return{id,sid};};
 const fid='synthetic-phone-1234567890';
 let seq=0;
 const event=async(type='competition_created',opts={})=>{
  const id=randomUUID();await q("insert into public.iig_notification_events(id,group_pin,round_key,event_type,message,scheduled_for,status) values($1,$2,$3,$4,'Synthetic reminder',now()+($5||' minutes')::interval,$6)",[id,opts.pin||'7771',opts.round||'2099-11-21|test '+(++seq)+'|0',type,opts.minutes??0,opts.status||'pending']);
  if(!opts.keepRound)await q("update public.tens_in_groups set state=jsonb_set(state,'{course}',to_jsonb($1::text)) where group_pin=$2",['Test '+seq,opts.pin||'7771']);
  return id;
 };
 const snapshot=()=>v("select jsonb_build_object('groups',(select jsonb_agg(to_jsonb(g) order by id) from public.tens_in_groups g),'members',(select jsonb_agg(to_jsonb(g)) from iig_private.group_members g),'events',(select jsonb_agg(to_jsonb(g) order by id) from public.iig_notification_events g),'settings',(select jsonb_agg(to_jsonb(g) order by group_pin) from public.iig_notification_settings g)) v");
 try{
  await db.exec(readFileSync(new URL('tests/fixture.sql',root),'utf8'));
  const a=await user(),b=await user(),unverified=await user(false);
  await q("insert into public.tens_in_groups(id,group_name,group_pin,state) values(9001,'Synthetic One','7771',$1),(9002,'Synthetic Two','7772',$1)",[{roundOpen:true,date:'2099-11-21',course:'Test',history:[],paymentLink:'https://example.test/payment',players:[]}]);
  await q("insert into iig_private.group_owners(group_id,request_id,requested_name) values(9001,gen_random_uuid(),'Synthetic One'),(9002,gen_random_uuid(),'Synthetic Two')");
  await q("insert into iig_private.group_members(group_id,user_id) values(9001,$1),(9002,$2)",[a.id,b.id]);
  await q("insert into public.iig_notification_settings(group_pin,enabled) values('7771',true),('7772',true)");
  const before=await snapshot();
  await db.exec(readFileSync(new URL('supabase/migrations/'+readdirSync(new URL('supabase/migrations',root))[0],root),'utf8'));
  await t.test('migration preserves golf, payments, memberships and existing notification records',async()=>assert.deepEqual(await snapshot(),before));
  await t.test('rollout starts dormant; default preference is on',async()=>{
   assert.deepEqual(await rpc(a.id,a.sid,'iig_get_native_reminders',[a.id]),{available:false,enabled:true});
   await assert.rejects(()=>rpc(a.id,a.sid,'iig_register_native_reminders',[fid,a.id]),/not available/);
   assert.deepEqual(await worker('iig_claim_native_reminders'),[]);
  });
  await db.exec("update iig_private.native_reminder_rollout set enabled=true,activated_at=now()-interval '1 day'");
  await t.test('verified membership and current session required; stale account rejected',async()=>{
   await assert.rejects(()=>rpc(unverified.id,unverified.sid,'iig_get_native_reminders',[unverified.id]),/Verified/);
   await assert.rejects(()=>rpc(a.id,b.sid,'iig_get_native_reminders',[a.id]),/Sign in again/);
   await assert.rejects(()=>rpc(a.id,a.sid,'iig_register_native_reminders',[fid,b.id]),/Account changed/);
   const outsider=await user();await assert.rejects(()=>rpc(outsider.id,outsider.sid,'iig_register_native_reminders',[fid,outsider.id]),/Join or create/);
   assert.equal(await rpc(a.id,a.sid,'iig_register_native_reminders',[fid,a.id]),true);
   assert.equal(await v('select count(*)::int v from iig_private.native_reminder_devices'),1);
   await q("update iig_private.native_reminder_devices set created_at=now()-interval '2 hours'");
  });
  await t.test('one current-round delivery per device; legacy cancelled status does not lose native reminder',async()=>{
   const id=await event('competition_created',{status:'cancelled'});
   const claims=await worker('iig_claim_native_reminders');assert.equal(claims.length,1);assert.equal(claims[0].event_id,id);
   assert.deepEqual(await worker('iig_claim_native_reminders'),[]);
   const c=claims[0],body=await worker('iig_authorize_native_reminder',[id,fid,c.claim_id]);assert.equal(body.group_pin,'7771');
   await worker('iig_finish_native_reminder',[id,fid,c.claim_id,'sent',false]);assert.deepEqual(await worker('iig_claim_native_reminders'),[]);
  });
  await t.test('opt-out persists, cannot be undone by registration, blocks an already claimed delivery',async()=>{
   const id=await event('night_before'),[c]=await worker('iig_claim_native_reminders');assert.ok(c);
   assert.equal((await rpc(a.id,a.sid,'iig_set_native_reminders',[false,a.id])).enabled,false);
   assert.equal(await rpc(a.id,a.sid,'iig_register_native_reminders',[fid,a.id]),false);
   assert.equal(await worker('iig_authorize_native_reminder',[id,fid,c.claim_id]),null);
   assert.deepEqual(await worker('iig_claim_native_reminders'),[]);
   await rpc(a.id,a.sid,'iig_set_native_reminders',[true,a.id]);
   assert.deepEqual(await worker('iig_claim_native_reminders'),[]);
  });
  await t.test('three days and night-before types work; first player notification is excluded',async()=>{
   for(const type of ['three_days_before','night_before']){const id=await event(type);const[c]=await worker('iig_claim_native_reminders');assert.equal(c.event_id,id);await worker('iig_finish_native_reminder',[id,fid,c.claim_id,'sent',false]);}
   await event('first_player_joined');assert.deepEqual(await worker('iig_claim_native_reminders'),[]);
  });
  await t.test('not-due, old, pre-registration and replaced-round events are excluded',async()=>{
   await event('night_before',{minutes:60});assert.deepEqual(await worker('iig_claim_native_reminders'),[]);
   await event('night_before',{minutes:-800});assert.deepEqual(await worker('iig_claim_native_reminders'),[]);
   await event('night_before',{minutes:-180});assert.deepEqual(await worker('iig_claim_native_reminders'),[]);
   await event('night_before',{round:'old|old|0'});assert.deepEqual(await worker('iig_claim_native_reminders'),[]);
  });
  await t.test('group off, closed or retired blocks delivery; outsider cannot receive',async()=>{
   await event('night_before');await q("update public.iig_notification_settings set enabled=false where group_pin='7771'");assert.deepEqual(await worker('iig_claim_native_reminders'),[]);
   await q("update public.iig_notification_settings set enabled=true where group_pin='7771'");
   await q("update public.tens_in_groups set state=jsonb_set(state,'{roundOpen}','false') where id=9001");assert.deepEqual(await worker('iig_claim_native_reminders'),[]);
   await q("update public.tens_in_groups set state=jsonb_set(state,'{roundOpen}','true') where id=9001");
   await q('insert into iig_private.release_groups(group_id,retired_at) values(9001,now())');assert.deepEqual(await worker('iig_claim_native_reminders'),[]);await q('delete from iig_private.release_groups where group_id=9001');
   await event('night_before',{pin:'7772'});const claims=await worker('iig_claim_native_reminders');assert.equal(claims.length,1);assert.equal(claims[0].fid,fid);
  });
  await t.test('changed membership is rechecked immediately before sending',async()=>{
   const id=await event('night_before'),[c]=await worker('iig_claim_native_reminders');assert.ok(c);
   await q('delete from iig_private.group_members where user_id=$1',[a.id]);assert.equal(await worker('iig_authorize_native_reminder',[id,fid,c.claim_id]),null);
   await q('insert into iig_private.group_members(group_id,user_id) values(9001,$1)',[a.id]);
  });
  await t.test('retries rotate claims, reject stale completion and stop after three attempts',async()=>{
   const id=await event('night_before');const[first]=await worker('iig_claim_native_reminders');
   await worker('iig_finish_native_reminder',[id,fid,first.claim_id,'retry',false]);
   const[second]=await worker('iig_claim_native_reminders');assert.notEqual(first.claim_id,second.claim_id);
   await worker('iig_finish_native_reminder',[id,fid,first.claim_id,'sent',false]);
   assert.equal(await v('select status v from iig_private.native_reminder_deliveries where event_id=$1',[id]),'sending');
   await worker('iig_finish_native_reminder',[id,fid,second.claim_id,'retry',false]);const[third]=await worker('iig_claim_native_reminders');
   await worker('iig_finish_native_reminder',[id,fid,third.claim_id,'retry',false]);assert.deepEqual(await worker('iig_claim_native_reminders'),[]);
   assert.equal(await v('select status v from iig_private.native_reminder_deliveries where event_id=$1',[id]),'failed');
  });
  await t.test('sign-out removes the session-bound device and queued deliveries',async()=>{
   await event('night_before');await q('delete from auth.sessions where id=$1',[a.sid]);assert.deepEqual(await worker('iig_claim_native_reminders'),[]);
   assert.equal(await v('select count(*)::int v from iig_private.native_reminder_devices'),0);
  });
  await t.test('API permissions expose no devices or send functions to app users',async()=>{
   for(const role of ['anon','authenticated']){assert.equal(await v("select has_function_privilege($1,'public.iig_claim_native_reminders(integer)','EXECUTE') v",[role]),false);assert.equal(await v("select has_table_privilege($1,'iig_private.native_reminder_devices','SELECT') v",[role]),false);}
   assert.equal(await v("select has_function_privilege('anon','public.iig_get_native_reminders(uuid)','EXECUTE') v"),false);
  });
 }finally{await db.close();}
});
