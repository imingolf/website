# Side Game challenge response correction

Decline wrote `acceptedAt`, but the installed validator requires `declinedAt` and unchanged acceptance metadata. Production logged `INVALID_CHALLENGE_RESPONSE` at 14:59 and 15:01 UTC on 17 November 2026. The client then correctly blocked uncertain subsequent writes, but hid the error in the group panel.

The migration replaces only the timestamp key in the existing player action function, with an exact-match precondition. All permissions and validation remain intact. The web client now shows response errors and a read-only Reload challenges recovery action beside incoming challenges. Busy actions report that an update is in progress. Recovery never automatically accepts or declines.

Verification: `node .github/sidegame-response/tests/database.mjs` reproduces the original error, then verifies both corrected actions against the actual production validator using synthetic data. It retains all other state, an earlier £4 result, recipient restrictions and revision checks. Lock/auth and persistence adapters are fixture stubs; this is not a real-phone test. PGlite is reused from the existing Side Game tests' dependencies.

`node .github/sidegame-response/tests/client.cjs` verifies visible failure/recovery and no automatic retry. Root sync and invite tests also pass. No real challenge is actioned by these tests. Phone acceptance remains for the owner. Notification sending and rollout remain unchanged.
