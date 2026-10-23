# Controlled ONLINE TEST preparation — no migration execution yet

Only project **nyavvwrsrxqfyhiygkgw**. Current recommendation: **NO-GO for installation**,
because TEST writer pause/drain has explicitly NOT been confirmed. Local PASS is
rehearsal evidence, not online installation authorisation.

## One next safe command: read-only verification

Run this single block in Mac Terminal:

    (
      set -e
      IIG_REPO="$HOME/Downloads/imingolf-rollback"
      test "$(git -C "$IIG_REPO" branch --show-current)" = pr6-test-rollback-preparation
      git -C "$IIG_REPO" pull --ff-only origin pr6-test-rollback-preparation
      python3 "$IIG_REPO/docs/pr6-test-rollback-preparation/online-test/prepare-test.py" --recover-missing-checksum
    )

Git contacts GitHub. Python connects read-only to TEST only after offline target
verification. It does not invoke the future installer, execute migration/rollback,
pause services, change Auth configuration or modify either database. It has no
execution switch. The libpq connection and environment both enforce
default_transaction_read_only=on; SQL snapshots explicitly BEGIN READ ONLY.
No application RPC is called (some take Auth row locks).

Confirmed default inputs:

- Original capture: ~/Downloads/imingolf-rollback/docs/pr6-test-rollback-preparation/capture.json.
- Original rollback: the sibling rollback.TEST.sql.
- Private service: iig-test-only in ~/.pg_service.conf.
- Backup: ~/Documents/ImInGolf-Backups/ImInGolf-Test-2026-10-22.dump.
- Historical checksum: NOT recorded/found. This is explicitly documented, not reconstructed.
- Local PASS: local-restore-generated/automated-rehearsal-20261023T115001.671715Z.

The local PASS and legacy optional checksum location are under ~/Documents/ImInGolf-Local-Rehearsal. Original capture,
rollback, backup and rehearsal evidence are never overwritten or committed.

Output is PASS/FAIL and a private evidence folder under
~/Documents/ImInGolf-TEST-Installation. With writers unconfirmed, expect
**FAIL/NO-GO for readiness** even if read-only data/security checks pass. A changed
baseline stops immediately; an unconfirmed window needs the controlled pause
below. No installation-ready package is emitted until every readiness check passes.
Do not replace the capture or delete data to manufacture PASS.

## Revalidation

1. Recheck the local PASS report, exact eadb495 migration hashes, completed rollback
   and prior/current-baseline verification. Recompare saved before/after captures
   and audits: all original fingerprints, function grants/owners, column ACLs,
   history/data, sequence, indexes, constraints, policies, normal/event triggers
   and RLS. Codex cannot inspect the Mac; the command reviews the actual files there.
2. With explicit --recover-missing-checksum, preserve the original archive and
   record its SHA-256 as OBSERVED NOW ONLY. pg_restore 18.6 inventories and
   traverses/decompresses it to /dev/null with no database target. Require
   application data, sequence and source version 17.11. An existing historical
   manifest must still match; recovery never bypasses a mismatch. No legacy
   backup.sha256 is manufactured. See the recovery limitations below.
3. Require the original online TEST capture, postgres ownership, and exact original
   guarded rollback. Never regenerate against current data to excuse a mismatch.
4. Parse the service offline before connecting. Allow only exact TEST direct host,
   or Supabase pooler host with postgres.nyavvwrsrxqfyhiygkgw, database postgres,
   port 5432 (direct/session pooler) and SSL require or stronger. Reject hostaddr,
   transaction pooling and unreviewed libpq options. Clear inherited PG* variables.
   Passwords never appear in argv/reports.
5. Require online PostgreSQL 17.11 as postgres; any project setting must agree.
   Record psql connection/SSL information. Database name postgres alone does not
   identify a project: validated host/user plus original fingerprints are required.
6. Compare original captured data, function definitions/owners/effective grants,
   schema/table ACLs, roles/memberships/default ACLs, RLS/policies and triggers.
   Recheck fourteen prerequisites and intended anon/authenticated access. Original
   application definitions must match the rehearsed archive; managed Auth/builtin
   definitions are inventoried, not replaced.
7. Check CREATE/TRIGGER privileges, SELECT/UPDATE rights for original guarded
   table locks, and inherited auth.users ownership needed for DROP TRIGGER in
   rollback. TRIGGER privilege alone does not establish rollback authority. Missing
   rights stop preparation: do not grant privileges or DROP objects to force it.
8. Record sessions, writer/DDL locks, prepared transactions, extension inventory and
   effective new-function default ACLs. Writer locks/prepared transactions block.
   pg_cron/pg_net appearing now requires review. Idle managed sessions are not killed
   and do not prove a pause. An empty Edge dashboard does not exclude external jobs.
9. Compare notification-table hashes to the rehearsed backup baseline (the older
   capture did not hash them). Collect expanded catalogs and repeat all read-only
   snapshots to detect movement during preflight. When historical checksum is
   missing, first create a distinct fresh recovery archive as described below.

The original capture cannot prove that every uncaptured hosted object/session/log
has stayed unchanged. Protected golf, ownership, membership, history and Auth
users/identities plus recorded catalog/security scope must match. Supplemental
audits expand the baseline now; they do not retroactively prove uncaptured state.
Any checked mismatch is STOP. Review legitimate changes read-only, then decide
whether a new backup/capture/rollback/rehearsal is needed. Never auto-adopt current
state as the original baseline.

## Missing historical checksum: controlled recovery

The original 22 October archive remains immutable. Its size, timestamp, today's
hash and a readable TOC do not establish historical integrity. Full traversal
finds unreadable/compression failures; it is not an authenticity check. The saved
local PASS provides evidence for the selectively restored application baseline,
original function bodies and protected golf/history checks. Sanitised Auth/users
and ownership references prevent treating that rehearsal as a full byte-for-byte
verification of the original online fingerprints. Parsing a TOC or comparing
schema names cannot prove all original row fingerprints. Full original Auth and
permissions recovery remains untested; no new claim of that recovery is made.

The explicit recovery option therefore takes a NEW backup, only after the original
online capture/security checks match and notification fingerprints match the
rehearsed baseline. Any mismatch stops before pg_dump. It never replaces capture,
rollback or the original archive. The private, unique preflight evidence folder
contains:

- original-backup-observation.json: missing historical anchor and observed hash;
- backup-inventory.txt: original archive inventory;
- TEST-fresh-preinstall.dump: NEW full custom-format TEST backup;
- fresh-backup.sha256 and fresh-backup.json: NEW dated anchor and provenance;
- fresh-backup-validation/backup-inventory.txt: NEW archive inventory;
- before/after backup captures and audits, plus the normal PASS/FAIL report.

pg_dump 18.6 uses only the validated TEST host/user/SSL connection, clears inherited
PG settings, forces default_transaction_read_only=on and uses its normal consistent
MVCC snapshot. No credentials enter argv. Locks time out after five seconds;
command errors stop preparation. The new archive uses --no-owner --no-acl to match
the recovery assumptions; captured security metadata and the original guarded
rollback remain essential. pg_restore inventories and fully traverses this new
archive without a database connection, then the original capture and expanded
audit must still match after backup. The future installer rechecks the new
archive's recorded SHA-256 before any migration.

The dump snapshot and before/after audits are separate consistent snapshots. Their
agreement does not exclude transient activity or changes in uncaptured objects.
Writer pause/drain remains mandatory; no fresh backup substitutes for this gate.
An unconfirmed pause produces FAIL/NO-GO, even if the fresh backup is valid. A rerun
creates a distinct new archive, never overwrites one. Failed/incomplete artifacts
are retained as evidence and are not promoted to a valid fresh backup record.

All evidence is private (directory 0700, files created under umask 077). Full dumps
contain real Auth data/credential material: keep them on the trusted Mac, never
commit/upload their contents or restore them into the fictional-identity local
rehearsal. Neither archive's readability proves a full Supabase services restore.
If full Auth/service recovery is a release prerequisite, that remains a separate
blocker requiring a safely isolated review/rehearsal.

## Remaining local/hosted differences

Local 17.6 and TEST 17.11 share major version 17 but differ in fixes, extensions,
managed Auth definitions, roles/default ACLs and service behaviour. Synthetic
identities did not exercise real OTP AMR, email/deletion flows, Edge/native Apple
verification or physical iPhones. The no-owner/no-acl archive cannot recover
original permissions by itself. Full original Supabase Auth/permission/service
recovery has not been rehearsed. Scoped unchanged-data schema rollback is the
recovery path here; runtime writes can deliberately block it.

## Controlled TEST pause — not performed automatically

Do not stop LIVE applications, change LIVE keys or pause a shared production job.
Inventory exact TEST destinations first; unknown/shared destinations block.

1. Coordinate a TEST-only window. Close TEST browser/iPhone/Admin/organiser clients,
   previews and local dev traffic. Do not generate sign-in, email-change, transfer
   or deletion requests while pausing; keep LIVE running.
2. Pause identified TEST CI/dev/preview writers, external jobs and API integrations.
   Record names, owners and exact TEST endpoint. Include native subscription
   verifiers and notification senders; database extension absence proves nothing
   about external jobs.
3. Verify TEST Edge deployments AND callers. Empty deployments only prove that
   list is empty. Shared backends need a verified way to suppress TEST requests
   without affecting LIVE; otherwise stop for review.
4. Control new TEST Auth requests from users and automation. Do not kill managed
   Auth/database services, rotate keys, terminate sessions or change database/Auth
   security to manufacture quietness. Provider background clients may remain.
   Locks/fingerprints protect the scoped transactions but idle sessions do not
   certify no future write.
5. Freeze other TEST SQL/DDL/admin work. Allow this read-only preflight. Let actual
   writes drain normally; a timeout means STOP, not permission to kill its owner.
6. Complete the single private controlled-pause.json created under
   ~/Documents/ImInGolf-TEST-Installation. Record project, operator, fresh UTC time
   and actual paused/absent/controlled evidence for each scope. Do not mark unknown
   scopes paused. Rerun the same read-only command in the maintenance window.

The scopes are TEST browser/mobile/admin; dev/preview/CI; Edge/native/API;
scheduled external jobs; Auth operations; other manual SQL/DDL. Evidence expires
after 30 minutes. This is operator attestation, not automatic verification of
provider suspension. The script never marks the checklist complete for you.
Keep controls in place until installation review and rollback decisions finish.

## Future guarded installation — separate approval still required

Only PASS preparation emits package.json, four guarded SQL files, original
rollback.TEST.sql, original-capture.json and expanded preflight audit. These stay
private outside Git. Order: integration-hardening, protected-gameplay,
account-lifecycle, subscription-security.

The builder preserves each pinned source body and its own BEGIN/COMMIT, inserting
before/after guards inside that same transaction. No all-files outer transaction.
Bounded SHARE ROW EXCLUSIVE locks cover protected golf, membership, configuration,
notification and Auth identity tables, plus prior new tables. Row writers block
during each file; ordinary readers can continue. Locks release between files,
which is why controlled writers and fresh checks remain essential.

Guards require TEST role/version/explicit approval and a fresh maintenance window;
original data/history/notification fingerprints and security catalogs; staged
pinned function bodies, languages, volatility, SECURITY DEFINER, empty search_path,
owners and exact effective grants derived from captured defaults; unchanged original
triggers and exact new triggers; and empty new tables with RLS, intended ownership,
no policies and no client table privileges. Post-checks execute before each commit.
No golf rows are rewritten/deleted.

The separate install-after-approval.py requires explicit TEST approval plus a
fresh PASS package. It revalidates connection, hashes, rollback and actual current
baseline before enabling writes. It runs one guarded file at a time, captures data
after each, stops on error and reports completed files and PASS/FAIL. Final
data/history/Auth/notification/sequence and RLS checks are automatic.
**Do not run that future installer yet.** The next command above is read-only.

A failed file aborts its transaction; earlier file commits remain. No automatic
rollback, blind rerun or removed guards. New hosted guards are statically reviewed
and generation-tested offline, not executed against TEST. A preparation PASS is
readiness evidence, not an installation or production approval.

## Original rollback remains available

The original TEST rollback is copied unchanged and its SHA-256 recorded. Never use
rollback.LOCAL.sql online. A separately approved rollback must use the same
validated TEST connection with writers still controlled. Its exclusive locks,
original fingerprints, empty-new-table guards, original definitions/owners/grants
and RESTRICT drops remain. No DROP CASCADE is added. Reviewed FK ON DELETE CASCADE
definitions are preserved, with no deletes invoked.

Runtime transfers, deletions, receipts, scoring and history claims may intentionally
block rollback. Never delete rows, overwrite state or edit hashes to bypass it.
Reconciliation/full TEST recovery needs separate review; synthetic Auth rehearsal
does not prove full hosted Auth recovery.

Offline tests: test-preparation.py and the existing local test-automation.py and
test-selection.py. Those tests execute no SQL, Docker or online requests.
