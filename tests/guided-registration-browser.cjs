// Rendered mobile/desktop journey. Every request is fulfilled locally; no real email or database.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER||'/usr/bin/chromium',headless:true});
 for(const viewport of [{width:320,height:640},{width:390,height:844},{width:1024,height:900}]){
  const context=await browser.newContext({viewport,serviceWorkers:'block',reducedMotion:'reduce'}),page=await context.newPage();
  const errors=[],calls=[];page.on('pageerror',e=>errors.push(e.message));let created=false;
  const group={group_pin:'3520',revision:0,invite_token:'11111111-1111-4111-8111-111111111111',state:{groupName:'Weekend <Golfers>',players:[],history:[],course:'',date:'',roundOpen:false,gameType:'money',pointsCompetition:'stableford',custom:'preserve'}};
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.hostname==='nyavvwrsrxqfyhiygkgw.supabase.co'){
    const body=route.request().postDataJSON();calls.push({path:url.pathname,body});let data={};
    if(url.pathname==='/auth/v1/verify'){
     if(body.token==='000000')return route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({msg:'Token has expired'})});
     data={access_token:'fixture-only',expires_in:3600,user:{id:'alex',email:'alex@example.test'}};
    }else if(url.pathname.endsWith('iig_get_owned_group'))data=created?group:null;
    else if(url.pathname.endsWith('iig_create_owned_group')){created=true;data={group_pin:'3520'};}
    else if(url.pathname.endsWith('get_group_access_status'))data=[{access_allowed:true,plan_type:'trial'}];
    else if(url.pathname.endsWith('iig_join_owned_group')){group.state.players=[{id:'alex-player',name:body.p_name,handicap:body.p_handicap,leaguePoints:0}];group.revision++;data='alex-player';}
    else if(url.pathname.endsWith('iig_save_owned_group')){assert.equal(body.p_revision,group.revision);group.state=body.p_state;data=++group.revision;}
    else if(!['/auth/v1/otp','/auth/v1/logout'].includes(url.pathname))throw Error('Unexpected fixture endpoint '+url.pathname);
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
   }
   if(url.hostname==='localhost'){
    if(url.pathname==='/app/config.js')return route.fulfill({contentType:'application/javascript',body:'window.TENS_IN_CONFIG={supabaseUrl:"https://fixture.invalid"};'});
    const file=path.join(__dirname,'..',url.pathname.replace(/^\//,''));
    if(fs.existsSync(file)&&fs.statSync(file).isFile())return route.fulfill({path:file});
   }
   // CDN libraries aren't needed by the protected adapter; never allow network fallthrough.
   return route.fulfill({status:200,body:'',contentType:'application/javascript'});
  });
  await page.goto('http://localhost/app/index.html');
  await page.locator('#openingSplash').waitFor({state:'detached'});
  await page.getByRole('button',{name:'Start a golf group',exact:false}).first().click();
  await page.locator('#regName').fill('Alex');await page.locator('#regGroupName').fill('Weekend <Golfers>');await page.locator('#regSetupEmail').fill('alex@example.test');
  await page.locator('#regCreate').click();await page.locator('#regCode').fill('000000');await page.locator('#regVerify').click();
  await page.getByText('That code is incorrect or has expired.',{exact:false}).waitFor();
  await page.locator('#regCode').fill('123456');await page.locator('#regVerify').click();await page.locator('#regCreated').waitFor();
  assert.equal(calls.filter(c=>c.path.endsWith('iig_create_owned_group')).length,1);
  assert.equal(await page.locator('#regCreatedName').textContent(),'Weekend <Golfers>');
  await page.getByText('I’m playing too',{exact:true}).click();
  const handicap=page.locator('#regOwnerHandicap');
  for(const value of ['11.2','12','22.7','8.5']){await handicap.fill('');await handicap.pressSequentially(value);assert.equal(await handicap.inputValue(),value);}
  await handicap.fill('');await handicap.pressSequentially('112');assert.equal(await handicap.inputValue(),'11');
  await handicap.pressSequentially('.2');assert.equal(await handicap.inputValue(),'11.2');await handicap.pressSequentially('3');assert.equal(await handicap.inputValue(),'11.2');
  async function paste(value){return handicap.evaluate((el,value)=>{el.focus();el.select();const data=new DataTransfer();data.setData('text',value);return el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));},value);}
  assert.equal(await paste('227'),false);assert.equal(await handicap.inputValue(),'11.2');
  assert.equal(await paste('11.22'),false);assert.equal(await handicap.inputValue(),'11.2');
  assert.equal(await handicap.getAttribute('inputmode'),'decimal');
  await page.locator('#regOwnerPlayerForm button').click();await page.getByText('You have been added as a player.',{exact:true}).waitFor();
  assert.equal(group.state.roundOpen,false);assert.equal(group.state.players[0].handicap,11.2);
  await page.screenshot({path:'/tmp/iig-guided-ready-'+viewport.width+'.png',fullPage:false});
  await page.locator('#regInvite').click();await page.locator('#secureInviteBox').waitFor();
  const whatsapp=new URL(await page.locator('#secureInviteWhatsApp').getAttribute('href')).searchParams.get('text');
  assert(whatsapp.includes('#pin=3520&invite='));assert(whatsapp.includes('Weekend <Golfers>'));assert(!whatsapp.includes('fixture-only'));assert.equal(group.state.roundOpen,false);
  await page.locator('#secureOrganiserAccount').click();
  const accountHandicap=page.locator('#accountHandicap');await accountHandicap.pressSequentially('120');assert.equal(await accountHandicap.inputValue(),'12');
  await page.locator('#accountClose').click();
  // Both legacy handicap dialogs use the same guard without saving anything.
  await page.evaluate(()=>{void appPrompt('Golf handicap','', '',{handicap:true,inputmode:'decimal'});});
  await page.locator('#appPromptInput').pressSequentially('227');assert.equal(await page.locator('#appPromptInput').inputValue(),'22');await page.locator('#appPromptCancel').click();
  await page.evaluate(()=>{void playerJoinForm();});
  await page.locator('#joinHandicap').fill('');await page.locator('#joinHandicap').pressSequentially('112');assert.equal(await page.locator('#joinHandicap').inputValue(),'11');await page.locator('#joinCancel').click();
  await page.getByRole('button',{name:'Start First Competition',exact:false}).click();
  await page.locator('#normalSetupCourse').fill('Local course');await page.locator('#guidedDate').fill('2099-10-24');await page.locator('#guidedScoring').selectOption('net');
  await page.screenshot({path:'/tmp/iig-guided-competition-'+viewport.width+'.png',fullPage:false});
  assert.equal(await page.locator('#guidedFirstCompetition').evaluate(el=>el.scrollWidth>el.clientWidth),false);
  await page.locator('#guidedSave').click();await page.locator('#guidedFirstCompetition').waitFor({state:'detached'});
  assert.equal(group.state.roundOpen,true);assert.equal(group.state.pointsCompetition,'net');assert.equal(group.state.custom,'preserve');assert.deepEqual(group.state.history,[]);assert.equal(group.state.players[0].handicap,11.2);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);await context.close();
 }
 await browser.close();console.log('PASS: 320/390/1024px guided registration, code error/retry, automatic creation, organiser joining, real typing/paste events, WhatsApp invitation before round, first competition and preserved data. All HTTP mocked.');
})().catch(e=>{console.error(e);process.exit(1)});
