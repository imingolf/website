/* Organiser adapter for the isolated preview. Uses verified-owner RPCs only. */
(() => {
 'use strict';
 if(location.hostname!=='deploy-preview-6--super-quokka-51747d.netlify.app' && !['localhost','127.0.0.1'].includes(location.hostname))return;
 let active=null, epoch=0, revision=0, blocked=false, queue=Promise.resolve(), pending=0, readSequence=0, manualLoading=false;
 const originals={save,refresh,refreshSideGameLive,render,adminLogout,returnToPlayerView,copyInvite,changeAdminPin,savePlayerPatch};
 const clone=value=>JSON.parse(JSON.stringify(value));
 const valid=g=>g && /^\d{4}$/.test(g.group_pin) && Number.isSafeInteger(g.revision) && Array.isArray(g.state?.players) && Array.isArray(g.state?.history);
 function status(text){const node=document.getElementById('secureOrganiserStatus');if(node)node.textContent=text;}
 function banner(){
  if(!active)return;
  let node=document.getElementById('secureOrganiserBanner');
  if(!node){
   node=document.createElement('div');node.id='secureOrganiserBanner';node.className='notice';
   node.innerHTML='<b>Test group · signed-in organiser</b><p id="secureOrganiserStatus" role="status" aria-live="polite"></p><button type="button" id="secureOrganiserReload" class="secondary">Reload saved group</button> <button type="button" id="secureOrganiserInvite" class="secondary">Invite players</button><div id="secureInviteBox" hidden><label for="secureInviteLink">Player invitation</label><input id="secureInviteLink" readonly><a id="secureInviteWhatsApp" class="primary" target="_blank" rel="noopener noreferrer">Share on WhatsApp</a><button type="button" id="secureInviteCopy" class="secondary">Copy invitation message</button><p id="secureInviteStatus" role="status" aria-live="polite"></p><a id="secureInviteOpen" target="_blank" rel="noopener noreferrer">Open invitation in a new tab</a></div> <button type="button" id="secureOrganiserAccount" class="secondary">My account</button> <button type="button" id="secureOrganiserSignout" class="ghost">Sign out</button>';
   document.getElementById('screen').before(node);
   node.querySelector('#secureOrganiserInvite').onclick=invitePlayers;
   node.querySelector('#secureInviteCopy').onclick=async()=>{
    const input=document.getElementById('secureInviteLink'),note=document.getElementById('secureInviteStatus');input.focus();input.select();input.setSelectionRange?.(0,input.value.length);
    note.textContent='Link selected. Touch and hold to copy, or press Command+C on your Mac.';
    try{if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(input.dataset.message);note.textContent='Invitation copied.';}}catch(_){}
   };
   node.querySelector('#secureOrganiserAccount').onclick=()=>window.iigAccount?.open();
   node.querySelector('#secureOrganiserReload').onclick=()=>reload(true);
   node.querySelector('#secureOrganiserSignout').onclick=()=>{if(pending){status('Wait for saving to finish.');return;}active?.signout();};
  }
 }
 function invitePlayers(){
  if(!active)return;
  const g=active.group;
  if(pending||blocked){status('Reload the saved group before inviting players.');return;}
  if(!/^[0-9a-f-]{36}$/i.test(g.invite_token||'')){status('Reload your saved group to load its invitation.');return;}
  const url=location.origin+'/app/#pin='+encodeURIComponent(active.pin)+'&invite='+encodeURIComponent(g.invite_token);
  const message='⛳ Join '+(g.state.groupName||'our golf group')+' on I’m In Golf.\n\nGroup PIN: '+active.pin+'\n'+url+'\n\nOpen the link, verify your email, then enter your name and handicap. Your organiser will let you know when the competition is ready.';
  document.getElementById('secureInviteLink').value=url;
  document.getElementById('secureInviteLink').dataset.message=message;
  document.getElementById('secureInviteWhatsApp').setAttribute('href','https://wa.me/?text='+encodeURIComponent(message));
  document.getElementById('secureInviteWhatsApp').style.cssText='display:block;margin:12px 0;padding:14px;text-align:center;min-height:44px';
  document.getElementById('secureInviteOpen').href=url;
  document.getElementById('secureInviteBox').hidden=false;
  document.getElementById('secureInviteBox').scrollIntoView?.({block:'start'});
  status('Invite your friends now. They can join before you create a competition.');
 }
 function firstCompetition(){
  if(!active || pending || blocked){status('Reload your saved group before creating a competition.');return;}
  if(!firstRoundNotYetCreated()){show('round');status('Your group already has competition details. Use the existing round controls.');return;}
  if(document.getElementById('guidedFirstCompetition'))return;
  const current=active,e=epoch;
  const overlay=document.createElement('div');overlay.id='guidedFirstCompetition';overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-label','Create first competition');
  overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:11000;padding:20px;overflow:auto';
  overlay.innerHTML='<form class="card" style="max-width:500px;margin:16px auto"><h2>Your first competition</h2><p>Choose where and when you’re playing. Players enter one final total from their scorecard.</p><label for="normalSetupCourse">Course</label><input id="normalSetupCourse" maxlength="120" required><label for="guidedDate">Date</label><input id="guidedDate" type="date" required><label for="guidedScoring">Scoring</label><select id="guidedScoring"><option value="stableford">Stableford — final points total</option><option value="net">Net — final net score</option></select><p>No entry fee by default. Your usual league points apply.</p><details><summary>Optional entry fee</summary><label for="guidedStake">Amount per player (£)</label><input id="guidedStake" inputmode="numeric" pattern="[0-9]*" value="0"><small>For a paid Group Game, add your payment link in Admin / Settings first.</small></details><p id="guidedError" role="status" aria-live="polite"></p><button class="primary full" id="guidedSave">Save & open competition</button><button type="button" class="secondary full" id="guidedAdvanced">More options & Trip Mode</button><button type="button" class="ghost full" id="guidedCancel">Not now</button></form>';
  document.body.appendChild(overlay);
  overlay.querySelectorAll('input,select').forEach(el=>{el.style.cssText='width:100%;font-size:18px;min-height:44px;margin:8px 0 14px';});
  overlay.querySelectorAll('label').forEach(el=>el.style.display='block');
  const get=id=>overlay.querySelector('#'+id);
  get('guidedCancel').onclick=()=>overlay.remove();
  get('guidedAdvanced').onclick=()=>{overlay.remove();newRound();};
  let saving=false;
  overlay.querySelector('form').onsubmit=async event=>{
   event.preventDefault();if(saving)return;
   const course=get('normalSetupCourse').value.trim(),date=get('guidedDate').value;
   const raw=get('guidedStake').value.trim(),stake=Number(raw||0),competition=get('guidedScoring').value;
   const parsed=new Date(date+'T12:00:00Z');
   if(!course||course.length>120||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==date){get('guidedError').textContent='Enter the course and a valid date.';return;}
   if(!/^[0-9]*$/.test(raw)||!Number.isSafeInteger(stake)||stake<0){get('guidedError').textContent='Enter a whole pound amount, or leave it at zero.';return;}
   if(!['stableford','net'].includes(competition)){get('guidedError').textContent='Choose Stableford or Net.';return;}
   saving=true;overlay.querySelectorAll('button,input,select').forEach(el=>el.disabled=true);get('guidedError').textContent='Checking your saved group…';
   try{
    const g=await current.request('/rest/v1/rpc/iig_get_owned_group',{},true);
    if(e!==epoch||pending||blocked)throw Error('Your group changed. Reload it before continuing.');
    apply(g);
    if(!firstRoundNotYetCreated())throw Error('A competition has already been created. Close this form and reload your group.');
    if(stake>0&&!String(state.paymentLink||'').trim())throw Error('Add your payment link in Admin / Settings first, or create a competition with no entry fee.');
    state={...clone(state),course,date,pointsCompetition:competition,stake,gameType:stake>0?'money':'points',roundOpen:true,roundId:createRoundId(),splitPrizes:false,firstPrize:0,secondPrize:0,thirdPrize:0};
    if(!await save())throw Error('Save not confirmed. Close this form and reload your saved group.');
    overlay.remove();render();status('Competition saved and open. Invite your friends when you’re ready.');
   }catch(error){if(e===epoch)get('guidedError').textContent=error.message;}
   finally{saving=false;overlay.querySelectorAll('button,input,select').forEach(el=>el.disabled=false);}
  };
  get('normalSetupCourse').focus();
 }

 function apply(g){
  if(!valid(g)||g.group_pin!==active.pin)throw Error('Could not confirm the signed-in group.');
  revision=g.revision;state=clone(g.state);active.group=g;
 }
 async function reload(manual=false){
  if(!active || manualLoading)return;
  if(!manual && (pending || blocked || refreshBlocked()))return;
  if(manual && (finishRoundActive || normalFinishInProgress || scoreDraftActive || document.querySelector('#appPromptInput,#appConfirmYes,#normalSetupCourse'))) {status('Finish or cancel your current entry before reloading.');return;}
  const current=active,e=epoch,sequence=++readSequence;
  const button=document.getElementById('secureOrganiserReload');
  if(manual){manualLoading=true;if(button){button.disabled=true;button.textContent='Reloading…';}status(pending?'Finishing your save, then reloading…':'Loading your saved group…');}
  try{
   // A tap during a save must wait for it, rather than silently doing nothing.
   if(manual && pending)await queue;
   if(e!==epoch)return;
   if(pending){if(manual)status('Another save is in progress. Tap Reload saved group once it finishes.');return;}
   const version=stateSaveVersion;
   const g=await current.request('/rest/v1/rpc/iig_get_owned_group',{},true);
   if(e!==epoch || sequence!==readSequence)return;
   if(pending || stateSaveVersion!==version){if(manual)status('Your group changed while loading. Tap Reload saved group again.');return;}
   if(!manual && refreshBlocked())return;
   apply(g);blocked=false;render();
   if(manual){
    const details=g.state.course ? g.state.course+' · '+(g.state.date||'Date not set') : 'No competition has been saved yet.';
    status('Reloaded at '+new Date().toLocaleTimeString('en-GB')+' — '+details);
    document.getElementById('syncText').textContent='Test group • saved details checked';
   }
  }catch(error){if(e===epoch && sequence===readSequence){blocked=true;status(error.message+' Use Reload saved group before making more changes.');}}
  finally{if(manual){manualLoading=false;if(button){button.disabled=false;button.textContent='Reload saved group';}}}
 }

 window.iigSecureOrganiser={
  invite:invitePlayers,
  firstCompetition,
  get active(){return !!active;},
  async prepareFinish(){
   if(!active || !isAdmin)throw Error('Sign in as your group organiser to finish the round.');
   if(pending || blocked)throw Error('Reload the saved group before finishing the round.');
   const current=active,e=epoch,v=stateSaveVersion;
   readSequence++;
   const group=await current.request('/rest/v1/rpc/iig_get_owned_group',{},true);
   if(e!==epoch || pending || stateSaveVersion!==v)throw Error('Your group changed. Reload it before finishing the round.');
   if(!valid(group)||group.group_pin!==current.pin)throw Error('Could not confirm your saved group.');
   if(group.state.roundOpen!==true)throw Error('This round is already closed. Check League → Previous rounds.');
   if(group.state.trip?.completed)throw Error('This trip is already complete. Check its saved results.');
   apply(group);
   status('Latest scores loaded. Finishing the round…');
  },
  open(group,request,signout,plan){
   if(!valid(group))throw Error('Group details are incomplete. Tap Check my group.');
   epoch++;active={pin:group.group_pin,request,signout,group};blocked=false;revision=group.revision;
   pin=group.group_pin;state=clone(group.state);groupPlanType=plan || group.plan_type || 'trial';
   // A deny-by-default stub prevents any legacy RPC from reaching production.
   db={rpc:async()=>({data:null,error:{message:'This action is not connected for secure test groups yet.'}})};
   isAdmin=true;isOwner=false;ownerCreationCode='';myPlayerId='';
   document.getElementById('setupOverlay').classList.add('hidden');
   document.querySelector('nav').style.display='';document.getElementById('demoBadge').classList.add('hidden');
   banner();show('round');status('Group '+pin+' · competition setup in your original layout.');
   document.getElementById('syncText').textContent='Test group • signed in';startPolling();
  },
  close(){
   if(!active)return;
   cancelProtectedDialogs();
   document.getElementById('guidedFirstCompetition')?.remove();
   epoch++;active=null;blocked=true;clearInterval(poller);poller=null;db=null;pin='';isAdmin=false;isOwner=false;myPlayerId='';state={players:[],history:[]};lastWinnerRecord=null;statsPlayerId=null;scoreDraftActive=false;
   document.getElementById('secureOrganiserBanner')?.remove();document.getElementById('screen').textContent='';
   document.getElementById('setupOverlay').classList.remove('hidden');showWelcomePanel('start');
  }
 };
 save=async function(){
  if(!active)return originals.save();
  if(blocked){status('Reload the saved group before making more changes.');return false;}
  const current=active,e=epoch,snapshot=clone(state);snapshot.lastActivityAt=new Date().toISOString();
  stateSaveVersion++;pending++;saveActive=true;
  status('Saving…');
  const job=queue.then(async()=>{
   if(e!==epoch||blocked)return false;
   try{
    const next=await current.request('/rest/v1/rpc/iig_save_owned_group',{p_pin:current.pin,p_state:snapshot,p_revision:revision},true);
    if(e!==epoch)return false;
    if(!Number.isSafeInteger(next)||next!==revision+1)throw Error('Save response could not be confirmed.');
    revision=next;current.group={...current.group,revision:next,state:clone(snapshot)};status('Saved to your test group.');document.getElementById('syncText').textContent='Test group • saved';return true;
   }catch(error){if(e===epoch){blocked=true;state=clone(current.group.state);status(error.message+' Reload the saved group before continuing.');document.getElementById('syncText').textContent='Save not confirmed';}return false;}
   finally{ /* queue cleanup below includes writes invalidated before sending */ }
  });
  queue=job.catch(()=>false);
  try{return await job;}finally{pending--;saveActive=pending>0;}
 };
 refresh=async()=>active?reload(false):originals.refresh();
 refreshSideGameLive=async()=>active?reload(false):originals.refreshSideGameLive();
 render=function(){
  originals.render();if(!active)return;
  // These legacy journeys depend on a PIN-only identity or an unconnected native service.
  for(const el of document.querySelectorAll('#screen [onclick]')){
   if(/^(changeAdminPin|ownerLogin|adminInvitePage|openAdminHelp)\(/.test(el.getAttribute('onclick')||''))el.hidden=true;
  }
  banner();
 };
 adminLogout=function(){if(active){if(pending){status('Wait for saving to finish.');return;}active.signout();}else originals.adminLogout();};
 savePlayerPatch=async function(id,patch){
  if(!active)return originals.savePlayerPatch(id,patch);
  if(pending||blocked)return false;
  const current=active,e=epoch,v=stateSaveVersion;
  try{
   const g=await current.request('/rest/v1/rpc/iig_get_owned_group',{},true);
   if(e!==epoch||pending||stateSaveVersion!==v)return false;
   apply(g);const player=state.players.find(p=>p.id===id);if(!player)return false;
   if(Object.keys(patch).some(k=>!['stableford','netScore','scoreSubmitted','noReturn','competition'].includes(k)))throw Error('Unsupported score correction');
   Object.assign(player,patch);return await save();
  }catch(error){if(e===epoch){blocked=true;status(error.message+' Reload the saved group.');}return false;}
 };
 returnToPlayerView=function(){if(active){window.iigAccount?.open();return;}originals.returnToPlayerView();};
 copyInvite=function(){if(active){invitePlayers();return;}return originals.copyInvite();};
 changeAdminPin=function(){if(active){status('This group uses your verified email sign-in.');return;}return originals.changeAdminPin();};
})();
