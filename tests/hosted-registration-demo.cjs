// All HTTPS responses are fulfilled from a generated local artifact. No public host/database contacted.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
(async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'iig-hosted-demo-')),out=path.join(tmp,'site'),origin=process.env.IIG_DEMO_TEST_ORIGIN||'https://fictional-usability.example.test';
 const build=spawnSync('python3',['tools/registration-demo/build_static.py','--out',out,'--origin',origin],{encoding:'utf8'});assert.equal(build.status,0,build.stderr);
 const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER||'/usr/bin/chromium',headless:true});
 try{
 for(const width of [320,390]){
  const format=width===390?'net':'stableford';
  const context=await browser.newContext({viewport:{width,height:width===320?568:844},reducedMotion:'reduce'}),page=await context.newPage(),external=[],errors=[],requests=[],popups=[];
  page.on('pageerror',e=>errors.push(e.message));context.on('page',p=>{if(p!==page)popups.push(p.url());});
  const csp=fs.readFileSync(path.join(out,'_headers'),'utf8').match(/Content-Security-Policy: (.*)/)[1];
  await context.route('**/*',route=>{
   const req=route.request(),u=new URL(req.url());if(u.origin!==origin){external.push(req.url());return route.abort();}
   requests.push({path:u.pathname,method:req.method()});const file=u.pathname==='/'?'index.html':u.pathname==='/app/'?'app/index.html':u.pathname.slice(1);
   const resolved=path.join(out,file);if(!resolved.startsWith(out+path.sep)||!fs.existsSync(resolved)||!fs.statSync(resolved).isFile())return route.fulfill({status:404,body:'Not a demonstration asset'});
   const type=file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':file.endsWith('.html')?'text/html':'text/plain';
   return route.fulfill({status:200,body:fs.readFileSync(resolved),headers:{'content-type':type,'content-security-policy':csp,'cache-control':'no-store'}});
  });
  await context.addInitScript(()=>{localStorage.setItem('existing-golf-data','untouched');sessionStorage.setItem('existing-session','untouched');});
  async function verify(){await page.locator('#regCode').fill('123456');await page.locator('#regVerify').click();}
  await page.goto(origin);await page.locator('#openingSplash').waitFor({state:'detached'});
  await page.getByRole('heading',{name:"Welcome to I'm In Golf",exact:true}).waitFor();assert.equal(await page.locator('#demo-practice-tasks').isVisible(),false);
  const compact=await page.locator('#iig-demo-banner').boundingBox();assert(compact.height<=48);assert(compact.y===0);
  await page.locator('#iig-demo-toggle').click();await page.getByRole('dialog',{name:'Demonstration explanation'}).waitFor();await page.keyboard.press('Escape');assert.equal(await page.locator('#iig-demo-toggle').getAttribute('aria-expanded'),'false');assert.equal(await page.locator('#iig-demo-toggle').evaluate(el=>el===document.activeElement),true);
  await page.locator('#demo-welcome-start').click();await page.getByRole('link',{name:'Try being the organiser'}).click();await page.locator('#openingSplash').waitFor({state:'detached'});
  await page.locator('#demo-task-guide').waitFor();assert.equal(await page.locator('#regName').inputValue(),'');
  await page.getByRole('button',{name:'Start a golf group',exact:false}).first().click();
  await page.locator('#regName').fill('Alex Taylor');await page.locator('#regGroupName').fill('Weekend Fictional Golfers');await page.locator('#regSetupEmail').fill('alex@example.test');
  await page.locator('#regCreate').click();await page.getByText('No email is sent. Enter demonstration code 123456.',{exact:true}).waitFor();
  await page.locator('#regCode').fill('000000');await page.locator('#regVerify').click();await page.getByText('That code is incorrect or has expired.',{exact:false}).waitFor();
  await verify();await page.locator('#regCreated').waitFor();await page.getByText('I’m playing too',{exact:true}).click();
  await page.locator('#regOwnerHandicap').pressSequentially('112');assert.equal(await page.locator('#regOwnerHandicap').inputValue(),'11');
  await page.locator('#regOwnerHandicap').pressSequentially('.2');await page.locator('#regOwnerPlayerForm button').click();await page.getByText('You have been added as a player.',{exact:true}).waitFor();
  await page.locator('#regInvite').click();await page.locator('#secureInviteWhatsApp').click();await page.locator('#iig-demo-preview').waitFor();assert.match(await page.locator('#iig-demo-preview').textContent(),/NOT SENT/);assert.deepEqual(popups,[]);await page.locator('#iig-demo-close').click();
  await page.getByRole('button',{name:'Start First Competition',exact:false}).click();await page.locator('#normalSetupCourse').fill('Fictional Meadow Golf');await page.locator('#guidedDate').fill('2099-10-24');await page.locator('#guidedScoring').selectOption(format);await page.locator('#guidedSave').click();await page.locator('#guidedFirstCompetition').waitFor({state:'detached'});
  await page.locator('#demo-add-friends').click();await page.waitForFunction(()=>IIG_DEMO.practice.snapshot()?.entered===3);await page.locator('#secureOrganiserStatus').filter({hasText:'Reloaded at'}).waitFor();
  await page.locator('#demo-view-scores').click();await page.locator('#scoreInput_0').fill(format==='net'?'71':'35');await page.locator("button[onclick=\"submitPlayerScore(0,'"+format+"')\"]").click();await page.locator('#appConfirmYes').click();await page.locator('#secureOrganiserStatus').filter({hasText:'Saved in this tab only.'}).waitFor();
  await page.locator('#demo-other-scores').click();await page.locator('#secureOrganiserStatus').filter({hasText:'Reloaded at'}).waitFor();await page.locator('#demo-view-scores').click();
  await page.getByRole('button',{name:'Finish Round',exact:false}).click();await page.waitForFunction(()=>IIG_DEMO.practice.snapshot()?.history===1);
  await page.locator('#demo-view-results').click();await page.getByRole('heading',{name:'Previous rounds',exact:true}).waitFor();await page.locator('[onclick="showRoundHistory(0)"]').click();await page.getByText('Fictional Meadow Golf',{exact:true}).first().waitFor();
  assert.equal((await page.evaluate(()=>IIG_DEMO.practice.snapshot())).history,1);assert.match(await page.locator('#screen').textContent(),/Final standings/);assert.match(await page.locator('#screen').textContent(),/Alex Taylor/);
  await page.locator('#demo-feedback').click();await page.locator('#demo-rating').selectOption({label:'Yes, with some hesitation'});await page.locator('#demo-notes').fill('I needed a clearer next step.');await page.locator('#demo-feedback-close').click();await page.locator('#demo-feedback').click();assert.equal(await page.locator('#demo-notes').inputValue(),'I needed a clearer next step.');await page.locator('#demo-feedback-close').click();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:'/tmp/iig-hosted-results-'+width+'.png',fullPage:true});
  // Independent player task: the invitation is fictional and the sample round is already open.
  await page.goto(origin+'/app/?scenario=friend');await page.locator('#openingSplash').waitFor({state:'detached'});await page.locator('#regEmailForm button').click();await verify();await page.locator('#regHandicap').fill('8.5');await page.locator('#regJoinForm button').click();await page.locator('#securePlayerBanner').waitFor();
  await page.getByRole('button',{name:'I’m Playing',exact:false}).click();await page.locator('#securePlayerStatus').filter({hasText:'Saved and checked.'}).waitFor();await page.locator('#demo-view-scores').click();
  const own=page.locator('input[id^=scoreInput_]');await own.fill('35');await page.getByRole('button',{name:'Submit My Score',exact:false}).click();await page.locator('#appConfirmYes').click();await page.waitForFunction(()=>IIG_DEMO.practice.snapshot()?.mySubmitted===true);
  await page.locator('#demo-become-organiser').click();await page.locator('#secureOrganiserBanner').waitFor();await page.locator('#demo-view-scores').click();await page.getByRole('button',{name:'Finish Round',exact:false}).click();await page.waitForFunction(()=>IIG_DEMO.practice.snapshot()?.history===1);
  await page.locator('#demo-view-results').click();await page.getByRole('heading',{name:'Previous rounds',exact:true}).waitFor();
  assert.equal(await page.evaluate(async()=>{try{await fetch('https://database.example.invalid/auth/v1/otp',{method:'POST',body:'{}'});return false;}catch(_){return true;}}),true);
  const nativeBlocks=await page.evaluate(async()=>{const frame=document.createElement('iframe');document.body.append(frame);let blocked=false;try{await frame.contentWindow.fetch('https://external-check.example.invalid/native');}catch(_){blocked=true;}frame.remove();return blocked;});assert(nativeBlocks,'CSP must independently block native fetch');
  assert.equal(await page.evaluate(()=>localStorage.getItem('existing-golf-data')),'untouched');assert.equal(await page.evaluate(()=>sessionStorage.getItem('existing-session')),'untouched');
  assert(requests.every(r=>r.method==='GET'&&!r.path.startsWith('/auth/')&&!r.path.startsWith('/rest/')));assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  // A refresh really resets the in-memory exercise, not a shared account/database.
  await page.reload();await page.waitForFunction(()=>IIG_DEMO.practice.snapshot()===null);await context.close();
 }
 const wrong=await browser.newContext(),locked=await wrong.newPage(),wrongRequests=[];
 await wrong.route('**/*',route=>{const u=new URL(route.request().url());wrongRequests.push(u.pathname);const file=u.pathname==='/app/'?'app/index.html':u.pathname.slice(1),p=path.join(out,file);return route.fulfill({status:fs.existsSync(p)?200:404,body:fs.existsSync(p)?fs.readFileSync(p):'Missing',headers:{'content-type':file.endsWith('.js')?'application/javascript':'text/html'}});});
 await locked.goto('https://unapproved-host.example.test/app/');await locked.getByText('DEMONSTRATION unavailable:',{exact:false}).waitFor();assert.equal(await locked.evaluate(()=>typeof IIG_DEMO),'undefined');assert(!wrongRequests.some(p=>p.startsWith('/auth/')||p.startsWith('/rest/')));await wrong.close();
 console.log('PASS: HTTPS static artifact at 320/390px; organiser registration/invitation/competition/scoring/finish/history, invited player entry/score/role simulation/results, feedback, isolation and reset. All requests fulfilled locally; no online traffic.');
 }finally{await browser.close();fs.rmSync(tmp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exit(1)});
