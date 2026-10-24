# Step 2 Mac read-only reviewer

Status: implemented and tested OFFLINE only. No database connection or SQL
execution has been performed during development. First connection requires
separate approval. No installer is included.

## Next safe step: local files only

In Mac Terminal, using the existing repository:

```sh
cd ~/Downloads/imingolf-rollback &&
git switch improve-new-user-registration &&
git pull --ff-only origin improve-new-user-registration &&
git fetch origin pr6-test-rollback-preparation &&
python3 tools/test-beta/test_readonly_runner.py &&
python3 tools/test-beta/readonly_runner.py --offline
```

Stop if any command fails. Do not reset, overwrite evidence or substitute a new
baseline. Fetching the rollback branch supplies pinned Git objects only; it does
not check out or merge that branch. This block never connects to a database.
The tests use synthetic evidence and mocked database clients exclusively.

The offline reviewer checks the existing service and original private evidence,
compares the original rollback byte-for-byte with its pinned generator, verifies
local rehearsal PASS evidence and migration hashes, and reads the backup archive.
It runs `psql --version` only, and pg_restore inventory/output-to-/dev/null only:
no restore, SQL execution, backup creation or database target is involved.
It requires PostgreSQL client tools 18.6 and the recorded backup source 17.11.

Expected local files (not uploaded or committed):

- `~/.pg_service.conf`, section `iig-test-only`.
- Repository `docs/pr6-test-rollback-preparation/capture.json` and `rollback.TEST.sql`.
- `~/Documents/ImInGolf-Backups/ImInGolf-Test-2026-10-22.dump`.
- `~/Documents/ImInGolf-Local-Rehearsal/local-restore-generated/automated-rehearsal-20261023T115001.671715Z/` with its report, original/installed/final captures and audits.

Private reports go to a new mode-0700 folder under
`~/Documents/ImInGolf-TEST-Installation/step2-…`; files are mode 0600.
The existing parent directory must already be privately owned and mode 0700 if
present. The runner stops rather than changing its permissions automatically.
Original evidence is never rewritten or uploaded. Offline PASS means local
prerequisites passed, not that the current online baseline was checked.

## Connection boundaries, for a later approved run

No argument, or `--offline`, cannot connect. The separate connection option is
`--connect-test-readonly` followed by the exact TEST reference; do not use it yet.
The only allowed project is `nyavvwrsrxqfyhiygkgw`.

The service must unambiguously describe either its exact direct TEST hostname or
the previously used `aws-0-eu-west-1.pooler.supabase.com` session pooler with
`postgres.nyavvwrsrxqfyhiygkgw`, port 5432 and database postgres. Direct connections
allow postgres or the exact TEST-qualified username. Other hosts, hostaddr,
transaction pooling, custom options, implicit defaults and ambiguous credentials
are rejected before any connection. Effective TLS is always verify-full with
system CA trust or an explicitly configured local root certificate; no downgrade
or alternate target is attempted. Failure of TLS trust requires review.

Inherited PG connection/password variables are removed. Default pgpass lookup is
blocked. A service passfile must be privately owned, mode 0600 and contain exactly
one explicit matching TEST entry, with no wildcard. A configured inline password
requires a private service file. If neither exists, only the later approved online
run prompts invisibly in an interactive terminal. No echoed-input fallback,
password arguments, password logging or credential evidence is allowed. Passwords
are passed only to each verified TEST client process, never global environment.
Raw client errors are discarded in favour of fixed diagnostic labels.

Connection identity is bound by the exact host, verified TLS, project-specific
pooler username and explicit settings before connecting. The first fixed query
then verifies database, current/session role, PostgreSQL 17.11, TLS and read-only
mode, plus any available project setting. A SQL literal is not identity proof.
Failure stops before application queries.

Only hash-pinned query IDs can execute: identity, original capture, catalog/
ownership assessment and supplementary audit. There is no arbitrary SQL/file
execution option. All queries use explicit read-only transactions; client defaults
also enforce read-only mode, timeouts and ON_ERROR_STOP. No role switching, DDL,
application RPCs, session termination, service control, API calls or email occurs.
SQL syntax, hosted permissions and actual results remain untested until approval.

## Comparison and remaining gates

The original eight-table fingerprints and complete captured security inventories
are compared before further assessment, then compared again at the end. Function
definitions/owners/grants, role memberships, triggers, policies, RLS, nullable
column ACLs, prerequisites, sequence and notification fingerprints are checked.
A changed baseline stops the review; it is never adopted automatically.

There is no historical checksum for the original backup. A newly observed hash
is labelled as such, never saved as an invented historical anchor. An existing
anchor, if present, must match. Read-through checks plus the recorded local
core-data restore do not prove historical provenance or complete hosted Auth,
ACL and service recovery. Fictional local Auth identities cannot establish online
Auth-row equality. These limitations remain explicit in the report.

Normal session inventory and writer locks are reported; quiet sessions do not
prove external writers are paused. No services are paused. External writer
controls and SMTP/Auth dashboard settings remain UNVERIFIED.

Native effective Auth-table ownership is assessed. TRIGGER privilege, SET-only
membership and an exact Supautils grant setting are not accepted as proof of
DROP TRIGGER authority. Without native authority or separately reviewed supported
confirmation, this remains FAIL/NO-GO, even if the baseline comparison passes.
The runner has no mechanism to grant privileges or override this gate.

A future read-only PASS still never authorises installation, emails or publication.
The report always retains installation_authorised=false and release NO-GO.
Review the offline report first and obtain approval before the first connection.

## Explicit CA review after the Mac TLS failure

See [TLS-REVIEW.md](TLS-REVIEW.md) for official guidance, limitations and the exact
next offline-only Mac command. `--ca-file` selects an official CA for one run
without editing the service. Explicit files are parsed and checked offline;
verify-full and hostname checking remain mandatory. Inherited SSL_CERT_FILE and
SSL_CERT_DIR no longer influence child clients. Do not reconnect until approval.

## Identity confirmation after successful TLS negotiation

For `TLS/read-only server confirmation failed`, use the
[offline identity-evidence inspection](IDENTITY-CONFIRMATION.md) before any retry.
Database-side SSL, transaction mode and session-default mode now have separate
mandatory checks. The inspection command reads existing Mac evidence only.

## Confirmed session-pooler findings

[POOLER-REVIEW.md](POOLER-REVIEW.md) separates verified client TLS from backend
TLS and explains the observed transaction/default modes. Every registered
transaction now establishes and verifies transaction-local safeguards. Backend
SSL=false remains a blocker: no connection retry is authorised by offline PASS.

## Direct connection alternative — proposal only

The existing runner already supports the exact TEST direct hostname.
[Direct-connection review](../../docs/online-beta/DIRECT-CONNECTION-REVIEW.md)
describes its IPv6/IPv4 prerequisites and the credential-free separate-profile
example. The default pooler service is not changed and no connection fallback is
added. No database connection is authorised by these offline tests.
