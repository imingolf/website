# Canonical-row closed-entry candidate — DO NOT INSTALL

This is offline review code, NOT a Supabase migration or an authorised installation
package. It is deliberately outside supabase/migrations. Do not paste these files
into a database editor, execute them online or activate their central trigger.
The default PIN resolver raises PIN_RESOLVER_NOT_BOUND. Installing even that default
would block legacy writes, so a placeholder does NOT make installation harmless.

## Implemented

core.sql defines private round/revision, hashed credential, one-shot permit, immutable
receipt and archive storage. RLS is enabled and PUBLIC/anon/authenticated/service_role
receive no schema/table/function access. New public RPCs get explicit narrow anon/
authenticated EXECUTE only. No public tables, Auth objects/extensions or default Data
API grants are required. Existing public group data is the SINGLE canonical state.
No second projection/canonical golf JSON store is introduced.

validators.sql ports the existing tested pure snapshot/finished/setup validators,
with no laboratory DB-role-to-player identity or synthetic result-ledger dependence.
They remain INCOMPLETE for production: see the gates below.

boundary.sql adds a BEFORE UPDATE/DELETE boundary on public.tens_in_groups while
leaving existing AFTER hooks untouched. The group row is locked BEFORE private round
and credential metadata. A private one-shot permit binds backend, full transaction
ID, group, expected revision, operation and exact state digest. The browser cannot
mint it through a GUC, client Admin flag, group JSON, table write or helper call.
The permit is consumed in the trigger, with validation and metadata revision update
in the same transaction as the real group row and unchanged AFTER-hook effects.
State-identical owner metadata updates remain permitted. Group identity changes and
unimplemented delete operations reject. No legacy unversioned state writer is exempt.

The closure latch recognises existing scores and the first accepted score, freezing
entry/payment/pot-affecting state; stale revisions/rounds and mixed entry+first-score
writes reject. Legitimate eligible entrants can keep submitting. Lifecycle proposals
use the same lock and group-specific credential. Finish archives the exact old state;
start gets fresh server round and application-round IDs. No calculation is changed
or duplicated in the existing history/League/Trip/payout path. Entry status is in a
separate envelope, not new keys mixed into historical group JSON.

Receipts bind nonce/group/operation/round/revision/proposal and credential identity.
A retry checks current scope/expiry/revocation before returning the prior ACK. It
performs no new group/notification/award writes. Downstream hook/receipt failures
abort the whole statement. The clarified notification hook is not replaced with
invented result/payout writes. Notification delivery itself is not proven by these tests.

Private operator-only provisioning/revocation functions are INVOKER routines with
no API grants. Provisioning expects a 256-bit CSPRNG token, stores only SHA-256, limits
expiry to 90 days and accepts narrow scopes. Revocation uses the same group-first
lock order. Trusted organiser verification, secure delivery/rotation/lost-device
recovery and operator parameter/log handling are still operational requirements;
there is no browser endpoint accepting a shared PIN/global creation code to issue
credentials. Four-digit Admin PIN/device flags remain UI convenience, not authority.

## Actual app integration, inactive by default

app/entry-guard-client.js is inert on load. Existing builds without an activation
configuration retain the old client path; no new RPC, credential or network request
is made automatically by the module. A guarded build must explicitly supply the
reviewed mode/project/exact HTTPS origin and TEST project URL. Invalid configurations
fail before Supabase client construction, with no fallback to the old connection.
No activation config has been created or enabled. LIVE is not an allowed guarded
project in this version; any later LIVE rollout needs separately reviewed build work.

The app wraps all get_group_state/save_group_state calls through the adapter when
that guarded mode is enabled. save captures the originating read version BEFORE its
queue; it does not assign a newer revision to a stale snapshot. Finish Round (including
team Trip), first setup, newRound and nextTripRound route explicitly as finish/start.
There is no payload-shape or Admin-flag inference. Legacy direct setters without a
versioned read fail instead of falling back. Missing/mutated source identity and
conflicts require a fresh read. A rejected/ambiguous save restores the authoritative display when available without retry/rebase or crossing a changed connection; the receipt remains available for explicit reconciliation. The unchanged default path still uses the legacy RPC.

Credentials are prompted as passwords, verified server-side for the selected group,
kept only in memory, cleared on group change/Admin exit/failure, and never stored in
state/URLs/browser storage/logs. Closure/open controls consult server metadata in
this mode, including after score reset/round completion. Failed Trip finishes/round
starts now stop their success navigation. 'Check last save' explicitly reconciles a
pending request through its authorised receipt AND a fresh read; it never replays a
finish or installs an old ACK over a newer state. Browser reload/lost nonce recovery,
production delivery and physical-device UX remain unverified.

## Tests and rollback evidence

The candidate is executed only against freshly created fictional tables with a
fixture-specific resolver. Tests run actual repository save/Finish/setup functions
through the real app adapter/RPCs for normal Money/Points/Net and planned Trip cases,
including team/final rounds and first competition setup. Tests cover direct/legacy
bypass, GUC forgery, stale queued payment, wrong group credentials, revoked replay,
lost ACK, unchanged AFTER-hook definition/effects and statement rollback including
permits, archives, receipts and private credentials.

A separate local DDL failure test rolls back candidate schema/RPC/grants/trigger and
checks original group/history JSON, ownership, RLS and function ACL/config/definition.
Post-runtime fallback test retires the public write RPC while retaining populated
private metadata; the vulnerable legacy route stays blocked. This is NOT the exact
hosted rollback plan. Never drop populated private tables, delete golf records,
restore obsolete snapshots or remove the central guard as an uncontrolled fallback.
No CASCADE is used.

The reviewed concurrency runner creates only its OWN uniquely named disposable
PostgreSQL 17.6 container from an already cached pinned image, network none, no ports,
no existing-service/data mounts. Six new independent-session races cover canonical
score/payment, finish/payment, same-nonce finish replay, setup/stale return and
revoke/finish and PIN rotation while a reader waits. It also reruns the prior 12 races and six actual local-login checks.
There is no online database URL/container argument, image pull or Supabase connection.

## Exact remaining gates — installation still NO-GO

1. Bind PIN resolution to the already saved get/save identity predicates/search path
   and actual column types, preserving ALL-group semantics. No new inspection is
   currently needed; do not guess a crypt schema or use JSON/state equality to find
   the group. tools/closed-entry-inspection/prepare_pin_binding.py reads the existing
   matching saved package and derives PRIVATE REVIEW SQL for a narrowly supported
   single-table SQL getter, preserving its exact predicate/path and changing only
   the state projection to id::text. Unsupported shapes stop; no SQL is executed.
   Eight offline tests and a real local generated-resolver execution test cover it.
   The candidate default remains intentionally unbound until that local review.
   Resolution is rechecked after locking, including concurrent PIN rotation.
2. Complete and test all operations before activation: remaining resets/history corrections,
   Trip cancellation, existing player/settings/owner/history and payout-settlement maintenance; Side Game
   writes; new Trip creation and older unplanned Trip setup. Current validators
   conservatively reject unsupported operations, so installation would break them.
   Complete adversarial ranking/tie/payout/team/champion checks, legacy optional-field/
   zero-stake/classification cases and reserved-key/identity compatibility. Passing
   legitimate-source cases is NOT full malicious-result validation.
3. Finalise actual operator verification/delivery/rotation/recovery and all-group/
   device credential coverage. Test the password/recovery UI on real iPhone/browser
   clients; verify released native wrapper asset delivery/cache behaviour. Complete
   owner-dashboard/other client writers and safe response/error UX. Do not ship
   partial support as an all-groups fix or silently reopen the legacy writer.
4. Generate baseline-bound installation/object rollback with actual ownership/grants/
   trigger definitions/dependencies and retained runtime metadata. Review backup/
   restore recovery, including effective permissions, and controlled writers.
5. Seek separate approval for TEST-only identity/parity/privilege/recovery/writer
   preflight, then separately approve a concrete installation and beta build. No
   database connection, SQL install, permissions change, deployment or release is
   authorised by these offline artifacts or test results.

Ordinary member saves still use the existing shared group-PIN trust model. This
incident boundary does not establish per-player Auth identity or certify who typed
an otherwise eligible player's score. Do not describe it as full account/security
integration. Organiser transitions independently require the private credential.

## Validation for this offline revision

Passed: full incident npm suite; 62 canonical boundary/actual app checks; three
adapter session checks; inert-load/config/routing/script syntax checks; transaction
DDL rollback and post-runtime fail-closed retention; 148 Python safety/reviewer/
binding checks; 25 real independent-session PostgreSQL 17.6 races and six local-login
role checks. These ran only in fresh embedded databases or the runner's own
network-none Docker instance. No Supabase project was contacted. Real REST/Auth,
hosted ownership/grants, physical iPhone and deployed wrapper behaviour remain untested.

## Controlled follow-up after 5bec83f

See [controlled offline completion](../../docs/incident-closed-entry/CONTROLLED-OFFLINE-COMPLETION.md)
for the operation matrix, private Mac PIN-binding step, organiser verification and
baseline-bound TEST package requirements. The actual private capture is NOT present
in this workspace: the real resolver has not been generated/certified here.

Added explicit correct/cancel/settings operations with group-scoped permissions:
individual/NR and pair score corrections; exact non-Trip cancellation with the old
canonical state archived; group-name/Admin-PIN edits without financial/history/entry
changes. Actual app correction/cancellation/settings functions route explicitly.
Closure stays latched; stale saves, missing scope and revoked receipt replay reject.
Existing legitimate source Finish/League/payout/history behaviour remains covered.
Unsupported player/Side Game/settlement/Trip/maintenance controls are still gates.

Private operator-only replace_credentials adds atomic compare-and-swap recovery or
rotation without deleting old credentials/receipts. It cannot verify an organiser's
identity, arrange delivery or authorise itself through a group PIN. API roles cannot
call it. Independent owner verification and recovery UX are NOT complete.

Passed in this follow-up: 61 added embedded PostgreSQL/actual app operation and
credential checks; the full incident npm suite; all 148 inspection-tool Python
tests, including eight PIN-binder tests; 25 real PostgreSQL 17.6 independent-session
races and six local-login role checks. No real PIN binding, exact TEST object/data
baseline, installable migration/rollback or hosted/native test is claimed. Candidate
and guarded mode remain disabled and NOT installable. No online project was contacted.

## Member/Side Game/payout/Trip creation extension after 920ae95

See [secure operation progress](../../docs/incident-closed-entry/SECURE-OPERATION-PROGRESS.md)
for the implemented identity-bound operations, confirmed Mac PIN derivation and
specific remaining gates. That report supersedes earlier *derivation not run* and
unimplemented-member-route statements above. Private SQL remains on the owner's Mac.

Adds a sixth private RLS table for hashed member credentials and a fifth public RPC
for member credential checks. Operator-only member provisioning/replacement/revocation
is separate from organiser authority. Browser name selection is never used as proof.
Actual profile/membership, Side Game, payout claim/settlement and new/older Trip setup
routes are covered by additional fictional tests. These do not certify all operations,
existing data shapes, real verified identities or current TEST baseline/recovery.

New offline prepare_guard_review.py only checks private binding hashes and creates a
review inventory. It cannot connect, execute SQL, activate guarded mode or produce a
ready installer. Exact target-bound migration/rollback remains a release gate. The
candidate stays NOT INSTALLABLE and is outside automatic Supabase migrations.

## Lossless Trip and maintenance compatibility follow-up

[Current readiness](../../docs/incident-closed-entry/CONTROLLED-TEST-READINESS.md)
supersedes the older operation/inventory counts above: eight private RLS tables, six
public RPCs, audited server-derived restoration/maintenance, frozen entrant identities,
legacy payout materialisation and source client routing. Existing AFTER hooks remain.
Identity issuance/recovery UX, exact TEST baseline-bound installation/rollback and
writer/client cutover are still gates. NOT INSTALLABLE; no guarded activation.
