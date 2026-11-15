# Multiple groups for one organiser — approved release

An organiser can currently own only one group. This candidate lets the same verified account create and manage several independent groups through **Group → Change group**. The picker shows group names and PINs, retains the existing PIN joining route, and offers **Create another group**. Additional groups reuse the four-step onboarding and automatically link the organiser as a player.

**Status: LIVE release approved by Greg on 15 November 2026 ("just do it, no demo, if yu are happy its safe"). The database migration has been installed and verified; the three app scripts are ready for the single production publication tracked by this release PR. No Apple build or submission is part of this change.**

Private preview: https://imingolf-multiple-groups-review-15nov.f7ndhjnfsj.chatgpt.site

## Audited baseline

- Website main: `a8993b8228ed03041f2c10678e264c343149072c`.
- Netlify production deploy: `6af9d2dba3b0ac3aa9202f75` (15 November 2026, 15:42:25 UTC).
- LIVE database catalog read only, 15 November 2026: `baseline/functions.json` and `baseline/writers.json`. These contain function definitions and grants, not customer rows.
- Existing fixture sources: `.github/organiser-player/tests/audited-functions.json` and `.github/owner-delete/tests/catalog.json`.

## Implementation

The database currently enforces `UNIQUE(owner_id)` on the private ownership table. The candidate replaces it with `UNIQUE(owner_id,request_id)` while preserving the group primary key, foreign keys, closed private schema and existing row data. An account-row lock serializes creations. The original first-group API still refuses an unrelated new creation request if a group already exists; the explicit additional-group API requires an existing owned group. Both APIs retain idempotent retries and atomic player linking.

New authenticated RPCs:

- `iig_list_owned_groups()` returns only the verified account's group names, PINs and availability, never group data or invite tokens.
- `iig_read_owned_entry_group(p_pin)` enforces existing owner access for the requested PIN.
- `iig_create_additional_playing_group(...)` creates another group and links the organiser using the existing membership writer in the same transaction.

The new RPCs use fixed search paths and explicit authenticated-only grants. A private creation helper remains inaccessible to client roles; no private schema or table permissions are broadened. Public guarded definers follow the established RPC boundary because granting client access to the private schema would weaken that boundary.

All organiser reads now carry an explicit PIN, including polling, save readback, onboarding payments, first competition setup, finish-round preparation and player/organiser switching. Existing write operations, authentication, player joins, payment/score rules and historical records are unchanged. Legacy owner reads without a PIN retain single-group behavior and reject ambiguous multi-group access. Current complimentary app code does not invoke legacy identity or purchase verification APIs; no subscription or native code is changed.

The selected owned group is remembered per account. Only server-verified ownership enables organiser controls. Changing group preserves the existing unsaved-action guard; cancelled or failed switches retain the current view. Additional setup can be cancelled before creation and resumes its own PIN after refresh.

## Validation

- **17 PostgreSQL checks passed**, using actual audited function definitions in PGlite 0.5.16 and synthetic accounts/groups. Coverage includes migration preservation, first-group compatibility, additional creation and retries, wrong-account reads/writes, member versus owner access, isolated settings writes, stale revisions, rollback on failed player linking, anonymous/unverified rejection, grants, and account departure across all owned groups without erasing golf records.
- **41 browser integration checks passed**, using the actual modified app with an isolated transport. Covers group selection and switching, widths 320/390/768/1280, failed/cancelled switches, additional four-step setup from organiser and player routes, setup refresh, payment save scoping, delayed response isolation, switching guards, selected player identity, PIN joining, first-time OTP creation and single-group returns.
- Syntax checks and `git diff --check` passed.
- The real competition journey was already completed by Greg the previous week; it was not repeated. No real payments, customer writes or email delivery were exercised. Physical iPhone acceptance of this new picker remains for review.

Reproduce the database checks from the repository root:

```sh
python .github/multi-group/build-migration.py
cd .github/multi-group
npm install
npm test
```

`make-preview.py /absolute/preview-path` builds the actual app with synthetic data, fake keys and CSP network blocking. `checks.html` runs the browser checks. The preview transport is outside `app/` and must never be included in a LIVE deployment. The preview is owner-private through ChatGPT Site access and cannot contact the LIVE database or payment providers.

## Release and rollback boundaries

The reviewed migration is deliberately stored under `.github/multi-group/supabase/migrations/`, outside automatic production migrations. Supabase CLI 3.1.0 created the local migration file. After Greg’s explicit LIVE approval, the reviewed migration was applied through the Supabase migration API. Before/after digests of all 13 group rows, 7 ownership rows and 17 membership rows matched exactly. A rolled-back read-only policy check confirmed Greg’s owned-group list, explicit owner read, existing player link, other-owner denial and single-group compatibility. No customer group was created or modified for testing.

Production main and the published deployment were rechecked against the baseline immediately before the approved release. The migration aborts if any affected function definition changed; that guard passed. The database change was installed before the three app scripts are released together. Existing single-group clients remain compatible during rollout. The release PR records the resulting production deployment and verification.

After additional groups exist, **do not restore the old unique-owner constraint or old implicit group readers**. Preserve the new ownership rows and explicit read API; disable additional creation in a forward fix if needed. Reverting blindly to the old app can block multi-group organisers. No rollback may delete groups or merge their players, payments or histories.

Security advisors were compared before and after. The only additions were three expected authenticated SECURITY DEFINER RPC notices for the new explicitly granted, verified-owner endpoints. Anonymous and service-role EXECUTE grants are absent, and the private schema remains closed. Existing unrelated advisory findings were not changed.

The permanent group deletion flow remains group-scoped. Existing account departure already loops over all owned groups; the new database check confirms it revokes access while keeping canonical golf state.
