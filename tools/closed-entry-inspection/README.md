# Group 1010 incident inspection runner — OFFLINE preparation only

Branch: fix-closed-competition-entry. No connection has been made. Read
[the inspection plan](../../docs/incident-closed-entry/READONLY-INSPECTION-PLAN.md).
This runner is separate from registration/TEST tooling and the fictional demo.

## Safe step available now on the Mac

From the repository checkout on this branch:

```sh
python3 tools/closed-entry-inspection/test_runner.py &&
python3 tools/closed-entry-inspection/runner.py
```

Expected: 21 tests OK; offline package PASS; database connections attempted: 0.
The tests replace subprocess calls with mocks. They do not run psql or SQL.
No Node package installation is required.

No online command is approved or supplied for copying at this stage. The explicit
--connect-live-readonly option is implemented for later review, not permission to
use it. Default mode does not launch any process, resolve DNS or prompt for a password.

## Exact proposed read scope

All statements are in inspection.sql, pinned by query-manifest.json. No arbitrary
SQL/config query inputs are accepted. Catalog queries run once in one connection,
within a repeatable-read READ ONLY transaction; initial safety SELECT aborts on
wrong database/role/major version, read-only settings or backend TLS. Statement and
lock timeouts are bounded. SET LOCAL affects only that transaction and disappears
at its end; there is no persistent database/session configuration change.

Collected sections:

1. Identity: database/role, exact version and read-only/backend TLS confirmation.
2. Fixed RPC names in public/iig_private (all overloads): get_group_state,
   save_group_state, owner_update_group, owner_create_group, owner_list_groups,
   create_group, reset_group, finish_round, start_round, confirm_payment, join_round,
   submit_score, set_admin_pin, owner_reset_admin_pin, owner_delete_group,
   create_golf_group. Definitions, signatures, owners, ACLs, configuration,
   SECURITY DEFINER and effective anon/authenticated/service_role EXECUTE checks.
3. Relations: public/iig_private table/partition metadata, owners, raw ACLs,
   schema ACL/owner, RLS/FORCE flags, column types/ACLs and effective table/schema
   privileges for postgres/anon/authenticated/service_role. No relation data reads.
4. Policies: policy expressions and target roles for those two application schemas.
5. Non-internal triggers on those schemas: enabled status, definitions and their
   function definitions/owners/security settings/ACLs.
6. Role membership edges and inherit/set/admin options, not passwords.
7. Superuser/inheritance/bypass-RLS flags for the four relevant roles.

No group rows, player names, scores, payments, pot, history, PIN hashes, Auth users,
credentials, session activity, settings secrets or application RPCs are read/called.
A function/policy/trigger definition MAY contain embedded private literals: treat
ALL raw catalog output as private. Nothing from psql stderr is printed or saved.

Review these definitions manually against the entry/payment/Admin/scoring/finish/
new-round matrix in the plan. Collection does NOT automatically establish closure,
authority, full writer coverage, fingerprint integrity or rollback readiness.
Unlisted helper/owner functions, dynamic SQL dependencies, column-specific effective
grant details, constraints/indexes/sequences, default ACLs, extensions/event triggers, writer
activity, baseline hashes, backup and recovery evidence are separate follow-up
scope; STOP and review fixed-query expansion OFFLINE before collecting more.
This deliberately small first pass is not the complete pre-install capture.

## Identity and TLS boundaries

The only accepted project is kzzzputsqxdntfqpprnz, taken from app/config.js in the
production Git source. This must still be independently confirmed by the owner
from the LIVE dashboard before connecting. A SQL literal is not identity proof.
Only direct db.kzzzputsqxdntfqpprnz.supabase.co:5432, database postgres, role postgres
is implemented. No pooler/TEST/IPv4 address/hostaddr/service fallback is permitted.
No paid IPv4 add-on, settings change or retry is attempted. If IPv6 has no route,
STOP. This runner does not solve that network limitation.

Private configuration must be owner-owned mode 600, not a symlink, with exactly
project/host/port/database/user/ca_file fields. CA must also be private mode 600,
valid PEM certificates (not keys), parsed offline by Python SSL. A CA accepted by
Python is not proof Homebrew libpq will accept a server certificate: psql separately
uses that exact CA with sslmode=verify-full and hostname validation. Invalid trust
or backend_ssl=false stops the inspection. Neither check is removed for a pooler.
A wrong PostgreSQL major version or absent required role/RPC also stops for review.

For later approved use only, connection parameters come exclusively from this
validated profile. Inherited PG*, database URLs, service/passfile configuration and
PSQL startup scripts cannot redirect it. psql is resolved from the trusted Mac PATH;
confirm the installed Homebrew executable/version during review. Password is read
interactively with getpass, held only in process memory/child environment for this
single exact target, never shell arguments, files or evidence. Local processes with
sufficient account/root access can inspect process memory/environment; use a trusted
Mac/account. There is no password storage or automatic reuse across connections.

## Private evidence and PASS/FAIL meaning

Output folder must be NEW and outside the repository. Parent must already exist.
Folder mode 700; files mode 600. No existing folder is overwritten. Keep it on the
Mac outside sync/shared folders; do not commit it. Successful parsing writes private
catalog-private.json and a minimal report.json. Failure suppresses raw database/
subprocess exceptions to avoid credential leakage, does not retry and does not
write partial raw output. Empty failure folders can remain. Console reports attempted
connections conservatively (pre-execution validation may count an attempt).

A PASS means only that all fixed catalog sections were collected. It explicitly
reports group_rows_read=0, baseline_verified=false, closure_enforced=false. The
connection is not proof that the migration can be installed or rolled back. Return
a sanitised summary, not raw function bodies, to the reviewer. Missing authority or
unknown alternate writers remain NO-GO. SQL syntax/server permissions have not been
validated against PostgreSQL: only offline structural and mocked-output tests run.

## iPhone source-only finding

Tracked files contain web assets and payment-return browser event handlers, but no
Swift/Xcode/Capacitor/Cordova wrapper project or released binary configuration.
External links and a web manifest do not prove what the App Store wrapper loads.
Dynamic loading, bundled assets, cache behaviour and Apple submission requirements
remain UNVERIFIED. Obtain the released build's matching native source privately;
inspect its initial URL/bundled entry and fallback/cache configuration offline.
Do not run the official app against LIVE to investigate this stage.

## Safety tests and remaining gates

21 offline tests cover default zero connections, immutable query identity/hash,
read-only/TLS guards, wrong project/host/port/role/config fields, missing/private/
symlink/wrong-owner/invalid CA files, TLS failure, hostile inherited PG environment,
result guard/identity parsing, missing RPC, exactly one mocked invocation, private
file modes, no secret persistence, no retry, sanitised failure and interactive-only
connection mode. Existing 15 client closed-entry and 10 sync/payout checks remain
separate. No SQL, migrations, emails, deployment or physical-iPhone tests occur.

Next: review this package and independently verify target/CA/network feasibility.
Only then separately approve the first explicit read-only connection. Do not alter
LIVE/TEST permissions, TLS settings, active Group 1010 records or any entrant.

## Share a sanitised summary AFTER a successful saved inspection

Use summarise.py, never paste catalog-private.json, report input, configuration,
function bodies or credentials. The summariser reads existing private files only;
it contains no subprocess, network client or SQL execution. By default it selects
the newest timestamp-named readonly-YYYYMMDDTHHMMSSZ folder under
~/Documents/ImInGolf-LIVE-Inspection. It fails rather than falling back to older
evidence. --folder can explicitly select a different existing inspection folder.
It does not modify evidence or create a new output file.

Run test_summarise.py, then summarise.py. Share ONLY its generated JSON. Output
is constructed from fixed labels, booleans, counts and allowlisted RPC/role names.
It excludes raw definitions, arguments, configuration settings, owners with custom
names, ACL strings, policy expressions, trigger names, role-membership names, local
paths and all arbitrary report strings. Even metadata can contain secret literals;
none is reflected. Read-only/TLS/project evidence is validated again from the saved
files. Files/folder must retain private permissions; no automatic chmod or repair.

Lexical references are explicitly NOT enforcement proof (comments or literals can
also match). Missing references do not prove absence of checks delegated to helpers.
Review summary before sharing. The summary cannot establish complete organiser
control flow, indirect dependencies, safe Finish Round transitions, baseline data
or rollback readiness; those remain separate review gates. Do not treat a successful
LIVE catalog capture as permission to install any database change.

Offline validation: 12 summary tests cover secret non-disclosure, null ACLs,
non-authoritative reference flags, wrong identity/project, unknown names, incorrect
boolean types, incomplete evidence, private files/symlinks, CLI output without
modification and sanitised failure. No actual inspection evidence is in Git.
