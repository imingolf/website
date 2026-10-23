# PR #6 — TEST installation-window rollback package

Reviewed source: `imingolf/website`, `improve-first-visit-welcome`, commit
`eadb4950e8cc1de8046b7654a89a490e6eae6643`.
Only authorised target for the proposed procedure: Supabase TEST
`nyavvwrsrxqfyhiygkgw`. Nothing in this package has been run against a database.
This package is published separately on `pr6-test-rollback-preparation`; the
`improve-first-visit-welcome` branch and Draft PR #6 are unchanged. Do not put the
sensitive capture or generated database-specific rollback in Git.

Package files: [pre-install-capture.sql](pre-install-capture.sql) and
[prepare.py](prepare.py). Download all three files, including this README, into
the same local directory before following the commands below. No ZIP is needed.

For the Docker-based local Supabase rehearsal, use the separate
[local rehearsal guide](local-rehearsal/README.md) and its supporting files. It
creates a local-only variant; the TEST-targeted scripts below stay unchanged.
If that local baseline is already restored, the
[automated rehearsal](local-rehearsal/AUTOMATED.md) replaces the remaining manual
migration, verification and rollback steps with one command.

## Recommendation

**NO-GO until the pre-install capture has been obtained and reviewed, the rollback
has been generated, installation/rollback privileges are established, and all
external writers have been paused and drained.** Then GO for the four-file
TEST-only installation window, with writers still paused. This is not approval
to enable new account/subscription actions or release to production.

Core golf-data restoration has been rehearsed locally. Full Supabase Auth,
ownership/ACL and service recovery has not. A schema reversal with unchanged
data does not need a full data restore, but recovery after runtime mutations
remains outside the coverage of this package.

## Exact object inventory

Signatures below are PostgreSQL identities; `timestamptz` means
`timestamp with time zone`. All eight CREATE OR REPLACE functions must be
captured, including the two helpers if they already exist. The player reader is
replaced in both files 1 and 2: rollback restores its pre-file-1 definition.

| File | Created or replaced functions |
| --- | --- |
| 1 integration-hardening.sql | REPLACE `public.iig_join_owned_group(text,uuid,text,numeric)`; REPLACE `public.iig_set_my_attendance(text,boolean,bigint)`; REPLACE `public.iig_submit_my_score(text,integer,text,bigint)`; REPLACE `public.iig_get_player_group(text)`; CREATE OR REPLACE `iig_private.player_result(jsonb)` |
| 2 protected-gameplay.sql | CREATE OR REPLACE `iig_private.golf_view(jsonb,integer)` (depth default 0); REPLACE `public.iig_get_player_group(text)`; REPLACE `public.iig_get_owned_group()`; CREATE `public.iig_player_action(text,text,jsonb,bigint)`; CREATE `iig_private.protected_group_limits()` |
| 3 account-lifecycle.sql | REPLACE `iig_private.verified_organiser()`; CREATE `iig_private.recent_signin()`; CREATE `public.iig_request_owner_transfer(text)`; CREATE `public.iig_accept_owner_transfer(uuid)`; CREATE `public.iig_prepare_account_deletion()`; CREATE `iig_private.sync_owner_email()` |
| 4 subscription-security.sql | CREATE `public.iig_my_group_identity()`; CREATE `public.iig_is_protected_group(text)`; CREATE `public.iig_apply_verified_subscription(text,uuid,text,timestamptz)` |

There are **18 distinct functions**: six required pre-existing functions, two
CREATE OR REPLACE helpers, and ten plain CREATE functions.

All functions set an empty search_path. `player_result` is immutable SQL and
`golf_view` immutable PL/pgSQL, both SECURITY INVOKER. The other sixteen are
SECURITY DEFINER. CREATE OR REPLACE preserves ownership and existing grants
except explicit helper revocations. New functions belong to the installing role
and receive its applicable default privileges, modified by the explicit SQL.

| File | Other objects/security changes |
| --- | --- |
| 1 | REVOKE ALL function privileges on `player_result(jsonb)` from PUBLIC, anon, authenticated |
| 2 | CREATE `iig_protected_group_limits`, BEFORE UPDATE OF state on `public.tens_in_groups`, FOR EACH ROW; REVOKE ALL on `protected_group_limits()` and `golf_view(jsonb,integer)` from PUBLIC, anon, authenticated; REVOKE ALL on player action from PUBLIC, anon; GRANT EXECUTE on player action to authenticated |
| 3 | CREATE `iig_private.account_deletions`: user_id UUID PK, requested_at default now(); CREATE `iig_private.owner_transfers`: token UUID PK default gen_random_uuid(), group_id FK to group_owners ON DELETE CASCADE, from_user/to_user FKs to auth.users ON DELETE CASCADE, expires_at default now()+24h, accepted_at; ENABLE RLS on both; REVOKE ALL table privileges from PUBLIC, anon, authenticated; CREATE `iig_sync_owner_email`, AFTER UPDATE OF email on auth.users, FOR EACH ROW; REVOKE ALL on recent_signin/sync_owner_email from PUBLIC, anon, authenticated; REVOKE ALL on the three public lifecycle RPCs from PUBLIC, anon and GRANT EXECUTE to authenticated |
| 4 | CREATE `iig_private.subscription_bindings`: original_transaction_id TEXT PK, group_id FK to tens_in_groups ON DELETE RESTRICT, expires_at, updated_at default now(); ENABLE RLS and REVOKE ALL table privileges from PUBLIC, anon, authenticated; identity RPC REVOKE ALL from PUBLIC, anon, GRANT EXECUTE authenticated; protected-group and apply-subscription RPCs REVOKE ALL from PUBLIC, anon, authenticated, GRANT EXECUTE service_role |

The three PKs create three backing indexes. There are four new foreign keys.
There are **no CREATE/ALTER/DROP POLICY statements**, no changes to existing table
RLS, no changes to roles/schema grants/default ACLs, and no new sequences. The new
tables have RLS enabled, not forced, and no policies. Owners/BYPASSRLS roles can
still access them. Unexpected default privileges or inherited role memberships
must be reviewed: explicit revocations alone do not remove every possible grant.
The migrations contain no top-level golf/owner/member DML. Their function bodies
do mutate data when called, and the new triggers affect later writes.

## Read-only pre-install capture

1. Pause and drain TEST applications, browser/iPhone sessions, Edge Functions,
   API integrations, native verifiers, Auth sign-in/email/deletion operations,
   CI/scripts and other writers. Avoid any other DDL during the window. Absence
   of pg_cron/pg_net does not stop external writers or Auth services. Review the
   captured event triggers and existing notification triggers for side effects.
2. Configure a private libpq service named `iig-test-only`, using ONLY the TEST
   connection copied from its dashboard, SSL enabled. Prefer the direct database
   or session pooler connection, not transaction pooling. Verify the project
   reference in the dashboard and host/pooler username. Do not use an inherited
   generic DATABASE_URL. No LIVE connection is needed.
3. On the Mac, in this package directory, with Python 3 and PostgreSQL 18.6 tools:

   ```bash
   umask 077
   PGSERVICE=iig-test-only psql -X --command='\conninfo'
   PGSERVICE=iig-test-only PGOPTIONS='-c default_transaction_read_only=on' \
     psql -X -qAt -v ON_ERROR_STOP=1 --file=pre-install-capture.sql > capture.json
   python3 prepare.py --capture capture.json --rollback rollback.TEST.sql
   ```

   Only the first two commands contact a database: connection information and a
   repeatable-read READ ONLY catalog/table capture. The Python program is offline.
   Capture does not call application RPCs; those can lock Auth rows after file 3.
   `row_security=off` makes reads fail rather than silently hash RLS-filtered data.
   The fingerprint includes every column of every row in eight protected tables,
   not merely the two known golf groups. UTC/ISO/float settings are fixed.

4. Review capture.json and generated rollback.TEST.sql before installation.
   The capture records original definitions, owners, SECURITY DEFINER/settings,
   effective ACLs with grantors/options and raw proacl; table/schema ACLs and RLS;
   policies, normal/event triggers, role memberships/default ACLs/extensions;
   installation privileges, visible sessions and protected-table fingerprints.
   Roles are read from pg_roles, not password-bearing pg_authid.

   Required checks:
   - All six prerequisite definitions are present. New plain-CREATE functions,
     tables and named triggers are absent. Optional helpers are captured if present.
   - Installing/rollback role owns the postgres-owned functions or has usable
     authority to replace them and SET ROLE to each captured owner. CREATE alone
     is insufficient. It must also be able to create/drop the Auth trigger, access
     all capture rows, and acquire rollback locks on the eight protected tables.
     If managed Supabase restrictions prevent that, stop; do not bypass ownership.
   - Existing public user RPCs have intended effective authenticated access and
     deny PUBLIC/anon, considering inherited memberships. Private helpers/data
     are not exposed to clients. Empty search_path and trusted function owners
     must be verified. Review default ACLs for excess new-object grants.
   - Captured group/history/owner/member fingerprints agree with the already
     recorded baseline. For both 3520 and 5021, preserve the existing compatibility
     checks on JSON shapes, identity mappings and access status.
   - Review non-owner grantor chains if present. The generator deliberately refuses
     those rather than silently changing delegation provenance.

   The TEST project string inside capture.json is an operator attestation, not
   proof of server identity. Some Supabase installations expose a project setting;
   a conflicting nonempty setting is rejected. Verify the connection independently.

## Install and schema rollback

While writers remain paused, install the unmodified files at eadb495 in order:
1 hardening, 2 gameplay, 3 lifecycle, 4 subscription. Each file has its own
BEGIN/COMMIT; do not wrap them in another transaction. Use stop-on-error.
After each file verify the objects/ACLs and unchanged data; do not invoke mutating
RPCs or Auth flows. Stop at the first error. In an interactive session ROLLBACK
the failed file; with a disconnected psql session its uncommitted work is aborted.
Already committed earlier files remain installed.

To reverse a complete or partial installation, recheck the TEST connection and
keep writers paused. Review and run the previously generated file only:

```bash
PGSERVICE=iig-test-only psql -X -v ON_ERROR_STOP=1 \
  -v confirmed_project=nyavvwrsrxqfyhiygkgw --file=rollback.TEST.sql
```

This is a future operator procedure, not an executed command. Do not use
default_transaction_read_only for rollback: it intentionally changes schema.

The generated transaction:
1. Checks TEST attestation and any available project setting; uses 5-second lock
   and 60-second statement timeouts, and obtains exclusive protected-table locks.
2. Requires all eight protected-table fingerprints to equal capture and all three
   newly installed tables to be empty (and locks those tables if present).
3. Drops only the two newly named triggers.
4. Restores all pre-existing affected functions using pg_get_functiondef output,
   including the original shared verified_organiser and original player reader.
   Restores each original owner and effective EXECUTE grants/grant options as that
   owner. It refuses non-owner grantor chains during preparation.
5. Drops only functions absent in the capture, then the three new empty tables,
   using IF EXISTS and RESTRICT, never CASCADE. PK indexes/constraints belonging
   to these new tables disappear with their tables. No baseline table is dropped.
6. Rechecks protected data before COMMIT. Any error aborts the entire reversal.

Ordinary REVOKE/GRANT restores effective ACLs, not a literal SQL NULL proacl marker
where the baseline used implicit defaults. Captured raw ACLs preserve that audit
distinction. No system catalogs are directly modified. Original comments and
unrelated objects are not removed by this reversal.

After rollback, repeat the read-only capture and compare original function
definitions, owners/effective ACLs, original triggers/policies/table settings and
data fingerprints. All new-only objects must be absent. Keep writes paused if
anything differs. The generator refuses to use a post-install snapshot as baseline.

If any guarded data changed or a new table contains rows, **stop**. Do not delete
those rows to make rollback pass, remove guards, or restore an old database over
current data. Transfers, deletion tombstones/Auth deletions, receipt bindings,
subscription changes, scoring and history claims need a separately reviewed
reconciliation/recovery plan. Restoring functions does not reverse those actions.
The current core-data archive rehearsal does not prove full Auth/permission/service
recovery. Fresh Auth sessions can also change guarded rows and cause a safe refusal.

## Validation performed on this package

Python syntax compilation and offline synthetic generation/rejection checks passed
(object counts, guard emission, collision and unexpected-grantor refusal). No SQL
was executed, and SQL syntax, hosted privileges, lock behaviour and the rollback
have NOT been validated by a PostgreSQL/Supabase execution. Before relying on this
as an exercised recovery procedure, rehearse the generated capture/install/rollback
against a compatible isolated Supabase environment with role/Auth coverage; the
existing core-only local restore does not supply that evidence.
