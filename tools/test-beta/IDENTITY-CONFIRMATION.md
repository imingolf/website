# Investigating the TEST identity-confirmation failure offline

The reported run is `step2-20261024T120012.960988Z`. Its private evidence is on
the Mac, not in this repository or development workspace. No retry has occurred.

## What the error establishes

`TLS/read-only server confirmation failed` was raised by Python after:

1. psql exited successfully, using the runner's mandatory verify-full parameters;
2. its output parsed as exactly one JSON object;
3. database, current/session role and PostgreSQL version matched expectations.

A libpq certificate verification failure, failed connection, nonzero client exit
or malformed result would have stopped earlier with a different error. Therefore
this specific message is not the previous certificate-handshake error.

The combined condition previously required all of:

- JSON `ssl` is the boolean true, from pg_stat_ssl for pg_backend_pid();
- transaction_read_only is exactly the string `on`;
- default_transaction_read_only is exactly the string `on`.

It did not distinguish those failures. Missing values, wrong types or unexpected
values also correctly fail. No coercion or acceptance of missing values is added.

## Important pooler distinction

The Mac connects to the shared session pooler. pg_stat_ssl is observed inside
PostgreSQL, so its value concerns the pooler-to-database connection, not the
Mac-to-pooler certificate handshake. Both security observations matter; neither
is silently substituted for the other. A false/missing database-side SSL value
remains a blocker requiring supported Supabase investigation.

The identity query explicitly starts BEGIN READ ONLY, while startup connection
options request default_transaction_read_only=on. Through a pooler, successful
client option submission does not prove every startup setting reached the backend.
If the transaction is on but the default is off, that distinguishes session-default
propagation from transaction protection. This is a hypothesis until existing
evidence is inspected. Do not alter database/role defaults, insert new SET commands,
remove the default-mode check or change pooler endpoints to make the test pass.
The subsequently reviewed transaction-local correction and remaining backend-TLS
blocker are documented in [POOLER-REVIEW.md](POOLER-REVIEW.md).

See [Supabase connection guidance](https://supabase.com/docs/guides/database/connecting-to-postgres),
[PostgreSQL SSL statistics](https://www.postgresql.org/docs/18/monitoring-stats.html#MONITORING-PG-STAT-SSL-VIEW)
and [transaction settings](https://www.postgresql.org/docs/18/runtime-config-client.html#GUC-DEFAULT-TRANSACTION-READ-ONLY).

## Safe correction already implemented

The three checks now have separate failure messages and all remain mandatory.
The report records only allowlisted booleans and on/off/MISSING/UNEXPECTED flags.
Unknown database strings, credentials, user records and raw client diagnostics
are not included. TLS parameters, CA checks, query registry, original baseline,
rollback guards, SQL and connection count/retry behaviour are unchanged.

`inspect-identity.py` reads only the already-written `01-identity.json` and
`01-identity.client.json` from the specified existing evidence folder. It invokes
no subprocess, reads no service/password file, creates no report, modifies no
original evidence and makes no network request. Inspector success means it read
the evidence; it is not a database/security PASS or permission to reconnect.

## Exact next Mac command — no connection

```sh
cd ~/Downloads/imingolf-rollback &&
git switch improve-new-user-registration &&
git pull --ff-only origin improve-new-user-registration &&
python3 tools/test-beta/test_readonly_runner.py &&
python3 tools/test-beta/inspect-identity.py --evidence \
  "$HOME/Documents/ImInGolf-TEST-Installation/step2-20261024T120012.960988Z"
```

Return the sanitised output only, not the original evidence files, service file,
password or raw diagnostics. Stop on missing/incompatible evidence. Do not rerun
the connection or change settings. An actual connection-level correction cannot
be chosen safely until the failed field is identified. Further connection requires
separate approval after review, with all TLS and read-only guards preserved.

Offline tests cover each independent guard failure, missing/mistyped SSL values,
no application queries after identity failure, diagnostics sanitisation, local-only
inspection, immutable evidence, and malformed evidence without private-content
logging. No PostgreSQL statements or real client connections were used in tests.
