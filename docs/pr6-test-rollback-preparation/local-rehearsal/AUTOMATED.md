# One-command local migration and rollback rehearsal

For the already-restored, sanitized local baseline described in this conversation.
This supersedes the manual migration/rollback commands in README.md; do not run
both workflows. No SQL has been executed by Codex. The actual Mac run is still
required before anyone can claim that migrations and rollback passed.

Run this single block in Mac Terminal:

```bash
(
  set -e
  IIG_REPO="$HOME/Documents/ImInGolf-Local-Rehearsal/rollback-rehearsal-source"
  test "$(git -C "$IIG_REPO" branch --show-current)" = pr6-test-rollback-preparation
  git -C "$IIG_REPO" pull --ff-only origin pr6-test-rollback-preparation
  python3 "$IIG_REPO/docs/pr6-test-rollback-preparation/local-rehearsal/run-rehearsal.py"
)
```

Only git pull contacts GitHub. The Python runner has no online database URLs,
database connection strings or deployment commands. All SQL is passed via stdin
to psql **inside** supabase_db_ImInGolf-Local-Rehearsal using its Unix socket.
The runner never reconnects Docker networks, stops services, deletes golf rows or
relaxes rollback guards. Its schema DROP statements come only from the existing
guarded rollback, with RESTRICT. The reviewed migrations' foreign keys with
ON DELETE CASCADE are left unchanged; no deletions are exercised.

## What it checks and does

1. Requires the rollback preparation branch with no tracked edits; local Unix
   Docker context; the exact running Supabase PostgreSQL 17.6 container; zero
   attached networks; no host/shared networking. Rechecks isolation/container ID
   before every SQL invocation. SQL independently checks the socket, server version,
   database and role, and refuses other database clients or prepared transactions.
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
