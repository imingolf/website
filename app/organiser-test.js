/* Isolated staging client. No production config or gameplay adapter. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  window.iigHandicap?.bind($('handicap'));
  const allowed = location.hostname === 'deploy-preview-6--super-quokka-51747d.netlify.app' || ['localhost', '127.0.0.1'].includes(location.hostname);
  const message = text => { $('message').textContent = text; };
  if (!allowed) { message('This test page is only available on the authorised preview.'); return; }
  const playerMode = location.pathname === '/app/player-test.html';
  const invite = new URLSearchParams(location.hash.slice(1));
  const invitePin = invite.get('pin'), inviteToken = invite.get('invite');
  if (playerMode && (!/^\d{4}$/.test(invitePin || '') || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(inviteToken || ''))) {
    message('Open the complete invitation link from your organiser.'); return;
  }
  let playerGroup = null, lastValidScore = '';
  const base = 'https://nyavvwrsrxqfyhiygkgw.supabase.co';
  const key = 'sb_publishable_fDGji75-j3GP5VeAAIAdZg_f9TNmtWL';
  // Session credentials remain in memory only. Reloading requires a new email code.
  let ownedGroup = null, session = null, email = '', busy = false, resendAt = 0;
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
      if (!response.ok) { const error = new Error(data.msg || data.message || data.error_description || 'Request failed. Please try again.'); error.code = data.code; throw error; }
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
    $('inviteSection').hidden = true;
    ownedGroup = null;
    $('competitionForm').hidden = true;
    $('reloadCompetition').hidden = true;
    $('competitionSummary').textContent = 'Check for your test group to load competition setup.';
    if (data.state && Array.isArray(data.state.players) && Array.isArray(data.state.history) && Number.isSafeInteger(data.revision)) {
      ownedGroup = data;
      $('course').value = data.state.course || '';
      $('competitionDate').value = data.state.date || '';
      $('format').value = data.state.pointsCompetition === 'net' ? 'net' : 'stableford';
      // This first-competition UI must not repurpose an active or previously played group.
      const editable = data.state.roundOpen === false && data.state.players.length === 0 && data.state.history.length === 0;
      $('competitionForm').hidden = !editable;
      $('reloadCompetition').hidden = false;
      const ready = !!data.state.course && /^\d{4}-\d{2}-\d{2}$/.test(data.state.date || '');
      $('inviteSection').hidden = !ready;
      $('openEntries').hidden = data.state.roundOpen === true || data.state.history.length > 0;
      $('entryStatus').textContent = data.state.roundOpen === true ? 'Test entries are open.' : 'Open test entries before inviting players.';
      $('inviteLink').value = data.state.roundOpen === true && data.invite_token
        ? location.origin + '/app/player-test.html#pin=' + encodeURIComponent(data.group_pin) + '&invite=' + encodeURIComponent(data.invite_token) : '';
      $('copyInvite').hidden = !$('inviteLink').value;
      $('openInvite').hidden = !$('inviteLink').value;
      $('openInvite').href = $('inviteLink').value;
      $('copyStatus').textContent = '';
      $('competitionSummary').textContent = editable
        ? (data.state.course && data.state.date ? 'Saved draft: ' + data.state.course + ' · ' + data.state.date + ' · ' + ($('format').value === 'net' ? 'Net' : 'Stableford') : 'Your group is ready. Add your first competition below.')
        : 'This group already has activity. First-competition setup is unavailable.';
    }
    message('Your test group has been loaded.');
  }
  async function checkGroup() {
    const data = await request('/rest/v1/rpc/iig_get_owned_group', {}, true);
    if (data) showGroup(data);
    else { ownedGroup = null; $('result').hidden = true; $('groupForm').hidden = false; message('Email verified. Enter your name and test group name.'); }
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
      if (playerMode) { $('check').hidden = true; $('playerSection').hidden = false; await loadPlayer(); }
      else await checkGroup();
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
        await checkGroup();
      } catch (error) {
        if (error.message.includes('Registration is not open yet')) { $('approval').hidden = false; message('Your test account needs to be enabled before creating a group.'); }
        else throw error;
      }
    });
  };
  $('reloadCompetition').onclick = () => action(checkGroup);
  $('competitionForm').onsubmit = event => {
    event.preventDefault(); action(async () => {
      if (!ownedGroup || $('competitionForm').hidden) throw new Error('Load your test group before setting up a competition.');
      const course = $('course').value.trim(), date = $('competitionDate').value, format = $('format').value;
      const parsed = new Date(date + 'T12:00:00Z');
      if (!course || course.length > 120) throw new Error('Enter a course name of up to 120 characters.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error('Choose a valid competition date.');
      const today = new Date();
      const localToday = [today.getFullYear(), String(today.getMonth()+1).padStart(2,'0'), String(today.getDate()).padStart(2,'0')].join('-');
      if (date < localToday) throw new Error('Choose today or a future date.');
      if (!['stableford', 'net'].includes(format)) throw new Error('Choose Stableford or Net.');
      const state = { ...ownedGroup.state, course, date, pointsCompetition: format };
      try {
        await request('/rest/v1/rpc/iig_save_owned_group', { p_pin: ownedGroup.group_pin, p_state: state, p_revision: ownedGroup.revision }, true);
      } catch (error) {
        // Never automatically retry a whole-state write or overwrite newer server data.
        ownedGroup = null;
        $('competitionForm').hidden = true;
        throw new Error(error.message + ' Use Reload saved competition to check what is stored before editing again.');
      }
      ownedGroup = null;
      $('competitionForm').hidden = true;
      try { await checkGroup(); }
      catch (_) { throw new Error('Save accepted, but the saved details could not be loaded. Use Reload saved competition to check them.'); }
      message('Competition draft saved and checked. Entries are not open yet.');
    });
  };
  $('copyInvite').onclick = async () => {
    const input = $('inviteLink'), status = $('copyStatus');
    if (!input.value) { status.textContent = 'Open entries and reload your group first.'; return; }
    input.focus(); input.select(); input.setSelectionRange(0, input.value.length);
    // Keep manual instructions beside the button even when clipboard permission hangs.
    status.textContent = 'Link selected. Press Command+C on Mac or Ctrl+C on Windows, or touch and hold the link and choose Copy. You can also open the invitation below.';
    try {
      if (!navigator.clipboard || !navigator.clipboard.writeText) return;
      await navigator.clipboard.writeText(input.value);
      status.textContent = 'Invitation link copied. Paste it into a new tab or share it with your test player.';
    } catch (_) { /* The selected link and visible manual instructions remain available. */ }
  };
  $('openEntries').onclick = () => action(async () => {
    if (!ownedGroup || $('openEntries').hidden || !ownedGroup.state.course || !ownedGroup.state.date) throw new Error('Reload your saved competition first.');
    const group = ownedGroup;
    ownedGroup = null; $('inviteSection').hidden = true; $('competitionForm').hidden = true;
    try {
      await request('/rest/v1/rpc/iig_save_owned_group', {p_pin:group.group_pin,p_revision:group.revision,p_state:{...group.state,roundOpen:true}},true);
      await checkGroup();
      message('Test entries are open. Copy your invitation link below.');
    } catch (error) { throw new Error(error.message + ' Reload saved competition before trying again.'); }
  });
  async function loadPlayer() {
    playerGroup = null; $('scoreForm').hidden = true; $('playerResult').hidden = true; $('joinForm').hidden = true;
    let data;
    try { data = await request('/rest/v1/rpc/iig_get_player_group',{p_pin:invitePin},true); }
    catch (error) {
      if (error.code === '42501' && error.message === 'Group membership required') {
        $('joinForm').hidden = false; message('Email verified. Enter your name and handicap to join.'); return;
      }
      throw error;
    }
    if (!data || !data.state || !Array.isArray(data.state.players) || !Number.isSafeInteger(data.revision)) throw new Error('Unable to read the group. Reload to try again.');
    const me = data.state.players.find(p => p.id === data.player_id);
    if (!me) throw new Error('Your player record is unavailable. Contact your organiser.');
    playerGroup = data;
    $('playerResult').hidden = false;
    $('playerTitle').textContent = data.state.groupName || 'Your test group';
    $('playerCompetition').textContent = (data.state.course || 'Course to be confirmed') + ' · ' + (data.state.date || '') + ' · ' + (data.state.pointsCompetition === 'net' ? 'Net' : 'Stableford');
    $('attendanceStatus').textContent = me.name + (me.playingThisRound ? ': you’re marked as playing.' : ': you’re not marked as playing.');
    const closed = data.state.roundOpen !== true || data.state.players.some(p => p.scoreSubmitted === true || p.stableford != null || p.netScore != null);
    $('attend').hidden = closed || me.playingThisRound === true;
    $('withdraw').hidden = closed || me.playingThisRound !== true;
    $('playerList').textContent = 'Playing: ' + (data.state.players.filter(p => p.playingThisRound).map(p => p.name).join(', ') || 'Nobody yet');
    const format = data.state.pointsCompetition;
    const field = format === 'net' ? 'netScore' : 'stableford';
    const submitted = me.scoreSubmitted === true || me.stableford != null || me.netScore != null;
    $('scoreSection').hidden = !['stableford','net'].includes(format);
    $('scoreForm').hidden = submitted || !me.playingThisRound || data.state.roundOpen !== true;
    $('scoreLabel').textContent = format === 'net' ? 'Your final Net score' : 'Your final Stableford points';
    $('finalScore').maxLength = format === 'net' ? 3 : 2;
    $('finalScore').pattern = format === 'net' ? '[0-9]{1,3}' : '[0-9]{1,2}';
    lastValidScore = '';
    $('finalScore').value = '';
    $('scoreStatus').textContent = submitted ? 'Your recorded total: ' + (me[field] == null ? 'Result recorded' : me[field])
      : data.state.roundOpen !== true ? 'Scoring is closed.' : !me.playingThisRound ? 'Mark yourself as playing before submitting a score.' : 'Ready for your final total.';
    const scores = data.state.players.filter(p => p[field] != null).slice().sort((a,b) => format === 'net' ? a[field]-b[field] : b[field]-a[field]);
    $('scoreList').textContent = scores.map(p => p.name + ': ' + p[field]).join(' · ') || 'No scores submitted yet.';
    message(closed ? 'Attendance changes are closed.' : 'Your test group is loaded.');
  }
  $('reloadPlayer').onclick = () => action(loadPlayer);
  $('joinForm').onsubmit = event => { event.preventDefault(); action(async () => {
    const name = $('playerName').value.trim(), raw = $('handicap').value.trim(), handicap = Number(raw);
    if (!name || name.length > 80 || !/^[-]?[0-9]{1,2}(?:\.[0-9])?$/.test(raw) || !Number.isFinite(handicap) || handicap < -10 || handicap > 60 || Math.abs(handicap * 10 - Math.round(handicap * 10)) > 1e-8) throw new Error('Enter your name and a handicap from -10 to 60, with up to one decimal place.');
    await request('/rest/v1/rpc/iig_join_owned_group',{p_pin:invitePin,p_invite:inviteToken,p_name:name,p_handicap:handicap},true);
    await loadPlayer();
  }); };
  async function attendance(attending) {
    if (!playerGroup) throw new Error('Reload your group before changing attendance.');
    const revision = playerGroup.revision;
    playerGroup = null; $('attend').hidden = true; $('withdraw').hidden = true;
    try {
      await request('/rest/v1/rpc/iig_set_my_attendance',{p_pin:invitePin,p_attending:attending,p_revision:revision},true);
      await loadPlayer();
    } catch (error) { throw new Error(error.message + ' Reload group to check your attendance before trying again.'); }
  }
  $('finalScore').oninput = () => {
    const input = $('finalScore');
    const valid = playerGroup?.state.pointsCompetition === 'net' ? /^[0-9]{0,3}$/ : /^[0-9]{0,2}$/;
    if (valid.test(input.value)) lastValidScore = input.value;
    else input.value = lastValidScore;
  };
  $('scoreForm').onsubmit = event => { event.preventDefault(); action(async () => {
    if (!playerGroup || $('scoreForm').hidden) throw new Error('Reload group before submitting your score.');
    const raw = $('finalScore').value.trim(), score = Number(raw), format = playerGroup.state.pointsCompetition;
    if (!/^\d{1,3}$/.test(raw) || !Number.isInteger(score) || score < 0 || score > (format === 'net' ? 999 : 99)) throw new Error(format === 'net' ? 'Enter a whole Net score from 0 to 999.' : 'Enter whole Stableford points from 0 to 99.');
    if (!window.confirm('Submit ' + score + (format === 'net' ? ' Net' : ' Stableford points') + '? Check this is your final total.')) { message('Score not submitted. You can change it below.'); return; }
    const revision = playerGroup.revision;
    playerGroup = null; $('scoreForm').hidden = true; $('attend').hidden = true; $('withdraw').hidden = true;
    try {
      await request('/rest/v1/rpc/iig_submit_my_score',{p_pin:invitePin,p_score:score,p_format:format,p_revision:revision},true);
      await loadPlayer();
      message('Final score saved and checked.');
    } catch (error) {
      if (error.code === 'PGRST202') throw new Error('Score entry needs the test database update. Your score has not been submitted.');
      throw new Error(error.message + ' Reload group to check whether your score was saved before trying again.');
    }
  }); };
  $('attend').onclick = () => action(() => attendance(true));
  $('withdraw').onclick = () => action(() => attendance(false));
  $('signout').onclick = () => action(async () => {
    try { if (session) await request('/auth/v1/logout', {}, true); }
    catch (_) { /* Local credentials are always discarded. */ }
    finally { session = null; location.reload(); }
  });
  $('emailForm').hidden = false;
  message('Start by verifying your email address.');
})();
