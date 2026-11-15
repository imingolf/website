# Automatic organiser player during four-step setup

Step 1 collects name, email, group name and handicap. After the existing email verification, `iig_create_owned_playing_group` creates the group and the organiser's verified player membership in one transaction. Steps 2–4 are unchanged. No optional player-creation decision or fifth step.

The new function uses SECURITY INVOKER and composes existing authenticated creation/join/readback functions. It validates the handicap, preserves existing server authorization and uses the existing idempotency key. A join or confirmation failure rolls back creation. Existing group records, auth users, payment state and original function definitions are not changed by the migration.

This applies to newly created groups. It does not backfill an existing organiser's unknown handicap or alter existing memberships.

## Verification

- `tests/audited-functions.json`: actual server function definitions, without customer records, used for isolated SQL tests.
- `tests/build-fixture.py`: creates an empty fixture from the existing catalog and functions, with synthetic auth.
- `tests/database.mjs`: runs using pinned `@electric-sql/pglite` 0.5.16. Tests include atomic creation, account binding, idempotency, validation, authorization, rollback, and unrelated data preservation.
- `tests/build-browser.py OUTPUT_DIRECTORY`: builds an isolated browser test copy. The test adapter intercepts requests and CSP disables network connections. It is never used by the production app.
- `tests/browser-runner.html`: actual client-code integration checks with the simulated backend, including four-screen layout, OTP, player display, returning users, existing joining and payment-save preservation.

Run from repository root:

```sh
python .github/organiser-player/tests/build-fixture.py
node .github/organiser-player/tests/database.mjs
python .github/organiser-player/tests/build-browser.py /workspace/scratch/organiser-player-qa
sites-preview start /workspace/scratch/organiser-player-qa
```

Browser QA uses the managed browser and the exact URL returned by `sites-preview`. No real email, payment or group-creation request is made during checks. Only `app/self-service.js` changes in the production frontend. All fixtures remain under the non-published `.github` directory.
