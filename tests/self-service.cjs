// Browser integration with mocked HTTP responses. No real email or database writes.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch(process.env.TEST_BROWSER ? {executablePath:process.env.TEST_BROWSER,headless:true} : {headless:true});
 const context=await browser.newContext({viewport:{width:390,height:844}});
 const page=await context.newPage(); const calls=[]; let created=false, failedRead=false, dashboardDenied=false;
 const playerGroup={player_id:'member',revision:1,state:{groupName:'Sunday Golfers',course:'Player Course',date:'2099-10-24',gameType:'points',pointsCompetition:'stableford',roundOpen:false,players:[{id:'member',name:'Test Player',handicap:11,leaguePoints:10}],history:[{course:'Historic Course',date:'2026-10-01',gameType:'points',pointsCompetition:'stableford',players:[],pointsResults:[{name:'Test Player',score:36,points:10}]}]}};
 const group={group_pin:'4321',group_id:10,state:{groupName:'Sunday <Golfers>'}};
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.hostname==='nyavvwrsrxqfyhiygkgw.supabase.co'){
   const body=route.request().postDataJSON(); calls.push({path:url.pathname,body}); let data={},status=200;
   if(url.pathname.endsWith('/verify')) data={access_token:'fake-test-token',expires_in:3600,user:{id:'00000000-0000-4000-8000-000000000001',email:'test@example.test'}};
   if(url.pathname.endsWith('iig_get_owned_group')) {data=created?group:null;if(failedRead){failedRead=false;status=503;data={message:'Read failed'};}}
   if(url.pathname.endsWith('iig_create_owned_group')) {created=true;failedRead=true;data=group;}
   if(url.pathname.endsWith('iig_get_player_group')) data=playerGroup;
   if(url.pathname.endsWith('iig_player_action')){
    assert.equal(body.p_revision,playerGroup.revision);
    if(body.p_action==='payment')playerGroup.state.players[0].paid=true;
    else if(body.p_action==='team_score')playerGroup.state.trip.currentTeamScores[body.p_payload.team_id]=body.p_payload.score;
    else if(body.p_action==='side_create')playerGroup.state.sideGame.bets.push({id:'bet',player1Id:'member',player2Id:'other',player1Name:'Test Player',player2Name:'Partner',stake:body.p_payload.stake,format:body.p_payload.format,date:playerGroup.state.sideGameDate,status:'pending',setup:'challenge'});
    else throw Error('Unexpected action '+body.p_action);
    data=++playerGroup.revision;
   }
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
 await page.clock.install();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('https://deploy-preview-6--super-quokka-51747d.netlify.app/app/index.html');
 await page.getByRole('button',{name:'Start a golf group',exact:false}).first().click();
 assert.equal(await page.getByText('Request my group by email').count(),0);
 await page.locator('#regReturning').click();
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
 await page.clock.fastForward(61000); // Respect the one-minute OTP resend limit on returning login.
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
 await page.goto('https://deploy-preview-6--super-quokka-51747d.netlify.app/app/index.html#pin=3520');
 await login();await page.locator('#securePlayerBanner').waitFor();
 await page.locator('#nleague').click();
 await page.locator('[onclick="showRoundHistory(0)"]').click();
 await page.getByRole('heading',{name:'Historic Course'}).waitFor();
 // Rendered Money payment-status declaration, then the original Trip and Side Game forms.
 playerGroup.state={...playerGroup.state,roundId:'browser-money',gameType:'money',stake:10,roundOpen:true,paymentLink:'https://monzo.me/golfer',sideGame:{bets:[],scores:[],settlements:[]},sideGameDate:new Date().toLocaleDateString('en-CA',{timeZone:'Europe/London'}),players:[{id:'member',name:'Test Player',handicap:11,paid:false},{id:'other',name:'Partner',handicap:12,paid:false}]};playerGroup.revision++;
 await page.locator('#securePlayerReload').click();await page.locator('#npay').click();
 await page.locator('#securePlayerConfirmPayment').click();await page.locator('#appConfirmYes').click();
 await page.getByText('Saved and checked.',{exact:true}).waitFor();assert(playerGroup.state.players[0].paid);assert(!playerGroup.state.players[1].paid);
 playerGroup.state.players[1].paid=true;playerGroup.state.pointsCompetition='net';
 playerGroup.state.trip={active:true,currentFormat:'pairsaggregate',currentRound:1,totalRounds:2,currentPlayingIds:['member','other'],currentTeams:[{id:'pair',playerIds:['member','other']}],currentTeamScores:{},rounds:[]};playerGroup.revision++;
 await page.locator('#securePlayerReload').click();await page.locator('#nscores').click();
 await page.locator('#tripTeamScore_pair').fill('142');await page.getByRole('button',{name:'Submit Pair Score',exact:false}).click();await page.locator('#appConfirmYes').click();
 await page.getByText('Pair score submitted',{exact:true}).waitFor();assert.equal(playerGroup.state.trip.currentTeamScores.pair,142);
 playerGroup.state.trip={active:false};playerGroup.revision++;
 await page.locator('#securePlayerReload').click();await page.locator('#nround').click();
 await page.getByRole('button',{name:'Open Side Game',exact:false}).click();
 await page.getByRole('button',{name:'Challenge another player',exact:false}).click();
 await page.getByRole('button',{name:'Partner',exact:false}).click();
 await page.getByRole('button',{name:'Send Challenge',exact:false}).click();
 await page.locator('#sideGameStake').fill('5');await page.locator('#sideGameStableford').click();
 await page.locator('#sideGameConfirm').click();await page.getByText(/Challenge saved/).waitFor();assert.equal(playerGroup.state.sideGame.bets[0].status,'pending');
 await page.locator('#securePlayerAccount').click();await page.getByRole('dialog',{name:'My account'}).waitFor();
 await page.locator('#accountClose').click();
 assert(!calls.some(c=>/\/(?:get_group_state|save_group_state)$/.test(c.path)));
 await page.locator('#securePlayerSignout').click();
 await page.locator('#securePlayerBanner').waitFor({state:'detached'});
 assert.equal(await page.evaluate(()=>state.players.length+state.history.length),0);
 assert.deepEqual(errors,[]);
 console.log('PASS: actual welcome form, email verification, create/readback failure, safe retry, return login, escaped text, mobile width, owner denial, dashboard rendering, protected player payments, Trip pairs, Side Game forms, account dialog and sign-out. HTTP mocked; hosted email/JWT still requires the test database migration.');
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
