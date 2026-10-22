# Organiser access: staged backend, not ready for production

## What is implemented

`supabase/staging/organiser-access.sql` is an apply-once staging migration based on the schema and three RPC bodies supplied on 22 October 2026. It adds a private owner/member registry with RLS and no browser table grants. Only explicitly allowlisted, email-verified, non-anonymous, non-banned organiser accounts can create a group. Ownership comes from `auth.uid()`, never an email or owner ID supplied by the browser.

Creation serialises by account, supports retry with the same request UUID/name, caps this test stage at one group per organiser, and inserts group metadata plus ownership in one transaction. The existing group defaults and triggers are retained. A unique PIN index prevents collisions; no existing PIN is changed.

The new whole-state save requires the owning organiser, active group access and a matching revision. Player joining requires a signed identity and an unpredictable invite token. The sole implemented player mutation is attendance for that identity, while entries are open. Player reads use explicit field projections to avoid exposing future admin fields. Scores, payments, trips and side games are intentionally unsupported until dedicated server actions are written.

For groups in the new owner registry, the two old state RPCs fail closed. Existing groups still use their original path. **This does not fix the known access weakness in existing groups.** Do not register an existing group as owned until its clients are migrated: old clients will stop opening it.

## Local evidence

Run `npm ci --prefix security-tests`, then `node security-tests/access.test.mjs` from the repository root. PGlite runs the migration and role-based calls against PostgreSQL with synthetic Supabase Auth and reconstructed group tables, using the supplied live access-status and notification function bodies. The suite currently passes 62 checks covering verification, tester allowlisting, banned accounts, idempotency, cross-group access, legacy bypass prevention for owned groups, stale revisions, member isolation, private field projection, suspended groups, defaults, trigger execution, unique PINs and unchanged legacy group behavior.

This is not hosted Supabase testing. The supplied notification functions are now exercised for competition creation, first-entry deduplication, reminder scheduling at 18:00 Europe/London, round-close cancellation, changed-course cancellation and disabled notifications. Tests do not validate JWT issuance, real multi-connection locking, actual delivery or native wrapper behavior. A system PostgreSQL installation was unavailable; PGlite was used instead. No production database calls or email sends were made.

## Hosted test environment needed next

Use a separate Supabase development project or database branch. Do not run this SQL on production project `kzzzputsqxdntfqpprnz`. Export schema only, not player data; inspect the real notification functions and other SECURITY DEFINER functions before applying to the test environment. Do not use the obsolete app/supabase-setup.sql (it contains deletion/demo data).

Keep registration closed. Only a trusted database operator may insert a verified test account UUID into `iig_private.setup_testers`. Do not give browser roles table access. Use a separate publishable key in the development client; never embed service-role credentials. Configure staging SMTP and exact callback destinations before sending test mail. The production Site URL has already been set to https://imingolf.co.uk/app/ but no organiser callback is implemented there yet.

The proposed player identity uses Supabase anonymous sign-in (an internal device account, no player email/password screen). Anonymous sign-in remains OFF in production. Evaluate CAPTCHA, abuse limits, device recovery and identity switching in staging before enabling it anywhere. Possession of a group PIN alone must not authorise a player identity or organiser operation.

## Remaining release work

1. Build organiser sign-in/verification/recovery and account deletion; connect creation to the real first-competition flow. The existing setup preview remains a simulation.
2. Add explicit endpoints and client adapters for all player mutations, including scores, payment declarations, trip actions and side games. No fallback to whole-state player writes. Add validation of round identity and replay-safe transitions.
3. Review every other RPC, notification endpoint and Owner Dashboard operation for access to protected groups and revision conflicts. Ensure private metadata cannot escape through alternate routes.
4. Test real JWTs, callbacks, notification triggers, rate limits, PIN collision retries, concurrent organisers/players, suspended/expired access, recovery and deletion. Confirm actual entitlements; the trial defaults are preserved, not a new pricing promise.
5. Prepare explicit organiser ownership assignment and rollback procedures for existing groups, then test 1010/1260 equivalents with synthetic data. Never infer ownership from a publicly readable Admin PIN. Final rollout must close the legacy access path for migrated groups and eventually remove it.
6. Test on physical iPhone and a new-person walkthrough before enabling public registration or merging as finished onboarding.

No live migration, account creation, invitation or public release is part of this change.

## Empty test project setup (22 October update)

The owner created **Im In Golf Test**, distinct from the production project, with Data API enabled, automatic table exposure disabled and automatic RLS enabled. The empty-project installation script is `supabase/staging/setup-test-project.sql`. It combines the reconstructed three-table baseline, supplied access/notification rules and staged access migration in one transaction. It refuses to run if any target table or the private schema already exists; do not remove that guard to rerun it. It installs no notification sender, subscriptions, scheduled jobs or emails and creates no groups or Auth accounts. It does not recreate the whole production database or migrate existing data.

`node security-tests/setup-bundle.test.mjs` verifies the complete deliverable installs on an empty PostgreSQL database, enables private-table RLS, creates no groups/events and refuses reapplication. `node security-tests/access.test.mjs` passes 62 checks. Production is unchanged. The owner ran the bundle successfully and reported 'Test database setup complete, 0 groups'. Do not rerun it.

For the owner: switch the Supabase project selector to **Im In Golf Test**, open SQL Editor → New query, paste the complete setup-test-project.sql and run once. Expected final result: **Test database setup complete**, **groups = 0**. A SQL Editor warning about privilege revocation is expected because the script explicitly restricts table/function access. If an error occurs, share the error text; do not rerun individual fragments.


## Organiser test page (22 October)

`app/organiser-test.html` and `app/organiser-test.js` provide an isolated email OTP and group-creation client for `https://nyavvwrsrxqfyhiygkgw.supabase.co`. The owner supplied the exact URL and publishable key; Auth settings returned HTTP 200 with email enabled and confirmation required. The owner configured staging SMTP and both OTP email templates. The owner subsequently received an OTP, verified their email, observed the registration gate, allowlisted their verified account and created test group 5021. A later screenshot showed the same group after the requested return-login check; the sign-out itself was not directly observed.

The page operates only on deploy-preview-6--super-quokka-51747d.netlify.app or localhost. This hostname check prevents accidental live use; server ownership and the tester allowlist enforce security. No production config is imported. Credentials are held in memory only; reload requires a new code. There is no automatic refresh or cross-tab login. Only retry metadata is stored in sessionStorage. The page rechecks the owned group before creation and reuses a request UUID on retry. It renders server text with textContent.

Run `node tests/organiser-test.cjs` from the repo root for mocked browser/API behavior tests (no emails): host restriction, expired OTP, verification, bearer-authenticated RPC, allowlist denial, retry reuse, existing-group reconciliation and staging-only requests. These are not real-browser, SMTP or hosted JWT tests.

Manual next step: save a first-competition draft, then reload it and confirm the same course, date and format. No invitation or live gameplay link is offered. Existing live-group security weaknesses and other release blockers above remain.

## First competition draft

The test organiser page now supports course, date and Stableford/Net selection for an empty, closed group with no history. It preserves all other state fields and saves through the authenticated owner RPC using the loaded revision. It reads back after save. Failed/uncertain writes disable editing until the user explicitly reloads; no stale whole-state write is automatically retried. These form restrictions are client guardrails, not new server validation. The owner RPC remains a broad owner-only API.

Entries stay closed; no invitations or push sending are implemented by this change. No database migration is required. Mocked client tests cover invalid dates, preserving other fields, successful readback, revision conflicts, failed readback and active-round blocking. Hosted draft saving and physical-device layout still need user testing.

## Invitation and attendance test

The owner confirmed that competition details persisted after reload. The organiser page now opens test entries through the owner/revision RPC and reveals a copyable invitation URL. Tokens are in the URL fragment (not the request path/query), with no external scripts and a no-referrer policy. The new player-test.html uses the same isolated client, email OTP, the invite-bound join RPC, projected member reads and the narrow attendance RPC. No anonymous Auth setting change is required for this test; email verification is a deliberate test-stage flow, not the final low-friction player experience. Sessions remain memory-only and reload requires another code. Returning with the same verified account resolves the same membership.

Player writes never use the owner whole-state save. Attendance conflicts and uncertain responses require a reload before another write. Owner opening preserves existing state and uses revision checks. Opening entries can create notification records via the installed trigger; this test project still has no notification sender. No message is sent by the copy-link button.

Mocked client checks cover invalid invitations, member lookup, handicap validation, joining, playing, withdrawal, stale attendance lockout, owner opening and invitation generation. The 62 PostgreSQL access checks also pass. Hosted player joining, returning identity, physical-device layout and attendance must now be tested manually. Production is unchanged; no migration or public release is included.

## Final-score stage and manual evidence

On 22 October the owner confirmed iPhone return sign-in restored Greg Aspinall and playing status; a second email joined as Greg Test 2. Both were visible, and withdrawing Test 2 left Greg Aspinall playing. This is user-observed hosted evidence, distinct from automated fixtures. The private preview access redirect initially lost the invitation fragment; reopening the full invitation after gaining preview access worked. Clipboard denial now leaves selected text and nearby manual-copy instructions; a direct invitation link is also available.

`supabase/staging/player-scores.sql` is a separate additive transaction to apply in Im In Golf Test only, after the initial setup. Do not rerun the initial setup. The hosted score RPC has NOT yet been installed by the assistant. It authorises the signed member, locks the owner revision, checks active access/open round/attendance/format, accepts integer totals (Stableford 0–99, Net 0–999), and writes only that member's relevant score plus scoreSubmitted. Already-recorded results are rejected; no player correction flow exists yet. A matching monotonic group revision prevents submissions from a stale round view. No hole-by-hole scores or payment changes.

The test player UI confirms the total, reads back after saving and lists submitted totals in score order without tie-breaking. Failed or uncertain saves require a reload. Database tests now pass 79 checks, including own-score isolation, zero and Net upper boundary, invalid totals, stale revisions, wrong format, non-attendees, closed groups, duplicate scores and suspended access. Mocked client tests cover limits, cancelled confirmation, submission/readback and stale-save lockout. Hosted score submission remains the next manual test. Production has not been changed.

## Self-service welcome and owner registration list — 22 October

PR 7 (email-request-only welcome) is closed: the required journey is self-service.
PR 6 now mounts email-code verification and group creation inside the original welcome
screen using `app/self-service.js`. It talks only to the isolated test project and only
runs on preview 6 / localhost. The original gameplay adapter remains unchanged.
New groups are NOT yet playable in the original gameplay screens; the confirmation
explicitly states this integration limit. The earlier organiser/player test pages remain.

Apply `supabase/staging/self-service-registration.sql` only to **Im In Golf Test**
(`nyavvwrsrxqfyhiygkgw`), after the installed baseline. It opens test self-service to
verified accounts (one group/account), preserves creation locking/idempotency and
trial defaults, and adds an authenticated, private platform-owner registrations RPC.
It does not reset groups. The known verified test account UUID supplied by Greg is
given platform-owner visibility. No email-address-only privilege elevation exists.

On preview 6, the existing `app/owner-dashboard.html` uses email sign-in and displays
these test registrations, including organiser name/email, creation date, trial and status.
This stage is read-only and refreshed manually, 100 groups/page. Legacy dashboard
management stays unchanged on other hosts. Only metadata for protected groups is
returned; state/invitation tokens are not exposed. Existing live groups do not appear
in the isolated test register. Once deployed to production later, the registry must
be integrated with the existing group-management views, not replace them.

Manual next check: run the incremental SQL in the test project; sign into the preview
welcome with a fresh email; create a group; sign into the preview owner dashboard
as Greg and confirm the exact group, name, email and trial. Test an ordinary organiser
is denied the owner view. Existing Greg account should retrieve group 5021, not create
another. Keep all production deployment blocked pending original-gameplay integration,
account deletion/recovery, abuse controls and full existing-group regression checks.

To close new test registration: `update iig_private.registration_settings set enabled=false;`
(the earlier tester allowlist still works). Revoke owner visibility by deleting its row
from `iig_private.platform_owners`. Do not delete customer/group records as rollback.

Validation for this increment: existing 79 PostgreSQL checks plus self-service/owner
register checks pass in PGlite. Existing organiser-client checks pass. A real-HTML DOM
test with mocked HTTP passes OTP, creation, failed readback/retry, escaping, owner
denial/list and sign-out clearing. `npm install --prefix tests` then
`node tests/self-service-dom.cjs` from repository root runs that DOM check.
`node tests/self-service.cjs` is an additional Playwright browser check; it has NOT
been executed here because the Chromium download failed. It uses mocked network,
not hosted Supabase. Physical-iPhone and real owner-register checks remain pending.

## Original organiser-screen adapter

Hosted registration has now been observed: Pam’s people, PIN 3520, appeared in the
private test owner register alongside 5021, with contact and 14-day trial metadata.

`secure-organiser.js` connects Open my group from the verified welcome to the original
organiser round/settings screens. It bypasses PIN-only connection/admin persistence;
all saves use iig_save_owned_group with the accepted revision. Serial writes, refresh
version checks, stale/uncertain-save blocking, rollback of optimistic display and
explicit reload protect the adapter from overwriting concurrent changes. Legacy RPCs
are denied for these sessions; no production client is reused. Sign-out clears access.
Original player identity/invites, native purchase/push and other specialised legacy
flows are NOT fully integrated. PIN changes, legacy invitations, player-view switching,
group renaming and outdated PIN help are hidden/blocked in this preview adapter.
The old test player/invitation pages remain available for that phase.

DOM integration executes the actual original app script and newRound save path with
mocked wizard choices/network. First-competition rendering, saving/reload, stale-write
block/recovery, legacy RPC denial and sign-out pass. No new SQL is needed for this
increment. Next physical check: sign in with the account that owns 3520; Open my group;
Start First Competition → Points Game → Stableford; save course/date, then Reload
saved group to verify. Keep draft: no production merge/release.

## Original player screens and invitations

Greg confirmed original-layout competition save/reload on group 3520. The next
increment adds Invite players to the organiser banner. It exposes the stored invite
UUID as an /app/#pin=…&invite=… link with a copy fallback and open-link option.
The original welcome verifies email, collects a new member name/handicap, and opens
existing members without making a duplicate. The player adapter renders original
Round/Scores screens for Points Games only. Attendance/withdrawal and final score use
only narrow authenticated player RPCs. No player state-replacement endpoint is used;
legacy db.rpc and whole-state save are blocked. Other feature controls are hidden
until their data and endpoints are integrated. Returning players use their complete
invitation link and email; plain PIN entry is still the legacy path in this preview.

Actual HTML/script DOM checks with mocked HTTP cover organiser invitation generation,
invalid invitation rejection, email join flow, membership lookup, actual round/score
rendering, attendance/withdrawal, score digit limits, other-player denial, stale revision
lockout/reload and sign-out. Existing PostgreSQL tests pass. Hosted invitation/phone
check remains. No new SQL required. Still no production release.

## Finish Round integration correction

Hosted tests confirmed Greg Steel joined 3520, entered, and submitted 36 Stableford
points visible on both devices. Finish Round exposed a legacy get_group_state call
that the secure adapter correctly denied. The normal Points Game finish path now
loads the latest verified-owned snapshot and revision before computing results,
retains revision-checked save, and rejects already-closed rounds. It does not enable
legacy RPC access. Manual reload is blocked during finishing to avoid snapshot races.
The actual finishRound flow passes DOM tests for latest-score loading, failed-save
preservation, one history record, 36-point result, 10 league points, one win and
repeat-finish rejection. Hosted close/history check remains next. No SQL required.
