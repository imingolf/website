# Controlled offline completion — installation remains NO-GO

This work follows 5bec83f on fix-closed-competition-entry. No existing Supabase
project, deployment or group record was accessed. The registration branch and
completed fictional demonstration are outside this change.

## Sequence and actual status

1. **Actual PIN binding: blocked on Mac-local input.** The private original catalog
   and matching follow-up export are not in this workspace. The sanitised UPDATE
   report does not contain the getter's predicate, parameter types or search path.
   The existing tested prepare_pin_binding.py must run on the Mac. It derives only
   a narrowly supported SQL getter, retaining its predicate and search path and
   changing only its state projection to id::text. It refuses unknown shapes. Do
   not copy a fictional resolver into the release candidate or upload raw SQL.
2. **Independent operation coverage: extended, not complete.** The candidate now
   supports organiser-scoped individual/NR and pair corrections, normal non-Trip
   cancellation, and group-name/Admin-PIN maintenance. Actual app routes explicitly
   name these operations. Unsupported operations remain rejected; nothing has been
   activated. See the matrix below before describing this as an all-groups fix.
3. **Credentials: enforcement and operator replacement tested; organiser identity
   verification/delivery not complete.** No browser issuance/recovery endpoint is
   added. A trusted operator must independently verify who controls each group.
4. **Client: these source paths integrated in the inactive TEST-only bridge.** Full
   owner-dashboard/Side Game/maintenance/native asset delivery and recovery UX are
   still release gates. No production build activation is supplied.
5. **Baseline-bound TEST installer/rollback: blocked.** Neither an exact current
   TEST catalog baseline nor complete operation coverage has been established here.
   This document specifies the package; it is not an executable installation plan.

## Added protected operations

Every operation uses the same canonical row lock, private round/revision, one-shot
permit, current group credential and nonce receipt as Finish/start. Grants remain
narrow and private helpers have no anon/authenticated/service_role access.

| Operation | Accepted change | Preserved/rejected |
| --- | --- | --- |
| correct | Change an existing eligible individual's submitted score/NR, or an existing eligible pair total | Closure stays latched; payment, entrants, format, history, awards, Side Game and setup unchanged. Cannot remove a score, introduce a new team/scorer or edit a finished round. |
| cancel | Exact reset made by normal cancelCurrentRound | Exact pre-cancel canonical state archived privately, including payment evidence. History/League/payouts/Side Game untouched; phase closes and revision advances. Trip cancellation not accepted through this operation. |
| settings | Group name and four-digit UI Admin PIN | Organiser credential required independently of that PIN. No payment/entry/score/history changes. Works in open and finished phases without reopening entries. |

Cancellation intentionally follows the existing explicit Admin action: current
payment flags/scores are reset, while their old values remain in the private
archive. This is not a rollback or an automatic data repair. No real cancellation
was performed. Historical result deletion/correction is not implicitly authorised.

## Remaining compatibility matrix

| Area/source paths | Remaining work before any activation |
| --- | --- |
| Membership/profile: addPlayer, adminAddPlayer, changeMyHandicap, editPlayer, removePlayer | Support missing legacy optional keys and unpaid joins; separate membership from frozen round entrants. Determine how current-round handicap/name edits preserve the already-frozen competition snapshot. Authorise removal and preserve old result identities. Do not simply allow arbitrary players-array replacement. |
| Settings: changePaymentLink, changeCurrentRoundCompetition, changeCurrentPrizePayout, inline course/date/stake controls, first organiser setup | Validate each exact operation and phase; freeze financial/setup fields after first score. Review supported payment URL hosts and provider matching, rather than copying substring checks as a security boundary. |
| Side Game challenge/accept/decline/cancel/score/settle | Define player-scoped authority, separate agreement/score/settlement revisions and frozen terms; existing shared-PIN/name selection does not prove a player's identity. Do not treat all sideGame JSON as harmless and mutable. |
| Results/payouts: claimWinnerPrize, markWinnerPaid | Winner-authenticated payment-detail updates and organiser-authorised settlement, immutable amount/winner/round identity, no regression from paid, receipt reconciliation. Existing UI checks alone are insufficient. |
| Trip variants: new Trip, planned/unplanned days, individual, Better Ball, Pairs Aggregate, points/money, finalisation/cancellation/deletion | Pair corrections are now tested for Better Ball and Aggregate (Stableford/Net). Planned source lifecycle cases already pass. Complete new/older unplanned Trip setup and all maintenance variants; validate attendance, team/format transitions, champions, standings and explicit financial effects. |
| History/League/reset controls: deleteLastRound, clearLeague, resetScores, resetPayments, deletePastTrip | Explicit scoped operations with audited old state and appropriate phase restrictions. Never classify resets as ordinary score saves or silently unfreeze closure. |
| Finish validation | Complete malicious ranking/tie/countback/winner/team/champion/payout/League tests. Valid actual-source payloads passing is not proof that arbitrary organiser payloads are safe. |
| Other writers/owner controls/native app | Inventory all RPC and direct-write routes, concurrent clients and asset/cache versions. Metadata-only updates remain supported; group deletion remains explicitly blocked. No exempt legacy writer. |

These are concrete unfinished compatibility/security requirements, not a request
for another LIVE inspection. Use the existing Mac evidence for further bindings.

## Organiser verification, issuance and recovery

The private INVOKER provisioning/revocation/replacement functions do not establish
organiser identity. Only the trusted operator role can use them; API roles cannot.
All tokens must be independent 256-bit CSPRNG secrets with group-specific scopes,
bounded expiry and hashes stored in the database. Tokens must never enter group
JSON, URL parameters, analytics, evidence, SQL history/logs or Git.

replace_credentials locks the group, compares the exact expected unrevoked hash set,
provisions the new token and revokes all other group tokens atomically. Invalid
expiry/scopes, a changed set or duplicate token roll back without revoking anything.
Old revoked rows, receipts, archives and closure metadata remain. A revoked token
cannot replay an old request or read its privileged receipt. Recovery across a
lost nonce/changed credential needs an independently authorised operator review;
the new token must not impersonate the old credential or change its receipt.

Before rollout, approve one independently verified organiser roster and private
delivery/recovery channel per group, an operator verification record, replacement
and compromise response, and coverage for every existing group/device. A shared
group PIN, client isAdmin flag, four-digit Admin PIN or global creation code is not
adequate proof. Automatic self-service recovery cannot safely be claimed from the
legacy trust model. Do not invent an email ownership link from uncaptured data.

## Required baseline-bound TEST package

Target ONLY nyavvwrsrxqfyhiygkgw after a separately approved read-only preflight.
The incident candidate is unrelated to the earlier four PR6 migrations: their old
rollback SQL does NOT cover these new objects or runtime metadata.

The reviewed package must bind to actual TEST object identities/types, definition
hashes, owners, effective grants (including NULL/default ACLs and memberships),
RLS/policies, triggers/order/enabled state, indexes/constraints, function/search-path
bindings, extensions and the source revision. Include the derived resolver's private
source/output hashes. Revalidate all of them under controlled writers immediately
before installation; drift must stop, never replace the baseline. Preserve verified
backup/recovery evidence; an archive listing/core-only restore is not full Supabase
Auth/service recovery. Never use LIVE capture OIDs as TEST object identities.

Candidate object inventory: one private schema; five private tables (rounds,
credentials, permits, receipts, archives), each RLS-enabled; twenty private functions;
four public RPC functions with explicit anon/authenticated EXECUTE; one canonical
BEFORE UPDATE/DELETE trigger. No new public table, Auth object, existing AFTER-hook
replacement, default-grant dependency, extension, policy or ownership change.

Proposed install, NOT executable/approved: hold controlled TEST writers, one explicit
transaction, baseline assertions and locks first, core then validators then reviewed
PIN binding then boundary, full post-DDL data/security assertions before commit.
Failed install must roll back the transaction. Inspect effective permissions, not
only grant text. Resume only compatible clients after a separately approved build.

Post-commit operational rollback must retain closure, revisions, credentials,
revocations, receipts and archives, and keep unversioned writers blocked. Prefer
fail-closed write suspension and read-only access while repairing; rolling the
website back alone to its old writer is NOT safe recovery. Never drop populated
private tables, replay old group JSON, remove the guard or use CASCADE. A destructive
object teardown is acceptable only after proving there was no committed runtime
activity and matching the exact pre-install catalog/data baseline, with writers
still controlled. Full backup restore remains a separately approved recovery action.

## Next Mac-only step (no connection)

From the bug-fix branch, run the existing binder safety tests and derive a NEW
private review folder using the already saved evidence. If it stops, share only
the error class/unsupported shape; do not repeat a database inspection. If it
passes, share only manifest.SANITISED.json. Raw resolver SQL stays private. A PASS
means derivation succeeded, not TEST installation or semantic approval.

```
cd "$HOME/Downloads/imingolf-rollback" &&
test "$(git branch --show-current)" = "fix-closed-competition-entry" &&
git pull --ff-only origin fix-closed-competition-entry &&
python3 -B tools/closed-entry-inspection/test_prepare_pin_binding.py &&
python3 -B tools/closed-entry-inspection/prepare_pin_binding.py
```

Do not activate guarded mode, install candidate SQL, connect to a database, change
settings or deploy on the strength of this local derivation.
