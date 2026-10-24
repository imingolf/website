# Offline legacy integration progress — not installable in LIVE/TEST

Branch: fix-closed-competition-entry. Uses saved evidence described by the owner;
actual private catalog bodies remain on the Mac and were NOT accessed here. No
online DB/SQL, records, permissions, Netlify or branch merges were involved.

## New implementation

### Saved-call classifier

[Local classifier](../../tools/closed-entry-inspection/classify_saved_calls.py)
classifies routine-call spellings using the existing saved definitions, not a new
inspection. It separates documented built-in candidates (for example now and JSON
helpers), extension candidates, routines whose definitions already occur in the
saved index, and uncaptured anonymous helper calls. It omits INSERT target column
lists and common SQL constructs from helper counts, masks comments/literal strings,
and flags quoted/dynamic SQL as unresolved. This addresses a limitation of the
previous deliberately small allowlist: twelve unknown labels do not mean twelve
custom security helpers. No actual saved-call classification is claimed until it
runs against the owner's private files.

Only fixed built-in names, known RPC aliases and anonymous node/target labels leave
the tool. Captured trigger helper names are mapped privately to aliases. No literal
values, creation codes, credentials, arbitrary routine/table names or SQL bodies
are exported. It cannot prove overload/search_path binding or authorisation from a
spelling; all resolution_proven flags remain false. No database, subprocess or SQL
execution occurs. Twelve redaction/classification tests passed.

### Fictional legacy-shaped adapter

[SQL fixture adapter](../../incident-tests/closed-entry/legacy-adapter.sql) wraps the
existing isolated core behind get_group_state(pin) and save_group_state(pin,state)
shapes. It is in a NEW FIXTURE SCHEMA and does not redefine any real RPC or table.
It injects a server revision on reads; missing revisions require reload and stale
snapshots are rejected. No silent current-revision substitution. A table update
guard rejects writes not matching validated canonical state, including direct
service-like fixture UPDATE attempts. All paths lock legacy row then metadata row.

Two explicitly synthetic triggers exercise history/payment-event INSERT ON CONFLICT
DO NOTHING and enabled/status upsert contracts. They are NOT reconstructions of the
real triggers; matching those broad operation types does not establish compatibility.
A fault injected into a later fixture trigger confirms state, metadata/projection
and earlier fixture-trigger effects all roll back together.

### Group-scoped organiser capability

Private hash-only capability records are group-bound, permission-limited (finish/
start), expiring and revocable. Secrets are 256-bit opaque hex strings; hashing
uses PostgreSQL SHA-256. SQL wrappers never use the platform owner code or client
Admin flag/custom GUC. Capability checks lock their private record after acquiring
the group lock. They reject missing, wrong-group, expired/revoked or wrong-permission
credentials. No raw capability is returned by a getter. No browser grants/issuance
endpoint, real capability or identity bootstrap is installed.

The test demonstrates a caller without a fixture organiser role can finish only
with the valid group-scoped capability: authority is the protected capability, not
a client role claim. A real deployment still needs approved organiser verification,
secure capability issuance/delivery/storage/rotation/recovery, abuse controls and
client integration. This is NOT permission to manufacture capabilities for LIVE
groups. Ordinary player identity still uses the existing lab role mapping, which
cannot be copied to Supabase's shared authenticated role.

Protected fixture finish stores exact entry/payment/history state once; protected
normal-round start issues a fresh server UUID and rejects old payment returns.
Missing expected revisions and non-finite stakes are rejected explicitly.

## Tests passed here

- 40 core embedded PostgreSQL checks (including NULL expected-revision rejection).
- 33 fictional legacy-adapter checks: normal RPC shape/revision handling, three
  entrants/£30 pot, Admin/player late entry, stale/reset attempts, direct-update
  guard, private capability permissions/expiry/revocation/group scope, old snapshot
  preservation, start/finish replay rejection, synthetic trigger effects, non-finite
  stake rejection and downstream-trigger failure atomicity.
- Ten REAL PostgreSQL 17.6 independent-session lock-contention cases: prior seven
  core cases plus legacy save score/entry, finish/entry and start/delayed return.
- Six actual local-login permission checks in that same disposable fixture.
- Prior 15 client-entry and 10 sync/finish/payout regressions.
- 21 runner, 12 sanitiser, 6 prior sketch and 12 new classification safety tests.

Database tests use only embedded memory or an own disposable Docker container with
network none, no published ports and tmpfs. No real user records/keys are fixtures.
The production UI's historical calculations are unchanged. These test results do
NOT prove the actual unknown LIVE trigger/helper/League/Trip integration.

## Compatibility work still blocked by specific evidence

The full actual trigger timing/order, target/helper definitions and transformations
must be established from the saved catalog. Need the NEW classifier's output to
separate built-ins from true missing dependencies, then review exact control flow
privately where required. If a required helper body was not captured, record that
specific missing definition; do not assume it exists in this workspace or reconnect.
Owner-code NULL/empty/overridden-setting handling and caller scope remain unverified;
the new group capability design deliberately does not depend on that code.

Finish fixtures preserve exact snapshots but do NOT append the app's new rendered
history record, calculate or validate new payouts/League awards, advance Trip or
implement all Side Game/settings/profile writes. The conservative prototype denies
unsupported state mutations and active Trip starts. That must not become released
behaviour. Existing full functionality needs a faithful adapter before any TEST
migration. No old result/League data is rewritten or removed to satisfy tests.

The real save/get/owner/trigger dependencies must be bound to one canonical state,
not the duplicate projection used for lab validation. Inspect every INSERT/UPDATE/
DELETE route and privileged writer; do not assume the projection guard alone is a
production migration. Exact ownership/ACL/search_path/default grants, trigger order,
legacy missing-ID/revision behaviour and old App Store client delivery remain gates.

## Next concrete step (saved files only, no new SQL/connection)

```sh
cd ~/Downloads/imingolf-rollback &&
test "$(git branch --show-current)" = "fix-closed-competition-entry" &&
git pull --ff-only origin fix-closed-competition-entry &&
python3 tools/closed-entry-inspection/test_classify_saved_calls.py &&
python3 tools/closed-entry-inspection/classify_saved_calls.py
```

This is a NEW dependency classification, not rerunning the existing sanitiser or
LIVE inspection. Share only its generated value-free JSON. If it fails, share only
the fixed error. Original catalog/private credentials remain on the Mac untouched.

After that evidence is reviewed, transplant the actual sanitised trigger/helper
control flow into a faithful fictional legacy schema, compare original and guarded
finish/League/Trip/payout outputs and add all authority/compatibility cases. Then
prepare exact bounded migration and guarded object rollback for separately approved
TEST rehearsal. Neither prototype SQL file is that migration.

## Recovery/release restrictions retained

Capture exact original definitions/owners/ACLs/policies/trigger configuration and
current consistent recovery evidence including the completed Group 1010 result.
No replacement using app/supabase-setup.sql, old TEST backups or obsolete snapshots.
No CASCADE, deleting entrants/history, pot edits or loosening closure on rollback.
Private capability/closure/archive records must survive or be safely reconciled on
rollback; removing enforcement while writers remain active is not a safe rollback.
Review trusted operator writers and exact restore coverage. Installation and website/
Apple release require separate approval and real legacy/TEST/iPhone verification.

Decision: OFFLINE prototype advancement passed; NO-GO for TEST/LIVE migration or
deployment until the specific dependency, authority issuance and compatibility gates
are closed. All existing real groups, players, payments and history remain untouched.
