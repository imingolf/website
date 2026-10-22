# PR #6 integration status — 22 October 2026

**Keep Draft. The prioritised protected gameplay and account-control source is implemented and tested locally. Full release approval remains blocked by hosted validation, native/push integration and the actual production security/migration audit.**

This increment continues `improve-first-visit-welcome` directly from `40bb11d`. It updates the existing application and PR #6 only. Supabase remains the authentication and database system.

## Implemented

- Protected Money players can explicitly declare their own payment after paying their organiser. This records a player declaration, not bank-verified receipt. It cannot mark another player paid. Returns from a payment app are checked against player, group, round, course, date, stake and age. Organisers retain their payment-status controls.
- The already-installed narrow protected RPCs remain in use for normal Points attendance/final scores, preserving the previously tested 3520 journey before incremental SQL is installed. This is an explicit existing route, never a fallback after a failed new action. New Money/Trip/Side Game/lifecycle features require the prepared incremental SQL.
- Individual Stableford/Net scores and Net No Return work in normal and Trip rounds. Server checks enforce participation, payment eligibility, format, score bounds, closed rounds and previously submitted results. Better Ball and Pairs Aggregate accept one final score only from a member of the configured pair, with payment checks for both partners.
- Original Side Game screens use narrow authenticated actions for creating challenges, accepting/declining, scores, settlement requests and receipt confirmation. Both players must confirm a challenge, including an agreement made in person. Results are computed from stored scores; settlement amounts are computed from stored debt, never accepted from the client. Scores cannot be silently overwritten. Dates use the server's Europe/London day.
- Current leaderboards, Money/Points leagues, previous rounds, Trip standings/archives and payout statuses use explicit recursive field projections. Private bank/contact fields, admin credentials, normal-round backups and other players' private Side Games are excluded. Only a named winner can submit a supported HTTPS payout link or request private bank transfer; organisers retain payout handling.
- Organiser score corrections now read the latest authorised snapshot and use revision-checked owner saves, with no legacy RPC fallback. Owner/player switching uses a verified account membership rather than claiming an existing player by name. Invitations work for open Money and Trip competitions as well as Points Games.
- New account controls support passwordless return login, secure email-change requests, two-party ownership transfer with fresh email sign-in and expiring acceptance codes, and explicitly confirmed account deletion. Ownership transfer rotates invitations and increments the revision. Confirmed email changes update the private owner register without rewriting golf history.
- Account deletion requires a fresh OTP session and refuses group/platform owners until ownership is transferred. A prepared Edge Function validates the user through Supabase Auth, obtains SQL authorisation and then deletes that exact Auth user with a server-held service role. Deletion disables account access first and is retryable after an Auth API failure. Shared golf players, names and historical results remain; Auth deletion removes identity mappings. The function is restricted to the test project in source.
- Free-plan roster and new Trip/Side Game restrictions are enforced server-side, matching the existing application's rules. Existing history and already-started Trip progress are retained. The exact hosted trial/entitlement configuration still needs verification.
- Inline identifiers now use JavaScript string encoding as well as HTML attribute escaping. Tests cover hostile identifiers. Payout provider recognition rejects lookalike domains and credential-bearing URLs while retaining the supported providers.
- Session expiry/sign-out clear loaded state and cancel pending dialogs. Late responses cannot reopen expired sessions. Private dashboard refresh failures clear customer rows. The prior registration, OTP and revision-conflict safeguards remain.
- The Apple verification source now requires a verified organiser and a matching StoreKit `appAccountToken` for protected groups and binds each original transaction to one group through a service-only atomic RPC. It rejects revoked receipts, cross-group receipt replay and production activation with sandbox receipts. Legacy groups retain their existing purchase entry. The website exposes `window.iigNativePurchase.confirm(transactionId, groupPin)` to perform authenticated verification without exposing a JWT to the native bridge. The wrapper must set the StoreKit purchase account token to `window.iigNativePurchase.accountToken` (the verified account UUID, never a JWT). The native wrapper must be connected and tested separately; its source is absent from this repository.

## Prepared database/backend changes — none applied or deployed

For the isolated test project `nyavvwrsrxqfyhiygkgw`, after its already installed baseline, `player-scores.sql` and `self-service-registration.sql`, review these incremental files in order:

1. `supabase/staging/integration-hardening.sql` — previous increment; function replacements only.
2. `supabase/staging/protected-gameplay.sql` — member action dispatcher, safe projections and protected-group limits.
3. `supabase/staging/account-lifecycle.sql` — private deletion/transfer tables, lifecycle RPCs, account checks and confirmed-email metadata sync.
4. `supabase/staging/subscription-security.sql` — private receipt bindings and service-only activation RPCs.

Then separately configure/test the prepared `account-delete` and changed `verify-apple-subscription` Edge Functions. The changed Apple verifier fails closed if its new authorisation RPCs are missing. **Do not deploy it ahead of the SQL.** Do not run any of these on production or rerun the empty-project baseline on populated staging. New migrations are transactional and intended for one application, not repeated baseline setup.

No existing group/state/history rows are rewritten during installation. The schema tests install the increment over synthetic legacy groups 1010/1260 and verify unchanged JSON. `security-audit.sql` is a read-only grant/policy/function inventory with no player data or function bodies.

The session has no staging SQL credentials and its enforced Supabase network allowlist names the production host, not staging. No hosted database or Auth mutations were attempted. No deployment or publishing tool was invoked.

## Automated verification

Install dependencies with `npm ci --prefix tests` and `npm ci --prefix security-tests`.

- `npm --prefix tests test`: twelve offline suites, including the existing regression suites, original HTML DOM integration, account UI, deletion handler, subscription authorisation and PostgreSQL tests via PGlite.
- `TEST_BROWSER=/usr/bin/chromium npm --prefix tests test`: thirteen suites including rendered Chromium. Browser requests are intercepted; no real email, bank, Apple or database requests occur.
- Existing 79 PostgreSQL baseline checks plus self-service/hardening checks pass. The new suite adds 51 counted gameplay/lifecycle/security assertions, including stale/cross-account access, pair eligibility, Side Game consent/results/debt, private views, Free limits, ownership transfer, deletion, receipt replay prevention and synthetic 1010/1260 history preservation.
- Chromium covers OTP, creation/readback failure/retry, returning login, mobile width, escaped content, owner denial/dashboard, previous results, own payment declaration, Trip pair scoring, Side Game challenge, account controls and sign-out.
- App inline scripts, protected modules and both Edge TypeScript entry points parse. The Edge handlers are tested with injected fake services. Node syntax checks do not establish Deno dependency/runtime compatibility.

## Final release blockers and manual checks

1. **Hosted staging:** review/apply only incremental test SQL; test actual PostgREST/JWT/RLS enforcement, revoked/banned identities, access expiry, rate limits, CAPTCHA/bot controls, the Free/Plus/trial settings and secure email change. Confirm JWT `amr` records the OTP method/time expected by sensitive-account RPCs. Secure Email Change must require both inbox confirmations.
2. **Lifecycle/Edge integration:** configure the test Edge Functions and allowed origin. Test successful deletion, retry after an Auth failure, stale sign-in rejection, owner/platform-owner deletion refusal, two-account transfer, revoked invitation and email change. Use disposable staging accounts/groups for deletion. Review the user-facing retention policy for shared historical names/results.
3. **Real concurrency:** use separate hosted connections for player/organiser writes, simultaneous pair submissions, duplicate Side Games, settlement confirmation, transfer versus deletion/registration, and subscription binding races. PGlite tests are sequential. Conflicts must fail without partial writes or automatic replay.
4. **Physical iPhone/native:** payment launch/return, suspension/reload/expired session, login on another device, Money/Points scoring and NR, each Trip format/day/progression/completion/normal-round restoration, Side Game challenge/score/settlement, leagues/history, invitation sharing, Admin corrections and account dialogs. Connect the native wrapper to the authenticated purchase callback and verify purchase/restore/sandbox behavior without a release. Native wrapper source and its identity handling are not available here.
5. **Push and remaining live RPCs:** actual hosted push-subscription/sender functions, notification/native RPC bodies, grants, policies and jobs are not in this repository. They must be inventoried and adapted/audited before protected-group notifications can be enabled. The protected adapters deliberately retain denial for unknown legacy RPCs. Existing legacy PIN/shared-state authorisation is unchanged and is not approved for public self-service rollout.
6. **Production migration/rollback:** obtain the real production schema privately and prepare an additive ownership/backfill and rollback plan preserving all PINs and historical data, especially 1010/1260. Do not infer ownership from names or a PIN. No production migration is included. Trial defaults and subscription webhook/refund/renewal operations also need hosted confirmation.

The user reports prior successful physical iPhone joining, scoring, finishing and previous-results checks for group 3520. That evidence is retained; this session neither changed that group nor repeated those hosted tests.

No production data changes, main merge, live website publishing/deployment or App Store release were performed. There is no competing branch or pull request. Full integration is not declared complete while the native/push and live-audit blockers above remain.
