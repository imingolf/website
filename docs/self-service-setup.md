# Self-service setup release gate

app/group-setup-preview.html is a design prototype. No network calls, accounts, groups, email or stored personal details. Its link appears only on the Netlify deploy preview. Do not use mock screens as App Store screenshots.

## Findings
- Creation requires the private Owner code via create_golf_group.
- Owner metadata uses owner_update_group.
- adminPin and adminSetupToken are read from shared state; Admin PIN comparisons happen in client JavaScript. Server authorisation must be reviewed before public self-service.
- supabase-setup.sql is an obsolete single-group setup containing deletion and demo insertion. DO NOT RUN IT.

## Read-only live inventory
Run these in Supabase SQL Editor. They return schema and grants, not player data or function bodies. Review function definitions privately afterwards; legacy definitions may contain secrets and must not be posted in public issues.

```sql
select table_name, column_name, data_type, is_nullable
from information_schema.columns where table_schema = 'public'
order by table_name, ordinal_position;

select p.proname, pg_get_function_identity_arguments(p.oid) as arguments,
pg_get_function_result(p.oid) as result, p.prosecdef as security_definer, p.proacl as grants
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and (p.proname like '%group%' or p.proname like '%admin%')
order by p.proname;

select tablename, policyname, roles, cmd, qual, with_check
from pg_policies where schemaname = 'public';
```

## Before implementation can go live
1. Verify organisers through Supabase Auth. Confirm email delivery, rate limits, bot protection and wrapper-compatible verification. Provide recovery and account deletion.
2. Store ownership separately from player-editable state. Enforce all admin mutations server-side; keep Admin PINs and setup credentials out of player-readable responses. Never expose the Owner code.
3. Create group and Owner register entry atomically. Derive identity from the verified session. Generate unique PINs server-side with collision retries. Lock per organiser and use an idempotency key to prevent duplicate groups after retries.
4. Confirm current Free/Plus entitlements and show limits before creation. Do not invent a free trial or feature allowances.
5. Connect successful creation to existing competition setup. Player invitations contain player access only; support native sharing and copy fallback.
6. Test unauthenticated/unverified creation, cross-group edits, replay, concurrent retries, collisions, suspension, offline failure, recovery and deletion in staging. Preserve 1010 and 1260.
7. Validate the full journey on a physical iPhone, then capture real iPhone/iPad App Store images.

No live rollout or database migration is included. The current schema/function definitions and Auth configuration are required to finish the backend safely. Push notifications remain lower priority.
