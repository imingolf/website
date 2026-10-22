/* Protected golf player adapter. No whole-group writes or legacy RPC fallback. */
(() => {
 'use strict';
 if(location.hostname!=='deploy-preview-6--super-quokka-51747d.netlify.app' && !['localhost','127.0.0.1'].includes(location.hostname))return;
 const old={render,show,save,refresh,refreshSideGameLive,enterNormalPointsGame,submitPlayerScore,league,showRoundHistory,showPlayerStats,beginPlayerPayment,recognisePaymentReturn,submitNoReturn,submitTripTeamScore,sideGameConfirmBet,sideGameSendChallenge,sideGameAcceptChallenge,sideGameDeclineChallenge,sideGameSaveScore,sideGameRequestSettlement,sideGameConfirmSettlement,sideGameResolveBetsForToday,claimWinnerPrize};
 let navVisibility=new Map();
 let confirming=false;
 let active=null,busy=false,blocked=false,version=0,revision=0;
 function message(text){const el=document.getElementById('securePlayerStatus');if(el)el.textContent=text;}
 function apply(data){
  if(!data || !Number.isSafeInteger(data.revision) || !Array.isArray(data.state?.players) || !data.state.players.some(p=>p.id===data.player_id))throw Error('Your player record could not be loaded.');
  if(!['points','money'].includes(data.state.gameType))throw Error('Unknown competition type. Ask your organiser to reload the group.');
  state={history:[],pointsValue:10,stake:0,...JSON.parse(JSON.stringify(data.state))};
  myPlayerId=data.player_id;revision=data.revision;groupPlanType=String(data.plan_type||'trial');isAdmin=false;isOwner=false;
 }
 function banner(){
  if(!active)return;
  let node=document.getElementById('securePlayerBanner');
  if(!node){node=document.createElement('div');node.id='securePlayerBanner';node.className='notice';
   node.innerHTML='<b>Test group · your player account</b><p id="securePlayerStatus" role="status" aria-live="polite"></p><button type="button" id="securePlayerReload" class="secondary">Reload group</button> <button type="button" id="securePlayerWithdraw" class="secondary">I’m not playing</button> <button type="button" id="securePlayerConfirmPayment" class="secondary">I’ve paid my entry</button> <button type="button" id="securePlayerAccount" class="secondary">My account</button> <button type="button" id="securePlayerSignout" class="ghost">Sign out</button>';
   document.getElementById('screen').before(node);
   document.getElementById('securePlayerReload').onclick=()=>reload(true);
   document.getElementById('securePlayerAccount').onclick=()=>window.iigAccount?.open();
   document.getElementById('securePlayerConfirmPayment').onclick=confirmPayment;
   document.getElementById('securePlayerWithdraw').onclick=()=>attendance(false);
   document.getElementById('securePlayerSignout').onclick=()=>{if(!busy)active.signout();};
  }
  const me=state.players.find(p=>p.id===myPlayerId);
  document.getElementById('securePlayerWithdraw').hidden=state.trip?.active || state.gameType!=='points' || !me?.playingThisRound || state.roundOpen!==true || roundLocked();
  document.getElementById('securePlayerConfirmPayment').hidden=state.gameType!=='money'||Number(state.stake||0)<=0||me?.paid||state.roundOpen!==true||roundLocked()||!tripPlayerIsPlaying(me);
 }
 async function reload(manual=false){
  if(!active||busy||(!manual&&(blocked||refreshBlocked())))return;
  if(manual&&scoreDraftActive){message('Finish or cancel your score entry before reloading.');return;}
  const current=active,v=version;
  busy=true;if(manual)message('Reloading your saved group…');
  try{const data=await current.request('/rest/v1/rpc/iig_get_player_group',{p_pin:current.pin},true);if(v!==version)return;apply(data);blocked=false;render();if(manual)message('Your saved group has been reloaded.');}
  catch(error){if(v===version){blocked=true;message(error.message+' Tap Reload group to try again.');}}
  finally{busy=false;}
 }
 async function write(rpc,params){
  if(!active||busy)return false;
  if(blocked){message('Reload group before trying another change.');return false;}
  const current=active,v=version;busy=true;message('Saving…');
  try{
   const next=await current.request('/rest/v1/rpc/'+rpc,{p_pin:current.pin,p_revision:revision,...params},true);
   if(!Number.isSafeInteger(next)||next!==revision+1)throw Error('Save response could not be confirmed.');
   const data=await current.request('/rest/v1/rpc/iig_get_player_group',{p_pin:current.pin},true);
   if(v!==version)return false;
   apply(data);scoreDraftActive=false;if(sideGameOpen)sideGameHome();else render();message('Saved and checked.');return true;
  }catch(error){if(v===version){blocked=true;scoreDraftActive=false;message(error.message+' Reload group to check what was saved before trying again.');}return false;}
  finally{busy=false;}
 }
 async function attendance(value){
  if(state.roundOpen!==true||roundLocked()){message('Entries are closed.');return false;}
  // Retain the already-installed protected Points endpoint; never fall back after failure.
  if(state.gameType==='points'&&!state.trip?.active)return write('iig_set_my_attendance',{p_attending:value});
  return action('attendance',{attending:value});
 }
 function action(name,payload={}){return write('iig_player_action',{p_action:name,p_payload:{...payload,round_id:String(state.roundId||'')}});}
 async function confirmPayment(){
  if(!active||busy||blocked||confirming)return;const v=version;confirming=true;
  try{if(!await appConfirm('Confirm your payment','Confirm only after paying your Group Admin directly. This records your declaration, not a bank-verified payment.','I’ve paid'))return;
  if(v!==version)return;
  if(await action('payment',{confirmed:true}))clearPaymentJourney();
  }finally{confirming=false;}
 }
 window.iigSecurePlayer={
  get active(){return !!active;},
  open(data,groupPin,request,signout){
   if(!/^\d{4}$/.test(groupPin))throw Error('Invalid group PIN.');
   apply(data);
   if(!active)navVisibility=new Map([...document.querySelectorAll('nav [onclick]')].map(el=>[el,el.hidden]));
   version++;active={pin:groupPin,request,signout};blocked=false;pin=groupPin;ownerCreationCode='';
   db={rpc:async()=>({data:null,error:{message:'Use your signed-in player actions.'}})};
   document.getElementById('setupOverlay').classList.add('hidden');document.getElementById('demoBadge').classList.add('hidden');
   banner();show('round');message('You are signed in as '+state.players.find(p=>p.id===myPlayerId).name+'.');startPolling();setTimeout(recognisePaymentReturn,500);
  },
  close(){if(!active)return;cancelProtectedDialogs();for(const [el,hidden] of navVisibility)el.hidden=hidden;navVisibility.clear();version++;active=null;clearInterval(poller);poller=null;db=null;pin='';myPlayerId='';clearPaymentJourney();sideGameOpen=false;sideGameHomeOpen=false;isAdmin=false;isOwner=false;scoreDraftActive=false;state={players:[],history:[]};lastWinnerRecord=null;statsPlayerId=null;
   document.getElementById('securePlayerBanner')?.remove();document.getElementById('screen').textContent='';document.getElementById('setupOverlay').classList.remove('hidden');showWelcomePanel('start');
  }
 };
 save=async()=>{if(!active)return old.save();message('That action is not connected for player accounts in this preview.');return false;};
 refresh=async()=>active?reload(false):old.refresh();
 refreshSideGameLive=async()=>active?reload(false):old.refreshSideGameLive();
 show=function(p){if(active&&!['round','scores','pay','league','playerstats','tripsummary'].includes(p)){message('Use your player competition, payment and results screens.');return;}old.show(p);};
 function filterActions(){
  if(!active)return;
  for(const el of document.querySelectorAll('#screen [onclick], nav [onclick]')){
   const handler=el.getAttribute('onclick')||'';
   if(!/^(iigFreePlan\(\) \? showIigPlusUpgrade\('sidegame'\) : sideGameHome\(\)|enterNormalPointsGame\(|submitPlayerScore\(|show\(['"](?:round|scores|pay|league|tripsummary)['"]\)|league\(|showRoundHistory\(|showPlayerStats\(|shareHistoricalResult\(|submitNoReturn\(|submitTripTeamScore\(|beginPlayerPayment\(|sideGame(?:BackToGolf|Home|Statement|ChoosePlayer|PickPlayer|AgreedInPerson|SelectFormat|UpdateConfirm|ConfirmBet|SendChallenge|AcceptChallenge|DeclineChallenge|ScoreEntry|SaveScore|RequestSettlement|ConfirmSettlement)\(|showTripSummary\(|shareTripSummary\(|claimWinnerPrize\()/.test(handler))el.hidden=true;
  }
  // Hide unavailable feature cards, rather than showing misleading empty actions.
  for(const button of document.querySelectorAll('#screen button[onclick]')){
   if(/shareApp|notification/i.test(button.getAttribute('onclick')||''))button.closest('.card')?.setAttribute('hidden','');
  }
  banner();
 }
 render=function(){old.render();filterActions();};
 league=function(){old.league();filterActions();};
 showRoundHistory=function(i){old.showRoundHistory(i);filterActions();};
 showPlayerStats=function(id){old.showPlayerStats(id);filterActions();};
 enterNormalPointsGame=async()=>active?attendance(true):old.enterNormalPointsGame();
 submitPlayerScore=async function(i,type){
  if(!active)return old.submitPlayerScore(i,type);
  const player=state.players[i];if(!player||player.id!==myPlayerId||busy||blocked)return;
  const format=state.pointsCompetition,raw=String(document.getElementById('scoreInput_'+i)?.value||'').trim();
  if(!['stableford','net'].includes(format)||!validIndividualScore(raw,format)){message('Enter '+(format==='net'?'up to 3 digits for Net.':'up to 2 digits for Stableford.'));return;}
  if((state.gameType==='points'&&!state.trip?.active&&!player.playingThisRound)||state.roundOpen!==true||!tripPlayerIsPlaying(player)){message('You must be entered in an open competition.');return;}
  const v=version;
  if(!await appConfirm('Submit My Score',raw+' '+(format==='net'?'Net':'Stableford points')+'. Is this your final total?','Submit Score'))return;
  if(v!==version)return;
  if(state.gameType==='points'&&!state.trip?.active)await write('iig_submit_my_score',{p_score:Number(raw),p_format:format});
  else await action('score',{score:Number(raw),format});
 };
 // These functions retain the original screens while replacing every player write.
 beginPlayerPayment=function(){
  if(!active)return old.beginPlayerPayment();
  const link=String(state.paymentLink||'');
  try{const url=new URL(link);if(url.protocol!=='https:'||url.username||url.password)throw Error();}
  catch(_){message('Ask your organiser for a secure payment link.');return;}
  return old.beginPlayerPayment();
 };
 recognisePaymentReturn=async function(){
  if(!active)return old.recognisePaymentReturn();
  const journey=readPaymentJourney();if(!journey||busy||blocked||document.visibilityState==='hidden')return;
  if(journey.playerId!==myPlayerId||journey.groupPin!==pin||String(journey.roundId||'')!==String(state.roundId||'')||journey.course!==String(state.course||'')||journey.roundDate!==String(state.date||'')||journey.stake!==Number(state.stake||0)||Date.now()-journey.startedAt>48*3600000){clearPaymentJourney();return;}
  if(Date.now()-journey.startedAt<1200)return;
  return confirmPayment();
 };
 submitNoReturn=async function(i){
  if(!active)return old.submitNoReturn(i);
  if(state.players[i]?.id!==myPlayerId||busy||blocked)return;const v=version;
  if(await appConfirm('No Return','Submit No Return for your Net score?','Submit')&&v===version)await action('no_return',{format:state.pointsCompetition});
 };
 submitTripTeamScore=async function(id){
  if(!active)return old.submitTripTeamScore(id);
  const raw=String(document.getElementById('tripTeamScore_'+id)?.value||'').trim();const max=tripRoundFormat()==='pairsaggregate'?(state.pointsCompetition==='net'?1998:198):99;
  if(!/^\d{1,4}$/.test(raw)||Number(raw)>max){message('Enter a valid pair total.');return;}
  const v=version;if(await appConfirm('Submit Pair Score',raw+' for your pair. Is this final?','Submit')&&v===version)await action('team_score',{team_id:id,score:Number(raw),format:state.pointsCompetition});
 };
 sideGameResolveBetsForToday=function(){if(!active)return old.sideGameResolveBetsForToday();};
 async function createSide(id){
  const input=document.getElementById('sideGameStake');
  if(!input){sideGameAgreedInPerson(id,'challenge');return;}
  if(await action('side_create',{other_id:id,stake:Number(input.value),format:localStorage.getItem('iig_sidegame_format_'+myPlayerId)}))message('Challenge saved. Your opponent must accept, including an in-person agreement.');
 }
 sideGameConfirmBet=id=>active?createSide(id):old.sideGameConfirmBet(id);
 sideGameSendChallenge=id=>active?createSide(id):old.sideGameSendChallenge(id);
 sideGameAcceptChallenge=id=>active?action('side_accept',{id}):old.sideGameAcceptChallenge(id);
 sideGameDeclineChallenge=id=>active?action('side_decline',{id}):old.sideGameDeclineChallenge(id);
 sideGameSaveScore=function(format){if(!active)return old.sideGameSaveScore(format);const raw=String(document.getElementById('sideGameScore')?.value||'').trim();if(!validIndividualScore(raw,format)){message('Enter a valid final score.');return;}return action('side_score',{format,score:Number(raw)});};
 sideGameRequestSettlement=(other,amount)=>active?action('side_settle',{other_id:other}):old.sideGameRequestSettlement(other,amount);
 sideGameConfirmSettlement=id=>active?action('side_confirm',{id}):old.sideGameConfirmSettlement(id);
 claimWinnerPrize=async function(index,id){
  if(!active)return old.claimWinnerPrize(index,id);
  const record=state.history?.[index],payout=record?.payouts?.find(p=>p.id===id);
  if(!payout||payout.winnerPlayerId!==myPlayerId)return;
  const v=version,method=await chooseWinnerPayoutMethod(payout.winnerName,payout.amount);if(method===null||v!==version)return;
  let link='';if(method!=='bank_transfer'){
   const item=PAYMENT_PROVIDERS[method];if(!item)return;
   link=await appPrompt('Your '+item.label+' payment link',item.hint,'',{type:'url',okLabel:'Send to Admin'});
   if(link===null||v!==version)return;
   if(!payoutProvider(link)){message('Use a supported secure payment link.');return;}
  }
  await action('claim_prize',{history_id:record.id,payout_id:id,payment_link:link.trim()});
 };
 for(const name of ['sideGameHome','sideGameStatement','sideGameChoosePlayer','sideGamePickPlayer','sideGameAgreedInPerson','sideGameScoreEntry','showTripSummary']){
  const original=window[name];window[name]=function(...args){const result=original(...args);filterActions();return result;};
 }
})();
