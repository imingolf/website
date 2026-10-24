// Entirely fictional Group 1010 fixture. No network, SQL or existing records.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(__dirname+'/../app/index.html','utf8');
function extract(name){
 const start=source.search(new RegExp('^(?:async )?function '+name+'\\(','m'));
 if(start<0)throw Error(name);
 const ends=/\n[ \t]*}/g;ends.lastIndex=start;
 for(let m;(m=ends.exec(source));){const text=source.slice(start,ends.lastIndex);try{new vm.Script(text);return text;}catch{}}
 throw Error('Cannot parse '+name);
}
function fixture(scored=true){return {roundId:'fictional-round',roundOpen:true,course:'Fictional Course',date:'2026-10-24',stake:10,gameType:'money',paymentLink:'https://example.invalid/pay',players:[
 {id:'a',name:'Fictional A',paid:true,stableford:scored?32:null,netScore:null},
 {id:'b',name:'Fictional B',paid:true,stableford:null,netScore:null},
 {id:'c',name:'Fictional C',paid:true,stableford:null,netScore:null},
 {id:'d',name:'Fictional D',paid:false,stableford:null,netScore:null}],history:[]};}
function context(scored=true){
 const screen={innerHTML:''};
 const c={console:{count(){}},Date,Number,String,Object,Boolean,JSON,Promise,
 pin:'1010',state:fixture(scored),myPlayerId:'d',isAdmin:false,paymentLaunchBusy:false,paymentReturnBusy:false,
 messages:[],writes:[],opens:0,journeyCleared:0,poller:null,
 $:()=>screen,document:{visibilityState:'visible',createElement(){throw Error('Unexpected payment prompt');}},
 window:{open(){c.opens++;return {};},location:{assign(){c.opens++;}}},
 alert(message){c.messages.push(message);},showAppToast(...message){c.messages.push(message.join(' '));},
 clearPaymentJourney(){c.journeyCleared++;},render(){},demoCanEdit:()=>true,demoReadOnly:()=>false,
 setTimeout(){},clearInterval(){},startPolling(){},adminDeviceRecognised:()=>false,
 esc:x=>String(x),currentRoundPlayers:()=>c.state.players,waitingForNextCompetition:()=>false,
 tripPlayerIsPlaying:()=>true,waitingScreen(){},rememberPaymentJourney(){},paymentLinkForStake:x=>x,
 readPaymentJourney:()=>({playerId:'d',startedAt:Date.now()-5000,groupPin:'1010',roundId:'fictional-round'}),
 appConfirm:async()=>true,showBigPlayerMessage(){throw Error('Unexpected congratulations');},
 save:async()=>{c.writes.push(structuredClone(c.state));return true;}};
 c.db={rpc:async()=>({data:structuredClone(c.server||c.state)})};
 vm.createContext(c);
 for(const name of ['sameEntryRound','roundLocked','roundOpenNow','entryClosed','entryClosedMessage','refreshEntryState','pay','beginPlayerPayment','recognisePaymentReturn','adminSelfEnter','togglePaid','enterNormalPointsGame','paidCount','pot','potentialPot','savePlayerPatch'])vm.runInContext(extract(name),c);
 c.screen=screen;return c;
}
(async()=>{
 let count=0;
 for(const mode of ['stableford','net','nr','pair']){
  const c=context(false);const a=c.state.players[0];
  if(mode==='stableford')a.stableford=0;
  if(mode==='net')a.netScore=70;
  if(mode==='nr')a.noReturn=true;
  if(mode==='pair')c.state.trip={currentTeamScores:{fictionalPair:0}};
  assert.equal(c.entryClosed(),true);
  const before=JSON.stringify(c.state);c.pay();assert.match(c.screen.innerHTML,/Entries Closed/);
  assert.doesNotMatch(c.screen.innerHTML,/Pay & Join|beginPlayerPayment|adminSelfEnter/);
  await c.beginPlayerPayment();await c.recognisePaymentReturn();await c.recognisePaymentReturn();
  assert.equal(c.opens,0);assert.equal(c.writes.length,0);assert.equal(JSON.stringify(c.state),before);
  assert.equal(c.paidCount(),3);assert.equal(c.pot(),30);count++;
 }
 // A stale open screen must re-read before opening a payment provider.
 let c=context(false);c.server=fixture(true);await c.beginPlayerPayment();assert.equal(c.opens,0);assert.equal(c.writes.length,0);count++;
 // Returning from payment with a stale open local snapshot cannot confirm entry.
 c=context(false);c.server=fixture(true);await c.recognisePaymentReturn();assert.equal(c.writes.length,0);assert.equal(c.paymentReturnBusy,false);count++;
 // Admin/player mode, including recognised admin device, may not alter the closed pot.
 c=context();c.isAdmin=true;c.pay();assert.doesNotMatch(c.screen.innerHTML,/beginPlayerPayment|adminSelfEnter/);
 assert.match(c.screen.innerHTML,/disabled/);await c.togglePaid(3);await c.togglePaid(0);await c.adminSelfEnter();assert.equal(c.writes.length,0);assert.equal(c.pot(),30);count++;
 // Existing entrants keep paid state and access to payments (scoring logic untouched).
 c=context();c.myPlayerId='b';c.pay();assert.match(c.screen.innerHTML,/Payments/);assert.doesNotMatch(c.screen.innerHTML,/beginPlayerPayment/);assert.equal(c.state.players[1].paid,true);count++;
 // Existing paid entrant can still submit a score without changing entry/pot.
 c=context();c.myPlayerId='b';assert.equal(await c.savePlayerPatch('b',{stableford:35,scoreSubmitted:true}),true);
 assert.equal(c.state.players[1].stableford,35);assert.equal(c.state.players[1].paid,true);assert.equal(c.pot(),30);count++;
 // Failed read cannot open an external payment app.
 c=context(false);c.db.rpc=async()=>{throw Error('offline');};await c.beginPlayerPayment();assert.equal(c.opens,0);count++;
 // A legitimate pre-score payment still launches, without marking paid prematurely.
 c=context(false);await c.beginPlayerPayment();assert.equal(c.opens,1);assert.equal(c.state.players[3].paid,false);count++;
 // A stale Admin screen also re-reads before changing payment status.
 c=context(false);c.isAdmin=true;c.server=fixture(true);await c.togglePaid(3);assert.equal(c.writes.length,0);count++;
 // First score arrives while the payment confirmation dialog is open.
 c=context(false);let reads=0;
 c.db.rpc=async()=>({data:reads++===0?fixture(false):fixture(true)});
 c.document.createElement=()=>({style:{},set innerHTML(value){},remove(){},querySelector(id){
   return {set onclick(fn){if(id==='#paymentReturnYes')queueMicrotask(fn);}};
 }});c.document.body={appendChild(){}};
 await c.recognisePaymentReturn();assert.equal(c.writes.length,0);assert.equal(c.paymentReturnBusy,false);assert.equal(c.pot(),30);count++;
 // Round changes during payment refresh cannot admit a returning player.
 c=context(false);c.server=fixture(false);c.server.roundId='different-round';await c.beginPlayerPayment();assert.equal(c.opens,0);count++;
 // Free competition attendance follows the same closure rule after refresh.
 c=context(false);c.state.gameType='points';c.server=fixture(true);c.server.gameType='points';await c.enterNormalPointsGame();assert.equal(c.writes.length,0);count++;
 for(const match of source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))new vm.Script(match[1]);
 console.log(`PASS: ${count} closed-entry scenarios; first score/NR/pair score, stale screens, repeated returns, Admin/Player payments, £30 pot and pre-score payment. No network or SQL.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
