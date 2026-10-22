// Browser integration with mocked HTTP responses. No real email or database writes.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch(process.env.TEST_BROWSER ? {executablePath:process.env.TEST_BROWSER,headless:true} : {headless:true});
 const context=await browser.newContext({viewport:{width:390,height:844}});
 const page=await context.newPage(); const calls=[]; let created=false, failedRead=false, dashboardDenied=false;
 const group={group_pin:'4321',group_id:10,state:{groupName:'Sunday <Golfers>'}};
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.hostname==='nyavvwrsrxqfyhiygkgw.supabase.co'){
   const body=route.request().postDataJSON(); calls.push({path:url.pathname,body}); let data={},status=200;
   if(url.pathname.endsWith('/verify')) data={access_token:'fake-test-token',expires_in:3600,user:{id:'00000000-0000-4000-8000-000000000001',email:'test@example.test'}};
   if(url.pathname.endsWith('iig_get_owned_group')) {data=created?group:null;if(failedRead){failedRead=false;status=503;data={message:'Read failed'};}}
   if(url.pathname.endsWith('iig_create_owned_group')) {created=true;failedRead=true;data=group;}
   if(url.pathname.endsWith('iig_list_registered_groups')) {
    data=[{...group,group_name:'Sunday <Golfers>',admin_name:'Test Organiser',admin_contact:'test@example.test',plan_type:'trial',trial_expiry_date:'2099-01-15',status:'active'}];
    if(dashboardDenied){status=403;data={message:'Platform owner access required'};}
   }
   return route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  }
  if(url.hostname==='deploy-preview-6--super-quokka-51747d.netlify.app'){
   if(url.pathname==='/app/config.js') return route.fulfill({contentType:'application/javascript',body:'window.TENS_IN_CONFIG={supabaseUrl:"https://fixture.invalid"};'});
   const file=path.join(__dirname,'..',url.pathname.replace(/^\//,''));
   if(fs.existsSync(file)&&fs.statSync(file).isFile()) return route.fulfill({path:file});
  }
  return route.fulfill({status:200,body:'',contentType:'application/javascript'});
 });
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('https://deploy-preview-6--super-quokka-51747d.netlify.app/app/index.html');
 await page.getByRole('button',{name:'Start a golf group',exact:false}).first().click();
 assert.equal(await page.getByText('Request my group by email').count(),0);
 assert(await page.locator('#regEmail').isVisible());
 async function login(){await page.locator('#regEmail').fill('test@example.test');await page.locator('#regEmailForm button').click();await page.locator('#regCode').fill('12345678');await page.locator('#regCodeForm button').first().click();}
 await login();await page.locator('#regGroupForm').waitFor({state:'visible'});
 await page.locator('#regName').fill('Test Organiser');await page.locator('#regGroupName').fill('Sunday <Golfers>');
 await page.screenshot({path:'/tmp/iig-registration-mobile.png',fullPage:true});
 await page.locator('#regGroupForm button').click();
 await page.getByText('Your group was created. Tap Check my group to reload its details.').waitFor();
 assert.equal(await page.locator('#regPin').textContent(),'4321');
 await page.locator('#regReload').click();await page.getByText('Your group is saved.',{exact:true}).waitFor();
 assert.equal(await page.locator('#regCreatedName').textContent(),'Sunday <Golfers>');
 assert.equal(calls.filter(c=>c.path.endsWith('iig_create_owned_group')).length,1);
 await page.locator('#regSignout').click();await page.locator('#regEmailForm').waitFor({state:'visible'});
 await login();await page.locator('#regCreated').waitFor({state:'visible'});
 assert.equal(calls.filter(c=>c.path.endsWith('iig_create_owned_group')).length,1);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.goto('https://deploy-preview-6--super-quokka-51747d.netlify.app/app/owner-dashboard.html');
 dashboardDenied=true;await login();await page.getByText('Platform owner access required',{exact:true}).waitFor();
 assert.equal(await page.locator('#dashView').isVisible(),false);
 dashboardDenied=false;await page.locator('#regReload').click();await page.locator('#registerRows tr').waitFor();
 assert.match(await page.locator('#registerRows').textContent(),/Sunday <Golfers>.*Test Organiser.*test@example.test/);
 assert.equal(await page.locator('#registerRows script').count(),0);
 await page.setViewportSize({width:1280,height:900});
 await page.screenshot({path:'/tmp/iig-registration-dashboard.png',fullPage:true});
 await page.locator('#registerLogout').click();await page.locator('#regEmailForm').waitFor({state:'visible'});
 assert.equal(await page.locator('#dashView').isVisible(),false);
 assert.deepEqual(errors,[]);
 console.log('PASS: actual welcome form, email verification, create/readback failure, safe retry, return login, escaped text, mobile width, owner denial, dashboard rendering and sign-out. HTTP mocked; hosted email/JWT still requires the test database migration.');
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
