const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {parseHTML}=require(process.env.LINKEDOM_PATH||'linkedom');
const html=fs.readFileSync('app/index.html','utf8');const {document}=parseHTML(html);
const ctx={document,location:{hostname:'deploy-preview-6--super-quokka-51747d.netlify.app',origin:'https://deploy-preview-6--super-quokka-51747d.netlify.app'},console,crypto:require("node:crypto").webcrypto,URLSearchParams,Date,structuredClone,localStorage:{getItem:()=>null,setItem(){},removeItem(){}},sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},navigator:{userAgent:'test'},setInterval:()=>1,clearInterval(){},setTimeout:()=>1,clearTimeout(){},alert(){},confirm:()=>true};
ctx.window=ctx;ctx.addEventListener=()=>{};ctx.scrollTo=()=>{};vm.createContext(ctx);
for(const el of document.querySelectorAll('*'))el.animate=()=>{};
for(const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) if(script[1].includes('let db=null') || script[1].includes('function showWelcomePanel'))vm.runInContext(script[1],ctx);
vm.runInContext(fs.readFileSync('app/secure-organiser.js','utf8'),ctx);
const calls=[];let group={group_pin:'3520',revision:0,invite_token:'11111111-1111-4111-8111-111111111111',state:{groupName:'Pam’s people',players:[],history:[],roundOpen:false,gameType:'points',pointsCompetition:'stableford',course:'',date:''}};
let fail=false, readWait=null, writeWait=null;
async function request(url,body){calls.push({url,body});if(url.endsWith('iig_get_owned_group')){if(readWait)await readWait;return structuredClone(group);}if(url.endsWith('iig_save_owned_group')){if(writeWait)await writeWait;if(fail)throw Error('Group changed; reload before saving');assert.equal(body.p_revision,group.revision);group={...group,state:body.p_state,revision:group.revision+1};return group.revision;}throw Error('Unexpected endpoint');}
(async()=>{
 ctx.iigSecureOrganiser.open(group,request,()=>ctx.iigSecureOrganiser.close(),'trial');
 assert.match(document.getElementById('screen').textContent,/Set up your first round/);
 vm.runInContext("chooseNewRoundGameType=async()=> '2';chooseRoundCompetition=async()=> 'stableford';normalRoundSetup=async()=>({course:'Hazel Grove',date:'2099-10-24',stake:0});",ctx);
 await ctx.newRound();assert.equal(group.state.course,'Hazel Grove');assert.equal(group.state.gameType,'points');assert.equal(group.state.roundOpen,true);
 document.getElementById('secureOrganiserInvite').onclick();assert.match(document.getElementById('secureInviteLink').value,/app\/#pin=3520&invite=/);
 vm.runInContext("state.course='Unsaved';",ctx);await ctx.refresh();assert.equal(vm.runInContext('state.course',ctx),'Hazel Grove');
 // Stale write is rejected and cannot be silently retried.
 fail=true;assert.equal(await ctx.save(),false);let count=calls.length;assert.equal(await ctx.save(),false);assert.equal(calls.length,count);
 fail=false;await document.getElementById('secureOrganiserReload').onclick();assert.equal(await ctx.save(),true);
 // Manual reload has visible progress, excludes background polling, then confirms saved values.
 let resolveRead;readWait=new Promise(resolve=>{resolveRead=resolve;});
 const button=document.getElementById('secureOrganiserReload');const loading=button.onclick();
 assert.equal(button.disabled,true);assert.equal(button.textContent,'Reloading…');
 count=calls.length;await ctx.refresh();assert.equal(calls.length,count);
 resolveRead();await loading;readWait=null;
 assert.equal(button.disabled,false);assert.match(document.getElementById('secureOrganiserStatus').textContent,/Reloaded at .*Hazel Grove.*2099-10-24/);
 const confirmation=document.getElementById('secureOrganiserStatus').textContent;
 await ctx.refresh();assert.equal(document.getElementById('secureOrganiserStatus').textContent,confirmation);
 // A reload during saving waits and reads the newly saved snapshot.
 let resolveWrite;writeWait=new Promise(resolve=>{resolveWrite=resolve;});
 vm.runInContext("state.course='Saved after tap';",ctx);const saving=ctx.save();
 const waiting=button.onclick();assert.match(document.getElementById('secureOrganiserStatus').textContent,/Finishing your save/);
 resolveWrite();assert.equal(await saving,true);await waiting;writeWait=null;
 assert.match(document.getElementById('secureOrganiserStatus').textContent,/Reloaded at .*Saved after tap/);
 assert.equal(button.disabled,false);
 assert(calls.every(c=>/iig_(get|save)_owned_group$/.test(c.url)));
 assert.equal((await vm.runInContext("db.rpc('save_group_state',{})",ctx)).data,null);
 // Execute the actual Finish Round flow against the saved server snapshot.
 group.state.players=[{id:'greg',name:'Greg Steel',handicap:11,playingThisRound:true,stableford:36,netScore:null,scoreSubmitted:true}];
 group.revision++;vm.runInContext('state.players=[]',ctx);
 const alerts=[];ctx.alert=text=>alerts.push(text);
 fail=true;await ctx.finishRound();
 assert.equal(group.state.roundOpen,true);assert.equal(group.state.history.length,0);
 assert.equal(group.state.players[0].stableford,36);assert.equal(vm.runInContext('state.players[0].stableford',ctx),36);
 fail=false;await document.getElementById('secureOrganiserReload').onclick();alerts.length=0;
 await ctx.finishRound();
 assert.equal(group.state.roundOpen,false);assert.equal(group.state.history.length,1);
 assert.equal(group.state.history[0].players[0].stableford,36);
 assert.equal(group.state.players[0].leaguePoints,10);assert.equal(group.state.players[0].wins,1);
 assert.equal(group.state.players[0].stableford,null);assert.deepEqual(alerts,[]);
 await ctx.finishRound();assert.equal(group.state.history.length,1);assert.equal(group.state.players[0].leaguePoints,10);
 assert.match(alerts.at(-1),/already closed/);
 // The original Money and Trip finish paths must use the protected owner snapshot too.
 for(const trip of [false,true])for(const format of ['stableford','net']){
  group={...group,revision:group.revision+1,state:{course:'Protected Money',date:'2099-10-24',roundOpen:true,gameType:'money',pointsCompetition:format,
   history:[],stake:10,splitPrizes:true,secondPrize:2,thirdPrize:1,
   players:['A','B','C'].map((name,i)=>({id:name,name,paid:true,stableford:40-i,netScore:70+i})),
   ...(trip?{trip:{active:true,currentRound:1,totalRounds:2,competition:format,rounds:[]}}:{})}};
  await document.getElementById('secureOrganiserReload').onclick();alerts.length=0;
  await ctx.finishRound();
  const record=trip?group.state.trip.rounds[0]:group.state.history[0];
  assert(record);assert.deepEqual(Array.from(record.payouts,p=>p.amount),[27,2,1]);
  assert.equal(group.state.roundOpen,false);assert.deepEqual(alerts,[]);
  if(trip)assert.equal(group.state.trip.currentRound,2);
 }
 // Team completion must not advance the screen when saving fails.
 for(const format of ['betterball','pairsaggregate']){
  group={...group,revision:group.revision+1,state:{course:'Protected Pairs',date:'2099-10-24',roundOpen:true,gameType:'points',pointsCompetition:'stableford',history:[],stake:0,
   players:[{id:'A',name:'A',playingThisRound:true},{id:'B',name:'B',playingThisRound:true}],
   trip:{active:true,currentRound:1,totalRounds:2,currentFormat:format,rounds:[],playerIds:['A','B'],currentPlayingIds:['A','B'],
   currentTeams:[{id:'pair',playerIds:['A','B']}],currentTeamScores:{pair:40}}}};
  await document.getElementById('secureOrganiserReload').onclick();fail=true;alerts.length=0;
  await ctx.finishRound();assert.equal(group.state.trip.rounds.length,0);assert.match(alerts.at(-1),/could not be saved/);
  fail=false;await document.getElementById('secureOrganiserReload').onclick();alerts.length=0;
  await ctx.finishRound();assert.equal(group.state.trip.rounds.length,1);assert.equal(group.state.trip.currentRound,2);assert.deepEqual(alerts,[]);
 }
 const savedRounds=structuredClone(group.state.trip.rounds);
 assert.equal(await ctx.savePlayerPatch('A',{stableford:45}),true);assert.equal(group.state.players[0].stableford,45);assert.deepEqual(structuredClone(group.state.trip.rounds),savedRounds);
 ctx.iigSecureOrganiser.close();assert.equal(vm.runInContext('state.players.length+state.history.length',ctx),0);assert.equal(vm.runInContext('db',ctx),null);assert.equal(vm.runInContext('isAdmin',ctx),false);
 assert(!document.getElementById('setupOverlay').classList.contains('hidden'));
 console.log('PASS: original app renders first competition; verified-owner saves and reloads; revision conflict blocks retries until reload; legacy RPC denied; sign-out clears access.');
})().catch(e=>{console.error(e);process.exit(1)});
