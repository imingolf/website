/* Organiser adapter for the separately configured TEST build. Uses verified-owner RPCs only. */
(() => {
 'use strict';
 if(!window.IIG_ACCOUNT_ACCESS)return;
 let active=null, epoch=0, revision=0, blocked=false, blockedReason='', queue=Promise.resolve(), pending=0, readSequence=0, manualLoading=false;
 const originals={save,refresh,refreshSideGameLive,render,adminLogout,returnToPlayerView,copyInvite,changeAdminPin,savePlayerPatch,togglePaid};
 const clone=value=>JSON.parse(JSON.stringify(value));
 const validEntry=e=>e&&typeof e.open==='boolean'&&typeof e.closed==='boolean'&&(e.entrantIds===null&&(!e.closed||!e.open)||Array.isArray(e.entrantIds)&&e.entrantIds.every(id=>typeof id==='string'));
 const operations=new Set(['payment','finish','start','correct','cancel','settings','members','settle','tripreturn','tripcancel','resetscores','resetpayments','deletelast','clearleague','deletepasttrip','configure']);
 const valid=g=>g && /^\d{4}$/.test(g.group_pin) && Number.isSafeInteger(g.revision) && Array.isArray(g.state?.players) && Array.isArray(g.state?.history);
 function status(text){const node=document.getElementById('secureOrganiserStatus');if(node)node.textContent=text;}
 function block(reason){blocked=true;blockedReason=reason;status(reason);}
 function banner(){
  if(!active)return;
  let node=document.getElementById('secureOrganiserBanner');
  if(!node){
   node=document.createElement('div');node.id='secureOrganiserBanner';node.className='notice';
   node.innerHTML='<b>Organiser</b><p id="secureOrganiserStatus" role="status" aria-live="polite"></p><button type="button" id="secureOrganiserReload" class="secondary">Reload saved group</button><details class="ui-options"><summary>Group options</summary><button type="button" id="secureOrganiserInvite" class="secondary">Invite players</button><div id="secureInviteBox" role="region" aria-label="Player invitation" tabindex="-1" hidden><div id="secureInviteControls"><input id="secureInviteLink" readonly hidden><a id="secureInviteWhatsApp" class="primary full ui-invite-action" target="_blank" rel="noopener noreferrer"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.5 8.5 0 0 1-12.6 7.4L3 21l2.1-5.4A8.5 8.5 0 1 1 21 11.5Z"/><path d="M8.5 7.5c0 4 4 8 8 8l1-2-3-1-1 1a8 8 0 0 1-3-3l1-1-1-3-2 1Z"/></svg><span>Invite via WhatsApp</span></a><button type="button" id="secureInviteShare" class="primary full ui-invite-action"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V3m-5 5 5-5 5 5M5 13v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7"/></svg><span>Share invitation</span></button><button type="button" id="secureInviteCopy" class="primary full ui-invite-action"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg><span>Copy invitation</span></button><label id="secureInviteMessageLabel" for="secureInviteMessage" hidden>Invitation message</label><textarea id="secureInviteMessage" readonly rows="7" hidden></textarea></div><p id="secureInviteStatus" role="status" aria-live="polite"></p></div><button type="button" id="secureOrganiserFirstCompetition" class="secondary" hidden>Create first competition</button><button type="button" id="secureOrganiserPlayerView" class="secondary" hidden>Switch to player view</button><button type="button" id="secureOrganiserAccount" class="secondary">My account</button><button type="button" id="secureOrganiserSignout" class="ghost">Sign out</button></details>';
   document.getElementById('screen').before(node);
   node.querySelector('#secureOrganiserInvite').onclick=invitePlayers;
   const reconnect=document.createElement('button');reconnect.id='secureOrganiserReconnect';reconnect.type='button';reconnect.className='secondary';reconnect.textContent='Reconnect existing players';reconnect.onclick=relinkPlayers;
   node.querySelector('#secureOrganiserInvite').after(reconnect);
   node.querySelector('#secureInviteCopy').onclick=async()=>{
    const input=document.getElementById('secureInviteLink'),note=document.getElementById('secureInviteStatus'),fallback=document.getElementById('secureInviteMessage'),label=document.getElementById('secureInviteMessageLabel');
    try{if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(input.dataset.message);fallback.hidden=true;label.hidden=true;note.textContent='Invitation copied.';return;}}catch(_){}
    fallback.value=input.dataset.message;fallback.hidden=false;label.hidden=false;fallback.focus();fallback.select();fallback.setSelectionRange?.(0,fallback.value.length);
    note.textContent='Invitation message selected. Touch and hold to copy, or press Command+C on your Mac.';
   };
   node.querySelector('#secureInviteShare').onclick=async()=>{
    const message=document.getElementById('secureInviteLink').dataset.message;
    if(!message)return;
    if(!navigator.share){document.getElementById('secureInviteCopy').click();return;}
    try{await navigator.share({text:message});document.getElementById('secureInviteStatus').textContent='Invitation shared.';}
    catch(error){if(error.name==='AbortError')return;document.getElementById('secureInviteStatus').textContent='Sharing is unavailable. Use Copy invitation below.';document.getElementById('secureInviteCopy').focus();}
   };
   node.querySelector('#secureOrganiserFirstCompetition').onclick=firstCompetition;
   node.querySelector('#secureOrganiserPlayerView').onclick=()=>returnToPlayerView();
   node.querySelector('#secureOrganiserAccount').onclick=()=>window.iigAccount?.open();
   node.querySelector('#secureOrganiserReload').onclick=()=>reload(true);
   node.querySelector('#secureOrganiserSignout').onclick=()=>{if(pending){status('Wait for saving to finish.');return;}active?.signout();};
  }
  node.querySelector('#secureOrganiserFirstCompetition').hidden=!firstRoundNotYetCreated();
  node.querySelector('#secureOrganiserPlayerView').hidden=false;
  node.querySelector('#secureOrganiserInvite').textContent=window.IIG_ACCOUNT_BUILD?.release==='focused-v1'&&active.pin==='1010'?'Reconnect existing players':'Invite players';
  node.querySelector('#secureOrganiserReconnect').hidden=window.IIG_ACCOUNT_BUILD?.release!=='focused-v1'||!['1260','8759'].includes(active.pin);
 }
 function relinkPlayers(){
  if(!active||!['1010','1260','8759'].includes(active.pin)||pending||blocked)return;
  const panel=document.createElement('div');panel.id='relinkPlayers';panel.className='card';
  panel.innerHTML='<h2>Reconnect an existing player</h2><p>Check that this is the original golfer and verify their email privately. This connects their existing history; it does not create or rename a player. Verify a fresh email code before continuing.</p><label for="relinkPlayer">Existing player</label><select id="relinkPlayer"></select><label for="relinkEmail">Their verified email</label><input id="relinkEmail" type="email"><button id="relinkIssue" type="button" class="primary">Create private reconnection link</button><label for="relinkLink">Private link — expires in 24 hours</label><input id="relinkLink" readonly><p id="relinkMessage" role="status"></p><button id="relinkClose" type="button" class="secondary">Close</button>';
  document.getElementById('relinkPlayers')?.remove();document.getElementById('screen').before(panel);
  const get=id=>panel.querySelector('#'+id),current=active,e=epoch;
  for(const player of state.players){const option=document.createElement('option');option.value=player.id;option.textContent=player.name+' · handicap '+(player.handicap??'—');get('relinkPlayer').appendChild(option);}
  get('relinkClose').onclick=()=>panel.remove();
  get('relinkIssue').onclick=async()=>{
   get('relinkIssue').disabled=true;get('relinkLink').value='';
   try{const token=await current.request('/rest/v1/rpc/iig_issue_player_relink',{p_pin:current.pin,p_player:get('relinkPlayer').value,p_email:get('relinkEmail').value.trim()},true);
    if(e!==epoch||current!==active)return;
    if(!/^[a-f0-9]{64}$/.test(token))throw Error('Reconnection could not be confirmed.');
    get('relinkLink').value=location.origin+'/app/#pin='+encodeURIComponent(current.pin)+'&relink='+encodeURIComponent(token);
    get('relinkLink').focus();get('relinkLink').select();get('relinkMessage').textContent='Share privately with this golfer only. They must sign in with the matching verified email. The original player ID and history stay unchanged.';
   }catch(error){get('relinkMessage').textContent=error.message;}finally{get('relinkIssue').disabled=false;}
  };
 }
 function revealInvitation(text,ready=false){
  const box=document.getElementById('secureInviteBox');
  box.hidden=false;const options=box.closest('details');if(options)options.open=true;
  document.getElementById('secureInviteControls').hidden=!ready;
  document.getElementById('secureInviteStatus').textContent=text;
  box.focus({preventScroll:true});box.scrollIntoView?.({block:'start'});
 }
 async function invitePlayers(){
  if(window.IIG_ACCOUNT_BUILD?.release==='focused-v1'&&active?.pin==='1010'){relinkPlayers();return;}
  if(!active)return;
  const g=active.group;
  if(pending||blocked){revealInvitation('Reload the saved group before inviting players.');return;}
  if(!/^[0-9a-f-]{36}$/i.test(g.invite_token||'')){revealInvitation('Reload your saved group to load its invitation.');return;}
  const current=active,e=epoch;revealInvitation('Preparing your invitation…');
  try{
   const options=await current.request('/rest/v1/rpc/iig_get_player_join_options',{p_pin:current.pin},true);
   if(e!==epoch||active!==current)return;
   if(pending||blocked){revealInvitation('Reload the saved group before inviting players.');return;}
   if(options?.group_pin!==current.pin||typeof options.pin_join_enabled!=='boolean')throw Error('Could not confirm the group joining instructions. Reload your saved group.');
   const url=location.origin+'/app/#pin='+encodeURIComponent(current.pin)+'&invite='+encodeURIComponent(g.invite_token),name=g.state.groupName||'our golf group';
   const fallback=options.pin_join_enabled?'Group PIN: '+current.pin:'Group PIN: '+current.pin+' (use the private invitation above to join)';
   const message="⛳ You're invited to join "+name+"!\n\nJoin our golf group on I'm In Golf to see who's playing, enter competitions and follow results.\n\nTap to join:\n"+url+"\nVerify your email if asked, then enter your name and handicap.\n\n"+fallback+"\n\nWorks on iPhone, Android and other devices through your browser.\n\nAlready joined? Use your existing email.";
   document.getElementById('secureInviteLink').value=url;document.getElementById('secureInviteLink').dataset.message=message;
   document.getElementById('secureInviteWhatsApp').setAttribute('href','https://wa.me/?text='+encodeURIComponent(message));
   revealInvitation('Share this invitation with your players.',true);
  }catch(error){if(e===epoch&&active===current)revealInvitation(error.message||'Could not prepare your invitation. Reload the saved group.');}
 }
 function firstCompetition(){
  if(!active || pending || blocked){status('Reload your saved group before creating a competition.');return;}
  if(!firstRoundNotYetCreated()){show('round');status('Your group already has competition details. Use the existing round controls.');return;}
  if(document.getElementById('guidedFirstCompetition'))return;
  const current=active,e=epoch;
  const overlay=document.createElement('div');overlay.id='guidedFirstCompetition';overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-label','Create first competition');
  overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:11000;padding:20px;overflow:auto';
  overlay.innerHTML='<form class="card" style="max-width:500px;margin:16px auto"><button type="button" class="ghost ui-close" id="guidedClose" aria-label="Close competition setup">Close</button><h2>Your first competition</h2><p>Choose your course, date and scoring.</p><label for="normalSetupCourse">Course</label><input id="normalSetupCourse" maxlength="120" required><label for="guidedDate">Date</label><input id="guidedDate" type="date" required><label for="guidedScoring">Scoring</label><select id="guidedScoring"><option value="stableford">Stableford</option><option value="net">Net</option></select><p class="muted">Stableford: final points total. Net: final score after handicap.</p><details><summary>Optional entry fee</summary><label for="guidedStake">Amount per player (£)</label><input id="guidedStake" inputmode="numeric" pattern="[0-9]*" value="0"><small>For a paid Money Game, add your payment link in Organiser settings first.</small></details><p id="guidedError" role="status" aria-live="polite"></p><button class="primary full" id="guidedSave">Save & open competition</button><button type="button" class="secondary full" id="guidedAdvanced">More options & Trip Mode</button><button type="button" class="ghost full" id="guidedCancel">Not now</button></form>';
  document.body.appendChild(overlay);
  overlay.querySelectorAll('input,select').forEach(el=>{el.style.cssText='width:100%;font-size:18px;min-height:44px;margin:8px 0 14px';});
  overlay.querySelectorAll('label').forEach(el=>el.style.display='block');
  const get=id=>overlay.querySelector('#'+id);
  get('guidedCancel').onclick=()=>overlay.remove();get('guidedClose').onclick=()=>get('guidedCancel').click();
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
    const g=await current.request('/rest/v1/rpc/iig_read_owned_entry_group',{p_pin:current.pin},true);
    if(e!==epoch||pending||blocked)throw Error('Your group changed. Reload it before continuing.');
    apply(g);
    if(!firstRoundNotYetCreated())throw Error('A competition has already been created. Close this form and reload your group.');
    if(stake>0&&!String(state.paymentLink||'').trim())throw Error('Add your payment link in Organiser settings first, or create a competition with no entry fee.');
    state={...clone(state),course,date,pointsCompetition:competition,stake,gameType:stake>0?'money':'points',roundOpen:true,roundId:createRoundId(),splitPrizes:false,firstPrize:0,secondPrize:0,thirdPrize:0};
    // Joined players can exist before the first competition. Use the same reset
    // fields as the existing new-round flow; preserve identity and past totals.
    state.players=state.players.map(p=>({...p,paid:false,playingThisRound:false,competition:null,stableford:null,netScore:null,noReturn:false,scoreSubmitted:false}));
    if(!await save('start'))throw Error('Save not confirmed. Close this form and reload your saved group.');
    overlay.remove();render();status('Competition saved and open. Invite your friends when you’re ready.');
   }catch(error){if(e===epoch)get('guidedError').textContent=error.message;}
   finally{saving=false;overlay.querySelectorAll('button,input,select').forEach(el=>el.disabled=false);}
  };
  get('normalSetupCourse').focus();
 }

 function apply(g){
  if(!valid(g)||g.group_pin!==active.pin||!validEntry(g.entry))throw Error('Could not confirm the signed-in group.');
  revision=g.revision;state=clone(g.state);active.group=g;
 }
 async function reload(manual=false,sideLive=false){
  if(!active || manualLoading)return;
  if(!manual && (pending || blocked || refreshBlocked()))return;
  if(!manual&&(sideLive?(!sideGameOpen||!sideGameHomeOpen):sideGameOpen))return;
  if(manual && (finishRoundActive || normalFinishInProgress || scoreDraftActive || document.querySelector('#appPromptInput,#appConfirmYes,#normalSetupCourse'))) {status('Finish or cancel your current entry before reloading.');return;}
  const current=active,e=epoch,sequence=++readSequence,requestPage=page,requestSide=sideGameOpen,requestHome=sideGameHomeOpen;
  const button=document.getElementById('secureOrganiserReload');
  if(manual){manualLoading=true;if(button){button.disabled=true;button.textContent='Reloading…';}status(pending?'Finishing your save, then reloading…':'Loading your saved group…');}
  try{
   // A tap during a save must wait for it, rather than silently doing nothing.
   if(manual && pending)await queue;
   if(e!==epoch)return;
   if(pending){if(manual)status('Another save is in progress. Tap Reload saved group once it finishes.');return;}
   const version=stateSaveVersion;
   const g=await current.request('/rest/v1/rpc/iig_read_owned_entry_group',{p_pin:current.pin},true);
   if(e!==epoch || sequence!==readSequence)return;
   if(pending || stateSaveVersion!==version){if(manual)status('Your group changed while loading. Tap Reload saved group again.');return;}
   if(!manual && (refreshBlocked()||page!==requestPage||sideGameOpen!==requestSide||sideGameHomeOpen!==requestHome))return;
   const before=JSON.stringify(active.group),oldSide=JSON.stringify(state.sideGame||{}),sameRound=state.roundId===g.state?.roundId&&state.trip?.currentRound===g.state?.trip?.currentRound;
   apply(g);blocked=false;blockedReason='';
   if(manual)render();else if(sideLive){if(oldSide!==JSON.stringify(state.sideGame||{}))renderLiveUpdate(sideGameHome);}else if(before!==JSON.stringify(g))renderLiveUpdate(render,sameRound);
   if(manual){
    const details=g.state.course ? g.state.course+' · '+(g.state.date||'Date not set') : 'No competition has been saved yet.';
    status('Reloaded at '+new Date().toLocaleTimeString('en-GB')+' — '+details);
    document.getElementById('syncText').textContent='Saved details checked';
   }
  }catch(error){if(e===epoch && sequence===readSequence)block('Group reload failed: '+error.message+' Use Reload saved group before making more changes.');}
  finally{if(manual){manualLoading=false;if(button){button.disabled=false;button.textContent='Reload saved group';}}}
 }

 window.iigSecureOrganiser={
  invite:invitePlayers,
  reconnect:relinkPlayers,
  firstCompetition,
  get active(){return !!active;},
  get groupPin(){return active?.pin||null;},
  get canSwitchView(){return !!active&&!pending&&!blocked&&!manualLoading&&!scoreDraftActive;},
  get entryStatus(){return active?clone(active.group.entry):null;},
  async maintain(operation,selection=null){
   if(!active||!isAdmin||pending||blocked||scoreDraftActive)return false;
   const current=active,e=epoch,rev=revision,version=stateSaveVersion;
   try{
    const proposal=await current.request('/rest/v1/rpc/iig_prepare_owned_entry',{p_pin:current.pin,p_operation:operation,p_revision:rev,p_selection:selection},true);
    if(e!==epoch||pending||blocked||rev!==revision||version!==stateSaveVersion)return false;
    state=proposal;return await save(operation);
   }catch(error){if(e===epoch)block(error.message+' Reload the saved group.');return false;}
  },
  async prepareFinish(){
   if(!active || !isAdmin)throw Error('Sign in as your group organiser to finish the round.');
   if(pending || blocked)throw Error('Reload the saved group before finishing the round.');
   const current=active,e=epoch,v=stateSaveVersion;
   readSequence++;
   const group=await current.request('/rest/v1/rpc/iig_read_owned_entry_group',{p_pin:current.pin},true);
   if(e!==epoch || pending || stateSaveVersion!==v)throw Error('Your group changed. Reload it before finishing the round.');
   if(!valid(group)||group.group_pin!==current.pin)throw Error('Could not confirm your saved group.');
   if(group.state.roundOpen!==true)throw Error('This round is already closed. Check League → Previous rounds.');
   if(group.state.trip?.completed)throw Error('This trip is already complete. Check its saved results.');
   apply(group);
   status('Latest scores loaded. Finishing the round…');
  },
  open(group,request,signout,plan){
   if(!valid(group)||!validEntry(group.entry))throw Error('Group details are incomplete. Tap Check my group.');
   if(iigEntryBridge){iigEntryBridge.clear();iigEntryBridge=null;}
   epoch++;active={pin:group.group_pin,request,signout,group};blocked=false;blockedReason='';revision=group.revision;
   pin=group.group_pin;state=clone(group.state);groupPlanType=plan || group.plan_type || 'trial';
   // A deny-by-default stub prevents any legacy RPC from reaching production.
   db={rpc:async()=>({data:null,error:{message:'This action is unavailable. Reload your group before continuing.'}})};
   isAdmin=true;isOwner=false;ownerCreationCode='';myPlayerId='';
   document.getElementById('setupOverlay').classList.add('hidden');
   document.querySelector('nav').style.display='';document.getElementById('demoBadge').classList.add('hidden');
   banner();show('round');status('Group '+pin+' · organiser access');
   document.getElementById('syncText').textContent='Organiser • signed in';startPolling();
  },
  close(){
   if(!active)return;
   cancelProtectedDialogs();
   document.getElementById('guidedFirstCompetition')?.remove();
   epoch++;active=null;blocked=true;clearInterval(poller);poller=null;db=null;pin='';isAdmin=false;isOwner=false;myPlayerId='';state={players:[],history:[]};lastWinnerRecord=null;statsPlayerId=null;scoreDraftActive=false;
   document.getElementById('relinkPlayers')?.remove();document.getElementById('secureOrganiserBanner')?.remove();document.getElementById('screen').textContent='';
   document.getElementById('setupOverlay').classList.remove('hidden');showWelcomePanel('start',false);
  }
 };
 save=async function(operation='save'){
  if(!active)return originals.save(operation);
  if(blocked){status('Changes blocked. '+(blockedReason||'Reload the saved group before making more changes.'));return false;}
  if(pending){status('Save already in progress. Wait for it to finish before making more changes.');return false;}
  if(manualLoading){status('Saved group is reloading. Wait for it to finish before making more changes.');return false;}
  if(operation!=='save'&&!operations.has(operation)){status('Use the account-bound player action for this change.');return false;}
  const current=active,e=epoch,expected=revision,snapshot=clone(state);snapshot.lastActivityAt=new Date().toISOString();
  stateSaveVersion++;pending++;saveActive=true;status('Saving…');
  const job=(async()=>{
   try{
    const name=operation==='save'?'iig_save_owned_group':'iig_operate_owned_group';
    const params={p_pin:current.pin,p_state:snapshot,p_revision:expected};
    if(operation!=='save')params.p_operation=operation;
    const next=await current.request('/rest/v1/rpc/'+name,params,true);
    if(e!==epoch)return false;
    if(!Number.isSafeInteger(next)||next!==expected+1)throw Error('Save response could not be confirmed.');
    // Never infer the new round ID or closure from the submitted snapshot.
    const latest=await current.request('/rest/v1/rpc/iig_read_owned_entry_group',{p_pin:current.pin},true);
    if(e!==epoch)return false;
    if(latest?.revision<next)throw Error('Saved revision could not be read back.');
    apply(latest);status('Saved to your group.');document.getElementById('syncText').textContent='Group saved';return true;
   }catch(error){if(e===epoch){state=clone(current.group.state);block('Save failed: '+error.message+' Reload the saved group before continuing.');document.getElementById('syncText').textContent='Save not confirmed';}return false;}
  })();
  queue=job.catch(()=>false);
  try{return await job;}finally{pending--;saveActive=pending>0;}
 };
 togglePaid=async function(i){
  if(!active)return originals.togglePaid(i);
  if(pending||blocked||!isAdmin)return false;
  const p=state.players[i];if(!p)return false;
  p.paid=!p.paid;p.paymentMarkedAt=p.paid?new Date().toISOString():null;p.paymentMarkMethod=p.paid?'admin-confirmed':null;
  const saved=await save('payment');render();return saved;
 };
 refresh=async()=>active?reload(false):originals.refresh();
 refreshSideGameLive=async()=>active?reload(false,true):originals.refreshSideGameLive();
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
   const g=await current.request('/rest/v1/rpc/iig_read_owned_entry_group',{p_pin:current.pin},true);
   if(e!==epoch||pending||stateSaveVersion!==v)return false;
   apply(g);const player=state.players.find(p=>p.id===id);if(!player)return false;
   if(Object.keys(patch).some(k=>!['stableford','netScore','scoreSubmitted','noReturn','competition'].includes(k)))throw Error('Unsupported score correction');
   // Initial submissions use the ordinary guarded writer. The explicit
   // Correct score action separately calls save('correct').
   Object.assign(player,patch);return await save();
  }catch(error){if(e===epoch)block(error.message+' Reload the saved group.');return false;}
 };
 returnToPlayerView=function(){if(active){window.iigOpenOwnPlayer?.(active.pin);return;}originals.returnToPlayerView();};
 copyInvite=function(){if(active){invitePlayers();return;}return originals.copyInvite();};
 changeAdminPin=function(){if(active){status('This group uses your verified email sign-in.');return;}return originals.changeAdminPin();};
})();
