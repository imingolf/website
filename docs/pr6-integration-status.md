# PR #6 integration status — 22 October 2026

**Keep Draft. The full requested integration is not complete and production approval is not recommended.**

Work continues on `improve-first-visit-welcome`, from PR head `084e7f214b4d78c74fe41f528c1716bcf0bd67cd`. There is no replacement implementation or competing PR.

## Implemented in this increment

- Protected organisers can finish original Money Games and individual, Better Ball and Pairs Aggregate Trip rounds through the authenticated owner adapter. Completion loads the latest authorised snapshot and retains revision conflict checks. Tests exercise original scoring, split prizes, saved results, Trip progression and failed-save recovery. Completed trips cannot be finished twice.
- Team-round completion checks the save result before displaying success. This also corrects the original application's false-success path.
- Returning protected players can enter a group PIN and verify their email. Existing membership is required; a PIN alone cannot create membership. New players still need an invitation.
- Protected Points Game players can open League, player statistics and previous Points Game results in the original screens. The new SQL explicitly projects public golf fields in current players and nested historical results, excluding contact details, arbitrary future fields and payment details.
- Player action filtering no longer hides welcome controls globally. Navigation visibility is restored on sign-out so a subsequent organiser login retains Admin navigation.
- Sign-out clears loaded player/history/result state. Session expiry closes the protected application and private register, including when idle. Responses arriving after expiry cannot reopen it.
- A failed private-register refresh clears customer rows and hides the dashboard, including when the platform-owner permission has been revoked.
- Incremental SQL rechecks verified, non-anonymous, non-banned identities for player read/join/attendance/scoring. Attendance and individual scoring explicitly reject Money and active Trip games rather than changing the wrong game state.

## Database change — prepared, not applied

`supabase/staging/integration-hardening.sql` is incremental staging SQL, after the existing baseline, `player-scores.sql` and `self-service-registration.sql`. It replaces functions only; it does not rewrite groups, memberships or history. Do not rerun the empty-project baseline on the populated test project. Do not apply this file to production.

The hosted test project is `nyavvwrsrxqfyhiygkgw`. This session's configured Supabase host is the different production project; no hosted database requests or SQL were run. New member checks and historical projection therefore remain unverified on hosted Supabase and are not yet installed there. The client intentionally retains the existing preview/local host gate and production configuration remains unchanged.

## Automated verification

Install test dependencies with `npm ci --prefix tests` and `npm ci --prefix security-tests`. Run `npm --prefix tests test` for eight offline suites:

- All app inline scripts and the integration modules parse.
- Existing synchronisation, scoring, split-prize, league and Trip regressions.
- Original organiser and player screens with mocked requests, including Money/Trip completion, conflict recovery, returning membership, leagues/history and cleared state.
- Self-service registration, retry reconciliation, owner denial, revoked dashboard visibility and idle expiry.
- PostgreSQL via PGlite: existing 79 baseline checks, existing self-service/owner-register checks, and new incremental hardening checks. The increment is applied twice to synthetic data and verified to leave every group/history JSON unchanged, including synthetic 1010/1260. Tests cover banned and unverified members, private historical fields, and unsupported game mutation denial.
- Empty setup bundle safety and refusal to rerun on a populated schema.

Rendered Chromium checks use mocked HTTP and a mobile viewport, plus desktop dashboard rendering: OTP, registration, uncertain readback/retry, return login, text escaping, mobile width, owner denial, dashboard rendering, player return by PIN, League/previous result navigation and cleared state on sign-out. Run `TEST_BROWSER=/usr/bin/chromium npm --prefix tests test` where Chromium is installed. Respect the actual OTP resend cooldown in the test clock.

These checks do not establish real email delivery, JWT enforcement on hosted Supabase, simultaneous database connections or iPhone/native behavior.

## Remaining implementation and approval gates

| Gate | What remains |
| --- | --- |
| Full protected player gameplay | Money entry/payment and scoring, Trip roster/team scoring, side games, settlements, payouts and native/push interactions need dedicated identity-bound RPCs and complete safe read projections. The deny-by-default adapter remains; these paths must not fall back to production/legacy whole-state writes. |
| Historical coverage | Protected player history in this increment covers Points Games only. Full Money history, payout views and Trip archives still need safe projections. Organisers retain their complete authorised state. |
| Account lifecycle | Verified-email return login is covered; account deletion, changed/lost-email recovery and organiser ownership transfer need a privileged backend and a retention policy that preserves historical results. |
| Entitlements and abuse controls | Confirm actual Free/Plus/trial rules with the live schema/business configuration. Verify server-side limits, OTP rate limits, CAPTCHA/bot controls and signup configuration on staging. Client cooldown alone is insufficient. |
| Other RPC audit | The reconstructed test schema does not contain every production RPC, notification/native function, grant or RLS policy. Obtain and audit their actual definitions privately. The known legacy PIN/shared-state authorization remains unchanged and is not considered secure for public self-service. |
| Existing groups and production rollout | Prepare a reviewed, additive migration/backfill and rollback against the actual live schema. Establish organiser identity without guessing ownership; preserve PINs 1010/1260 and every historical result. No production migration is included or authorised. |
| Hosted and physical regression | Apply only the incremental test SQL after separate staging review, then verify hosted JWT/role denial, real concurrent writes, expiry/offline recovery, all original Admin controls and complete iPhone journeys. |

The user reports that group 3520 already passed physical iPhone joining, scoring, finishing and previous-results checks. Those results are retained as prior evidence; this session did not alter that group or repeat those hosted tests. After a reviewed staging update, repeat those checks and additionally verify returning login, League/history, session expiry, revoked-owner denial, Money/Trip organiser completion, failed saves and legacy-group regressions.

No production data changes, production SQL, main merge, live deployment or App Store release were performed. Group 1010, group 1260 and historical live data were not accessed or modified by these tests.
