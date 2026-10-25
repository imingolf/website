# Local-only saved trigger semantic review

No database connection, SQL execution, migration or release is authorised. The
second LIVE inspection is already complete; this tool reads its saved files only.

## Run

From the bug-fix branch, run the new unit tests followed by
`python3 -B tools/closed-entry-inspection/semantic_saved.py`.
The default paths select the original readonly-* capture, compiled followup-review-*
package and completed followup-readonly-* collection under
~/Documents/ImInGolf-LIVE-Inspection. All must match. Explicit --saved-folder,
--package and --folder paths can select an older matching set; do not edit evidence
or weaken checks if automatic selection fails. No config/password is required.

The original package is regenerated and its hashes/scope are checked. Private file
ownership/permissions and the completed report/section/target guards are reused.
These are saved-file provenance checks, not signed server attestation or a current
LIVE drift check. No evidence file is created or modified; output goes to stdout.
-B suppresses Python bytecode output. Share only this generated sanitised JSON.
Do not share catalog files, SQL, private paths, credentials or records.

## What the output means

- Triggers have anonymous numbers tied to anonymous target numbers, exact event/
  timing flags and a symbolic clause (including any WHEN/UPDATE OF condition).
- Supported IF/ELSIF/ELSE branches retain predicate tokens and prior false branches.
  FOR/FOREACH/WHILE/LOOP nesting is retained. Branch paths describe source nesting,
  not an assertion that the write executes: preceding return/raise event references,
  helper calls and iteration effects must also be reviewed.
- Writes retain operation, target candidates, branch/iteration paths and symbolic
  column/value expressions. SELECT/assignment/PERFORM/RETURN/RAISE dataflow is kept
  to connect local variables and earlier exits to later writes.
- Private identifiers become symbol_N; literal/numeric values become constant_N.
  Repeated tokens reuse aliases across output. This proves identical token values,
  not variable identity across routines, value equivalence or causality. A fixed
  whitelist of golf JSON keys and SQL event names remains recognisable; key case
  is preserved. All other user text, names, dates, credentials and numbers are hidden.
- Topic labels for history/payment/League/Trip/round transitions are REFERENCES ONLY.
  A label does not prove a payment snapshot or award is written. Conversely absence
  does not prove irrelevance: private names, helper effects or indirection can hide it.
- ON CONFLICT reports targetless versus explicit target, NOTHING versus UPDATE,
  simple column/named-constraint matches and deferrability. Constraints/indexes have
  linked anonymous tokens, uniqueness/validity/partial flags and symbolic definitions.
  No arbiter or exactly-once behaviour is declared verified. Expression/predicate
  indexes, null semantics, inherited objects, statement filters, deferral and actual
  inserted values still require review. PostgreSQL is NOT invoked to resolve them.

Unsupported dynamic SQL, exception/statement-CASE handlers, complex conflict forms,
labels or unrecognised PL/pgSQL statements do not produce a partial success claim.
The trigger is marked UNSUPPORTED_REQUIRES_PRIVATE_REVIEW with a fixed reason code.
Malformed metadata, missing private files, inconsistent bodies or drifted packages
stop the whole tool with a redacted error. Source/volume limits fail rather than
silently truncate. Only a supported structural review receives
STRUCTURAL_PATHS_EXTRACTED_NOT_SEMANTIC_PROOF; release stays NO-GO in every case.

This is a bounded structural semantic aid, not a complete PostgreSQL/PLpgSQL parser,
control-flow verifier, runtime binder or transitive helper-effects engine. Literal
values are intentionally hidden; exact business semantics depending on those values
must be checked privately on the Mac. Do not present its result as production proof.

## Next integration decision

Review the generated anonymous paths to establish which hook performs history,
payment or status writes and which only references those concepts. For each proposed
Finish Round/save/start operation, identify applicable event/WHEN gates, local exits,
write targets, uniqueness/conflict conditions and loop cardinality. Use existing
saved signatures, paths and definitions for unresolved helper effects. Do not repeat
the inspection or run helpers. If a construct is unsupported, extend offline support
with fictional tests, or perform a private manual review of that exact construct.

Then reproduce the verified behaviour in faithful fictional fixtures. Existing
prototype/client contract tests do not implement LIVE credential issuance or app
routing, and synthetic triggers are not replacements for actual side effects.
Production binding, group-scoped authority, client/retry integration, complete
operation coverage, faithful rollback/recovery and separately approved TEST preflight
remain release gates. No production migration is supplied by this tool.
