# Offline binding correction and client transition contract

## TRIM: correction, not catalog widening

Unqualified TRIM is PostgreSQL SQL syntax, not a routine lookup for a function
literally named trim. The local parser regression demonstrates lowering to btrim,
ltrim and rtrim for BOTH/default, LEADING and TRAILING, while public.trim remains a
custom qualified call. The offline analyser now marks recognised unqualified syntax
as SQL_TRIM_SPECIAL_FORM_NOT_A_TRIM_CATALOG_LOOKUP. It does NOT declare the resulting
routine OID/signature resolved in LIVE. Existing saved argument types and search
paths still need review. No new catalog collection is requested merely because the
old lexical scanner reported MISSING_CANDIDATE. Literal/comment text is masked.

The original export/template and hashes are unchanged, so completed evidence
packages remain valid. This is an analysis correction, not a weakened capture guard.

## Isolated client integration contract

incident-tests/closed-entry/client-transition-contract.cjs is a source-independent
OFFLINE prototype, NOT loaded by the app. Its injected transport never connects in
tests. Its envelope/RPC contract is proposed, not installed or bound to legacy RPCs.
It implements explicit save/finish/start routing, a group-bound capability held only
in closure memory, clearing credentials on group load/logout, no credential on
ordinary save, immutable captured request payloads, expected round/revision, fresh
request IDs, single in-flight operation and rejection of responses from a cleared
session. Server failures, mismatched identities/revisions and ambiguous timeouts
require reload with no automatic retry/rebase; arbitrary server error strings are
not propagated. An invalid load also clears the old authority.

Production still requires server capability expiry/revocation/permission checks,
trusted group-specific issuance/recovery, reviewed verified-TLS transport, legacy
read envelope and version handshake, client UI/queue wiring, safe nonce receipts
and duplicate retry resolution. Request IDs in this prototype are NOT server-side
idempotency. No credentials are issued or persisted by these tests. The production
app, registration branch and completed demonstration remain unchanged.

## Specific boundary preventing faithful TEST integration

The owner's latest summary establishes two different event hooks: one INSERT,
one UPDATE; both row-level AFTER, enabled. They do NOT both fire on an ordinary
UPDATE, so ordering them against each other for that event is irrelevant. The BEFORE
validator must reject before either hook's applicable side effects; accepted updates
must retain the UPDATE hook unchanged. Group creation and status INSERT effects
must remain distinct from Finish Round. Internal constraints/other event triggers,
WHEN/UPDATE OF clauses and any recursive updates still need the saved private review.

No actual trigger bodies, ON CONFLICT column/expression targets or unique-index
predicates are accessible in this workspace. Counts, aliases and lexical write
matches cannot prove exactly-once payout/history semantics. A faithful adapter
cannot be completed by substituting synthetic triggers for those definitions.
The minimum remaining evidence task is LOCAL review of already saved definitions
against constraints/indexes: per trigger, establish event condition, old/new round
comparison, target insert/update column mapping, conflict arbiter/action, uniqueness,
FK/deferral/default behaviour and whether awards are written or only notifications.
Likewise establish actual argument expressions/types and fixed path for non-syntax
calls. Do not execute functions or reconnect to determine this. If that review cannot
be completed with available authorised access to the Mac files, report the exact
unavailable definitions rather than authoring production SQL from counts.

## Migration / rollback status

FOLLOWUP-INTEGRATION-GATES.md remains the non-executable proposal. Production SQL,
credential issuance and actual UI routing are unfinished, so online TEST installation
is NO-GO. Isolated fictional testing is ready and passes; it is not faithful TEST
integration. Next gates are private semantic review, corresponding faithful fixture,
complete guard/client/authority adapter and side-game/maintenance/Trip coverage,
then local security/concurrency and exact rollback rehearsal. Only afterwards seek
separate approval for target-specific TEST identity/parity/privilege/recovery/writer
checks. Keep historical results and new protected metadata on rollback; no CASCADE,
no destructive fixture reset in any existing database and no vulnerable-writer bypass.

No further database inspection is currently justified by the trim warning.
