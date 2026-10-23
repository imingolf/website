# TEST Auth-trigger rollback authority assessment

Decision: NO-GO for installation. Supautils provides a documented mechanism,
but project-specific rollback authority is not yet established by the evidence
available for this review. TEST writer controls also remain unconfirmed.

## Evidence actually available

The operator reports that diagnostic run
readonly-preflight-20261023T125316.213657Z passed, the original captured TEST
baseline is unchanged, and an exact configured Supautils grant was found.
The Mac-only auth-trigger-ownership.json has not been supplied here; its full
contents, installed binary/build and actual hook execution have not been
independently inspected. No online connection or DDL was performed for this review.
A diagnostic PASS means collection succeeded, not that rollback was exercised.

The diagnostic's candidate condition establishes an exact current postgres role
entry containing auth.users, a Supautils preload entry, and a registered sighup
setting with no pending restart for that setting. It does not establish the
installed hook implementation, its effective elevation target, or that no managed
restrictions apply to this specific trigger. No claim of a successful online
rollback follows from this setting.

## What official documentation and source establish

PostgreSQL 17 DROP TRIGGER documentation requires ownership of the containing
table. Its pg_has_role documentation distinguishes immediately available role
privileges (USAGE) from membership (MEMBER) and permission to SET ROLE (SET).
The original rollback runs the trigger drop as postgres before later function
restoration SET ROLE statements. TRIGGER privilege permits creation, but cannot
substitute for drop authority. SET-only membership is not used by this rollback.

Supabase's official Supautils README explicitly documents
supautils.drop_trigger_grants as allowing specified roles to drop triggers on
specified tables without owning those tables. Reviewed upstream source at
7a22990746ec17b1a84cf2a097dda411222f8ec7:

- Matches GetUserId()'s exact role name; membership in a differently named role
  does not supply this grant.
- Resolves the specified table and grant-list tables to relation identities.
- Routes the matching DROP TRIGGER utility statement through RUN_ELEVATED using
  the managed Supautils superuser configuration, then runs the utility chain.
- Registers drop_trigger_grants as a sighup configuration setting, rather than
  an ordinary session-settable placeholder.

Thus the documented mechanism can supply authority even when owner USAGE is
false. The earlier native-ownership-only check is conservative for this managed
case, not evidence that postgres definitely cannot drop this trigger. Conversely,
a matching setting alone does not verify that this TEST project's installed
managed implementation provides that route. The reviewed upstream commit is not
asserted to be the TEST installed version.

The exact statement needing confirmation is:

    DROP TRIGGER IF EXISTS iig_sync_owner_email ON auth.users RESTRICT;

It is ordinary top-level SQL within the original guarded rollback transaction,
as current_user postgres, with search_path pg_catalog. The table is explicitly
schema-qualified. The grant is table-specific rather than trigger-name-specific;
no additional trigger rights are requested. The existing rollback also acquires
locks, checks original protected fingerprints and requires new tables to be empty.
None of those checks is bypassed by a supported drop-trigger hook.

## One remaining verification action

Send SUPPORT-AUTH-ROLLBACK.txt to Supabase support for TEST project
nyavvwrsrxqfyhiygkgw, attaching only this run's auth-trigger-ownership.json.
Ask support to confirm the currently installed/active managed implementation
handles that exact rollback statement for postgres using the existing setting,
including its elevation target, without any permission or ownership changes.
Do not attach database dumps, Auth data, capture.json, passwords or service files.

An authoritative project-specific confirmation, consistent with the diagnostic
JSON and the documented mechanism, would close the managed-authority evidence
gap for review. If support cannot confirm it, do not approve installation:
request a supported approach for separate migration/rollback design review.
No test DDL, even rolled back, is authorised. No privilege grants, table ownership
changes, privileged helper installation or alternative execution identity are
proposed.

## Conditions after confirmation

Support confirmation would establish a privilege route, not prove that the
entire rollback will complete: dependencies, event hooks, timeouts and data
guards can still stop it. Local rollback PASS did not exercise this hosted hook.
Retain the original guarded rollback byte-for-byte, original capture, pinned
migration sources, backup observations/fresh-backup recovery requirements and
all fingerprint/security comparisons. Any future acceptance of the managed
route in the readiness checker must be reviewed, tied to support evidence and
revalidated against unchanged active settings/identity; no guard is relaxed here.

Writer pause/drain must separately be confirmed and kept controlled. Read-only
baseline checks must still pass immediately before any separately authorised
installation. This diagnostic run did not create the fresh recovery backup;
missing-checksum recovery remains part of readiness. Full hosted Auth/ACL/service
recovery is still not rehearsed. LIVE, PR #6, deployment and releases are untouched.

## Official references reviewed

- PostgreSQL 17 DROP TRIGGER: https://www.postgresql.org/docs/17/sql-droptrigger.html
- PostgreSQL 17 role inquiry functions: https://www.postgresql.org/docs/17/functions-info.html
- Official PostgreSQL documentation source (HTML access was denied here):
  https://github.com/postgres/postgres/blob/REL_17_STABLE/doc/src/sgml/ref/drop_trigger.sgml
  and https://github.com/postgres/postgres/blob/REL_17_STABLE/doc/src/sgml/func.sgml
- Supabase Supautils documentation:
  https://github.com/supabase/supautils/blob/7a22990746ec17b1a84cf2a097dda411222f8ec7/README.md#drop-triggers
- Exact role/table matching:
  https://github.com/supabase/supautils/blob/7a22990746ec17b1a84cf2a097dda411222f8ec7/src/drop_trigger_grants.c
- DROP TRIGGER hook:
  https://github.com/supabase/supautils/blob/7a22990746ec17b1a84cf2a097dda411222f8ec7/src/table_grants.c
- Configuration registration and utility policy:
  https://github.com/supabase/supautils/blob/7a22990746ec17b1a84cf2a097dda411222f8ec7/src/supautils.c
