# Supabase TEST session-pooler findings — installation and retry remain NO-GO

Reviewed 24 October 2026 using the user's sanitised existing identity evidence
and official public documentation/source. No database connection, SQL execution,
service setting change or support message occurred during this review.

## Findings

The previous psql process succeeded using the exact TEST session-pooler hostname,
explicit official CA and mandatory sslmode=verify-full. Database, roles, version,
project-setting check and JSON parsing passed. This supports successful verified
**Mac-to-pooler** TLS; it is not evidence of a failed certificate handshake.

`pg_stat_ssl WHERE pid=pg_backend_pid()` describes the PostgreSQL backend's own
connection. With the shared pooler that is the **pooler-to-database** leg (or its
immediate upstream intermediary), not the Mac-to-pooler TLS session. The reported
false therefore means SSL was not in use on that database-side connection. It
does not establish the internal route or trust boundary. The runner must not
silently label this end-to-end TLS, accept false, or change to a different endpoint.

Supabase documents that SSL enforcement governs both legs of Supavisor connections.
The setting's actual status and the hosted implementation have not been reviewed
for this project. Do not infer the toggle is off from this result alone. An
unexpected false with enforcement enabled needs Supabase investigation. Changing
the setting can reboot the database and is NOT authorised here.

`transaction_read_only=on` and `default_transaction_read_only=off` are consistent:
BEGIN READ ONLY explicitly selects the current transaction's mode, whereas the
default determines the initial mode of new transactions. The identity transaction
was read only even though its backend's session default was off.

The runner previously requested the default and timeouts through libpq startup
options/PGOPTIONS. Supavisor terminates that startup protocol; client parameters
cannot be assumed to be passed verbatim to PostgreSQL. Current public Supavisor
source extracts selected startup fields into its handler rather than propagating
all generic GUC options there. This supports the observed non-propagation, but
is not proof of the exact hosted version or all possible configuration paths.
The previous guard correctly stopped at the missing requested protection, but
its reliance on startup defaults was not sufficient for this pooler path.

Read-only mode alone is not a sandbox for arbitrary SQL or side-effecting
functions. The hard-pinned approved query IDs remain essential. No application
RPC, DDL/write probe, backend termination or arbitrary SQL is permitted.

## Reviewed runtime correction, prepared OFFLINE only

Every BEGIN ... READ ONLY in every registered packet now immediately:

1. Selects pg_catalog as a transaction-local search path.
2. Establishes default_transaction_read_only=on using SET LOCAL, and establishes
   local statement/lock/idle timeouts. These are transient settings for that
   transaction only, not ALTER ROLE/DATABASE or changes to service configuration.
3. Checks actual transaction_read_only and effective default_transaction_read_only.
4. Requires database-side SSL to be exactly true; false, null or a missing row
   stops with a fixed error code before application/catalog capture queries.

The local default expires on COMMIT/ROLLBACK. It is not claimed to change the
backend's persistent/session default. Every following transaction establishes
its own protections again. Explicit BEGIN READ ONLY remains the immediate mode
protection; no SQL depends solely on a default. Startup options remain as extra
requests, not evidence that those requests reached PostgreSQL.

All original query bodies are unchanged beneath these prefixes. The query packet
hashes and pinned registry hash were deliberately updated. Original backup,
capture, rollback generator, comparison rules, baseline, migrations, permissions
and database records remain unchanged. No new query IDs or raw-SQL interface exist.

The Python identity confirmation still independently requires backend SSL and
both read-only values. Custom SQLSTATE labels distinguish database-side TLS,
explicit transaction mode and local-default failure. ON_ERROR_STOP aborts the
client after the first error; there is no retry, bypass or fallback.

**This correction does not solve backend_ssl=false.** Another attempt on the same
unchanged path would still be expected to stop. Do not retry just because offline
tests pass. Deployment, migration approval, recovery authority, writer controls
and real email testing remain outside this work.

## Official references reviewed

- [PostgreSQL pg_stat_ssl](https://www.postgresql.org/docs/18/monitoring-stats.html#MONITORING-PG-STAT-SSL-VIEW):
  one row per backend/WAL sender, statistics about SSL on that connection.
  [Official source](https://github.com/postgres/postgres/blob/REL_18_STABLE/doc/src/sgml/monitoring.sgml).
- [PostgreSQL transaction defaults](https://www.postgresql.org/docs/18/runtime-config-client.html#GUC-DEFAULT-TRANSACTION-READ-ONLY):
  default_transaction_read_only controls new transactions; transaction_read_only
  reflects the current transaction and can be explicitly selected.
  [Official source](https://github.com/postgres/postgres/blob/REL_18_STABLE/doc/src/sgml/config.sgml).
- [PostgreSQL SET / SET LOCAL](https://www.postgresql.org/docs/18/sql-set.html):
  local settings apply only until the current transaction ends.
- [Supabase SSL enforcement](https://supabase.com/docs/guides/platform/ssl-enforcement):
  explicitly governs both pooler connection legs; changing enforcement restarts
  the database. [Official source](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/platform/ssl-enforcement.mdx).
- [Supabase session-pooler connections](https://supabase.com/docs/guides/database/connecting-to-postgres):
  session mode is port 5432 using the dashboard's qualified username/actual host.
- [Supavisor startup handler](https://github.com/supabase/supavisor/blob/main/lib/supavisor/client_handler/protocol_helpers.ex),
  [client handler](https://github.com/supabase/supavisor/blob/main/lib/supavisor/client_handler.ex),
  [database handler](https://github.com/supabase/supavisor/blob/main/lib/supavisor/db_handler.ex):
  independent client/server TLS handling and selected startup-parameter extraction.
  Public main is reference implementation evidence, not a hosted-version attestation.

The SSL, connection, monitoring, configuration and handler sources were retrieved
from their official GitHub repositories. No project/API endpoint was queried.

## Next safe action — no database connection

View **only** TEST project nyavvwrsrxqfyhiygkgw in the Supabase dashboard, Database
Settings / SSL Configuration. Report the existing SSL-enforcement status. Do not
toggle it or change any setting. If the status cannot be established, stop.

A supported explanation/remedy for database-side SSL is required before another
connection. If enforcement is already enabled, obtain project-specific Supabase
confirmation explaining pg_stat_ssl=false through the exact session-pooler host.
If disabled, any proposed enforcement change requires its own approval and impact
review; this script never changes it. No support request is sent automatically.
Do not grant elevated roles, alter Auth ownership, bypass the backend TLS guard,
change endpoint, or assume Supabase's internal network removes this prerequisite.

Optionally update and validate local files with this OFFLINE-only block:

```sh
cd ~/Downloads/imingolf-rollback &&
git switch improve-new-user-registration &&
git pull --ff-only origin improve-new-user-registration &&
python3 tools/test-beta/test_readonly_runner.py &&
python3 tools/test-beta/readonly_runner.py --offline \
  --ca-file "$HOME/Documents/ImInGolf-TEST-Installation/test-supabase-ca.crt"
```

These tests inspect pinned SQL text and mock all client execution. They verify
transaction coverage, preservation of original query bodies, fail-closed TLS and
mode checks, fixed-code failure handling, sanitisation, original evidence and
connection guards. They do not execute PostgreSQL or prove runtime compatibility.
Offline PASS is not permission to retry; stop for review and explicit approval.
