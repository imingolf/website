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

`node security-tests/setup-bundle.test.mjs` verifies the complete deliverable installs on an empty PostgreSQL database, enables private-table RLS, creates no groups/events and refuses reapplication. `node security-tests/access.test.mjs` passes 62 checks. Production is unchanged. Hosted test installation still awaits the owner's SQL Editor run.

For the owner: switch the Supabase project selector to **Im In Golf Test**, open SQL Editor → New query, paste the complete setup-test-project.sql and run once. Expected final result: **Test database setup complete**, **groups = 0**. A SQL Editor warning about privilege revocation is expected because the script explicitly restricts table/function access. If an error occurs, share the error text; do not rerun individual fragments.
