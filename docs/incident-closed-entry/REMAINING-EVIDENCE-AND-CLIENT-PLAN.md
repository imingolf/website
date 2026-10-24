# Remaining evidence and minimal client/organiser integration

Branch: fix-closed-competition-entry, continuing 926dcc7. All work here is offline.
The private Mac capture is not accessible from the development workspace; the
owner's summaries are evidence, not a substitute for the complete saved bodies.
No LIVE/TEST connection, application record read/change, online SQL, permission
change, deployment or merge occurred.

## Evidence decision: what is already captured versus genuinely missing

| Fact | Existing saved evidence | Further collection needed? |
| --- | --- | --- |
| Root save/get/owner definitions, signatures, owners, function ACLs/EXECUTE flags | Captured; hash/check locally | Do not repeat bodies; only drift guards |
| Fixed function search_path | Captured in configuration | Local audit can classify precedence now; no connection needed |
| Group-table ID/state/pin-column types | Captured in column metadata | Export only fixed safe column names/types locally |
| Group trigger definition, enabled state and timing/order by name/type | Captured | Review locally; guard against changes |
| Other noninternal triggers in public/iig_private | Captured | Traverse saved target/trigger edges locally, not just the original two |
| Named helper candidates and actual overload/type/default/variadic OIDs | Not fully captured | Small current catalog supplement needed |
| Creation helper's extension membership/namespace CREATE rights | Not fully captured | Supplement after its spelling is extracted privately; never assume gen_salt |
| ON CONFLICT uniqueness/index predicates, foreign keys and deferral | Not captured | Supplement required to verify trigger effects/deduplication |
| Complete column defaults/generated/identity metadata | Not captured | Supplement for the selected existing write targets |
| Current group data, paid/history fingerprints, writers, recovery completeness | Not established by catalog-only capture | Separate pre-install approval/scope later; NOT part of follow-up |

A further bounded READ-ONLY catalog review is essential before an installable fix,
unless equivalent current verified evidence already exists locally. This is not a
request to repeat the old inspection. A historical backup can help source review,
but cannot prove the current overload/index catalog is unchanged.

The current summaries narrow the single unknown call to create_golf_group. Its
spelling/binding has NOT been observed here. The new local audit extracts it from
existing bodies privately and classifies known extension/builtin spellings without
calling anything. No creation code is edited as part of this hotfix. Confirm whether
it is reachable from the save/trigger chain before declaring it irrelevant. No
hypothetical identity is reported as resolved.

## New offline audit/export package

[prepare_followup.py](../../tools/closed-entry-inspection/prepare_followup.py)
reads only catalog-private.json and report.json from the original private capture.
It reuses the classifier to inspect saved paths, exact safe group-column types and
reachable write targets/noninternal target triggers. It extracts candidate call
names and schemas privately; literals/comments are not used as SQL inputs. Complex
or uncaptured targets/dynamic SQL cause STOP rather than a broader automatic query.

It creates a NEW mode-700 folder outside Git, with mode-600 files:

- audit.SANITISED.json: shareable fixed labels, counts, safe version/types and
  already-sanitised call/path indicators and value-free saved owner-guard sketches. No raw bodies/credentials/private names.
- catalog.READONLY.REVIEW.sql: one bounded catalog-only transaction, review only.
- request-parameters.PRIVATE.json: exact private OIDs/helper names; do not share.
- manifest.json: current template/query/source hashes and explicit no-authorisation
  markers. Hashes anchor this export; they are not a historical backup checksum.

The original evidence is never rewritten. No backups, passfiles, services or CA
settings are created/changed. PostgreSQL OIDs can be decimal JSON strings; these
are accepted only as bounded positive digits and converted to integers, never SQL
fragments. Original metadata deparsing uses the same pg_catalog path as capture.

## Smallest follow-up packet, review required

The packet collects ONLY:

1. Candidate routines for call names found in saved source/paths: actual OIDs,
   signatures, argument/default/variadic metadata, extension membership, schema
   ownership/CREATE rights and EXECUTE flags. Already-saved bodies are suppressed;
   only genuinely uncaptured helper bodies are returned privately.
2. The existing group table and saved trigger/RPC write targets: columns, defaults,
   unique/partial indexes, FK/check constraints, deferral and policies.
3. Internal/noninternal triggers on those selected tables, timing/type/name/order,
   enabled state and dependency function OIDs. Already-saved bodies are not repeated.

Limits: at most 32 original routines, 32 reachable triggers, 64 source fingerprints,
12 saved target tables, 80 source call names, 10 schemas, 200 routine
candidates. No wildcard application-data query; no rows from any group, Auth, score,
payment, history, notification or capability table. No RPC invocation, DDL probes,
current_setting of owner credentials, service control or network fallback.

Before collecting new metadata, guards check TLS/read-only/execution identity and
EXACT captured server version, then captured function definitions/owners/config/ACL/
EXECUTE flags; trigger definitions/enabled state/function identity; selected table
identity/owner/ACL/schema ACL/RLS/column fingerprints and noninternal trigger counts.
Missing or changed captured scope aborts. This is not proof the entire database is
unchanged: data and uncaptured constraints/indexes require separate review.

Overload candidates are not automatically declared the runtime binding. Review them
against the stored call expression, input types and fixed paths. Custom types,
operators/casts, inherited paths or missing schemas remain explicit gaps. Discovery
of further unreviewed targets cannot silently widen this packet.

The new [followup_runner.py](../../tools/closed-entry-inspection/followup_runner.py)
is separate and OFFLINE by default. It regenerates SQL from the private source and
requires exact template/source/query/parameter/manifest agreement; it cannot execute
an arbitrary SQL file. The old runner and its approved SQL/hash registry are unchanged.

Future authenticated mode requires its OWN explicit project flag, exact-project
confirmation, READ-ONLY FOLLOWUP confirmation, TTY password prompt and existing
private direct-LIVE config. It retains verify-full, hostname/CA validation, scrubbed
PG environment, transaction-local read-only/timeouts/search path, backend SSL guard,
one connection, no retries and private evidence. There is NO connection command
approved in this document. A PASS only collects metadata; installation stays NO-GO.

## Minimal organiser authority and client bridge (design, not deployed code)

Keep existing golfer screens, final-total scoring and calculations. No full
registration beta or Supabase upgrade is needed to design this incident boundary.

- Keep the member PIN read/ordinary-save contract only within its existing threat
  model, with central server field/round guards. Do not pretend a shared PIN or a
  shared authenticated database role establishes individual organiser identity.
- Use a group-bound, high-entropy capability for privileged round operations, with
  private hash-only storage, expiry, revocation and minimum permissions. The tested
  fixture demonstrates checks, not real credential issuance. Use a CSPRNG for real
  secrets, never the repeated hex strings used in fixtures or a four-digit Admin PIN.
- Trusted operator verifies the organiser independently and issues one-group/device
  credentials through an approved secure channel. No automatic ownership inference
  from the shared PIN, mutable group JSON or the platform-wide creation code. Existing
  platform owner auth is not reused unless exact independent review establishes it.
- No secret in get_group_state, URLs, logs, shared state, Git or ordinary browser
  localStorage. Native secure storage/delivery remains dependent on released wrapper
  evidence; browser memory/re-auth is the safe baseline until reviewed. Revocation,
  expiry and recovery must not silently fall back to the old Admin PIN.
- Explicit UI operation routing: ordinary entry/score -> guarded ordinary save;
  Finish Round -> protected finish; newRound/nextTripRound -> protected setup/advance;
  corrections/cancellation/maintenance -> their own narrow verified operations.
  Do not infer authority merely from a changed history array/reset-shaped payload.
- Carry server round/revision as transport metadata; check key collisions and missing
  legacy IDs before deployment. Never silently assign the latest revision to an old
  snapshot. Account for real save() activity stamping, local queues and readback.
- A client nonce/receipt must make ambiguous finish/setup retries safe without
  double awards. Source calculations remain unchanged; server validates the proposal
  against committed entrants/scores/pot/history and approved tie choices. The fixture
  rejects duplicate commits; complete receipt UX and full adversarial award validation
  remain unfinished production requirements.
- Preserve ALL existing group controls through explicit bounded operations, including
  Side Game/settlement/settings updates and authorised Admin/owner maintenance.
  Do not ship the conservative fixture's unsupported-operation denials as accidental
  product regressions. Guard DELETE/INSERT/recreation and service/owner writers too.

All-groups rollout requires verified credential/device coverage and compatible
clients BEFORE activating the protected boundary. Old clients must not be allowed
a reset bypass; equally, a server switch that unexpectedly prevents legitimate
organisers finishing rounds is not acceptable. A staged rollout must label groups
still unprotected; never claim ALL groups are fixed while a legacy bypass remains.
Confirm web/native asset delivery/cache behaviour before scheduling activation.

## Migration/rollback gates retained

The fixture SQL is not installable production SQL. Need exact real schema binding,
actual trigger-side-effect integration, full malformed/adversarial result validation,
operator credential process, client routing and faithful TEST/iPhone verification.
No replacement of real triggers with synthetic ones or duplicate League/payout work.

Capture current recovery evidence including Group 1010's completed result and other
groups, exact owners/grants/triggers/indexes and drift hashes. Use bounded additive
DDL/private metadata where possible, no existing history/payment rewrites. Rehearse
object rollback; preserve populated archives, revocations and new results. No CASCADE,
row deletion, obsolete snapshot restoration or vulnerable-writer reopening shortcut.

## Tests and quickest next action

23 new exporter tests and 11 new follow-up driver tests passed OFFLINE. A synthetic
embedded PostgreSQL test validates generated packet syntax, matching fingerprints,
two overload candidates, actual FK/unique-index metadata and rejection after source
change. Its saved identity/TLS is explicitly mocked; the real exported TLS/version
guard is intact, not disabled. No online certificate/permission result is claimed.
The prior 23 actual-source lifecycle, 12 lock-contention and six role tests remain
previously passed results; no need to rerun unchanged concurrency experiments here.

Next Mac block (GitHub update plus OFFLINE audit/preflight only):

```sh
cd ~/Downloads/imingolf-rollback &&
test "$(git branch --show-current)" = "fix-closed-competition-entry" &&
git pull --ff-only origin fix-closed-competition-entry &&
python3 tools/closed-entry-inspection/test_prepare_followup.py &&
python3 tools/closed-entry-inspection/test_followup_runner.py &&
python3 tools/closed-entry-inspection/prepare_followup.py &&
python3 tools/closed-entry-inspection/followup_runner.py \
  --config "$HOME/Documents/ImInGolf-LIVE-Inspection/config.private.json"
```

Share ONLY the printed sanitised audit and preflight result. Do not paste private
parameters/SQL/config/catalog bodies. No password prompt or psql invocation occurs.
Then review the exact bounded scope/hash and seek approval for ONE authenticated
metadata follow-up. Do not run a connection flag now. Afterwards resolve real
bindings/constraints/side effects, complete the adapter and TEST/recovery review,
then seek separate installation and deployment approval. Current release: NO-GO.
