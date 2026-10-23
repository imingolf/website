// Real app DOM, mocked owner requests only; no SQL or hosted calls.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {parseHTML}=require('linkedom');
const html=fs.readFileSync('app/index.html','utf8');const {document}=parseHTML(html);
const ctx={document,location:{hostname:'localhost',origin:'http://localhost'},console,crypto:require('node:crypto').webcrypto,URLSearchParams,Date,structuredClone,localStorage:{getItem:()=>null,setItem(){},removeItem(){}},sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},navigator:{},setInterval:()=>1,clearInterval(){},setTimeout:()=>1,clearTimeout(){},alert(){},confirm:()=>true};
for(const el of document.querySelectorAll('*'))el.animate=()=>{};
ctx.window=ctx;ctx.addEventListener=()=>{};ctx.scrollTo=()=>{};vm.createContext(ctx);
for(const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))if(script[1].includes('let db=null')||script[1].includes('function showWelcomePanel'))vm.runInContext(script[1],ctx);
vm.runInContext(fs.readFileSync('app/secure-organiser.js','utf8'),ctx);
const initial={group_pin:'3520',revision:0,invite_token:'11111111-1111-4111-8111-111111111111',state:{groupName:'Weekend <Golfers>',players:[{id:'alex',handicap:11.2,wins:2,leaguePoints:10}],history:[],roundOpen:false,course:'',date:'',custom:'keep me'}};
let group=structuredClone(initial),writes=0,fail=false;
async function request(url,body){
 if(url.endsWith('iig_get_owned_group'))return structuredClone(group);
 if(url.endsWith('iig_save_owned_group')){writes++;assert.equal(body.p_revision,group.revision);if(fail)throw Error('Conflict');group={...group,state:body.p_state,revision:group.revision+1};return group.revision;}
 throw Error('Unexpected endpoint '+url);
}
const get=id=>document.getElementById(id);
function form(course='Local course',date='2099-10-24',stake='0'){
 ctx.iigSecureOrganiser.firstCompetition();get('normalSetupCourse').value=course;get('guidedDate').value=date;get('guidedStake').value=stake;
 Object.defineProperty(get('guidedScoring'),'value',{value:'net',configurable:true});
 return document.querySelector('#guidedFirstCompetition form');
}
async function submit(f){await f.onsubmit({preventDefault(){}});}
(async()=>{
 ctx.iigSecureOrganiser.open(group,request,()=>{});
 ctx.iigSecureOrganiser.invite();
 assert.equal(get('secureInviteBox').hidden,false);assert.equal(writes,0);
 const invitation=new URL(get('secureInviteWhatsApp').getAttribute('href')).searchParams.get('text');
 assert.match(invitation,/Weekend <Golfers>/);assert.match(invitation,/#pin=3520&invite=/);assert(!invitation.includes('admin'));
 let f=form('', '2099-10-24');await submit(f);assert.equal(writes,0);assert.match(get('guidedError').textContent,/course/);
 get('normalSetupCourse').value='Local course';get('guidedDate').value='2099-02-30';await submit(f);assert.equal(writes,0);
 get('guidedDate').value='2099-10-24';get('guidedStake').value='10';await submit(f);assert.equal(writes,0);assert.match(get('guidedError').textContent,/payment link/);
 get('guidedStake').value='0';await submit(f);
 assert.equal(writes,1);assert.equal(group.state.roundOpen,true);assert.equal(group.state.gameType,'points');assert.equal(group.state.pointsCompetition,'net');
 assert.deepEqual(JSON.parse(JSON.stringify(group.state.players)),initial.state.players);assert.equal(JSON.stringify(group.state.history),'[]');assert.equal(group.state.custom,'keep me');assert(group.state.roundId);
 assert.equal(get('guidedFirstCompetition'),null);
 ctx.iigSecureOrganiser.firstCompetition();assert.equal(get('guidedFirstCompetition'),null);assert.equal(writes,1);
 // A different device creating a competition while this form is open must win.
 group=structuredClone(initial);ctx.iigSecureOrganiser.open(group,request,()=>{});f=form();group.state.course='Other device';group.state.roundOpen=true;
 await submit(f);assert.equal(writes,1);assert.equal(group.state.course,'Other device');assert.match(get('guidedError').textContent,/already/);get('guidedCancel').onclick();
 // A failed write is not reported as saved; original players/history remain intact.
 group=structuredClone(initial);ctx.iigSecureOrganiser.open(group,request,()=>{});f=form();fail=true;await submit(f);assert.match(get('guidedError').textContent,/not confirmed/);assert.deepEqual(group,initial);
 ctx.iigSecureOrganiser.close();assert.equal(get('guidedFirstCompetition'),null);
 console.log('PASS: invite before competition, WhatsApp message, first-round validation/save, preserved players/history, concurrent creation and failed-save safeguards.');
})().catch(e=>{console.error(e);process.exit(1)});
