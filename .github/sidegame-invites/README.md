# Side Game invite delivery — prepared for pilot review

## Scope

- Pending-invite notice opens the existing Accept/Decline screen.
- Outgoing Share invite uses the native share sheet (choose WhatsApp), with copy fallback.
- Separate **Side Game invites** switch, default **Off**. Competition preference is preserved.
- Shared phone registration remains active while either available category is On.
- A new pending challenge captures only its currently linked recipient account. No backfill.
- One provider attempt on the recipient's most recently registered eligible phone. A failed or ambiguous provider response is not retried automatically. The in-app invitation remains available.
- Tap uses the existing Build 7 group-opening bridge; the player then taps View invite. No native files or Apple submission changes.
- Delivery runs on the existing sender schedule, so it is not guaranteed immediate.

## Verification

Database checks use synthetic accounts and groups in PGlite, never LIVE writes. Recipient binding, account reassignment, saved Off, accepted/expired invitations, session revocation, deduplication and API permissions are covered. Client tests cover independent switches and the existing competition reminder contract; sender tests mock Firebase.

Run the existing `.github/native-reminders/tests/build-fixture.py` fixture generator and copy its generated `fixture.sql` into this directory's `tests/fixture.sql`, then `npm ci` and `npm test`. The fixture is generated schema only and excluded from source control.

Run root `node tests/sidegame-invites.cjs` and `node tests/sync-regression.cjs` as well.

A separate `tests/browser.cjs` mobile smoke test uses Playwright and a local Chromium (`CHROMIUM_PATH`). It could not run in the preparation shell: Chromium's socket creation was blocked by the environment. This is **not** a browser pass or a real-iPhone pass.

## Deployment order and outstanding acceptance

1. Confirm latest LIVE and PR heads. Apply `supabase/migrations/20261117090927_side_game_invites.sql` only after deployment approval. It is dormant: rollout false, empty pilot list, preferences default Off. Existing preferences, golf records and competition gates are not modified.
2. Deploy the existing sender entrypoint with its added `side-invites.mjs` module, preserving all current files/configuration and JWT setting. Keep `IIG_SIDEGAME_INVITES_ENABLED` absent/false; do not enable competition sending.
3. Publish the three changed web assets as part of the **full current production site**. Production is the manual privacy deployment `6afb8c72e9b167d0ef9f9f9f`; do not overwrite its privacy notice with the older repository version. Check current production again at deployment time.
4. Add only the agreed pilot recipient to the Side Game rollout. That recipient explicitly turns Side Game invites On in the installed Build 7 app and verifies readiness. No account preference is enabled on their behalf.
5. With explicit authorization for one controlled invite, enable the Side Game worker for that pilot, create a fresh invitation, confirm arrival and opening the group, then verify Accept/Decline and Off. Use an agreed test group/account; do not fabricate challenges from another real player or alter 10ers In competition data.
6. Broader rollout remains pending the real-device check and review. Existing iOS versions without the installed bridge can still use the visible invite and sharing features, but native push compatibility must not be assumed.

## Current state

Code prepared; automated checks passed. Not deployed, no notification sent, no settings activated, no Apple action. Visual and real-iPhone verification remain pending.
