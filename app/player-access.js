/* Account-bound player identification and view navigation. Server writers remain authoritative. */
(() => {
 'use strict';
 if(!window.IIG_ACCOUNT_ACCESS||window.IIG_ACCOUNT_BUILD?.release!=='focused-v1')return;
 const text=(el,value)=>{if(el&&el.textContent!==value)el.textContent=value;};
 const originalShow=show,originalPlayersPage=playersPage;
 let identificationPage=false;
 const ownPlayerId=()=>window.iigOwnPlayerId?.(pin)||null;
 function closeGroup(){
  document.getElementById('screen').hidden=false;
  document.getElementById('simplerGroupInfo')?.remove();
  for(const banner of document.querySelectorAll('.ui-group-panel')){banner.classList.remove('ui-group-panel','ui-show-options');const options=banner.querySelector('details');if(options)options.open=false;}
  for(const button of document.querySelectorAll('#uiPlayerOptions,#simplerOrganiserMenu'))button.setAttribute('aria-expanded','false');
 }
 function toggleGroup(banner){
  if(banner.classList.contains('ui-group-panel')){closeGroup();return;}
  const adapter=window.iigSecureOrganiser?.active?window.iigSecureOrganiser:window.iigSecurePlayer;
  if(!adapter?.canSwitchView){showAppToast('Finish your current action','Finish saving or cancel your current entry before opening Group.');return;}
  closeGroup();document.getElementById('iigPaymentLaunchHelp')?.remove();
  const info=document.createElement('section');info.id='simplerGroupInfo';
  const title=document.createElement('h2');title.textContent=state.groupName||'Your golf group';
  const code=document.createElement('p');code.textContent='Group PIN: '+pin;
  const close=document.createElement('button');close.type='button';close.className='secondary';close.textContent='Back';close.onclick=closeGroup;
  const change=document.createElement('button');change.id='simplerChangeGroup';change.type='button';change.className='secondary';change.textContent='Change group';
  change.onclick=()=>{if(window.iigChangeGroup?.())closeGroup();};
  info.append(title,code,change,close);banner.prepend(info);banner.classList.add('ui-group-panel','ui-show-options');
  for(const options of banner.querySelectorAll(':scope > details'))if(!options.hidden)options.open=true;
  document.getElementById('screen').hidden=true;
  for(const button of document.querySelectorAll('#uiPlayerOptions,#simplerOrganiserMenu'))button.setAttribute('aria-expanded','true');
  title.tabIndex=-1;title.focus();banner.scrollIntoView?.({block:'start'});
 }
 async function openAdminSettings(){
  closeGroup();
  const targetPin=pin;
  if(!window.iigCanReturnToOrganiser?.(targetPin))return;
  if(window.iigSecurePlayer?.active)await window.iigReturnToOrganiser?.();
  if(pin!==targetPin||!window.iigCanReturnToOrganiser?.(targetPin)||!window.iigSecureOrganiser?.active)return;
  if(!window.iigSecureOrganiser.canSwitchView){showAppToast('Finish your current action','Finish saving or cancel your current entry before opening Organiser settings.');return;}
  show('settings');window.scrollTo(0,0);
 }
 function showMemberList(){
  if(!window.iigSecurePlayer?.active&&!window.iigSecureOrganiser?.active)return;
  if(typeof scoreDraftActive==='boolean'&&scoreDraftActive){showAppToast('Finish your score','Finish or cancel your score before opening Players.');return;}
  closeGroup();
  identificationPage=true;page='players';playersPage();
  document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active',b.id==='nplayers'));
  document.getElementById('nplayers').setAttribute('aria-current','page');window.scrollTo(0,0);
 }
 playersPage=function(){
  if(!identificationPage&&!window.iigSecurePlayer?.active){originalPlayersPage();return;}
  const screen=document.getElementById('screen'),ownId=ownPlayerId(),groupPin=pin;
  screen.innerHTML='<div class="card simpler-member-list"><h2>Who are you?</h2><p id="simplerMemberGroup"></p><p class="muted">Open the player profile linked to your verified account. Other names cannot be claimed.</p><div id="simplerMemberChoices"></div><p id="simplerMemberMessage" role="status" aria-live="polite"></p><button id="simplerNotListed" type="button" class="secondary full">I’m not listed</button></div>';
  text(document.getElementById('simplerMemberGroup'),state.groupName||'Your golf group');
  const list=document.getElementById('simplerMemberChoices');
  for(const member of [...state.players].sort((a,b)=>a.name.localeCompare(b.name))){
   const button=document.createElement('button');button.type='button';button.className='secondary full simpler-member-choice';
   const name=document.createElement('strong');name.textContent=member.name+(member.id===ownId?' · You':'');
   const detail=document.createElement('small');detail.textContent='Handicap '+member.handicap+' · '+(member.id===ownId?'Linked to your verified account':'Not linked to this sign-in');button.append(name,detail);
   if(member.id!==ownId)button.disabled=true;
   else{button.classList.replace('secondary','primary');button.onclick=()=>{
    if(window.iigSecurePlayer?.active&&ownPlayerId()===member.id){show('round');return;}
    if(window.iigSecureOrganiser?.active&&ownPlayerId()===member.id){identificationPage=false;originalShow('round');returnToPlayerView();}
   };}
   list.append(button);
  }
  const add=document.getElementById('simplerNotListed');
  if(!ownId)add.classList.replace('secondary','primary');
  add.onclick=()=>{
   const linked=state.players.find(p=>p.id===ownPlayerId());
   if(linked){text(document.getElementById('simplerMemberMessage'),'This verified account is already linked to '+linked.name+'. Open that profile above. No new player has been created.');return;}
   if(window.iigSecureOrganiser?.active){identificationPage=false;originalShow('round');window.iigOpenOwnPlayer?.(groupPin);return;}
   text(document.getElementById('simplerMemberMessage'),'Use Join my golf group with your own verified email. A name selection cannot create or recover a player account.');
  };
 };
 show=function(next){closeGroup();if(next==='players'&&window.iigSecurePlayer?.active){showMemberList();return;}if(next!=='players')identificationPage=false;originalShow(next);};
 function simplify(){
  const player=!!window.iigSecurePlayer?.active,owner=!!window.iigSecureOrganiser?.active;
  const header=document.querySelector('.app-header-brand');
  if(player||owner){
   const playersTab=document.getElementById('nplayers');playersTab.hidden=false;playersTab.onclick=showMemberList;
   document.getElementById('nsettings').hidden=true;
   let controls=document.getElementById('simplerAdminControls');
   if(!controls&&header){controls=document.createElement('details');controls.id='simplerAdminControls';controls.className='ui-group-admin';const summary=document.createElement('summary');summary.textContent='Group organiser';controls.append(summary);header.append(controls);}
   const canManage=!!window.iigCanReturnToOrganiser?.(pin);
   if(controls)controls.hidden=!canManage;
   let settings=document.getElementById('simplerAdminSettings');
   if(!settings&&controls){settings=document.createElement('button');settings.id='simplerAdminSettings';settings.type='button';settings.className='secondary';settings.textContent='Organiser settings';settings.onclick=()=>{controls.open=false;openAdminSettings();};controls.append(settings);}
   let switcher=document.getElementById('simplerRoleSwitch');
   const canReturn=player&&window.iigCanReturnToOrganiser?.(pin);
   if(!switcher&&controls){switcher=document.createElement('button');switcher.id='simplerRoleSwitch';switcher.type='button';switcher.className='secondary';controls.append(switcher);}
   if(switcher&&controls&&switcher.parentElement!==controls)controls.append(switcher);
   if(switcher){switcher.hidden=!owner&&!canReturn;text(switcher,owner?'Player view':'Organiser view');switcher.onclick=()=>{
    controls.open=false;closeGroup();
    if(window.iigSecureOrganiser?.active){if(ownPlayerId())returnToPlayerView();else showMemberList();}
    else if(window.iigCanReturnToOrganiser?.(pin))window.iigReturnToOrganiser?.();
   };}
   const returnMessage=document.getElementById('securePlayerOrganiserStatus');
   if(returnMessage&&header&&returnMessage.parentElement!==header)header.append(returnMessage);
   if(owner)header?.querySelector('#securePlayerOrganiserStatus')?.remove();
  }else document.getElementById('simplerAdminControls')?.remove();
  const created=document.getElementById('regCreated');
  if(created&&!created.hidden){
   document.getElementById('regOwnerPlayerSetup').hidden=true;
   if(!/failed|could not|not confirmed|check my group/i.test(document.getElementById('regMessage')?.textContent||''))document.getElementById('regReload').hidden=true;
  }
  const ownerMenu=document.getElementById('secureOrganiserBanner');
  if(owner&&ownerMenu&&header){
   const details=ownerMenu.querySelector('details');
   if(details){
    details.querySelector('summary').hidden=true;
    let button=document.getElementById('simplerOrganiserMenu');
    if(!button){button=document.createElement('button');button.id='simplerOrganiserMenu';button.className='secondary';button.textContent='Group';button.setAttribute('aria-controls','secureOrganiserBanner');button.onclick=()=>toggleGroup(ownerMenu);header.append(button);}
    button.setAttribute('aria-expanded',String(details.open));
    const originalSettings=document.getElementById('adminModeBadge');if(originalSettings)originalSettings.hidden=true;
    if(!document.getElementById('simplerGroupSettings')){const settings=document.createElement('button');settings.id='simplerGroupSettings';settings.type='button';settings.className='secondary';settings.textContent='Group settings';settings.onclick=openAdminSettings;document.getElementById('secureOrganiserAccount').before(settings);}
   }
   for(const duplicate of document.querySelectorAll('#screen [onclick^="returnToPlayerView("]'))duplicate.hidden=true;
   document.getElementById('secureOrganiserPlayerView').hidden=true;
   if(document.querySelector('#screen [onclick="newRound()"]')){const duplicateSetup=document.getElementById('secureOrganiserFirstCompetition');if(duplicateSetup)duplicateSetup.hidden=true;}
  }else document.getElementById('simplerOrganiserMenu')?.remove();
  const playerMenu=document.getElementById('securePlayerBanner');
  if(player&&playerMenu){
   const group=document.getElementById('uiPlayerOptions');text(group,'Group');group?.setAttribute('aria-label','Group and account options');
   const account=document.getElementById('securePlayerAccount'),options=account?.closest('details');text(account,'My account');
   if(options){options.open=true;options.querySelector('summary').hidden=true;}
   const entry=playerMenu.querySelector('details');if(entry&&entry!==options)text(entry.querySelector('summary'),'My entry');
   const me=typeof state==='object'?state.players?.find(p=>p.id===myPlayerId):null;
   const identity=[...document.querySelectorAll('#screen .notice')].find(el=>/^(?:👤\s*)?You:|^Playing as/.test(el.textContent.trim()));
   if(identity&&me){identity.classList.add('simpler-player-identity');text(identity,'Playing as '+me.name+(me.handicap!=null?' · Handicap '+me.handicap:''));}
  }
  if(owner||player){
   const sync=document.getElementById('syncText');if(sync&&/^(Player|Organiser) • signed in$/.test(sync.textContent))sync.hidden=true;
   // These are duplicated view selectors, not account-editing or recovery actions.
   const profile=document.getElementById('accountPlayer');if(profile)profile.closest('details').hidden=true;
   const ownerAccount=document.getElementById('accountOwner');if(ownerAccount&&(owner||window.iigCanReturnToOrganiser?.(pin)))ownerAccount.hidden=true;
  }
 }
 let scheduled=false;
 const schedule=()=>{if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;simplify();});};
 new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true});
 window.iigPlayerAccess=Object.freeze({openMembers:()=>{closeGroup();showMemberList();},toggleGroup});
 window.addEventListener('iig-view-authority',schedule);
 document.addEventListener('click',schedule);schedule();
})();
