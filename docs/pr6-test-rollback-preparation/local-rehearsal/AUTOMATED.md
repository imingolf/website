# One-command local migration and rollback rehearsal

For the already-restored, sanitized local baseline described in this conversation.
This supersedes the manual migration/rollback commands in README.md; do not run
both workflows. No SQL has been executed by Codex. The actual Mac run is still
required before anyone can claim that migrations and rollback passed.

Run this single block in Mac Terminal:

```bash
(
  set -e
  IIG_REPO="$HOME/Downloads/imingolf-rollback"
  test "$(git -C "$IIG_REPO" branch --show-current)" = pr6-test-rollback-preparation
  git -C "$IIG_REPO" pull --ff-only origin pr6-test-rollback-preparation
  python3 "$IIG_REPO/docs/pr6-test-rollback-preparation/local-rehearsal/run-rehearsal.py" \
    --verify-recovery-from "$HOME/Documents/ImInGolf-Local-Rehearsal/local-restore-generated/automated-rehearsal-20261023T113617.009829Z"
)
```

Only git pull contacts GitHub. The Python runner has no online database URLs,
database connection strings or deployment commands. All SQL is passed via stdin
to psql **inside** supabase_db_ImInGolf-Local-Rehearsal using its Unix socket.
The runner never reconnects Docker networks, deletes golf rows or relaxes rollback
guards. It can gracefully stop precisely verified idle local Supabase services as
described below; it never stops the database. Its schema DROP statements come only from the existing
guarded rollback, with RESTRICT. The reviewed migrations' foreign keys with
ON DELETE CASCADE are left unchanged; no deletions are exercised.

## Resuming the completed rollback with the Python comparison error

The command above explicitly verifies the reported 20261023T113617.009829Z run.
Do not remove the recovery flag to bypass a mismatch. It requires that prior
report to record completed rollback SQL for the same database container, and reads
its original-before.json, after-rollback.json, audit-before.json and
audit-after-rollback.json without changing them. Missing or inconsistent evidence
stops the run before migrations.

The cause of `'NoneType' object is not iterable` is the previous comparator's
generic handling of any field called `acl`. Function audit ACLs are expanded JSON
grant arrays; column audit ACLs are `pg_attribute.attacl::text`, normally SQL NULL
or otherwise an ACL string. The old code tried to iterate NULL column ACLs and
also incorrectly sorted strings as characters. The fix sorts **only function
grant arrays**, while comparing nullable column ACL text exactly. NULL is not
coerced to an empty list or treated as a permission exemption. Malformed function
ACL arrays and missing inventory arrays still fail explicitly.

Before any new migration, the runner now:

1. Rechecks the prior saved rollback snapshots using the corrected comparison,
   including every original fingerprint, effective grant, raw column ACL, normal/
   event trigger, RLS/policy/catalog, sequence, index and constraint check.
2. Keeps all existing local-only/client-drain guards, verifies the actual current
   database against the original before.json, then compares its supplementary audit
   against the prior run's original audit-before.json. It does not adopt the
   post-rollback database as a new baseline to conceal differences.
3. Prints confirmation that both prior rollback evidence and the current database
   match the original baseline, then starts the ordinary four-migration/guarded
   rollback rehearsal. Any mismatch prevents the first migration.

For a genuinely new disposable baseline with no previous run, recovery verification
is optional; the normal mandatory before.json and current-database checks remain.
For this reported run use the exact command above. Exceptions now also save a
private exception.txt traceback so future Python faults identify the code path.

## What it checks and does

1. Requires the rollback preparation branch with no tracked edits; local Unix
   Docker context; the exact running Supabase PostgreSQL 17.6 container; zero
   attached networks; no host/shared networking. Rechecks isolation/container ID
   before every SQL invocation. SQL independently checks the socket, server version,
   database and role, and refuses other database clients or prepared transactions.
   A dedicated read-only preflight first identifies Supabase service connections
   and drains only positively attributed idle local services; see the next section.
2. Checks all four migration SHA-256 values against commit eadb495, plus any
   already-extracted migration files. Requires before.json and rollback.LOCAL.sql
   in ~/Documents/ImInGolf-Local-Rehearsal/local-restore-generated.
3. Regenerates the expected LOCAL rollback offline and requires the prepared file
   to match, including every original guard. Refuses altered/missing files or a
   current baseline differing from before.json in protected data or captured
   functions/ownership/effective permissions, triggers, RLS, policies and catalogs.
   No replacement rollback baseline is silently created.
4. Requires groups 3520/5021, two owners, three members, three verified fictional
   credential-free users, empty Auth identities/session/refresh/MFA/flow tables,
   intended client-role attributes, explicit RLS on all eight application tables,
   necessary privileges, and no active cron jobs if that extension exists.
5. Captures supplementary evidence for all eight application tables, identity
   sequence, group-history hashes, all public/private/Auth function definitions and
   effective ACLs, columns, constraints and indexes. The older before.json did not
   contain all of these: supplementary comparisons cover **this run's** initial
   state, after it passes the original before.json checks.
6. Runs the four pinned migrations, each in its existing transaction, in order.
   Checks protected fingerprints after each. Stops immediately on any error.
7. Checks installed function ownership/SECURITY DEFINER/search_path and effective
   anon/authenticated/service-only RPC access; private new-table emptiness, RLS,
   policies and client permissions; unchanged history, all original application
   data, sequence, roles/default ACLs, existing table settings/triggers and other
   functions. Calls no gameplay/account/subscription RPCs.
8. Only after those checks pass, runs the **prepared** guarded rollback. Its locks,
   data fingerprints, new-table emptiness checks and RESTRICT operations remain
   intact. It does not try rollback automatically after installation failures.
9. Repeats baseline and supplementary comparisons, including original functions,
   owners/effective grants/grant options, policies, normal/event triggers, RLS,
   columns, indexes, constraints, all application data/history and sequence state.

## Local Supabase background clients

Supabase Auth, REST, Realtime, Storage, metadata and analytics services use normal
PostgreSQL `client backend` connections. They are different from PostgreSQL's own
autovacuum/background processes (which the guard already excludes). The original
guard rejected both local service clients and unexpected clients without diagnostic
detail. Docker network disconnection alone does not close pre-existing TCP sessions.

The updated preflight uses a **dedicated READ ONLY catalog query** to record each
client's PID, role, application name, source IP/port, state and transaction/backend
start time. It never captures query text. The connection still must be to the
isolated local container's Unix socket as postgres 17.6, with no prepared transactions.
This diagnostic query can observe the clients that block the ordinary guard; it
cannot install migrations or perform rollback. All ordinary captures, SQL writes
and rollback retain the unchanged zero-other-client guard.

A client qualifies for controlled drain only if all of these match:

- Exact service container name for ImInGolf-Local-Rehearsal and matching
  com.supabase.cli.project label.
- A specifically allowed official Auth/REST/Realtime/Storage/metadata/analytics
  image, running in this local Docker context, with the same container ID on recheck.
- The PostgreSQL client source IP uniquely matches that service's Docker IP and
  the database role is expected for that particular service. Application/role
  names alone never prove origin.
- Docker network inspection independently confirms the same container ID, network
  ID, endpoint ID and IP on supabase_network_ImInGolf-Local-Rehearsal. Any present
  network project label must agree. The service must have started no later than
  the database backend, preventing a restarted/replacement container from gaining
  trust merely by reusing an old IP.
- The connection is idle and has no transaction. Busy clients and open transactions
  are not interrupted. Proxy/pooler connections, socket/loopback connections,
  ambiguous addresses, unexpected roles or unknown services are not auto-drained.

For each qualifying service the runner explains why it must stop: its live
connection can start a transaction during the rehearsal. It then rechecks all
clients and gracefully stops only that service ID using `docker stop --time=-1`.
There is **no SIGKILL escalation, pg_terminate_backend, pg_cancel_backend, database
restart, role exemption or general session termination**. The Docker wait is bounded;
if the service fails to stop gracefully, the run fails before migrations.

The runner waits briefly for PostgreSQL to observe the closed connections, then
requires **zero other clients** before the baseline check or any migration. A stale
socket left by network disconnection causes FAIL with clients-after-drain.json;
it is never force-terminated automatically. A new/active/unknown client also fails.
Use the private diagnostic report to identify the remaining source before another
attempt. Do not remove the safeguard or manually kill all sessions.

The stopped local services are recorded in report.json and remain stopped, so they
cannot reconnect during or after rollback. No other project containers are stopped,
no networks are reattached, and services are not automatically restarted. If graceful
shutdown changed protected data, the subsequent original before.json comparison
fails; the runner never rewrites that capture to excuse the change.

This is a safe local-only drain, not proof that every reported role came from a
particular service on your Mac. Unattributed clients intentionally produce FAIL
and usable diagnostics instead of an invented classification.

### Explaining the reported 172.18.0.8 clients

PIDs 281–287 represent **seven** connections. The prior report did not retain
rejected container identities, so it cannot establish their source. Neither
supabase_admin nor 172.18.0.8 identifies a specific service. No such attribution
has been made from Codex, which cannot inspect the Mac Docker daemon.

The runner now inventories all running container identities (read-only), including
rejected candidates, instead of looking only at already-approved service names.
It writes docker-client-container-inventory.json and the independently inspected
docker-project-network-inventory.json. For each database client it records the
matching Docker owner candidates and exactly why a candidate is rejected: name,
project label, official image, role, missing endpoint corroboration, or container
start after backend start. Registry-qualified forms of the same explicitly allowed
Docker Hub images are recognized; arbitrary registries/services are not added.
No container environment variables, commands, secrets or SQL query text are saved.

On FAIL the terminal/report includes candidate container name/ID, image, project
label and rejection reason, so another diagnostic command is not required. An IP
match is only an observation: without all the verification above, no stop occurs.
Pooler/proxy, unknown service or changed/reused identity remains a blocker. This
does not automatically add whichever service happens to own the reported address.
All migration, data, rollback and zero-client guards remain in place.

## Results and failures

The runner prints progress followed by PASS or FAIL, and saves private report.txt,
report.json, JSON captures, exact SQL inputs, stdout and stderr under:

`~/Documents/ImInGolf-Local-Rehearsal/local-restore-generated/automated-rehearsal-<UTC timestamp>/`

PASS requires all four installations, the guarded rollback, and every final
comparison to complete successfully. A PASS from this runner is local rehearsal
evidence only. NULL versus explicit function ACL representation and array order
may differ; effective grants and grant options must match. Function and table
owners must match. No system catalogs are directly modified.

FAIL means stop. The report lists the completed migration files, failure stage,
whether rollback SQL completed, and logs. Earlier files may remain committed;
there is no automatic retry, full restore or data deletion. If interrupted while
Docker/psql is executing, execution state may be uncertain: inspect the report
and database before retrying. Queries have server-side lock/statement/idle
transaction timeouts. The application lock file prevents concurrent runner starts;
a hard crash can leave a stale lock, which requires inspection before removal.
Missing prerequisites before a run directory can be created produce a terminal
FAIL message. A report cannot be guaranteed if disk access itself fails.

## Remaining limits

- Mac Docker and PostgreSQL execution cannot be tested from Codex. The automation
  has been reviewed and tested offline with synthetic captures and mocked command
  boundaries. Those tests execute no SQL and are not restore/rollback success.
- PostgreSQL 17.6 differs from online TEST 17.11. The runner deliberately refuses
  other versions/images rather than guessing compatibility.
- Intended local ACL reconstruction cannot recover omitted online ACLs or prove
  original online ownership/service behaviour.
- Fictional Auth records and the schema-only pass do not test real OTP AMR,
  sign-in/email flows, deletion services, Edge/native wiring or physical iPhones.
- No runtime-mutating feature tests occur: transfers, account deletions,
  subscriptions, scoring or history claims would intentionally block this guarded
  rollback and need another disposable test pass/recovery plan.
- Keep the local container isolated. No TEST/LIVE, deployment or release approval
  is implied by a PASS.

Offline regression tests (maintainer use only, not required for the Mac run):
`python3 test-automation.py` and `python3 test-selection.py` from this directory.
