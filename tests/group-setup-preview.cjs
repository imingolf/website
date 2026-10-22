const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('app/group-setup-preview.html','utf8');
const code=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const nodes=new Map();function node(id){if(!nodes.has(id))nodes.set(id,{value:'',focus(){},setCustomValidity(s){this.validation=s},reportValidity(){}});return nodes.get(id)}
const panel={innerHTML:'',querySelector:s=>node(s)};
const context=vm.createContext({document:{getElementById:id=>id==='panel'?panel:node(id),querySelectorAll:()=>Array.from({length:4},()=>({classList:{toggle(){}}}))},window:{scrollTo(){}}});
vm.runInContext(code,context);const run=s=>vm.runInContext(s,context);
assert.match(panel.innerHTML,/Good golf starts here/);
node('group').value='   ';node('form').onsubmit({preventDefault(){}});assert.equal(run('step'),0);assert(node('group').validation);
node('group').value='<img src=x onerror=alert(1)>';node('form').onsubmit({preventDefault(){}});assert.equal(run('step'),1);
node('name').value='Alex';node('email').value='alex@example.com';node('form').onsubmit({preventDefault(){}});assert.equal(run('step'),2);
node('verify').onclick();assert.equal(run('step'),3);assert(panel.innerHTML.includes('&lt;img'));assert(!panel.innerHTML.includes('<img src=x'));
node('finish').onclick();assert.equal(run('step'),4);assert.match(panel.innerHTML,/not a working code/);
node('invite').onclick();assert.equal(run('step'),5);assert.match(panel.innerHTML,/NOT A LIVE INVITATION/);node('ready').onclick();node('round').onclick();assert.equal(run('step'),6);node('later').onclick();node('restart').onclick();assert.equal(run('step'),0);assert.equal(run('draft.email'),'');
assert(!/fetch\(|localStorage|sessionStorage|\.rpc\(|signIn|XMLHttpRequest/.test(code));
let scripts=0;for(const match of fs.readFileSync('app/index.html','utf8').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)){new vm.Script(match[1]);scripts++}
console.log(`PASS: navigation, blank input, escaped input, demo labels, restart, no storage/network; ${scripts} app scripts parse.`);
