const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('app/organiser-test.js','utf8');
function setup(host='deploy-preview-6--super-quokka-51747d.netlify.app'){
 const els={},calls=[],responses=[],storage=new Map();let i=0;
 const el=id=>els[id]||(els[id]={hidden:true,value:'',textContent:'',disabled:false,focus(){}});
 const context={document:{getElementById:el,querySelectorAll:()=>[]},location:{hostname:host,reload(){}},sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},crypto:{randomUUID:()=>`request-${++i}`},Date,AbortController,setTimeout:()=>1,clearTimeout(){},fetch:async(url,opts)=>{calls.push({url,opts,body:JSON.parse(opts.body)});const next=responses.shift();if(!next)throw new Error('Unexpected request');return {ok:next.ok!==false,json:async()=>next.data};}};
 vm.runInNewContext(source,context);
 async function submit(id){el(id).onsubmit({preventDefault(){}});for(let j=0;j<30;j++)await Promise.resolve();}
 async function click(id){el(id).onclick();for(let j=0;j<40;j++)await Promise.resolve();}
 return {el,calls,responses,submit,click};
}
(async()=>{
 const blocked=setup('imingolf.co.uk');assert.match(blocked.el('message').textContent,/only available/);assert.equal(blocked.calls.length,0);
 const t=setup();t.el('email').value='greg@example.test';t.responses.push({data:{}});await t.submit('emailForm');assert.equal(t.calls[0].body.create_user,true);assert.equal(t.el('codeForm').hidden,false);
 t.el('code').value='12345678';t.responses.push({ok:false,data:{msg:'Token has expired'}});await t.submit('codeForm');assert.match(t.el('message').textContent,/expired/);assert.equal(t.el('signedIn').hidden,true);
 t.responses.push({data:{access_token:'test-token',expires_in:3600,user:{id:'test-user',email:'greg@example.test'}}},{data:null});await t.submit('codeForm');assert.equal(t.el('groupForm').hidden,false);assert.equal(t.calls.at(-2).body.type,'email');assert.equal(t.calls.at(-1).opts.headers.Authorization,'Bearer test-token');
 t.el('group').value='Test <script>';t.el('organiser').value='Greg';t.responses.push({data:null},{ok:false,data:{message:'Registration is not open yet'}});await t.submit('groupForm');assert.equal(t.el('approval').hidden,false);assert.equal(t.el('identity').textContent,'test-user');const firstId=t.calls.at(-1).body.p_request_id;
 const owned={group_pin:'1234',group_id:1,revision:0,state:{course:'',date:'',pointsCompetition:'stableford',roundOpen:false,players:[],history:[],stake:0,custom:'preserve'}};
 t.responses.push({data:null},{data:{group_pin:'1234',group_id:1}},{data:owned});await t.submit('groupForm');assert.equal(t.calls.at(-2).body.p_request_id,firstId);assert.equal(t.el('pin').textContent,'1234');assert.equal(t.el('result').hidden,false);
 const before=t.calls.length;t.responses.push({data:owned});await t.submit('groupForm');assert.equal(t.calls.length,before+1);assert.match(t.calls.at(-1).url,/iig_get_owned_group/);
 assert.equal(t.el('competitionForm').hidden,false);
 t.el('course').value='Test Course';t.el('competitionDate').value='2099-02-30';t.el('format').value='net';
 let count=t.calls.length;await t.submit('competitionForm');assert.equal(t.calls.length,count);assert.match(t.el('message').textContent,/valid competition date/);
 t.el('competitionDate').value='2099-10-25';
 const saved={...owned,revision:1,state:{...owned.state,course:'Test Course',date:'2099-10-25',pointsCompetition:'net'}};
 t.responses.push({data:1},{data:saved});await t.submit('competitionForm');
 const write=t.calls.at(-2);assert.match(write.url,/iig_save_owned_group/);assert.equal(write.body.p_revision,0);assert.equal(write.body.p_state.custom,'preserve');assert.equal(write.body.p_state.roundOpen,false);assert.deepEqual(write.body.p_state.players,[]);assert.match(t.el('competitionSummary').textContent,/Test Course.*Net/);assert.match(t.el('message').textContent,/saved and checked/);
 t.responses.push({ok:false,data:{message:'Group changed; reload before saving'}});await t.submit('competitionForm');assert.equal(t.calls.at(-1).body.p_revision,1);assert.equal(t.el('competitionForm').hidden,true);assert.match(t.el('message').textContent,/Reload saved competition/);
 count=t.calls.length;await t.submit('competitionForm');assert.equal(t.calls.length,count);
 t.responses.push({data:saved});await t.click('reloadCompetition');assert.equal(t.el('competitionForm').hidden,false);
 t.responses.push({data:2},{ok:false,data:{message:'Network error'}});await t.submit('competitionForm');assert.match(t.el('message').textContent,/Save accepted/);assert.equal(t.el('competitionForm').hidden,true);
 t.responses.push({data:{...saved,state:{...saved.state,roundOpen:true}}});await t.click('reloadCompetition');assert.equal(t.el('competitionForm').hidden,true);
 assert.ok(t.calls.every(x=>x.url.startsWith('https://nyavvwrsrxqfyhiygkgw.supabase.co/')));
 console.log('PASS: production host blocked; OTP send/expiry/verification; authenticated RPC; tester gate; retry ID reuse; existing-group reconciliation; test-only requests; competition validation, preservation, save/readback, stale-write lockout, uncertain readback and active-round guard. No emails sent.');
})().catch(e=>{console.error(e);process.exit(1)});
