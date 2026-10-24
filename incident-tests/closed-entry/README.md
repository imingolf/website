# Closed-entry server prototype — NOT a LIVE installation package

This package uses fictional data only. It is not connected to public.tens_in_groups,
any Supabase project, the app, registration beta or demonstration. No production
function, trigger, permission, group or history is changed by this work.

## Implemented and tested

prototype.sql implements an isolated PostgreSQL schema with:

- Server-owned round phase, revision and persistent closure flag; all ordinary saves
  lock the same group row before validation. Expected revision and round ID are
  mandatory; completed rounds and old identities reject saves.
- Atomic first-score closure. Existing committed entrants are frozen, including
  payment metadata and pot-affecting settings. Combining a new entry with a first
  score is rejected, even for an organiser. A preexisting score is recognised if
  the closure flag has not yet been initialised.
- Existing eligible players can submit their own score. Stableford zero, Net, NR
  and eligible pair scores trigger closure. Other-player changes are denied for
  player callers. Player removal, forged setup/history/round identity, prior-score
  erasure, changed stake, payment metadata and Trip eligibility are rejected.
- An organiser-only correction operation can clear/correct an eligible player's
  individual score without clearing the closure latch.
- An organiser-only finish operation archives the exact committed state including
  payment metadata. Repeated finish is rejected with no duplicate archive. No client
  history is trusted. Completed history already in state remains untouched.
- An organiser-only normal-round start issues a fresh UUID and resets only the new
  round's entries/scores/payment markers, retaining the previous exact archive and
  existing history. Late old-round requests are rejected. Active Trip start is
  deliberately refused until its compatibility adapter is implemented.
- Private schema/tables and revoked PUBLIC function privileges. Fixture players
  receive only narrow function execution in tests, never direct table writes.

The fixture uses protected database-role-to-group/player assignments to exercise
server authority; it does NOT use a client Admin flag, shared group PIN, JSON value,
caller-set custom GUC, or p_actor parameter as authority. Current Supabase users
share database roles, so THIS IDENTITY MODEL IS NOT A PRODUCTION AUTH SOLUTION.
Actual verified JWT/owner/capability mapping must be designed from saved evidence.
The prototype grants NO anon/authenticated/service_role access and installs no
trigger on existing tables. Privileged direct writers remain a production gate.

## Reproducible embedded tests

Install the pinned test dependency if needed (package registry access only), then:

```sh
cd incident-tests/closed-entry
npm ci --ignore-scripts --no-audit --no-fund
npm test
```

39 checks passed in embedded PostgreSQL (PGlite). It runs in memory without a network
client/URL. Cases cover fictional 1010 and 1260, 3 paid entrants and a fourth late
attempt, Admin and player callers, £30 retained pot, legitimate scoring, history,
metadata, authority failures, finish/start, stale requests, zero/Net/NR/pair scores,
closed latch after correction, membership-only addition, invalid-score atomicity
and free Points attendance. Rejected calls do not save partial updates. This is
not validation against an actual Supabase project or legacy schema.

## Independent-session concurrency test

`python3 incident-tests/closed-entry/test-concurrency.py` creates its OWN disposable
PostgreSQL 17.6 Docker container, with --network none, no published ports, only tmpfs
PGDATA and a unique fixture label. No existing container name, URL, credentials or
SQL argument is accepted. Host Docker selector is fixed to the local Unix socket;
external Docker endpoints are ignored. Every psql command runs inside the fixture
against its Unix socket. Cleanup stops only the uniquely labelled own container.

The script requires the cached official image pinned to digest
sha256:00bc86618629af00d2937fdc5a5d63db3ff8450acf52f0636ec813c7f4902929.
It never pulls automatically or uses an existing Supabase container. If absent,
STOP. Do not substitute a database connection. This development environment fetched
that public image and then ran SQL only in the network-disabled fictional fixture.

Seven REAL independent-session lock-contention checks passed on PostgreSQL 17.6:
score-first rejects the blocked stale entry after commit; entry-first permits that
legitimate entry and rejects the blocked stale score snapshot after commit. The
harness observes an actual lock wait before releasing the winning transaction.
Further cases cover finish versus entry, finish versus score, score versus finish,
simultaneous finish and new-round start versus delayed payment return. Each archive
is checked against the exact expected committed snapshot. Six actual local-login
checks also cover role escalation, direct table/authority mutation, player finish
denial, Admin late-entry denial and legitimate organiser finish. These tests use
separate database logins, not just SET ROLE under a superuser session.
This proves the prototype's tested lock order, not production integration, all
isolation levels, platform PostgreSQL 17.11 equivalence or every possible race.

## Saved LIVE definition review still required

Raw saved catalog evidence exists only on the owner's Mac. It has NOT been reviewed
here as if accessible. The owner-supplied lexical findings alone do not prove the
owner/trigger control flow. A new local-only aid is available:

```sh
python3 tools/closed-entry-inspection/test_review_saved.py &&
python3 tools/closed-entry-inspection/review_saved.py
```

It reads the existing private inspection without a connection or SQL execution,
redacts literal strings/numbers, comments, quoted and unknown identifiers, and
outputs allowlisted control-flow/call indicators. Unknown calls are anonymous;
dynamic quoted SQL is flagged as unreviewed. Six offline redaction tests passed.
It is a lexical aid, not a SQL parser, complete dependency graph or proof of
security. Share only that generated value-free output for the next source review;
never raw function bodies, creation codes, passwords or private configuration.
If it cannot safely parse, STOP. No sanitiser rerun or new inspection is necessary.

## Production adapter and compatibility gates

Before turning this into an installable migration:

1. Review the saved control flow, trigger order and dependencies; determine actual
   organiser credential validation/secrecy/scope. Unknown helpers or dynamic SQL
   are explicit gaps; do not guess or silently substitute repository setup SQL.
2. Select server-verifiable organiser and player identity, including any legacy
   account mapping. Never map every authenticated user to one organiser role or use
   a PIN exposed in get_group_state. If the existing authority is inadequate, a
   minimal new protected lifecycle credential/endpoint is required.
3. Bind the row guard/metadata to ALL actual writers: legacy save, owner functions,
   service writers and direct updates. Inspect privileges/ownership first. Do not
   give browser clients new direct access. A check in a new unused RPC is not a fix.
4. Preserve existing client contract or deliberately version it: legacy saves lack
   expected revision and trusted round identity. Plan missing IDs, completed-state
   initialisation and old installed clients explicitly. Do not infer stale revisions
   from arbitrary client values. Reject unsafe old saves with a clear message.
5. Integrate the existing Finish Round history, winners, League points, payouts and
   Trip advance/cancellation paths. The prototype archives a raw exact state but
   DOES NOT calculate awards, append the app's rendered result format, advance Trip,
   support player pair submissions, or prove current UI compatibility. Those are
   explicit release blockers, not features claimed complete. Refusing an operation
   in a prototype is not permission to break it in the released application.
6. Production must preserve unrelated settings/profile edits while freezing actual
   entry/score fields. This conservative prototype freezes all non-score fields
   for an existing player during closure; refine against real schemas and tests.
7. Add backend validation for every alternate score/entry format, pair membership,
   organiser corrections and invalid/legacy state representation. Never normalise
   historical data just to fit this fixture. Confirm service-role operational writers.
8. Extend tests against a faithful isolated legacy schema/roles/triggers and both old
   and new clients. Remaining real concurrency coverage includes simultaneous starts and cross-group
   lock isolation, transaction failure/retry and protected organiser session revocation.
   The seven current real-session scenarios cover both score/entry orderings plus
   finish/entry/score/start-return interactions and simultaneous finish.

## Migration, rollback and recovery requirements

No executable LIVE migration or rollback is provided: the mapping/authority and
compatibility gates above are unresolved. Do not run prototype.sql in Supabase.
It is test infrastructure; it deliberately contains no public/Auth table changes.

A reviewed production migration must be additive where possible, bounded and
transactional. Capture the exact deployed owners, definitions, ACLs/grantors, RLS,
policies, trigger enabled/order state and dependencies. Explicitly revoke unintended
PUBLIC/anon execution, grant only necessary RPCs and verify safe search_path.
Use trusted ownership and central guard privileges rather than client configuration.
Initialise scored-round closure under the row lock; preserve all completed history,
including the owner's latest completed Group 1010 result. No historical data repair.

Keep immutable pre-install recovery evidence plus a current consistent backup and
its real creation-time checksum. An archive without owners/ACLs does not prove role/
Auth/service recovery. Rehearse full relevant recovery and exact object rollback
using fictional/sanitised data and matching roles. Prior TEST recovery scripts and
backup are not a LIVE rollback for this incident package.

Rollback must restore captured definitions/grants/trigger configuration without
restoring old group snapshots over newer results. Preserve populated closure and
archive metadata; never DROP CASCADE, delete players/results, rewrite payment flags
or erase new rows to pass guards. Unexpected drift, ownership or dependencies STOP.
Removing closure enforcement reopens the vulnerability: prefer forward repair or
retain a compatible fail-closed boundary under an approved writer-control window.

Release requires separately approved local/TEST installation tests, exact bundle
hashes, writer/recovery review and current state verification. No active round in
Group 1010 does not prove every other group is quiet. Install only when old-client
scoring and organiser lifecycle remain compatible. Apple delivery/caching is still
unverified; server protection must cover old clients regardless. No online test,
installation, publication or deployment is authorised by these offline tests.
