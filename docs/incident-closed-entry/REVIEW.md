# Closed competition entry incident — offline review

Branch: fix-closed-competition-entry, based exclusively on production Git source
94318ca (origin/main fetched for comparison). Registration branch 38f8121 and
completed demonstration are untouched. No hosted code, database or native binary
was inspected; production database definitions are NOT established by this review.
User reports Group 1010 already corrected to three entrants. Do not repair data.

## Root cause in repository source

Round's playerNextActionHtml already checks roundLocked before offering Pay & Join.
Pay's independent rendering does not. beginPlayerPayment neither checks closure nor
refreshes before launching the external payment URL. recognisePaymentReturn checks
journey identity/age and re-reads the group, but then sets paid=true without checking
for scores. It reads back that flag and celebrates success. adminSelfEnter has an
initial local check but no fresh-state closure check. togglePaid has no closure
check. enterNormalPointsGame checks a stale local state before, not after, fetching.

pot = stake * paidCount; there is no separate pot ledger in this source. An extra
paid flag explains the increased pot. Three fictional paid players at £10 produce
£30; late confirmation produces £40 before correction. This is a reproducible code
path consistent with the report, not proof of the exact installed native build or
hosted SQL definition. Investigate those versions later without assuming equivalence.

## Write-route inventory

- addPlayer/adminAddPlayer add group membership, normally unpaid. Membership must
  remain possible after entries close, without entering the active competition.
- playerNextActionHtml/pay expose payment launch; recognised admin devices also
  reach adminSelfEnter. Payment redirects return through focus, visibilitychange,
  pageshow, online and polling callbacks into recognisePaymentReturn.
- adminSelfEnter, recognisePaymentReturn, togglePaid change paid and payment metadata.
- enterNormalPointsGame changes playingThisRound; Trip selection controls who plays.
- savePlayerPatch changes individual scores after fetching latest state. Individual
  score, NR and Trip pair-score submission cause roundLocked to become true.
- setup/finish/reset/Trip advance clear scores and entry flags as part of lifecycle.
- all these legacy writes ultimately use save_group_state(p_pin,p_state). The queue
  orders saves on one client only; it does not serialise competing devices.
- app/supabase-setup.sql contains an unrestricted whole-JSON replacement definition
  exposed to anon/authenticated. It also contains DELETE/INSERT demo setup: NEVER
  run this setup file as an incident fix. Other hosted RPC versions/direct table
  permissions/triggers are unknown until an approved read-only catalog review.
- owner-dashboard/config owner RPCs can modify groups; their hosted definitions are
  not present here. Include those and privileged integrations in server enforcement.

## Prepared client patch

app/index.html: shared closure check, fail-closed fresh-state verification before
payment launch; closure checked after each payment/attendance refresh; current-round
comparison stops returns crossing into another round. Payment return locks before
its asynchronous check to avoid duplicate dialogs. Closed unpaid Player Pay screen
has no launch/confirm path, only Entries Closed. Admin controls are disabled and
handlers independently reject changes. Existing paid players retain read-only
payment status and unchanged score submission. No paid records are rewritten by
installation; no calculation, stake, history or existing score code changes.

Race between the final read and save remains a SERVER responsibility. This patch
cannot protect an old installed client or direct RPC by itself. No deploy approval.

## Required database correction — implementation blocked pending catalog evidence

Smallest defensible server boundary: a per-group, atomic transition guard shared
by EVERY writer, including the legacy RPC and direct UPDATE paths. A row-level
trigger or one locked save function plus proven denial of alternate writes needs
review against the actual hosted schema. Capture existing definitions, owners,
ACLs, policies and triggers first; do not replace them from this old setup file.

Required transition contract:

1. Lock the actual group row (SELECT FOR UPDATE) before examining current state.
   First score submission and entry save must serialise against the SAME row.
2. Recognise Stableford including zero, Net, NR and Trip pair scores. Latch closure
   for the actual round, so removal/correction of a score cannot reopen entries.
3. Once closed, preserve entered-player IDs, payment flags/metadata, attendance,
   pot-affecting stake and active Trip eligibility. Reject added paid members,
   changing IDs, removals and replacement snapshots that drop the closing score.
   Allow adding an unpaid group member without granting competition participation.
4. Preserve score submission by existing entrants and permitted score correction.
   Do not let an entry mutation be bundled with the first score to admit a player.
5. Only a separately authorised lifecycle operation may finish/start/advance a
   round and clear the latch. A caller-supplied roundId/course/date/history/reset
   is NOT evidence of authority. Legacy missing-roundId groups need an explicit,
   non-destructive migration strategy, not a blanket exemption.
6. Direct table writes, owner update RPCs and service writers must share the guard
   or be demonstrably restricted. SECURITY DEFINER/search_path/EXECUTE/owner grants
   and RLS need review; do not grant more privileges to make this pass.

Why executable SQL is not supplied: the only production-branch save definition
uses a group PIN, not trusted server-side Admin identity. isAdmin/adminDeviceRecognised
are client checks. Simply allowing "a reset" whenever JSON claims a new round
would allow direct callers to bypass closure. Rejecting every reset would break
legitimate Finish Round and Trip advance. Neither is an acceptable emergency fix.
The correct trusted lifecycle boundary must be established before writing an
installable migration. Registration PR migrations are not a drop-in LIVE hotfix.

## Offline validation

node tests/closed-entry.cjs: fictional Group 1010, 3 paid + 1 unpaid member; first
Stableford (including zero)/Net/NR/pair score; Pay tab; Admin/Player mode; stale
launch/return/admin snapshots; repeated return; score arriving during dialog;
round mismatch; offline fetch; valid pre-score launch; unchanged £30 pot.
node tests/sync-regression.cjs: existing score-refresh races, queue/save failure,
finish locks, payouts, Money/Trip finish and League history regression coverage.
All browser script blocks parsed. No SQL executed or database connections made.
These are client/mocked tests, NOT database enforcement or physical iPhone proof.

Required server regression suite after implementation: exact 3-to-4 scenario via
legacy RPC, narrow RPC and direct UPDATE; two concurrent sessions in both orderings;
repeated/stale requests; forged new round/reset/history; score removal; entrant
identity substitution; first score + late entry bundled together; legitimate
entrant scoring/correction; Admin status lock; membership-only add; Finish Round,
new competition, Trip advance; both scoring formats, zero, NR, pair scores;
unchanged history, original payment metadata, group isolation and rollback guards.
Must use isolated local data then separately approved TEST, never active Group 1010.

## Safest release sequence — current decision NO-GO

1. Review this client patch and authorise a narrowly scoped READ-ONLY catalog and
   native delivery/version investigation separately. Do not contact LIVE now.
2. Establish trusted lifecycle authority, draft least-privilege additive DB guard,
   capture exact recovery definitions and rehearse migration/rollback locally.
3. With separate approval, test a synthetic three-entrant competition in isolated
   TEST, including old-client/direct writes, concurrent calls and physical iPhone
   payment-return flows. No real payments necessary. Test complete round lifecycle.
4. Review backup/recovery, writers and controlled maintenance for any eventual
   LIVE change. Record current fingerprints; do not adjust Group 1010 or its pot.
   Stop on unexpected state/definitions. Never run the repository setup SQL.
5. Only after explicit release approval apply the reviewed server protection first,
   with validated lifecycle compatibility, then release client assets separately.
   Existing active entrants must not be interrupted. No release authorised here.

A DB migration is REQUIRED for old-client/direct-call protection. A website release
is required for web UI changes. An Apple submission MAY be required: this repository
has no native wrapper configuration/binary proving whether the official app bundles
HTML or remotely loads the web app. Inspect the native delivery mechanism before
answering; server enforcement must protect either version. Do not promise that a
website release updates installed App Store clients. Physical iPhone and actual
Supabase security tests remain outstanding.

Rollback must restore captured definitions/ACLs/triggers and preserve all records;
removing enforcement reopens the vulnerability, so use a controlled writer pause
and prefer forward repair. Do not weaken guards, use CASCADE, or undo legitimate
scores/payment events as a rollback shortcut. No installable SQL, deployment or
server-side enforcement is claimed complete by this client-only preparation.
