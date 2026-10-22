const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {parseHTML}=require(process.env.LINKEDOM_PATH||'linkedom');
const html=fs.readFileSync('app/index.html','utf8');const {document}=parseHTML(html);
const ctx={document,location:{hostname:'deploy-preview-6--super-quokka-51747d.netlify.app'},console,URLSearchParams,Date,structuredClone,localStorage:{getItem:()=>null,setItem(){},removeItem(){}},sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},navigator:{userAgent:'test'},setInterval:()=>1,clearInterval(){},setTimeout:()=>1,clearTimeout(){},alert(){},confirm:()=>true};
ctx.window=ctx;ctx.addEventListener=()=>{};ctx.scrollTo=()=>{};vm.createContext(ctx);
for(const el of document.querySelectorAll('*'))el.animate=()=>{};
for(const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) if(script[1].includes('let db=null') || script[1].includes('function showWelcomePanel'))vm.runInContext(script[1],ctx);
vm.runInContext(fs.readFileSync('app/secure-organiser.js','utf8'),ctx);
const calls=[];let group={group_pin:'3520',revision:0,state:{groupName:'Pam’s people',players:[],history:[],roundOpen:false,gameType:'points',pointsCompetition:'stableford',course:'',date:''}};
let fail=false, readWait=null, writeWait=null;
async function request(url,body){calls.push({url,body});if(url.endsWith('iig_get_owned_group')){if(readWait)await readWait;return structuredClone(group);}if(url.endsWith('iig_save_owned_group')){if(writeWait)await writeWait;if(fail)throw Error('Group changed; reload before saving');assert.equal(body.p_revision,group.revision);group={...group,state:body.p_state,revision:group.revision+1};return group.revision;}throw Error('Unexpected endpoint');}
(async()=>{
 ctx.iigSecureOrganiser.open(group,request,()=>ctx.iigSecureOrganiser.close(),'trial');
 assert.match(document.getElementById('screen').textContent,/Set up your first round/);
 vm.runInContext("chooseNewRoundGameType=async()=> '2';chooseRoundCompetition=async()=> 'stableford';normalRoundSetup=async()=>({course:'Hazel Grove',date:'2099-10-24',stake:0});",ctx);
 await ctx.newRound();assert.equal(group.state.course,'Hazel Grove');assert.equal(group.state.gameType,'points');assert.equal(group.state.roundOpen,true);
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
 ctx.iigSecureOrganiser.close();assert.equal(vm.runInContext('db',ctx),null);assert.equal(vm.runInContext('isAdmin',ctx),false);
 assert(!document.getElementById('setupOverlay').classList.contains('hidden'));
 console.log('PASS: original app renders first competition; verified-owner saves and reloads; revision conflict blocks retries until reload; legacy RPC denied; sign-out clears access.');
})().catch(e=>{console.error(e);process.exit(1)});
