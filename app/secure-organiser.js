/* Organiser adapter for the isolated preview. Uses verified-owner RPCs only. */
(() => {
 'use strict';
 if(location.hostname!=='deploy-preview-6--super-quokka-51747d.netlify.app' && !['localhost','127.0.0.1'].includes(location.hostname))return;
 let active=null, epoch=0, revision=0, blocked=false, queue=Promise.resolve(), pending=0, readSequence=0, manualLoading=false;
 const originals={save,refresh,refreshSideGameLive,render,adminLogout,returnToPlayerView,copyInvite,changeAdminPin};
 const clone=value=>JSON.parse(JSON.stringify(value));
 const valid=g=>g && /^\d{4}$/.test(g.group_pin) && Number.isSafeInteger(g.revision) && Array.isArray(g.state?.players) && Array.isArray(g.state?.history);
 function status(text){const node=document.getElementById('secureOrganiserStatus');if(node)node.textContent=text;}
 function banner(){
  if(!active)return;
  let node=document.getElementById('secureOrganiserBanner');
  if(!node){
   node=document.createElement('div');node.id='secureOrganiserBanner';node.className='notice';
   node.innerHTML='<b>Test group · signed-in organiser</b><p id="secureOrganiserStatus" role="status" aria-live="polite"></p><button type="button" id="secureOrganiserReload" class="secondary">Reload saved group</button> <button type="button" id="secureOrganiserInvite" class="secondary">Invite players</button><div id="secureInviteBox" hidden><label for="secureInviteLink">Player invitation</label><input id="secureInviteLink" readonly><button type="button" id="secureInviteCopy" class="secondary">Copy invitation link</button><p id="secureInviteStatus" role="status" aria-live="polite"></p><a id="secureInviteOpen" target="_blank" rel="noopener noreferrer">Open invitation in a new tab</a></div> <button type="button" id="secureOrganiserSignout" class="ghost">Sign out</button>';
   document.getElementById('screen').before(node);
   node.querySelector('#secureOrganiserInvite').onclick=invitePlayers;
   node.querySelector('#secureInviteCopy').onclick=async()=>{
    const input=document.getElementById('secureInviteLink'),note=document.getElementById('secureInviteStatus');input.focus();input.select();input.setSelectionRange?.(0,input.value.length);
    note.textContent='Link selected. Touch and hold to copy, or press Command+C on your Mac.';
    try{if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(input.value);note.textContent='Invitation copied.';}}catch(_){}
   };
   node.querySelector('#secureOrganiserReload').onclick=()=>reload(true);
   node.querySelector('#secureOrganiserSignout').onclick=()=>{if(pending){status('Wait for saving to finish.');return;}active?.signout();};
  }
 }
 function invitePlayers(){
  if(!active)return;
  const g=active.group;
  if(pending||blocked){status('Reload the saved group before inviting players.');return;}
  if(g.state.gameType!=='points'||g.state.roundOpen!==true){status('Set up and save an open Points Game before inviting test players.');return;}
  if(!/^[0-9a-f-]{36}$/i.test(g.invite_token||'')){status('Reload your saved group to load its invitation.');return;}
  const url=location.origin+'/app/#pin='+encodeURIComponent(active.pin)+'&invite='+encodeURIComponent(g.invite_token);
  document.getElementById('secureInviteLink').value=url;
  document.getElementById('secureInviteOpen').href=url;
  document.getElementById('secureInviteBox').hidden=false;
  status('Share this test invitation with your player. They will verify their email before joining.');
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
   if(group.state.gameType!=='points'||group.state.trip?.active)throw Error('Finishing this game type is not connected in the test preview yet.');
   apply(group);
   status('Latest scores loaded. Finishing the round…');
  },
  open(group,request,signout,plan){
   if(!valid(group))throw Error('Group details are incomplete. Tap Check my group.');
   epoch++;active={pin:group.group_pin,request,signout,group};blocked=false;revision=group.revision;
   pin=group.group_pin;state=clone(group.state);groupPlanType=plan || 'trial';
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
   epoch++;active=null;blocked=true;clearInterval(poller);poller=null;db=null;pin='';isAdmin=false;isOwner=false;myPlayerId='';
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
  for(const el of document.querySelectorAll('[onclick]')){
   if(/^(changeAdminPin|returnToPlayerView|ownerLogin|adminInvitePage|openAdminHelp|changeGroupName)\(/.test(el.getAttribute('onclick')||''))el.hidden=true;
  }
  banner();
 };
 adminLogout=function(){if(active){if(pending){status('Wait for saving to finish.');return;}active.signout();}else originals.adminLogout();};
 returnToPlayerView=function(){if(active){status('Player sign-in in the original layout is the next integration step.');return;}originals.returnToPlayerView();};
 copyInvite=function(){if(active){invitePlayers();return;}return originals.copyInvite();};
 changeAdminPin=function(){if(active){status('This group uses your verified email sign-in.');return;}return originals.changeAdminPin();};
})();
