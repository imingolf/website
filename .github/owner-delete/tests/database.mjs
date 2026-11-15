import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const db=new PGlite();
const here=new URL('./',import.meta.url);
const catalog=JSON.parse(readFileSync(new URL('catalog.json',here)));
const guards=JSON.parse(readFileSync(new URL('guards.json',here)));
await db.exec(readFileSync(new URL('fixture.sql',here),'utf8'));
const migration=new URL('../supabase/migrations/'+readdirSync(new URL('../supabase/migrations',here))[0],here);
await db.exec(readFileSync(migration,'utf8'));
let passed=0;
const check=(name,fn)=>Promise.resolve().then(fn).then(()=>{passed++;console.log('PASS '+name)});
const query=(s,p=[])=>db.query(s,p);
const scalar=async(s,p=[])=>(await query(s,p)).rows[0]?.v;
const owner=randomUUID(), ordinary=randomUUID(), member=randomUUID(), ownerSession=randomUUID(), ordinarySession=randomUUID();
await query("insert into auth.users(id,email,email_confirmed_at) select x, x::text||'@example.test',now() from unnest($1::uuid[]) x",[[owner,ordinary,member]]);
await query('insert into auth.sessions(id,user_id) values($1,$2),($3,$4)',[ownerSession,owner,ordinarySession,ordinary]);
await query('insert into iig_private.platform_owners values($1)',[owner]);
async function claims(who=owner,age=0,sid=who===owner?ownerSession:ordinarySession){await query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:who,session_id:sid,amr:[{method:'otp',timestamp:Math.floor(Date.now()/1000)-age}]})]);}
await claims();
async function seed(id,pin,account=null){
 await query("insert into public.tens_in_groups(id,group_name,group_pin,state) values($1,$2,$3,$4)",[id,'Synthetic '+pin,pin,{players:[{id:'player-'+id,name:'Synthetic player'}],history:[{id:'round-'+id}],trip:{pastTrips:[{id:'trip-'+id}]},paymentLink:'https://example.test/payment'}]);
 await query('insert into iig_private.group_owners(group_id,owner_id,request_id,requested_name) values($1,$2,$3,$4)',[id,account,randomUUID(),'Synthetic '+pin]);
 await query('insert into iig_private.group_members(group_id,user_id) values($1,$2)',[id,member]);
 await query('insert into iig_private.player_links(group_id,user_id,player_id) values($1,$2,$3)',[id,member,'player-'+id]);
 await query('insert into iig_private.release_groups(group_id,reason) values($1,$2)',[id,'Synthetic test']);
 await query('insert into iig_private.release_audit(id,group_id,action,evidence) values($1,$1,$2,$3)',[id,'synthetic','Synthetic evidence']);
 await query("insert into iig_private.relink_grants(token_hash,group_id,player_id,email_hash,issued_by,expires_at) values($1,$2,$3,$4,$5,now()+interval '1 day')",['token-'+id,id,'player-'+id,'hash-'+id,owner]);
 await query('insert into public.iig_notification_settings(group_pin) values($1)',[pin]);
 await query('insert into public.iig_push_subscriptions(group_pin,player_id,endpoint,p256dh,auth) values($1,$2,$3,$4,$5)',[pin,'player-'+id,'https://example.test/push/'+id,'test','test']);
 await query("insert into public.iig_notification_events(group_pin,round_key,event_type,message,scheduled_for) values($1,$2,'competition_created','Synthetic',now())",[pin,'round-'+id]);
 await query("insert into iig_closed_entry.rounds(group_id,phase,closed) values($1,'open',false)",[String(id)]);
 await query("insert into iig_closed_entry.credentials(group_id,token_hash,expires_at,scopes) values($1,$2,now()+interval '1 day',array['settings'])",[String(id),'hash-'+id]);
 await query("insert into iig_closed_entry.member_credentials(group_id,player_id,token_hash,expires_at,scopes) values($1,$2,$3,now()+interval '1 day',array['profile'])",[String(id),'player-'+id,'memberhash-'+id]);
 await query("insert into iig_closed_entry.permits values(1,$1,'test','save',0,'hash',false,null)",[String(id)]);
 await query("insert into iig_closed_entry.receipts(group_id,request_id,digest,operation,outcome) values($1,$2,'test','test','{}')",[String(id),randomUUID()]);
 await query("insert into iig_closed_entry.archives values($1,$2,'{}')",[String(id),randomUUID()]);
 await query("insert into iig_closed_entry.operation_audit values($1,0,'test','{}')",[String(id)]);
 await query('insert into iig_closed_entry.identity_ids values($1,$2)',[String(id),'player-'+id]);
}
async function review(pin){return scalar('select public.iig_owner_group_deletion_review($1) v',[pin]);}
async function remove(r,overrides={}){const a={id:r.group_id,pin:r.group_pin,confirmation:'DELETE '+r.group_pin,fingerprint:r.fingerprint,request:randomUUID(),...overrides};return scalar('select public.iig_owner_delete_group($1,$2,$3,$4,$5) v',[a.id,a.pin,a.confirmation,a.fingerprint,a.request]);}
async function fails(fn,pattern){await assert.rejects(fn,pattern);}
await seed(71001,'6412',ordinary);await seed(71002,'6413');await seed(71003,'1010');await seed(71004,'2026');await seed(71005,'6415');
await query("insert into iig_private.subscription_bindings values('synthetic-apple',71005,now()+interval '1 day',now())");
const r=await review('6412');
await check('review counts include players, history, trips and archives',()=>{assert.equal(r.can_delete,true);assert.equal(r.needs_verification,false);assert.equal(r.counts.players,1);assert.equal(r.counts.history_entries,1);assert.equal(r.counts.past_trips,1);assert.equal(r.counts.saved_snapshots,2);assert.equal(r.counts.linked_accounts,2)});
await check('anonymous execution denied',async()=>{await db.exec('set role anon');try{await fails(()=>review('6412'),/permission denied/)}finally{await db.exec('reset role')}});
await check('ordinary organiser denied review and deletion',async()=>{await claims(ordinary);try{await fails(()=>review('6412'),/Platform owner required/);await fails(()=>remove(r),/Platform owner required/)}finally{await claims()}});
await check('revoked session denied',async()=>{await claims(owner,0,randomUUID());try{await fails(()=>review('6412'),/Sign in again/)}finally{await claims()}});
await check('old OTP can review but cannot delete',async()=>{await claims(owner,700);try{assert.equal((await review('6412')).needs_verification,true);await fails(()=>remove(r),/fresh email code/)}finally{await claims()}});
await check('wrong confirmation denied',()=>fails(()=>remove(r,{confirmation:'DELETE 6413'}),/Confirm the selected group/));
await check('wrong group ID cannot delete a reused PIN',()=>fails(()=>remove(r,{id:'71002'}),/Group not found/));
await check('protected groups blocked',async()=>{for(const pin of ['1010','2026']){const p=await review(pin);assert.equal(p.can_delete,false);await fails(()=>remove(p),/protected/)}});
await check('Apple subscription group blocked',async()=>{const p=await review('6415');assert.equal(p.can_delete,false);await fails(()=>remove(p),/Apple subscription/)});
await check('direct deletion remains blocked',()=>fails(()=>query('delete from public.tens_in_groups where id=71001'),/owner dashboard/));
await check('changed group requires a fresh review',async()=>{await query("update public.iig_notification_settings set enabled=true where group_pin='6412'");await fails(()=>remove(r),/Group changed/)});
await check('failed child deletion rolls back everything',async()=>{await db.exec("CREATE FUNCTION public.fail_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure'; END $$; CREATE TRIGGER synthetic_failure BEFORE DELETE ON iig_closed_entry.archives FOR EACH ROW EXECUTE FUNCTION public.fail_test();");const before=await scalar('select iig_private.group_delete_snapshot(71001) v');const reviewed=await review('6412');try{await fails(()=>remove(reviewed),/synthetic failure/)}finally{await db.exec('DROP TRIGGER synthetic_failure ON iig_closed_entry.archives; DROP FUNCTION public.fail_test();')}assert.deepEqual(await scalar('select iig_private.group_delete_snapshot(71001) v'),before);assert.equal(await scalar('select count(*)::int v from iig_private.group_delete_permits'),0);});
async function snapshotAll(id){return scalar('select iig_private.group_delete_snapshot($1) v',[id]);}
const keep=await snapshotAll(71002),usersBefore=await scalar('select jsonb_agg(to_jsonb(u) order by id) v from auth.users u'),request=randomUUID();
const current=await review('6412');
await check('authenticated platform owner deletes complete group atomically',async()=>{await db.exec('set role authenticated');try{const result=await remove(current,{request});assert.equal(result.deleted,true);assert.equal(result.group_id,current.group_id)}finally{await db.exec('reset role')}});
await check('all 18 group record families removed; other group unchanged',async()=>{assert.equal(await snapshotAll(71001),null);for(const t of catalog.tables){const col=t.columns.find(x=>['group_id','group_pin'].includes(x.name));if(!col||t.name==='subscription_bindings')continue;const val=col.name==='group_pin'?'6412':71001;assert.equal(await scalar(`select count(*)::int v from ${t.schema}.${t.name} where ${col.name}=$1`,[val]),0,t.name)}assert.deepEqual(await snapshotAll(71002),keep)});
await check('accounts remain and former organiser can create again',async()=>{assert.deepEqual(await scalar('select jsonb_agg(to_jsonb(u) order by id) v from auth.users u'),usersBefore);await query("insert into public.tens_in_groups(id,group_name,group_pin,state) values(71006,'New synthetic group','6416','{}')");await query("insert into iig_private.group_owners(group_id,owner_id,request_id,requested_name) values(71006,$1,$2,'New synthetic group')",[ordinary,randomUUID()])});
await check('safe idempotent retry returns same outcome',async()=>{assert.equal((await remove(current,{request})).deleted,true);assert.equal(await scalar('select count(*)::int v from iig_private.group_delete_receipts'),1)});
await check('late orphan insertion blocked',()=>fails(()=>query("insert into iig_closed_entry.identity_ids values('71001','late-player')"),/Group no longer exists/));
await check('account-wide audit with null group still works',()=>query("insert into iig_private.release_audit(id,action,evidence) values(999999,'account-test','Synthetic')"));
await check('new group with reused PIN survives stale deletion',async()=>{await query("insert into public.tens_in_groups values(71007,'Reused synthetic PIN','6412','{}',now())");await fails(()=>remove(current),/Group not found/);assert.equal(await scalar('select count(*)::int v from public.tens_in_groups where id=71007'),1)});
await check('existing update guard bodies preserved exactly',async()=>{for(const f of guards.filter(f=>['guard_row','release_hold'].includes(f.name))){const now=await scalar(`select pg_get_functiondef('${f.schema}.${f.name}()'::regprocedure) v`);const strip=s=>s.replace(/IF TG_OP='DELETE' THEN[\s\S]*?END IF;/,'');assert.equal(strip(now),strip(f.definition))}});
await check('helper functions and permit tables inaccessible to client roles',async()=>{for(const role of ['anon','authenticated']){assert.equal(await scalar("select has_table_privilege($1,'iig_private.group_delete_permits','INSERT') v",[role]),false);assert.equal(await scalar("select has_function_privilege($1,'iig_private.authorise_group_delete(bigint,text)','EXECUTE') v",[role]),false)}});
console.log(JSON.stringify({passed,productionDataUsed:false}));await db.close();
