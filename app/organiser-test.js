/* Isolated staging client. No production config or gameplay adapter. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const allowed = location.hostname === 'deploy-preview-6--super-quokka-51747d.netlify.app' || ['localhost', '127.0.0.1'].includes(location.hostname);
  const message = text => { $('message').textContent = text; };
  if (!allowed) { message('This test page is only available on the authorised preview.'); return; }
  const base = 'https://nyavvwrsrxqfyhiygkgw.supabase.co';
  const key = 'sb_publishable_fDGji75-j3GP5VeAAIAdZg_f9TNmtWL';
  // Session credentials remain in memory only. Reloading requires a new email code.
  let session = null, email = '', busy = false, resendAt = 0;
  const lock = value => {
    busy = value;
    document.querySelectorAll('button').forEach(button => { button.disabled = value; });
    $('resend').disabled = value || Date.now() < resendAt;
  };
  async function request(path, body, authorised = false) {
    if (authorised && (!session || Date.now() >= session.expires_at * 1000)) {
      session = null; $('signedIn').hidden = true; $('emailForm').hidden = false;
      throw new Error('Your test session expired. Request a new email code to continue.');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const headers = { apikey: key, 'Content-Type': 'application/json' };
      if (authorised) headers.Authorization = 'Bearer ' + session.access_token;
      const response = await fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal, cache: 'no-store' });
      const data = response.status === 204 ? {} : await response.json();
      if (!response.ok) throw new Error(data.msg || data.message || data.error_description || 'Request failed. Please try again.');
      return data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('The connection timed out. You can safely retry.');
      throw error;
    } finally { clearTimeout(timer); }
  }
  async function action(fn) {
    if (busy) return;
    lock(true); message('Please wait…');
    try { await fn(); } catch (error) { message(error.message || 'Unable to connect. Please try again.'); }
    finally { lock(false); }
  }
  function showGroup(data) {
    if (!data || !/^\d{4}$/.test(data.group_pin)) throw new Error('Unexpected group response. Use Check for my test group before retrying.');
    $('pin').textContent = data.group_pin;
    $('groupForm').hidden = true; $('approval').hidden = true; $('result').hidden = false;
    message('Your test group has been saved.');
  }
  async function checkGroup() {
    const data = await request('/rest/v1/rpc/iig_get_owned_group', {}, true);
    if (data) showGroup(data);
    else { $('result').hidden = true; $('groupForm').hidden = false; message('Email verified. Enter your name and test group name.'); }
  }
  async function sendCode() {
    if (Date.now() < resendAt) throw new Error('Please wait a minute before requesting another code.');
    await request('/auth/v1/otp', { email, create_user: true });
    resendAt = Date.now() + 60000;
    setTimeout(() => { if (!busy) $('resend').disabled = false; }, 60000);
    $('emailForm').hidden = true; $('codeForm').hidden = false;
    $('sentTo').textContent = 'Enter the latest code sent to ' + email + '.';
    message('Check your inbox and junk folder. Keep this page open.'); $('code').focus();
  }
  $('emailForm').onsubmit = event => { event.preventDefault(); action(async () => { email = $('email').value.trim(); await sendCode(); }); };
  $('resend').onclick = () => action(sendCode);
  $('changeEmail').onclick = () => { $('codeForm').hidden = true; $('emailForm').hidden = false; $('code').value = ''; message('Enter your email address.'); };
  $('codeForm').onsubmit = event => {
    event.preventDefault(); action(async () => {
      const token = $('code').value.trim();
      if (!/^[0-9]{6,10}$/.test(token)) throw new Error('Enter the numeric code from your email.');
      const data = await request('/auth/v1/verify', { email, token, type: 'email' });
      if (!data.access_token || !data.user || !data.user.id) throw new Error('Verification did not return a session. Please request a new code.');
      session = { access_token: data.access_token, user: data.user, expires_at: data.expires_at || Math.floor(Date.now()/1000) + data.expires_in };
      $('code').value = ''; $('codeForm').hidden = true; $('signedIn').hidden = false;
      $('account').textContent = 'Signed in as ' + data.user.email;
      $('identity').textContent = data.user.id;
      await checkGroup();
    });
  };
  $('check').onclick = () => action(checkGroup);
  $('groupForm').onsubmit = event => {
    event.preventDefault(); action(async () => {
      const name = $('group').value.trim(), organiser = $('organiser').value.trim();
      if (!name || !organiser) throw new Error('Enter your name and a test group name.');
      if (!session) throw new Error('Sign in before creating a group.');
      const storageKey = 'iig-test-create:' + session.user.id;
      // Persist only retry metadata, never credentials. Reconcile before every creation attempt.
      const existing = await request('/rest/v1/rpc/iig_get_owned_group', {}, true);
      if (existing) { showGroup(existing); return; }
      let pending;
      try { pending = JSON.parse(sessionStorage.getItem(storageKey) || 'null'); } catch (_) { pending = null; }
      if (!pending || pending.name !== name) pending = { name, request: crypto.randomUUID() };
      sessionStorage.setItem(storageKey, JSON.stringify(pending));
      try {
        const data = await request('/rest/v1/rpc/iig_create_owned_group', { p_name: name, p_organiser_name: organiser, p_request_id: pending.request }, true);
        showGroup(data);
      } catch (error) {
        if (error.message.includes('Registration is not open yet')) { $('approval').hidden = false; message('Your test account needs to be enabled before creating a group.'); }
        else throw error;
      }
    });
  };
  $('signout').onclick = () => action(async () => {
    try { if (session) await request('/auth/v1/logout', {}, true); }
    catch (_) { /* Local credentials are always discarded. */ }
    finally { session = null; location.reload(); }
  });
  $('emailForm').hidden = false;
  message('Start by verifying your email address.');
})();
