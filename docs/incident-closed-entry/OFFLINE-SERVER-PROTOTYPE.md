# Offline server development result — installation remains NO-GO

Branch: fix-closed-competition-entry. The registration branch and fictional demo
were not modified. No LIVE/TEST connection, online SQL, migration, permission/data
change or deployment was performed. Group 1010's finished result is untouched.

## Deliverables

[Isolated server prototype and full requirements](../../incident-tests/closed-entry/README.md)
contains executable PostgreSQL validation, protected fixture organiser operations,
fixtures and actual independent-session concurrency tests. The schema is separate
and has no attachment to public.tens_in_groups. It is NOT an installation migration.

[Saved-definition local review aid](../../tools/closed-entry-inspection/review_saved.py)
reads the existing Mac evidence without a connection and exports a value-free
control-flow sketch, retaining only allowlisted identifiers and statement tokens.
Literal strings/numbers, comments, arbitrary names and quoted SQL are redacted or
flagged. The owner's complete private LIVE definitions have not been accessible
in this development workspace. Actual deployed control-flow/dependency review is
still incomplete; do not represent lexical references or this prototype as proof
that the legacy owner's credential checks are safe.

## What passed here

- 39 checks against embedded PostgreSQL: closure, three entrants/£30 pot, Admin late
  entry denial, existing-player score, stale identity/revision, forged resets/history,
  score/NR/pair/zero handling, protected score correction, membership-only addition,
  archived exact state/payment/history, protected finish/new normal round and other
  group isolation checks.
- Seven actual PostgreSQL 17.6 independent-session lock races: score/entry in both
  orders; finish/entry; finish/score in both orders; simultaneous finish; start versus
  delayed old-round payment. Verified a real lock wait and exact resulting archive.
- Six actual fixture-login authority tests: role escalation denial, direct groups/
  principal writes denied, player finish denied, Admin late entry denied, organiser
  finish permitted. This is a protected role-mapping LAB, not Supabase user mapping.
- Existing 15 closed-entry client and 10 sync/finish/payout regression checks.
- 21 inspection-runner, 12 sanitisation and 6 saved-definition-redaction tests.

Only fictional data was used. Public npm/image dependencies were fetched; test SQL
ran only in in-memory PostgreSQL or a newly created disposable PostgreSQL Docker
container with networking disabled, no published ports and tmpfs only. The fixture
container was stopped/removed after each test. No existing Supabase container or
Mac rehearsal database was used. No full Supabase environment or native iPhone test
is claimed. Embedded tests simulate serial orderings; separate Docker tests prove
the listed independent-session lock cases only.

## Next concrete step — saved evidence, no database connection

On the Mac, update THIS branch normally, then run only the local evidence aid:

```sh
cd ~/Downloads/imingolf-rollback &&
test "$(git branch --show-current)" = "fix-closed-competition-entry" &&
git pull --ff-only origin fix-closed-competition-entry &&
python3 tools/closed-entry-inspection/test_review_saved.py &&
python3 tools/closed-entry-inspection/review_saved.py
```

This does NOT rerun the earlier sanitiser or a LIVE inspection. Share only its new
value-free JSON output, never the raw catalog/function bodies, creation codes or
credentials. Review that output for actual guard ordering, caller scope, function
calls and trigger side effects. Unresolved helpers/dynamic SQL remain evidence gaps;
unknown calls are anonymised rather than leaking arbitrary names. If the sketch
cannot establish the required logic, review the exact remaining definitions privately
on the Mac before deciding any installable design; never guess from an auth reference.

## Remaining mandatory work before LIVE release

1. Complete the saved definition/dependency review. Establish a trustworthy Supabase
   organiser/player identity or a minimal protected lifecycle mechanism. The lab
   database-role registry cannot be copied to shared Supabase authenticated roles.
2. Build the compatible production adapter: every actual writer must be guarded,
   including legacy whole-state RPC, owner routes, triggers and service/direct updates.
   Protect server metadata from client mutation. Resolve legacy clients lacking a
   trusted revision/round identity. No bypass for untagged saves or reset-shaped JSON.
3. Preserve existing result format, payout/League updates, authorised cancellation,
   score corrections and all Trip/pair functionality. Prototype finish archives the
   exact state but does NOT replace those calculations or UI contracts. Its normal
   start rejects active Trip transitions rather than pretending they work.
4. Prepare a separately reviewed exact migration/rollback with owner/ACL/trigger
   guards and faithful isolated legacy-schema integration tests; then obtain approval
   for TEST installation and iPhone testing. No production SQL is ready to execute.
5. Review current recovery evidence including the completed Group 1010 result, other
   groups, writer control and native asset delivery. Recovery must never overwrite
   newer history/payment records. Retain populated metadata on rollback; no CASCADE,
   deleting data to satisfy guards or reopening vulnerable writes without control.
6. Obtain separate installation and deployment approval. Do not infer a maintenance
   window or release authority from the fact Group 1010's previous round finished.

The server transition boundary is now exercised in real local PostgreSQL, but the
released app/legacy database still use their existing save path. This work does not
claim that the LIVE late-entry vulnerability is fixed until the production adapter,
security/compatibility tests and separately approved release are complete.
