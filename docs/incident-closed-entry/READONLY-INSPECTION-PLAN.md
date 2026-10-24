# Proposed LIVE inspection — approval required, not executed

Scope: fix-closed-competition-entry only. This is a plan, not a connection runner
or permission to connect. No SQL statements are supplied for execution. Preserve
Group 1010's three legitimate entrants and all existing records. Do not repeat the
owner's manual correction, adjust paid flags, or recalculate/save its pot.

## 1. Review the method before the first connection

Develop a separate, incident-specific read-only runner OFFLINE, if approved next.
Do not repurpose the TEST runner by replacing its project reference: its TEST-only
safeguards and the registration branch must remain intact. Review query text and
hashes, mocks and failure handling before seeking connection approval.

Obtain the intended LIVE project reference and exact endpoint from its owner and
independently reconcile against repository configuration and dashboard metadata.
Do not paste keys, passwords or credential-bearing URIs into chat or Git. Do not
assume the TEST service, stale config, a SQL literal, DNS alone or a successful
login proves identity. Use a new private, explicit target profile with no fallback.

Runner requirements before approval:

- Exact approved host, port, database, project identity and role allowlist; reject
  hostaddr, alternative services, ambiguous options and inherited PG defaults.
- TLS verify-full with trusted CA and hostname checking; password private prompt
  or exact scoped credential source, never arguments/logs/evidence. Inspect TLS
  setup offline first. No automatic retry, alternative endpoint or TLS downgrade.
- Preserve both client TLS and backend-connection evidence. If a pooler reports
  non-TLS backend, STOP for review; do not repeat the unresolved TEST assumptions.
- One connection, explicit READ ONLY transactions, transaction-local read-only and
  short statement/lock/idle timeouts, verify effective settings before each batch.
  No user SQL, function calls with possible side effects, EXPLAIN ANALYZE, DDL probes,
  SET ROLE, locks FOR UPDATE, session termination or application RPC invocation.
- Approved SELECTs over catalogs and narrowly scoped hash/count summaries only.
  Metadata helpers such as pg_get_functiondef must be individually reviewed.
  No arbitrary evaluation of stored functions, dynamic SQL or client-provided names.
- Fail closed on identity/TLS/read-only/privilege/parser failure or unexpected
  object/version. No privilege changes. Each attempted connection counted in report.
- Private Mac-only output with restrictive file permissions and sanitised PASS/FAIL
  report; never commit captures. Function definitions themselves may contain secrets,
  so raw metadata stays private and is reviewed/redacted before sharing.

Offline tests must prove zero connections by default, rejected wrong project/host,
no environment redirect, certificate failures, no write statements/application RPCs,
immutable query hashes, explicit read-only confirmation, bounded scope and safe
redaction. Only after review of runner and exact target seek explicit approval for
ONE read-only inspection. This document does not authorise it.

## 2. Minimum catalog evidence

Record PostgreSQL/platform version, database/current/session roles, effective role
memberships and ownership inheritance without assuming TRIGGER or EXECUTE means
ownership. Identify exact schema/table OIDs rather than assuming the setup file is
current. Inspect:

- Every overload of get_group_state and save_group_state; identity arguments,
  full definitions/hash, return types, language, owner, SECURITY DEFINER/INVOKER,
  search_path/proconfig, volatility and dependencies. Inspect owner_update_group,
  group creation, reset/finish/entry/payment/score RPCs actually present and related
  helpers. Start with known names and dependencies, expand only after offline review.
- Schema USAGE, table/column SELECT/INSERT/UPDATE/DELETE, effective PUBLIC/anon/
  authenticated/service_role and function-owner privileges, default versus explicit
  ACLs including null ACLs, grantors, sequence grants, RLS enabled/FORCE flags and
  every applicable policy/normal trigger/event trigger. Account for bypass-RLS roles.
- Full definitions and enabled status of all triggers on the identified group
  table and their functions. Catalog dependency lists miss dynamic SQL; inspect
  relevant bodies and inventory external writers separately. Do not claim completeness
  from a name search or pg_depend alone. Do not dump unrelated Auth user data.
- Available revision/round identity and ownership/admin authority storage; how RPCs
  derive the caller. Determine whether server-verifiable credentials/roles exist.
  Client isAdmin/localStorage, a shareable PIN or JSON admin fields are not authority.

Initial group-data summary is restricted to Group 1010: group row count, round
identity/status/format, count of paid entrants and score/NR/pair submissions,
canonical whole-state/history/payment-and-entry fingerprints and state size. No
names, email addresses, banking links, PIN hashes or raw admin credentials in report.
Use the existing data types and semantics, not guessed casts or PIN-hash scans.
If a unique group cannot be identified safely from supported metadata, STOP.

Do not test behaviour by calling get/save RPCs, joining, sending payment, or
finishing a competition. Existing data and source inspection establish evidence;
behaviour testing uses fictional local/TEST data only after separate approvals.

## 3. Lifecycle map to reconcile with deployed functions

| Operation | Allowed after entry closure? | Invariant |
| --- | --- | --- |
| Join group as an unpaid member | Yes | No active-round eligibility or pot increase |
| Enter/confirm payment or attendance | No | Existing entry/payment snapshot retained |
| Submit legitimate entrant's score/NR/pair score | Yes | No other entry/payment changes |
| Correct score | Only existing authorised process | Closure never reopens |
| Finish Round | Only verified organiser lifecycle operation | Entries frozen; results/history saved once |
| Start next round / Trip advance | Only verified organiser lifecycle operation | Server issues next identity; old requests rejected |
| Owner rename/settings update | Only permitted fields | Cannot overwrite round or circumvent guard |

Trace source paths including app/config.js overrides and owner dashboard fallbacks,
initial-load cleanup/save calls, Admin add/remove/reset, free rounds, normal Money,
Trip individual and pair rounds, Side Games, payouts and League updates. Establish
which state fields each changes and which server writer authorises it. Confirm any
scoreSubmitted/legacy score representations before defining closure. Never infer
that every unpaid group member is an entrant, or close unrelated Side Game entry
based on a different competition without reviewing the existing rules.

## 4. Atomic design proposal, conditional on catalog findings

Use the smallest central boundary supported by the actual schema. Prefer a guard
on the shared group table to cover every ordinary writer, combined with explicit
server-authorised lifecycle operations. A locked save RPC alone is sufficient ONLY
if all alternate table/owner/service writes are demonstrably guarded or prohibited.
Privileged owners can disable triggers; this requires operational writer control,
not a claim that a trigger protects against the database owner.

Maintain server-controlled round identity/revision, closure latch and frozen entry
snapshot outside client-writable JSON (private metadata or protected columns).
Location is undecided pending inspection. No client may set/clear the latch or
impersonate a lifecycle operation through a JSON flag, custom GUC or session setting.

Within one transaction, acquire the actual group row lock, then read current state
and metadata. All writers use the same lock order; reject stale expected revisions
and identities rather than overwriting newer scores. First valid score atomically
latches closure and captures entrants from the committed PRE-transition state.
Reject a bundled first-score-plus-new-entry request. Validate eligibility to score.
If score commits first, subsequent entry fails. If entry commits first while still
open, it is legitimate and belongs in the frozen snapshot. Failed transactions
must leave both metadata and state unchanged.

For a round already scored at installation, initialise closure lazily under that
same row lock from the CURRENT committed state before validating the first write.
No updates to Group 1010's JSON are needed merely to establish the guard. Do not
backfill historical rounds or guess legacy identities. Resolve ambiguous eligibility
or missing identity semantics before installing; missing metadata is not an exemption.

While closed, reject active entry/payment/identity/eligibility changes and stale
snapshots removing scores; allow separately validated scoring and unrelated member
metadata changes. Preserve prior history and score/payment fields not explicitly
authorised. Freeze stake/pot-affecting settings. A guard must not silently discard
an invalid write and return success. Return a stable closure/conflict error that
new UI handles; verify how the old installed app presents an RPC rejection.

Finish/next-round operations must use a supported server-verifiable organiser
identity, enforce revisions, archive the exact frozen round atomically, prevent
double finish/awards and issue a fresh server identity. Require idempotency and
safe history/payout handling. Closure metadata persists even if scores are corrected
or removed. Bare whole-state resets must not create another writable round.

If deployed LIVE has only PIN-based whole-state authority and no trustworthy
organiser boundary, STOP: this design requires a reviewed compatible lifecycle
RPC/client change, not a small trigger pretending reset-shaped JSON is authorised.
Do not borrow uninstalled registration migrations or grant elevation. No migration
is installable until old-client scoring AND organiser transitions are proven safe.

## 5. App Store wrapper inspection — no LIVE requests

This Git tree contains no native wrapper project/configuration proving delivery.
Request the exact released build number and its corresponding native source/export
from the owner privately. Inspect locally: WKWebView initial URL, loadFileURL/loadHTML,
Capacitor server.url or Cordova start page, bundled www assets, allowed navigation,
cache/service-worker policy, offline fallback, redirects and remote-update mechanism.
Hash bundled HTML against the release source where available. Check signed build
configuration, not only a current development project or a remote link button.
Do not upload a binary, sign/rebuild, submit to Apple or run the official app against
LIVE as part of offline inspection.

Dynamic website loading may allow a website fix without an Apple submission, but
cache/bundled fallbacks can keep old clients running. Bundled assets normally require
an app update unless an existing supported mechanism is proven. Either way database
protection must cover old clients. Later approved physical-iPhone TEST tests must
include cold start, cached/offline resume and bank-return reload, with no real charge.

## 6. Exact backup and rollback prerequisites before any installation

An inspection capture is NOT a backup, and old TEST backups do not cover LIVE.
No new backup is authorised in this stage. For later approval require:

- Fresh LIVE recovery evidence in a separately approved controlled window: consistent
  database archive plus metadata inventory from the same stable state, PostgreSQL/
  dump tool versions, timestamp, archive listing, current checksum clearly labelled
  at creation, encrypted private storage and successful isolated restore rehearsal.
  Record all groups/history/entries/ownership fingerprints, not only Group 1010.
- Separate capture of owners, ACLs/grantors, policies/RLS, function definitions and
  signatures, triggers/order/enabled flags, constraints/indexes/sequences/default
  ACLs, dependencies, platform configuration and external jobs/services. --no-owner/
  --no-acl archive alone is insufficient. Document Auth/roles/extensions/configuration
  recovery gaps; never copy real credentials into a rehearsal or claim complete
  Supabase recovery from core-table restoration.
- Generated, reviewed object-level rollback restoring exact original definitions,
  owners and effective ACLs without restoring old application data over new scores.
  Record migration hashes/object identities; guards reject unexpected schema/state,
  dependencies, missing ownership or unreconciled activity. No CASCADE or data deletion.
  New populated guard metadata must be retained/reconciled, not dropped blindly.
- Prove install AND rollback ownership authority without DDL probes in LIVE. Rehearse
  against faithful local roles, then approved TEST. No test Auth-trigger changes
  are implied; scope only objects needed for this fix. Generic earlier TEST rollback
  is not a rollback for this incident guard.
- Writers inventoried and controlled by an approved, short maintenance plan. Do not
  terminate sessions or pause services now. If safe compatibility requires interrupting
  active entrants, postpone installation until the active round ends; preparation
  can continue. A transaction-lock timeout must abort, never wait indefinitely.
- Removing the guard reopens late entry. Prefer forward repair. Any rollback needs
  controlled writers or a compatible fail-closed protection; no blind automatic
  rollback into the vulnerability while phones can still save.

## 7. Regression and release sequence

Existing offline client checks: 15 closed-entry scenarios and 10 sync/finish/payout
checks passed at d36c344. No server SQL enforcement has been tested or delivered.

After design approval implement fixtures and database tests locally, then request
TEST writes separately. Require real concurrent transactions (not just mocks):
three paid entrants, one scorer, fourth member; old/new RPC and direct UPDATE;
score-before-entry and entry-before-score; repeated requests; stale full snapshots;
first score bundled with late entry; forged new round/reset/history; deletion and
ID substitution; zero/NR/pair scores; existing paid scoring; correction; legitimate
Finish Round/new round/Trip advance; exactly-once payouts/League/history; membership
without entry; other groups including legacy shapes; owner/settings writes; RLS/
ACL negative tests; failure atomicity; rollback and post-rollback fingerprints.

Safest gates:

1. Approve this plan and preparation of a separate OFFLINE-validated inspection
   runner; obtain native release artifacts separately. No connection yet.
2. Review runner/query hashes/exact target, then separately approve one read-only
   LIVE inspection. Review findings; STOP if authority or recovery is inadequate.
3. Approve exact DB/client design, implement/rehearse locally, then separately approve
   isolated TEST installation and physical iPhone verification. No real payments.
4. Review fresh backup/recovery and current state in an approved controlled window.
   Revalidate fingerprints just before release; normal new scores require a reviewed
   current capture, never silently reusing an obsolete rollback baseline.
5. With explicit LIVE release approval only, install compatible server guard first,
   bounded transaction/locks, postcheck unchanged protected data and permissions;
   release UI separately. No synthetic join/score probes in active Group 1010.
   Do not release server-first if it breaks old Admin/Finish Round clients; use a
   separately approved compatibility transition or wait for a safe round boundary.
6. Website/Apple work depends on wrapper evidence and separate approvals. Monitor
   sanitised rejection/error metadata only; preserve every legitimate score/payment.

Current outcome: NO-GO for LIVE connection or installation. This stage creates
planning documentation only, not a runner, SQL package, backup or deployment.
