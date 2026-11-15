/* Verified self-service registration and owner register, bound to the validated release target. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const dashboard = location.pathname.endsWith('/owner-dashboard.html');
  const access=window.IIG_ACCOUNT_ACCESS;
  if(!access){
    if($('registrationAuth'))$('registrationAuth').textContent='Group setup will be available after this release has been validated.';
    return;
  }
  const invitation = new URLSearchParams((location.hash || '').replace(/^#/,''));
  const playerMode = !dashboard && (invitation.has('pin') || invitation.has('invite'));
  const adminMode = !dashboard && !playerMode && invitation.get('admin')==='1';
  const invitePin = invitation.get('pin'), inviteToken = invitation.get('invite');
  const validPlayerPin = /^\d{4}$/.test(invitePin || '');
  const validInvitation = /^\d{4}$/.test(invitePin || '') && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(inviteToken || '');
  const focused=window.IIG_ACCOUNT_BUILD?.release==='focused-v1';
  const retainedGroup=pin=>['1010','1260','8759'].includes(pin);
  let homePin=null,homeOwned=false,ownerPlayerReady=false,playerJoinOptions=null,ownerReturnPin=null,ownerPlayerId=null,ownerPlayerGroupPin=null,viewOwnerCheckedPin=null,viewLookup=0,changingGroup=false;
  const rememberGroup=pin=>{if(!session?.user?.id||!/^\d{4}$/.test(pin||''))return;try{localStorage.setItem('iig-last-group-v1-'+session.user.id,pin);}catch(_){}};
  const rememberedGroup=()=>{try{const pin=localStorage.getItem('iig-last-group-v1-'+session.user.id);return /^\d{4}$/.test(pin||'')?pin:null;}catch(_){return null;}};
  const joinRpc=focused?'iig_join_release_group':'iig_join_owned_group';
  let relinkToken=invitation.get('relink');
  if(focused&&!dashboard&&new URLSearchParams(location.search).get('pin')==='2026')return;
  // Safari can reopen an invitation as fragment-only navigation in an existing
  // tab. Reinitialise its captured route; the verified SDK session is retained.
  let invitationReloading=false;
  if(!dashboard)window.addEventListener('hashchange',()=>{
    const current=new URLSearchParams((location.hash||'').replace(/^#/,''));
    if(invitationReloading||['pin','invite','relink','admin'].every(key=>current.get(key)===invitation.get(key)))return;
    invitationReloading=true;
    location.reload();
  });
  const base=access.url,key=access.key;
  let creating = false, session = null, email = '', busy = false, resendAt = 0, pending = null, offset = 0, expiryTimer = null, sessionEpoch=0;
  let accessReadSession=null;
  let additionalGroup=false, selectedOwnedPin=null, dismissGroupPicker=null;
  const ownedStorageKey=()=>session?.user?.id?'iig-last-owned-group-v1-'+session.user.id:null;
  const rememberedOwnedGroup=()=>{try{return localStorage.getItem(ownedStorageKey());}catch(_){return null;}};
  function rememberOwnedGroup(pin){selectedOwnedPin=pin;try{if(ownedStorageKey())localStorage.setItem(ownedStorageKey(),pin);}catch(_){}}
  if (dashboard) {
    document.querySelector('#loginView .login-card').innerHTML = '<h1>I’m In Golf</h1><h2>Owner Dashboard</h2><p>Sign in to see groups created through the app.</p><div id="registrationAuth"></div>';
  }
  const root = $('registrationAuth');
  if (!root) return;
  root.innerHTML = `
    ${!dashboard && !playerMode && !adminMode ? `<details><summary>${focused?'Already joined a golf group?':'Already joined a test group?'}</summary><form id="regReturnForm"><label for="regReturnPin">Group PIN</label><input id="regReturnPin" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" required><button class="secondary full">Sign in to my player account</button></form></details>` : ''}
    <p id="regProgress" class="muted"></p><p id="regMessage" role="status" aria-live="polite"></p>
    <form id="regEmailForm"><label for="regEmail">Your email address</label><input id="regEmail" type="email" autocomplete="email" maxlength="254" required><button class="primary full">Email me a sign-in code</button><p class="muted">${dashboard ? 'Platform owner access only.' : adminMode ? 'Use the email you used to create your group.' : 'Use the same email each time you return.'}</p></form>
    <details id="regPasswordOption"><summary>Sign in with an existing password</summary><form id="regPasswordForm"><label for="regPasswordEmail">Your email address</label><input id="regPasswordEmail" type="email" autocomplete="username" maxlength="254" required><label for="regPassword">Password</label><input id="regPassword" type="password" autocomplete="current-password" required><button class="primary full">Sign in</button><p class="muted">Sensitive changes still need a fresh email code.</p></form></details>
    <form id="regCodeForm" hidden><label for="regCode">Code from your email</label><p id="regSentTo"></p><input id="regCode" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,10}" minlength="6" maxlength="10" required><button class="primary full" id="regVerify">Verify email</button><button id="regResend" type="button" class="secondary full">Send another code</button><button id="regChangeEmail" type="button" class="ghost full">Use a different email</button></form>
    <section id="regSignedIn" hidden><p id="regAccount" class="muted"></p>
    <form id="regGroupForm" hidden><label for="regName">Your name</label><input id="regName" autocomplete="name" maxlength="80" required><label for="regSetupEmail" id="regSetupEmailLabel">Your email</label><input id="regSetupEmail" type="email" autocomplete="email" maxlength="254"><label for="regGroupName">Group name</label><input id="regGroupName" maxlength="80" required placeholder="e.g. Sunday Golfers"><label for="regSetupHandicap">Your handicap</label><input id="regSetupHandicap" type="text" inputmode="decimal" autocomplete="off" required aria-describedby="regSetupHandicapHelp"><small id="regSetupHandicapHelp">Example: 11.2. We’ll add you to the player list automatically using your name and handicap.</small><button id="regCreate" class="primary full">Create my group</button><p class="muted">I’m In Golf+ is included free for now. Your name and email are shared with I’m In Golf to manage your group.</p></form>
    <section id="regAccessHelp" hidden><p id="regAccessHelpText"></p><p id="regAccessHelpNext" hidden></p><button id="regReconnectOwned" class="primary full" type="button" hidden>Reconnect my existing player</button><button id="regAccessChangeEmail" class="primary full" type="button">Use a different email</button><button id="regOtherPin" class="secondary full" type="button">Enter group PIN</button></section><form id="regJoinForm" hidden><p id="regJoinGroupName" class="ui-invited-group"></p><label for="regPlayerName">Your name</label><input id="regPlayerName" autocomplete="name" maxlength="80" required><label for="regHandicap">Handicap</label><input id="regHandicap" type="text" inputmode="decimal" maxlength="5" pattern="-?[0-9]{1,2}([.][0-9])?" aria-describedby="regHandicapHelp" required><small id="regHandicapHelp">Example: 11.2.</small><p id="regAppJoinHelp" class="muted" hidden></p><p id="regJoinError" role="alert" tabindex="-1"></p><button class="primary full">Join my group</button></form>
    <section id="regCreated" hidden><h2>Your group is ready</h2><p id="regCreatedName"></p><p>Group PIN: <strong id="regPin"></strong></p><button id="regOpenGroup" type="button" class="primary full">Open my group</button><button id="regInvite" type="button" class="secondary full">Invite players</button><button id="regPlayerView" type="button" class="secondary full">Open my player account</button><details class="ui-options" hidden><summary>Competition options</summary><button id="regFirstCompetition" type="button" class="secondary full">Create first competition</button></details><details id="regOwnerPlayerSetup" class="ui-options" hidden><summary>I’m playing too</summary><form id="regOwnerPlayerForm"><label for="regOwnerPlayerName">Your player name</label><input id="regOwnerPlayerName" autocomplete="name" maxlength="80" required><label for="regOwnerHandicap">Your handicap</label><input id="regOwnerHandicap" inputmode="decimal" required><small>Up to two digits and one decimal place, e.g. 11.2.</small><button class="secondary full">Add me as a player</button></form><p id="regOwnerPlayerStatus" role="status"></p></details></section>
    <button id="regReload" type="button" class="secondary full">${dashboard ? 'Open dashboard' : 'Check my group'}</button><details id="regAccountOptions" class="ui-options"><summary>My account</summary><p id="regAccountReference" class="muted"></p><button id="regAccountControls" type="button" class="secondary full">Account settings</button><button id="regSignout" type="button" class="ghost full">Sign out</button></details></section>`;
  window.iigHandicap.bind($('regSetupHandicap'));
  // Additional groups use the same four steps after an explicit organiser choice.
  const onboarding = !dashboard && window.IIGOrganiserOnboarding
    ? window.IIGOrganiserOnboarding.create({root, account:()=>session, request, run:action, openGroup:openOwnedGroup}) : null;
  // The same verified-email API serves both guided creation and returning users.
  if(playerMode)root.classList.add('iig-player-access');
  const guided = !dashboard && !playerMode;
  const progress = text => {
    const registering=creating || (!session && !$('regGroupForm').hidden);
    $('regProgress').textContent = !registering ? text.replace(/^[1-3] of 3 · /,'') : text;
    if(playerMode&&!additionalGroup){
      const title=$('welcomeStartTitle');
      if(title){title.textContent='Join your group';if(title.nextElementSibling)title.nextElementSibling.textContent=session?'Add your name and handicap.':'We’ll email you a sign-in code.';}
      return;
    }
    if(adminMode&&!additionalGroup){const title=$('welcomeStartTitle');if(title){title.textContent='Admin sign in';if(title.nextElementSibling)title.nextElementSibling.textContent='';}return;}
    if(dashboard || !guided)return;
    const title=$('welcomeStartTitle');
    if(!title)return;
    title.textContent=session?'Your group':registering?'Start a golf group':'Welcome back';
    if(title.nextElementSibling)title.nextElementSibling.textContent=session?'Open your group or invite friends.':registering?'Your details, then email verification.':'We’ll email you a sign-in code.';
  };
  if(guided&&!adminMode){
    const form=$('regGroupForm');root.insertBefore(form,$('regEmailForm'));
    form.hidden=false;$('regEmailForm').hidden=true;
    $('regSetupEmail').required=true;$('regCreate').textContent='Email me a sign-in code';
    const returning=document.createElement('button');returning.id='regReturning';returning.type='button';returning.className='ghost full';returning.textContent='Already registered? Sign in';
    form.after(returning);
    returning.onclick=()=>{onboarding?.suspend();creating=false;form.hidden=true;$('regEmailForm').hidden=false;returning.hidden=true;progress('Sign in with your existing email');$('regEmail').focus();};
    progress('1 of 3 · Your group and details');onboarding?.details();
    try{const draft=JSON.parse(sessionStorage.getItem('iig-group-draft')||'null');if(draft){$('regName').value=draft.organiser||'';$('regGroupName').value=draft.name||'';$('regSetupEmail').value=draft.email||'';$('regSetupHandicap').value=draft.handicap??'';}}catch(_){}
  }
  const nativeApp=()=>!!window.IigNativeApp||typeof window.IigPurchase?.postMessage==='function';
  if(validInvitation&&!nativeApp()){$('regAppJoinHelp').hidden=false;$('regAppJoinHelp').textContent='Join securely here first. Then open the iPhone app with group PIN '+invitePin+' and the same verified email.';}
  let keeper=null;
  if(focused){
   try{keeper=window.IIGAccountSession.create({createClient:(...args)=>window.supabase.createClient(...args),access,storage:localStorage,
    onChange(event,next){
     if(event==='SIGNED_OUT'){reset();message('Signed out.');return;}
     if(session && next?.user?.id===session.user.id){session=next;return;}
     if(next?.user?.id){reset();action(async()=>{const restored=await restoreSession();if(restored)await finishSignIn(restored);});}
    }});}
   catch(_){root.textContent='Secure sign-in is unavailable. Reload while connected.';return;}
  }
  if(validInvitation){request('/rest/v1/rpc/get_group_access_status',{p_pin:invitePin},false).then(result=>{const row=Array.isArray(result)?result[0]:result;if(row?.group_pin===invitePin && typeof row.group_name==='string'){const note=document.createElement('p');note.className='ui-invited-group';note.textContent=row.group_name;root.prepend(note);}}).catch(()=>{});}
  window.iigHandicap.bind($('regHandicap'));
  window.iigHandicap.bind($('regOwnerHandicap'));
  // Author styles in the original app must not override hidden form visibility.
  const style = document.createElement('style');
  style.textContent = '#registrationAuth [hidden]{display:none!important}#registrationAuth button:disabled{opacity:.55}#registrationAuth p{overflow-wrap:anywhere}#registrationAuth input{width:100%;box-sizing:border-box;font-size:18px}#registrationAuth label{display:block;font-weight:700;margin-top:14px}#registrationAuth button{min-height:44px}';
  document.head.appendChild(style);
  const message = text => { $('regMessage').textContent = text; };
  const lock = value => {
    busy = value;
    root.querySelectorAll('button,input').forEach(el => { el.disabled = value; });
    $('regResend').disabled = value || Date.now() < resendAt;
  };
  function reset() {
    window.iigOwnerCentre?.closeActions();
    onboarding?.suspend();
    dismissGroupPicker?.(null);additionalGroup=false;selectedOwnedPin=null;
    $('regCancelAdditional')?.remove();
    changingGroup=false;
    accessReadSession=null;
    $('iigPlayerProfileDialog')?.remove();ownerReturnPin=null;ownerPlayerId=null;ownerPlayerGroupPin=null;viewOwnerCheckedPin=null;viewLookup++;
    $('iigAppHandover')?.remove();playerJoinOptions=null;
    sessionEpoch++;clearTimeout(expiryTimer); expiryTimer=null;
    window.iigAccount?.close();
    window.iigSecureOrganiser?.close();
    window.iigSecurePlayer?.close();
    $('regAccessHelp').hidden=true;homePin=null;homeOwned=false;ownerPlayerReady=false;
    $('regJoinForm').hidden = true;
    session = null; pending = null; creating=false;
    $('regSignedIn').hidden = true; $('regGroupForm').hidden = true; $('regCreated').hidden = true;
    $('regEmailForm').hidden = false; $('regCodeForm').hidden = true;
    $('regPasswordOption').hidden=false; $('regPassword').value='';
    if($('regReturning'))$('regReturning').hidden=false;
    progress('Sign in with your existing email'); $('regCode').value = '';
    if (dashboard) { $('loginView').classList.remove('hidden'); $('dashView').classList.add('hidden'); document.querySelector('#dashView .content').textContent = ''; }
  }
  // A delayed Auth restore must not hold navigation and forms indefinitely.
  async function restoreSession() {
    let timer;
    try { const restored=await Promise.race([keeper.restore(), new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(new Error('Your saved sign-in could not be checked. Please try again.')),15000);
    })]);
      if(busy)accessReadSession=restored;
      return restored;
    }
    finally { clearTimeout(timer); }
  }
  async function request(path, body, auth = false) {
    if(auth && keeper){
     // Reuse the identity just verified for this one access-opening action.
     // Mutations and later actions still perform their own verified restore.
     const accessRead=['/rest/v1/rpc/iig_read_entry_group','/rest/v1/rpc/iig_read_owned_entry_group','/rest/v1/rpc/iig_list_owned_groups','/rest/v1/rpc/get_group_access_status','/rest/v1/rpc/iig_get_player_join_options'].includes(path);
     const checked=busy&&accessRead&&accessReadSession&&session&&accessReadSession.user.id===session.user.id&&accessReadSession.access_token===session.access_token&&Date.now()<accessReadSession.expires_at*1000;
     const restored=checked?accessReadSession:await restoreSession();
     if(!restored || !session || restored.user.id!==session.user.id){reset();throw Error('Account changed. Sign in again.');}
     if(session.access_token!==restored.access_token)session={access_token:restored.access_token,user:restored.user,expires_at:restored.expires_at};
    }
    if (auth && (!session || Date.now() >= session.expires_at * 1000)) {
      reset(); throw new Error('Please sign in again to continue.');
    }
    const requestEpoch=sessionEpoch;
    const controller = new AbortController(), timeout = setTimeout(() => {controller.abort();}, 20000);
    try {
      const headers = { apikey: key, 'Content-Type': 'application/json' };
      if (auth) headers.Authorization = 'Bearer ' + session.access_token;
      const response = await fetch(base + path, { method: path.startsWith('/auth/v1/user') ? 'PUT' : 'POST', headers, body: JSON.stringify(body), cache: 'no-store', signal: controller.signal });
      const data = response.status === 204 ? {} : await response.json();
      if (!response.ok) {
        if (response.status === 401 && auth) reset();
        if (data.code === 'PGRST202') throw new Error('The test database update is needed before this step can run.');
        let detail=data.msg || data.message || 'Unable to connect. Please try again.';
        if(detail==='DUPLICATE_PLAYER_NAME')detail='That name is already on the player list. Use a distinct name, or sign in with your existing player’s email.';
        if(detail==='Verified organiser sign-in required')detail='Sign in with a verified email to continue.';
        if(path==='/auth/v1/verify' && response.status!==429)detail='That code is incorrect or has expired. Enter the latest code, or request another.';
        if(path==='/auth/v1/token?grant_type=password' && response.status!==429)detail='Password sign-in failed. Check your details, or use an email code.';
        if(response.status===429)detail='Too many attempts. Please wait before requesting another code.';
        const error = new Error(detail); error.code=data.code;
        throw error;
      }
      if (auth && (sessionEpoch !== requestEpoch || !session || Date.now() >= session.expires_at*1000)) {
        reset(); throw new Error('Your session expired. Sign in again to continue.');
      }
      return data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error(auth ? 'Connection timed out. Use Check my group before trying to create it again.' : 'Connection timed out. Check your connection and try again.');
      if(error instanceof TypeError)throw new Error('Unable to connect. Your details are kept on this page. Check your connection and try again.');
      throw error;
    } finally { clearTimeout(timeout); }
  }
  async function action(fn) {
    if (busy) return;
    accessReadSession=null;
    lock(true); message('Please wait…');
    try { await fn(); } catch (error) { const text=error.message || 'Please try again.';if(!$('regJoinForm').hidden){$('regJoinError').textContent=text;message('');$('regJoinError').focus();$('regJoinError').scrollIntoView?.({block:'nearest'});}else message(text); }
    finally { accessReadSession=null;lock(false); if($('regMessage').textContent==='Please wait…')message(''); }
  }
  function showGroup(group) {
    const firstDisplay=$('regCreated').hidden;
    if (!group || !/^\d{4}$/.test(group.group_pin)) throw new Error('Could not confirm your group. Tap Check my group.');
    $('regGroupForm').hidden = true; $('regCreated').hidden = false;
    $('regCreatedName').textContent = group.state?.groupName || '';
    $('regAccessHelp').hidden=true;homePin=group.group_pin;homeOwned=true;rememberGroup(homePin);
    $('regInvite').textContent=group.group_pin==='1010'?'Reconnect existing players':'Invite players';
    ownerPlayerReady=false;ownerPlayerId=null;ownerPlayerGroupPin=group.group_pin;$('regPlayerView').hidden=true;$('regOwnerPlayerSetup').hidden=true;
    $('regOwnerPlayerForm').hidden=retainedGroup(group.group_pin);
    $('regPlayerView').textContent=retainedGroup(group.group_pin)?'Open or reconnect my player account':'Open my player account';
    $('regPin').textContent = group.group_pin;
    progress('');
    $('regOwnerPlayerName').value=$('regName').value;
    $('regSetupEmail').required=false;
    if($('regReturning'))$('regReturning').hidden=true;
    message('');
    if(firstDisplay)$('regCreated').scrollIntoView?.({block:'start'});
    if(onboarding && !onboarding.resume(group))onboarding.suspend();
  }
  async function listOwnedGroups(){
    const groups=await request('/rest/v1/rpc/iig_list_owned_groups',{},true);
    if(!Array.isArray(groups)||groups.some(g=>!/^\d{4}$/.test(g.group_pin||'')||typeof g.group_name!=='string'))throw Error('Your groups could not be loaded. Please try again.');
    return groups;
  }
  function chooseOwnedGroup(groups,options=false){
    dismissGroupPicker?.(null);
    const epoch=sessionEpoch;
    return new Promise(resolve=>{
      const dialog=document.createElement('dialog');dialog.id='iigGroupPicker';dialog.className='iig-player-profile';
      dialog.setAttribute('aria-labelledby','iigGroupPickerTitle');
      dialog.innerHTML='<div class="card"><h2 id="iigGroupPickerTitle">Change group</h2><p>Choose a group you organise.</p><div id="iigOwnedGroups"></div><p id="iigGroupPickerMessage" role="status"></p></div>';
      const card=dialog.firstElementChild;
      const finish=value=>{if(dismissGroupPicker===finish)dismissGroupPicker=null;dialog.close();dialog.remove();resolve(epoch===sessionEpoch?value:null);};
      dismissGroupPicker=finish;
      const button=(text,value,parent=card)=>{const node=document.createElement('button');node.type='button';node.className='secondary full';node.textContent=text;node.onclick=()=>finish(value);parent.append(node);return node;};
      for(const group of groups){
        const unavailable=group.retired||group.status!=='active';
        const node=button(group.group_name+' · PIN '+group.group_pin+(unavailable?' · Unavailable':''),group.group_pin,card.querySelector('#iigOwnedGroups'));
        node.dataset.groupPin=group.group_pin;node.disabled=unavailable;
      }
      if(options){button('Create another group','create').id='iigCreateAnotherGroup';button('Join another group','join').id='iigJoinAnotherGroup';}
      button('Cancel',null).id='iigGroupPickerCancel';
      dialog.addEventListener('cancel',event=>{event.preventDefault();finish(null);});
      document.body.append(dialog);dialog.showModal();
    });
  }
  async function readOwnedGroup(expectedPin=null){
    let target=expectedPin;
    if(!target){
      const groups=await listOwnedGroups();if(!groups.length)return null;
      const preferred=onboarding?.pendingPin||selectedOwnedPin||rememberedOwnedGroup();
      target=groups.some(g=>g.group_pin===preferred)?preferred:groups.length===1?groups[0].group_pin:await chooseOwnedGroup(groups);
      if(!target)throw Error('Choose a group when you’re ready.');
    }
    if(!/^\d{4}$/.test(target))throw Error('Choose a valid group.');
    const group=await request('/rest/v1/rpc/iig_read_owned_entry_group',{p_pin:target},true);
    if(!group||group.group_pin!==target)throw Error('Could not confirm organiser access to this group.');
    return group;
  }
  async function ownsGroup(pin){
    try{return await readOwnedGroup(pin);}catch(error){if(error.code==='42501')return null;throw error;}
  }
  async function loadGroup(expectedPin=null) {
    const group = await readOwnedGroup(expectedPin);
    if (group) {
      let linkedPlayer=null;
      if(focused&&!dashboard){
        try{const player=await request('/rest/v1/rpc/iig_read_entry_group',{p_pin:group.group_pin},true);if(player&&(player.group_pin===undefined||player.group_pin===group.group_pin)&&typeof player.player_id==='string'&&!!player.player_id&&player.state?.players?.filter(p=>p.id===player.player_id).length===1)linkedPlayer=player.player_id;}
        catch(error){if(error.code!=='42501'||error.message!=='Group membership required')throw error;}
      }
      showGroup(group);rememberOwnedGroup(group.group_pin);
      ownerReturnPin=group.group_pin;viewOwnerCheckedPin=group.group_pin;
      ownerPlayerReady=!!linkedPlayer;ownerPlayerId=linkedPlayer;
      $('regOwnerPlayerSetup').hidden=ownerPlayerReady||retainedGroup(group.group_pin);
    }
    else if(adminMode){$('regCreated').hidden=true;$('regGroupForm').hidden=true;$('regReload').hidden=true;message('No group is owned by this account. Sign in with your organiser email, or use Start a golf group to create a new group.');}
    else { $('regCreated').hidden = true; $('regGroupForm').hidden = false; $('regSetupEmail').hidden=true;$('regSetupEmailLabel').hidden=true;$('regSetupEmail').required=false;$('regCreate').textContent='Create my group'; message('Email verified. Check your name, group name and handicap, then create your group.'); }
    return group;
  }
  async function sendCode() {
    if (Date.now() < resendAt) throw new Error('Please wait a minute before requesting another code.');
    await request('/auth/v1/otp', { email, create_user: !dashboard });
    resendAt = Date.now() + 60000;
    setTimeout(() => { if (!busy) $('regResend').disabled = false; }, 60000);
    $('regEmailForm').hidden = true; $('regGroupForm').hidden=true; $('regCodeForm').hidden = false; $('regCode').value = '';
    $('regPasswordOption').hidden=true; $('regPassword').value='';
    progress(guided?'2 of 3 · Verify your email':'Verify your email');
    if($('regReturning'))$('regReturning').hidden=true;
    $('regVerify').textContent=creating?'Verify email & create my group':'Verify email';
    $('regSentTo').textContent = 'Email address: ' + email + '.';
    const heading=$('welcomeStartTitle');if(heading){heading.textContent='Check your email';if(heading.nextElementSibling)heading.nextElementSibling.textContent='Enter your latest sign-in code.';}if(creating)onboarding?.details(true);message('Check Inbox or Junk. You can resend after one minute.'); $('regCodeForm').scrollIntoView?.({block:'start'}); $('regCode').focus();
  }
  if ($('regReturnForm')) $('regReturnForm').onsubmit = event => {
    event.preventDefault();
    const value=$('regReturnPin').value.trim();
    if (!/^\d{4}$/.test(value)) { message('Enter your four-digit group PIN.'); return; }
    location.assign(location.pathname + '#pin=' + encodeURIComponent(value));
    location.reload();
  };
  $('regEmailForm').onsubmit = event => { event.preventDefault(); action(async () => { email = $('regEmail').value.trim(); await sendCode(); }); };
  $('regPasswordForm').onsubmit = event => {
    event.preventDefault(); action(async () => {
      try {
        if(!keeper)throw Error('Secure sign-in is unavailable. Reload while connected.');
        if(session || creating)throw Error('Use your current sign-in or finish email verification first.');
        const passwordEmail=$('regPasswordEmail').value.trim();
        if(!/^[^\s@]+@[^\s@]+[.][^\s@]+$/.test(passwordEmail)||!$('regPassword').value)throw Error('Enter your email address and password.');
        const data=await request('/auth/v1/token?grant_type=password',{email:passwordEmail,password:$('regPassword').value});
        await finishSignIn(await keeper.accept(data));
      } finally { $('regPassword').value=''; }
    });
  };
  $('regResend').onclick = () => action(sendCode);
  $('regChangeEmail').onclick = () => { $('regCodeForm').hidden = true; $('regEmailForm').hidden = creating; $('regPasswordOption').hidden=creating; $('regGroupForm').hidden=!creating; $('regCode').value = '';progress(creating?'1 of 3 · Your group and details':'Sign in'); if(creating)onboarding?.details(); message('Check your email address. You can request another code after the one-minute wait.'); };
  $('regCodeForm').onsubmit = event => {
    event.preventDefault(); action(async () => {
      const token = $('regCode').value.trim();
      if (!/^[0-9]{6,10}$/.test(token)) throw new Error('Enter the numeric code from your email.');
      const data = await request('/auth/v1/verify', { email, token, type: 'email' });
      const expires = Number(data.expires_at || Math.floor(Date.now()/1000) + Number(data.expires_in));
      if (!data.access_token || !data.user?.id || !Number.isFinite(expires)) throw new Error('Please request a new sign-in code.');
      if(expires*1000<=Date.now())throw new Error('Please request a new sign-in code.');
      await finishSignIn(keeper?await keeper.accept(data):data);
    });
  };
  async function finishSignIn(data){
      if(keeper&&busy)accessReadSession=data;
      sessionEpoch++;
      const expires=Number(data.expires_at||Math.floor(Date.now()/1000)+Number(data.expires_in));
      session = { access_token: data.access_token, user: data.user, expires_at: expires };
      clearTimeout(expiryTimer);
      if(!keeper)expiryTimer=setTimeout(()=>{reset();message('Your session expired. Sign in again to continue.');},Math.min(expires*1000-Date.now(),2147483647));
      $('regCode').value = ''; $('regCodeForm').hidden = true; $('regSignedIn').hidden = false;
      $('regEmailForm').hidden=true; $('regPasswordOption').hidden=true; $('regPassword').value='';
      $('regAccount').textContent = 'Signed in as ' + data.user.email;
      $('regAccountReference').textContent = '';
      message(playerMode?'Opening your player account…':'Opening your group…');
      if(playerMode)progress('Your player account');
      if (dashboard) { offset = 0; await loadDashboard(); }
      else if(onboarding?.pendingPin){showWelcomePanel('start',false);await loadGroup(onboarding.pendingPin);}
      else if(adminMode){showWelcomePanel('start',false);await openOwnedGroup();}
      else if(playerMode) await loadPlayer();
      else { if(await restorePlayerHome(true))return;const group=await loadGroup();if(group){showWelcomePanel('start',false);}else if(creating)await createGroup();else await restorePlayerHome(); }
  }
  function groupDetails(){
    const name=$('regGroupName').value.trim(),organiser=$('regName').value.trim();
    if(!name||!organiser||name.length>80||organiser.length>80)throw new Error('Enter your name and a group name (up to 80 characters each).');
    const raw=$('regSetupHandicap').value.trim();
    if(!window.iigHandicap.valid(raw))throw new Error('Enter your handicap from -10 to 60, with up to one decimal place.');
    return {name,organiser,handicap:Number(raw)};
  }
  async function createGroup(){
    const {name,organiser,handicap}=groupDetails();
    if(!additionalGroup&&await loadGroup())return;
    const storageKey='iig-registration:'+session.user.id+(additionalGroup?':additional':'');
    if(!pending){try{pending=JSON.parse(sessionStorage.getItem(storageKey)||'null');}catch(_){}}
    if(!pending||pending.name!==name||!/^[0-9a-f-]{36}$/i.test(pending.id||''))pending={name,id:crypto.randomUUID()};
    try{sessionStorage.setItem(storageKey,JSON.stringify(pending));}catch(_){}
    const rpc=additionalGroup?'iig_create_additional_playing_group':'iig_create_owned_playing_group';
    const result=await request('/rest/v1/rpc/'+rpc,{p_name:name,p_organiser_name:organiser,p_handicap:handicap,p_request_id:pending.id},true);
    onboarding?.begin(result);
    additionalGroup=false;pending=null;$('regCancelAdditional')?.remove();$('regReload').hidden=false;
    try{sessionStorage.removeItem(storageKey);}catch(_){}
    // The RPC acknowledges creation; only readback supplies the name and full saved group.
    showGroup({...result,state:{groupName:name}});
    try{await loadGroup(result.group_pin);try{sessionStorage.removeItem('iig-group-draft');}catch(_){}}
    catch(_){message('Your group was created. Tap Check my group to reload its details.');}
  }
  $('regGroupForm').onsubmit=event=>{event.preventDefault();action(async()=>{
    const details=groupDetails();
    if(session){await createGroup();return;}
    email=$('regSetupEmail').value.trim();
    if(!/^[^\s@]+@[^\s@]+[.][^\s@]+$/.test(email))throw Error('Enter an email address you can access.');
    creating=true;$('regEmail').value=email;
    try{sessionStorage.setItem('iig-group-draft',JSON.stringify({...details,email}));}catch(_){}
    await sendCode();
  });};
  async function openOwnedGroup(expectedPin=null){
    if (!window.iigSecureOrganiser) throw new Error('Reload the app to open your group.');
    let group = await readOwnedGroup(expectedPin);
    if (!group) return;
    if(expectedPin&&group.group_pin!==expectedPin)throw Error('Your organiser group changed. Reopen your group before switching views.');
    const accessRows = await request('/rest/v1/rpc/get_group_access_status', {p_pin:group.group_pin}, true);
    const access = Array.isArray(accessRows) ? accessRows[0] : accessRows;
    if (!access || access.access_allowed !== true) throw new Error('Your group is not currently available.');
    const adapter=window.iigSecureOrganiser?.active?window.iigSecureOrganiser:window.iigSecurePlayer;
    if(adapter?.active&&!adapter.canSwitchView)throw Error('Finish saving or cancel your current entry before changing group.');
    group=await loadGroup(group.group_pin);
    if(adapter?.active&&!adapter.canSwitchView)throw Error('Finish saving or cancel your current entry before changing group.');
    changingGroup=false;
    window.iigSecurePlayer?.close();
    window.iigSecureOrganiser.open(group, request, () => action(signout), access.plan_type);
    return group;
  }
  $('regOpenGroup').onclick=()=>action(openOwnedGroup);
  $('regInvite').onclick=()=>action(async()=>{if(await openOwnedGroup())await window.iigSecureOrganiser.invite();});
  $('regFirstCompetition').onclick=()=>action(async()=>{if(await openOwnedGroup())window.iigSecureOrganiser.firstCompetition();});
  $('regOwnerPlayerForm').onsubmit=event=>{event.preventDefault();action(async()=>{
    const name=$('regOwnerPlayerName').value.trim(),raw=$('regOwnerHandicap').value.trim();
    if(!name||name.length>80||!window.iigHandicap.valid(raw))throw Error('Enter your name and a handicap from -10 to 60, with up to one decimal place.');
    const group=await loadGroup();if(!group)throw Error('Create your group first.');
    await request('/rest/v1/rpc/'+joinRpc,{p_pin:group.group_pin,p_invite:group.invite_token,p_name:name,p_handicap:Number(raw)},true);
    $('regOwnerPlayerStatus').textContent='You’re on the player list. You still have organiser access.';
    ownerPlayerReady=true;$('regOwnerPlayerSetup').hidden=true;message('You have been added as a player. Use Open my group, then Group options → Switch to player view.');
  });};
  function showAppHandover(pin){
    $('iigAppHandover')?.remove();
    if(nativeApp()||!validInvitation||pin!==invitePin)return;
    const panel=document.createElement('section');panel.id='iigAppHandover';panel.className='card ui-app-handover';panel.setAttribute('aria-label','Use the iPhone app');
    panel.innerHTML='<h2>You’ve joined your group</h2><p>Your player account is ready. Download I’m In Golf, then open it from its icon.</p><a class="secondary" href="https://apps.apple.com/gb/app/im-in-golf/id6808349916" target="_blank" rel="noopener noreferrer">Download the iPhone app</a><p>In the app, tap <strong>Join my golf group</strong>. Use group PIN <strong id="iigAppHandoverPin"></strong> if asked and sign in with the <strong>same verified email</strong> to open your existing player account.</p><p class="muted">Already installed? Open the app from its icon. Your browser sign-in and invitation do not automatically transfer into it.</p><button class="ghost" type="button">Continue on the website</button>';
    panel.querySelector('#iigAppHandoverPin').textContent=pin;panel.querySelector('button').onclick=()=>panel.remove();$('screen').before(panel);
  }
  function openPlayerData(data,pin){
    if(!window.iigSecurePlayer)throw new Error('Reload the app to open your player account.');
    window.iigSecurePlayer.open(data,pin,request,()=>action(signout));
    homePin=pin;homeOwned=false;rememberGroup(pin);
    $('regJoinForm').hidden=true;$('regAccessHelp').hidden=true;showAppHandover(pin);
    if(ownerReturnPin!==pin&&viewOwnerCheckedPin!==pin){ownerReturnPin=null;confirmPlayerOwnership(pin);}
    else window.dispatchEvent?.(new Event('iig-view-authority'));
  }
  async function confirmPlayerOwnership(pin){
    const lookup=++viewLookup,epoch=sessionEpoch;
    try{
      const owned=await ownsGroup(pin);
      if(lookup!==viewLookup||epoch!==sessionEpoch||!session||homePin!==pin||window.iigSecurePlayer?.identity?.groupPin!==pin)return;
      viewOwnerCheckedPin=pin;ownerReturnPin=owned?.group_pin===pin?pin:null;
      window.dispatchEvent?.(new Event('iig-view-authority'));
    }catch(_){
      if(lookup===viewLookup&&epoch===sessionEpoch&&homePin===pin&&window.iigSecurePlayer?.identity?.groupPin===pin){ownerReturnPin=null;window.dispatchEvent?.(new Event('iig-view-authority'));}
    }
  }
  async function restorePlayerHome(rememberedOnly=false){
    const last=rememberedGroup();
    if(last){try{const data=await request('/rest/v1/rpc/iig_read_entry_group',{p_pin:last},true);openPlayerData(data,last);return true;}
      catch(error){if(error.code!=='42501'||error.message!=='Group membership required')throw error;}}
    if(rememberedOnly)return false;
    $('regGroupForm').hidden=true;showWelcomePanel('join',false);if($('connectMsg'))$('connectMsg').textContent='You’re signed in. Enter your group PIN or open your invitation.';message('');
  }
  async function existingPlayerHelp(){
    $('regJoinForm').hidden=true;$('regAccessHelp').hidden=false;$('regReload').hidden=true;
    const owned=await ownsGroup(invitePin);
    const isOwnGroup=owned?.group_pin===invitePin;
    if(isOwnGroup&&!retainedGroup(invitePin)){showGroup(owned);rememberOwnedGroup(invitePin);ownerReturnPin=invitePin;message('You have organiser access. Open your group or your player account.');return;}
    $('regReconnectOwned').hidden=!isOwnGroup;
    $('regAccessHelpText').textContent=isOwnGroup
      ? 'You have organiser access. Reconnect your existing player record to keep your scores and history.'
      : 'This email isn’t linked to this group. If you used another email before, sign in with that email.';
    $('regAccessHelpNext').hidden=isOwnGroup;
    $('regAccessHelpNext').textContent=retainedGroup(invitePin)
      ? 'To reconnect an existing player in this older group, ask your organiser for a private reconnection link.'
      : 'Joining for the first time? Open the private invitation from your organiser.';
    $('regAccessChangeEmail').className=isOwnGroup?'secondary full':'primary full';
    $('regOtherPin').className='secondary full';
    $('regReconnectOwned').onclick=()=>action(async()=>{const group=await openOwnedGroup(invitePin);if(group)window.iigSecureOrganiser.reconnect();});
    progress('');
    if($('welcomeStartTitle')){
      $('welcomeStartTitle').textContent=isOwnGroup?'Reconnect your player account':'Check your sign-in email';
      $('welcomeStartTitle').nextElementSibling.textContent=isOwnGroup?'Keep your scores and golf history.':'Use the email linked to group '+invitePin+'.';
    }
    message('');
  }
  $('regAccessChangeEmail').onclick=async()=>{
    await action(()=>signout(true));
    if(!session&&!$('regEmailForm').hidden)$('regEmail').focus();
  };
  $('regOtherPin').onclick=()=>showWelcomePanel('join');
  function showGroupPin(){
    changingGroup=true;$('pinInput').value='';$('connectMsg').textContent='Enter the group PIN. Your sign-in stays the same.';
    showWelcomePanel('join',false);$('setupOverlay').classList.remove('hidden');$('pinInput').focus();
  }
  function cancelAdditional(){
    additionalGroup=false;pending=null;onboarding?.suspend();$('regGroupForm').hidden=true;$('regReload').hidden=false;$('regCancelAdditional')?.remove();
    window.iigCancelGroupChange();
  }
  function beginAdditionalGroup(){
    additionalGroup=true;pending=null;changingGroup=true;onboarding?.suspend();$('regReload').hidden=true;
    root.classList.remove('iig-player-access');
    $('regSignedIn').hidden=false;$('regGroupForm').hidden=false;$('regCreated').hidden=true;$('regJoinForm').hidden=true;$('regAccessHelp').hidden=true;
    $('regEmailForm').hidden=true;$('regCodeForm').hidden=true;$('regPasswordOption').hidden=true;
    $('regSetupEmail').hidden=true;$('regSetupEmailLabel').hidden=true;$('regSetupEmail').required=false;
    $('regGroupName').value='';$('regCreate').textContent='Create my group';
    if($('regReturning'))$('regReturning').hidden=true;
    const me=typeof state==='object'?state.players?.find(p=>p.id===window.iigOwnPlayerId?.(homePin)):null;
    if(me){$('regName').value=me.name||'';$('regSetupHandicap').value=me.handicap??'';}
    const cancel=document.createElement('button');cancel.id='regCancelAdditional';cancel.type='button';cancel.className='ghost full';cancel.textContent='Cancel';cancel.onclick=cancelAdditional;$('regGroupForm').append(cancel);
    showWelcomePanel('start',false);$('setupOverlay').classList.remove('hidden');onboarding?.details();
    $('welcomeStartTitle').textContent='Start another golf group';$('welcomeStartTitle').nextElementSibling.textContent='Use your signed-in account. Each group has its own players, payments and results.';
    message('');$('regGroupName').focus();
  }
  if(!dashboard)document.querySelector('#welcomeStart>.welcome-back').onclick=()=>{
    if(busy)return;if(additionalGroup)cancelAdditional();else showWelcomePanel('home');
  };
  window.iigChangeGroup=()=>{
    const adapter=window.iigSecureOrganiser?.active?window.iigSecureOrganiser:window.iigSecurePlayer;
    if(busy||!adapter?.canSwitchView){showAppToast('Finish your current action','Finish saving or cancel your current entry before changing group.');return false;}
    action(async()=>{
      try{
        const groups=await listOwnedGroups();
        if(!groups.length){showGroupPin();return;}
        const choice=await chooseOwnedGroup(groups,true);if(!choice)return;
        if(!adapter.canSwitchView)throw Error('Finish saving or cancel your current entry before changing group.');
        if(choice==='create')beginAdditionalGroup();else if(choice==='join')showGroupPin();else await openOwnedGroup(choice);
      }catch(error){showAppToast('Could not change group',error.message||'Please try again.');}
    });return true;
  };
  window.iigCancelGroupChange=()=>{
    if(changingGroup){changingGroup=false;if(window.iigSecurePlayer?.active||window.iigSecureOrganiser?.active){$('setupOverlay').classList.add('hidden');return;}}
    showWelcomePanel('home');
  };
  window.iigAdminSignIn=()=>{if(!adminMode){location.assign(location.pathname+location.search+'#admin=1');return;}showWelcomePanel('start',false);if(session)action(openOwnedGroup);else{$('regGroupForm').hidden=true;$('regEmailForm').hidden=false;progress('Sign in');$('regEmail').focus();}};
  window.iigStartGroup=()=>{if(playerMode||adminMode){showWelcomePanel('start');return;}showWelcomePanel('start');if(!session && $('regCodeForm').hidden){$('regGroupForm').hidden=false;$('regEmailForm').hidden=true;$('regSetupEmail').hidden=false;$('regSetupEmailLabel').hidden=false;$('regSetupEmail').required=true;$('regCreate').textContent='Email me a sign-in code';$('regReturning').hidden=false;onboarding?.details();}if(session&&!homeOwned){$('regGroupForm').hidden=false;$('regSetupEmail').hidden=true;$('regSetupEmailLabel').hidden=true;$('regSetupEmail').required=false;$('regCreate').textContent='Create my group';onboarding?.details();}};
  window.iigJoinGroup=()=>{
    if(changingGroup){showWelcomePanel('join',false);$('setupOverlay').classList.remove('hidden');return;}
    // Opening the PIN/sign-in screen is navigation, not a concurrent account action.
    if(busy || !session){showWelcomePanel(playerMode&&validPlayerPin?'start':'join',false);return;}
    return action(async()=>{
    try{
      if(!session){showWelcomePanel(playerMode&&validPlayerPin?'start':'join',false);return;}
      if(playerMode&&validPlayerPin&&(validInvitation||relinkToken)){await loadPlayer();return;}
      if(homeOwned){await openOwnedGroup();return;}
      const last=homePin||rememberedGroup();
      if(last){try{const data=await request('/rest/v1/rpc/iig_read_entry_group',{p_pin:last},true);openPlayerData(data,last);return;}
        catch(error){if(error.code!=='42501'||error.message!=='Group membership required')throw error;}}
      const owned=await readOwnedGroup();
      if(owned){await openOwnedGroup(owned.group_pin);return;}
      showWelcomePanel('join',false);if($('connectMsg'))$('connectMsg').textContent='Enter your group PIN to open your existing player account.';
    }catch(error){showWelcomePanel('join',false);if($('connectMsg'))$('connectMsg').textContent=error.message||'Sign in again to continue.';}
    });
  };
  window.iigOwnerPlayerReady=()=>ownerPlayerReady;
  window.iigOwnPlayerId=groupPin=>{
    if(!session)return null;
    const identity=window.iigSecurePlayer?.identity;
    if(identity?.groupPin===groupPin)return identity.playerId;
    return homeOwned&&ownerPlayerGroupPin===groupPin?ownerPlayerId:null;
  };
  window.iigCanReturnToOrganiser=groupPin=>!!session&&ownerReturnPin===groupPin;
  window.iigReturnToOrganiser=async()=>{
    const note=$('securePlayerOrganiserStatus');
    try{
      if(!ownerReturnPin||!window.iigSecurePlayer?.canSwitchView)throw Error('Finish or cancel your current action before returning to organiser view.');
      await openOwnedGroup(ownerReturnPin);
    }catch(error){if(note)note.textContent=error.message||'Could not open organiser view. Please try again.';}
  };
  window.iigOpenOwnPlayer=async(expectedPin=null)=>{
    if($('iigPlayerProfileDialog'))return;
    const dialog=document.createElement('dialog');dialog.id='iigPlayerProfileDialog';dialog.className='iig-player-profile';
    dialog.setAttribute('aria-labelledby','iigPlayerProfileTitle');
    dialog.innerHTML='<div class="card"><h2 id="iigPlayerProfileTitle">Opening your player view</h2><p id="iigPlayerProfileGroup"></p><p id="iigPlayerProfileMessage" role="status" aria-live="polite" tabindex="-1">Checking your player membership…</p><form id="iigPlayerProfileForm" hidden><label for="iigPlayerProfileName">Your name</label><input id="iigPlayerProfileName" autocomplete="name" maxlength="80" required><label for="iigPlayerProfileHandicap">Handicap</label><input id="iigPlayerProfileHandicap" inputmode="decimal" required aria-describedby="iigPlayerProfileHelp"><small id="iigPlayerProfileHelp">Example: 11.2. Joining the group does not enter you in a closed competition.</small><button class="primary full" type="submit">Confirm my player profile</button></form><button id="iigPlayerProfileBack" class="secondary full" type="button">Back to organiser view</button></div>';
    document.body.appendChild(dialog);dialog.showModal();
    const get=id=>dialog.querySelector('#'+id),currentEpoch=sessionEpoch;
    let writing=false,targetPin=expectedPin;
    const current=()=>dialog.isConnected&&currentEpoch===sessionEpoch;
    const note=text=>{if(current()){get('iigPlayerProfileMessage').textContent=text;get('iigPlayerProfileMessage').focus();}};
    const checkView=()=>{if(window.iigSecureOrganiser?.active&&!window.iigSecureOrganiser.canSwitchView)throw Error('Finish saving, or reload your saved group before switching views.');};
    const owned=async()=>{
      checkView();const group=await readOwnedGroup(targetPin||window.iigSecureOrganiser?.groupPin||selectedOwnedPin);
      if(!group||!/^\d{4}$/.test(group.group_pin)||targetPin&&group.group_pin!==targetPin)throw Error('Could not confirm organiser access to this group. Reopen your group before switching views.');
      if(!current())return null;checkView();targetPin=group.group_pin;return group;
    };
    const member=async()=>{
      try{
        const data=await request('/rest/v1/rpc/iig_read_entry_group',{p_pin:targetPin},true);
        if(!data||(data.group_pin!==undefined&&data.group_pin!==targetPin)||typeof data.player_id!=='string'||!data.player_id||data.state?.players?.filter(p=>p.id===data.player_id).length!==1)throw Error('Your player membership could not be confirmed. Reload your group.');
        return data;
      }catch(error){if(error.code==='42501'&&error.message==='Group membership required')return null;throw error;}
    };
    const enter=data=>{
      if(!current())return;checkView();ownerReturnPin=targetPin;ownerPlayerReady=true;ownerPlayerId=data.player_id;ownerPlayerGroupPin=targetPin;
      window.iigAccount?.close();window.iigSecureOrganiser?.close();openPlayerData(data,targetPin);dialog.remove();
    };
    const back=async()=>{
      if(writing)return;
      if(window.iigSecureOrganiser?.active){dialog.remove();$('secureOrganiserPlayerView')?.focus();return;}
      try{await openOwnedGroup(targetPin);dialog.remove();}catch(error){note(error.message);}
    };
    get('iigPlayerProfileBack').onclick=back;
    dialog.addEventListener('cancel',event=>{event.preventDefault();back();});
    window.iigHandicap.bind(get('iigPlayerProfileHandicap'));
    get('iigPlayerProfileForm').onsubmit=async event=>{
      event.preventDefault();if(writing||!current())return;
      const name=get('iigPlayerProfileName').value.trim(),raw=get('iigPlayerProfileHandicap').value.trim();
      if(!name||name.length>80||!window.iigHandicap.valid(raw)){note('Enter your name and a handicap from -10 to 60, with up to one decimal place.');return;}
      writing=true;dialog.querySelectorAll('button,input').forEach(el=>el.disabled=true);note('Checking and saving your player profile…');
      try{
        const group=await owned();if(!group)return;
        let data=await member();if(!current())return;
        if(!data){
          if(!/^[0-9a-f-]{36}$/i.test(group.invite_token||''))throw Error('Your group’s joining permission could not be confirmed. No player profile was created.');
          await request('/rest/v1/rpc/'+joinRpc,{p_pin:targetPin,p_invite:group.invite_token,p_name:name,p_handicap:Number(raw)},true);
          if(!current())return;data=await member();if(!data)throw Error('Your player profile was not confirmed. Reopen player view to check before trying again.');
        }
        enter(data);
      }catch(error){note(error.message||'Your player profile could not be confirmed. Reopen player view to check before trying again.');}
      finally{writing=false;if(current())dialog.querySelectorAll('button,input').forEach(el=>el.disabled=false);}
    };
    try{
      const group=await owned();if(!group)return;
      const data=await member();if(!current())return;
      if(data){enter(data);return;}
      get('iigPlayerProfileTitle').textContent='Set up your player profile';get('iigPlayerProfileGroup').textContent=group.state?.groupName||'Your golf group';
      get('iigPlayerProfileForm').hidden=false;get('iigPlayerProfileMessage').textContent='Confirm your own details to join as a player. You’ll keep organiser access.';get('iigPlayerProfileName').focus();
    }catch(error){note(error.message||'Could not open player view.');}
  };
  $('regPlayerView').onclick=()=>window.iigOpenOwnPlayer();
  async function loadPlayer(){
    if(!validPlayerPin)throw new Error('Enter a valid group PIN.');
    if(focused&&relinkToken){
     if(!/^[a-f0-9]{64}$/.test(relinkToken))throw Error('Open the complete private reconnection link.');
     await request('/rest/v1/rpc/iig_claim_player_relink',{p_pin:invitePin,p_token:relinkToken},true);
     relinkToken=null;
     history.replaceState(null,'',location.pathname+'#pin='+encodeURIComponent(invitePin));
    }
    let data;
    try{data=await request('/rest/v1/rpc/iig_read_entry_group',{p_pin:invitePin},true);}
    catch(error){
      if(error.code!=='42501'||error.message!=='Group membership required')throw error;
      playerJoinOptions=null;
      if(focused){
        const options=await request('/rest/v1/rpc/iig_get_player_join_options',{p_pin:invitePin},true);
        if(options?.group_pin!==invitePin||typeof options.group_name!=='string'||!options.group_name.trim()||typeof options.pin_join_enabled!=='boolean')throw Error('Could not confirm your group. Check the PIN and try again.');
        playerJoinOptions=options;
        if(invitePin==='1010'||(!validInvitation&&!options.pin_join_enabled)){await existingPlayerHelp();return;}
        if(!validInvitation&&options.pin_join_enabled){const owned=await ownsGroup(invitePin);if(owned){showGroup(owned);rememberOwnedGroup(invitePin);ownerReturnPin=invitePin;message('You have organiser access. Open your group, or use I’m playing too to add your own player.');return;}}
      }
      if(!validInvitation&&!playerJoinOptions?.pin_join_enabled)throw Error('Open the complete invitation link from your organiser.');
      $('regJoinGroupName').textContent=playerJoinOptions?.group_name||'Your golf group';$('regJoinError').textContent='';
      if(playerJoinOptions?.pin_join_enabled&&!nativeApp()){$('regAppJoinHelp').hidden=false;$('regAppJoinHelp').textContent='You can also join in the iPhone app: Join my golf group → PIN '+invitePin+' → use this verified email.';}
      $('regJoinForm').hidden=false;progress('Join your group');message('');$('regJoinForm').scrollIntoView?.({block:'start'});$('regPlayerName').focus();return;
    }
    openPlayerData(data,invitePin);
  }
  $('regJoinForm').onsubmit=event=>{event.preventDefault();action(async()=>{
    const name=$('regPlayerName').value.trim(),raw=$('regHandicap').value.trim(),handicap=Number(raw);
    if(!name||name.length>80||!/^[-]?[0-9]{1,2}(?:\.[0-9])?$/.test(raw)||handicap < -10||handicap > 60)throw new Error('Enter your name and a handicap from -10 to 60, with up to one decimal place.');
    if(!validInvitation&&!(playerJoinOptions?.group_pin===invitePin&&playerJoinOptions.pin_join_enabled===true))throw new Error('Open the complete invitation link from your organiser.');
    $('regJoinError').textContent='';
    await request('/rest/v1/rpc/'+joinRpc,{p_pin:invitePin,p_invite:validInvitation?inviteToken:null,p_name:name,p_handicap:handicap},true);
    await loadPlayer();
  });};
  $('regReload').onclick = () => action(dashboard ? loadDashboard : ()=>onboarding?.pendingPin?loadGroup(onboarding.pendingPin):playerMode&&!additionalGroup?loadPlayer():loadGroup());
  async function signout(keepGroupRoute=false) {
    if(keeper)await keeper.signout();
    else if(session)await request('/auth/v1/logout', {}, true);
    reset();
    // Changing email uses confirmed SDK sign-out and keeps this invitation/PIN.
    if(keepGroupRoute===true && playerMode && validPlayerPin){
      email='';$('regEmail').value='';$('regPasswordEmail').value='';
      showWelcomePanel('start',false);
      message('Sign in with the email you used for this group. Group PIN '+invitePin+'.');
      return;
    }
    message('Signed out.');
    if(!dashboard){
      showWelcomePanel('home',false);
      // Reinitialise captured Admin/player route intent after confirmed logout.
      // Replacing the URL also keeps refresh from reopening the previous route.
      location.replace(location.pathname);
    }
  }
  // Complimentary release: no purchase bridge, verifier calls or billing diagnostics.
  $('regSignout').onclick = () => action(signout);
  $('regAccountControls').onclick = () => window.iigAccount?.open();
  window.iigAccount?.configure({request,reset,signout,async afterDeletion(){try{if(keeper)await keeper.forgetDeleted();}finally{reset();}},focused,canSwitch:!dashboard,currentEmail:()=>session?.user?.email||'',
   async openOrganiser(){
    const group=await readOwnedGroup(window.iigSecurePlayer?.identity?.groupPin||window.iigSecureOrganiser?.groupPin||selectedOwnedPin);
    if(!group)throw Error('Your account does not own a group.');
    await openOwnedGroup(group.group_pin);
   },
   async openPlayer(name,handicap){
    const group=await readOwnedGroup(window.iigSecureOrganiser?.groupPin||selectedOwnedPin);
    if(!group)throw Error('Use your organiser’s invitation or the returning-player PIN login.');
    await request('/rest/v1/rpc/'+joinRpc,{p_pin:group.group_pin,p_invite:group.invite_token,p_name:name,p_handicap:handicap},true);
    const player=await request('/rest/v1/rpc/iig_read_entry_group',{p_pin:group.group_pin},true);
    window.iigSecureOrganiser?.close();window.iigSecurePlayer.open(player,group.group_pin,request,()=>action(signout));
   }
  });
  async function loadDashboard() {
    // Only the server-side platform-owner role can return customer metadata.
    let rows;
    try { rows = await request('/rest/v1/rpc/iig_list_registered_groups', { p_offset: offset }, true); }
    catch(error) {
      // A revoked owner must never keep a previously displayed customer register.
      $('dashView').classList.add('hidden');
      $('loginView').classList.remove('hidden');
      document.querySelector('#dashView .content').textContent = '';
      throw error;
    }
    if (!Array.isArray(rows)) throw new Error('Unexpected dashboard response.');
    const content = document.querySelector('#dashView .content');
    content.innerHTML = '<section class="panel"><h2>Golf groups</h2><p id="registerCount"></p><div class="table-wrap ui-register-wrap"><table class="ui-register-table"><caption>Active groups and demo, newest first</caption><thead><tr><th scope="col">Group</th><th scope="col">PIN</th><th scope="col">Organiser</th><th scope="col">Status</th><th scope="col">Details</th></tr></thead><tbody id="registerRows"></tbody></table></div><p id="registerEmpty"></p><div class="toolbar"><button id="registerRefresh" class="primary">Refresh groups</button><button id="registerPrev" class="secondary">Previous</button><button id="registerNext" class="secondary">Next</button></div><p id="registerError" role="status" aria-live="polite"></p></section>';
    $('registerCount').textContent = rows.length ? 'Showing ' + (offset + 1) + '–' + (offset + rows.length) : 'No more registrations';
    $('registerEmpty').textContent = rows.length ? '' : 'New groups will appear here as soon as they are created. Tap Refresh registrations to check.';
    for (const group of rows) {
      const tr = document.createElement('tr');
      const fields=['group_name','group_pin','admin_name','admin_contact','created_at','plan_type','trial_expiry_date','paid_status','status'];
      const labels=['Group','PIN','Organiser','Email','Created','Plan','Trial ends','Payment','Status'];
      for (const field of fields) {
        const td = document.createElement('td');
        td.setAttribute('data-label',labels[fields.indexOf(field)]);
        const value = group[field];
        const planLabels={complimentary:'Plus · included',plus:'Plus',paid:'Plus',free:'Free',trial:'Trial',internal:'Internal'};
        td.textContent = field==='status'&&group.needs_organiser ? 'Organiser recovery required' : value == null ? '—' : field==='plan_type' ? (planLabels[value]||String(value)) : (field === 'created_at' ? String(value).slice(0,10) : String(value));
        tr.appendChild(td);
      }
      const secondary=document.createElement('td');secondary.className='ui-group-details';const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='More details';details.append(summary);for(const index of [3,4,5,6,7]){const cell=tr.children[[0,1,2,3,4,5,6,7,8].indexOf(index)];if(cell){const p=document.createElement('p');p.textContent=cell.dataset.label+': '+cell.textContent;details.append(p);}}for(const index of [7,6,5,4,3])tr.children[index]?.remove();secondary.append(details);tr.append(secondary);
      $('registerRows').appendChild(tr);
    }
    async function refresh(nextOffset) {
      if (busy) return;
      const previous = offset; offset = nextOffset;
      await action(async () => {
        try { await loadDashboard(); }
        catch(error) { offset = previous; if ($('registerError')) $('registerError').textContent = error.message; throw error; }
      });
    }
    $('registerPrev').disabled = offset === 0; $('registerNext').disabled = rows.length < 100;
    $('registerPrev').onclick = () => refresh(Math.max(0,offset - 100));
    $('registerNext').onclick = () => refresh(offset + 100);
    $('registerRefresh').onclick = () => refresh(0);
    document.querySelector('#dashView .nav').innerHTML = '<button id="registerAccount">My account</button><button id="registerLogout">Sign out</button>';
    $('registerAccount').onclick = () => window.iigAccount?.open();
    $('registerLogout').onclick = () => action(signout);
    if(focused){
     const controls=document.createElement('section');controls.className='panel ui-dashboard-admin';
     controls.innerHTML='<h2>Group administration</h2><p>1010 and demo 2026 are protected. Retirement preserves every golf record. Verify a fresh email code before changes.</p><label for=retirePin>Group PIN</label><input id=retirePin inputmode=numeric maxlength=4><label for=retireReason>Reason</label><input id=retireReason maxlength=500><button id=retireGroup>Retire group</button><button id=restoreGroup>Restore group</button><details><summary>Reconnect the verified Group 1010 organiser</summary><p>Independently verify the original organiser and their account reference. A PIN or email alone is insufficient.</p><label for=adoptAccount>Verified account reference</label><input id=adoptAccount><label for=adoptEvidence>Private verification reference</label><input id=adoptEvidence maxlength=500><button id=adoptGroup>Connect verified organiser</button></details>';
     const administration=document.createElement('details');administration.className='ui-options';
     const summary=document.createElement('summary');summary.textContent='Group administration';administration.appendChild(summary);
     controls.querySelector('h2')?.remove();
     while(controls.firstChild)administration.appendChild(controls.firstChild);
     controls.appendChild(administration);content.appendChild(controls);
     for(const [id,retired] of [['retireGroup',true],['restoreGroup',false]])$(id).onclick=()=>action(async()=>{
      const pin=$('retirePin').value.trim();if(!/^[0-9]{4}$/.test(pin)||['1010','2026'].includes(pin))throw Error('Choose an unused group; 1010 and 2026 are protected.');
      if(!window.confirm((retired?'Retire':'Restore')+' group '+pin+'? Golf records will be preserved.'))return;
      await request('/rest/v1/rpc/iig_set_group_retired',{p_pin:pin,p_retired:retired,p_reason:$('retireReason').value.trim()},true);await loadDashboard();
     });
     $('adoptGroup').onclick=()=>action(async()=>{
      const account=$('adoptAccount').value.trim();if(!/^[a-f0-9-]{36}$/i.test(account))throw Error('Enter the complete verified account reference.');
      await request('/rest/v1/rpc/iig_adopt_retained_group',{p_pin:'1010',p_account:account,p_evidence:$('adoptEvidence').value.trim()},true);message('Organiser connected. Existing golf records were preserved.');
     });
    }
    window.iigOwnerCentre?.configureActions({
      request:(path,body)=>request(path,body,true),
      userId:()=>session?.user?.id||null,
      refresh:async()=>{offset=0;await loadDashboard();},
      reauth:()=>action(async()=>{const address=session?.user?.email;if(!address)throw Error('Sign in again to continue.');await signout();email=address;$('regEmail').value=address;await sendCode();})
    });
    $('liveText').textContent = 'Groups';
    document.querySelector('#dashView .side-foot').textContent = 'I’m In Golf • Active groups';
    $('loginView').classList.add('hidden'); $('dashView').classList.remove('hidden');
    message('Registrations loaded.');
  }
  if(adminMode){showWelcomePanel('start',false);progress('Sign in');}
  if(playerMode){
    showWelcomePanel('start',false);
    window.addEventListener('load',()=>showWelcomePanel('start',false));
    $('welcomeStartTitle').textContent='Join your golf group.';
    $('welcomeStartTitle').nextElementSibling.textContent='Verify your email, then join using your name and handicap.';
    $('regReload').textContent='Open my player account';
    if(!validPlayerPin || (inviteToken && !validInvitation)){$('regEmailForm').hidden=true;message('Open the complete invitation link from your organiser.');return;}
  }
  if(keeper)action(async()=>{try{const restored=await restoreSession();if(restored)await finishSignIn(restored);}catch(error){if(session)message(error.message||'Your group could not be opened. Try Open my player account again.');else{reset();message('Sign in again to securely restore your account.');}}});
  message(dashboard ? 'Sign in with your platform owner account.' : playerMode ? 'Sign in to join your group.' : '');
})();
