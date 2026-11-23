/* Protected golf player adapter. No whole-group writes or legacy RPC fallback. */
(() => {
 'use strict';
 if(!window.IIG_ACCOUNT_ACCESS)return;
 const old={render,show,save,refresh,refreshSideGameLive,enterNormalPointsGame,submitPlayerScore,league,showRoundHistory,showPlayerStats,beginPlayerPayment,recognisePaymentReturn,submitNoReturn,submitTripTeamScore,sideGameConfirmBet,sideGameSendChallenge,sideGameAcceptChallenge,sideGameDeclineChallenge,sideGameSaveScore,sideGameRequestSettlement,sideGameConfirmSettlement,sideGameResolveBetsForToday,claimWinnerPrize};
 let navVisibility=new Map();
 let confirming=false;
 let active=null,busy=false,blocked=false,version=0,revision=0,entry=null;
 function message(text){
  const el=document.getElementById('securePlayerStatus');if(el)el.textContent=text;
  const response=document.getElementById('sideGameChallengeResponse');
  if(response){
   response.textContent=text;
   if(blocked){
    const button=document.createElement('button');button.type='button';button.className='secondary full';button.textContent='Reload challenges';
    button.onclick=async()=>{await reload(true);if(active&&!blocked&&!busy)sideGameHome();};
    response.appendChild(button);
   }
  }
 }
 function apply(data){
  const e=data?.entry;
  if(!e||typeof e.open!=='boolean'||typeof e.closed!=='boolean'||!(e.entrantIds===null&&(!e.closed||!e.open)||Array.isArray(e.entrantIds)&&e.entrantIds.every(id=>typeof id==='string')))throw Error('Reload to confirm competition entry status.');
  if(!data || !Number.isSafeInteger(data.revision) || !Array.isArray(data.state?.players) || !data.state.players.some(p=>p.id===data.player_id))throw Error('Your player record could not be loaded.');
  if(!['points','money'].includes(data.state.gameType))throw Error('Unknown competition type. Ask your organiser to reload the group.');
  const stake=data.state.stake;
  if(typeof data.state.roundOpen!=='boolean'||!['number','string'].includes(typeof stake)||String(stake).trim()===''||!Number.isFinite(Number(stake))||Number(stake)<0||!Array.isArray(data.state.history))throw Error('Competition details are incomplete. Reload your saved group.');
  state={pointsValue:10,...JSON.parse(JSON.stringify(data.state))};
  entry=JSON.parse(JSON.stringify(e));myPlayerId=data.player_id;revision=data.revision;groupPlanType=String(data.plan_type||'trial');isAdmin=false;isOwner=false;
  if(active)active.playerId=data.player_id;
 }
 function banner(){
  if(!active)return;
  let node=document.getElementById('securePlayerBanner');
  if(!node){node=document.createElement('div');node.id='securePlayerBanner';node.className='notice';
   node.innerHTML='<b>Player</b><p id="securePlayerStatus" role="status" aria-live="polite"></p><button type="button" id="securePlayerReload" class="secondary">Reload group</button><details class="ui-options"><summary>Payment &amp; attendance</summary><button type="button" id="securePlayerWithdraw" class="secondary">I’m not playing</button><button type="button" id="securePlayerConfirmPayment" class="secondary">I’ve paid my entry</button><button type="button" id="securePlayerNotPaid" class="secondary">I haven’t paid yet</button><p id="securePlayerPaymentResponse" role="status"></p></details><details class="ui-options"><summary>My account</summary><button type="button" id="securePlayerAccount" class="secondary">Account settings</button><button type="button" id="securePlayerSignout" class="ghost">Sign out</button></details>';
   document.getElementById('screen').before(node);
   document.getElementById('securePlayerReload').onclick=()=>reload(true);
   document.getElementById('securePlayerAccount').onclick=()=>window.iigAccount?.open();
   document.getElementById('securePlayerConfirmPayment').onclick=confirmPayment;
   document.getElementById('securePlayerNotPaid').onclick=confirmNotPaid;
   document.getElementById('securePlayerWithdraw').onclick=()=>attendance(false);
   document.getElementById('securePlayerSignout').onclick=()=>{if(!busy)active.signout();};
  }
  let organiser=document.getElementById('securePlayerOrganiserReturn');
  if(!organiser){organiser=document.createElement('div');organiser.id='securePlayerOrganiserReturn';organiser.innerHTML='<button id="securePlayerOrganiser" type="button" class="secondary full">Back to organiser view</button><p id="securePlayerOrganiserStatus" role="alert"></p>';organiser.querySelector('#securePlayerOrganiser').onclick=()=>window.iigReturnToOrganiser?.();node.before(organiser);}
  organiser.hidden=!window.iigCanReturnToOrganiser?.(active.pin);
  const me=state.players.find(p=>p.id===myPlayerId);
  document.getElementById('securePlayerWithdraw').hidden=state.trip?.active || state.gameType!=='points' || !me?.playingThisRound || state.roundOpen!==true || roundLocked();
  if(window.IIG_ACCOUNT_BUILD?.release==='focused-v1'){
   let pay=document.getElementById('securePlayerPayLink');if(!pay){pay=document.createElement('button');pay.id='securePlayerPayLink';pay.type='button';pay.className='secondary';pay.textContent='Open payment link';pay.onclick=()=>window.iigReleasePay?.();node.appendChild(pay);}
   pay.hidden=me?.paid||!window.IIGRelease?.canPayEntry(me);
  }
  document.getElementById('securePlayerConfirmPayment').hidden=state.gameType!=='money'||Number(state.stake||0)<=0||(me?.paid&&!window.IIGRelease?.paymentIsExplicitlyUnpaid(me))||state.roundOpen!==true||(window.IIG_ACCOUNT_BUILD?.release==='focused-v1'?(roundLocked()&&!entry?.entrantIds?.includes(me?.id)):roundLocked())||!tripPlayerIsPlaying(me);
  const response=window.IIGRelease?.paymentIsExplicitlyUnpaid(me);
  document.getElementById('securePlayerNotPaid').hidden=state.gameType!=='money'||Number(state.stake||0)<=0||response||state.roundOpen!==true||(roundLocked()&&!entry?.entrantIds?.includes(me?.id))||!tripPlayerIsPlaying(me);
  document.getElementById('securePlayerPaymentResponse').textContent=response&&state.roundOpen===true?'Payment response: I haven’t paid. An initial score requires your I’ve paid declaration.':'';
  const entrySection=document.getElementById('securePlayerWithdraw').closest('details');
  entrySection.hidden=state.roundOpen!==true||['securePlayerWithdraw','securePlayerConfirmPayment','securePlayerNotPaid'].every(id=>document.getElementById(id).hidden)&&!document.getElementById('securePlayerPaymentResponse').textContent;

 }
 async function reload(manual=false,sideLive=false){
  if(!active||busy||(!manual&&(blocked||refreshBlocked())))return;
  if(!manual&&(sideLive?(!sideGameOpen||!sideGameHomeOpen):sideGameOpen))return;
  if(manual&&scoreDraftActive){message('Finish or cancel your score entry before reloading.');return;}
  const current=active,v=version,requestPage=page,requestSide=sideGameOpen,requestHome=sideGameHomeOpen;
  busy=true;if(manual)message('Reloading your saved group…');
  try{const data=await current.request('/rest/v1/rpc/iig_read_entry_group',{p_pin:current.pin},true);if(v!==version)return;if(!manual&&(page!==requestPage||sideGameOpen!==requestSide||sideGameHomeOpen!==requestHome||refreshBlocked()))return;const before=JSON.stringify({state,entry,revision,groupPlanType});const oldSide=JSON.stringify(state.sideGame||{}),sameRound=state.roundId===data.state?.roundId&&state.trip?.currentRound===data.state?.trip?.currentRound;apply(data);blocked=false;if(manual)render();else if(sideLive){if(oldSide!==JSON.stringify(state.sideGame||{}))renderLiveUpdate(sideGameHome);}else if(before!==JSON.stringify({state,entry,revision,groupPlanType}))renderLiveUpdate(render,sameRound);if(manual)message('Your saved group has been reloaded.');}
  catch(error){if(v===version){blocked=true;message(error.message+' Tap Reload group to try again.');}}
  finally{busy=false;}
 }
 async function write(rpc,params){
  if(!active)return false;
  if(busy){message('Please wait for the current update, then try again.');return false;}
  if(blocked){message('Reload group before trying another change.');return false;}
  const current=active,v=version;busy=true;message('Saving…');
  try{
   const next=await current.request('/rest/v1/rpc/'+rpc,{p_pin:current.pin,p_revision:revision,...params},true);
   if(!Number.isSafeInteger(next)||next!==revision+1)throw Error('Save response could not be confirmed.');
   const data=await current.request('/rest/v1/rpc/iig_read_entry_group',{p_pin:current.pin},true);
   if(v!==version)return false;
   apply(data);scoreDraftActive=false;if(sideGameOpen)sideGameHome();else render();message('Saved and checked.');return true;
  }catch(error){if(v===version){blocked=true;scoreDraftActive=false;message(error.message+' Reload group to check what was saved before trying again.');}return false;}
  finally{busy=false;}
 }
 async function attendance(value){
  if(value&&window.IIGPaidEntry?.applicable()&&!window.IIGRelease?.entered(state.players.find(p=>p.id===myPlayerId))){show('pay');return false;}
  if(state.roundOpen!==true||roundLocked()){message('Entries are closed.');return false;}
  // Retain the already-installed protected Points endpoint; never fall back after failure.
  if(state.gameType==='points'&&!state.trip?.active)return write('iig_set_my_attendance',{p_attending:value});
  return action('attendance',{attending:value});
 }
 function action(name,payload={}){return write('iig_player_action',{p_action:name,p_payload:{...payload,round_id:String(state.roundId||'')}});}
 async function confirmNotPaid(){
  if(window.IIGPaidEntry?.pending()){window.IIGPaidEntry.resume();return;}
  if(window.IIGPaidEntry?.applicable()&&!window.IIGRelease?.entered(state.players.find(p=>p.id===myPlayerId))){show('pay');return;}
  if(!active||busy||blocked||confirming)return;const v=version,rev=revision;confirming=true;
  try{if(!await appConfirm('Record your payment response','Save that you haven’t paid for this round. This blocks an initial score until you declare I’ve paid. It does not withdraw your entry or change a submitted score.','I haven’t paid'))return;
   if(v!==version||rev!==revision){message('The competition changed. Reload before confirming.');return;}
   if(await action('payment',{confirmed:false}))clearPaymentJourney();
  }finally{confirming=false;}
 }
 async function confirmPayment(){
  if(window.IIGPaidEntry?.pending()){window.IIGPaidEntry.resume();return;}
  if(window.IIGPaidEntry?.applicable()&&!window.IIGRelease?.entered(state.players.find(p=>p.id===myPlayerId))){show('pay');return;}
  if(!active||busy||blocked||confirming)return;const v=version,rev=revision;confirming=true;
  try{if(!await appConfirm('Confirm your payment','Confirm only after paying your organiser directly. This records your declaration, not a bank-verified payment.','I’ve paid'))return;
  if(v!==version||rev!==revision){message('The competition changed. Reload before confirming.');return;}
  if(await action('payment',{confirmed:true}))clearPaymentJourney();
  }finally{confirming=false;}
 }
 window.iigSecurePlayer={
  async invitation(){
   if(!active||busy||blocked)throw Error('Reload your group before inviting a friend.');
   const current=active,v=version;
   const options=await current.request('/rest/v1/rpc/iig_get_player_join_options',{p_pin:current.pin},true);
   if(current!==active||v!==version)throw Error('Your group changed. Open the invitation again.');
   if(options?.group_pin!==current.pin||typeof options.pin_join_enabled!=='boolean')throw Error('Could not check the invitation. Please try again.');
   if(!options.pin_join_enabled||current.pin==='1010')throw Error('Ask your organiser for this group’s private invitation.');
   const url=location.origin+'/app/#pin='+encodeURIComponent(current.pin);
   return '⛳ Join '+(options.group_name||state.groupName||'our golf group')+' on I’m In Golf.\n\n'+url+'\n\nGroup PIN: '+current.pin+'\nUse your email, then add your name and handicap. Works on iPhone, Android and in your browser.';
  },
  async updateHandicap(value){
   if(!Number.isFinite(value)||value< -10||value>60||Math.round(value*10)!==value*10)return false;
   return write('iig_player_action',{p_action:'handicap',p_payload:{handicap:value}});
  },
  get paymentReady(){return !!active&&!busy&&!blocked&&!confirming;},
  confirmExistingPayment:confirmPayment,
  async reloadForPayment(){if(!active||busy)return false;await reload(true);return !!active&&!blocked&&!busy;},
  async recordEntryPayment(confirmed,expected){
   if(!active||busy||blocked||typeof confirmed!=='boolean'||!window.IIGPaidEntry?.applicable())return false;
   if(expected.groupPin!==pin||expected.playerId!==myPlayerId||expected.roundId!==String(state.roundId||'')||expected.course!==String(state.course||'')||expected.roundDate!==String(state.date||'')||expected.stake!==Number(state.stake)||expected.paymentLink!==String(state.paymentLink||''))return false;
   return action('payment',{confirmed});
  },
  get active(){return !!active;},
  get identity(){return active?{groupPin:active.pin,playerId:active.playerId}:null;},
  get canSwitchView(){return !!active&&!busy&&!confirming&&!scoreDraftActive;},
  get entryStatus(){return active?JSON.parse(JSON.stringify(entry)):null;},
  open(data,groupPin,request,signout){
   if(!/^\d{4}$/.test(groupPin))throw Error('Invalid group PIN.');
   apply(data);
   if(!active)navVisibility=new Map([...document.querySelectorAll('nav [onclick]')].map(el=>[el,el.hidden]));
   if(iigEntryBridge){iigEntryBridge.clear();iigEntryBridge=null;}
   version++;active={pin:groupPin,request,signout,playerId:data.player_id};blocked=false;pin=groupPin;ownerCreationCode='';
   db={rpc:async(name,args)=>{
    if(name!=='get_group_state'||args?.p_pin!==active?.pin||busy||blocked)return {data:null,error:{message:'Use your signed-in player actions.'}};
    const current=active,v=version;busy=true;
    try{const data=await current.request('/rest/v1/rpc/iig_read_entry_group',{p_pin:current.pin},true);if(v!==version)throw Error('Account changed');apply(data);return {data:state,error:null};}
    catch(_){return {data:null,error:{message:'Reload the saved group.'}};}finally{busy=false;}
   }};
   document.getElementById('setupOverlay').classList.add('hidden');document.getElementById('demoBadge').classList.add('hidden');
   document.getElementById('syncText').textContent='Player • signed in';
   banner();show('round');message('You are signed in as '+state.players.find(p=>p.id===myPlayerId).name+'.');startPolling();setTimeout(recognisePaymentReturn,500);
   window.dispatchEvent(new Event('iig-player-ready'));
  },
  close(){
   window.IIGPaidEntry?.close();
   document.getElementById('iigAppHandover')?.remove();if(!active)return;cancelProtectedDialogs();for(const [el,hidden] of navVisibility)el.hidden=hidden;navVisibility.clear();version++;active=null;clearInterval(poller);poller=null;db=null;pin='';myPlayerId='';clearPaymentJourney();sideGameOpen=false;sideGameHomeOpen=false;isAdmin=false;isOwner=false;scoreDraftActive=false;state={players:[],history:[]};lastWinnerRecord=null;statsPlayerId=null;
   document.getElementById('uiPlayerOptions')?.remove();document.getElementById('securePlayerOrganiserReturn')?.remove();document.getElementById('securePlayerBanner')?.remove();document.getElementById('screen').textContent='';document.getElementById('setupOverlay').classList.remove('hidden');showWelcomePanel('start',false);
  }
 };
 save=async(...args)=>{if(!active)return old.save(...args);message('That action is unavailable for your player account.');return false;};
 refresh=async()=>active?reload(false):old.refresh();
 refreshSideGameLive=async()=>active?reload(false,true):old.refreshSideGameLive();
 show=function(p){if(active&&window.IIGPaidEntry?.pending()){window.IIGPaidEntry.resume();return;}if(active&&p==='players'){if(window.iigPlayerAccess?.openMembers)window.iigPlayerAccess.openMembers();else message('Player list is unavailable. Reload your group.');return;}if(active&&!['round','scores','pay','league','playerstats','tripsummary'].includes(p)){message('Use your player competition, payment and results screens.');return;}old.show(p);};
 function filterActions(){
  if(!active)return;
  for(const el of document.querySelectorAll('#screen [onclick], nav [onclick]')){
   const handler=el.getAttribute('onclick')||'';
   if(el.id==='nplayers'&&handler==="show('players')"){el.hidden=!window.iigPlayerAccess?.openMembers;continue;}
   if(handler==='selectCurrentTripLeague()')continue;
   if(/^selectLeagueView\('(points|money|trip)'\)$/.test(handler)||/^selectPastTripLeague\(\d+\)$/.test(handler))continue;
   if(!/^(iigFreePlan\(\) \? showIigPlusUpgrade\('sidegame'\) : sideGameHome\(\)|enterNormalPointsGame\(|submitPlayerScore\(|show\(['"](?:round|scores|pay|league|tripsummary)['"]\)|league\(|showRoundHistory\(|showPlayerStats\(|shareHistoricalResult\(|submitNoReturn\(|submitTripTeamScore\(|beginPlayerPayment\(|sideGame(?:BackToGolf|Home|ShareInvite|Statement|ChoosePlayer|PickPlayer|AgreedInPerson|SelectFormat|UpdateConfirm|ConfirmBet|SendChallenge|AcceptChallenge|DeclineChallenge|ScoreEntry|SaveScore|MatchResult|RequestSettlement|ConfirmSettlement)\(|showTripSummary\(|shareTripSummary\(|claimWinnerPrize\()/.test(handler))el.hidden=true;
  }
  // Hide unavailable feature cards, rather than showing misleading empty actions.
  for(const button of document.querySelectorAll('#screen button[onclick]')){
   if(/shareApp|notification/i.test(button.getAttribute('onclick')||''))button.closest('.card')?.setAttribute('hidden','');
  }
  banner();
 }
 render=function(){old.render();filterActions();window.IIGPaidEntry?.render();};
 league=function(){old.league();filterActions();};
 showRoundHistory=function(i){old.showRoundHistory(i);filterActions();};
 showPlayerStats=function(id){old.showPlayerStats(id);filterActions();};
 enterNormalPointsGame=async()=>active?attendance(true):old.enterNormalPointsGame();
 submitPlayerScore=async function(i,type){
  if(!active)return old.submitPlayerScore(i,type);
  const player=state.players[i];if(!player||player.id!==myPlayerId||busy||blocked)return;
  if(window.IIGRelease?.paymentBlocksInitialScore(player)){message('Declare I’ve paid before submitting an initial score.');return;}
  const format=state.pointsCompetition,raw=String(document.getElementById('scoreInput_'+i)?.value||'').trim();
  if(!['stableford','net'].includes(format)||!validIndividualScore(raw,format)){message('Enter '+(format==='net'?'up to 3 digits for Net.':'up to 2 digits for Stableford.'));return;}
  if((state.gameType==='points'&&!state.trip?.active&&!player.playingThisRound)||state.roundOpen!==true||!tripPlayerIsPlaying(player)){message('You must be entered in an open competition.');return;}
  const v=version,rev=revision;
  if(!await appConfirm('Submit My Score',raw+' '+(format==='net'?'Net':'Stableford points')+'. Is this your final total?','Submit Score'))return;
  if(v!==version||rev!==revision){message('The competition changed. Reload before confirming.');return;}
  if(state.gameType==='points'&&!state.trip?.active)await write('iig_submit_my_score',{p_score:Number(raw),p_format:format});
  else await action('score',{score:Number(raw),format});
 };
 // These functions retain the original screens while replacing every player write.
 beginPlayerPayment=function(){
  if(!active)return old.beginPlayerPayment();
  if(window.IIGPaidEntry?.applicable()){show('pay');return;}
  const link=String(state.paymentLink||'');
  try{const url=new URL(link);if(url.protocol!=='https:'||url.username||url.password)throw Error();}
  catch(_){message('Ask your organiser for a secure payment link.');return;}
  if(window.IIG_ACCOUNT_BUILD?.release==='focused-v1')return window.iigReleasePay?.();
  return old.beginPlayerPayment();
 };
 recognisePaymentReturn=async function(){
  if(!active)return old.recognisePaymentReturn();
  if(window.IIGPaidEntry?.applicable()&&window.IIGPaidEntry.resume())return;
  if(state.roundOpen!==true){clearPaymentJourney();return;}
  const journey=readPaymentJourney();if(!journey||busy||blocked||document.visibilityState==='hidden')return;
  if(journey.playerId!==myPlayerId||journey.groupPin!==pin||String(journey.roundId||'')!==String(state.roundId||'')||journey.course!==String(state.course||'')||journey.roundDate!==String(state.date||'')||journey.stake!==Number(state.stake||0)||Date.now()-journey.startedAt>48*3600000){clearPaymentJourney();return;}
  if(Date.now()-journey.startedAt<1200)return;
  return confirmPayment();
 };
 submitNoReturn=async function(i){
  if(!active)return old.submitNoReturn(i);
  if(state.players[i]?.id!==myPlayerId||busy||blocked)return;
  if(window.IIGRelease?.paymentBlocksInitialScore(state.players[i])){message('Declare I’ve paid before submitting an initial score.');return;}
  const v=version,rev=revision;
  if(await appConfirm('No Return','Submit No Return for your Net score?','Submit')&&v===version&&rev===revision)await action('no_return',{format:state.pointsCompetition});
 };
 submitTripTeamScore=async function(id){
  if(!active)return old.submitTripTeamScore(id);
  const raw=String(document.getElementById('tripTeamScore_'+id)?.value||'').trim();const max=tripRoundFormat()==='pairsaggregate'?(state.pointsCompetition==='net'?1998:198):99;
  if(!/^\d{1,4}$/.test(raw)||Number(raw)>max){message('Enter a valid pair total.');return;}
  const v=version,rev=revision;if(await appConfirm('Submit Pair Score',raw+' for your pair. Is this final?','Submit')&&v===version&&rev===revision)await action('team_score',{team_id:id,score:Number(raw),format:state.pointsCompetition});
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
 window.sideGameMatchResult=(id,outcome)=>active && action("side_match_result",{id,outcome});
 sideGameSaveScore=function(format){if(!active)return old.sideGameSaveScore(format);const raw=String(document.getElementById('sideGameScore')?.value||'').trim();if(!validIndividualScore(raw,format)){message('Enter a valid final score.');return;}return action('side_score',{format,score:Number(raw)});};
 sideGameRequestSettlement=(other,amount)=>active?action('side_settle',{other_id:other}):old.sideGameRequestSettlement(other,amount);
 sideGameConfirmSettlement=id=>active?action('side_confirm',{id}):old.sideGameConfirmSettlement(id);
 claimWinnerPrize=async function(index,id){
  if(!active)return old.claimWinnerPrize(index,id);
  const record=state.history?.[index],payout=record?.payouts?.find(p=>p.id===id);
  if(!payout||payout.winnerPlayerId!==myPlayerId)return;
  const v=version,rev=revision;
  const unchanged=()=>{
   if(v===version&&rev===revision)return true;
   showAppToast('Payment details not sent','Your group changed. Reopen your result payment and try again.',5000);return false;
  };
  const method=await chooseWinnerPayoutMethod(payout.winnerName,payout.amount);
  if(method===null||!unchanged())return;
  let link='';if(method!=='bank_transfer'){
   const item=PAYMENT_PROVIDERS[method];if(!item)return;
   const hint=method==='wise'?'Copy the full payment link from Wise and paste it below. A Wisetag on its own cannot be sent.':item.hint;
   link=await appPrompt('Your '+item.label+' payment link',hint,'',{type:'url',okLabel:'Send to organiser',validate:value=>winnerPaymentLinkError(value,method)});
   if(link===null||!unchanged())return;
   const invalid=winnerPaymentLinkError(link,method);
   if(invalid){showAppToast('Payment details not sent',invalid,5000);return;}
  }
  const saved=await action('claim_prize',{history_id:record.id,payout_id:id,payment_link:link.trim()});
  if(v!==version)return;
  if(saved)showAppToast(method==='bank_transfer'?'Private bank transfer selected':'Payment details sent',method==='bank_transfer'?'Contact your organiser privately with your bank details.':'Your organiser can now see your payment link.',5000);
  else showAppToast('Payment details not confirmed','Reload your group and check the result payment before trying again.',5000);
 };
 for(const name of ['sideGameHome','sideGameStatement','sideGameChoosePlayer','sideGamePickPlayer','sideGameAgreedInPerson','sideGameScoreEntry','showTripSummary']){
  const original=window[name];window[name]=function(...args){const result=original(...args);filterActions();return result;};
 }
})();
