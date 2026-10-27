// Fictional embedded PostgreSQL only. No credentials, URLs, network or hosted SQL.
// Auth/session stubs exercise DB authority, not Supabase JWT issuance/verification.
const fs=require('node:fs'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {fixture,originalFinish,originalSetup}=require('./test-source-finish.cjs');
// Opt-in transport for ONE fresh cached-image container. No DB URL/container
// argument, host mounts, packages, private evidence or existing Docker resources.
const dockerMode=process.argv.includes('--docker-postgres');
class DockerPostgres {
 static image='public.ecr.aws/supabase/postgres@sha256:6942962433a569e87f228b4d4ab7e11db5deca64e43babb3a038443ad6c4f1bb';
 constructor(){
  this.name='iig-auth-rehearsal-'+randomUUID();this.id=null;this.sessions=[];
  this.env={PATH:process.env.PATH,HOME:require('node:os').homedir()};
  this.host='unix://'+this.env.HOME+'/.docker/run/docker.sock';
 }
 command(args){
  const r=require('node:child_process').spawnSync('docker',['--host='+this.host,...args],{env:this.env,encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024});
  if(r.error||r.status!==0)throw Error('Isolated Docker command failed: '+(r.error?.message||r.stderr||r.stdout));
  return r.stdout.trim();
 }
 inspect(){
  const [c]=JSON.parse(this.command(['inspect',this.id]));
  assert.equal(c.Id,this.id);assert.equal(c.Name,'/'+this.name);
  assert.equal(c.Config.Labels['iig.incident.fixture'],this.name);
  assert.equal(c.Config.Image,DockerPostgres.image);assert.equal(c.Image,this.imageId);
  return c;
 }
 isolated(){
  const c=this.inspect();assert.equal(c.HostConfig.NetworkMode,'none');
  assert.equal(c.HostConfig.Privileged,false);assert.equal(c.HostConfig.ReadonlyRootfs,true);
  assert.equal(Object.keys(c.HostConfig.PortBindings||{}).length,0);
  assert.equal(Object.keys(c.NetworkSettings.Ports||{}).length,0);
  assert.equal((c.HostConfig.Binds||[]).length,0);assert.equal((c.HostConfig.VolumesFrom||[]).length,0);
  assert.equal(c.Config.User,'postgres');assert.equal(c.HostConfig.PidMode,'');assert.equal(c.HostConfig.IpcMode,'private');
  assert.deepEqual(Object.keys(c.HostConfig.Tmpfs||{}).sort(),['/rehearsal','/tmp']);
  for(const m of c.Mounts){assert.equal(m.Type,'tmpfs');assert(['/tmp','/rehearsal'].includes(m.Destination));}
  return c;
 }
 static async start(){
  const d=new DockerPostgres();
  try{
   const [image]=JSON.parse(d.command(['image','inspect',DockerPostgres.image]));
   assert.equal(image.Os,'linux');assert.equal(image.Architecture,'arm64');
   assert.equal(Object.keys(image.Config.Volumes||{}).length,0);d.imageId=image.Id;
   const boot='set -eu; umask 077; initdb -D /rehearsal/data --auth-local=trust --auth-host=reject --no-locale --encoding=UTF8 >/rehearsal/init.log 2>&1; exec postgres -D /rehearsal/data -k /rehearsal -c listen_addresses= -c unix_socket_permissions=0700 -c max_connections=20';
   d.id=d.command(['run','--pull=never','--name',d.name,'--label','iig.incident.fixture='+d.name,
    '--network=none','--ipc=private','--read-only','--user=postgres','--cap-drop=ALL','--security-opt=no-new-privileges',
    '--tmpfs','/rehearsal:rw,noexec,nosuid,size=512m,mode=1777','--tmpfs','/tmp:rw,noexec,nosuid,size=64m,mode=1777',
    '-e','LC_ALL=C','--entrypoint=/bin/sh','-d',DockerPostgres.image,'-c',boot]);
   d.isolated();
   const deadline=Date.now()+30000;
   for(;;){
    if(!d.inspect().State.Running)throw Error('Fresh PostgreSQL startup failed; '+d.command(['logs',d.id]));
    try{d.command(['exec','--user=postgres',d.id,'pg_isready','-h','/rehearsal','-U','postgres']);break;}
    catch(e){if(Date.now()>deadline)throw e;await new Promise(r=>setTimeout(r,100));}
   }
   d.isolated();d.primary=d.session();
   await d.primary.exec("SET standard_conforming_strings=on; SET statement_timeout='15s'; SET lock_timeout='10s';");
   const settings=(await d.query("SELECT current_setting('listen_addresses') listen,inet_server_addr() addr,current_setting('server_version_num')::int version")).rows[0];
   assert.equal(settings.listen,'');assert.equal(settings.addr,null);assert.equal(Math.floor(settings.version/10000),17);
   assert.deepEqual((await d.query('SELECT $1::text value,$2::jsonb document,$3::boolean flag,$4::text absent',
    ["fictional 'quote' \\ slash $2",{text:"fictional 'quote' \\ slash $1"},false,null])).rows,
    [{value:"fictional 'quote' \\ slash $2",document:{text:"fictional 'quote' \\ slash $1"},flag:false,absent:null}]);
   console.log('PASS isolation: digest-pinned fresh PostgreSQL '+settings.version+'; network none, no ports/volumes/host mounts; tmpfs and Unix socket only.');
   return d;
  }catch(e){await d.close();throw e;}
 }
 session(){
  this.isolated();
  const p=require('node:child_process').spawn('docker',['--host='+this.host,'exec','-i','--user=postgres',this.id,
   '/bin/sh','-c','exec psql -X -w -qAt -P pager=off -h /rehearsal -U postgres -d postgres 2>&1'],{env:this.env,stdio:['pipe','pipe','pipe']});
  let pending=null,buffer='',tail='',queue=Promise.resolve(),closed=false;
  p.stdout.setEncoding('utf8');p.stderr.setEncoding('utf8');
  const fail=e=>{if(pending){clearTimeout(pending.timer);pending.reject(e);pending=null;}};
  p.stderr.on('data',x=>{tail=(tail+x).slice(-2000);});
  p.on('error',fail);p.on('exit',()=>{closed=true;fail(Error('Fixture psql exited: '+tail));});
  p.stdout.on('data',data=>{
   buffer+=data;let end;
   while((end=buffer.indexOf('\n'))>=0){
    const line=buffer.slice(0,end).replace(/\r$/,'');buffer=buffer.slice(end+1);
    if(!pending)continue;
    if(line.startsWith(pending.marker+' ')){
     const item=pending;pending=null;clearTimeout(item.timer);
     const code=line.slice(item.marker.length+1).trim();
     if(code!=='00000'||item.lines.some(x=>x.startsWith('ERROR:')||x.startsWith('FATAL:')))item.reject(Error(item.lines.join('\n')||'Fixture SQLSTATE '+code));
     else item.resolve(item.lines);
    }else pending.lines.push(line);
   }
  });
  function send(sql){
   const task=queue.then(()=>new Promise((resolve,reject)=>{
    if(closed)return reject(Error('Fixture session closed'));
    const marker='IIG_END_'+randomUUID().replaceAll('-','');
    pending={marker,lines:[],resolve,reject,timer:setTimeout(()=>{fail(Error('Fixture SQL timed out'));p.kill();},20000)};
    p.stdin.write(sql.trim()+'\n;\n\\echo '+marker+' :SQLSTATE\n');
   }));queue=task.catch(()=>{});return task;
  }
  function literal(x){
   if(x===null||x===undefined)return 'NULL';
   if(typeof x==='number'){assert(Number.isFinite(x));return String(x);}
   if(typeof x==='boolean')return x?'true':'false';
   return "'"+(typeof x==='object'?JSON.stringify(x):String(x)).replaceAll("'","''")+"'";
  }
  const s={exec:async sql=>{await send(sql);},query:async(sql,args=[])=>{
   // Only the existing fixed fixture query templates contain placeholders;
   // substitution happens once, before any value is inserted. No caller SQL API.
   const bound=sql.trim().replace(/;\s*$/,'').replace(/\$(\d+)\b/g,(_,n)=>{assert(Number(n)<=args.length);return literal(args[Number(n)-1]);});
   if(/^\s*(insert|update|delete)\b/i.test(bound)&&!/(?:\s|^)returning\s/i.test(sql)){await send(bound);return {rows:[]};}
   const wrapped=/^\s*select\b/i.test(bound)?'SELECT coalesce(json_agg(row_to_json(q)),\'[]\'::json)::text FROM ('+bound+') q'
    :'WITH q AS ('+bound+') SELECT coalesce(json_agg(row_to_json(q)),\'[]\'::json)::text FROM q';
   const lines=await send(wrapped),row=lines.find(x=>x.startsWith('['));
   if(row===undefined)throw Error('Fixture query returned no JSON rows');return {rows:JSON.parse(row)};
  },close:async()=>{
   await queue;if(!closed){p.stdin.end('\\quit\n');await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{p.kill();reject(Error('Fixture session cleanup timed out'));},5000);p.once('exit',()=>{clearTimeout(timer);resolve();});});}
  }};
  this.sessions.push(s);return s;
 }
 exec(sql){return this.primary.exec(sql);}
 query(sql,args){return this.primary.query(sql,args);}
 async close(){
  let error;
  for(const s of this.sessions)try{await s.close();}catch(e){error=e;}
  if(this.id){this.inspect();this.command(['stop','--time','3',this.id]);this.inspect();this.command(['rm',this.id]);this.id=null;
   console.log('PASS cleanup: only the identity-checked rehearsal container removed.');}
  if(error)throw error;
 }
}
(async()=>{
 const db=dockerMode?await DockerPostgres.start():new (require('@electric-sql/pglite').PGlite)();let checks=0,serial=1000;
 const ok=(a,b)=>{assert.deepEqual(a,b);checks++;};
 try{
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
   CREATE SCHEMA auth;CREATE SCHEMA iig_private;CREATE SCHEMA fixture_hooks;
   CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,is_anonymous boolean DEFAULT false,banned_until timestamptz);
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql SET search_path=pg_catalog AS $$ SELECT nullif(current_setting('fixture.user_id',true),'')::uuid $$;
   CREATE TABLE public.tens_in_groups(id bigint PRIMARY KEY,group_pin text UNIQUE,state jsonb NOT NULL,updated_at timestamptz,plan_type text DEFAULT 'plus',group_name text);
   CREATE TABLE iig_private.group_owners(group_id bigint PRIMARY KEY REFERENCES public.tens_in_groups(id),owner_id uuid NOT NULL UNIQUE REFERENCES auth.users(id),revision bigint NOT NULL,invite_token uuid NOT NULL DEFAULT gen_random_uuid());
   CREATE TABLE iig_private.group_members(group_id bigint REFERENCES iig_private.group_owners(group_id),user_id uuid REFERENCES auth.users(id),player_id uuid NOT NULL DEFAULT gen_random_uuid(),PRIMARY KEY(group_id,user_id),UNIQUE(group_id,player_id));
   -- Relevant shape from the saved local account-lifecycle deployment source;
   -- fictional markers only. This is NOT evidence of TEST installation.
   CREATE TABLE iig_private.account_deletions(user_id uuid PRIMARY KEY,requested_at timestamptz NOT NULL DEFAULT now());
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
  // Fictional installed getters: access checks stay intact; the deliberately
  // narrow member projection must be enriched without exposing raw group JSON.
  await db.exec(`CREATE FUNCTION public.iig_get_owned_group() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
   DECLARE u uuid=iig_private.verified_organiser();r jsonb;BEGIN
   SELECT jsonb_build_object('group_pin',g.group_pin,'state',g.state,'revision',o.revision,'invite_token',o.invite_token) INTO r
   FROM public.tens_in_groups g JOIN iig_private.group_owners o ON o.group_id=g.id WHERE o.owner_id=u;
   IF r IS NOT NULL THEN PERFORM iig_private.check_group_access(r->>'group_pin');END IF;RETURN r;END $$;
   CREATE FUNCTION public.iig_get_player_group(p_pin text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
   DECLARE u uuid=iig_private.verified_organiser();r jsonb;BEGIN
   SELECT jsonb_build_object('player_id',m.player_id,'revision',o.revision,'state',jsonb_build_object('players',g.state->'players')) INTO r
   FROM public.tens_in_groups g JOIN iig_private.group_owners o ON o.group_id=g.id JOIN iig_private.group_members m ON m.group_id=g.id
   WHERE g.group_pin=p_pin AND m.user_id=u AND EXISTS(SELECT 1 FROM jsonb_array_elements(g.state->'players') p WHERE p->>'id'=m.player_id::text);
   IF r IS NULL THEN RAISE EXCEPTION 'Group membership required' USING ERRCODE='42501';END IF;
   PERFORM iig_private.check_group_access(p_pin);RETURN r;END $$;
   REVOKE ALL ON FUNCTION public.iig_get_owned_group(),public.iig_get_player_group(text) FROM PUBLIC,anon;
   GRANT EXECUTE ON FUNCTION public.iig_get_owned_group(),public.iig_get_player_group(text) TO authenticated;`);
  const security=async()=> (await db.query(`SELECT oid::regprocedure::text AS f,pg_get_functiondef(oid) AS def,proacl::text AS acl FROM pg_proc
   WHERE pronamespace IN ('iig_private'::regnamespace,'fixture_hooks'::regnamespace) ORDER BY 1`)).rows;
  // Fictional installed signatures, not guessed TEST bodies. Exercise actual
  // replacement and restoration of definitions/ACLs/settings in one transaction.
  for(const [declaration,result] of [
   ['iig_save_owned_group(p_pin text,p_state jsonb,p_revision bigint)','bigint'],
   ['iig_join_owned_group(p_pin text,p_invite uuid,p_name text,p_handicap numeric)','uuid'],
   ['iig_set_my_attendance(p_pin text,p_attending boolean,p_revision bigint)','bigint'],
   ['iig_submit_my_score(p_pin text,p_score integer,p_format text,p_revision bigint)','bigint'],
   ['iig_player_action(p_pin text,p_action text,p_payload jsonb,p_revision bigint)','bigint']]){
   await db.exec(`CREATE FUNCTION public.${declaration} RETURNS ${result} LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'FICTIONAL_BASELINE_WRITER'; END $$;`);
  }
  const publicMetadata=async()=>(await db.query(`SELECT oid::regprocedure::text signature,pg_get_functiondef(oid) definition,proowner,proacl::text,proconfig
   FROM pg_proc WHERE pronamespace='public'::regnamespace ORDER BY 1`)).rows;
  const tableMetadata=async()=>(await db.query(`SELECT n.nspname,c.relname,c.relowner,c.relacl::text,c.relrowsecurity,c.relforcerowsecurity
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','iig_private','fixture_hooks') AND c.relkind='r' ORDER BY 1,2`)).rows;
  const originalSecurity=await security(),untouched=await seed();
  const originalPublic=await publicMetadata(),originalTables=await tableMetadata();
  const stages=['core','validators','binding','boundary','authenticated-writers'].map(name=>name==='binding'
   ? `CREATE OR REPLACE FUNCTION iig_closed_entry.resolve_pin(p_pin text) RETURNS text LANGUAGE sql SET search_path=pg_catalog AS $$ SELECT id::text FROM public.tens_in_groups WHERE group_pin=p_pin $$;`
   : fs.readFileSync(__dirname+'/../../supabase/closed-entry-candidate/'+name+'.sql','utf8'));
  for(let stage=1;stage<=stages.length;stage++){
   await db.exec('BEGIN');for(const sql of stages.slice(0,stage))await db.exec(sql);
   await assert.rejects(()=>db.exec('SELECT 1/0'),/division by zero/);checks++;
   await db.exec('ROLLBACK');
   ok(await publicMetadata(),originalPublic);ok(await tableMetadata(),originalTables);ok(await security(),originalSecurity);
   ok(await state(untouched),untouched.s);ok(await revision(untouched),41);
   ok(Number((await db.query("SELECT count(*) n FROM pg_namespace WHERE nspname='iig_closed_entry'")).rows[0].n),0);
  }
  for(const name of ['core','validators','boundary','authenticated-writers'])await db.exec(fs.readFileSync(__dirname+'/../../supabase/closed-entry-candidate/'+name+'.sql','utf8'));
  const inventorySource=fs.readFileSync(__dirname+'/../../tools/closed-entry-test-preflight/review-saved.py','utf8').split('PUBLIC_SIGNATURES = (')[1].split('\n)')[0];
  const signatures=[...inventorySource.matchAll(/'(iig_[^']+)'/g)].map(m=>'public.'+m[1]).sort();
  const installed=(await db.query(`SELECT 'public.'||proname||'('||replace(oidvectortypes(proargtypes),', ', ',')||')' AS signature
   FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'iig_%' AND proname NOT IN('iig_get_owned_group','iig_get_player_group') ORDER BY 1`)).rows.map(r=>r.signature);
  ok(installed,signatures);ok(installed.length,14);
  ok(Number((await db.query("SELECT count(*) n FROM pg_proc WHERE pronamespace='iig_closed_entry'::regnamespace")).rows[0].n),42);
  async function realSessionRaces(){
   if(!dockerMode)return;
   // Reuse the existing race harness's real wait-observation pattern, but run
   // these cases through the actual authenticated adapter in this SAME container.
   async function contender(uid,label){
    const s=db.session();
    await s.exec("SET statement_timeout='15s'; SET lock_timeout='10s';");
    await s.query("SELECT set_config('fixture.user_id',$1,false),set_config('application_name',$2,false)",[uid,label]);
    await s.exec('SET SESSION AUTHORIZATION authenticated');return s;
   }
   function call(s,name,args){return s.query('SELECT public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') result',args);}
   async function contend(winnerUid,loserUid,winnerCall,loserCall){
    const label='iig-wait-'+randomUUID(),a=await contender(winnerUid,'iig-winner-'+randomUUID()),b=await contender(loserUid,label);
    let waiting;
    try{
     await a.exec('BEGIN');await winnerCall(a);
     waiting=loserCall(b).then(()=>({error:null}),error=>({error}));
     const deadline=Date.now()+5000;
     for(;;){
      const seen=(await db.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock') blocked",[label])).rows[0].blocked;
      if(seen){checks++;break;}
      if(Date.now()>deadline)throw Error('Independent authenticated writer did not reach a real lock wait');
      await new Promise(r=>setTimeout(r,25));
     }
     await a.exec('COMMIT');
     const outcome=await waiting;assert.match(outcome.error?.message||'',/Group changed/);checks++;
    }finally{
     await a.exec('ROLLBACK');if(waiting)await waiting;
     await a.close();await b.close();
    }
   }
   for(const game of ['money','points'])for(const entryFirst of [false,true]){
    const x=await seed({game});
    if(game==='money')await action(x,0,'payment',{confirmed:true});else await attend(x,0);
    const rev=await revision(x),guardRev=(await round(x)).revision;
    const scoreCall=s=>call(s,'iig_submit_my_score',[x.pin,0,'stableford',rev]);
    const entryCall=game==='money'
     ? s=>call(s,'iig_player_action',[x.pin,'payment',{round_id:x.s.roundId,confirmed:true},rev])
     : s=>call(s,'iig_set_my_attendance',[x.pin,true,rev]);
    await contend(x.users[entryFirst?1:0],x.users[entryFirst?0:1],entryFirst?entryCall:scoreCall,entryFirst?scoreCall:entryCall);
    ok(await revision(x),rev+1);ok((await round(x)).revision,guardRev+1);
    if(entryFirst){await score(x,0,0);ok((await round(x)).entrant_ids,x.ids.slice(0,2));}
    else{
     await reject(()=>game==='money'?action(x,1,'payment',{confirmed:true}):attend(x,1),/closed|CLOSED/);
     ok((await round(x)).entrant_ids,[x.ids[0]]);
    }
    ok((await round(x)).closed,true);ok((await state(x)).history,x.s.history);
    console.log('PASS real authenticated lock race: '+game+' '+(entryFirst?'entry before score':'score before entry'));
   }
   for(const transition of ['finish','start']){
    const x=await seed();await action(x,0,'payment',{confirmed:true});await score(x,0,31);
    const finished=await originalFinish(await state(x));
    if(transition==='start')await operate(x,'finish',finished);
    const rev=await revision(x),oldRound=await round(x),oldState=await state(x);
    const proposal=transition==='finish'?finished:await originalSetup(oldState,'stableford');
    await contend(x.owner,x.users[1],s=>call(s,'iig_operate_owned_group',[x.pin,transition,proposal,rev]),
     s=>call(s,'iig_player_action',[x.pin,'payment',{round_id:oldState.roundId,confirmed:true},rev]));
    ok(await revision(x),rev+1);ok((await round(x)).revision,oldRound.revision+1);
    if(transition==='finish'){ok((await round(x)).phase,'finished');ok((await state(x)).history[0],finished.history[0]);}
    else{ok((await round(x)).phase,'open');ok((await round(x)).closed,false);ok((await state(x)).history,oldState.history);}
    console.log('PASS real authenticated lock race: '+transition+' versus stale entry');
   }
   db.isolated();
  }
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
   if(options.enrich)options.enrich(s,ids);
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
  // Fixture superuser supplies a permit directly to exercise the trigger without
  // the RPC's earlier validator. Never a public/client path; always rolled back.
  async function guardProbe(x,proposed,actor){
   await db.exec('BEGIN');
   try{
    await db.query('SELECT iig_closed_entry.initialise($1,$2)',[String(x.id),await state(x)]);
    await db.query(`INSERT INTO iig_closed_entry.permits
     SELECT pg_backend_pid(),group_id,pg_current_xact_id()::text,'member_score',revision,iig_closed_entry.digest($2),true,$3
     FROM iig_closed_entry.rounds WHERE group_id=$1
     ON CONFLICT(backend,group_id) DO UPDATE SET transaction_id=excluded.transaction_id,operation=excluded.operation,
      expected_revision=excluded.expected_revision,state_digest=excluded.state_digest,available=true,actor_id=excluded.actor_id`,[String(x.id),proposed,actor]);
    await db.query('UPDATE public.tens_in_groups SET state=$1 WHERE id=$2',[proposed,x.id]);
   }finally{await db.exec('ROLLBACK');}
  }
  async function action(x,i,name,payload={},rev){return rpc(x.users[i],'iig_player_action',[x.pin,name,{round_id:(await state(x)).roundId,format:x.s.pointsCompetition,...payload},rev??await revision(x)]);}
  async function operate(x,op,s,uid=x.owner,rev){return rpc(uid,'iig_operate_owned_group',[x.pin,op,s,rev??await revision(x)]);}
  async function adminPayment(x,i,paid){const s=await state(x);Object.assign(s.players[i],{paid,paymentMarkedAt:'fictional',paymentMarkMethod:'admin-confirmed'});return operate(x,'payment',s);}
  const attend=async(x,i,value=true,rev)=>rpc(x.users[i],'iig_set_my_attendance',[x.pin,value,rev??await revision(x)]);
  const score=async(x,i,value=31,format=x.s.pointsCompetition,rev)=>rpc(x.users[i],'iig_submit_my_score',[x.pin,value,format,rev??await revision(x)]);
  const beforeRead=await inventory();
  const ownerRead=await rpc(untouched.owner,'iig_read_entry_group',[null]);
  ok(ownerRead.state,untouched.s);ok(ownerRead.entry,{open:true,closed:false,entrantIds:null});
  const memberRead=await rpc(untouched.users[0],'iig_read_entry_group',[untouched.pin]);
  const expected=structuredClone(untouched.s);
  for(const p of [...expected.players,...expected.history[0].players])delete p.paymentMarkedAt;
  delete memberRead.state.sideGameDate;
  ok(memberRead.state,expected);ok(memberRead.entry,ownerRead.entry);ok(memberRead.plan_type,'plus');
  ok(await inventory(),beforeRead); // metadata read must not initialise the guard
  const privateView=await seed({trip:true,pair:'betterball',enrich(s,ids){
   Object.assign(s,{groupName:'Fictional group',paymentLink:'https://monzo.me/fictional',paymentProvider:'Monzo',adminPin:'PRIVATE_PIN',invite_token:'PRIVATE_INVITE',futurePrivate:{name:'PRIVATE_NESTED'}});
   Object.assign(s.players[0],{email:'PRIVATE_EMAIL',bankDetails:'PRIVATE_BANK',futurePrivate:{name:'PRIVATE_PROFILE'}});
   s.players[1].name={name:'PRIVATE_MALFORMED_SCALAR'};
   s.history[0].payouts=[{id:'mine',winnerPlayerId:ids[0],amount:20,status:'ready',paymentLink:'https://monzo.me/fictional-winner',paymentProvider:'Monzo',bankDetails:'PRIVATE_BANK'},
    {id:'other',winnerPlayerId:ids[2],amount:10,status:'ready',paymentLink:'PRIVATE_OTHER_LINK',paymentProvider:'PRIVATE_OTHER_PROVIDER'}];
   s.history[0].prizePlaces=[{position:1,name:'Fictional winner',playerId:ids[0],score:38,secret:'PRIVATE_RESULT'}];
   s.trip.normalRoundBackup={players:[{name:'PRIVATE_BACKUP'}]};s.trip.currentTeamScores={ab:38,cd:35,hidden:{name:'PRIVATE_MAP'}};
   s.trip.pastTrips=[{name:'Fictional past Trip',rounds:[{payouts:s.history[0].payouts}],secret:'PRIVATE_TRIP'}];
   s.sideGame={bets:[{id:'mine',player1Id:ids[0],player2Id:ids[1],date:'2099-01-01',stake:5,secret:'PRIVATE_BET'},
     {id:'other',player1Id:ids[2],player2Id:ids[3],date:'2099-01-01',stake:7}],
    scores:[{playerId:ids[0],date:'2099-01-02',score:30},{playerId:ids[1],date:'2099-01-01',score:31},
     {playerId:ids[1],date:'2099-01-02',score:32},{playerId:ids[2],date:'2099-01-01',score:33}],
    settlements:[{id:'mine',debtorId:ids[0],creditorId:ids[1],amount:5},{id:'other',debtorId:ids[2],creditorId:ids[3],amount:7}]};
  }});
  const beforePrivateRead=await inventory(),view=(await rpc(privateView.users[0],'iig_read_entry_group',[privateView.pin])).state;
  ok(await inventory(),beforePrivateRead);
  ok(JSON.stringify(view).includes('PRIVATE_'),false);
  ok(view.paymentLink,privateView.s.paymentLink);ok(view.players[0].paid,false);ok(view.players[0].leaguePoints,4);
  ok(view.trip.playerIds,privateView.s.trip.playerIds);ok(view.trip.currentGroups,privateView.s.trip.currentGroups);
  ok(view.trip.currentTeamScores,{ab:38,cd:35});ok(view.trip.plan,privateView.s.trip.plan);
  ok(view.history[0].prizePlaces,[{position:1,name:'Fictional winner',playerId:privateView.ids[0],score:38}]);
  ok(view.history[0].payouts[0].paymentLink,'https://monzo.me/fictional-winner');ok(view.history[0].payouts[1].paymentLink,undefined);
  ok(view.trip.pastTrips[0].rounds[0].payouts[1].paymentLink,undefined);
  ok(view.sideGame.bets.map(b=>b.id),['mine']);ok(view.sideGame.scores.map(b=>b.score),[30,31]);ok(view.sideGame.settlements.map(b=>b.id),['mine']);
  const otherView=(await rpc(privateView.users[2],'iig_read_entry_group',[privateView.pin])).state;
  ok(otherView.history[0].payouts[0].paymentLink,undefined);ok(otherView.sideGame.bets.map(b=>b.id),['other']);
  ok(typeof view.sideGameDate,'string');
  const noOwner=await user();ok(await rpc(noOwner,'iig_read_entry_group',[null]),null);
  await reject(()=>rpc(noOwner,'iig_read_entry_group',[untouched.pin]),/membership required/);
  await reject(()=>rpc(untouched.owner,'iig_read_entry_group',[null],'anon'),/permission denied/);
  await reject(()=>rpc(untouched.users[0],'iig_prepare_owned_entry',[untouched.pin,'resetscores',41,null]),/Organiser access required/);
  await reject(()=>rpc(untouched.owner,'iig_prepare_owned_entry',[untouched.pin,'start',41,null]),/UNSUPPORTED_DERIVED_OPERATION/);
  await reject(()=>rpc(untouched.owner,'iig_prepare_owned_entry',[untouched.pin,'resetscores',40,null]),/reload before saving/);
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
  const unpaid=await state(money);Object.assign(unpaid.players[1],{paid:false,paymentMarkedAt:null,paymentMarkMethod:null});
  const beforeUnpaidRev=await revision(money),beforeUnpaidGuard=(await round(money)).revision;
  await reject(()=>operate(money,'payment',unpaid,money.users[1]),/Organiser access required/);
  await operate(money,'payment',unpaid);
  ok(await revision(money),beforeUnpaidRev+1);ok((await round(money)).revision,beforeUnpaidGuard+1);
  ok((await state(money)).players[1].paymentMarkedAt,null);ok((await round(money)).closed,true);
  ok((await round(money)).entrant_ids,[money.ids[0],money.ids[1]]);
  await reject(()=>action(money,1,'score',{score:29}),/Pay before/);
  for(const metadata of [{paid:true,paymentMarkedAt:null,paymentMarkMethod:null},
   {paid:false,paymentMarkedAt:null,paymentMarkMethod:'admin-confirmed'},
   {paid:false,paymentMarkedAt:undefined,paymentMarkMethod:null},
   {paid:false,paymentMarkedAt:'fictional',paymentMarkMethod:null}]){
   const bad=await state(money);Object.assign(bad.players[1],metadata);
   await reject(()=>operate(money,'payment',bad),/INVALID_PAYMENT_METADATA/);
  }
  // A member cannot use the organiser's cleared-metadata form, even before closure.
  const beforeMemberUnpaid=structuredClone(unpaid);
  Object.assign(beforeMemberUnpaid.players[1],{paid:true,paymentMarkedAt:'fictional',paymentMarkMethod:'player-confirmed'});
  await assert.rejects(()=>db.query('SELECT iig_closed_entry.validate_payment($1,$2,false,NULL,$3)',[beforeMemberUnpaid,unpaid,money.ids[1]]),/INVALID_PAYMENT_METADATA/);checks++;
  await adminPayment(money,1,true);await action(money,1,'score',{score:29});
  await adminPayment(money,0,false); // retain the previous audited unpaid form too
  ok((await state(money)).players[0].stableford,0);
  await adminPayment(money,0,true);
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
  // Both serial orders of the payment/first-score race; this models ordering,
  // not independent-session locking (which still needs local PostgreSQL/Docker).
  for(const scoreFirst of [true,false]){
   const x=await seed();await action(x,0,'payment',{confirmed:true});const observed=await revision(x);
   if(scoreFirst){
    await action(x,0,'score',{score:1},observed);
    await reject(()=>action(x,1,'payment',{confirmed:true},observed),/Group changed/);
    await reject(()=>action(x,1,'payment',{confirmed:true}),/Payment entry is closed/);
    ok((await round(x)).entrant_ids,[x.ids[0]]);
   }else{
    await action(x,1,'payment',{confirmed:true},observed);
    await reject(()=>action(x,0,'score',{score:1},observed),/Group changed/);
    await action(x,0,'score',{score:1});ok((await round(x)).entrant_ids,x.ids.slice(0,2));
   }
  }
  const cancelled=await seed(),cancelState=await state(cancelled);
  Object.assign(cancelState,{course:'',date:'',roundOpen:false});await operate(cancelled,'cancel',cancelState);
  ok((await rpc(cancelled.owner,'iig_read_entry_group',[null])).entry,{open:false,closed:true,entrantIds:null});
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
  // The installed narrow endpoints accept Money and individual Trip rounds too.
  // Attendance changes only the member's flag, never payment or the Trip roster.
  for(const game of ['money','points'])for(const trip of [false,true])for(const stake of game==='money'?[0,10]:[0]){
   const format=trip?'net':'stableford',x=await seed({game,trip,format,enrich(s){s.stake=stake;}});
   const initialTrip=structuredClone(x.s.trip),initialHistory=structuredClone(x.s.history);
   await attend(x,0);await attend(x,0,false);await action(x,0,'attendance',{attending:true});await attend(x,1);
   if(stake>0){
    await reject(()=>score(x,0,70,format),/Pay before/);
    await action(x,0,'payment',{confirmed:true});await action(x,1,'payment',{confirmed:true});
   }
   if(trip&&stake===0){
    await attend(x,3); // This does not place the member in the organiser's Trip selection.
    await reject(()=>score(x,3,70,format),/INELIGIBLE_SCORER/);
   }
   await reject(()=>score(x,0,-1,format),/Invalid final score/);
   await reject(()=>score(x,0,format==='net'?1000:100,format),/Invalid final score/);
   await reject(()=>score(x,0,1,format==='net'?'stableford':'net'),/format changed/);
   await reject(()=>score(x,0,null,format),/Invalid final score/);
   await reject(()=>attend(x,0,null),/Group changed/);
   const observed=await revision(x),beforeGuard=(await round(x)).revision;
   await score(x,0,format==='net'?999:0,format,observed);
   ok(await revision(x),observed+1);ok((await round(x)).revision,beforeGuard+1);
   const frozen=stake>0?x.ids.slice(0,2):game==='points'&&!trip?x.ids.slice(0,2):trip?x.ids.slice(0,3):x.ids;
   ok((await round(x)).entrant_ids,frozen);
   await reject(()=>score(x,1,30,format,observed),/Group changed/);
   await reject(()=>attend(x,0,true),/Entries are closed|ENTRIES_CLOSED/);
   await reject(()=>attend(x,1,false),/Entries are closed|ENTRIES_CLOSED/);
   await action(x,1,'score',{score:30,format});
   await reject(()=>score(x,1,31,format),/already recorded/);
   ok((await state(x)).trip,initialTrip);ok((await state(x)).history,initialHistory);
   ok((await state(x)).players.map(p=>p.paid),stake>0?[true,true,false,false]:[false,false,false,false]);
  }
  // Both attendance/first-score serial orders, including fresh late retries.
  for(const scoreFirst of [true,false]){
   const x=await seed({game:'points'});await attend(x,0);const observed=await revision(x);
   if(scoreFirst){
    await score(x,0,1,'stableford',observed);
    await reject(()=>attend(x,1,true,observed),/Group changed/);
    await reject(()=>attend(x,1,true),/Entries are closed|ENTRIES_CLOSED/);
    ok((await round(x)).entrant_ids,[x.ids[0]]);
   }else{
    await attend(x,1,true,observed);
    await reject(()=>score(x,0,1,'stableford',observed),/Group changed/);
    await score(x,0,1);ok((await round(x)).entrant_ids,x.ids.slice(0,2));
   }
  }
  // Legacy unrelated data is retained exactly, not subjected to owner-save rules.
  const legacy=await seed({game:'points',enrich(s){delete s.history;s.adminPin='FICTIONAL';s.adminSetupToken='FICTIONAL';
   s.retainedMetadata={unknown:['keep',1]};s.players[2].paid='legacy-flag';s.players[2].scoreSubmitted=true;
   s.players[3].playingThisRound='legacy-flag';}});
  const beforeLegacy=await state(legacy);await attend(legacy,0);await score(legacy,0,31);
  const expectedLegacy=structuredClone(beforeLegacy);Object.assign(expectedLegacy.players[0],{playingThisRound:true,stableford:31,scoreSubmitted:true});
  ok(await state(legacy),expectedLegacy);ok((await round(legacy)).entrant_ids,[legacy.ids[0]]);
  await reject(async()=>rpc(legacy.owner,'iig_save_owned_group',[legacy.pin,{...await state(legacy),lastActivityAt:'fixture'},await revision(legacy)]),/Invalid group state/);
  // Exercise the latch with a normal supported owner reset on a separate round.
  const latch=await seed({game:'points'});await attend(latch,0);await score(latch,0,31);
  const resetLatch=await rpc(latch.owner,'iig_prepare_owned_entry',[latch.pin,'resetscores',await revision(latch),null]);
  await operate(latch,'resetscores',resetLatch);ok((await round(latch)).closed,true);
  await reject(()=>attend(latch,0,true),/ENTRIES_CLOSED/);await reject(()=>attend(latch,1,true),/ENTRIES_CLOSED/);
  await score(latch,0,32);ok((await round(latch)).entrant_ids,[latch.ids[0]]);
  // Member operations cannot smuggle arbitrary whole-state or other-player changes.
  const scoped=await seed({game:'points'});await attend(scoped,0);
  for(const tamper of [s=>s.players[1].paid=true,s=>s.players[0].paid=true,s=>s.players[0].handicap=1,
   s=>s.history=[],s=>s.course='Forged course',s=>s.trip={active:true},s=>s.players.reverse()]){
   const bad=await state(scoped);bad.players[0].stableford=31;bad.players[0].scoreSubmitted=true;tamper(bad);
   await reject(async()=>db.query("SELECT iig_closed_entry.write_authenticated($1,$2,'member_score',$3,$4)",
    [scoped.id,await revision(scoped),bad,scoped.ids[0]]),/WRONG_PLAYER|PROTECTED_FIELDS|INVALID_MEMBER_CHANGE/);
   await reject(()=>guardProbe(scoped,bad,scoped.ids[0]),/WRONG_PLAYER|PROTECTED_FIELDS|INVALID_MEMBER_CHANGE/);
  }
  const invalidScore=await state(scoped);Object.assign(invalidScore.players[0],{stableford:100,scoreSubmitted:true});
  await reject(()=>guardProbe(scoped,invalidScore,scoped.ids[0]),/INVALID_SCORE/);
  const forgedLate=await state(free);Object.assign(forgedLate.players.at(-1),{stableford:31,scoreSubmitted:true});
  await reject(()=>guardProbe(free,forgedLate,forgedLate.players.at(-1).id),/INELIGIBLE_SCORER/);
  await reject(async()=>rpc(scoped.owner,'iig_operate_owned_group',[scoped.pin,'member_score',await state(scoped),await revision(scoped)]),/EXPLICIT_ORGANISER_OPERATION_REQUIRED/);
  await reject(()=>score(scoped,0,31,'stableford',40),/Group changed/);
  await reject(()=>rpc(scoped.users[0],'iig_submit_my_score',[scoped.pin,31,'stableford',null]),/Group changed/);
  await reject(()=>score(scoped,0,31,null),/format changed/);
  await reject(()=>rpc(null,'iig_set_my_attendance',[scoped.pin,true,42]),/sign-in required/);
  await reject(()=>rpc(null,'iig_submit_my_score',[scoped.pin,31,'stableford',42]),/sign-in required/);
  await reject(()=>rpc(scoped.users[0],'iig_set_my_attendance',[scoped.pin,true,42],'anon'),/permission denied/);
  await reject(()=>rpc(scoped.users[0],'iig_submit_my_score',[scoped.pin,31,'stableford',42],'anon'),/permission denied/);
  await db.query('DELETE FROM iig_private.group_members WHERE group_id=$1 AND user_id=$2',[scoped.id,scoped.users[0]]);
  await reject(()=>attend(scoped,0),/membership required/);await reject(()=>score(scoped,0),/membership required/);
  const missingPlayer=await seed({game:'points'});
  await db.query('UPDATE iig_private.group_members SET player_id=$1 WHERE group_id=$2 AND user_id=$3',[randomUUID(),missingPlayer.id,missingPlayer.users[0]]);
  await reject(()=>attend(missingPlayer,0),/Player no longer/);await reject(()=>score(missingPlayer,0),/Player no longer/);
  const duplicate=await seed({game:'money',enrich(s,ids){s.stake=0;s.players[1].id=ids[0];}});
  await reject(()=>attend(duplicate,0),/MEMBER_IDENTITY_AMBIGUOUS/);await reject(()=>score(duplicate,0),/MEMBER_IDENTITY_AMBIGUOUS/);
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
  const resetRead=await rpc(money.users[0],'iig_read_entry_group',[money.pin]);
  ok(resetRead.entry.closed,true);ok(resetRead.entry.entrantIds,(await round(money)).entrant_ids);
  await reject(async()=>rpc(money.owner,'iig_prepare_owned_entry',[money.pin,'resetpayments',await revision(money),null]),/ENTRIES_CLOSED/);
  const preparationInventory=await inventory();
  ok(await rpc(money.owner,'iig_prepare_owned_entry',[money.pin,'resetscores',await revision(money),null]),await state(money));
  ok(await inventory(),preparationInventory);
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
   await reject(()=>score(x,0,38),/Use the pair score/);
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
  for(const operation of ['attendance','score']){
   const x=await seed({game:'points'});if(operation==='score')await attend(x,0);
   await db.query('INSERT INTO fixture_hooks.failures VALUES($1)',[x.id]);
   await reject(()=>operation==='attendance'?attend(x,0):score(x,0),/FICTIONAL_NOTIFICATION_FAILURE/);
  }
  // A later BEFORE hook may suppress a row after the guard ran. No false success,
  // consumed permit, advanced revision, frozen entrants or joined identity survives.
  const suppressed=await seed();
  await db.exec(`CREATE FUNCTION fixture_hooks.suppress() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id=${suppressed.id} THEN RETURN NULL;END IF;RETURN NEW;END $$;
   CREATE TRIGGER z_suppress BEFORE UPDATE ON public.tens_in_groups FOR EACH ROW EXECUTE FUNCTION fixture_hooks.suppress();`);
  await reject(()=>action(suppressed,0,'payment',{confirmed:true}),/AUTHENTICATED_WRITE_NOT_APPLIED/);
  await reject(()=>attend(suppressed,0),/AUTHENTICATED_WRITE_NOT_APPLIED/);
  await reject(()=>rpc(outsider,'iig_join_owned_group',[suppressed.pin,suppressed.invite,'Suppressed Join',12]),/AUTHENTICATED_WRITE_NOT_APPLIED/);
  await db.exec('DROP TRIGGER z_suppress ON public.tens_in_groups;DROP FUNCTION fixture_hooks.suppress()');
  const blocked=await seed();await db.query('INSERT INTO fixture_hooks.access_denied VALUES($1)',[blocked.id]);
  await reject(()=>attend(blocked,0),/Group access unavailable/);await reject(()=>score(blocked,0),/Group access unavailable/);
  await reject(()=>action(blocked,0,'payment',{confirmed:true}),/Group access unavailable/);
  await reject(()=>operate(blocked,'settings',blocked.s),/Group access unavailable/);
  await reject(()=>rpc(blocked.owner,'iig_read_entry_group',[null]),/Group access unavailable/);
  await reject(()=>rpc(blocked.users[0],'iig_read_entry_group',[blocked.pin]),/Group access unavailable/);
  await reject(async()=>rpc(outsider,'iig_join_owned_group',[blocked.pin,blocked.invite,'Blocked',12]),/Group access unavailable/);
  // Membership is account-bound, not organiser-registration-bound. These flags
  // are fictional Auth rows; this does not test real session issuance/revocation.
  for(const change of ["banned_until=now()+interval '1 day'","is_anonymous=true","email_confirmed_at=NULL","email=NULL",
   "email=NULL,email_confirmed_at=NULL,is_anonymous=true,banned_until=now()+interval '1 day'"]){
   for(const trip of [false,true]){
    const x=await seed({game:trip?'money':'points',trip,format:'net'});
    await db.query('UPDATE auth.users SET '+change+' WHERE id IN($1,$2)',[x.users[0],x.owner]);
    await attend(x,0);
    if(trip)await action(x,0,'payment',{confirmed:true});
    await score(x,0,70,'net');ok((await state(x)).players[0].netScore,70);ok((await round(x)).closed,true);
    await reject(async()=>operate(x,'settings',await state(x)),/sign-in required/);
    await reject(()=>rpc(x.users[0],'iig_join_owned_group',[x.pin,x.invite,'Existing member',12]),/sign-in required/);
    await reject(()=>attend(x,1),/Entries are closed|ENTRIES_CLOSED/);
   }
  }
  const invalid=await seed();
  await db.query('INSERT INTO iig_private.account_deletions VALUES($1)',[invalid.users[0]]);
  await reject(()=>action(invalid,0,'payment',{confirmed:true}),/sign-in required/);
  await reject(()=>attend(invalid,0),/sign-in required/);await reject(()=>score(invalid,0),/sign-in required/);
  // Size and history restrictions for submitted owner snapshots cannot reject
  // a bounded server-built score/attendance update to an already large row.
  const large=await seed({game:'points',enrich(s){s.history={retained:'legacy-history-shape'};s.retained='x'.repeat(1048577);}});
  await attend(large,0);await score(large,0,31);
  const savedLarge=await state(large);ok(savedLarge.history,large.s.history);ok(savedLarge.retained.length,1048577);
  ok((await round(large)).closed,true);ok(await revision(large),43);
  for(const role of ['anon','authenticated','service_role']){
   await db.exec('SET SESSION AUTHORIZATION '+role);
   try{
    await assert.rejects(()=>db.query('SELECT iig_closed_entry.write_authenticated($1,41,$2,$3)',[money.id,'save',money.s]),/permission denied/);checks++;
    await assert.rejects(()=>db.query('SELECT iig_closed_entry.member_view($1,$2)',[privateView.s,privateView.ids[0]]),/permission denied/);checks++;
    await assert.rejects(()=>db.query('SELECT * FROM iig_private.group_members'),/permission denied/);checks++;
    await assert.rejects(()=>db.query('UPDATE public.tens_in_groups SET state=$1 WHERE id=$2',[money.s,money.id]),/permission denied/);checks++;
   }finally{await db.exec('SET SESSION AUTHORIZATION postgres');}
  }
  ok(await security(),originalSecurity);
  await realSessionRaces();
  ok((await db.query('SELECT count(*) n FROM iig_closed_entry.permits WHERE available')).rows[0].n,0);
  console.log(`PASS authenticated writers: ${checks} checks; fictional DB only; no hosted connections`);
 }finally{await db.close();}
})().catch(e=>{console.error(e.query?{message:e.message,where:e.where,position:e.position}:e);process.exitCode=1;});
