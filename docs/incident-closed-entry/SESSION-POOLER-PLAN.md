# LIVE incident session-pooler feasibility — no connection authorised

Scope: Group 1010 incident branch only. Public official documentation reviewed;
no project, database, Management API, DNS or port probe was accessed. No SSL settings,
permissions or records changed. The current runner remains DIRECT-ONLY unchanged.

## Supported route and evidence limits

Supabase's shared Supavisor session pooler is the supported IPv4 alternative on
Free: exact project dashboard host, port 5432, database postgres, client username
postgres.kzzzputsqxdntfqpprnz. Backend execution role remains postgres. Do not copy
the TEST regional host or infer a host from a region. Reject transaction port 6543,
dedicated paid pooler, custom proxy, arbitrary IP, hostaddr and fallback endpoints.

There are two TLS connections: Mac -> pooler and pooler -> PostgreSQL.
libpq verify-full and sslrootcert verify the client-facing pooler certificate and
hostname only. pg_stat_ssl for pg_backend_pid describes PostgreSQL's own connection,
not the Mac-to-pooler socket. Require both protections; do not treat the earlier
TEST backend_ssl=false as a failure of client TLS or as a LIVE observation.

Official guidance says SSL enforcement governs both Supavisor legs and that changing
it restarts the database. Current LIVE status is unknown. ON is useful configuration
evidence, not proof of an actual connection's TLS. OFF does not by itself prove an
actual backend uses plaintext, but provides no enforcement assurance; obtain a
supported project-specific explanation before proposing an attempt. Do not change
this setting during an active round to unblock inspection. If ON and a later
approved guard reports false, STOP and seek Supabase clarification, not a bypass.

The official LIVE project CA already downloaded is a candidate, not proof of
pooler-hostname compatibility. Review official trust instructions for the exact
pooler endpoint. Keep its explicit CA file, trusted provenance, PEM/private-file
checks and libpq verify-full. An offline parse or valid certificate date cannot
verify the remote server chain/SAN. If a different official trust bundle is required,
review its provenance separately; never download an unverified server certificate
and declare it trusted. No require/verify-ca downgrade or hostname override.

## Single next step — dashboard metadata only

Owner views ONLY project kzzzputsqxdntfqpprnz:
- Connect -> Session pooler: report host, port, database and username ONLY, no password
  or full credential-bearing URI. Confirm mode is session.
- Database Settings -> SSL Configuration: report the existing Enforce SSL on
  incoming connections state. Do not toggle, save, restart or change anything.

Do not connect with psql or run the incident runner's connection mode yet. These
metadata determine whether an OFFLINE pooler adapter can be safely prepared. If
metadata is unavailable, or security support is unresolved, remain NO-GO. Use
existing support ticket SU-521759 for a draft project-specific question if needed;
no message is sent by this plan. A trusted IPv6-capable network for the already
reviewed direct route remains an alternative; no purchase or public tunnel.

## Conditional offline adapter design — not implemented/approved yet

After exact host/status/trust review, add an explicit session-pooler mode with a
hard-pinned approved host and project-qualified username. Do not relax existing
DIRECT validation or rewrite the private direct profile; keep modes separate.
Reject unapproved project suffix/host/port; no automatic fallback. Environment must
use the configured qualified client username, while SQL still checks database,
current_user and session_user = postgres. Current environment hardcodes postgres
and must NOT simply be pointed at a pooler.

Maintain explicit BEGIN REPEATABLE READ READ ONLY and transaction-local default,
timeouts and pg_catalog search_path: startup PGOPTIONS may not propagate through
the pooler. Require actual read-only settings and backend SSL BEFORE any catalog
collection. Preserve approved catalog query bodies/hashes unless separately reviewed.
Use one connection/transaction, exact-query scope, bounded timeouts, private password
prompt, no inherited PG redirects, private output and no retries. No arbitrary SQL,
application RPC or raw group reads. Read-only is not a sandbox for unreviewed functions.

Extend offline tests: exact LIVE host/user; TEST/wrong host/project/6543 rejection;
separate direct preservation; environment username/CA/TLS propagation; no startup-only
read-only assumption; backend false/null/missing and transaction off stop before
catalog; fixed query hashes; no fallback; no secret output; zero connections default.
Review runner and tests again before requesting a single actual read-only attempt.
Connection attempt remains separately approved; successful evidence collection does
not approve the migration, establish organiser authority or prove recovery coverage.

## Official references retrieved for this review

- https://supabase.com/docs/guides/database/connecting-to-postgres
  Official source: https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/database/connecting-to-postgres.mdx
  Shared session mode is IPv4-accessible on Free, port 5432, qualified username.
- https://supabase.com/docs/guides/platform/ssl-enforcement
  Official source: https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/platform/ssl-enforcement.mdx
  Governs both legs; changes trigger a database reboot; verify-full guidance.

Decision: feasible platform route, LIVE TLS capability UNVERIFIED; NO-GO for
connection until metadata, trust and adapter review. NO-GO for installation until
separate authority/recovery/concurrency gates. Preserve Group 1010's three entrants,
scores and £30 pot. This plan contains no migration or SQL execution instructions.
