# Assessment of the uploaded sanitised AFTER UPDATE report

Evidence: the owner uploaded sanitised-after-update.json, produced by the approved
local reviewer. The file itself is NOT committed. No database connection or record
read/change was made. This assessment supersedes prior assumptions based only on
headline counts and invented adversarial fixture patterns.

## Established from the full symbolic report

- Exactly one noninternal AFTER UPDATE trigger is shown; its body has 23 events.
- Exception blocks 2 and 3 are SIBLINGS with parent block 1. They are not a broad
  nested pair enclosing history/payment INSERTs. Their protected events are only
  event 4 and event 6 respectively: NULLIF/field extraction/type-cast assignments.
- Handler 1 (event 5) is a direct RETURN NEW on OTHERS. If it is invoked, the trigger
  function exits. As an AFTER-row trigger this return value does NOT cancel/rewrite
  the group's underlying UPDATE. It is a skip of the remaining trigger processing.
- Handler 2 (event 7) is a direct assignment of NULL to the old-value variable. It
  then leaves its block and continues at event 8. It does not simply have an unknown
  empty body, and no hidden handler statement is shown. OTHERS exclusions still apply.
- No database write is inside either protected block or either handler. Therefore
  the earlier swallowed-history-write fixture is NOT a faithful description of this
  trigger. The reported handlers do not catch the later INSERT/UPDATE failures.
- All six direct writes target the same anonymous target 3: two UPDATEs (2,13) and
  FOUR INSERTs (14,16,18,22). No direct write to the group JSON, history/score archive,
  player payment row, League standings or Trip standings is shown. Topic references
  to history/paid fields had previously been mistaken for domain persistence effects.
- History is read for its array length (9), which contributes to a composite key (10).
  Paid/another nonempty player field are counted (19,20); a change in that count gates
  a text-building INSERT (21,22). These reads are not history/payment snapshots.
- INSERTs 14,16,18 share an old/new computed-open/date/label change condition. 16 and
  18 additionally require computed times greater than NOW. The remaining INSERT 22
  uses the old/new participant-count predicate. All insert text/scalar metadata;
  their structure is consistent with opening/reminder/first-participant scheduling.
  Actual private identifiers/literals/types are hidden, so notification purpose is
  a strong interpretation, not a claim of observed table names or full semantics.
- Each INSERT uses the same explicit three-column conflict key and DO NOTHING.
  Target 3 constraint 4 is a validated, nondeferrable UNIQUE on the same symbols;
  index 2 is matching, unique, valid, ready and nonpartial. This supplies a structural
  arbiter candidate. It does not establish hidden null/collation/operator facts or
  identical payload on duplicate, and it is NOT an exactly-once award/result proof.
- There is no standalone statement CASE in this report: the observed CASE expressions
  appear in count/select expressions. The original generic parser stop did not
  establish that a statement CASE existed in the real trigger.

## Correction to earlier modelling

The older two-handler/five-path/result-ledger fixtures are adversarial contracts,
not the actual LIVE hook. They remain useful to test fail-closed behaviour but MUST
NOT drive a production requirement to create five result rows or introduce another
financial ledger merely to preserve this hook. There are four INSERTs in this uploaded
UPDATE report, not five; no cause is assumed for the earlier headline count.

The new test-observed-update-pattern.cjs follows the observed SHAPE: settings gate,
closed/open processing, two sibling conversions, history-length key, four metadata
INSERT branches, status updates and one triple-key uniqueness arbiter. Private field
names, cast type, literal values, time calculations and statuses are chosen fictional
values, explicitly not verified LIVE facts. The test proves behaviour of that model,
not runtime equivalence. It demonstrates:

- disabled metadata processing does not reject the group save;
- a new-value conversion failure skips metadata but does not cancel the save;
- an old-value conversion failure uses NULL and continues;
- a later metadata-store failure is outside both handlers and aborts the statement,
  preserving the old group JSON and all earlier metadata changes;
- unchanged metadata updates deduplicate; first-participant and closed-round paths
  retain their chosen fixture behaviour;
- actual-source normal Money/Points and final Trip Finish Round payloads persist
  unchanged through the model; no extra payout/League computation is introduced.

## Smaller remaining gates

Do NOT repeat the database inspection or ask for another count-only reviewer pass.
Use existing saved table column/type/default/nullability and candidate function
metadata ONLY if a specific production mapping needs verification. Preserve the
actual metadata hook unchanged; it is not evidence of a secure lifecycle boundary.
No direct entry-closure enforcement or trustworthy organiser identity is supplied
by this trigger. Authorised callers' whole-state saves remain the incident boundary.

The practical implementation work is now the real-schema atomic entry/revision
validator, group-scoped credential issuance/revocation/recovery, explicit production
client save/finish/start/retry routing and complete result/operation validation.
Keep actual source League/Trip/payout/history calculations and existing metadata
hook semantics. Do not duplicate their awards in a guessed trigger replacement.
Any remaining custom binding/private type or external writer effects remain explicit
rather than silently inferred from the symbols. Native asset delivery remains unproven.

Rehearse faithful schema/permission/object rollback and multi-session races locally,
then seek separately approved TEST identity/parity/privilege/recovery/writer preflight.
Receipt/closure/revocation data must survive rollback. No CASCADE, old group-state
restore, vulnerable fallback, migration or deployment is authorised by this report.
Release: NO-GO; the broad trigger-exception blocker has been narrowed substantially,
not converted into a blanket production compatibility approval.
