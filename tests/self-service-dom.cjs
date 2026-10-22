// Real HTML DOM with mocked network; does not claim rendered-browser coverage.
const {parseHTML}=require(process.env.LINKEDOM_PATH || 'linkedom');
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('app/self-service.js','utf8');
function setup(dashboard=false,host='deploy-preview-6--super-quokka-51747d.netlify.app'){
 const {document}=parseHTML(fs.readFileSync('app/'+(dashboard?'owner-dashboard.html':'index.html'),'utf8'));
 const calls=[],queue=[],storage=new Map();
 const ctx={document,location:{hostname:host,pathname:dashboard?'/app/owner-dashboard.html':'/app/'},Date,AbortController,setTimeout:()=>1,clearTimeout(){},crypto:{randomUUID:()=> '11111111-1111-4111-8111-111111111111'},sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},fetch:async(url,opts)=>{calls.push({url,opts,body:JSON.parse(opts.body)});const r=queue.shift();if(!r)throw Error('Unexpected request');return {ok:!r.status||r.status<400,status:r.status||200,json:async()=>r.data};}};
 ctx.window=ctx;
 vm.runInNewContext(source,ctx);
 const el=id=>document.getElementById(id);
 async function act(id,event='onclick'){el(id)[event]({preventDefault(){}});for(let j=0;j<100;j++)await Promise.resolve();}
 async function login(){el('regEmail').value='test@example.test';queue.push({data:{}});await act('regEmailForm','onsubmit');el('regCode').value='12345678';queue.push({data:{access_token:'fake',expires_in:3600,user:{id:'test-user',email:'test@example.test'}}});}
 return {el,calls,queue,act,login,document,storage};
}
(async()=>{
 const blocked=setup(false,'imingolf.co.uk');assert.equal(blocked.calls.length,0);assert.match(blocked.el('registrationAuth').textContent,/not available/);
 const t=setup();assert.equal(t.document.querySelectorAll('a[href^="mailto:"]').length,0);await t.login();t.queue.push({data:null});await t.act('regCodeForm','onsubmit');assert.equal(t.el('regGroupForm').hidden,false);
 t.el('regName').value='Greg';t.el('regGroupName').value='<New golfers>';
 t.queue.push({data:null},{data:{group_pin:'4321'}},{status:503,data:{message:'read failed'}});await t.act('regGroupForm','onsubmit');
 assert.equal(t.el('regPin').textContent,'4321');assert.match(t.el('regMessage').textContent,/was created/);
 const g={group_pin:'4321',state:{groupName:'<New golfers>'}};
 t.queue.push({data:g});await t.act('regReload');assert.equal(t.el('regCreatedName').textContent,'<New golfers>');assert.equal(t.el('regCreatedName').children.length,0);
 t.queue.push({data:g});await t.act('regGroupForm','onsubmit');assert.equal(t.calls.filter(c=>c.url.endsWith('iig_create_owned_group')).length,1);
 assert(t.calls.filter(c=>c.url.includes('/rpc/')).every(c=>c.opts.headers.Authorization==='Bearer fake'));
 assert(!JSON.stringify([...t.storage.values()]).includes('fake'));
 t.queue.push({data:{}});await t.act('regSignout');assert.equal(t.el('regSignedIn').hidden,true);
 const d=setup(true);await d.login();d.queue.push({status:403,data:{message:'Platform owner access required'}});await d.act('regCodeForm','onsubmit');
 assert(d.el('dashView').classList.contains('hidden'));assert.match(d.el('regMessage').textContent,/owner access required/);
 d.queue.push({data:[{group_name:'<New golfers>',group_pin:'4321',admin_name:'Greg',admin_contact:'test@example.test',plan_type:'trial',status:'active'}]});await d.act('regReload');
 assert(!d.el('dashView').classList.contains('hidden'));assert.match(d.el('registerRows').textContent,/<New golfers>4321Gregtest@example.test/);
 assert.equal(d.el('registerRows').querySelectorAll('script').length,0);
 d.queue.push({data:{}});await d.act('registerLogout');assert(d.el('dashView').classList.contains('hidden'));assert.equal(d.document.querySelector('#dashView .content').textContent,'');
 console.log('PASS: real welcome/dashboard DOM; OTP; authenticated creation; readback failure; safe retry; escaped group text; owner denial/list; sign-out clearing; no production requests. Network mocked, no rendered browser.');
})().catch(e=>{console.error(e);process.exit(1)});
