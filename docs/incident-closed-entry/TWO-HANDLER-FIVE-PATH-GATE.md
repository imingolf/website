# Two-handler / five-path consistency gate

Offline only; no online SQL, connection, installation or deployment is authorised.
The actual private definitions are only on the owner's Mac. Their reported summaries
cannot establish runtime equivalence. Do not repeat the completed LIVE inspections.

## New tests and their exact scope

five-path-contract.sql is an INVENTED fixture model of the REPORTED pattern, not a
transcription of LIVE SQL. Its inner handler returns NEW; its outer handler executes
NULL and falls through to a later RETURN NEW. Five hypothetical paths model history,
old payment/player snapshots, League/player results, Trip progression and payouts.
These labels/numbers are fixture choices, NOT the identities of the five real INSERTs.
A real trigger's five paths could be mutually exclusive branches into fewer tables.

The fixture requires only applicable effects: e.g. a Points round need not create a
Money payout row. This protects against an overly broad postcondition that would
break legitimate Finish Round/Trip variants. Domain applicability must be mapped
from actual predicates before any production assertion is designed.

For every path, tests inject a failure after the write in both handler modes. The
RETURN NEW mode can leave earlier writes pending; the fall-through outer handler
can roll back its whole protected section but still allow the group UPDATE to
succeed. Negative controls using the underlying fixture finish demonstrate those
inconsistent outcomes rather than assuming handler silence means success.

The outer protected wrapper checks expected result payloads after trigger execution,
outside the legacy exception scopes. Missing or different results raise and unwind
all group/metadata/history/award/receipt effects in the fixture transaction. Identical
preexisting results deduplicate; different conflicting payloads fail. Tests compare
whole inventories; no rows are deleted or reset to obtain a pass. Source-generated
Finish Round outputs cover Money, Points/Net, Trip progression/final and betterball.

The group-scoped actor can invoke only the outer boundary and authorised receipt
lookup, not the inner unchecked finish functions or tables. Client integration tests
verify that a swallowed legacy error plus failed postcondition yields no success,
no receipt and no automatic replay. Receipt-not-found does not authorise retry.
Existing atomic receipts/client lost-ACK tests remain required. These sequential
embedded PostgreSQL tests do NOT prove real concurrency or LIVE equivalence.

## Minimum private evidence still required

The two reported outcomes are references only. Handler 2 may fall through normally,
raise via a statement/helper, or never be reached. A lack of direct RETURN/RAISE
cannot establish error propagation. A candidate key cannot establish actual conflict
arbitration, null handling, collation/operator binding or equality of skipped payloads.

Before asking the owner for another program run, review the COMPLETE existing
sanitised AFTER UPDATE output, not just headline counts. It already contains the
anonymous branch predicates, declarations/dataflow, scoped event numbers, symbolic
writes/columns and constraint links. Ask only for that reviewer-generated JSON;
never the raw catalog, SQL, literals, credentials or records. No new connection is
necessary. If only stdout was retained, use the existing semantic_saved.py with
--after-update-only to reproduce it OFFLINE, without any connection flag.

Use that output to resolve the following and name only the still-unresolved facts:

1. Handler 1: exact guarded RETURN NEW paths and whether anything can raise first.
2. Handler 2: ordered statements, its matching conditions, its enclosing block and
   the first reachable statement after END. Determine normal fall-through versus
   propagation, including helper/cast/constraint errors. Do not infer this from counts.
3. For each of the five INSERT event numbers: applicability predicate, actual old/new
   round/result identity source, target, conflict key/action and statement filter.
   Decide whether conflict means identical intended result or possible stale data.
4. Link those writes to source-of-truth history, payment metadata, League/Trip/payout
   effects; identify any helper/external targets and exact rollback scope. If a hidden
   literal, operator or helper remains decisive, a private technical review of that
   particular expression is required; never mark it verified from an anonymous alias.

Do not edit evidence or fill a checklist with assumed approvals. A developer with
legitimate local access must inspect the specific remaining private expression if
sanitised output cannot establish it. This workspace cannot access the Mac files;
claiming completed private verification or faithful LIVE integration would be false.

## Smallest route to safe TEST installation

1. Finish the four evidence points above, using existing saved material only.
2. Replace invented mappings with verified real-schema contracts in fictional tests;
   complete all operation/result validators and actual organiser credential issuance,
   recovery and app/transport routing. Existing capabilities/receipts are prototypes.
3. Rehearse multi-session entry/finish/replay/revocation and exact object/data/permission
   rollback with current result preservation. Retain archives, receipts and revocations;
   no CASCADE, vulnerable fallback or old group-state restoration.
4. Seek separate approval for TEST identity/schema/privilege/recovery/writer preflight,
   then a reviewed guarded TEST migration. No installation SQL is authorised here.

Status: reported-pattern failure consistency and client authority boundaries tested;
private semantic verification and faithful production integration remain incomplete.
TEST/LIVE installation: NO-GO.

## Superseded assumptions after full report upload

The owner supplied the complete sanitised UPDATE JSON. Its two scopes are sibling
conversion handlers, and it shows four metadata INSERTs outside them. The five-path
fixture above remains adversarial, not an actual legacy contract. Do not continue
requesting that upload or impose its invented five-row result requirement. See
[the corrected assessment](UPLOADED-UPDATE-EVIDENCE-ASSESSMENT.md) for the concrete
handler/event/constraint findings and the narrower remaining integration gates.
