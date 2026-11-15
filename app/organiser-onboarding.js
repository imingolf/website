/* First-time organiser presentation. Existing verified-account RPCs remain authoritative. */
(() => {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const validGroup = group => /^\d{4}$/.test(group?.group_pin || '') &&
    Number.isSafeInteger(group.revision) && Array.isArray(group.state?.players) && Array.isArray(group.state?.history);
  window.IIGOrganiserOnboarding = {
    create({root, account, request, run, openGroup}) {
      const $ = id => document.getElementById(id);
      const panel = document.createElement('section');
      panel.id = 'organiserOnboarding'; panel.hidden = true;
      panel.setAttribute('aria-label', 'Set up your golf group');
      root.append(panel);
      const steps = document.createElement('ol');
      steps.className = 'onboarding-steps'; steps.setAttribute('aria-label', 'Setup progress'); steps.hidden = true;
      for (const label of ['Your group', 'Invite', 'Payments', 'Ready']) {
        const item = document.createElement('li'); item.textContent = label; steps.append(item);
      }
      $('welcomeStartTitle').before(steps);
      let current = null, epoch = 0, opening = false, memory = null;
      const key = () => account()?.user?.id ? 'iig-organiser-setup-v1-' + account().user.id : null;
      function marker() {
        if (memory?.owner === account()?.user?.id) return memory;
        try { return JSON.parse(sessionStorage.getItem(key()) || 'null'); } catch (_) { return null; }
      }
      function remember(pin, step) {
        memory = {owner: account()?.user?.id, pin, step};
        try { if (key()) sessionStorage.setItem(key(), JSON.stringify(memory)); } catch (_) {}
      }
      function forget() { try { if (key()) sessionStorage.removeItem(key()); } catch (_) {} memory = null; }
      function chrome(step, title, subtitle) {
        steps.hidden = false;
        [...steps.children].forEach((item, index) => {
          item.classList.toggle('done', index + 1 < step);
          if (index + 1 === step) item.setAttribute('aria-current', 'step'); else item.removeAttribute('aria-current');
        });
        $('welcomeStartTitle').textContent = title;
        $('welcomeStartTitle').nextElementSibling.textContent = subtitle;
        $('regProgress').textContent = 'Step ' + step + ' of 4';
        root.classList.add('onboarding-active');
        root.classList.toggle('onboarding-after-create', step > 1);
      }
      function focusTitle() { $('welcomeStartTitle').focus({preventScroll: true}); $('setupOverlay').scrollTop = 0; }
      function note(text) { const node = $('onboardingMessage'); if (node) node.textContent = text; }
      function captured() { return {epoch, owner: account()?.user?.id, pin: current?.group_pin}; }
      function still(ctx) { return ctx.epoch === epoch && ctx.owner === account()?.user?.id && ctx.pin === current?.group_pin; }
      async function fresh(ctx) {
        const group = await request('/rest/v1/rpc/iig_read_owned_entry_group', {p_pin:ctx.pin}, true);
        if (!still(ctx)) throw Error('Your account changed. Reopen your group.');
        if (!validGroup(group) || group.group_pin !== ctx.pin) throw Error('Your group changed. Reopen your group before continuing.');
        return group;
      }
      function render(step, focus = true) {
        if (!current || opening) return;
        remember(current.group_pin, step);
        panel.hidden = false;
        $('regGroupForm').hidden = true; $('regCreated').hidden = true;
        const headings = {
          2: ['Invite your friends', 'Your group is ready. Get your friends together.'],
          3: ['Set up payments', 'Optional — you can add this later in Group Admin.'],
          4: ['You’re ready to go', 'Your group is set up. Time to get playing.']
        };
        chrome(step, ...headings[step]);
        panel.innerHTML = '<div class="onboarding-group"><span id="onboardingGroupName"></span><span>Group PIN <b id="onboardingPin"></b></span><p class="muted" id="onboardingPinHelp">Share this PIN with everyone in your group. They use it to open your group and sign in with their own email.</p></div><div id="onboardingContent"></div><p id="onboardingMessage" role="status" aria-live="polite"></p>';
        $('onboardingGroupName').textContent = current.state.groupName || 'Your golf group';
        $('onboardingPin').textContent = current.group_pin;
        const content = $('onboardingContent');
        if (step === 2) {
          content.innerHTML = '<p>Share an invitation so friends can join on iPhone, Android or in their browser.</p><button id="onboardingInvite" type="button" class="primary full">↗ Invite friends</button><div id="onboardingShareOptions" hidden><button id="onboardingCopy" type="button" class="secondary full">Copy invitation</button><label for="onboardingInvitation" hidden id="onboardingInvitationLabel">Invitation to copy</label><textarea id="onboardingInvitation" readonly rows="6" hidden></textarea></div><button id="onboardingInviteNext" type="button" class="secondary full" hidden>Continue</button><button id="onboardingInviteLater" type="button" class="onboarding-later full">I’ll do this later</button>';
          let invitation = '';
          async function copyInvitation() {
            try { if (!navigator.clipboard?.writeText) throw Error(); await navigator.clipboard.writeText(invitation); note('Invitation copied. Paste it into your group chat.'); }
            catch (_) { $('onboardingInvitation').value = invitation; $('onboardingInvitation').hidden = false; $('onboardingInvitationLabel').hidden = false; $('onboardingInvitation').focus(); $('onboardingInvitation').select(); note('Select and copy the invitation below.'); }
          }
          $('onboardingInvite').onclick = () => run(async () => {
            const ctx = captured(), group = await fresh(ctx);
            if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(group.invite_token || '')) throw Error('Your invitation is unavailable. Try again or invite friends later.');
            const options = await request('/rest/v1/rpc/iig_get_player_join_options', {p_pin: group.group_pin}, true);
            if (!still(ctx)) return;
            if (options?.group_pin !== ctx.pin || typeof options.pin_join_enabled !== 'boolean') throw Error('Could not confirm your joining instructions. Try again.');
            const url = location.origin + '/app/#pin=' + encodeURIComponent(ctx.pin) + '&invite=' + encodeURIComponent(group.invite_token);
            invitation = '⛳ Join ' + (group.state.groupName || 'our golf group') + ' on I’m In Golf.\n\n' + url + '\n\nGroup PIN: ' + ctx.pin + (options.pin_join_enabled ? '' : ' (use the invitation link to join)') + '\nUse your email, then add your name and handicap. Works on iPhone, Android and in your browser.';
            $('onboardingShareOptions').hidden = false; $('onboardingInviteNext').hidden = false;
            if (navigator.share) {
              try { await navigator.share({text: invitation}); if (still(ctx)) note('Invitation shared. You can invite more friends later.'); }
              catch (error) { if (still(ctx)) note(error.name === 'AbortError' ? 'You can share again, copy the invitation or continue.' : 'Sharing is unavailable. Use Copy invitation.'); }
            } else await copyInvitation();
          });
          $('onboardingCopy').onclick = () => run(copyInvitation);
          $('onboardingInviteNext').onclick = $('onboardingInviteLater').onclick = () => run(() => { if (!opening) render(3); });
        } else if (step === 3) {
          content.innerHTML = '<p id="onboardingPaymentWhy">Collecting entry fees? Add your payment link so players know where to pay you. They pay you directly, then confirm they’ve paid in the app.</p><form id="onboardingPaymentForm"><label for="onboardingProvider">Payment app</label><select id="onboardingProvider"></select><label for="onboardingPaymentLink">Your payment link</label><input id="onboardingPaymentLink" type="url" inputmode="url" autocomplete="url" placeholder="https://…" required><details class="onboarding-help"><summary>Where do I find my link?</summary><p id="onboardingPaymentHint"></p></details><p class="muted">I’m In Golf never receives or holds the money.</p><button type="submit" class="primary full">Save & continue</button></form><button id="onboardingPaymentLater" type="button" class="onboarding-later full">I’ll do this later</button>';
          const select = $('onboardingProvider'), input = $('onboardingPaymentLink');
          for (const [value, item] of Object.entries(PAYMENT_PROVIDERS)) {
            const option = document.createElement('option'); option.value = value; option.textContent = value === 'other' ? 'Other' : item.label; select.append(option);
          }
          select.value = current.state.paymentProvider || (current.state.paymentLink ? detectPaymentProvider(current.state.paymentLink) : 'monzo');
          input.value = current.state.paymentLink || '';
          function hint() { const item = PAYMENT_PROVIDERS[select.value] || PAYMENT_PROVIDERS.other; $('onboardingPaymentHint').textContent = item.hint; input.placeholder = item.placeholder; }
          select.onchange = hint; hint();
          $('onboardingPaymentForm').onsubmit = event => { event.preventDefault(); run(async () => {
            const link = normalisePaymentLink(input.value), provider = select.value;
            if (!link || new URL(link).username || new URL(link).password) throw Error('Paste your complete payment link beginning with https://');
            const detected = detectPaymentProvider(link);
            if (provider !== 'other' && detected !== 'other' && detected !== provider) throw Error('That looks like a ' + paymentProviderLabel(detected) + ' link. Check the payment app you selected.');
            const ctx = captured(), group = await fresh(ctx);
            // Same revision-checked settings operation as existing Group Admin.
            // Always start from a fresh full state; never construct a partial group.
            if (group.state.paymentLink && group.state.paymentLink !== current.state.paymentLink) {
              current = group; render(3, false); throw Error('Your payment link changed elsewhere. Check the saved link before continuing.');
            }
            if (group.state.paymentLink !== link || group.state.paymentProvider !== provider) {
              const state = clone(group.state); state.paymentLink = link; state.paymentProvider = provider; state.lastActivityAt = new Date().toISOString();
              const revision = await request('/rest/v1/rpc/iig_operate_owned_group', {p_pin: ctx.pin, p_operation: 'settings', p_state: state, p_revision: group.revision}, true);
              if (!still(ctx)) return;
              if (!Number.isSafeInteger(revision) || revision !== group.revision + 1) throw Error('Payment save could not be confirmed. Check your link and try again.');
              const saved = await fresh(ctx);
              if (saved.revision < revision || saved.state.paymentLink !== link || saved.state.paymentProvider !== provider) throw Error('Could not confirm your saved payment link. Try again.');
              current = saved;
            } else current = group;
            render(4);
          }); };
          $('onboardingPaymentLater').onclick = () => run(() => render(4));
        } else {
          content.innerHTML = '<div class="onboarding-ready" aria-hidden="true">✓</div><p>You can invite more friends and manage payments from your group whenever you’re ready.</p><button id="onboardingOpen" type="button" class="primary full">Open my group →</button>';
          $('onboardingOpen').onclick = () => run(async () => {
            const ctx = captured(); opening = true;
            try { const group = await openGroup(ctx.pin); if (!group || !still(ctx)) throw Error('Your group could not be opened. Try again.'); forget(); suspend(); }
            finally { opening = false; if (current) render(4, false); }
          });
        }
        if (focus) focusTitle();
      }
      function suspend() { epoch++; current = null; panel.hidden = true; steps.hidden = true; root.classList.remove('onboarding-active', 'onboarding-after-create'); }
      return {
        details(code = false) { if (current) return; chrome(1, code ? 'Check your email' : 'Start a golf group', code ? 'Enter your latest sign-in code to create your group.' : 'A few details, then we’ll verify your email.'); },
        suspend,
        begin(result) { if (!account()?.user?.id || !/^\d{4}$/.test(result?.group_pin || '')) return; remember(result.group_pin, 2); },
        resume(group) {
          const saved = marker();
          if (!saved || saved.owner !== account()?.user?.id || saved.pin !== group?.group_pin || ![2, 3, 4].includes(saved.step) || !validGroup(group)) return false;
          const entering = !current; current = group; if (!opening) render(saved.step, entering); return true;
        },
        get pendingPin() { const saved = marker(); return saved?.owner === account()?.user?.id && [2, 3, 4].includes(saved.step) ? saved.pin : null; },
        get pending() { const saved = marker(); return !!saved && saved.owner === account()?.user?.id && [2, 3, 4].includes(saved.step); }
      };
    }
  };
})();
