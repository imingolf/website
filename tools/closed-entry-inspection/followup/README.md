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
