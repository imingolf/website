# Exactly-once result contract and remaining private gates

All changes are isolated fictional fixtures and offline saved-file analysis.
No production app/RPC, LIVE/TEST record or existing database has been changed.

## What is newly implemented/tested

finish-receipts.sql adds a private FICTIONAL receipt contract around the existing
actual-source finished-state adapter. It is NOT a Supabase migration. It locks the
same fictional group row, checks current capability scope/expiry/revocation, binds
a caller nonce to the exact canonical JSONB payload/round/revision, and records the
acknowledgement in the same transaction as result/archive/projection writes. A retry
with the same identity/payload returns the existing acknowledgement without writes;
a changed payload/credential identity is rejected. A new nonce cannot finish an
already-finished round. Lookup is private and currently authorised; no caller gets
receipt table access, raw credentials or arbitrary other-group receipts.

The fixtures contain a deliberately swallowing trigger with two nested exception
scopes and ON CONFLICT DO NOTHING, matching only the REPORTED STRUCTURAL PATTERN.
They do NOT reproduce the private LIVE body. A fictional result ledger retains old
and finished snapshots for the normal or Trip history-append transition. Postcondition
checks run OUTSIDE those trigger exception scopes. A caught/rolled-back result write,
conflicting existing snapshot or final receipt-write failure rolls back all fixture
changes. Full snapshots preserve paid metadata, original scores, source League/Trip
awards and payouts. These assertions are NOT suitable production checks until mapped
to the actual target/column/default/index/exception contract. No duplicate payout
calculation is added. Existing result ranking/award validation gaps remain open.

Tests use actual repository Finish Round outputs for Money, Points, Net, Trip
individual/final and betterball cases. They cover exact replay with reordered JSON
keys, different nonce/payload, cross-group credentials, revoked/expired replay,
conflicting results, swallowed writes, receipt failure and replay after a new round.
The client contract is joined to the local SQL fixture for a committed-but-lost ACK;
recovery checks the nonce receipt plus a fresh read and retains the newer round.
These are sequential embedded PostgreSQL tests, NOT real multi-session race proof.

The client retains only an opaque pending finish request ID and expected group/
round/revision in memory after an ambiguous failure; its credential is cleared.
Reconciliation requires an authorised receipt response and a fresh server envelope,
never replays Finish Round, never installs the old receipt's state over a newer round
and never restores authority. Inputs must come from the reviewed transport, not user
assertions. Missing receipt does NOT prove failure or authorise a new finish. Tabs/
reloads can lose pending IDs; production recovery for that case remains unbuilt.
No start/save receipt protocol, actual UI wiring, verified network transport or real
credential issuance is provided by these prototypes. No capability/nonce is placed
in URLs/localStorage/logs. Nonces are not organiser credentials.

## Smallest remaining private evidence review (existing files only)

`semantic_saved.py --remaining-checks-only` validates the original package as before
and filters to AFTER UPDATE. It omits completed trigger/index/declaration sketches
and reports only exception scopes/outcome references and write/conflict checks.
New fixed flags distinguish RETURN NEW/OLD/NULL/other, bare RAISE, new exceptions and
message-only raises. Nested handler outcomes are not attributed to their parent
handler. Flags are references with reachability/error-preservation UNVERIFIED.
No credentials, literals, SQL definitions, arbitrary identifiers or records are
printed. Do not repeat the database inspection.

For the TWO reported nested handlers, establish privately:

1. Which exact write event numbers and history-delta/round-transition conditions are
   protected by each scope? Follow relevant local assignments/helpers, not topic tags.
2. Does each reachable handler rethrow, replace the error, return normally or continue?
   A RAISE NOTICE is not an exception. Confirm which enclosing scope can swallow a
   guard/postcondition error; the invariant boundary must remain outside it.
3. For each history/payment result INSERT, match the precise non-null round/group
   identity, unique key/index predicate and conflict action/filter. If DO NOTHING
   suppresses a row, prove it already contains the identical intended result rather
   than a stale/different payload. Do not infer this from constraint-count matches.
4. Identify whether League/Trip/payout effects live in that target, in group JSON,
   another statement or a helper. Preserve each exactly once; don't copy the fictional
   result-ledger schema into production as a substitute.

Share ONLY anonymous handler/event/target numbers, the outcome flags and whether
these four facts are established or specifically unknown. Keep original predicates,
values and definitions private. Unsupported syntax remains an explicit blocker.
The saved capture is not directly accessible in this workspace, so the reviewer
cannot truthfully certify actual runtime semantics here from the owner's counts.

## Specific next gates before TEST installation

- Complete those four private semantic facts; map real column/default/FK/index and
  helper effects into a faithful fictional legacy-schema adapter and result checks.
- Complete production group credential issuance/revocation/recovery, shared-PIN threat
  handling, all-group coverage, verified client transport/UI/queues and lost-ID recovery.
- Complete all operation validators (Side Game/maintenance/older Trip variants) and
  adversarial ranking/payout validation. Preserve actual Finish Round payloads.
- Rehearse real multi-session replay/revocation/finish races and faithful object/data/
  permission rollback. Keep receipts, archives and revocations after runtime writes;
  don't drop populated tables or restore old group JSON. No CASCADE or stale overwrite.
- Only then seek separate approval for TEST identity/parity, privileges, fresh recovery
  and writer controls; prepare guarded installation SQL from exact verified schema.

Status: meaningful exactly-once and client-recovery contracts now tested OFFLINE;
NOT a completed production integration. TEST/LIVE installation and deployment NO-GO.
