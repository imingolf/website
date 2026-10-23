// Real locally served demonstration. Browser routes ABORT any external request as a test safety net.
// No Supabase, database, SQL, email or payment connections.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict'),path=require('node:path');
(async()=>{
 const child=spawn('python3',['tools/registration-demo/serve.py','--host','127.0.0.1','--port','0'],{cwd:path.join(__dirname,'..'),stdio:['ignore','pipe','pipe']});
 let logs='';child.stderr.on('data',chunk=>{logs+=chunk;});
 let browser;
 try{
  const origin=await new Promise((resolve,reject)=>{
   const timeout=setTimeout(()=>reject(Error('Local demo did not start: '+logs)),10000);
   child.once('exit',code=>{clearTimeout(timeout);reject(Error('Local demo exited '+code+': '+logs));});
   child.stdout.on('data',chunk=>{logs+=chunk;const found=logs.match(/Open on your Mac: (http:\/\/127\.0\.0\.1:\d+)\/app\//);if(found){clearTimeout(timeout);resolve(found[1]);}});
  });
  browser=await chromium.launch({executablePath:process.env.TEST_BROWSER||'/usr/bin/chromium',headless:true});
  for(const viewport of [{width:320,height:640},{width:390,height:844}]){
   const context=await browser.newContext({viewport,reducedMotion:'reduce'}),page=await context.newPage();
   const external=[],errors=[],serverRequests=[],popups=[];
   context.on('page',p=>{if(p!==page)popups.push(p.url());});page.on('pageerror',e=>errors.push(e.message));
   await context.route('**/*',route=>{
    if(new URL(route.request().url()).origin!==origin){external.push(route.request().url());return route.abort();}
    serverRequests.push({url:route.request().url(),method:route.request().method()});return route.continue();
   });
   await context.addInitScript(()=>{
    localStorage.setItem('tensInPin','1010');sessionStorage.setItem('unrelated-private-sentinel','keep');
    // LAN HTTP on an iPhone need not offer secure-context randomUUID.
    Object.defineProperty(crypto,'randomUUID',{value:undefined,configurable:true});
   });
   async function start(scenario='new'){
    await page.goto(origin+'/app/?scenario='+scenario);await page.locator('#openingSplash').waitFor({state:'detached'});
    await page.locator('#iig-demo-banner').waitFor();
    if(scenario!=='friend')await page.getByRole('button',{name:'Start a golf group',exact:false}).first().click();
   }
   async function code(){await page.locator('#regCode').fill('123456');await page.locator('#regVerify').click();}
   await start();assert.equal(await page.locator('#regSetupEmail').inputValue(),'alex@example.test');
   await page.locator('#regSetupEmail').fill('not-fictional@example.com');await page.locator('#regCreate').click();
   await page.getByText('Use a fictional address such as alex@example.test.',{exact:false}).waitFor();
   await page.locator('#regSetupEmail').fill('alex@example.test');
   await page.locator('#regCreate').click();await page.locator('#regCode').fill('000000');await page.locator('#regVerify').click();
   await page.getByText('That code is incorrect or has expired.',{exact:false}).waitFor();
   await code();await page.locator('#regCreated').waitFor();
   assert.equal(await page.locator('#regPin').textContent(),'7394');
   assert.match(await page.locator('#registrationAuth').textContent(),/fictional group exists only/);
   await page.getByText('I’m playing too',{exact:true}).click();
   await page.locator('#regOwnerHandicap').pressSequentially('112');assert.equal(await page.locator('#regOwnerHandicap').inputValue(),'11');
   await page.locator('#regOwnerHandicap').pressSequentially('.2');await page.locator('#regOwnerPlayerForm button').click();
   await page.getByText('You have been added as a player.',{exact:true}).waitFor();
   await page.locator('#regInvite').click();
   await page.waitForFunction(()=>document.getElementById('secureInviteWhatsApp')?.getAttribute('href')==='#iig-demonstration');
   assert.equal(await page.locator('#secureInviteWhatsApp').getAttribute('target'),null);
   await page.locator('#secureInviteWhatsApp').click();await page.locator('#iig-demo-preview').waitFor();
   assert.match(await page.locator('#iig-demo-preview').textContent(),/WHATSAPP INVITATION — NOT SENT/);
   assert.match(await page.locator('#iig-demo-preview').textContent(),/Group PIN: 7394/);
   assert.deepEqual(popups,[]);
   await page.locator('#iig-demo-close').click();
   await page.getByRole('button',{name:'Start First Competition',exact:false}).click();
   await page.locator('#normalSetupCourse').fill('Fictional Meadow Golf');await page.locator('#guidedDate').fill('2099-10-24');
   await page.locator('#guidedSave').click();await page.locator('#guidedFirstCompetition').waitFor({state:'detached'});
   await page.getByText('Competition saved and open.',{exact:false}).waitFor();
   await page.locator('#iig-demo-toggle').click();
   await page.locator('#iig-demo-panel summary').click();const h=page.locator('#iig-demo-handicap');await h.pressSequentially('22.7');
   const pasteAllowed=await h.evaluate(el=>{el.select();const data=new DataTransfer();data.setData('text','227');return el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));});
   assert.equal(pasteAllowed,false);assert.equal(await h.inputValue(),'22.7');
   await page.screenshot({path:'/tmp/iig-isolated-demo-'+viewport.width+'.png'});
   // Runtime guard rejects remote APIs before a network request; CSP also blocks native bypasses.
   assert.equal(await page.evaluate(async()=>{try{await fetch('https://nyavvwrsrxqfyhiygkgw.supabase.co/auth/v1/otp',{method:'POST',body:'{}'});return false;}catch(_){return true;}}),true);
   assert.equal(await page.evaluate(async()=>{try{await (async()=>{const xhr=new XMLHttpRequest();xhr.open('GET','https://example.com');})();return false;}catch(_){return true;}}),true);
   assert.equal(await page.evaluate(()=>{try{new WebSocket('wss://example.com');return false;}catch(_){return true;}}),true);
   const cspBlocks=await page.evaluate(async()=>{
    const violations=[];const listener=event=>violations.push(event.effectiveDirective);
    document.addEventListener('securitypolicyviolation',listener);
    const frame=document.createElement('iframe');document.body.appendChild(frame);
    frame.contentDocument.addEventListener('securitypolicyviolation',listener);
    try{await frame.contentWindow.fetch('https://example.invalid/independent-csp-check');}catch(_){}
    await new Promise(resolve=>setTimeout(resolve,100));frame.remove();document.removeEventListener('securitypolicyviolation',listener);
    return violations;
   });
   assert(cspBlocks.includes('connect-src'),'CSP must block native fetch independently of the mock wrapper');
   // Server endpoints are not used by simulated requests.
   assert(serverRequests.every(r=>r.method==='GET'&&!r.url.includes('/auth/')&&!r.url.includes('/rest/')));
   const persistent=await page.evaluate(()=>({pin:localStorage.getItem('tensInPin'),sentinel:sessionStorage.getItem('unrelated-private-sentinel'),keys:Object.keys(localStorage)}));
   assert.equal(persistent.pin,'1010');assert.equal(persistent.sentinel,'keep');assert.deepEqual(persistent.keys,['tensInPin']);
   await start('returning');await page.locator('#regEmailForm button').click();await code();await page.locator('#regCreated').waitFor();
   assert.equal(await page.locator('#regPin').textContent(),'4826');
   await start('readback-error');await page.locator('#regCreate').click();await code();await page.getByText('Your group was created. Tap Check my group',{exact:false}).waitFor();
   await page.locator('#regReload').click();await page.getByText('Your group is saved.',{exact:true}).waitFor();
   await start('save-error');await page.locator('#regCreate').click();await code();await page.getByText('Simulated connection failure.',{exact:false}).waitFor();
   await page.locator('#regCreate').click();await page.locator('#regCreated').waitFor();
   await start('friend');assert.equal(await page.locator('#regEmail').inputValue(),'jamie@example.test');
   await page.locator('#regEmailForm button').click();await code();await page.locator('#regJoinForm').waitFor();
   await page.locator('#regHandicap').pressSequentially('8.5');await page.locator('#regJoinForm button').click();await page.locator('#securePlayerBanner').waitFor();
   // Reset has no memory of the just-created fictional groups or accounts.
   await start('new');assert.equal((await page.evaluate(()=>IIG_DEMO.metrics)).groups,0);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   assert.deepEqual(external,[]);assert.deepEqual(errors,[]);await context.close();
  }
  console.log('PASS: actual local demo on 320/390px; new/returning/friend/error scenarios, self-join, handicap guard, competition, neutralised WhatsApp links, no remote requests/popups, no browser-storage changes and reset.');
 }finally{if(browser)await browser.close();child.kill('SIGINT');}
})().catch(e=>{console.error(e);process.exit(1)});
