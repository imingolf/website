# Closed-entry incident: dedicated TEST read-only preflight

**Preparation only. No installation, deployment, service change or guard activation.**
This tool does not import, retarget or run the LIVE runner. The registration branch,
finished fictional demonstration and production app are unchanged.

## Next Mac step — entirely offline for databases

From the existing repository, update this bug-fix branch normally, run the tests and
prepare a NEW private package:

```sh
cd "$HOME/Downloads/imingolf-rollback" &&
test "$(git branch --show-current)" = "fix-closed-competition-entry" &&
git pull --ff-only origin fix-closed-competition-entry &&
python3 -B -m unittest discover -s tools/closed-entry-test-preflight -p 'test_*.py' &&
python3 -B tools/closed-entry-test-preflight/preflight.py
```

The Git update contacts GitHub only. Tests mock every database/client execution.
Preparation invokes **pg_restore --list only**, never restore or SQL. It prompts for
an existing official **TEST direct-connection CA certificate** file downloaded from
TEST's dashboard. Do not substitute the LIVE certificate or an arbitrary CA. If the
TEST certificate is unavailable, stop and report that prerequisite; preparation does
not download certificates or edit services. Files must be owned by you and mode 600
or stricter. No input permissions, configuration or evidence files are changed.

Default existing inputs (override only with explicit flags, never online URLs):

- `~/.pg_service.conf`, section `iig-test-only`.
- `~/Downloads/imingolf-rollback/docs/pr6-test-rollback-preparation/capture.json`.
- `~/Downloads/imingolf-rollback/docs/pr6-test-rollback-preparation/rollback.TEST.sql`.
- `~/Documents/ImInGolf-Backups/ImInGolf-Test-2026-10-22.dump`.

Outputs go to a fresh mode-700 timestamped directory below the existing
`~/Documents/ImInGolf-TEST-Installation/`; all files are mode 600. Do not attach the
manifest, SQL, catalog, original capture/rollback or service file to chat/GitHub.
Only `report.SANITISED.json`, after collection, is intended for sharing. No private
resolver SQL is requested, copied or executed.

Expected preparation result: **PASS — OFFLINE package prepared. Database connections
attempted: 0**. Missing or incompatible inputs mean STOP, not invented replacements.
Keep the printed package path for the separately approved connection command.

## Connection route and safeguards

The existing service is checked offline for the exact TEST host/user pair and
`verify-full`. It may name the previously confirmed session pooler
`aws-0-eu-west-1.pooler.supabase.com:5432` with user
`postgres.nyavvwrsrxqfyhiygkgw`, or the exact TEST direct endpoint. Other poolers,
users, ports, defaults, connection overrides and stored passwords are rejected.

**The selected route is explicitly direct**, not a pooler attempt or automatic
fallback: `db.nyavvwrsrxqfyhiygkgw.supabase.co:5432`, database/user `postgres`.
The service is evidence for the TEST identity; it is not passed to libpq. The command
is configured directly with this fixed endpoint. It needs working global IPv6
(e.g. the previously working iPhone hotspot). Preparation performs no DNS/TCP probe.
No upgrade, SSL setting change or network workaround is attempted.

Client-to-database TLS uses libpq `sslmode=verify-full`, the explicitly selected CA,
hostname verification, GSS encryption disabled and no inherited PG settings, hostaddr,
services, passfiles or URL. The server must additionally report SSL for this direct
backend. There is no relaxation for poolers. Wrong TEST project setting, if present,
wrong role/database, non-PG17 server, failed TLS or read-only confirmation stops.
Explicit `REPEATABLE READ READ ONLY` and local read-only defaults are both checked.
`row_security=off` makes inaccessible fingerprint rows error rather than silently
filtering; it does not alter or disable stored RLS policies.

Password prompt is hidden/interactive and goes only to this fixed TEST child process's
private environment. It is never a CLI argument, inherited password, file, report or
log entry. psql startup files are disabled; subprocess errors are not printed/saved.
No service is changed. There is one attempt, no retry; an attempt marker prevents
reusing a package after a failure. Failed connection diagnostics stay sanitised.

## Exactly what the approved transaction reads

1. Identity/TLS/version/read-only status and safe current project reference.
2. Function definitions, search paths, raw/effective EXECUTE permissions and ownership
   in `public`/`iig_private`; no application RPC is invoked.
3. Application relation columns/types/defaults, constraints/indexes, ownership, RLS,
   privileges and policies; trigger definitions, order/enabled state, function bodies
   and catalog dependency metadata in those schemas. PL/pgSQL dynamic dependencies
   are not proved complete by pg_depend; saved semantic evidence remains relevant.
4. Relevant schema/database CREATE privileges, inherited effective table ownership,
   role memberships, default grants, extensions and event-trigger metadata. No Auth
   trigger privilege assumption or DDL probe. This incident candidate creates no Auth
   objects, so PR6 Auth-trigger rollback authority is not reused as its authority.
5. Row counts and original-compatible fingerprints for **only the application tables
   named in the original TEST capture**, maximum 24 tables, schemas restricted to
   `public`/`iig_private`. Group scores, payments and history are included in whole-row
   group fingerprints. A pre-read guard rejects views, foreign tables, inheritance descendants and custom
   column types in the fingerprint scope before any application rows are read.
   Brief ACCESS SHARE locks (the normal SELECT lock) prevent concurrent schema swaps;
   they permit ordinary data writes, use a 500ms wait limit and release on transaction
   end. They do not pause services or establish writer quiescence.
   No group row contents are returned; no Auth user, identity,
   credential or token rows are read. Application settings rows are hashed, not exported.
6. Other current-database sessions' roles, application names, addresses, states and
   transaction starts. No query text, connection secrets, session termination or pause.
   Presence of `cron.job` is catalog metadata only; job commands are not read/executed.

The template has a reviewed hash. The bounded per-table fingerprint SELECTs are built
only from strictly validated identifiers in the original capture, never saved SQL
bodies, resolver predicates or arbitrary input. Preparation seals the exact query,
code and input hashes. They are rechecked before connecting. Local settings/timeouts
are transaction-scoped; no grants, DDL, data writes, application functions, email,
backup creation or external application requests are part of the transaction.

## Comparison and remaining readiness gates

The original application fingerprints, captured function definitions/ACLs/config/owners,
table inventory/permissions/RLS, triggers, policies, schema permissions and default ACLs
are compared. Drift saves private evidence plus a sanitised FAIL report and stops.
Auth fingerprints are explicitly **not compared**, and uncaptured dependent object
semantics still require review. A collection PASS never means the whole database is
unchanged or ready for installation.

The backup is checked for custom format and a readable inventory; its new SHA256
anchors this preparation only. The missing historical checksum is recorded explicitly.
Listing is not restore proof. The old PR6 rollback is hash-bound and preserved as
recovery evidence; **it is not executed and is not an incident-guard rollback**.
The previously reported local rehearsal is useful historical evidence, not proof of
current TEST parity or a rehearsal of this new candidate. Recovery stays UNVERIFIED
until the incident installer/retaining rollback and faithful hook rehearsal exist.

`writers.REVIEW.json` lists websites/old URLs, browser/iPhone sessions, Auth activity,
Edge Functions, schedules, API integrations and CI/manual tools. All start UNVERIFIED.
Neither empty sessions nor no deployed Edge Functions proves writer control. The
operator must review these sources outside this collector and later approve a pause/
drain procedure before installation. This runner neither accesses dashboards/APIs
nor pauses anything. Session evidence is only a point-in-time observation.

For first controlled TEST use only, a trusted operator will provision fictional
organiser/player capabilities after separate installation approval. Group-scoped
capabilities remain in memory and expire/revoke; no credentials are issued now.
Joining/scoring keeps its current simple flow. Production issuance/recovery UX remains
unimplemented. Metadata-only owner functions need definition review; owner whole-state
writes and deletion receive no guard bypass and must be kept unused/disabled during
controlled testing until a compatible protected route is reviewed. Merely hiding a
button is not a writer-control plan. The old TEST clients must be controlled before
installing the guard, because the database guard blocks their unversioned saves even
with the browser feature flag off.

## Future connection command — NOT authorised to run yet

After successful offline preparation, share only its PASS/FAIL and printed package
path. Receive separate approval before running the exact command below, replacing
`/FULL/PRIVATE/PACKAGE/PATH` with that printed path:

```sh
python3 -B tools/closed-entry-test-preflight/preflight.py --package "/FULL/PRIVATE/PACKAGE/PATH" --connect-test-readonly nyavvwrsrxqfyhiygkgw
```

It asks you to type the TEST reference, then prompts for the TEST password invisibly.
Use the hotspot if direct IPv6 is still unavailable on home Wi-Fi. Do not rerun a
failed connection or weaken TLS: report the sanitised result for review.

Successful collection: **PASS — bounded TEST read-only evidence collected.
Installation NO-GO. Database connections attempted: 1**. The report retains UNVERIFIED
writer control, recovery and new-target semantic review gates. Nothing in this
command approves installation, credentials, deployment or guard activation.

## Offline recovery when the existing service lacks verify-full

The original runner deliberately requires an explicit `sslmode=verify-full` in the
selected section. An older `require` setting encrypts but does not require hostname
verification; `verify-ca` does not require hostname matching; a missing setting is
not an explicit verification policy. The reported failure alone does **not** identify
which of these is on the Mac. `prepare-service.py` inspects just the validated TEST
section and prints only the recognised sslmode (or ABSENT), never the whole file.

For the owner's confirmed TEST dashboard certificate path:

```sh
cd "$HOME/Downloads/imingolf-rollback" &&
test "$(git branch --show-current)" = "fix-closed-competition-entry" &&
git pull --ff-only origin fix-closed-competition-entry &&
python3 -B -m unittest discover -s tools/closed-entry-test-preflight -p 'test_*.py' &&
python3 -B tools/closed-entry-test-preflight/prepare-service.py --ca "$HOME/Downloads/prod-ca-2021 (1).crt"
```

This helper has **no connection mode** and asks for neither a certificate path nor a
password. Quoting handles spaces/parentheses; accidental duplicate interactive path
entry is avoided. The certificate's filename does not establish its project: its
provenance is the owner's confirmation that it came from the TEST dashboard.

The helper leaves `~/.pg_service.conf` and the downloaded certificate byte-for-byte
unchanged. It creates a NEW owner-only TEST direct profile and CA copy in a private
folder, then invokes the same offline package preparation with those explicit files.
No LIVE profile/certificate is selected, no defaults or unsupported connection
parameters are accepted, and the main runner's verify-full rule remains unchanged.
The new profile pins the TEST direct hostname/user and explicit CA, with no fallback.

A downloaded **public** CA may be world-readable, but must be owned by the user,
not symlinked and not group/world-writable; private keys or invalid certificates
stop. Its new copy is mode 600 and passes the runner's unchanged strict file/SSL
parser checks. This does not install a system CA, edit service settings or downgrade
TLS. Backup, baseline and rollback validation still run and can independently STOP.
All input/evidence hashes and the original service's inspection summary stay local.

Expected: original TEST sslmode displayed, followed by OFFLINE PASS and a NEW private
package path, with zero database connections. Stop there for separate connection
approval. Additional offline service tests bring the preflight suite to 61 tests;
all 153 existing inspection tests also pass. No SQL is executed by those tests.
