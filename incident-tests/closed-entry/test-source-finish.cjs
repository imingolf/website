// Execute ACTUAL repository Finish Round functions with fictional state and mocked
// I/O, then persist the exact result through the isolated protected SQL boundary.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const source=fs.readFileSync(__dirname+'/../../app/index.html','utf8');
const clone=x=>JSON.parse(JSON.stringify(x));
function extract(name){
 const start=source.search(new RegExp('^(?:async )?function '+name+'\\(','m'));
 if(start<0)throw Error('Missing actual app function '+name);
 const ends=/\n[ \t]*}/g;ends.lastIndex=start;
 for(let m;(m=ends.exec(source));){const code=source.slice(start,ends.lastIndex);try{new vm.Script(code);return code;}catch{}}
 throw Error('Cannot parse '+name);
}
function fixture({game='money',format='stableford',trip=false,last=false,pair=null,tied=false,nr=false}){
 const playing=pair?4:3;
 const players=Array.from({length:playing+1},(_,i)=>({id:String.fromCharCode(97+i),name:'Fictional '+String.fromCharCode(65+i),
  handicap:10+i,paid:game==='money'&&i<playing,playingThisRound:i<playing,
  stableford:!pair&&i<playing&&format==='stableford'?(tied&&i<2?38:38-i):null,
  netScore:!pair&&!nr&&i<playing&&format==='net'?(tied&&i<2?70:70+i):null,
  noReturn:nr&&i<playing,scoreSubmitted:!pair&&i<playing,competition:null,
  wins:i===1?1:0,leaguePoints:4,netWinnings:0,paymentMarkedAt:i<playing?'fictional-payment-metadata':null}));
 const state={roundId:'fictional-source-round',roundOpen:true,course:'Fictional Course',date:'2026-10-24',stake:game==='money'?10:0,
  gameType:game,pointsCompetition:format,pointsValue:10,splitPrizes:true,secondPrize:2,thirdPrize:1,
  sideGame:{settlements:[{id:'fictional-settled',status:'settled'}]},
  history:[{id:'previous-result',course:'Previous fictional course',gameType:'money',pointsCompetition:'stableford',stablefordPot:20,netPot:0,winners:['Fictional B'],stablefordWinnerNames:['Fictional B'],players:clone(players),payouts:[{winnerName:'Fictional B',amount:20,status:'paid'}]}],players,trip:{}};
 if(trip){state.trip={active:true,name:'Fictional Trip',competition:format,currentRound:last?2:1,totalRounds:2,
  tripPointsEnabled:true,tripPointsValue:10,playerIds:players.slice(0,playing).map(p=>p.id),
  currentPlayingIds:players.slice(0,playing).map(p=>p.id),currentFormat:pair||'individual',
  rounds:last?[{tripFormat:'individual',players:clone(players),pointsCompetition:format}]:[],
  standings:{'Fictional A':3},teamStandings:{'Fictional B':2},
  plan:[1,2].map(day=>({format:pair||'individual',course:'Fictional Trip Course '+day,date:'2026-10-'+(24+day),gameType:game,stake:game==='money'?10:0,splitPrizes:true,secondPrize:2,thirdPrize:1}))};
  if(pair){state.trip.currentTeams=[{id:'ab',playerIds:['a','b']},{id:'cd',playerIds:['c','d']}];
   state.trip.currentTeamScores=pair==='pairsaggregate'&&format==='net'?{ab:140,cd:146}:{ab:38,cd:35};
   state.trip.currentGroups=[['a','b','c','d']];}
 }
 return state;
}
async function originalFinish(before,options={}){
 let saved;
 const c={console,Number,String,Boolean,JSON,Object,Array,Math,Date,Promise,crypto:require('node:crypto').webcrypto,
  pin:options.pin||'fictional-pin',state:options.bridge?before:clone(before),isAdmin:true,myPlayerId:'a',finishRoundActive:false,normalFinishInProgress:false,
  scoreDraftActive:false,saveActive:false,savePending:0,saveQueue:Promise.resolve(),stateSaveVersion:0,page:'round',demoReadOnly:()=>false,demoCanEdit:()=>true,
  showAppToast(){},render(){},showWinnerScreen(){},showTripSummary(){},showTripBetterBallResult(){},
  alert(message){throw Error('Unexpected app alert: '+message);},appPrompt:async()=> '1',
  appConfirm:async()=>true,$:()=>({textContent:''})};
 c.db={rpc:async(name,args)=>{if(name==='get_group_state')return {data:clone(c.state)};assert.equal(name,'save_group_state');saved=clone(args.p_state);return {data:true};}};
 if(options.bridge){
  c.db=options.bridge.db;
  c.iigEntryBridge={...options.bridge,commit:async(...args)=>{
   if(options.operations)options.operations.push(args[0]);
   const result=await options.bridge.commit(...args);if(result.data===true)saved=clone(c.state);return result;
  }};
 }
 vm.createContext(c);
 for(const name of ['save','finishRound','finishRoundImpl','createWinnerPayouts','currentRoundPlayers','tripPlayingIds','tripPlayerIsPlaying',
  'tripRoundFormat','tripBetterBallActive','tripPairsAggregateActive','tripTeamRoundActive','tripFormatLabel','paidCount','pot',
  'stablefordPaidCount','netPaidCount','stablefordPot','netPot','tripPointsEnabled','tripStandingsSorted','tripTeamStandingsSorted',
  'tripIndividualScoreRows','tripPerformanceTopRows','setTripChampion','tripTeamName','tripBetterBallEligibleTeams','finishTripBetterBallRound'])
  vm.runInContext(extract(name),c);
 await c.finishRound();assert.ok(saved,'Original app must finish and save');return saved;
}
async function originalSetup(after,format,options={}){
 let saved;
 const c={state:options.bridge?after:clone(after),isAdmin:true,Number,String,Boolean,Array,Object,Math,Date,JSON,
  pin:options.pin||'fictional-pin',saveActive:false,savePending:0,saveQueue:Promise.resolve(),stateSaveVersion:0,
  demoReadOnly:()=>false,$:()=>({textContent:''}),
  createRoundId:()=> 'client-generated-setup-id',
  chooseNewRoundGameType:async()=>after.gameType==='points'?'2':'1',
  chooseRoundCompetition:async()=>format,
  normalRoundSetup:async()=>({course:'Next Fictional Course',date:'2026-10-27',stake:10,splitPrizes:true,secondPrize:2,thirdPrize:1}),
  tripRoundDaySetup:async()=>({playingIds:[...after.trip.playerIds],groups:[[...after.trip.playerIds]],teams:after.trip.currentTeams||[]}),
  alert(message){throw Error('Unexpected setup alert: '+message);},show(){},
  };
 c.db={rpc:async(name,args)=>{assert.equal(name,'save_group_state');saved=clone(args.p_state);return {data:true};}};
 if(options.bridge){
  c.db=options.bridge.db;
  c.iigEntryBridge={...options.bridge,commit:async(...args)=>{
   if(options.operations)options.operations.push(args[0]);
   const result=await options.bridge.commit(...args);if(result.data===true)saved=clone(c.state);return result;
  }};
 }
 vm.createContext(c);
 for(const name of ['save','newRound','nextTripRound'])vm.runInContext(extract(name),c);
 await (after.trip?.active?c.nextTripRound():c.newRound());
 assert.ok(saved,'Actual setup must save');return saved;
}

function leagueMoney(state){
 const c={state:clone(state),Number,Array,Math,Object};vm.createContext(c);
 vm.runInContext(extract('createWinnerPayouts'),c);
 vm.runInContext(extract('league').replace('  const moneySorted=',
  '  globalThis.moneyResult=state.players.map(p=>moneyWon(p.name)); return; const moneySorted='),c);
 c.league();return Array.from(c.moneyResult);
}

async function run(){
 const db=new PGlite();let count=0;
 try{
  for(const file of ['prototype.sql','legacy-adapter.sql','legacy-finish-result.sql','legacy-start-result.sql'])await db.exec(fs.readFileSync(__dirname+'/'+file,'utf8'));
  const cases=[];
  for(const game of ['money','points'])for(const format of ['stableford','net']){
   cases.push({game,format});for(const last of [false,true])cases.push({game,format,trip:true,last});
   cases.push({game,format,tied:true});
  }
  cases.push({game:'points',format:'net',nr:true});
  for(const pair of ['betterball','pairsaggregate'])for(const format of (pair==='betterball'?['stableford']:['stableford','net']))
   for(const last of [false,true])cases.push({pair,format,trip:true,last});
  for(const [index,options] of cases.entries()){
   const before=fixture(options),sourceAfter=await originalFinish({...before,_entry_revision:0}),after=clone(sourceAfter),g='source-case-'+index,pin='source-pin-'+index,cap='f'.repeat(64);
   delete after._entry_revision;
   await db.query('INSERT INTO iig_entry_prototype.groups(id,phase,state) VALUES($1,$2,$3)',[g,'open',before]);
   await db.query('INSERT INTO iig_legacy_fixture.tens_in_groups(id,group_pin,state) VALUES($1,$2,$3)',[g,pin,before]);
   await db.query("INSERT INTO iig_legacy_fixture.organiser_capabilities VALUES($1,iig_legacy_fixture.token_hash($2),'2099-01-01',false,ARRAY['finish','start'])",[g,cap]);
   if(index===0){
    for(const [tamper,error] of [
     [x=>{x.history[1].payouts[0].amount=999;},/HISTORY_REPLACEMENT/],
     [x=>{x.history[0].players[0].stableford=99;},/HISTORICAL_SCORE_CHANGED/],
     [x=>{x.history[0].stablefordPot=999;},/FINISH_POT_CHANGED/],
     [x=>{x.history[0].payouts[0].amount=999;},/PAYOUT_BUDGET_CHANGED/],
     [x=>{x.players[3].paid=true;},/INVALID_FINISH_PLAYER_RESET/],
     [x=>{x.players[3].name='Forged player';},/INVALID_FINISH_PLAYER_RESET/],
     [x=>{x.history[0].players=[];},/MISSING_HISTORICAL_PLAYERS/],
     [x=>{x.history[0].winners=['Fictional D'];x.players[3].wins=1;},/INELIGIBLE_WINNER/],
     [x=>{x.history[0].payouts[0].winnerName='Fictional D';},/INELIGIBLE_PAYOUT/]
    ]){
     const bad=clone(after);tamper(bad);
     await assert.rejects(()=>db.query('SELECT iig_legacy_fixture.finish_with_result($1,$2,$3,$4,$5)',[pin,before.roundId,0,cap,bad]),error);
     assert.deepEqual((await db.query('SELECT state FROM iig_entry_prototype.groups WHERE id=$1',[g])).rows[0].state,before);
     assert.equal((await db.query('SELECT count(*)::int AS n FROM iig_entry_prototype.archives WHERE group_id=$1',[g])).rows[0].n,0);
    }
   }
   await db.query('SELECT iig_legacy_fixture.finish_with_result($1,$2,$3,$4,$5)',[pin,before.roundId,0,cap,sourceAfter]);
   const persisted=(await db.query('SELECT state FROM iig_legacy_fixture.tens_in_groups WHERE id=$1',[g])).rows[0].state;
   assert.deepEqual(persisted,after);assert.deepEqual(persisted.sideGame,before.sideGame);
   assert.deepEqual((await db.query('SELECT snapshot FROM iig_entry_prototype.archives WHERE group_id=$1',[g])).rows[0].snapshot,before);
   const record=options.trip?persisted.trip.rounds.at(-1):persisted.history[0];
   if(options.game==='money'&&!options.pair)assert.deepEqual(record.payouts.map(p=>p.amount),[27,2,1]);
   if(!options.trip&&options.game==='points'&&!options.nr){
    assert.deepEqual(record.pointsResults.map(p=>p.points),[10,6,3]);
    assert.deepEqual(persisted.players.slice(0,3).map(p=>p.leaguePoints),[14,10,7]);
   }
   const totals=leagueMoney(persisted);
   assert.deepEqual(totals.slice(0,3),!options.trip&&options.game==='money'?[27,22,1]:[0,20,0]);
   if(options.trip&&!options.pair&&!options.nr)assert.deepEqual(
    ['Fictional A','Fictional B','Fictional C'].map(n=>persisted.trip.standings[n]),[13,6,3]);
   if(options.pair)assert.deepEqual(['Fictional A','Fictional B','Fictional C','Fictional D'].map(n=>persisted.trip.teamStandings[n]),[10,12,6,6]);
   await assert.rejects(()=>db.query('SELECT iig_legacy_fixture.finish_with_result($1,$2,$3,$4,$5)',[pin,before.roundId,0,cap,after]),/STALE/);
   const sourceSetup=await originalSetup({...persisted,_entry_revision:1},before.pointsCompetition);
   if(index===0 || index===1){
    const tamperings=index===0?[
      [x=>{x.history[0].payouts[0].amount=999;},/SETUP_CHANGED_HISTORY/],
      [x=>{x.players[0].paid=true;},/SETUP_CHANGED_PLAYER/],
      [x=>{x.players[0].leaguePoints=999;},/SETUP_CHANGED_PLAYER/],
      [x=>{x._entry_revision=99;},/STALE/],
      [x=>{x.players[0].playingThisRound=true;},/INVALID_NORMAL_ATTENDANCE/]
    ]:[
      [x=>{x.trip.standings['Fictional A']=999;},/SETUP_CHANGED_TRIP_HISTORY/],
      [x=>{x.trip.currentPlayingIds.push('outsider');},/INVALID_TRIP_PLAYERS/],
      [x=>{x.stake=999;},/SETUP_DIFFERS_FROM_TRIP_PLAN/]
    ];
    for(const [tamper,error] of tamperings){
      const bad=clone(sourceSetup);tamper(bad);
      await assert.rejects(()=>db.query('SELECT iig_legacy_fixture.start_with_setup($1,$2,$3,$4,$5)',[pin,before.roundId,1,cap,bad]),error);
      assert.deepEqual((await db.query('SELECT state FROM iig_entry_prototype.groups WHERE id=$1',[g])).rows[0].state,persisted);
    }
   }
   const started=(await db.query('SELECT iig_legacy_fixture.start_with_setup($1,$2,$3,$4,$5) AS result',[pin,before.roundId,1,cap,sourceSetup])).rows[0].result;
   const expectedSetup=clone(sourceSetup);delete expectedSetup._entry_revision;expectedSetup.roundId=started.roundId;
   assert.notEqual(started.roundId,before.roundId);assert.notEqual(started.roundId,sourceSetup.roundId);
   assert.deepEqual((await db.query('SELECT state FROM iig_legacy_fixture.tens_in_groups WHERE id=$1',[g])).rows[0].state,expectedSetup);
   assert.deepEqual((await db.query('SELECT snapshot FROM iig_entry_prototype.archives WHERE group_id=$1',[g])).rows[0].snapshot,before);
   await db.query("INSERT INTO iig_entry_prototype.principals VALUES('postgres',$1,'a',true)",[g]);
   const delayed={...before,_entry_revision:0};delayed.players=clone(before.players);delayed.players.at(-1).paid=true;
   await assert.rejects(()=>db.query('SELECT iig_legacy_fixture.save_group_state($1,$2)',[pin,delayed]),/STALE/);
   count++;
  }
  console.log(`PASS: ${count} actual-source finish AND next-setup scenarios persisted JSON-equivalent results through fictional protected boundary: Money/Points, Stableford/Net, ties, NR, Trip individual/pair/final, payouts and League payloads. 17 tampering cases and 23 delayed old-round saves rejected. Actual LIVE triggers NOT tested.`);
 }finally{await db.close();}
}
module.exports={fixture,originalFinish,originalSetup,leagueMoney,extract};
if(require.main===module){
 const action=process.argv.includes('--emit-concurrency-fixture')?(async()=>{
  const before=fixture({game:'money',format:'stableford'});
  const after=await originalFinish({...before,_entry_revision:0});
  const setup=await originalSetup({...after,_entry_revision:1},'stableford');
  console.log(JSON.stringify({before,after,setup}));
 })():run();
 action.catch(e=>{console.error(e);process.exitCode=1;});
}
