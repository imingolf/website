# Isolated local Supabase baseline, migration and rollback rehearsal

This procedure is for Docker container **supabase_db_ImInGolf-Local-Rehearsal**
ONLY. No online Supabase connection or credentials are needed. None of these SQL
steps has been executed by Codex. The Mac archive and its TOC have not been
provided to Codex, so the generated selection remains a candidate until inspected.
The helper refuses unexpected application objects and an incomplete baseline.

**GO for offline preparation. NO-GO for restore until the candidate SQL and local
target checks below pass.** Do not claim recovery or rollback success until both
have actually run and their comparisons pass.

## Compatibility and scope

- Source PostgreSQL 17.11 and destination 17.6 share major version 17. Ordinary
  application objects should be compatible; 17.6 is behind source bug/security
  fixes. Prefer a CLI-supported 17.11-or-newer PG17 local image for the final parity
  check. Do not change a container image underneath an existing data volume.
- Use Mac pg_restore 18.6 for the custom archive, not container pg_restore 17.
  Container psql 17.6 supports the dump's restriction meta commands, but stop if
  it reports an unsupported command/setting. Do not delete failed commands blindly.
- Supabase manages Auth schemas, functions such as auth.uid(), roles and extensions.
  Retain local definitions. Select no auth/storage/realtime/vault/extensions schema
  objects or data, no public schema recreation, no extension creation, no roles,
  no event triggers, and no subscription/publication objects. Review extension
  references in the selected application definitions; missing dependencies block
  restore rather than justify selecting the entire managed schema.
- The eight application tables are public.tens_in_groups,
  public.iig_notification_settings, public.iig_notification_events,
  iig_private.setup_testers, iig_private.group_owners, iig_private.group_members,
  iig_private.registration_settings and iig_private.platform_owners. Retain their
  original functions, constraints, indexes, triggers, policies/RLS and the
  public.tens_in_groups_id_seq identity definition and sequence value. Comments
  are omitted. Unexpected objects require an inventory-specific review.
- Restore no Auth table data: no original passwords, sessions, refresh tokens,
  identities, MFA factors, OAuth secrets or real login credentials. Fictional
  verified users keep referenced UUIDs and use example.invalid emails; identities
  remain empty. This tests database dependencies and RPC behaviour, not actual
  Auth login/OTP or email confirmation. UUIDs and golf data can still be personal
  information; protect all local files.
- The sanitizer rotates application invitation tokens and removes adminPin and
  adminSetupToken keys recursively from golf JSON before database loading. Review
  application functions/data for other embedded credentials before proceeding;
  the helper cannot discover every possible secret. Golf scores/history otherwise
  remain intact. This is a sanitized baseline, not a bit-for-bit TEST clone.
- The no-owner/no-acl archive cannot recover original ownership or privileges.
  Restore application objects as local postgres and reapply only the baseline
  GRANT/REVOKE statements from the repository. Do not run entire baseline setup
  files: those recreate tables or change registration records. These intended ACLs
  do not prove parity with online ACLs. Review local role memberships/default ACLs.

## 1. Offline preparation on the Mac

Run in a fresh Terminal shell. The examples use bash; start `bash` first if desired.
All pg_restore invocations below write files, never connect to a database.

```bash
set -euo pipefail
umask 077
cd "$HOME/Documents/ImInGolf-Local-Rehearsal"
IIG_REHEARSAL_DIR="$PWD"
IIG_BACKUP="$HOME/Documents/ImInGolf-Backups/ImInGolf-Test-2026-10-22.dump"
IIG_DB_CONTAINER='supabase_db_ImInGolf-Local-Rehearsal'
pg_restore --version
test -f "$IIG_BACKUP"

# Fetch code from GitHub only; this never contacts a Supabase project.
git clone --single-branch --branch pr6-test-rollback-preparation \
  https://github.com/imingolf/website.git rollback-rehearsal-source
IIG_REPO="$IIG_REHEARSAL_DIR/rollback-rehearsal-source"
IIG_TOOLS="$IIG_REPO/docs/pr6-test-rollback-preparation/local-rehearsal"
IIG_OUT="$IIG_REHEARSAL_DIR/local-restore-generated"
mkdir -p "$IIG_OUT"

# Preserve the existing restore-selection.txt; generate a fresh complete TOC.
shasum -a 256 "$IIG_BACKUP" > "$IIG_OUT/backup.sha256"
pg_restore --list "$IIG_BACKUP" > "$IIG_OUT/restore-selection.full.txt"
python3 "$IIG_TOOLS/prepare-local.py" \
  --inventory "$IIG_OUT/restore-selection.full.txt" \
  --repo "$IIG_REPO" --out "$IIG_OUT"

pg_restore --no-owner --no-acl \
  --use-list="$IIG_OUT/restore-selection.app.txt" --section=pre-data \
  --file="$IIG_OUT/pre-data.sql" "$IIG_BACKUP"
pg_restore --no-owner --no-acl \
  --use-list="$IIG_OUT/restore-selection.app.txt" --section=data \
  --file="$IIG_OUT/data.private-original.sql" "$IIG_BACKUP"
python3 "$IIG_TOOLS/sanitize-copy.py" \
  < "$IIG_OUT/data.private-original.sql" > "$IIG_OUT/data.sanitized.sql"
pg_restore --no-owner --no-acl \
  --use-list="$IIG_OUT/restore-selection.app.txt" --section=post-data \
  --file="$IIG_OUT/post-data.sql" "$IIG_BACKUP"

# This generates a separate LOCAL capture file; it does not execute SQL.
python3 "$IIG_OUT/prepare-local-rollback.py" \
  --write-capture "$IIG_OUT/capture.local.sql"
```

If the clone directory already exists, stop and inspect it rather than overwrite
it. Verify pg_restore reports 18.6. Review the original restore-selection.txt
against the full TOC and candidate selection. Inspect pre-data.sql, post-data.sql,
baseline-acl.sql and the COPY table headers in data.sanitized.sql in a local editor.
The functions used are archive definitions, not replacement repository definitions.
The repository provides an allowlist and intended ACL reconstruction only.

Stop on unknown entries, extra overloads, missing functions/tables/sequence, Auth
definitions/data, unexpected network/file access, missing extension types/functions,
or a mismatch between archive schema and repository expectations. The sanitizer
only accepts the expected COPY format. Do not run the unsanitized data file.

## 2. Isolate and verify the local container

These commands change only Docker networking on the named local container. They
disconnect local services and prevent database egress; docker exec still works.
Supabase CLI status/Studio may stop working during this isolated DB rehearsal.

```bash
docker inspect --format '{{.Name}} {{.Config.Image}}' "$IIG_DB_CONTAINER"
docker inspect --format '{{range $name, $cfg := .NetworkSettings.Networks}}{{println $name}}{{end}}' \
  "$IIG_DB_CONTAINER" > "$IIG_OUT/networks-before.txt"
while IFS= read -r iig_network; do
  if [ -n "$iig_network" ]; then
    docker network disconnect "$iig_network" "$IIG_DB_CONTAINER"
  fi
done < "$IIG_OUT/networks-before.txt"

# Every SQL connection uses this container's Unix socket. No PGHOST/URL or online host.
local_psql() {
  docker exec -i "$IIG_DB_CONTAINER" \
    psql -X -h /var/run/postgresql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"
}

local_psql <<'SQL'
select version(), current_user, current_database();
select count(*) as auth_users from auth.users;
select count(*) as auth_identities from auth.identities;
select to_regnamespace('iig_private') as existing_private_schema;
select schemaname,tablename from pg_tables
 where schemaname='public' and tablename in
 ('tens_in_groups','iig_notification_settings','iig_notification_events');
select rolname,rolsuper,rolbypassrls from pg_roles
 where rolname in ('postgres','anon','authenticated','service_role');
select to_regprocedure('auth.uid()'),to_regprocedure('gen_random_uuid()'),
 to_regprocedure('hashtextextended(text,bigint)');
select extname,extversion from pg_extension;
select evtname,evtenabled,evtevent from pg_event_trigger;
SQL
```

STOP unless this is the expected local server, current_user is postgres, both Auth
counts are zero, iig_private is absent, and none of the three public application
tables exists. The four roles and three prerequisite functions must exist. Review
event triggers/default privileges for effects on restored DDL. If application
objects already exist, use a fresh disposable local Supabase project; do not
DROP CASCADE or apply this procedure over them. No network connections means other
services cannot write, but existing DB sessions/jobs still need review/draining.

## 3. Restore the sanitized application baseline atomically

Only proceed after the selection review. This is the first restore operation.
Pre-data has no application triggers/FKs yet; Auth fixtures precede all post-data
constraints. Do not disable managed triggers or use session_replication_role.

```bash
cat "$IIG_OUT/pre-data.sql" "$IIG_OUT/data.sanitized.sql" \
    "$IIG_TOOLS/fictional-auth.sql" "$IIG_OUT/post-data.sql" \
    "$IIG_OUT/baseline-acl.sql" \
  | local_psql --single-transaction > "$IIG_OUT/baseline-restore.log" 2>&1
```

Any error aborts this transaction. Inspect the log; never ignore restore errors.
If COPY/FK/Auth definitions differ, stop for a reviewed adjustment. Do not replace
managed definitions or import real identities to make the restore work.

Verify before capturing the rollback baseline:

```bash
local_psql <<'SQL'
select group_pin,jsonb_typeof(state),jsonb_typeof(state->'players'),
 jsonb_typeof(state->'history') from public.tens_in_groups order by group_pin;
select count(*) as owners from iig_private.group_owners;
select count(*) as members from iig_private.group_members;
select count(*) as dangling_owners from iig_private.group_owners o
 left join auth.users u on u.id=o.owner_id where u.id is null;
select count(*) as dangling_members from iig_private.group_members m
 left join auth.users u on u.id=m.user_id where u.id is null;
select count(*) as bad_fixture_users from auth.users
 where email not like '%@example.invalid' or encrypted_password is not null
 or confirmation_token is not null and confirmation_token<>''
 or recovery_token is not null and recovery_token<>'';
select count(*) as identities from auth.identities;
select last_value,is_called from public.tens_in_groups_id_seq;
select max(id) as largest_group_id from public.tens_in_groups;
select conrelid::regclass,conname,convalidated from pg_constraint
 where connamespace in ('public'::regnamespace,'iig_private'::regnamespace);
SQL
```

Expect groups 3520/5021, two owners, three members, zero dangling/bad fixture users,
zero identities and validated constraints. Sequence next value must exceed the
largest restored group ID (consider is_called); preserve its archived value and
do not call nextval just to test it. Compare scores/history against the prior core
restore or an offline archive-derived reference. Full-row hashes may differ due
to secret sanitization. Record the local baseline after sanitization and all local
fixture/ACL adjustments, before applying any migration. Protect all logs/files.

## 4. Capture, migrate and reverse without exercising runtime writes

The original package is hard-bound by human attestation to online TEST. **Do not
use it unchanged locally.** The generated prepare-local-rollback.py substitutes
only the project label with ImInGolf-Local-Rehearsal. All data guards and object
checks remain enabled. If a nonempty server project setting conflicts, stop and
review the local variant; never relax the online script's target checks.

```bash
local_psql -qAt < "$IIG_OUT/capture.local.sql" > "$IIG_OUT/before.json"
python3 "$IIG_OUT/prepare-local-rollback.py" --capture "$IIG_OUT/before.json" \
  --rollback "$IIG_OUT/rollback.LOCAL.sql"
```

Inspect before.json and rollback.LOCAL.sql. Confirm the original six required
function owners/ACLs, optional helper existence, empty new-object inventory and
the local fingerprints. The Auth fixtures are now part of those fingerprints.
Review local role membership/default ACLs. If grants have non-owner grantors, the
generator refuses: review that grant chain rather than suppress the check.

Run each migration separately from exactly eadb495. git show below only extracts
SQL from the local checkout; no network or database access occurs until local_psql.

```bash
for iig_migration in integration-hardening protected-gameplay account-lifecycle subscription-security; do
  git -C "$IIG_REPO" show "eadb495:supabase/staging/$iig_migration.sql" \
    > "$IIG_OUT/$iig_migration.sql"
  local_psql < "$IIG_OUT/$iig_migration.sql" \
    > "$IIG_OUT/$iig_migration.log" 2>&1
  # Inspect this file's log before proceeding to the next file.
  cat "$IIG_OUT/$iig_migration.log"
  read -r -p 'Inspect log; type CONTINUE for next step: ' iig_answer
  test "$iig_answer" = CONTINUE
done

local_psql -qAt < "$IIG_OUT/capture.local.sql" > "$IIG_OUT/installed.json"
python3 - "$IIG_OUT/before.json" "$IIG_OUT/installed.json" <<'PY'
import json,sys
a,b=[json.load(open(p)) for p in sys.argv[1:]]
assert a['fingerprints']==b['fingerprints'], 'Protected data changed: STOP'
print('Installation data fingerprints unchanged; inspect installed object/security inventory.')
PY

# No gameplay, registration, Auth actions, transfers or subscription calls before reversal.
local_psql -v confirmed_project=ImInGolf-Local-Rehearsal \
  < "$IIG_OUT/rollback.LOCAL.sql" > "$IIG_OUT/rollback.log" 2>&1
local_psql -qAt < "$IIG_OUT/capture.local.sql" > "$IIG_OUT/after.json"
python3 - "$IIG_OUT/before.json" "$IIG_OUT/after.json" <<'PY'
import json,sys
a,b=[json.load(open(p)) for p in sys.argv[1:]]
assert a['fingerprints']==b['fingerprints'], 'Data mismatch'
assert not any(b['new_tables'].values()) and not b['new_triggers'], 'New objects remain'
def functions(c):
    result={}
    for f in c['functions']:
        m=f['meta']
        result[f['requested']]=(f['exists'], None if m is None else
          (m['definition'],m['owner'],m['security_definer'],m['settings'],
           sorted((g['grantor'],g['grantee'],g['privilege'],g['grantable']) for g in m['acl'])))
    return result
assert functions(a)==functions(b), 'Original function/owner/effective-ACL mismatch'
for key in ['policies','default_acl','roles','role_memberships','schemas','tables','extensions','event_triggers','triggers']:
    def normalized(v):
        return sorted(json.dumps(x,sort_keys=True) for x in v)
    assert normalized(a['inventory'][key])==normalized(b['inventory'][key]), key+' mismatch'
print('Local migration + guarded rollback comparisons passed. Retain logs as evidence.')
PY
```

Also compare identity sequence last_value/is_called to step 3; the rollback does
not rewind or recreate this existing sequence. Any failure stops the procedure;
inspect logs, retain the isolated environment, and do not remove data guards.
An explicit empty ACL may replace an implicit NULL ACL while retaining the same
effective function privileges; the final comparison deliberately checks effective
ACLs, not raw proacl text or OIDs.

This first pass rehearses schema installation/reversal only. A separate disposable
pass can exercise authorised runtime operations with synthetic JWT claims, but
those mutate the baseline and intentionally prevent this rollback from proceeding.
Actual OTP AMR claims, Auth login, deletion services, Edge/native purchase wiring,
iPhone workflows and online managed-role behaviour remain unproven. Fictional
Auth users are not usable application logins. Network isolation is not restored
automatically; keep this disposable environment isolated and remove it when no
longer needed, retaining only the reviewed private evidence.
