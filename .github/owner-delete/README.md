# Owner Dashboard permanent group deletion

Platform owners can review a selected group's name, PIN and record counts, type `DELETE <PIN>`, and permanently remove the group and its golf history. A verified email OTP within ten minutes and a current, unrevoked session are required. Authentication and OTP delivery use the existing self-service adapter.

The migration installs the feature without invoking deletion or changing existing group records. The final RPC checks the owner allowlist, selected row ID, PIN, confirmation and a fingerprint of the reviewed group and related rows. It locks and deletes the related rows in one transaction. A minimal actor/request/row-ID receipt supports retries; it contains no player or golf history. Auth accounts and other groups are retained. Retained PINs 1010/2026 and groups with Apple subscription bindings are blocked.

Existing scoring/payment UPDATE guards are byte-for-byte preserved. Their DELETE branches now require a private permit created only by the owner deletion RPC. Triggers on the twelve tables without foreign keys prevent late orphan inserts. Account-wide release-audit entries with null group IDs remain allowed.

## Checks

From this directory, `npm ci && npm test` builds an empty local schema from audited definitions and runs 21 PostgreSQL checks using PGlite. The fixtures contain no customer records. `tests/browser.mjs` is the portable Playwright suite; `--prepare <directory>` only creates a local fixture. In the managed environment, serve that fixture with the supported preview and load `tests/browser-checks.js` from a wrapper containing `#summary`, `#results` and `iframe#app`; ten DOM regression scenarios run entirely against synthetic adapters. No LIVE auth, emails, payments or deletion calls are used by tests.

## Release and recovery

Apply `supabase/migrations/20261115111413_owner_permanent_group_delete.sql`, then deploy the five app files. The migration checks the inspected guard hashes and aborts if they changed. The installation has a two-second lock timeout. A frontend rollback hides the action; the installed database checks remain safe. To disable only this feature, revoke EXECUTE on the two public owner deletion RPCs from authenticated. Do not remove guards or permit checks. The migration cannot restore groups deliberately deleted later by the owner.

The `.github` directory holds migration and test sources outside the public Netlify file output. Verify deployment inventory after publication. Production deletion is deliberately not exercised by the release process; the first real deletion is the owner's explicit action in the dashboard.
