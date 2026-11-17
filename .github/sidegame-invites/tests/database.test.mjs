import {test} from 'node:test';import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';import {readFileSync} from 'node:fs';import {randomUUID} from 'node:crypto';
test('Side Game delivery database contract',async t=>{
 const db=new PGlite(),q=(sql,args=[])=>db.query(sql,args),v=async(sql,args=[])=>(await q(sql,args)).rows[0]?.v;
 const rpc=async(user,name,args=[],role='authenticated')=>{
  await q("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:user?.id,session_id:user?.sid})]);await db.exec('set role '+role);
  try{return await v('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') v',args);}finally{await db.exec('reset role');}
 };
 const worker=(name,args)=>rpc(null,name,args,'service_role');
 const user=async()=>{const id=randomUUID(),sid=randomUUID();await q('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[id,id+'@example.test']);await q('insert into auth.sessions(id,user_id) values($1,$2)',[sid,id]);return{id,sid};};
 const fid='synthetic-recipient-phone-12345',senderFid='synthetic-sender-phone-123456';
 try{
  await db.exec(readFileSync(new URL('fixture.sql',import.meta.url),'utf8'));
  await db.exec(readFileSync(new URL('../../native-reminders/supabase/migrations/20261115180536_native_competition_reminders.sql',import.meta.url),'utf8'));
  await db.exec(readFileSync(new URL('../supabase/migrations/20261117090927_side_game_invites.sql',import.meta.url),'utf8'));
  const sender=await user(),recipient=await user(),other=await user(),player1=randomUUID(),player2=randomUUID();
  const day=await v("select to_char(now() at time zone 'Europe/London','YYYY-MM-DD') v");
  let bets=[];
  const state=()=>({players:[{id:player1,name:'Sender'},{id:player2,name:'Recipient'}],sideGame:{bets},roundOpen:false});
  await q("insert into public.tens_in_groups(id,group_name,group_pin,state) values(9001,'Synthetic','7771',$1)",[state()]);
  await q("insert into iig_private.group_owners(group_id,request_id,requested_name) values(9001,gen_random_uuid(),'Synthetic')");
  await q('insert into iig_private.group_members(group_id,user_id,player_id) values(9001,$1,$2),(9001,$3,$4)',[sender.id,player1,recipient.id,player2]);
  const add=async()=>{const id=randomUUID();bets.push({id,date:day,player1Id:player1,player2Id:player2,status:'pending',setup:'challenge'});await q('update public.tens_in_groups set state=$1 where id=9001',[state()]);return id;};
  const claims=()=>worker('iig_claim_side_invites',[20]);
  const auth=c=>worker('iig_authorize_side_invite',[c.event_id,c.fid,c.claim_id]);
  await t.test('disabled rollout and default Off never queue old challenges',async()=>{
   assert.equal((await rpc(recipient,'iig_get_native_reminders',[recipient.id])).sideEnabled,false);
   await add();assert.equal(await v('select count(*)::int v from iig_private.side_invite_events'),0);
   await assert.rejects(()=>rpc(recipient,'iig_set_side_invites',[true,recipient.id]),/not available/);
  });
  await q('update iig_private.side_invite_rollout set pilot_user_ids=$1',[ [recipient.id,sender.id] ]);
  await rpc(recipient,'iig_set_native_reminders',[false,recipient.id]);
  await rpc(recipient,'iig_set_side_invites',[true,recipient.id]);
  await t.test('Side Game registers independently of competition Off, stale identity rejected',async()=>{
   assert.equal(await rpc(recipient,'iig_register_native_reminders',[fid,recipient.id]),true);
   const prefs=await rpc(recipient,'iig_get_native_reminders',[recipient.id]);assert.equal(prefs.enabled,false);assert.equal(prefs.sideEnabled,true);
   await assert.rejects(()=>rpc(sender,'iig_set_side_invites',[true,recipient.id]),/Account changed/);
   assert.deepEqual(await claims(),[]);
  });
  await rpc(sender,'iig_set_side_invites',[true,sender.id]);await rpc(sender,'iig_register_native_reminders',[senderFid,sender.id]);
  await t.test('one recipient phone, never sender or whole group, duplicate authorization blocked',async()=>{
   await add();const list=await claims();assert.equal(list.length,1);assert.equal(list[0].fid,fid);
   assert.deepEqual(await claims(),[]);assert.equal((await auth(list[0])).group_pin,'7771');assert.equal(await auth(list[0]),null);
   await worker('iig_finish_side_invite',[list[0].event_id,fid,list[0].claim_id,'sent']);
   await q('update public.tens_in_groups set state=$1 where id=9001',[state()]);assert.deepEqual(await claims(),[]);
  });
  await t.test('accepted invite cannot send, even after claim',async()=>{
   const id=await add(),[c]=await claims();assert.ok(c);bets.find(b=>b.id===id).status='active';await q('update public.tens_in_groups set state=$1 where id=9001',[state()]);assert.equal(await auth(c),null);
  });
  await t.test('Off immediately blocks a claimed invitation; On does not replay',async()=>{
   await add();const[c]=await claims();await rpc(recipient,'iig_set_side_invites',[false,recipient.id]);assert.equal(await auth(c),null);
   await rpc(recipient,'iig_set_side_invites',[true,recipient.id]);assert.deepEqual(await claims(),[]);
  });
  await t.test('player reassignment cannot transfer a saved invite',async()=>{
   await add();const[c]=await claims();await q('update iig_private.group_members set player_id=$1 where user_id=$2',[randomUUID(),recipient.id]);assert.equal(await auth(c),null);
   await q('update iig_private.group_members set player_id=$1 where user_id=$2',[player2,recipient.id]);
  });
  await t.test('device deletion preserves consumed receipt and cannot duplicate',async()=>{
   await add();const[c]=await claims();await auth(c);await q('delete from iig_private.native_reminder_devices where fid=$1',[fid]);
   assert.equal(await v('select count(*)::int v from iig_private.side_invite_deliveries where event_id=$1',[c.event_id]),1);
   await rpc(recipient,'iig_register_native_reminders',[fid,recipient.id]);assert.deepEqual(await claims(),[]);
  });
  await t.test('expired invite and signed-out session cannot send',async()=>{
   await add();let[c]=await claims();await q("update iig_private.side_invite_events set expires_at=now()-interval '1 second' where id=$1",[c.event_id]);assert.equal(await auth(c),null);
   await add();[c]=await claims();await q('delete from auth.sessions where id=$1',[recipient.sid]);assert.equal(await auth(c),null);
  });
  await t.test('API permissions deny send operations and private tables to app users',async()=>{
   for(const role of ['anon','authenticated']){
    assert.equal(await v("select has_function_privilege($1,'public.iig_claim_side_invites(integer)','EXECUTE') v",[role]),false);
    assert.equal(await v("select has_table_privilege($1,'iig_private.side_invite_events','SELECT') v",[role]),false);
   }
  });
 }finally{await db.close();}
});
