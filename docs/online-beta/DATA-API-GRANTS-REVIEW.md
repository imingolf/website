# Registration beta: 30 October 2026 Data API grant change

Status: OFFLINE SOURCE REVIEW; no database access, SQL execution, permissions
change, deployment or production modification. Prepared on
`improve-new-user-registration`, not main, PR #6 or the rollback-preparation branch.
The existing four migrations and original recovery evidence remain immutable.

## Owner summary

The announcement does not require giving the app more table access. This beta
uses authenticated database functions (RPCs), not direct table reads/writes.
The four rehearsed migrations create three **private-schema** tables, not public
ones. Existing public golf tables keep their current permissions after rollout.

We should make clean installations independent of automatic privileges and close
unnecessary service-role access explicitly. A separate, review-only ACL tail is
prepared; it is NOT part of the rehearsed installation and must not be installed
yet. The current original rollback has no authority to undo arbitrary additional
changes to existing table/schema/default permissions.

## Official guidance checked

- [Supabase platform-default announcement](https://github.com/orgs/supabase/discussions/45329):
  October 30, 2026 rollout for existing projects; new public tables need explicit
  opt-in grants and existing tables retain their grants. The discussion describes
  a staged rollout, so actual catalog state matters more than the calendar.
- [Securing the Data API](https://supabase.com/docs/guides/api/securing-your-api)
  ([official source reviewed](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/api/securing-your-api.mdx)):
  grants determine object reachability; RLS determines row access. Put deliberate
  grants and RLS in the same migration. Function EXECUTE via PUBLIC and sequence/
  non-Data-API privileges need separate consideration; do not assume the table
  setting revokes every privilege. This source documents remaining TRUNCATE,
  REFERENCES, TRIGGER, MAINTAIN and sequence UPDATE permissions with exposure off.
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
  ([official source reviewed](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/database/postgres/row-level-security.mdx)):
  enable RLS explicitly for SQL-created tables; bypass/owner execution requires
  separate care. service_role's BYPASSRLS is not permission to grant it every table.
- [Supabase database roles](https://supabase.com/docs/guides/database/postgres/roles)
  ([official source reviewed](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/database/postgres/roles.mdx)).

Do not copy the announcement's illustrative broad GRANT statements into this app.
The app's narrower RPC contract is the required access model.

## Table-by-table inventory

| Source | Creates/recreates | Role access required |
| --- | --- | --- |
| integration-hardening.sql | No table creation/drop | Replaces original functions; existing owners/ACLs must match capture. |
| protected-gameplay.sql | No table creation/drop | Authenticated gameplay RPC, internal helpers/trigger. |
| account-lifecycle.sql | iig_private.account_deletions; iig_private.owner_transfers | No direct anon/authenticated/service_role access; owner-executed RPCs only. |
| subscription-security.sql | iig_private.subscription_bindings | No direct API role table access; two service-only subscription RPCs. |
| empty-test-schema.sql; combined setup-test-project.sql | public.tens_in_groups; public.iig_notification_settings; public.iig_notification_events | No direct API role table access. Function owner accesses tables and identity sequence. |
| organiser-access.sql; combined setup-test-project.sql | iig_private.setup_testers; group_owners; group_members | No direct API role table access; verified, identity-bound RPCs. |
| self-service-registration.sql | iig_private.registration_settings; platform_owners, IF NOT EXISTS | No direct browser table access. Existing objects must be inventoried, not assumed clean merely because IF NOT EXISTS succeeds. |
| player-scores.sql | No tables | Authenticated identity-bound score RPC. |
| app/supabase-setup.sql | Obsolete incompatible public.tens_in_groups variant | DO NOT RUN: deletes/reinserts a demo group. Not a migration/reset/recovery procedure. |

There are eleven distinct supported application tables: three public and eight
private after the four migrations. No planned file recreates an existing public
table as part of the incremental installation. Tables for future multi-group,
profile/invitation features have not yet been designed; none is implicitly
approved or covered by this review.

## RLS and the intended permissions

All eleven supported tables explicitly enable RLS in source. These migrations
create no direct client policies: **no policy means default deny** for ordinary
roles. That is intentional because browsers use RPCs. Adding permissive USING
(true) policies or direct table grants would defeat the intended boundary.

| Surface | anon | authenticated | service_role |
| --- | --- | --- | --- |
| Direct new app/private table access | None | None | None |
| Direct identity sequence access | None | None | None |
| get_group_access_status RPC | EXECUTE, limited access metadata | EXECUTE | Not required by current source callers |
| New player action, owner transfer, account deletion preparation, group identity RPCs | None | EXECUTE with internal checks | None required |
| iig_is_protected_group / iig_apply_verified_subscription | None | None | EXECUTE for verified server workflow |
| Internal new helpers/trigger functions | None | None | None; invoked through function-owner/trigger context |

These are intended permissions, not a claim that the online catalog currently
matches. Role inheritance, column ACLs, creator defaults, schema exposure and
service-role effective privileges still require a later approved catalog review.

SECURITY DEFINER functions execute as their owner and can bypass RLS. The reviewed
registration/gameplay/lifecycle implementations check verified non-anonymous,
non-banned identities, group ownership/membership, invitation matching and relevant
revision/recent-sign-in checks. Player views filter private owner/Side Game data.
The platform grant change neither creates these checks nor validates them. Hosted
JWT/cross-user tests remain required before release. Existing PIN-only RPC paths
for unowned legacy groups are deliberately preserved; their privacy model is not
converted by this review. New protected groups reject those legacy state routes.
The owner bulk-handicap validation gap and broader beta-spec gaps remain open.

service_role bypasses RLS, so an unintended table grant is significant even when
there are no policies. Neither shipped Edge Function needs direct application
table access: account deletion calls a user-authenticated RPC then Auth Admin;
subscription verification uses the two explicit service RPCs. Notification sender
code/external integrations are not inventoried here. Do not revoke their existing
permissions on TEST or LIVE based on this source-only conclusion.

## Prepared source changes, not executed

1. **Clean-install templates only:** explicit service_role denials on the three
   new public tables, their identity sequence, private schema/tables/helpers;
   explicit EXECUTE on legacy RPCs instead of inherited function defaults; USAGE
   on public for RPC callers, never CREATE or table access. The combined setup
   remains in sync and refuses existing app tables/schema. These are not update
   scripts for populated TEST/LIVE and do not replace the original backup baseline.
2. **registration-object-acls.DRAFT.sql:** separate proposed tail after the four
   files, scoped ONLY to the three new tables and ten new functions absent from
   the original capture. Revokes PUBLIC/anon/authenticated/service_role defaults,
   then grants only five authenticated RPCs and two service RPCs. Internal helpers
   remain inaccessible. No change to existing table/column/sequence/schema/default
   ACLs, ownership, policies or data. A default-off interlock makes accidental
   standalone execution stop. The marker is NOT project identity proof.
3. **data-api-permissions.READONLY.sql:** supplemental catalog review of effective
   table/sequence/schema privileges, raw ACLs, column ACLs, policies and creator
   default ACLs. It is not added to the approved runner, is not a standalone
   connection procedure, and must receive the runner's full target/TLS/transaction
   protections before any later execution. Existing function-grant inventory and
   role/membership capture must be reviewed alongside it.
4. **Obsolete setup warnings:** remove the old README's "run once" direction and
   mark the destructive historical SQL as obsolete. Historical statements remain
   for reference; they have not been executed or turned into a reset tool.

No global ALTER DEFAULT PRIVILEGES, GRANT ALL, public/client table grant,
BYPASSRLS change, new RLS policy or permissions reset is proposed. The pinned four
SQL blobs at eadb495 are byte-for-byte unchanged. No current installer/runner
includes the draft tail or supplemental audit.

## Rollback/recovery compatibility and gaps

The original capture contains table ACLs/owners/RLS, schema ACLs, policies, default
ACLs, roles/memberships, function owners/definitions/effective ACLs and grantors.
Its guarded rollback restores replaced function ACLs explicitly, including grant
options, and removes the newly created functions/tables with RESTRICT and empty-
table/data fingerprint guards. The old public tables are not recreated or regranted
by that rollback. The cutoff therefore does not itself require table GRANTs in it.

The proposed ACL tail touches only objects that the original rollback removes.
Static tests prove this object scope, but **the expanded bundle has NOT been
rehearsed**. A new local installation/post-install privilege check/guarded-rollback
rehearsal is required before approving that bundle. Do not alter the old four
hashes, original capture, original rollback or successful rehearsal report.

Important incomplete coverage:

- Original core capture inventories table/default/schema ACLs, but not sequence
  ACLs. The supplementary rehearsal audit checks sequence values, not its ACLs;
  column ACLs are supplementary. The new proposed inventory closes observation
  gaps but is not yet integrated or executed. No automatic sequence ACL restoration
  is claimed.
- The October platform rollout may legitimately change pg_default_acl. Current
  baseline comparison MUST stop on that difference, even if data hashes match.
  Preserve the original evidence; review a metadata diff and separately approve
  updated capture/rollback/rehearsal if necessary. Do not ignore the mismatch,
  manufacture a historical hash or silently replace the original baseline.
- The backup used --no-owner --no-acl. Restoring it does not recover original
  permissions. The fictional local Auth rehearsal proves neither full hosted Auth
  recovery nor original ACL restoration. Exact owner/schema/table/column/sequence/
  function/default privileges require an independently reviewed recovery manifest
  and supported hosted-role handling before a full restore can be called complete.
- The old rollback does NOT undo arbitrary grants on existing tables/columns,
  schema resets, platform settings or default-privilege changes. Any such future
  change needs its own captured inverse/recovery plan and rehearsal.

## Schema resets and future LIVE work

Never run a reset, DROP/CREATE path or empty-project setup against populated TEST
or LIVE. The clean templates are for genuinely empty, separately approved targets.
A dropped/recreated public table is a new object: it loses old ACLs and must receive
its exact reviewed grants, RLS, policies, sequence/column permissions and required
schema/function access in the same transaction. Never restore access with global
broad grants or by assuming the old default ACL will return.

For each future table/function, document its API consumers and intended roles,
explicitly deny unused roles, explicitly grant only needed operations, enable RLS
and add restrictive policies only if direct access is intended. Check all object-
creator roles/defaults and inherited/column privileges. New function EXECUTE can
still arrive via PUBLIC; CREATE OR REPLACE preserves existing ACLs and needs an
explicit privilege review. Run clean-schema tests with permissive and restricted
defaults and actual negative API/JWT tests in approved isolated TEST. Notifications,
Admin, leagues, Trip Mode, scoring/history and service integrations need regression
coverage; none is authorised to be changed on LIVE by this preparation.

## Verdict and next gates

**The four-file design is compatible with opt-in public table exposure. This is
NOT installation approval.** No broad grants or immediate online permission fix
are required merely because of the announcement.

Before any expanded TEST installation: resolve backend TLS, rollback authority,
writer controls and original-baseline drift; approve/integrate the supplemental
read-only inventory; review actual grants/defaults/exposed schemas; rehearse the
ACL-tail bundle and negative cross-role permissions; address recovery gaps.
Any future LIVE migration remains a separately reviewed incremental plan, never
an empty-project reset or an automatic promotion of these TEST scripts.

Offline tests model permissive vs restricted ACL defaults and inspect source;
they do not run SQL, validate PostgreSQL syntax, or establish current database
permissions. No database/permission operation or deployment is authorised.
