const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'../app/index.html'),'utf8');
function extract(name){
  const start=source.search(new RegExp('^(?:async )?function '+name+'\\(','m'));
  if(start<0)throw Error('Missing function '+name);
  const endings=/\n[ \t]*}/g;endings.lastIndex=start;
  for(let match;(match=endings.exec(source));){
    const candidate=source.slice(start,endings.lastIndex);
    try{new vm.Script(candidate);return candidate;}catch{}
  }
  throw Error('Cannot extract '+name);
}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function context(){
  const ctx={console,structuredClone,crypto:require('node:crypto').webcrypto,
    pin:'1260',page:'scores',myPlayerId:'a',isAdmin:true,
    saveActive:false,savePending:0,saveQueue:Promise.resolve(),stateSaveVersion:0,refreshRequestVersion:0,
    finishRoundActive:false,normalFinishInProgress:false,scoreDraftActive:false,sideGameOpen:false,sideGameHomeOpen:false,
    state:{players:[{id:'a',paid:false}],sideGame:{}},renders:0,
    document:{activeElement:{tagName:'BODY'},querySelector:()=>null},
    $:()=>({textContent:''}),demoReadOnly:()=>false,demoCanEdit:()=>true,
    render(){ctx.renders++;},ensureDemoMoneyHistory(){},showAppToast(){},scores(){},
    window:{scrollY:0,scrollTo(){}},alert:()=>{},tripTeamRoundActive:()=>false};
  vm.createContext(ctx);
  for(const name of ['save','refresh','refreshSideGameLive','finishRound','createWinnerPayouts'])vm.runInContext(extract(name),ctx);
  for(const name of ['refreshBlocked','finishRoundImpl'])if(source.includes('function '+name+'('))vm.runInContext(extract(name),ctx);
  return ctx;
}
const tests=[];function test(name,run){tests.push([name,run]);}
test('An arriving refresh preserves a score started while the request was pending',async()=>{
  const c=context(),d=deferred();c.db={rpc:()=>d.promise};const before=c.state;
  const request=c.refresh();c.scoreDraftActive=true;c.document.activeElement.tagName='INPUT';
  d.resolve({data:{players:[{id:'a',paid:true}]},error:null});await request;
  assert.equal(c.state,before);assert.equal(c.renders,0);
});
test('An arriving refresh cannot replace a different screen or group',async()=>{
  for(const change of [c=>c.page='settings',c=>c.pin='1010',c=>c.sideGameOpen=true]){
    const c=context(),d=deferred();c.db={rpc:()=>d.promise};const before=c.state;
    const request=c.refresh();change(c);d.resolve({data:{players:[{id:'a',paid:true}]}});await request;
    assert.equal(c.state,before);assert.equal(c.renders,0);
  }
});
test('Late refresh replies cannot undo a newer reply',async()=>{
  const c=context(),a=deferred(),b=deferred();let calls=0;c.db={rpc:()=>++calls===1?a.promise:b.promise};
  const first=c.refresh(),second=c.refresh();
  b.resolve({data:{players:[{id:'a',paid:true}],version:2}});await second;
  a.resolve({data:{players:[{id:'a',paid:false}],version:1}});await first;
  assert.equal(c.state.version,2);
});
test('Side Game reply cannot reopen a screen the player left',async()=>{
  const c=context(),d=deferred();c.sideGameOpen=true;c.sideGameHomeOpen=true;c.sideGameHome=()=>{throw Error('Reopened Side Game');};c.db={rpc:()=>d.promise};
  const before=c.state,request=c.refreshSideGameLive();c.sideGameOpen=false;c.sideGameHomeOpen=false;c.page='league';
  d.resolve({data:{players:[{id:'a'}],sideGame:{changed:true}}});await request;assert.equal(c.state,before);
});
test('Overlapping saves are ordered, hold the lock, and report RPC false as failure',async()=>{
  const c=context(),pending=[],sent=[];c.db={rpc:(_name,args)=>{sent.push(structuredClone(args.p_state));const d=deferred();pending.push(d);return d.promise;}};
  c.state.value=1;const first=c.save();c.state.value=2;const second=c.save();await Promise.resolve();await Promise.resolve();
  assert.equal(sent.length,1);assert.equal(sent[0].value,1);assert.equal(c.saveActive,true);
  pending[0].resolve({data:true,error:null});assert.equal(await first,true);await Promise.resolve();await Promise.resolve();
  assert.equal(c.saveActive,true);assert.equal(sent[1].value,2);
  pending[1].resolve({data:false,error:null});assert.equal(await second,false);assert.equal(c.saveActive,false);
});
test('A thrown save releases its lock',async()=>{
  const c=context();c.db={rpc:async()=>{throw Error('offline');}};
  assert.equal(await c.save(),false);assert.equal(c.saveActive,false);
});
test('Finish Round locks before reading scores and unlocks after cancellation',async()=>{
  const c=context(),d=deferred();let calls=0;
  c.finishRoundImpl=async()=>{calls++;await d.promise;};
  const first=c.finishRound();assert.equal(c.finishRoundActive,true);await c.finishRound();assert.equal(calls,1);
  d.resolve();await first;assert.equal(c.finishRoundActive,false);
});
test('The £30 split creates £27, £2 and £1 payouts for Stableford and Net',async()=>{
  const c=context();for(const competition of ['stableford','net']){
    const r={gameType:'money',pointsCompetition:competition,splitPrizes:true,secondPrize:2,thirdPrize:1,
      stablefordPot:competition==='stableford'?30:0,netPot:competition==='net'?30:0,
      prizePlaces:['A','B','C'].map((name,i)=>({name,playerId:String(i),position:i+1}))};
    assert.deepEqual(Array.from(c.createWinnerPayouts(r),p=>p.amount),[27,2,1]);
  }
});
test('Finishing individual Money rounds preserves split prizes in normal and Trip Mode',async()=>{
  for(const trip of [false,true])for(const competition of ['stableford','net'])for(const tied of [false,true]){
    const c=context();let saved,shown;
    c.state={roundId:'round-test',roundOpen:true,gameType:'money',pointsCompetition:competition,
      stake:10,splitPrizes:true,secondPrize:2,thirdPrize:1,
      players:['A','B','C'].map((name,i)=>({id:name,name,paid:true,stableford:tied&&i<2?40:40-i,netScore:tied&&i<2?70:70+i})),
      ...(trip?{trip:{active:true,currentRound:1,totalRounds:2,competition,rounds:[]}}:{})};
    c.db={rpc:async(name,args)=>name==='get_group_state'?{data:structuredClone(c.state)}:(saved=structuredClone(args.p_state),{data:true})};
    c.currentRoundPlayers=()=>c.state.players;
    c.stablefordPot=()=>competition==='stableford'?30:0;
    c.netPot=()=>competition==='net'?30:0;
    c.tripPointsEnabled=()=>false;
    c.appPrompt=async()=>{assert.equal(c.finishRoundActive,true);return '2';};
    c.showWinnerScreen=r=>{shown=r;c.page='winner';};
    await c.finishRound();
    const record=trip?saved.trip.rounds[0]:saved.history[0];
    assert.deepEqual(Array.from(record.payouts,p=>p.amount),[27,2,1]);
    assert.deepEqual(Array.from(record.winners),[tied?'B':'A']);
    assert.equal(shown.id,record.id);assert.equal(saved.roundOpen,false);
  }
});
(async()=>{let failed=0;for(const [name,run] of tests){try{await run();console.log('PASS '+name);}catch(e){failed++;console.log('FAIL '+name+': '+e.message.split('\n')[0]);}}if(failed)process.exitCode=1;})();
