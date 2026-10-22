/* Organiser adapter for the isolated preview. Uses verified-owner RPCs only. */
(() => {
 'use strict';
 if(location.hostname!=='deploy-preview-6--super-quokka-51747d.netlify.app' && !['localhost','127.0.0.1'].includes(location.hostname))return;
 let active=null, epoch=0, revision=0, blocked=false, queue=Promise.resolve(), pending=0;
 const originals={save,refresh,refreshSideGameLive,render,adminLogout,returnToPlayerView,copyInvite,changeAdminPin};
 const clone=value=>JSON.parse(JSON.stringify(value));
 const valid=g=>g && /^\d{4}$/.test(g.group_pin) && Number.isSafeInteger(g.revision) && Array.isArray(g.state?.players) && Array.isArray(g.state?.history);
 function status(text){const node=document.getElementById('secureOrganiserStatus');if(node)node.textContent=text;}
 function banner(){
  if(!active)return;
  let node=document.getElementById('secureOrganiserBanner');
  if(!node){
   node=document.createElement('div');node.id='secureOrganiserBanner';node.className='notice';
   node.innerHTML='<b>Test group · signed-in organiser</b><p id="secureOrganiserStatus" role="status" aria-live="polite"></p><button id="secureOrganiserReload" class="secondary">Reload saved group</button> <button id="secureOrganiserSignout" class="ghost">Sign out</button>';
   document.getElementById('screen').before(node);
   node.querySelector('#secureOrganiserReload').onclick=()=>reload(true);
   node.querySelector('#secureOrganiserSignout').onclick=()=>{if(pending){status('Wait for saving to finish.');return;}active?.signout();};
  }
 }
 function apply(g){
  if(!valid(g)||g.group_pin!==active.pin)throw Error('Could not confirm the signed-in group.');
  revision=g.revision;state=clone(g.state);active.group=g;
 }
 async function reload(manual=false){
  if(!active)return;
  if(pending || (!manual && (blocked || refreshBlocked())))return;
  if(manual && (scoreDraftActive || document.querySelector('#appPromptInput,#appConfirmYes'))) {status('Finish or cancel your current entry before reloading.');return;}
  const current=active, version=stateSaveVersion, e=epoch;
  try{
   const g=await current.request('/rest/v1/rpc/iig_get_owned_group',{},true);
   if(e!==epoch || pending || stateSaveVersion!==version || (!manual && refreshBlocked()))return;
   apply(g);blocked=false;render();status('Saved group loaded.');
  }catch(error){if(e===epoch){blocked=true;status(error.message+' Use Reload saved group before making more changes.');}}
 }
 window.iigSecureOrganiser={
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
   if(/^(changeAdminPin|copyInvite|returnToPlayerView|ownerLogin|adminInvitePage|openAdminHelp|changeGroupName)\(/.test(el.getAttribute('onclick')||''))el.hidden=true;
  }
  banner();
 };
 adminLogout=function(){if(active){if(pending){status('Wait for saving to finish.');return;}active.signout();}else originals.adminLogout();};
 returnToPlayerView=function(){if(active){status('Player sign-in in the original layout is the next integration step.');return;}originals.returnToPlayerView();};
 copyInvite=function(){if(active){status('Use the tested invitation page for now. Player invitations in this layout are still being connected.');return;}return originals.copyInvite();};
 changeAdminPin=function(){if(active){status('This group uses your verified email sign-in.');return;}return originals.changeAdminPin();};
})();
