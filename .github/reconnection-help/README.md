# Reconnection screen cleanup — 15 November 2026

When a verified account cannot open a PIN-only group, explain that the email is not linked and offer **Use a different email**. Confirm the existing SDK sign-out before returning to email verification; retain the chosen PIN/private invitation. Keep existing organiser reconnection and protected-group restrictions. Remove the old targeted diagnostic panel and its instrumentation.

Only `app/self-service.js` changes in the shipped app. Account-session SDK integration, backend RPCs, permissions, group/player records, scoring, payments and native app code are unchanged. No database migration or Apple submission.

## Validation

- `node --check app/self-service.js` and `git diff --check`: PASS.
- Browser integration: **28 checks PASS** against the actual app with a synthetic Auth/API transport and a network-blocking CSP. Covers failed and successful sign-out, cleared identity and email form, keyboard focus, PIN and invitation retention, refresh, incorrect/correct OTP, linked-player readback without a new join, ordinary sign-out, retained organiser reconnection, enabled PIN joining and private invitations.
- Layout overflow checks at 320, 390 and 768px: PASS.
- No LIVE emails, membership changes, payments or database writes during verification. Physical iPhone check is not claimed.

Reproduce: `python .github/reconnection-help/tests/build-browser.py /workspace/sites/imingolf-reconnection-qa-20261115`, then serve that isolated directory with the managed preview and open its root. The fixture uses only synthetic records; the known diagnostic-target email string reproduces the removed gate and never leaves the isolated app.

Release base: main `41380de5c09018b1945e5a6251ede0b342cc3d53`, production deploy `6af9e42282fca8a4429b3012`. Rollback is a code revert/previous deploy only; no data rollback is needed.
