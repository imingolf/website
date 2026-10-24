# Source compatibility and migration/rollback review — offline only

Scope: fix-closed-competition-entry. No LIVE/TEST connection, online SQL, installed
migration, real record change, merge or deployment. All new SQL is fixture-only.

## What this stage establishes

[Source lifecycle tests](../../incident-tests/closed-entry/test-source-finish.cjs)
execute the ACTUAL repository finishRound/finishTripBetterBallRound and newRound/
nextTripRound functions with fictional data and mocked UI/RPC boundaries, including the actual save()
queue/activity-stamping code.
They then send the unchanged result payloads through a protected PostgreSQL fixture.
The first source tests exposed the lastActivityAt stamp absent from earlier fixtures;
the validators now allow that non-authority metadata while keeping revision, history,
entry and payment checks. Transport revision annotations are checked/removed; new round identity is server
issued rather than trusted from the client. No production calculations were edited. The two new source-payload operations
remain isolated fixture functions with PUBLIC execution revoked.

23 complete finish AND next-setup scenarios passed: normal Money/Points, Stableford/
Net, ties, all-NR Points, Trip individual and Better Ball/Pairs Aggregate, intermediate
and final Trip rounds. Each persists JSON-equivalent source output (apart from the
server-issued new round ID and transport-only revision field), retains exact original
archive/payment state and old history, and rejects repeated finish/old payment saves.

Tests check known £27/£2/£1 payouts on a £30 pot, 10/6/3 Points awards, original League
calculation on persisted history (including an older £20 award), Trip individual and
team standings, and preservation of fictional existing settlements. Seventeen forged
result/setup cases are rejected atomically, including old-history rewrite, changed
historical score, enlarged pot/payout, unpaid winner/recipient, player identity or
payment reset corruption, version mismatch, standings changes and invalid attendance.
Twelve real independent-session lock-contention scenarios and six separate-login
permission checks passed in a network-disabled PostgreSQL 17.6 fixture, including
actual-source finish/entry and setup/return races. Each of the 23 cases also rejects a delayed old-round payment after the next setup.

The fixture validates protected setup/history boundaries, old score snapshots,
entrants/payment archives, normal win/League deltas and payout eligibility/budget.
It DOES NOT yet fully validate ranking/tie decisions, exact payout allocations,
all champion/standings calculations or all malformed team-result schemas. Valid
source output is preserved; that is not proof every malicious authorised payload
is rejected. Both new endpoints remain private fixture functions, not public APIs.

## Actual saved evidence: conclusions and remaining limits

The owner reports save_group_state updates public.tens_in_groups with p_state and
calls now(); root triggers have classified built-in candidates and no observed
EXECUTE/quoted dynamic SQL. Only one uncaptured call remains, in create_golf_group.
The current summaries do not identify that call's spelling or exact binding. Do not
claim it is gen_salt merely because that is plausible. Creation is not being edited;
no reported existing-group save -> create path has been established. Confirm the
saved dependency graph before excluding it from the hotfix's critical path.

The classifier now also recognises documented gen_salt/digest extension spellings,
reports fixed search_path precedence without revealing custom schema/config values,
and links write targets anonymously to already-saved relation metadata. Notification/
status/payment/history column patterns are explicitly NOT proof of effects. It
reports downstream captured trigger counts and missing constraint/index evidence.
Twenty classification tests passed. Running it on the saved Mac files makes no
connection; actual new classification results have NOT been seen here.

A hard evidence limit: the original inspection captured selected function definitions,
identity arguments, configuration, namespace ACLs, relation columns and noninternal
triggers. It did NOT capture all builtin/extension overload OIDs, extension membership,
operator/cast candidates, target constraints/indexes or all helper definitions.
Therefore actual function binding cannot be certified from these summaries alone.
A configured path with implicit pg_catalog first can establish precedence over public
for built-in spellings; missing/caller-inherited paths or explicit public before
pg_catalog remain suspect. Spelling alone never sets resolution_verified=true.
If the existing saved archive contains missing definitions, review privately offline;
an old backup may be reference evidence, not proof of the current catalog. Any genuinely
missing current metadata collection needs separate read-only approval, not a retry.

## Trigger-effects review gate

Use saved definitions/metadata to map BEFORE/AFTER timing, name/order, written table
aliases, transformed fields and additional triggers. Establish whether writes are
notifications/status, financial ledger rows, League awards or history transformations.
The captured bodies remain private on the Mac: the development workspace has only
the owner's summaries. No faithful LIVE-trigger integration is claimed.

INSERT ON CONFLICT DO NOTHING needs its actual uniqueness/index definition before
claiming exactly-once semantics. Foreign keys, downstream triggers, RLS/definer
owners and other transactions can add effects. The synthetic fixture shows atomic
rollback of group state, metadata and trigger writes on failure, but does not prove
that the real target tables or side effects are equivalent. Do not replace those
triggers, duplicate their awards or infer they are harmless from built-in call names.

## Conditional production migration plan — NOT execution instructions

1. Freeze the exact reviewed source bundle and capture current object definitions,
   owners, EXECUTE/DML/schema/default/column grants, RLS/policies, trigger order/state,
   dependencies and relevant constraints/indexes. Resolve actual group ID/pin columns
   and data types from saved metadata; the fixture text IDs/plain fictional pins are
   not the real schema contract. No setup-test or app/supabase-setup.sql reuse.
2. Prepare least-privilege private server round/closure/revision/archive/receipt and
   organiser-capability objects. Explicitly revoke PUBLIC/browser/service access as
   appropriate; default grants cannot be assumed. No new public table is required.
   Only reviewed RPCs may validate high-entropy group-scoped lifecycle capability.
   Platform-owner creation code is not organiser authority.
3. Define approved organiser identity verification and capability issuance/delivery/
   renewal/revocation BEFORE activating privileged lifecycle operations. Raw secrets
   never enter shared group state/getters/URLs/logs. No new real capability is issued
   here. Ordinary incident member access may retain the existing PIN-based contract
   with strict round/field validation; do not silently turn shared authenticated DB
   roles into per-user authority or promise new per-player authentication. That is
   a separately reviewed threat boundary, not a prerequisite to full registration.
4. Bind the guard to the real canonical group row and every writer, with one lock
   order. Preserve old non-lifecycle RPC signature only where safely compatible;
   add revision/round read metadata and explicit capability-gated finish/setup paths.
   No reset-shaped JSON exemption, caller GUC, application_name or isAdmin bypass.
   Check reserved revision-key collision before choosing a real wire field name.
5. Integrate existing trigger transformations at their real positions and preserve
   stored result/history format. A private intent must be unforgeable and tied to
   group/round/revision/transaction if needed to identify trusted transitions. Do not
   copy the fixture's duplicate canonical/projection storage into production.
6. Initialise closure from current committed state under the group lock, including
   existing scores, legacy missing round IDs and completed/never-started groups.
   No rewriting old group JSON, paid flags or history merely to fit the new schema.
   All old-round requests must remain distinguishable and fail safely.
7. Prepare an explicit client bridge for read/save revisions and protected finish/
   setup calls. Current production app functions still call the ordinary save RPC;
   test harness dispatch is NOT that bridge. Handle false/error/conflict, local save
   queues, readback, retry and new server identity without automatic stale rebasing.
   A server-only switch that prevents all existing Admin finishes is not acceptable.
8. Wrap the reviewed object changes atomically with bounded lock/statement timeouts,
   exact baseline/owner/definition/ACL guards and rollback on any install error.
   This stage provides no installable production transaction: dependencies and
   authority/client/recovery decisions above remain unresolved.
9. Rehearse on a faithful fictional legacy schema, then separately approved TEST.
   Verify all old/current clients, real REST roles and physical iPhone return/caching
   behaviour. PostgreSQL 17.6 fixture results are not hosted 17.11/REST/Auth proof.

## Rollback and recovery plan

- Preserve immutable fresh consistent backup and creation-time checksum plus exact
  catalog recovery inventory. Capture all groups/history/ownership/payment hashes,
  including Group 1010's newly completed result. Historical TEST backups do not
  recover LIVE. A --no-owner/--no-acl dump alone is not permission/Auth/service recovery.
- Generate object rollback from exact captured definitions and grants, not hand-written
  guesses. Record added object signatures/OIDs and dependency hashes. Rehearse owner
  authority, trigger configuration and restoration of effective privileges locally.
- If installation fails inside its transaction, PostgreSQL rollback must leave both
  application data and object baseline intact. Verify, do not infer success from exit.
- After runtime writes exist, rollback must preserve new results, archives, closure
  flags and capability revocations. Never restore old group snapshots over current
  history or drop populated metadata to satisfy a guard. No CASCADE or deleting rows.
- Removing the central guard reopens the vulnerability. Prefer forward repair or a
  reviewed compatible fail-closed boundary under controlled writers. Do not blindly
  reinstate the vulnerable RPC while clients can save. Stop on schema/data drift,
  missing ownership, unexpected dependencies or inability to restore privileges.

## Remaining compatibility/security gates

Faithful LIVE trigger/target/overload review; exact legacy schema mapping; secure
organiser capability provisioning; production client bridge; complete Side Game/
settings/profile write validators; new Trip creation and older unplanned Trip setup;
full ranking/payout/team/champion validation; role/revocation/failure concurrency;
reserved-key/missing-ID mapping; exact rollback and fresh relevant recovery evidence;
TEST and physical-iPhone verification. No new table permission, SSL setting or upgrade
is needed merely to continue this offline work.

## Practical next evidence step — no database connection

Use the enhanced classifier on existing files only if the exact fixed search_path,
creation helper classification and target metadata have not already been supplied:

```sh
python3 tools/closed-entry-inspection/test_classify_saved_calls.py &&
python3 tools/closed-entry-inspection/classify_saved_calls.py
```

This is a bounded new metadata analysis, not another inspection or a repeat of old
call counts. Share only its generated value-free JSON. Do not share private literals,
raw bodies, config files, owner codes or group records. Stop if required catalog
facts were not captured; prepare a precisely scoped future read-only request rather
than claiming actual OID resolution is proven.

Status: materially closer on source lifecycle compatibility; NOT ready for TEST/LIVE
installation or deployment. No online change is authorised by these offline results.
