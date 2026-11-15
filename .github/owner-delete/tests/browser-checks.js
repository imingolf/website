// Internal browser regression checks against synthetic adapters only.
(async function(){
 const out=document.getElementById('results'),frame=document.getElementById('app');let passed=0;
 const assert=(yes,message)=>{if(!yes)throw Error(message);};
 const until=async(fn)=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,30));}throw Error('Timed out waiting for UI');};
 const doc=()=>frame.contentDocument,win=()=>frame.contentWindow,$=selector=>doc().querySelector(selector);
 const text=selector=>$(selector)?.textContent||'';
 const click=selector=>{const el=$(selector);assert(el&&!el.disabled,'Button available: '+selector);el.click();};
 const type=value=>{const input=$('#ownerDeleteConfirm');input.value=value;input.dispatchEvent(new (win().Event)('input',{bubbles:true}));};
 const deletions=()=>win().testState.requests.filter(x=>x.path.endsWith('iig_owner_delete_group'));
 const reset=async(mode='normal')=>{frame.src='app/owner-dashboard.html?test='+Date.now();await new Promise(r=>frame.onload=r);await until(()=>$('[data-owner-delete]'));win().testState.mode=mode;};
 const open=async()=>{click('[data-owner-delete]');await until(()=>$('dialog')&&text('#ownerDeleteStatus')!=='Checking the selected group…');};
 const test=async(name,fn)=>{await fn();passed++;const p=document.createElement('p');p.textContent='PASS '+name;out.append(p);};
 try{
 await test('Review and cancellation make no changes',async()=>{await reset();await open();assert($('#ownerDeleteSubmit').disabled,'Must require confirmation');assert(deletions().length===0,'Review read only');click('#ownerDeleteForm [data-delete-cancel]');assert(!$('dialog'),'Cancelled');assert(deletions().length===0,'Cancel read only');});
 await test('Wrong PIN blocked; correct confirmation deletes selected group only',async()=>{await open();type('DELETE 6413');assert($('#ownerDeleteSubmit').disabled,'Wrong PIN');type('DELETE 6412');click('#ownerDeleteSubmit');await until(()=>text('#ownerDeleteTitle')==='Group deleted');await until(()=>!$('[data-owner-group="6412"]'));assert(!!$('[data-owner-group="6413"]'),'Other group kept');const d=deletions();assert(d.length===1&&d[0].body.p_group_id==='71001'&&d[0].body.p_pin==='6412','Exact target');click('#ownerDeleteOther [data-delete-cancel]');});
 await test('Players and history disappear from refreshed dashboard',async()=>{click('[data-owner-view="players"]');assert(!text('#ownerControlCentre').includes('Player 6412')&&text('#ownerControlCentre').includes('Player 6413'),'Players refreshed');click('[data-owner-view="history"]');assert(!text('#ownerControlCentre').includes('Round 6412')&&text('#ownerControlCentre').includes('Round 6413'),'History refreshed');});
 await test('Expired verification uses existing sign-in adapter',async()=>{await reset('stale');await open();assert($('#ownerDeleteForm').hidden,'Cannot submit');click('#ownerDeleteVerify');assert(win().testState.reauth===1&&!$('dialog')&&deletions().length===0,'Reauth only');});
 await test('Apple subscription group cannot be deleted',async()=>{await reset('blocked');await open();assert($('#ownerDeleteForm').hidden&&text('#ownerDeleteStatus').includes('Apple subscription'),'Blocked');assert(deletions().length===0,'No mutation');});
 await test('Changed group requires review and new confirmation',async()=>{await reset('changed');await open();type('DELETE 6412');click('#ownerDeleteSubmit');await until(()=>text('#ownerDeleteStatus').includes('The group changed.'));assert($('#ownerDeleteConfirm').value===''&&$('#ownerDeleteSubmit').disabled,'Confirmation reset');});
 await test('Connection retry keeps the same deletion request',async()=>{await reset('failure');await open();type('DELETE 6412');click('#ownerDeleteSubmit');await until(()=>text('#ownerDeleteStatus').includes('retrying this same request'));win().testState.mode='normal';click('#ownerDeleteSubmit');await until(()=>text('#ownerDeleteTitle')==='Group deleted');const d=deletions();assert(d.length===2&&d[0].body.p_request_id===d[1].body.p_request_id,'Idempotent retry');});
 await test('Pending delete disables submit and cancellation',async()=>{await reset('pending');await open();type('DELETE 6412');click('#ownerDeleteSubmit');await until(()=>!!win().testState.resolveDelete);assert($('#ownerDeleteSubmit').disabled&&$('#ownerDeleteForm [data-delete-cancel]').disabled,'Actions locked');assert(deletions().length===1,'Single request');win().testState.resolveDelete();await until(()=>text('#ownerDeleteTitle')==='Group deleted');});
 await test('Account change ignores a late review response',async()=>{await reset('delayed');click('[data-owner-delete]');await until(()=>!!win().testState.resolveReview);win().testState.actor=null;win().iigOwnerCentre.closeActions();win().testState.resolveReview();await new Promise(r=>setTimeout(r,60));assert(!$('dialog')&&deletions().length===0,'Late response ignored');});
 await test('Group names are escaped and mobile dialog fits',async()=>{await reset('xss');frame.style.width='390px';await open();assert(!$('#ownerDeleteGroup img')&&text('#ownerDeleteGroup').includes('<img'),'Rendered as text');const b=$('dialog').getBoundingClientRect();assert(b.x>=0&&b.right<=390,'Mobile fit');});
 document.getElementById('summary').textContent=passed+' checks passed — synthetic data only. No LIVE requests.';
 await reset();frame.style.width='100%';await open();
 }catch(error){document.getElementById('summary').textContent='FAIL: '+error.message;console.error(error);}
})();
