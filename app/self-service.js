/* Staging integration: verified self-service registration and private owner register.
   This module never uses the production config.js client. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const dashboard = location.pathname.endsWith('/owner-dashboard.html');
  const allowed = location.hostname === 'deploy-preview-6--super-quokka-51747d.netlify.app' || ['localhost', '127.0.0.1'].includes(location.hostname);
  if (!allowed) {
    if (!dashboard && $('registrationAuth')) $('registrationAuth').textContent = 'Group setup is not available on this preview. Please use the current setup preview.';
    return;
  }
  const invitation = new URLSearchParams((location.hash || '').replace(/^#/,''));
  const playerMode = !dashboard && (invitation.has('pin') || invitation.has('invite'));
  const invitePin = invitation.get('pin'), inviteToken = invitation.get('invite');
  const validPlayerPin = /^\d{4}$/.test(invitePin || '');
  const validInvitation = /^\d{4}$/.test(invitePin || '') && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(inviteToken || '');
  const base = 'https://nyavvwrsrxqfyhiygkgw.supabase.co';
  const key = 'sb_publishable_fDGji75-j3GP5VeAAIAdZg_f9TNmtWL';
  let session = null, email = '', busy = false, resendAt = 0, pending = null, offset = 0, expiryTimer = null;
  if (dashboard) {
    document.querySelector('#loginView .login-card').innerHTML = '<h1>I’m In Golf</h1><h2>Owner Dashboard</h2><p>Sign in to see groups created through the app.</p><div id="registrationAuth"></div>';
  }
  const root = $('registrationAuth');
  if (!root) return;
  root.innerHTML = `
    <p class="notice">Preview: creates real groups in the test database only.</p>
    ${!dashboard && !playerMode ? '<details><summary>Already joined a test group?</summary><form id="regReturnForm"><label for="regReturnPin">Group PIN</label><input id="regReturnPin" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" required><button class="secondary full">Sign in to my player account</button></form></details>' : ''}
    <p id="regMessage" role="status" aria-live="polite"></p>
    <form id="regEmailForm"><label for="regEmail">Your email address</label><input id="regEmail" type="email" autocomplete="email" maxlength="254" required><button class="primary full">Email me a sign-in code</button><p class="muted">${dashboard ? 'Only authorised I’m In Golf owners can view registrations.' : playerMode ? 'Verify your email to join your golf group.' : 'Use an email you can access. Your account will manage your group.'}</p></form>
    <form id="regCodeForm" hidden><label for="regCode">Code from your email</label><p id="regSentTo"></p><input id="regCode" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,10}" minlength="6" maxlength="10" required><button class="primary full">Verify email</button><button id="regResend" type="button" class="secondary full">Send another code</button><button id="regChangeEmail" type="button" class="ghost full">Use a different email</button></form>
    <section id="regSignedIn" hidden><p id="regAccount" class="muted"></p>
    <form id="regGroupForm" hidden><label for="regName">Your name</label><input id="regName" autocomplete="name" maxlength="80" required><label for="regGroupName">Group name</label><input id="regGroupName" maxlength="80" required placeholder="e.g. Sunday Golfers"><button class="primary full">Create my group</button><p class="muted">One group per organiser account. Your name and email are shared with I’m In Golf to manage your group and trial.</p></form>
    <form id="regJoinForm" hidden><label for="regPlayerName">Your name</label><input id="regPlayerName" autocomplete="name" maxlength="80" required><label for="regHandicap">Handicap</label><input id="regHandicap" type="text" inputmode="decimal" maxlength="5" pattern="-?[0-9]{1,2}([.][0-9])?" aria-describedby="regHandicapHelp" required><small id="regHandicapHelp">Up to two digits and one decimal place, e.g. 11.2.</small><button class="primary full">Join my group</button></form>
    <section id="regCreated" hidden><h2>Your group is ready</h2><p id="regCreatedName"></p><p>Group PIN: <strong id="regPin"></strong></p><p>Your group has been registered with I’m In Golf.</p><p class="notice">This is a test group. Open your group to test competition setup in the original app layout. Player invitations now support Points Game attendance and final scores in this preview.</p><button id="regOpenGroup" type="button" class="primary full">Open my group</button></section>
    <button id="regReload" type="button" class="secondary full">${dashboard ? 'Open dashboard' : 'Check my group'}</button><button id="regSignout" type="button" class="ghost full">Sign out</button></section>`;
  // Author styles in the original app must not override hidden form visibility.
  const style = document.createElement('style');
  style.textContent = '#registrationAuth [hidden]{display:none!important}#registrationAuth button:disabled{opacity:.55}#registrationAuth p{overflow-wrap:anywhere}#registrationAuth label{display:block;font-weight:700;margin-top:14px}#registrationAuth button{min-height:44px}';
  document.head.appendChild(style);
  const message = text => { $('regMessage').textContent = text; };
  const lock = value => {
    busy = value;
    root.querySelectorAll('button,input').forEach(el => { el.disabled = value; });
    $('regResend').disabled = value || Date.now() < resendAt;
  };
  function reset() {
    clearTimeout(expiryTimer); expiryTimer=null;
    window.iigSecureOrganiser?.close();
    window.iigSecurePlayer?.close();
    $('regJoinForm').hidden = true;
    session = null; pending = null;
    $('regSignedIn').hidden = true; $('regGroupForm').hidden = true; $('regCreated').hidden = true;
    $('regEmailForm').hidden = false; $('regCodeForm').hidden = true; $('regCode').value = '';
    if (dashboard) { $('loginView').classList.remove('hidden'); $('dashView').classList.add('hidden'); document.querySelector('#dashView .content').textContent = ''; }
  }
  async function request(path, body, auth = false) {
    if (auth && (!session || Date.now() >= session.expires_at * 1000)) {
      reset(); throw new Error('Please sign in again to continue.');
    }
    const requestSession = session;
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const headers = { apikey: key, 'Content-Type': 'application/json' };
      if (auth) headers.Authorization = 'Bearer ' + session.access_token;
      const response = await fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body), cache: 'no-store', signal: controller.signal });
      const data = response.status === 204 ? {} : await response.json();
      if (!response.ok) {
        if (response.status === 401 && auth) reset();
        if (data.code === 'PGRST202') throw new Error('The test database update is needed before this step can run.');
        const error = new Error(data.msg || data.message || 'Unable to connect. Please try again.'); error.code=data.code; throw error;
      }
      if (auth && (session !== requestSession || !session || Date.now() >= session.expires_at*1000)) {
        reset(); throw new Error('Your session expired. Sign in again to continue.');
      }
      return data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('Connection timed out. Use Check my group before trying to create it again.');
      throw error;
    } finally { clearTimeout(timeout); }
  }
  async function action(fn) {
    if (busy) return;
    lock(true); message('Please wait…');
    try { await fn(); } catch (error) { message(error.message || 'Please try again.'); }
    finally { lock(false); }
  }
  function showGroup(group) {
    if (!group || !/^\d{4}$/.test(group.group_pin)) throw new Error('Could not confirm your group. Tap Check my group.');
    $('regGroupForm').hidden = true; $('regCreated').hidden = false;
    $('regCreatedName').textContent = group.state?.groupName || '';
    $('regPin').textContent = group.group_pin;
    message('Your group is saved.');
  }
  async function loadGroup() {
    const group = await request('/rest/v1/rpc/iig_get_owned_group', {}, true);
    if (group) showGroup(group);
    else { $('regCreated').hidden = true; $('regGroupForm').hidden = false; message('Email verified. Choose your group name below.'); }
    return group;
  }
  async function sendCode() {
    if (Date.now() < resendAt) throw new Error('Please wait a minute before requesting another code.');
    await request('/auth/v1/otp', { email, create_user: !dashboard });
    resendAt = Date.now() + 60000;
    setTimeout(() => { if (!busy) $('regResend').disabled = false; }, 60000);
    $('regEmailForm').hidden = true; $('regCodeForm').hidden = false; $('regCode').value = '';
    $('regSentTo').textContent = 'Enter the latest code sent to ' + email + '.';
    message('Check your inbox and junk folder. Keep this page open.'); $('regCode').focus();
  }
  if ($('regReturnForm')) $('regReturnForm').onsubmit = event => {
    event.preventDefault();
    const value=$('regReturnPin').value.trim();
    if (!/^\d{4}$/.test(value)) { message('Enter your four-digit group PIN.'); return; }
    location.assign(location.pathname + '#pin=' + encodeURIComponent(value));
    location.reload();
  };
  $('regEmailForm').onsubmit = event => { event.preventDefault(); action(async () => { email = $('regEmail').value.trim(); await sendCode(); }); };
  $('regResend').onclick = () => action(sendCode);
  $('regChangeEmail').onclick = () => { $('regCodeForm').hidden = true; $('regEmailForm').hidden = false; $('regCode').value = ''; message('Enter your email address.'); };
  $('regCodeForm').onsubmit = event => {
    event.preventDefault(); action(async () => {
      const token = $('regCode').value.trim();
      if (!/^[0-9]{6,10}$/.test(token)) throw new Error('Enter the numeric code from your email.');
      const data = await request('/auth/v1/verify', { email, token, type: 'email' });
      const expires = Number(data.expires_at || Math.floor(Date.now()/1000) + Number(data.expires_in));
      if (!data.access_token || !data.user?.id || !Number.isFinite(expires)) throw new Error('Please request a new sign-in code.');
      if(expires*1000<=Date.now())throw new Error('Please request a new sign-in code.');
      session = { access_token: data.access_token, user: data.user, expires_at: expires };
      clearTimeout(expiryTimer);
      expiryTimer=setTimeout(()=>{reset();message('Your session expired. Sign in again to continue.');},Math.min(expires*1000-Date.now(),2147483647));
      $('regCode').value = ''; $('regCodeForm').hidden = true; $('regSignedIn').hidden = false;
      $('regAccount').textContent = 'Signed in as ' + data.user.email;
      if (dashboard) { offset = 0; await loadDashboard(); } else if(playerMode) await loadPlayer(); else await loadGroup();
    });
  };
  $('regGroupForm').onsubmit = event => {
    event.preventDefault(); action(async () => {
      const name = $('regGroupName').value.trim(), organiser = $('regName').value.trim();
      if (!name || !organiser || name.length > 80 || organiser.length > 80) throw new Error('Enter your name and a group name (up to 80 characters each).');
      if (await loadGroup()) return;
      const storageKey = 'iig-registration:' + session.user.id;
      if (!pending) { try { pending = JSON.parse(sessionStorage.getItem(storageKey) || 'null'); } catch (_) {} }
      if (!pending || pending.name !== name || !/^[0-9a-f-]{36}$/i.test(pending.id || '')) pending = { name, id: crypto.randomUUID() };
      try { sessionStorage.setItem(storageKey, JSON.stringify(pending)); } catch (_) { /* memory retry key still works */ }
      const result = await request('/rest/v1/rpc/iig_create_owned_group', { p_name: name, p_organiser_name: organiser, p_request_id: pending.id }, true);
      showGroup(result);
      try { await loadGroup(); } catch (_) { message('Your group was created. Tap Check my group to reload its details.'); }
    });
  };
  $('regOpenGroup').onclick = () => action(async () => {
    if (!window.iigSecureOrganiser) throw new Error('Please reload this preview to open your group.');
    const group = await loadGroup();
    if (!group) return;
    const accessRows = await request('/rest/v1/rpc/get_group_access_status', {p_pin:group.group_pin}, true);
    const access = Array.isArray(accessRows) ? accessRows[0] : accessRows;
    if (!access || access.access_allowed !== true) throw new Error('Your group is not currently available.');
    window.iigSecureOrganiser.open(group, request, () => action(signout), access.plan_type);
  });
  async function loadPlayer(){
    if(!validPlayerPin)throw new Error('Enter a valid group PIN.');
    let data;
    try{data=await request('/rest/v1/rpc/iig_get_player_group',{p_pin:invitePin},true);}
    catch(error){if(error.code==='42501' && error.message==='Group membership required'){if(!validInvitation)throw new Error('No player membership was found for this email. Ask your organiser for an invitation to join.');$('regJoinForm').hidden=false;message('Email verified. Enter your name and handicap.');return;}throw error;}
    if(!window.iigSecurePlayer)throw new Error('Reload this preview to open your player account.');
    window.iigSecurePlayer.open(data,invitePin,request,()=>action(signout));
    $('regJoinForm').hidden=true;
  }
  let lastHandicap = '';
  $('regHandicap').oninput = () => {
    const input = $('regHandicap');
    // Reject excess digits while typing or pasting; never silently change a handicap.
    if (/^-?(?:[0-9]{0,2}|[0-9]{1,2}\.[0-9]?)$/.test(input.value)) lastHandicap = input.value;
    else input.value = lastHandicap;
  };
  $('regJoinForm').onsubmit=event=>{event.preventDefault();action(async()=>{
    const name=$('regPlayerName').value.trim(),raw=$('regHandicap').value.trim(),handicap=Number(raw);
    if(!name||name.length>80||!/^[-]?[0-9]{1,2}(?:\.[0-9])?$/.test(raw)||handicap < -10||handicap > 60)throw new Error('Enter your name and a handicap from -10 to 60, with up to one decimal place.');
    if(!validInvitation)throw new Error('Open the complete invitation link from your organiser.');
    await request('/rest/v1/rpc/iig_join_owned_group',{p_pin:invitePin,p_invite:inviteToken,p_name:name,p_handicap:handicap},true);
    await loadPlayer();
  });};
  $('regReload').onclick = () => action(dashboard ? loadDashboard : playerMode ? loadPlayer : loadGroup);
  async function signout() {
    try { if (session) await request('/auth/v1/logout', {}, true); }
    finally { reset(); message('Signed out on this page.'); }
  }
  $('regSignout').onclick = () => action(signout);
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
    content.innerHTML = '<section class="panel"><h2>Groups created through the app</h2><p>Test registrations • newest first</p><p id="registerCount"></p><div class="table-wrap"><table><thead><tr><th>Group</th><th>PIN</th><th>Organiser</th><th>Email</th><th>Created</th><th>Plan</th><th>Trial ends</th><th>Payment</th><th>Status</th></tr></thead><tbody id="registerRows"></tbody></table></div><p id="registerEmpty"></p><div class="toolbar"><button id="registerPrev" class="secondary">Previous</button><button id="registerNext" class="secondary">Next</button><button id="registerRefresh" class="secondary">Refresh registrations</button></div><p id="registerError" role="status" aria-live="polite"></p></section>';
    $('registerCount').textContent = rows.length ? 'Showing ' + (offset + 1) + '–' + (offset + rows.length) : 'No more registrations';
    $('registerEmpty').textContent = rows.length ? '' : 'New groups will appear here as soon as they are created. Tap Refresh registrations to check.';
    for (const group of rows) {
      const tr = document.createElement('tr');
      for (const field of ['group_name','group_pin','admin_name','admin_contact','created_at','plan_type','trial_expiry_date','paid_status','status']) {
        const td = document.createElement('td');
        const value = group[field];
        td.textContent = value == null ? '—' : (field === 'created_at' ? String(value).slice(0,10) : String(value));
        tr.appendChild(td);
      }
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
    document.querySelector('#dashView .nav').innerHTML = '<button id="registerLogout">Sign out</button>';
    $('registerLogout').onclick = () => action(signout);
    $('liveText').textContent = 'Test database';
    document.querySelector('#dashView .side-foot').textContent = 'I’m In Golf • Test registrations';
    $('loginView').classList.add('hidden'); $('dashView').classList.remove('hidden');
    message('Registrations loaded.');
  }
  if(playerMode){
    showWelcomePanel('start',false);
    window.addEventListener('load',()=>showWelcomePanel('start',false));
    $('welcomeStartTitle').textContent='Join your golf group.';
    $('welcomeStartTitle').nextElementSibling.textContent='Verify your email, then join using your name and handicap.';
    $('regReload').textContent='Open my player account';
    if(!validPlayerPin || (inviteToken && !validInvitation)){$('regEmailForm').hidden=true;message('Open the complete invitation link from your organiser.');return;}
  }
  message(dashboard ? 'Sign in with your I’m In Golf owner email.' : 'Start by verifying your email.');
})();
