/* Isolated Points Game player adapter. No whole-group writes or legacy RPC fallback. */
(() => {
 'use strict';
 if(location.hostname!=='deploy-preview-6--super-quokka-51747d.netlify.app' && !['localhost','127.0.0.1'].includes(location.hostname))return;
 const old={render,show,save,refresh,refreshSideGameLive,enterNormalPointsGame,submitPlayerScore};
 let active=null,busy=false,blocked=false,version=0,revision=0;
 function message(text){const el=document.getElementById('securePlayerStatus');if(el)el.textContent=text;}
 function apply(data){
  if(!data || !Number.isSafeInteger(data.revision) || !Array.isArray(data.state?.players) || !data.state.players.some(p=>p.id===data.player_id))throw Error('Your player record could not be loaded.');
  if(data.state.gameType!=='points')throw Error('This preview currently supports joining Points Games. Ask your organiser to set up a Points Game.');
  state={history:[],pointsValue:10,stake:0,...JSON.parse(JSON.stringify(data.state))};
  myPlayerId=data.player_id;revision=data.revision;isAdmin=false;isOwner=false;
 }
 function banner(){
  if(!active)return;
  let node=document.getElementById('securePlayerBanner');
  if(!node){node=document.createElement('div');node.id='securePlayerBanner';node.className='notice';
   node.innerHTML='<b>Test group · your player account</b><p id="securePlayerStatus" role="status" aria-live="polite"></p><button type="button" id="securePlayerReload" class="secondary">Reload group</button> <button type="button" id="securePlayerWithdraw" class="secondary">I’m not playing</button> <button type="button" id="securePlayerSignout" class="ghost">Sign out</button>';
   document.getElementById('screen').before(node);
   document.getElementById('securePlayerReload').onclick=()=>reload(true);
   document.getElementById('securePlayerWithdraw').onclick=()=>attendance(false);
   document.getElementById('securePlayerSignout').onclick=()=>{if(!busy)active.signout();};
  }
  const me=state.players.find(p=>p.id===myPlayerId);
  document.getElementById('securePlayerWithdraw').hidden=!me?.playingThisRound || state.roundOpen!==true || roundLocked();
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
   await current.request('/rest/v1/rpc/'+rpc,{p_pin:current.pin,p_revision:revision,...params},true);
   const data=await current.request('/rest/v1/rpc/iig_get_player_group',{p_pin:current.pin},true);
   if(v!==version)return false;
   apply(data);scoreDraftActive=false;render();message('Saved and checked.');return true;
  }catch(error){if(v===version){blocked=true;scoreDraftActive=false;message(error.message+' Reload group to check what was saved before trying again.');}return false;}
  finally{busy=false;}
 }
 async function attendance(value){
  if(state.roundOpen!==true||roundLocked()){message('Entries are closed.');return false;}
  return write('iig_set_my_attendance',{p_attending:value});
 }
 window.iigSecurePlayer={
  open(data,groupPin,request,signout){
   if(!/^\d{4}$/.test(groupPin))throw Error('Invalid group PIN.');
   apply(data);version++;active={pin:groupPin,request,signout};blocked=false;pin=groupPin;groupPlanType='trial';ownerCreationCode='';
   db={rpc:async()=>({data:null,error:{message:'Use your signed-in player actions.'}})};
   document.getElementById('setupOverlay').classList.add('hidden');document.getElementById('demoBadge').classList.add('hidden');
   banner();show('round');message('You are signed in as '+state.players.find(p=>p.id===myPlayerId).name+'.');startPolling();
  },
  close(){if(!active)return;version++;active=null;clearInterval(poller);poller=null;db=null;pin='';myPlayerId='';isAdmin=false;isOwner=false;scoreDraftActive=false;
   document.getElementById('securePlayerBanner')?.remove();document.getElementById('screen').textContent='';document.getElementById('setupOverlay').classList.remove('hidden');showWelcomePanel('start');
  }
 };
 save=async()=>{if(!active)return old.save();message('That action is not connected for player accounts in this preview.');return false;};
 refresh=async()=>active?reload(false):old.refresh();
 refreshSideGameLive=async()=>active?reload(false):old.refreshSideGameLive();
 show=function(p){if(active&&!['round','scores'].includes(p)){message('This test covers joining, attendance and final scores.');return;}old.show(p);};
 render=function(){
  old.render();if(!active)return;
  for(const el of document.querySelectorAll('[onclick]')){
   const handler=el.getAttribute('onclick')||'';
   if(!/^(enterNormalPointsGame\(|submitPlayerScore\(|show\(['"](?:round|scores)['"]\))/.test(handler))el.hidden=true;
  }
  // Hide unavailable feature cards, rather than showing misleading empty actions.
  for(const button of document.querySelectorAll('#screen button[onclick]')){
   if(/sideGame|shareApp|notification/i.test(button.getAttribute('onclick')||''))button.closest('.card')?.setAttribute('hidden','');
  }
  banner();
 };
 enterNormalPointsGame=async()=>active?attendance(true):old.enterNormalPointsGame();
 submitPlayerScore=async function(i,type){
  if(!active)return old.submitPlayerScore(i,type);
  const player=state.players[i];if(!player||player.id!==myPlayerId||busy||blocked)return;
  const format=state.pointsCompetition,raw=String(document.getElementById('scoreInput_'+i)?.value||'').trim();
  if(!['stableford','net'].includes(format)||!validIndividualScore(raw,format)){message('Enter '+(format==='net'?'up to 3 digits for Net.':'up to 2 digits for Stableford.'));return;}
  if(!player.playingThisRound||state.roundOpen!==true){message('You must be entered in an open competition.');return;}
  const v=version;
  if(!await appConfirm('Submit My Score',raw+' '+(format==='net'?'Net':'Stableford points')+'. Is this your final total?','Submit Score'))return;
  if(v!==version)return;
  await write('iig_submit_my_score',{p_score:Number(raw),p_format:format});
 };
})();
