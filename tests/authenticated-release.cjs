// Execute the actual adapters with mocked DOM/network I/O. No browser-rendering,
// hosted Auth, email delivery or independent PostgreSQL sessions are claimed.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('app/index.html','utf8');
const main=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].find(m=>m[1].includes('let db=null'))[1];
let checks=0;
const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
const clone=x=>JSON.parse(JSON.stringify(x));
function setup(enabled=true){
 const nodes=new Map();
 function node(id){
  const n={id,value:'',textContent:'',style:{},dataset:{},hidden:false,classList:{add(){},remove(){},toggle(){}},
   focus(){},before(){},after(n){nodes.set(n.id,n);},insertBefore(n){nodes.set(n.id,n);},addEventListener(){},removeAttribute(){},scrollIntoView(){},remove(){nodes.delete(this.id);},setAttribute(){},getAttribute(){return '';},querySelectorAll(){return [];},
   querySelector(s){return s==='form'?(this.form??=node('form')):nodes.get(s.slice(1))||null;}};
  Object.defineProperty(n,'innerHTML',{set(value){for(const m of value.matchAll(/id="([^"]+)"/g))nodes.set(m[1],node(m[1]));},get(){return '';}});
  return n;
 }
 for(const m of html.matchAll(/id="([^"]+)"/g))nodes.set(m[1],node(m[1]));
 const document={getElementById:id=>nodes.get(id)||null,createElement:()=>node(''),querySelector:s=>s==='nav'?node('nav'):null,querySelectorAll:()=>[],body:{appendChild(n){nodes.set(n.id,n);}},head:{appendChild(){}},addEventListener(){}};
 const ctx={console,document,URL,URLSearchParams,Date,crypto:require('node:crypto').webcrypto,structuredClone,AbortController,
  location:{hostname:'fixture.invalid',origin:'https://fixture.invalid',pathname:'/app/',hash:'',search:'',assign(){},reload(){}},navigator:{},
  localStorage:{getItem:()=>null,setItem(){},removeItem(){}},sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},
  setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},fetch(){throw Error('Network forbidden');},alert(){},confirm:()=>true,
  IIGEntryGuard:require('../app/entry-guard-client.js'),TENS_IN_CONFIG:{supabaseUrl:'https://nyavvwrsrxqfyhiygkgw.supabase.co',supabaseKey:'fictional'}};
 ctx.window=ctx;ctx.addEventListener=()=>{};ctx.scrollTo=()=>{};
 if(enabled)ctx.IIG_ACCOUNT_BUILD={mode:'test-only',projectRef:'nyavvwrsrxqfyhiygkgw',origin:ctx.location.origin};
 vm.createContext(ctx);vm.runInContext(main,ctx);
 vm.runInContext('render=()=>{};show=()=>{};startPolling=()=>{};showWelcomePanel=()=>{};cancelProtectedDialogs=()=>{};scores=()=>{};',ctx);
 const before=ctx.save;
 for(const file of ['secure-organiser','secure-player','account-controls'])vm.runInContext(fs.readFileSync('app/'+file+'.js','utf8'),ctx);
 return {ctx,nodes,run:s=>vm.runInContext(s,ctx),before};
}
(async()=>{
 const off=setup(false);eq(off.ctx.IIG_ACCOUNT_ACCESS,null);eq(off.ctx.save,off.before);eq(off.ctx.iigSecureOrganiser,undefined);
 for(const file of ['self-service','handicap-input'])new vm.Script(fs.readFileSync('app/'+file+'.js','utf8'));
 const t=setup(),{ctx,run,nodes}=t;assert(ctx.IIG_ACCOUNT_ACCESS);checks++;
 const initial={group_pin:'3520',revision:0,invite_token:'11111111-1111-4111-8111-111111111111',entry:{open:false,closed:false,entrantIds:null},
  state:{groupName:'Fictional Golf',players:[],history:[],roundOpen:false,gameType:'points',pointsCompetition:'stableford',course:'',date:''}};
 let group=clone(initial),failure='',wait=null;const calls=[];
 async function request(url,body){
  calls.push({url,body:clone(body)});
  if(url.endsWith('iig_read_entry_group')){if(failure==='read')throw Error('Readback unavailable');return clone(group);}
  if(url.endsWith('iig_prepare_owned_entry'))return {...clone(group.state),players:group.state.players.map(p=>({...p,stableford:null,netScore:null,noReturn:false,scoreSubmitted:false}))};
  if(wait)await wait;
  if(failure==='write')throw Error('Revision conflict');
  eq(body.p_revision,group.revision);
  assert(/iig_(save|operate)_owned_group$/.test(url));checks++;
  group.state=clone(body.p_state);group.revision++;
  if(body.p_operation==='start'){group.state.roundId='server-new-round';group.entry={open:true,closed:false,entrantIds:null};}
  if(body.p_operation==='finish')group.entry={open:false,closed:true,entrantIds:[]};
  return group.revision;
 }
 const open=()=>ctx.iigSecureOrganiser.open(clone(group),request,()=>ctx.iigSecureOrganiser.close());
 open();eq(await run("db.rpc('save_group_state',{})").then(x=>x.data),null);
 // Actual existing new-round controls dispatch start, including through the
 // inactive player wrapper; server-generated round IDs replace client guesses.
 run("chooseNewRoundGameType=async()=> '2';chooseRoundCompetition=async()=> 'stableford';normalRoundSetup=async()=>({course:'Fictional Course',date:'2099-10-24',stake:0});");
 await ctx.newRound();eq(calls.find(c=>c.body.p_operation)?.body.p_operation,'start');eq(run('state.roundId'),'server-new-round');
 run("state.lastActivityAt='ordinary edit'");eq(await ctx.save(),true);eq(calls.at(-2).url,'/rest/v1/rpc/iig_save_owned_group');
 const count=calls.length;eq(await ctx.save('guess-start'),false);eq(calls.length,count);
 // No queued stale snapshot gets a later revision assigned to it.
 let release;wait=new Promise(resolve=>{release=resolve;});const saving=ctx.save('settings');
 const concurrent=calls.length;eq(await ctx.save('settings'),false);eq(calls.length,concurrent);release();eq(await saving,true);wait=null;
 failure='write';eq(await ctx.save('finish'),false);const failedCalls=calls.length;eq(await ctx.save('finish'),false);eq(calls.length,failedCalls);
 failure='';await nodes.get('secureOrganiserReload').onclick();eq(await ctx.save('finish'),true);eq(ctx.iigSecureOrganiser.entryStatus.open,false);
 group.entry={open:false,closed:true,entrantIds:null};open();eq(ctx.roundOpenNow(),false); // cancelled before the first score
 failure='read';eq(await ctx.save('settings'),false);const lost=calls.length;eq(await ctx.save('settings'),false);eq(calls.length,lost);
 failure='';open();
 // Read-only proposal then validated explicit write; closure survives a reset.
 group.entry={open:true,closed:true,entrantIds:['me']};group.state.roundOpen=true;open();
 eq(await ctx.applyGuardedOperation('resetscores'),true);eq(calls.at(-3).url,'/rest/v1/rpc/iig_prepare_owned_entry');eq(calls.at(-2).body.p_operation,'resetscores');eq(ctx.roundLocked(),true);
 // Account change during an in-flight ACK cannot restore the old session.
 wait=new Promise(resolve=>{release=resolve;});const oldSave=ctx.save('settings');ctx.iigSecureOrganiser.close();release();eq(await oldSave,false);eq(run('db'),null);wait=null;
 // Actual guided first-competition form reuses the same explicit start writer.
 group=clone(initial);group.state.players=[{id:'joined',name:'Joined before setup',handicap:11,paid:false,playingThisRound:false,stableford:null,netScore:null,wins:2}];open();ctx.iigSecureOrganiser.firstCompetition();
 nodes.get('normalSetupCourse').value='Fictional Course';nodes.get('guidedDate').value='2099-10-24';nodes.get('guidedStake').value='0';nodes.get('guidedScoring').value='net';
 await nodes.get('guidedFirstCompetition').querySelector('form').onsubmit({preventDefault(){}});
 eq(calls.at(-2).body.p_operation,'start');eq(group.state.gameType,'points');eq(group.state.pointsCompetition,'net');eq(group.state.players[0].noReturn,false);eq(group.state.players[0].scoreSubmitted,false);eq(group.state.players[0].competition,null);eq(group.state.players[0].wins,2);
 ctx.iigSecureOrganiser.close();
 // Player writes remain narrow and account-bound. Payment is self-declared.
 let player={player_id:'me',revision:0,entry:{open:true,closed:false,entrantIds:null},state:{roundId:'round-a',roundOpen:true,gameType:'money',stake:10,players:[{id:'me',name:'Fictional Golfer',paid:false,stableford:null}],history:[]}};
 const playerCalls=[];
 async function playerRequest(url,body){playerCalls.push({url,body:clone(body)});if(url.endsWith('iig_read_entry_group'))return clone(player);
  eq(body.p_revision,player.revision);eq(body.p_state,undefined);eq(body.p_player_id,undefined);player.revision++;player.state.players[0].paid=true;return player.revision;}
 for(const key of ['stake','roundOpen','history']){
  const incomplete=clone(player);delete incomplete.state[key];
  assert.throws(()=>ctx.iigSecurePlayer.open(incomplete,'3520',playerRequest,()=>{}),/details are incomplete/);checks++;
  eq(ctx.iigSecurePlayer.active,false);eq(playerCalls.length,0);
 }
 // Preserve stored numeric-string stakes; missing data must not manufacture a free round.
 const numericStake=clone(player);numericStake.state.stake='10';
 ctx.iigSecurePlayer.open(numericStake,'3520',playerRequest,()=>{});eq(ctx.iigSecurePlayer.active,true);
 ctx.iigSecurePlayer.close();eq(playerCalls.length,0);
 ctx.iigSecurePlayer.open(player,'3520',playerRequest,()=>ctx.iigSecurePlayer.close());
 ctx.appConfirm=async()=>true;await nodes.get('securePlayerConfirmPayment').onclick();
 eq(playerCalls[0].body.p_action,'payment');eq(playerCalls[0].body.p_payload.confirmed,true);eq(playerCalls[0].body.p_payload.round_id,'round-a');
 const none=playerCalls.length;ctx.appConfirm=async()=>false;await nodes.get('securePlayerConfirmPayment').onclick();eq(playerCalls.length,none);
 let resolveConfirm;ctx.appConfirm=()=>new Promise(resolve=>{resolveConfirm=resolve;});const confirming=nodes.get('securePlayerConfirmPayment').onclick();
 player.revision++;player.state.roundId='round-b';await ctx.refresh();const beforeConfirmation=playerCalls.length;resolveConfirm(true);await confirming;eq(playerCalls.length,beforeConfirmation);
 eq(await ctx.save('start'),false);eq(playerCalls.length,beforeConfirmation);
 ctx.iigSecurePlayer.close();eq(ctx.iigSecurePlayer.entryStatus,null);eq(run('db'),null);
 // Exact TEST binding is checked before legacy client creation, even if invalid.
 const invalid=setup();invalid.ctx.TENS_IN_CONFIG.supabaseUrl='https://wrong.invalid';
 vm.runInContext(main.slice(0,main.indexOf('let db=null')),invalid.ctx);eq(invalid.ctx.IIG_ACCOUNT_ACCESS,null);
 let connections=0;invalid.ctx.supabase={createClient(){connections++;throw Error('No connections');}};invalid.nodes.get('pinInput').value='3520';await invalid.ctx.connect();eq(connections,0);
 // Execute the reused email-code/creation state machine with fake HTTP replies.
 // Creation is bound to the verified session, not a supplied owner email or PIN.
 const reg=setup(),http=[],responses=[],stored=new Map();
 reg.ctx.sessionStorage={getItem:k=>stored.get(k),setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)};
 reg.ctx.fetch=async(url,options)=>{http.push({url,headers:options.headers,body:JSON.parse(options.body)});const r=responses.shift();assert(r,'Unexpected HTTP call');return {ok:!r.status,status:r.status||200,json:async()=>r.data};};
 for(const name of ['handicap-input','self-service'])vm.runInContext(fs.readFileSync('app/'+name+'.js','utf8'),reg.ctx);
 const el=id=>reg.nodes.get(id);
 async function act(id,event='onclick'){el(id)[event]({preventDefault(){}});for(let i=0;i<100;i++)await Promise.resolve();}
 el('regName').value='Fictional Organiser';el('regGroupName').value='Fictional Golf';el('regSetupEmail').value='organiser@example.invalid';
 responses.push({data:{}});await act('regGroupForm','onsubmit');eq(http.length,1);eq(http[0].body.email,'organiser@example.invalid');eq(el('regCodeForm').hidden,false);
 el('regCode').value='12345678';
 responses.push({data:{access_token:'fictional-token',expires_in:3600,user:{id:'verified-fixture',email:'organiser@example.invalid'}}},{data:null},{data:null},{data:{group_pin:'3520'}},{status:503,data:{message:'Read failed'}});
 await act('regCodeForm','onsubmit');eq(el('regPin').textContent,'3520');assert.match(el('regMessage').textContent,/was created/);checks++;
 eq(http.filter(c=>c.url.endsWith('iig_create_owned_group')).length,1);
 const create=http.find(c=>c.url.endsWith('iig_create_owned_group'));eq(create.headers.Authorization,'Bearer fictional-token');eq(create.body.p_email,undefined);eq(create.body.p_pin,undefined);
 responses.push({data:{...clone(initial),entry:initial.entry}});await act('regReload');
 responses.push({data:{...clone(initial),entry:initial.entry}});await act('regGroupForm','onsubmit');eq(http.filter(c=>c.url.endsWith('iig_create_owned_group')).length,1);
 eq(JSON.stringify([...stored.values()]).includes('fictional-token'),false);
 responses.push({data:{}});await act('regSignout');eq(el('regSignedIn').hidden,true);eq(el('regCode').value,'');eq(responses.length,0);
 console.log(`PASS: ${checks} authenticated release adapter checks; explicit actions, revision binding, no replay, readback/closure, guided first competition, trust-based payment, session invalidation and TEST isolation. Mocked DOM/network only.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
