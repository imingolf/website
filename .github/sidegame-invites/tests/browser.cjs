const {chromium}=require('playwright');const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../../..'),source=fs.readFileSync(path.join(root,'app/index.html'),'utf8');
function extract(name){const start=source.search(new RegExp('^(?:async )?function '+name+'\\(','m'));const endings=/\n[ \t]*}/g;endings.lastIndex=start;for(let m;(m=endings.exec(source));){const s=source.slice(start,endings.lastIndex);try{new vm.Script(s);return s;}catch{}}throw Error(name);}
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});try{
 const page=await browser.newPage({viewport:{width:390,height:844}});await page.route('**/*',route=>route.abort());
 const css=Array.from(source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g),m=>m[1]).join('\n');
 await page.setContent('<style>'+css+'</style><main id="screen"><div class="card"><h2>Your group</h2><p>Review example</p></div></main>');
 await page.addScriptTag({content:`var myPlayerId='recipient',pin='7771',sideGameOpen=false,sideGameHomeOpen=false;
 var state={groupName:'Review group',players:[{id:'sender',name:'Alex'},{id:'recipient',name:'You'}],sideGame:{scores:[],settlements:[],bets:[{id:'example',player1Id:'sender',player1Name:'Alex',player2Id:'recipient',player2Name:'You',stake:5,format:'match',date:'2026-11-17',status:'pending',setup:'challenge'}]}};
 var $=id=>document.getElementById(id);var sideGameToday=()=> '2026-11-17';var ensureSideGameState=()=>{};var sideGameResolveBetsForToday=()=>{};var sideGameSettlementConfirmationsHtml=()=>'';var esc=s=>String(s).replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');var escAttr=esc;
 var sideGameAcceptChallenge=id=>{window.accepted=id;state.sideGame.bets[0].status='active';};var sideGameDeclineChallenge=id=>{window.declined=id;state.sideGame.bets[0].status='declined';};
 `+[ 'sideGamePendingInvites','sideGameInviteNotice','sideGameHome'].map(extract).join('\n')});
 await page.evaluate(()=>sideGameInviteNotice());assert.equal(await page.getByRole('button',{name:'View invite',exact:true}).count(),1);
 await page.screenshot({path:path.join(__dirname,'invite-notice.png'),fullPage:true});
 await page.getByRole('button',{name:'View invite',exact:true}).click();await page.getByRole('button',{name:'✓ Accept',exact:true}).waitFor();
 await page.screenshot({path:path.join(__dirname,'invite-details.png'),fullPage:true});
 await page.getByRole('button',{name:'✓ Accept',exact:true}).click();assert.equal(await page.evaluate(()=>window.accepted),'example');
 await page.setContent('<style>'+css+'</style><main class="card" id="account"><h2>My account</h2></main>');
 await page.evaluate(()=>{window.testPrefs={available:true,enabled:false,sideAvailable:true,sideEnabled:false};window.IigNotifications={postMessage(raw){const m=JSON.parse(raw);if(m.action==='sync')setTimeout(()=>window.dispatchEvent(new CustomEvent('iig-native-notifications',{detail:{requestId:m.requestId,permission:'authorized',fid:'synthetic-phone-1234567890'}})),0);}};});
 await page.addScriptTag({content:fs.readFileSync(path.join(root,'app/native-reminders.js'),'utf8')});
 await page.evaluate(()=>{window.iigNativeReminders.connect('synthetic-user',async(url,args)=>{if(url.endsWith('iig_set_side_invites'))window.testPrefs.sideEnabled=args.p_enabled;if(url.endsWith('iig_register_native_reminders'))return true;return {...window.testPrefs};});window.iigNativeReminders.mount(document.getElementById('account'));});
 await page.getByRole('switch',{name:'Side Game invites',exact:true}).check();
 await page.getByText('This phone is ready for the alerts you have switched on.',{exact:true}).waitFor();
 assert.equal(await page.getByRole('switch',{name:'Competition reminders',exact:true}).isChecked(),false);
 await page.screenshot({path:path.join(__dirname,'notification-settings.png'),fullPage:true});
 console.log('PASS mobile invite notice, View invite navigation, Accept action, independent settings and ready state');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
