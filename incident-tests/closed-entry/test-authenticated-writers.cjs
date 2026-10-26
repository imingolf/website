// Fictional embedded PostgreSQL only. No credentials, URLs, network or hosted SQL.
// Auth/session stubs exercise DB authority, not Supabase JWT issuance/verification.
const fs=require('node:fs'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const {fixture,originalFinish,originalSetup}=require('./test-source-finish.cjs');
(async()=>{
 const db=new PGlite();let checks=0,serial=1000;
 const ok=(a,b)=>{assert.deepEqual(a,b);checks++;};
 try{
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
   CREATE SCHEMA auth;CREATE SCHEMA iig_private;CREATE SCHEMA fixture_hooks;
   CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,is_anonymous boolean DEFAULT false,banned_until timestamptz);
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql SET search_path=pg_catalog AS $$ SELECT nullif(current_setting('fixture.user_id',true),'')::uuid $$;
   CREATE TABLE public.tens_in_groups(id bigint PRIMARY KEY,group_pin text UNIQUE,state jsonb NOT NULL,updated_at timestamptz,plan_type text DEFAULT 'plus',group_name text);
   CREATE TABLE iig_private.group_owners(group_id bigint PRIMARY KEY REFERENCES public.tens_in_groups(id),owner_id uuid NOT NULL UNIQUE REFERENCES auth.users(id),revision bigint NOT NULL,invite_token uuid NOT NULL DEFAULT gen_random_uuid());
   CREATE TABLE iig_private.group_members(group_id bigint REFERENCES iig_private.group_owners(group_id),user_id uuid REFERENCES auth.users(id),player_id uuid NOT NULL DEFAULT gen_random_uuid(),PRIMARY KEY(group_id,user_id),UNIQUE(group_id,player_id));
   CREATE TABLE iig_private.account_deletions(user_id uuid PRIMARY KEY);
   CREATE TABLE fixture_hooks.access_denied(group_id bigint PRIMARY KEY);
   CREATE TABLE fixture_hooks.failures(group_id bigint PRIMARY KEY);
   CREATE TABLE fixture_hooks.events(group_id bigint,old_state jsonb,new_state jsonb);
   -- Same verified-account conditions as account-lifecycle.sql. Never replaced by adapter.
   CREATE FUNCTION iig_private.verified_organiser() RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
   DECLARE uid uuid=auth.uid();BEGIN
    PERFORM 1 FROM auth.users WHERE id=uid FOR UPDATE;
    IF uid IS NULL OR EXISTS(SELECT 1 FROM iig_private.account_deletions WHERE user_id=uid) OR NOT EXISTS(
     SELECT 1 FROM auth.users WHERE id=uid AND email_confirmed_at IS NOT NULL AND email IS NOT NULL AND coalesce(is_anonymous,false)=false AND (banned_until IS NULL OR banned_until<=now()))
    THEN RAISE EXCEPTION 'Verified organiser sign-in required' USING ERRCODE='42501';END IF;RETURN uid;END $$;
   CREATE FUNCTION iig_private.check_group_access(p_pin text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
   BEGIN IF EXISTS(SELECT 1 FROM fixture_hooks.access_denied a JOIN public.tens_in_groups g ON g.id=a.group_id WHERE g.group_pin=p_pin)
   THEN RAISE EXCEPTION 'Group access unavailable' USING ERRCODE='42501';END IF;END $$;
   CREATE FUNCTION fixture_hooks.notify() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
   BEGIN INSERT INTO fixture_hooks.events VALUES(NEW.id,OLD.state,NEW.state);
    IF EXISTS(SELECT 1 FROM fixture_hooks.failures WHERE group_id=NEW.id) THEN RAISE EXCEPTION 'FICTIONAL_NOTIFICATION_FAILURE';END IF;
    RETURN NEW;END $$;
   CREATE TRIGGER unchanged_notification AFTER UPDATE ON public.tens_in_groups FOR EACH ROW EXECUTE FUNCTION fixture_hooks.notify();
   ALTER TABLE public.tens_in_groups ENABLE ROW LEVEL SECURITY;
   ALTER TABLE iig_private.group_owners ENABLE ROW LEVEL SECURITY;
   ALTER TABLE iig_private.group_members ENABLE ROW LEVEL SECURITY;
   REVOKE ALL ON SCHEMA iig_private FROM PUBLIC,anon,authenticated,service_role;
   REVOKE ALL ON ALL TABLES IN SCHEMA public,iig_private FROM PUBLIC,anon,authenticated,service_role;
   REVOKE ALL ON ALL FUNCTIONS IN SCHEMA iig_private FROM PUBLIC,anon,authenticated,service_role;
   CREATE FUNCTION public.save_group_state(p_pin text,p_state jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
   BEGIN UPDATE public.tens_in_groups SET state=p_state WHERE group_pin=p_pin;END $$;
   GRANT EXECUTE ON FUNCTION public.save_group_state(text,jsonb) TO anon,authenticated;`);
  const security=async()=> (await db.query(`SELECT oid::regprocedure::text AS f,pg_get_functiondef(oid) AS def,proacl::text AS acl FROM pg_proc
   WHERE pronamespace IN ('iig_private'::regnamespace,'fixture_hooks'::regnamespace) ORDER BY 1`)).rows;
  const originalSecurity=await security(),untouched=await seed();
  for(const name of ['core','validators','boundary','authenticated-writers'])await db.exec(fs.readFileSync(__dirname+'/../../supabase/closed-entry-candidate/'+name+'.sql','utf8'));
  ok(await security(),originalSecurity);
  ok(await state(untouched),untouched.s);ok(await revision(untouched),41);
  await db.exec(`CREATE OR REPLACE FUNCTION iig_closed_entry.resolve_pin(p_pin text) RETURNS text LANGUAGE sql SET search_path=pg_catalog AS $$ SELECT id::text FROM public.tens_in_groups WHERE group_pin=p_pin $$;`);
  async function user(){const uid=randomUUID();await db.query('INSERT INTO auth.users VALUES($1,$2,now(),false,NULL)',[uid,uid+'@fictional.invalid']);return uid;}
  async function seed(options={}){
   const s=fixture(options),owner=await user(),users=await Promise.all(s.players.map(()=>user()));
   const ids=s.players.map(()=>randomUUID()),mapping=Object.fromEntries(s.players.map((p,i)=>[p.id,ids[i]]));
   s.players.forEach((p,i)=>Object.assign(p,{id:ids[i],paid:false,playingThisRound:false,stableford:null,netScore:null,noReturn:false,scoreSubmitted:false}));
   s.sideGame={bets:[],scores:[],settlements:[]};
   if(options.claim)s.history=[{id:'claim-round',course:'Fictional previous course',payouts:[{id:'claim-payout',winnerPlayerId:ids[0],winnerName:s.players[0].name,amount:30,status:'awaiting_details',paymentLink:'',paymentProvider:''}]}];
   if(options.trip){for(const k of ['playerIds','currentPlayingIds'])s.trip[k]=s.trip[k].map(x=>mapping[x]);
    if(options.pair){s.trip.currentTeams.forEach(t=>t.playerIds=t.playerIds.map(x=>mapping[x]));s.trip.currentTeamScores={};s.trip.currentGroups=s.trip.currentGroups.map(g=>g.map(x=>mapping[x]));}}
   const id=++serial,pin='fixture-'+id,invite=randomUUID();
   await db.query('INSERT INTO public.tens_in_groups(id,group_pin,state) VALUES($1,$2,$3)',[id,pin,s]);
   await db.query('INSERT INTO iig_private.group_owners VALUES($1,$2,41,$3)',[id,owner,invite]);
   for(let i=0;i<users.length;i++)await db.query('INSERT INTO iig_private.group_members VALUES($1,$2,$3)',[id,users[i],ids[i]]);
   return {id,pin,owner,users,ids,invite,s};
  }
  async function state(x){return (await db.query('SELECT state FROM public.tens_in_groups WHERE id=$1',[x.id])).rows[0].state;}
  async function revision(x){return Number((await db.query('SELECT revision FROM iig_private.group_owners WHERE group_id=$1',[x.id])).rows[0].revision);}
  async function round(x){return (await db.query('SELECT * FROM iig_closed_entry.rounds WHERE group_id=$1',[String(x.id)])).rows[0];}
  async function rpc(uid,name,args,role='authenticated'){
   await db.query("SELECT set_config('fixture.user_id',$1,false)",[uid||'']);await db.exec('SET SESSION AUTHORIZATION '+role);
   try{return (await db.query('SELECT public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') AS result',args)).rows[0].result;}
   finally{await db.exec('SET SESSION AUTHORIZATION postgres');}
  }
  async function inventory(){const out={};for(const t of ['public.tens_in_groups','iig_private.group_owners','iig_private.group_members','iig_closed_entry.rounds','iig_closed_entry.permits','iig_closed_entry.archives','iig_closed_entry.operation_audit','iig_closed_entry.identity_ids','fixture_hooks.events'])out[t]=(await db.query(`SELECT to_jsonb(t) r FROM ${t} t ORDER BY to_jsonb(t)::text`)).rows;return out;}
  async function reject(fn,re){const before=await inventory();await assert.rejects(fn,re);ok(await inventory(),before);}
  async function action(x,i,name,payload={},rev){return rpc(x.users[i],'iig_player_action',[x.pin,name,{round_id:(await state(x)).roundId,format:x.s.pointsCompetition,...payload},rev??await revision(x)]);}
  async function operate(x,op,s,uid=x.owner,rev){return rpc(uid,'iig_operate_owned_group',[x.pin,op,s,rev??await revision(x)]);}
  async function adminPayment(x,i,paid){const s=await state(x);Object.assign(s.players[i],{paid,paymentMarkedAt:'fictional',paymentMarkMethod:'admin-confirmed'});return operate(x,'payment',s);}
  const activity=await state(untouched);activity.lastActivityAt='fictional';
  // Owning the group does not require retaining a player slot in its roster.
  await db.query('INSERT INTO iig_private.group_members VALUES($1,$2,$3)',[untouched.id,untouched.owner,randomUUID()]);
  ok(Number(await rpc(untouched.owner,'iig_save_owned_group',[untouched.pin,activity,41])),42);
  ok(await state(untouched),activity);ok((await round(untouched)).revision,1);
  ok(Number(await rpc(untouched.owner,'iig_save_owned_group',[untouched.pin,activity,42])),43);
  ok((await round(untouched)).revision,1);
  const money=await seed();
  await reject(()=>action(money,0,'payment',{confirmed:false}),/Confirm your own payment/);
  await reject(()=>action(money,0,'score',{score:31}),/Pay before/);
  await action(money,0,'payment',{confirmed:true,player_id:money.ids[3]});
  ok((await state(money)).players.map(p=>p.paid),[true,false,false,false]);
  await action(money,1,'payment',{confirmed:true});const beforeScore=await revision(money);
  await reject(()=>action(money,0,'score',{score:100}),/Invalid final score/);
  ok((await round(money)).closed,false);
  await action(money,0,'score',{score:0});ok((await round(money)).closed,true);
  ok((await round(money)).entrant_ids,[money.ids[0],money.ids[1]]);
  await reject(()=>action(money,2,'payment',{confirmed:true}),/Payment entry is closed/);
  await reject(()=>adminPayment(money,2,true),/ENTRIES_CLOSED/);
  await reject(()=>action(money,1,'score',{score:29},beforeScore),/Group changed/);
  // Admin corrections do not require approving everyone, alter eligibility IDs,
  // rewrite results or allow an unpaid player to submit a score.
  await adminPayment(money,1,false);
  await reject(()=>action(money,1,'score',{score:29}),/Pay before/);
  await adminPayment(money,1,true);await action(money,1,'score',{score:29});
  ok((await round(money)).entrant_ids,[money.ids[0],money.ids[1]]);
  ok((await state(money)).history,money.s.history);
  await reject(()=>action(money,1,'score',{score:30}),/already recorded/);
  const outsider=await user();
  await reject(async()=>rpc(outsider,'iig_player_action',[money.pin,'payment',{confirmed:true},await revision(money)]),/membership required/);
  await reject(()=>operate(money,'settings',money.s,money.users[0]),/Organiser access required/);
  await reject(async()=>rpc(null,'iig_join_owned_group',[money.pin,money.invite,'Fictional New',12]),/sign-in required/);
  await reject(async()=>rpc(outsider,'iig_join_owned_group',[money.pin,randomUUID(),'Fictional New',12]),/Invitation is invalid/);
  const joined=await rpc(outsider,'iig_join_owned_group',[money.pin,money.invite,'Fictional New',12]);
  ok((await state(money)).players.at(-1).paid,false);ok((await state(money)).players.at(-1).playingThisRound,false);
  const joinRev=await revision(money);ok(await rpc(outsider,'iig_join_owned_group',[money.pin,money.invite,'Fictional New',12]),joined);ok(await revision(money),joinRev);
  await reject(async()=>rpc(outsider,'iig_player_action',[money.pin,'payment',{round_id:money.s.roundId,confirmed:true},await revision(money)]),/Payment entry is closed/);
  // Every shared-PIN entry endpoint uses lock_group; no private-state leak or write bypass.
  for(const role of ['anon','authenticated']){
   await reject(async()=>rpc(money.users[0],'iig_entry_read',[money.pin],role),/USE_AUTHENTICATED_GROUP_API/);
   await reject(async()=>rpc(money.users[0],'save_group_state',[money.pin,money.s],role),/VERSIONED_WRITE_REQUIRED/);
  }
  await reject(async()=>rpc(money.users[0],'iig_player_action',[money.pin,'payment',{},await revision(money)],'anon'),/permission denied/);
  const points=await seed({game:'points',format:'net'});
  await reject(async()=>rpc(points.users[0],'iig_submit_my_score',[points.pin,70,'net',await revision(points)]),/marked as playing/);
  for(let i=0;i<2;i++)await rpc(points.users[i],'iig_set_my_attendance',[points.pin,true,await revision(points)]);
  await rpc(points.users[0],'iig_submit_my_score',[points.pin,70,'net',await revision(points)]);
  await reject(async()=>rpc(points.users[2],'iig_set_my_attendance',[points.pin,true,await revision(points)]),/Entries are closed/);
  await action(points,1,'no_return');ok((await round(points)).entrant_ids,points.ids.slice(0,2));
  // The same membership/account/access checks apply to both old narrow endpoints.
  await reject(async()=>rpc(outsider,'iig_set_my_attendance',[points.pin,true,await revision(points)]),/membership required/);
  await reject(async()=>rpc(outsider,'iig_submit_my_score',[points.pin,70,'net',await revision(points)]),/membership required/);
  const free=await seed();free.s.stake=0;
  // Prepare stake through an explicit validated organiser operation.
  await operate(free,'configure',free.s);
  await action(free,0,'score',{score:31});await action(free,1,'score',{score:32});
  ok((await state(free)).players.every(p=>!p.paid),true);
  const newcomer=await user();await rpc(newcomer,'iig_join_owned_group',[free.pin,free.invite,'Fictional Late',10]);
  await reject(async()=>rpc(newcomer,'iig_player_action',[free.pin,'score',{round_id:free.s.roundId,format:'stableford',score:33},await revision(free)]),/INELIGIBLE_SCORER/);
  // Explicit lifecycle intent is required; changing round/history in whole-state
  // save cannot silently finish/start/reset or discard the closure latch.
  const finished=await originalFinish(await state(points));
  await reject(async()=>rpc(points.owner,'iig_save_owned_group',[points.pin,finished,await revision(points)]),/PROTECTED_ROUND_FIELDS/);
  await operate(points,'finish',finished);ok((await round(points)).phase,'finished');
  const setup=await originalSetup(finished,'net');await operate(points,'start',setup);
  ok((await round(points)).closed,false);ok((await round(points)).entrant_ids,null);
  await reject(()=>operate(points,'guess',setup),/EXPLICIT_ORGANISER/);
  const correction=await state(money);correction.players[0].stableford=33;await operate(money,'correct',correction);
  ok((await state(money)).players[0].stableford,33);
  const wrongCorrection=await state(money);wrongCorrection.players[2].paid=true;
  await reject(()=>operate(money,'correct',wrongCorrection),/CORRECTION_/);
  const reset=(await db.query("SELECT iig_closed_entry.derive_operation($1,'resetscores') s",[await state(money)])).rows[0].s;
  await operate(money,'resetscores',reset);ok((await round(money)).closed,true);
  await reject(()=>action(money,2,'payment',{confirmed:true}),/Payment entry is closed/);
  await reject(()=>adminPayment(money,2,true),/ENTRIES_CLOSED/);
  await action(money,0,'score',{score:35});
  // Team scores close entries atomically too; only pair members may submit and
  // every partner must already qualify. Resetting scores cannot reopen payment.
  for(const pair of ['betterball','pairsaggregate']){
   const x=await seed({trip:true,pair});
   await action(x,0,'payment',{confirmed:true});
   await reject(()=>action(x,0,'team_score',{team_id:'ab',score:38}),/Both partners must be paid/);
   for(const i of [1,2,3])await action(x,i,'payment',{confirmed:true});
   await reject(()=>action(x,2,'team_score',{team_id:'ab',score:38}),/Only a team member/);
   await action(x,0,'team_score',{team_id:'ab',score:38});ok((await round(x)).closed,true);
   ok((await round(x)).entrant_ids,x.ids.slice(0,4));
   await action(x,2,'team_score',{team_id:'cd',score:35});
   await reject(()=>action(x,1,'team_score',{team_id:'ab',score:39}),/already recorded/);
  }
  // Existing Side Game/claim dispatcher actions remain identity-bound, pass
  // through the guard and retain their original notification/revision path.
  const side=await seed();
  await action(side,0,'side_create',{other_id:side.ids[1],stake:10,format:'stableford'});
  let bet=(await state(side)).sideGame.bets[0];
  await reject(()=>action(side,0,'side_accept',{id:bet.id}),/No pending challenge/);
  await action(side,1,'side_accept',{id:bet.id});
  await action(side,0,'side_score',{score:37});await action(side,1,'side_score',{score:35});
  bet=(await state(side)).sideGame.bets[0];ok(bet.winnerId,side.ids[0]);ok(bet.amount,10);
  await action(side,1,'side_settle',{other_id:side.ids[0]});
  const settlement=(await state(side)).sideGame.settlements[0];
  await reject(()=>action(side,1,'side_confirm',{id:settlement.id}),/Only the creditor/);
  await action(side,0,'side_confirm',{id:settlement.id});ok((await state(side)).sideGame.settlements[0].status,'confirmed');
  ok((await round(side)).closed,false);ok((await state(side)).players,side.s.players);
  const claim=await seed({claim:true});
  await reject(()=>action(claim,1,'claim_prize',{history_id:'claim-round',payout_id:'claim-payout',payment_link:''}),/named winner/);
  await action(claim,0,'claim_prize',{history_id:'claim-round',payout_id:'claim-payout',payment_link:''});
  ok((await state(claim)).history[0].payouts[0].status,'bank_details_needed');
  await action(claim,0,'claim_prize',{history_id:'claim-round',payout_id:'claim-payout',payment_link:'https://paypal.me/Fictional'});
  ok((await state(claim)).history[0].payouts[0].paymentProvider,'PayPal');
  await reject(()=>action(claim,0,'claim_prize',{history_id:'claim-round',payout_id:'claim-payout',payment_link:'https://paypal.me.evil.invalid/Fictional'}),/supported secure payment link/);
  const identity=await seed();
  await db.query('UPDATE iig_private.group_owners SET owner_id=$1,revision=revision+1,invite_token=$2 WHERE group_id=$3',[outsider,randomUUID(),identity.id]);
  await reject(()=>operate(identity,'settings',identity.s),/Organiser access required/);
  await reject(async()=>rpc(await user(),'iig_join_owned_group',[identity.pin,identity.invite,'Old invite',12]),/Invitation is invalid/);
  await db.query('DELETE FROM iig_private.group_members WHERE group_id=$1 AND user_id=$2',[identity.id,identity.users[0]]);
  await reject(()=>action(identity,0,'payment',{confirmed:true}),/membership required/);
  // Hooks are neither bypassed nor swallowed: failed join/payment/score/lifecycle
  // rolls back state, membership, both revisions, closure, audit and notifications.
  for(const operation of ['join','payment','score','finish']){
   const x=await seed();if(operation==='score'||operation==='finish')await action(x,0,'payment',{confirmed:true});
   if(operation==='finish')await action(x,0,'score',{score:31});
   const fin=operation==='finish'?await originalFinish(await state(x)):null;
   await db.query('INSERT INTO fixture_hooks.failures VALUES($1)',[x.id]);
   await reject(()=>operation==='join'?rpc(outsider,'iig_join_owned_group',[x.pin,x.invite,'Failure Join',12]):operation==='finish'?operate(x,'finish',fin):action(x,0,operation,operation==='payment'?{confirmed:true}:{score:31}),/FICTIONAL_NOTIFICATION_FAILURE/);
  }
  // A later BEFORE hook may suppress a row after the guard ran. No false success,
  // consumed permit, advanced revision, frozen entrants or joined identity survives.
  const suppressed=await seed();
  await db.exec(`CREATE FUNCTION fixture_hooks.suppress() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id=${suppressed.id} THEN RETURN NULL;END IF;RETURN NEW;END $$;
   CREATE TRIGGER z_suppress BEFORE UPDATE ON public.tens_in_groups FOR EACH ROW EXECUTE FUNCTION fixture_hooks.suppress();`);
  await reject(()=>action(suppressed,0,'payment',{confirmed:true}),/AUTHENTICATED_WRITE_NOT_APPLIED/);
  await reject(()=>rpc(outsider,'iig_join_owned_group',[suppressed.pin,suppressed.invite,'Suppressed Join',12]),/AUTHENTICATED_WRITE_NOT_APPLIED/);
  await db.exec('DROP TRIGGER z_suppress ON public.tens_in_groups;DROP FUNCTION fixture_hooks.suppress()');
  const blocked=await seed();await db.query('INSERT INTO fixture_hooks.access_denied VALUES($1)',[blocked.id]);
  await reject(()=>action(blocked,0,'payment',{confirmed:true}),/Group access unavailable/);
  await reject(()=>operate(blocked,'settings',blocked.s),/Group access unavailable/);
  await reject(async()=>rpc(outsider,'iig_join_owned_group',[blocked.pin,blocked.invite,'Blocked',12]),/Group access unavailable/);
  const invalid=await seed();
  for(const change of ["banned_until=now()+interval '1 day'","is_anonymous=true","email_confirmed_at=NULL"]){
   await db.query('UPDATE auth.users SET '+change+' WHERE id=$1',[invalid.users[0]]);
   await reject(()=>action(invalid,0,'payment',{confirmed:true}),/sign-in required/);
   await db.query('UPDATE auth.users SET banned_until=NULL,is_anonymous=false,email_confirmed_at=now() WHERE id=$1',[invalid.users[0]]);
  }
  await db.query('INSERT INTO iig_private.account_deletions VALUES($1)',[invalid.users[0]]);
  await reject(()=>action(invalid,0,'payment',{confirmed:true}),/sign-in required/);
  for(const role of ['anon','authenticated','service_role']){
   await db.exec('SET SESSION AUTHORIZATION '+role);
   try{
    await assert.rejects(()=>db.query('SELECT iig_closed_entry.write_authenticated($1,41,$2,$3)',[money.id,'save',money.s]),/permission denied/);checks++;
    await assert.rejects(()=>db.query('SELECT * FROM iig_private.group_members'),/permission denied/);checks++;
    await assert.rejects(()=>db.query('UPDATE public.tens_in_groups SET state=$1 WHERE id=$2',[money.s,money.id]),/permission denied/);checks++;
   }finally{await db.exec('SET SESSION AUTHORIZATION postgres');}
  }
  ok(await security(),originalSecurity);
  ok((await db.query('SELECT count(*) n FROM iig_closed_entry.permits WHERE available')).rows[0].n,0);
  console.log(`PASS authenticated writers: ${checks} checks; fictional DB only; no hosted connections`);
 }finally{await db.close();}
})().catch(e=>{console.error(e.query?{message:e.message,where:e.where,position:e.position}:e);process.exitCode=1;});
