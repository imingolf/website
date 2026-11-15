/* REVIEW HARNESS ONLY. Never include in a LIVE release. No network or real accounts. */
(() => {
  'use strict';
  const key = 'iig-isolated-preview-v1';
  const clone = x => x == null ? x : JSON.parse(JSON.stringify(x));
  let db; try { db = JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) {}
  db ||= {session: null, group: null};
  const persist = () => localStorage.setItem(key, JSON.stringify(db));
  const user = email => ({id: '11111111-1111-4111-8111-111111111111', email, email_confirmed_at: '2026-11-14T10:00:00Z', is_anonymous: false});
  const newSession = email => ({access_token: 'preview-only-access', refresh_token: 'preview-only-refresh', user: user(email), expires_at: Math.floor(Date.now()/1000) + 3600});
  const calls = []; let failNext = null;
  const error = (message, code = '42501', status = 403) => ({status, data: {message, code}});
  function rpc(path, body, authenticated) {
    if (path === '/auth/v1/otp') { db.email = body.email; persist(); return {data: {}}; }
    if (path === '/auth/v1/verify') {
      if (body.token !== '123456') return error('Code expired', 'otp_expired', 403);
      db.session = newSession(body.email); persist(); return {data: clone(db.session)};
    }
    if (path === '/auth/v1/token?grant_type=password') { db.session = newSession(body.email); persist(); return {data: clone(db.session)}; }
    if (path === '/rest/v1/rpc/get_group_access_status') return {data: [{group_pin: body.p_pin, group_name: db.group?.state.groupName || 'Preview Golfers', access_allowed: true, plan_type: 'complimentary'}]};
    if (path === '/rest/v1/rpc/iig_get_player_join_options') return {data: {group_pin: body.p_pin, group_name: db.group?.state.groupName || 'Preview Golfers', pin_join_enabled: true}};
    if (!authenticated || !db.session) return error('Verified organiser sign-in required');
    if (path === '/rest/v1/rpc/iig_read_entry_group') {
      if (!body.p_pin) {if(!db.group)return {data:null};const owned=clone(db.group);delete owned.player_id;delete owned.group_id;return {data:owned};}
      if (db.group?.player_id && body.p_pin === db.group.group_pin) return {data: {player_id:db.group.player_id,revision:db.group.revision,state:clone(db.group.state),entry:clone(db.group.entry),plan_type:'complimentary'}};
      return error('Group membership required');
    }
    if (path === '/rest/v1/rpc/iig_create_owned_playing_group') {
      if (!Number.isFinite(body.p_handicap) || body.p_handicap < -10 || body.p_handicap > 60 || Math.round(body.p_handicap*10)!==body.p_handicap*10) return error('Invalid handicap','22023',400);
      if (!db.group) db.group = {group_pin: '4827', group_id: 1, revision: 0, invite_token: '22222222-2222-4222-8222-222222222222', entry: {open: false, closed: false, entrantIds: null}, state: {groupName: body.p_name, course: '', date: '', stake: 0, gameType: 'money', roundOpen: false, pointsCompetition: 'stableford', pointsValue: 10, players: [], history: []}};
      if (!db.group.player_id) {db.group.player_id='preview-organiser-player';db.group.state.players.push({id:db.group.player_id,name:body.p_organiser_name,handicap:body.p_handicap,paid:false,stableford:null,netScore:null,playingThisRound:false});db.group.revision++;}
      persist(); return {data: {group_pin: db.group.group_pin, group_id: 1,player_id:db.group.player_id}};
    }
    if (path === '/rest/v1/rpc/iig_operate_owned_group') {
      if (body.p_pin !== db.group?.group_pin || body.p_revision !== db.group.revision) return error('Revision changed. Reload your group.', 'P0001', 409);
      if (body.p_operation !== 'settings') return error('Only payment settings are enabled in this preview.');
      db.group.state = clone(body.p_state); db.group.revision++; persist(); return {data: db.group.revision};
    }
    if (path === '/rest/v1/rpc/iig_join_release_group') {
      if (!db.group || db.group.group_pin !== body.p_pin) return error('Use the preview group PIN 4827.');
      const player = {id: 'preview-player', name: body.p_name, handicap: body.p_handicap, paid: false, stableford: null, netScore: null, wins: 0, leaguePoints: 0, netWinnings: 0};
      db.group.player_id = player.id; db.group.state.players.push(player); persist(); return {data: true};
    }
    return error('This action is outside the organiser setup preview. No data was changed.', 'PREVIEW_ONLY', 400);
  }
  window.fetch = async (url, options = {}) => {
    const parsed = new URL(String(url), location.href);
    if (parsed.hostname !== 'nyavvwrsrxqfyhiygkgw.supabase.co') throw new TypeError('External requests are disabled in this private preview.');
    const path = parsed.pathname + parsed.search, body = JSON.parse(options.body || '{}');
    calls.push({path, body: clone(body)});
    if (failNext?.path === path) { const failure = failNext; failNext = null; return new Response(JSON.stringify({message: failure.message || 'Preview connection failed', code: 'P0001'}), {status: failure.status || 503, headers: {'Content-Type': 'application/json'}}); }
    const reply = rpc(path, body, !!options.headers?.Authorization);
    return new Response(JSON.stringify(reply.data ?? null), {status: reply.status || 200, headers: {'Content-Type': 'application/json'}});
  };
  // Emulate only the SDK contract needed by the unchanged account-session module.
  window.supabase = {createClient() {
    let callback = () => {};
    return {auth: {
      onAuthStateChange(cb) { callback = cb; return {data: {subscription: {unsubscribe() {}}}}; },
      async getSession() { return {data: {session: clone(db.session)}, error: null}; },
      async getUser() { return {data: {user: clone(db.session?.user)}, error: db.session ? null : Error('No session')}; },
      async setSession() { callback('SIGNED_IN', clone(db.session)); return {data: {session: clone(db.session)}, error: null}; },
      async signOut() { db.session = null; persist(); callback('SIGNED_OUT', null); return {error: null}; },
      stopAutoRefresh() {}
    }, rpc: async () => ({data: null, error: {message: 'Legacy requests are disabled in this preview.'}})};
  }};
  // No share sheet, payment navigation, notification permission or live service workers.
  try { Object.defineProperty(navigator, 'share', {value: undefined, configurable: true}); } catch (_) {}
  window.open = () => null;
  document.addEventListener('click', event => { const link = event.target.closest('a[href]'); if (link && new URL(link.href).origin !== location.origin) event.preventDefault(); }, true);
  window.IIGPreview = {
    calls,
    get data() { return clone(db); },
    setGroup(group) { db.group = clone(group); persist(); },
    fail(path, message, status) { failNext = {path, message, status}; },
    expire() { if (db.session) db.session.expires_at = 1; persist(); },
    signOut() { db.session = null; persist(); }
  };
  document.addEventListener('DOMContentLoaded', () => {
    const bar = document.createElement('aside'); bar.id = 'privatePreviewBar';
    bar.innerHTML = '<span><strong>Private preview · test data</strong><br>No emails or payments. Use code <b>123456</b>.</span><button type="button">Start again</button>';
    document.body.prepend(bar);
    bar.querySelector('button').onclick = () => { localStorage.clear(); sessionStorage.clear(); location.replace('/app/'); };
    // The actual home/Join choices stay available; open setup initially for review.
    if (!location.hash && !db.group) window.iigStartGroup?.();
  });
})();
