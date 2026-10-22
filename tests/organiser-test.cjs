const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('app/organiser-test.js','utf8');
function setup(host='deploy-preview-6--super-quokka-51747d.netlify.app'){
 const els={},calls=[],responses=[],storage=new Map();let i=0;
 const el=id=>els[id]||(els[id]={hidden:true,value:'',textContent:'',disabled:false,focus(){}});
 const context={document:{getElementById:el,querySelectorAll:()=>[]},location:{hostname:host,reload(){}},sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},crypto:{randomUUID:()=>`request-${++i}`},Date,AbortController,setTimeout:()=>1,clearTimeout(){},fetch:async(url,opts)=>{calls.push({url,opts,body:JSON.parse(opts.body)});const next=responses.shift();if(!next)throw new Error('Unexpected request');return {ok:next.ok!==false,json:async()=>next.data};}};
 vm.runInNewContext(source,context);
 async function submit(id){el(id).onsubmit({preventDefault(){}});for(let j=0;j<30;j++)await Promise.resolve();}
 return {el,calls,responses,submit};
}
(async()=>{
 const blocked=setup('imingolf.co.uk');assert.match(blocked.el('message').textContent,/only available/);assert.equal(blocked.calls.length,0);
 const t=setup();t.el('email').value='greg@example.test';t.responses.push({data:{}});await t.submit('emailForm');assert.equal(t.calls[0].body.create_user,true);assert.equal(t.el('codeForm').hidden,false);
 t.el('code').value='12345678';t.responses.push({ok:false,data:{msg:'Token has expired'}});await t.submit('codeForm');assert.match(t.el('message').textContent,/expired/);assert.equal(t.el('signedIn').hidden,true);
 t.responses.push({data:{access_token:'test-token',expires_in:3600,user:{id:'test-user',email:'greg@example.test'}}},{data:null});await t.submit('codeForm');assert.equal(t.el('groupForm').hidden,false);assert.equal(t.calls.at(-2).body.type,'email');assert.equal(t.calls.at(-1).opts.headers.Authorization,'Bearer test-token');
 t.el('group').value='Test <script>';t.el('organiser').value='Greg';t.responses.push({data:null},{ok:false,data:{message:'Registration is not open yet'}});await t.submit('groupForm');assert.equal(t.el('approval').hidden,false);assert.equal(t.el('identity').textContent,'test-user');const firstId=t.calls.at(-1).body.p_request_id;
 t.responses.push({data:null},{data:{group_pin:'1234',group_id:1}});await t.submit('groupForm');assert.equal(t.calls.at(-1).body.p_request_id,firstId);assert.equal(t.el('pin').textContent,'1234');assert.equal(t.el('result').hidden,false);
 const before=t.calls.length;t.responses.push({data:{group_pin:'1234',group_id:1}});await t.submit('groupForm');assert.equal(t.calls.length,before+1);assert.match(t.calls.at(-1).url,/iig_get_owned_group/);
 assert.ok(t.calls.every(x=>x.url.startsWith('https://nyavvwrsrxqfyhiygkgw.supabase.co/')));
 console.log('PASS: production host blocked; OTP send/expiry/verification; authenticated RPC; tester gate; retry ID reuse; existing-group reconciliation; test-only requests. No emails sent.');
})().catch(e=>{console.error(e);process.exit(1)});
