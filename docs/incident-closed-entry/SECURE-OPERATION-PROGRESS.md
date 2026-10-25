# Offline operation integration after 920ae95

Status: **NOT installable; guarded mode stays disabled.** No Supabase connection,
SQL installation, deployment, merge or existing group change was performed.

## Established PIN binding progress

The owner confirmed the existing Mac binder completed with source predicate/path
preserved, projection-only change, zero connections and SQL execution unauthorised.
The private resolver remains on that Mac and is not requested or committed. This
removes the earlier *derivation not run* gate. It does not prove current online TEST
parity, uniqueness of all existing PINs, restored permissions or installed behaviour.

The guard has no group-number exceptions. Canonical identity comes from the derived
id projection, never group JSON equality. Isolated tests include separate groups
with identical state, leading-zero PINs, exact non-normalised input, source-filter
exclusion, wrong-group credentials and the existing PIN-change/lock race. These are
fictional tests of the contract, not a claim that all online groups were inspected.
Do not widen the original getter predicate or assume its captured LIVE object OIDs
and grants are TEST's baseline.

## Implemented independently of the private SQL

- Private member credentials bind token hashes to one group, one existing player and
  narrow profile/sidegame/claim scopes. They expire, revoke and use the same group-first
  row-lock order. Only the trusted operator can provision/recover them. No browser
  endpoint issues authority from a selected name, group PIN or Admin flag.
- Atomic member replacement compares the exact unrevoked set before replacement,
  preserves old credentials/receipts and leaves other players unchanged. Removing a
  member revokes their credentials, preventing reuse of that ID reviving old access.
- Member profile changes target only that identity; organiser membership maintenance
  supports adding an unpaid/unscored member and removing a non-entrant. It cannot
  change payment, score, League or history fields. Entered profiles remain frozen
  once closed; active Trip participants cannot be removed through this operation.
- Payout claims require the recorded stable winnerPlayerId. Historical names,
  recipient, amounts and result calculations are immutable. HTTPS payment links use
  exact supported hosts rather than substring tests; userinfo and lookalike hosts
  reject. The organiser alone can confirm payment; paid records cannot regress.
- Side Game writes use player credentials and may change only sideGame/lastActivityAt.
  Challenges/recipient responses, own scores, source-equivalent resolution, debt
  requests and creditor confirmation are validated separately. Results and settled
  records cannot be rewritten. A single settlement change cannot exceed committed
  net debt; multiple confirmations in one proposal reject. In-person setup remains
  the existing player's assertion of prior agreement, not proof of two digital signatures.
- Actual app routes these operations explicitly, prompts for the correct credential
  kind, keeps secrets in memory and rechecks current authority on receipt recovery.
  Shared Side Game saves await confirmation before reporting success. Failed member
  addition no longer reports success. Guarded in-person setup does not persist an
  unconfirmed local bet. The default build is still unactivated legacy behaviour.
- Legacy ordinary score saves can retain an absent application roundId/attendance
  flag. The separate private context is authoritative. No rounding/normalisation of
  existing scores/handicaps or old state backfill is performed.
- New Trip creation validates the normal-round backup, empty new award/history state,
  retained past trips, roster, 1–12-day plan and first-day attendance/groups/teams.
  Actual source setup passes individual/Better Ball/Pairs Aggregate × Stableford/Net
  × money/points cases. Older unplanned individual setup also has a bounded validator.

All writes still pass the canonical BEFORE boundary and unchanged existing AFTER
hooks. Any downstream error rolls back group JSON, revisions, credentials/receipts
and fixture effects together. No notification scheduler, financial ledger, League
calculation or legacy AFTER-hook body has been replaced.

## Verification/issuance/recovery protocol (not performed)

1. The trusted operator identifies a group by its canonical ID through approved
   private evidence, then independently verifies its organiser via a previously
   established private channel or in person. A secret displayed by the app, new
   contact supplied by a requester, shared group PIN, global creation code and
   four-digit Admin PIN are not accepted as proof.
2. Record the verification case privately: group ID, verified identity/channel,
   operator, time, authorised scopes, expiry and independent callback confirmation.
   Do not store contact details or verification evidence in group JSON/Git.
3. Generate independent 256-bit CSPRNG secrets on the operator's trusted machine;
   deliver privately to the verified recipient. Never embed secrets in SQL files,
   logs, URLs, screenshots, emails to unverified addresses or public artifacts.
   Review real database statement/parameter logging before provisioning is authorised.
4. Member issuance additionally verifies the person against the organiser's verified
   roster and stable player ID. Possessing an organiser credential alone does not
   allow browser issuance of arbitrary player credentials.
5. Lost-device/compromise recovery repeats independent verification, compares the
   current credential set and atomically replaces it. Keep old revocations/receipts.
   Reconcile old ambiguous requests through an authorised operator; a new credential
   cannot impersonate the old token to read or rewrite its receipt.

The operator-only primitives and fictional tests are implemented. No real roster,
recipient identity, delivery channel or recovery case has been verified. This manual
protocol and eventual user experience require approval before rollout; do not label
it automatic self-service verification or Supabase Auth integration.

## Specific unfinished compatibility/security gates

1. **Trip return/cancellation.** Existing cancelTrip restores a partial player object,
   dropping score/submission and normal League fields; finishTrip restores the old
   backup roster and can discard members added during the Trip. Source also leaves
   some financial defaults from the Trip. Do not authorise either as an arbitrary
   settings save. Implement a lossless, explicit organiser transition with archived
   pre-transition state, private round identity/closure restoration and tests for
   both existing legacy backups and new members. No old backup may reopen a scored
   round. Past Trip deletion remains a separate audited operation.
2. **Older legacy edge cases.** Points setup with a leftover positive stake and some
   absent backup fields is not yet accepted. The old unplanned money path can choose
   a Trip competition without updating the current scoring competition. Do not claim
   those cases fixed or silently change their calculations. New plan/current-day
   financial fields, all tie/ranking/champion/award manipulations and all restored
   snapshot variants still need complete adversarial coverage.
3. **Maintenance.** Current-round format/prize/course/date/stake/payment-link settings,
   resetScores/resetPayments, deleteLastRound/clearLeague, Trip history maintenance
   and owner group deletion still need explicit validated operations and archives.
   Entered profile changes during a closed round need a separate membership profile
   or deferred update design to preserve the frozen competition snapshot.
4. **Historical payout identity.** Name-only payouts and records without a payouts
   array require a separately verified legacy mapping/backfill design. No inference
   from a current name is used to grant payment authority. Exact-host link support
   also needs a supported-provider compatibility review.
5. **Operational compatibility.** Verify every writer, real credential delivery,
   reload/lost-nonce recovery and native asset/cache behaviour. Physical iPhone,
   hosted REST/Auth, real notification delivery and Supabase role ownership are not
   established by the fictional tests.

These are offline implementation gates. Do not repeat LIVE catalog inspections.
Continue using the saved Mac evidence for any genuinely needed private mapping.

## TEST migration and rollback preparation

prepare_guard_review.py is **offline inventory only**, with no connection, execution
or activation option. On the Mac it verifies the private resolver against its saved
manifest hash, hashes the candidate/app files and writes a NEW private review folder.
It neither copies nor displays the resolver. The output distinguishes source LIVE
PIN evidence from target TEST and explicitly records the missing target baseline
and rollback approval. It refuses hash drift, unsafe files, overwrites and invalid
manifest assertions. A PASS is not permission to install.

The candidate now adds six private RLS-enabled tables (including member_credentials)
and five public RPCs. No Auth-managed object, extension, public table or existing
AFTER-hook definition changes. Public RPCs receive explicit limited EXECUTE; API
roles have no private schema/table/helper access. Supabase's public-table default
Data API grant change is not relied upon.

A baseline-bound executable TEST migration/rollback has **not** been generated:
complete operation coverage and the exact current TEST catalog/data baseline are
still missing. Reuse the original verified backup evidence, but do not pretend old
PR6 rollback SQL covers this incident boundary. A separately approved TEST-only
preflight must establish identity, parity, actual owners/effective grants, dependency
and trigger definitions, protected-data fingerprints, recovery coverage and controlled
writers. Stop on drift. No connection is requested by this inventory generator.

Install proposal remains one controlled transaction: target-baseline assertions and
locks; core; validators; private reviewed PIN binding; boundary; data/security checks;
commit only after all pass. This is not an executable/approved installation instruction.
Operational rollback keeps the guard, closure/revision metadata, member/organiser
revocations, receipts and archives; suspend writes rather than reopen the vulnerable
legacy writer. Do not remove the guard, drop populated tables, restore old group JSON
or use CASCADE. Complete the exact TEST-bound failure and retained-runtime rollback
rehearsal before installation approval.

## Validation for this offline revision

Passed: full incident npm suite; 83 added canonical member/Side Game/payout/legacy
and Trip-creation/setup checks; 153 inspection-tool Python safety/reviewer tests;
30 independent-session PostgreSQL 17.6 races and six local-login role checks. The
race runner used only its own disposable network-none container, with no ports or
existing data mounts. Tests include removed-identity revocation, member replacement,
wrong-group/role credentials, a lost member-claim acknowledgement, immutable amounts,
paid status regression, exact payment hosts, challenge-ID injection, format conflicts,
settlement overpayment and complete rollback on a downstream fixture error.

Source-based existing Finish Round, League, payout, history, planned Trip and
notification-shape tests passed. Fictional notification tests are not proof of real
notification delivery or full private-trigger runtime equivalence. Existing local
DDL rollback tests also remove the new member RPC and private table transactionally.

The existing incident LIVE catalog runners remain LIVE-specific and must NOT be
repointed at TEST or used as the next command. No TEST-connection command is approved
or supplied by this revision. Prepare/review a TEST-specific preflight and concrete
baseline-bound package after the listed offline compatibility gates are closed.
