const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {parseHTML}=require('linkedom');
const {document}=parseHTML('<html><body></body></html>');
const ctx={document,location:{hostname:'localhost',origin:'http://localhost'},console};ctx.window=ctx;vm.runInNewContext(fs.readFileSync('app/account-controls.js','utf8'),ctx);
const calls=[];let reset=false,fail=false;
ctx.iigAccount.configure({request:async(path,body,auth)=>{calls.push({path,body,auth});if(fail)throw Error('Fresh sign-in required');return '11111111-1111-4111-8111-111111111111';},reset(){reset=true;},openOrganiser:async()=>{},openPlayer:async()=>{}});
const el=id=>document.getElementById(id);async function click(id){el(id).onclick();for(let i=0;i<30;i++)await Promise.resolve();}
(async()=>{
 ctx.iigAccount.open();el('accountTransferEmail').value='next@example.test';await click('accountTransfer');assert.equal(calls.at(-1).body.p_email,'next@example.test');assert.equal(el('accountTransferToken').value.length,36);
 fail=true;await click('accountAcceptTransfer');assert.match(el('accountMessage').textContent,/Fresh sign-in/);assert(!reset);
 fail=false;await click('accountAcceptTransfer');assert.match(el('accountMessage').textContent,/Ownership accepted/);
 el('accountNewEmail').value='new@example.test';await click('accountChangeEmail');assert(calls.at(-1).path.startsWith('/auth/v1/user?redirect_to='));assert.equal(calls.at(-1).body.email,'new@example.test');
 const count=calls.length;await click('accountDelete');assert.equal(calls.length,count);assert(!reset);
 el('accountDeleteConfirm').value='DELETE MY ACCOUNT';fail=true;await click('accountDelete');assert(!reset);assert(el('iigAccountDialog'));
 fail=false;await click('accountDelete');assert(reset);assert(!el('iigAccountDialog'));assert(calls.every(c=>c.auth));
 console.log('PASS: account UI confirms deletion, keeps failed requests retryable, requests verified transfers/email changes and resets only after successful deletion.');
})().catch(e=>{console.error(e);process.exit(1)});
