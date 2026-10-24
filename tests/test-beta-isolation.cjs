// Offline artifact/browser checks. ALL requests are fulfilled/aborted locally. No online services.
const {chromium}=require('playwright');
const {spawnSync}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const ORIGIN='https://iig-isolated-beta.invalid',TEST='https://nyavvwrsrxqfyhiygkgw.supabase.co';
const LIVE='https://kzzzputsqxdntfqpprnz.supabase.co';
const KEY='sb_publishable_fDGji75-j3GP5VeAAIAdZg_f9TNmtWL';
const config={projectRef:'nyavvwrsrxqfyhiygkgw',supabaseUrl:TEST,publishableKey:KEY,betaOrigin:ORIGIN};
const jwt=issuer=>Buffer.from('{}').toString('base64url')+'.'+Buffer.from(JSON.stringify({iss:issuer+'/auth/v1',role:'authenticated',sub:'00000000-0000-4000-8000-000000000001'})).toString('base64url')+'.offline-fixture-not-a-real-signature';
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'iig-test-beta-'));let browser;
 try{
  const cfg=path.join(root,'explicit-test.json');fs.writeFileSync(cfg,JSON.stringify(config));
  const out=path.join(root,'artifact');const built=spawnSync('python3',['tools/test-beta/build.py','--config',cfg,'--out',out],{encoding:'utf8'});assert.equal(built.status,0,built.stderr);
  const securityHeaders=Object.fromEntries(fs.readFileSync(path.join(out,'_headers'),'utf8').split('\n').filter(l=>l.startsWith('  ')).map(l=>{const colon=l.indexOf(':');return [l.slice(2,colon).toLowerCase(),l.slice(colon+1).trim()];}));
  browser=await chromium.launch({executablePath:process.env.TEST_BROWSER||'/usr/bin/chromium',headless:true});
  async function fixture(variant='valid'){
   const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'}),page=await context.newPage();
   const calls=[],unexpected=[],files=[],errors=[];let created=false;
   await context.addCookies([{name:'private-project-cookie',value:'must-not-send',url:TEST,secure:true,sameSite:'None'}]);
   const group={group_pin:'7394',revision:0,invite_token:'11111111-1111-4111-8111-111111111111',state:{groupName:'Beta Fixture Golfers',course:'',date:'',gameType:'points',pointsCompetition:'stableford',players:[],history:[],roundOpen:false}};
   page.on('pageerror',e=>errors.push(e.message));
   await context.addInitScript((oldToken)=>{localStorage.setItem('tensInPin','1010');sessionStorage.setItem('old-admin-code','do-not-use');localStorage.setItem('sb-old-auth-token',oldToken);},jwt(LIVE));
   await context.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.origin===ORIGIN){
     files.push(url.pathname);let relative=url.pathname==='/app/'?'app/index.html':url.pathname.replace(/^\//,'');
     const file=path.join(out,relative);
     if(!file.startsWith(out+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,body:'Not in beta artifact',headers:securityHeaders});
     if(url.pathname==='/beta/config.js'&&variant==='missing')return route.fulfill({status:404,body:'No config',headers:securityHeaders});
     if(url.pathname==='/beta/config.js'&&variant!=='valid'){
      const altered={...config};
      if(variant==='wrong-project')altered.supabaseUrl=LIVE;
      if(variant==='wrong-key')altered.publishableKey='sb_secret_not-a-real-key';
      if(variant==='wrong-origin')altered.betaOrigin='https://different-beta.invalid';
      return route.fulfill({body:'window.IIG_TEST_BETA_CONFIG='+JSON.stringify(altered),contentType:'application/javascript',headers:securityHeaders});
     }
     const contentType=relative.endsWith('.js')?'application/javascript':relative.endsWith('.css')?'text/css':relative.endsWith('.png')?'image/png':'text/html';
     return route.fulfill({path:file,contentType,headers:securityHeaders});
    }
    if(url.origin===TEST){
     const body=req.postDataJSON();calls.push({path:url.pathname,body,headers:req.headers(),method:req.method()});let data={};
     if(url.pathname==='/auth/v1/otp'&&body.email==='redirect@example.test')return route.fulfill({status:302,headers:{location:LIVE+'/auth/v1/otp','access-control-allow-origin':ORIGIN},body:''});
     if(url.pathname==='/auth/v1/verify')data={access_token:jwt(TEST),expires_in:3600,user:{id:'00000000-0000-4000-8000-000000000001',email:'alex@example.test'}};
     else if(url.pathname.endsWith('iig_get_owned_group'))data=created?group:null;
     else if(url.pathname.endsWith('iig_create_owned_group')){created=true;data={group_pin:'7394'};}
     else if(url.pathname.endsWith('get_group_access_status'))data=[{access_allowed:true,plan_type:'trial'}];
     else if(url.pathname.endsWith('iig_list_registered_groups'))data=[];
     else if(!['/auth/v1/otp','/auth/v1/logout'].includes(url.pathname)){unexpected.push(url.href);return route.abort();}
     return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data),headers:{'access-control-allow-origin':ORIGIN}});
    }
    unexpected.push(url.href);return route.abort(); // Never contact LIVE or any external service even if a guard regresses.
   });
   return {context,page,calls,unexpected,files,errors};
  }
  for(const variant of ['missing','wrong-project','wrong-key','wrong-origin']){
   const t=await fixture(variant);await t.page.goto(ORIGIN+'/app/');await t.page.locator('html.iig-beta-blocked').waitFor({state:'attached'});
   assert.equal(await t.page.evaluate(()=>IIG_TEST_BETA.ready),false);assert.match(await t.page.locator('#iig-beta-status').textContent(),/Sign-in is disabled/);assert.equal(await t.page.locator('#iig-beta-status').isVisible(),true);
   assert.equal(await t.page.evaluate(async({TEST,KEY})=>{try{await fetch(TEST+'/auth/v1/otp',{method:'POST',headers:{apikey:KEY},body:'{}'});return false;}catch(_){return true;}},{TEST,KEY}),true);
   if(variant==='missing'){
    const blocked=await t.page.evaluate(async TEST=>{const f=document.createElement('iframe');document.body.append(f);const violations=[];f.contentDocument.addEventListener('securitypolicyviolation',e=>violations.push(e.effectiveDirective));try{await f.contentWindow.fetch(TEST+'/auth/v1/otp');}catch(_){}await new Promise(r=>setTimeout(r,100));f.remove();return violations;},TEST);
    assert(blocked.includes('connect-src'));
   }
   assert.equal(t.calls.length,0);assert.deepEqual(t.unexpected,[]);assert(!t.files.includes('/app/self-service.js'));await t.context.close();
  }
  const t=await fixture();await t.page.goto(ORIGIN+'/app/?pin=1010');await t.page.locator('#iig-beta-status').waitFor();
  assert.equal(await t.page.evaluate(()=>IIG_TEST_BETA.ready),true);assert.equal(t.calls.length,0);
  assert.equal(new URL(t.page.url()).hash,'#pin=1010');assert.equal(await t.page.locator('#regEmail').isVisible(),true);
  assert(!t.files.some(f=>f==='/app/config.js'||f.includes('cdn.')));
  assert.equal(await t.page.evaluate(()=>TENS_IN_CONFIG.supabaseUrl),'');
  assert.equal(await t.page.evaluate(()=>{try{supabase.createClient('https://wrong.invalid','wrong');return false;}catch(_){return true;}}),true);
  assert.equal(await t.page.evaluate(()=>adminDeviceRecognised()),false);
  assert.equal(await t.page.evaluate(()=>adminPinForGroup()),null);
  await t.page.evaluate(()=>adminLogin());assert.equal(await t.page.locator('#adminAccessPin').count(),0);
  await t.page.locator('#accountClose').click();
  const count=t.calls.length;
  const probes=[
   [LIVE+'/auth/v1/otp','POST',KEY,null],
   ['https://other.supabase.co/auth/v1/otp','POST',KEY,null],
   [TEST+'/rest/v1/rpc/get_group_state','POST',KEY,jwt(TEST)],
   [TEST+'/rest/v1/rpc/save_group_state','POST',KEY,jwt(TEST)],
   [TEST+'/auth/v1/otp','POST','production-credential-fixture',null],
   [TEST+'/rest/v1/rpc/iig_get_owned_group','POST',KEY,jwt(LIVE)],
   [TEST+'/auth/v1/user?redirect_to='+encodeURIComponent('https://imingolf.co.uk/app/'),'PUT',KEY,jwt(TEST)],
   [TEST+'/functions/v1/verify-apple-subscription','POST',KEY,jwt(TEST)]
  ];
  for(const [url,method,key,token] of probes){
   assert.equal(await t.page.evaluate(async({url,method,key,token})=>{try{await fetch(url,{method,headers:{apikey:key,...(token?{Authorization:'Bearer '+token}:{})},body:'{}'});return false;}catch(_){return true;}},{url,method,key,token}),true,url);
  }
  assert.equal(t.calls.length,count);assert.deepEqual(t.unexpected,[]);
  assert.equal(await t.page.evaluate(()=>{try{new XMLHttpRequest();return false;}catch(_){return true;}}),true);
  assert.equal(await t.page.evaluate(()=>{try{new WebSocket('wss://wrong.invalid');return false;}catch(_){return true;}}),true);
  // Independent CSP protection applies even to a native fetch recovered from a blank iframe.
  const csp=await t.page.evaluate(async LIVE=>{
   const violations=[],frame=document.createElement('iframe');document.body.append(frame);
   frame.contentDocument.addEventListener('securitypolicyviolation',e=>violations.push(e.effectiveDirective));
   try{await frame.contentWindow.fetch(LIVE+'/auth/v1/otp');}catch(_){}
   await new Promise(r=>setTimeout(r,100));frame.remove();return violations;
  },LIVE);assert(csp.includes('connect-src'));assert.deepEqual(t.unexpected,[]);
  const blockedLegacy=await t.page.evaluate(async TEST=>{const f=document.createElement('iframe');document.body.append(f);const events=[];f.contentDocument.addEventListener('securitypolicyviolation',e=>events.push(e.effectiveDirective));try{await f.contentWindow.fetch(TEST+'/rest/v1/rpc/get_group_state');}catch(_){}await new Promise(r=>setTimeout(r,100));f.remove();return events;},TEST);
  assert(blockedLegacy.includes('connect-src'));assert.equal(t.calls.length,count);
  const beforeUrl=t.page.url();
  await t.page.evaluate(LIVE=>{window.open(LIVE+'/auth/v1/otp');const a=document.createElement('a');a.id='bad-link';a.href=LIVE;a.textContent='Blocked';document.getElementById('welcomeStart').append(a);},LIVE);
  await t.page.waitForFunction(()=>document.getElementById('bad-link').getAttribute('href')==='#beta-blocked');
  await t.page.locator('#bad-link').click();assert.equal(t.page.url(),beforeUrl);
  assert.equal(await t.page.evaluate(()=>localStorage.getItem('tensInPin')),'1010');
  const redirectBlocked=await t.page.evaluate(async({TEST,KEY})=>{try{await fetch(TEST+'/auth/v1/otp',{method:'POST',redirect:'follow',credentials:'include',headers:{apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify({email:'redirect@example.test'})});return false;}catch(_){return true;}},{TEST,KEY});
  assert.equal(redirectBlocked,true);assert.deepEqual(t.unexpected,[]);assert.equal(t.calls.at(-1).headers.cookie,undefined);

  // Ordinary TEST registration remains functional against mocked TEST-only responses.
  await t.page.goto(ORIGIN+'/app/');await t.page.locator('#iig-beta-status').waitFor();await t.page.locator('#openingSplash').waitFor({state:'detached'});
  await t.page.getByRole('button',{name:'Start a golf group',exact:false}).first().click();
  await t.page.locator('#regName').fill('Alex');await t.page.locator('#regGroupName').fill('Beta Fixture Golfers');await t.page.locator('#regSetupEmail').fill('alex@example.test');
  await t.page.locator('#regCreate').click();await t.page.locator('#regCode').fill('123456');await t.page.locator('#regVerify').click();await t.page.locator('#regCreated').waitFor();
  assert.equal(await t.page.locator('#regPin').textContent(),'7394');
  await t.page.locator('#regOpenGroup').click();await t.page.locator('#secureOrganiserBanner').waitFor();
  assert.deepEqual(t.unexpected,[]);assert(!t.calls.some(c=>/\/(get_group_state|save_group_state)$/.test(c.path)));
  assert(t.calls.every(c=>c.headers.apikey===KEY));assert.deepEqual(t.errors,[]);
  await t.page.goto(ORIGIN+'/app/owner-dashboard.html');await t.page.locator('#iig-beta-status').waitFor();
  assert.equal(await t.page.locator('#ownerCodeInput').count(),0);assert.equal(await t.page.locator('#regEmail').isVisible(),true);
  assert.deepEqual(t.unexpected,[]);await t.context.close();
  console.log('PASS: TEST-only artifact; missing/wrong configuration locks without requests; saved/query PIN cannot invoke legacy clients; production hosts, keys/JWTs, redirects, sockets and links blocked; independent CSP; mocked TEST registration and verified owner dashboard. No online traffic.');
 }finally{if(browser)await browser.close();fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exit(1)});
