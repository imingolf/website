# Bounded catalog supplement — offline review only

No connection has been made. This is separate from the original approved runner.
See [evidence and client plan](../../../docs/incident-closed-entry/REMAINING-EVIDENCE-AND-CLIENT-PLAN.md).

catalog.READONLY.sql.in is an inert template (placeholders, no credentials). Its
hash is pinned by template-manifest.json. prepare_followup.py compiles only typed
metadata seeds from the original private capture. It cannot connect or run SQL.
The generated SQL is REVIEW ONLY. Do not paste it into the Supabase editor or run
it with psql. The separate followup_runner.py defaults to offline regeneration/hash/
config validation and has no arbitrary SQL flag. Connection requires separate review
and approval; no authenticated command is provided here.

Read scope: named candidate routine metadata/extension ownership; selected saved
write targets' constraints/indexes/column metadata/policies; selected table triggers.
No table data, Auth users, secrets/settings values, application RPC calls or DDL.
Definitions returned for genuinely new helpers are private and may contain sensitive
literals. Known bodies are only fingerprinted, not recaptured. Console output is
sanitised; all raw response/parameter files remain private on the Mac.

All original TLS/read-only/direct-identity checks stay mandatory; the exact saved
server version and captured source/security/target fingerprints must match. No
pooler, alternate address, downgrade, automatic retry or SSL-setting change. Driver
uses the existing exact direct LIVE configuration and prompts privately only in a
separately approved authenticated mode. A metadata collection PASS is not a release
or migration approval. Current packet authorisation markers remain false.

## Review a completed collection OFFLINE

Run `python3 tools/closed-entry-inspection/test_review_followup.py`, then
`python3 tools/closed-entry-inspection/review_followup.py` from the repository.
No config/password/connection flag is needed. Defaults select the latest original
capture, compiled review package and completed follow-up folder. If these do not
match, STOP; use explicit --saved-folder, --package and --folder paths for the
matching collection instead of weakening validation. Original files are not changed.
Only the printed allowlisted JSON may be shared. It intentionally omits definitions,
source identifiers, ACL text, defaults, private paths and arbitrary string values.
Local files are not signed server attestations; the reviewer validates their format,
collection guard report and scope against the regenerated original package.

A candidate's presence/extension membership does not by itself prove PostgreSQL
call resolution. Trigger name order is not a universal execution order: event,
BEFORE/AFTER/INSTEAD OF, row/statement and constraint deferral matter. The next
integration gate is a private local control-flow review combining captured bodies,
argument types/search paths and this metadata. Do not call application helpers to
resolve bindings. If summaries cannot establish a fact, add a narrowly targeted
value-free offline analysis rather than repeat the database inspection.

Production integration remains blocked until actual trigger writes, uniqueness/FKs,
defaults/generated values and lifecycle authority are accounted for. Extend fictional
fixtures with those verified behaviours; test first-score closure, stale payments,
Admin late entry, legitimate scoring, exact-once Finish Round/League/Trip/payouts,
new-round revisions and completed history before proposing installable SQL.

## Join definitions to the completed metadata (no repeat inspection)

Run `python3 tools/closed-entry-inspection/test_analyse_followup.py` followed by
`python3 tools/closed-entry-inspection/analyse_followup.py`. This joins the saved
source to candidate schemas, target identities and trigger event/timing groups.
The same optional --saved-folder/--package/--folder paths select matching evidence.
It is offline, does not invoke any routine, writes no files and prints only sanitised
facts/explicit limitations. Competing overloads are not resolved by a schema-name
shortcut. See [integration gates and migration/rollback proposal](../../../docs/incident-closed-entry/FOLLOWUP-INTEGRATION-GATES.md).
