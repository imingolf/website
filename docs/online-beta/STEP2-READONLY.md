# Step 2 preparation — TEST read-only review, NOT executed

Only project nyavvwrsrxqfyhiygkgw. This document prepares the next review; it does
not authorise a connection, SQL execution, account/email operation, pause of a
service, fresh backup, privilege change, migration or publication. Await approval.
LIVE must not be accessed. No database check has been executed in this step.

## Mac execution runner — offline preparation only

The separately approved runner is now available with [Mac instructions and exact
safety boundaries](../../tools/test-beta/READONLY-RUNNER.md). Its default and
`--offline` modes cannot connect. It has only been tested with mocked clients;
first database connection still requires approval. The exporter below remains
separate and does not execute SQL.

## Reconciliation evidence

Common base: 9fd3b6b. Local c991410 adds TEST build isolation. Remote 4f7727b adds
only IMPLEMENTATION.md. They were integrated without conflicts, preserving both
commits and the specification unchanged. Local backups created before merging:

- backup/registration-local-c991410-20261024
- backup/registration-remote-4f7727b-20261024

These are local backup branches. Both original commits also remain reachable in
the reconciled GitHub history. No production or rollback-preparation branch was
merged into, rewritten or changed. There was no force-push.

## Prepared offline query package

[prepare-step2.py](../../tools/test-beta/prepare-step2.py) exports review files only:

- 01-original-capture.sql: the original capture query, unchanged after adding the
  reviewed read-only identity guard.
- 02-auth-ownership.sql: owner, effective inheritance, membership/set options and
  the allowlisted Supautils settings. Configuration alone is not proof of authority.
- 03-beta-catalog.sql: group/state/history hashes and counts for 3520/5021,
  account/membership health counts, ownership constraints/columns, fourteen
  prerequisite functions with owners/definitions/effective client grants,
  prepared transactions, writer locks and pg_cron/pg_net presence.
- manifest.json: exact query hashes, TEST reference and explicit no-install flag.

The first two queries are extracted from pinned rollback-preparation commit
85e4a129da7d857c7312811af3f5ba96b264b87d. Python SQL constants are extracted with
AST literal parsing, never executed as Python code. The exporter invokes local
git show only; it contains no database client, credentials or network connection.
It refuses to overwrite an existing output directory. The offline package tests
check read-only transaction guards, absence of write statements, source retention
and hashes. SQL has not been run against PostgreSQL, so these are not database
syntax/permissions/result checks.

Optional OFFLINE export only, for inspection (not database execution):

    python3 tools/test-beta/prepare-step2.py --out /tmp/imingolf-step2-readonly

If the pinned Git object is unavailable, stop; do not substitute a newer source.
Fetching that source from GitHub is separate from database access. No migration
files, installer or generated rollback execution command are in this package.
Do not run these SQL files directly in a dashboard or unvalidated psql session.

## Proposed execution boundaries, after separate approval

Use one reviewed read-only runner with the target checks already developed in
rollback-preparation, not the existing installer/default installation-preparation
mode. The earlier default preparation can create a fresh dump or install-ready
files; neither action is included in this proposed first read-only run.

1. Validate iig-test-only in ~/.pg_service.conf OFFLINE before connecting: exact
   TEST direct host, or approved session-pooler host with project-specific username,
   postgres database, port 5432, SSL require or stronger. Reject hostaddr, options,
   transaction pooling, other project users and ambiguous settings. Ignore inherited
   PG environment defaults. Prompt privately only if needed; never log passwords,
   include them in arguments, store them in evidence or send them to another target.
2. Use explicit verified connection parameters and default_transaction_read_only=on
   in both connection and environment. Every query also has explicit READ ONLY
   transactions. No user-supplied SQL, application RPC invocation, SET ROLE,
   CREATE/DROP probe, session termination or automatic service control.
3. Confirm PostgreSQL/current user/database/SSL and any available project setting.
   The existing expected version is 17.11; a change requires review, not automatic
   acceptance. A literal project_attestation in a SQL result does NOT establish
   project identity: host/TLS/project username verification is mandatory first.
4. Revalidate the original private TEST capture and exact guarded rollback OFFLINE
   before comparison. Keep them immutable. Compare with the recorded full original
   fingerprints and normalized catalog/security inventory using the reviewed
   comparator, including nullable ACL handling. STOP on a changed captured scope;
   never adopt a new baseline to make the old rollback pass. No Auth records,
   credentials, raw application data or private captures are committed to GitHub.
5. Collect the prepared read-only queries, record private evidence, and repeat
   snapshots to detect movement. Queries return metadata/hashes/counts rather than
   raw user rows. A missing prerequisite or privilege causes STOP; no grants or
   fallback role are permitted. No online API tests, sign-in attempts or emails.

Known private Mac evidence locations (not present in this cloud workspace):

- Original capture: ~/Downloads/imingolf-rollback/docs/pr6-test-rollback-preparation/capture.json
- Original rollback: same directory, rollback.TEST.sql
- Original backup: ~/Documents/ImInGolf-Backups/ImInGolf-Test-2026-10-22.dump
- Local PASS: ~/Documents/ImInGolf-Local-Rehearsal/local-restore-generated/automated-rehearsal-20261023T115001.671715Z
- Latest reported ownership evidence: ~/Documents/ImInGolf-TEST-Installation/readonly-preflight-20261023T125316.213657Z

The original backup has no historical checksum. Today's observed hash is not
historical integrity proof. Archive readability, local core-data restoration and
full Supabase Auth/ACL/service recovery are different claims. Do not manufacture
an old checksum. Validate available backup/rehearsal evidence offline, document
coverage limits, then separately approve any fresh read-only backup after the
baseline comparison if needed. No restore or SQL migration is part of this review.

## Authority, security and writer decisions to report

- Compare owners, original function definitions, effective grants and grantors,
  role memberships including inherit/set options, schema/table/default ACLs,
  normal/event triggers, policies and RLS. Verify the new objects are absent or
  STOP for migration-state review. Compare the full capture, not just two PINs.
- Confirm group/player/history structure, one owner per existing group and intact
  memberships. Original counts were two groups, two owner records and three member
  records. These are historical observations, not permission to overwrite changes.
- TRIGGER privilege alone is not DROP TRIGGER authority. Assess current postgres
  effective ownership and the existing exact Supautils grant using the prior
  evidence/source review. Keep the original rollback unchanged. If managed authority
  is the only route, project-specific Supabase confirmation remains required;
  finding the setting or passing a diagnostic does not prove rollback execution.
- Record sessions/transactions, locks and extension/job infrastructure. The earlier
  TEST lacked pg_cron/pg_net. A new extension/job needs review. Idle connections or
  an empty Edge dashboard do not prove external writers are paused. Request concrete
  TEST-only writer-control evidence; do not stop services or terminate sessions.
- Review TEST Auth metadata/settings read-only where supported: registration mode,
  verified/non-anonymous accounts, OTP length/expiry/resend, sender/SMTP readiness,
  redirect/site URLs, rate limits and bot protection. SQL alone cannot establish
  SMTP configuration or delivery. Do not read/print SMTP secrets, request codes,
  create users or send mail. Real email testing is a later approved write action.

## Requirements preserved but not delivered yet

IMPLEMENTATION.md is retained unchanged. The following are implementation gaps,
not Git conflicts and not features silently added by this reconciliation:

- Multiple groups: current source has UNIQUE owner_id and get-owned-group returns
  one group. Inventory constraints/functions; design a new migration/rollback
  separately rather than dropping that constraint during read-only review.
- Persistent sessions: current tokens stay in memory, without a refresh flow.
  Secure persistence/rotation/revocation and group switching need separate design.
- Plus handicaps: current input supports an optional negative sign and -10 to 60,
  not an explicit plus sign. Clarify golf sign/storage conventions; retain all
  unchanged historical values. Bulk owner handicap validation remains a server gap.
- Invitations: inspect current token lifecycle. Existing token matching does not
  prove expiry/revocation flows; new controls and tests require separate review.
- Six-digit OTP and player profile reuse/confirmation/group switcher: compare the
  actual Auth settings and implementation with the approved specification; the
  current UI accepts six-to-ten-digit codes and does not deliver every listed flow.
- Per-group beta Plus entitlements: real payments/native purchases remain blocked;
  a group-scoped beta simulation design is still needed and must never touch LIVE.

Consequently, installing only the four old eadb495 migrations would not by itself
complete the broader approved beta specification. The original guarded rollback
covers those four files and their captured baseline only. Additional features need
additional reviewed migrations, guards, rollback/rehearsal and explicit approval.

## Expected review result and stop conditions

Produce a private PASS/FAIL evidence report distinguishing: target identity,
original baseline comparison, catalog/grants/RLS, ownership authority, backup
coverage, writer status, and unsupported/unverified Auth settings. A read-only
PASS is not permission to install, send mail or publish. Unknown means outstanding.

STOP for any wrong target, fingerprint/catalog change, missing privilege,
unreviewed migration state or inability to establish recovery/authority. Report
legitimate changes for review; do not delete data, use CASCADE, grant elevation,
alter Auth ownership or weaken rollback checks. No support message is sent without
an explicit request. No LIVE access is needed or authorised.

After approval of the read-only review, report what was found and stop again
before TEST writes, writer pausing, fresh backup creation, migrations, permission
changes, email delivery tests or beta publication.

## Platform default-grant rollout review

See [30 October Data API grant review](DATA-API-GRANTS-REVIEW.md). The pinned four
migrations and original recovery evidence remain unchanged. The new ACL tail and
supplemental catalog query are review drafts outside the authorised runner. A
platform change to captured default ACLs must still stop baseline comparison.
No execution or permission change is authorised by that source review.
