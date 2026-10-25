# Focused saved AFTER UPDATE exception/CASE review

The previous exception_or_statement_case result meant parser support was missing,
not that LIVE trigger semantics were unsafe or proven safe. Do not repeat the LIVE
inspection, INSERT-trigger review or earlier catalog counts. Work from existing files.

## Supported offline analysis

`semantic_saved.py --after-update-only` retains the original scope/hash/privacy
checks and returns only noninternal AFTER UPDATE triggers. A trigger supporting
multiple events remains included if it has UPDATE. No SQL is executed or connected.

Supported BEGIN blocks now have numbered scopes, parent scope, protected event
numbers and ordered WHEN handlers. Each event retains block and handler context.
WHEN condition-name/SQLSTATE alternatives separated by OR are retained symbolically.
Only fixed flags identify OTHERS, unique_violation/23505 and foreign_key_violation/
23503; arbitrary SQLSTATE values/names remain anonymous. A name/flag is not proof
that a particular statement raises that condition. OTHERS is NOT every possible
error: query_canceled and assert_failure are excluded unless explicitly handled.

When an error matches a handler, database changes in that protected block are rolled
back before the handler runs. PL/pgSQL local variables retain their values. Handler
writes are new effects: they are not rewound merely because that handler was entered.
An error raised in a handler cannot be caught again by the same block's handlers;
an enclosing handler may catch it and unwind the enclosing block. Metadata marks
these scope relationships, not a symbolic execution or commit guarantee.

Simple CASE retains the selector, ordered WHEN expressions (including comma lists),
earlier nonmatching alternatives and ELSE. Searched CASE retains boolean conditions
and ordering. SQL null/equality/cast/operator semantics remain private-review gates.
Statement CASE without ELSE raises CASE_NOT_FOUND when no WHEN matches; the output
includes this implicit control-transfer event and its enclosing scopes. SQL CASE
expressions inside assignments/queries remain expressions, not statement CASE arms.

RETURNS/RAISES, helpers and exception paths can bypass later writes. The tool does not
infer swallowing merely from an OTHERS handler or absence of RAISE. All runtime
reachability, error preservation and conflict-arbiter verification flags remain false.
Only STRUCTURAL_PATHS_EXTRACTED_NOT_SEMANTIC_PROOF is returned for supported code.

Dynamic SQL, GET [STACKED] DIAGNOSTICS, labelled blocks/loops, nested DECLARE sections,
unsupported SQL/PLpgSQL forms and malformed grammar stay unresolved. Event/expression,
block/handler/CASE-arm limits stop rather than truncate. Unsupported output includes
a fixed reason plus anonymous token/event/scope location where available, not SQL.
No partial supported-path claim is emitted for that trigger.

## Bounded private checklist if anything remains unresolved

Use the exact saved UPDATE function body, existing saved target definitions and this
anonymous scope map locally. Do not paste the body, literals, credentials or records.
For each exception-bearing scope, record only anonymous event/target numbers and:

1. Which history/payment/League/Trip/payout writes are in its protected section?
   Which occurred outside that protected scope and survive its rollback (still
   uncommitted until transaction commit), and which are merely local variable values? Do not equate local assignments with persisted effects.
2. What exact error conditions enter each handler? Check original SQLSTATE values
   privately; identify unique/FK/CASE_NOT_FOUND, OTHERS exclusions and ordering.
3. Does the handler return NEW/OLD/NULL, rethrow, raise a replacement error, or continue?
   AFTER-row trigger return values do not rewrite/cancel the underlying row update.
   Check helper failures too. A successful group UPDATE can coexist with rolled-back
   history/payment writes if the exception is caught and normal execution resumes.
4. Which handler writes persist on success, and which are unwound by an outer handler?
   Check nested block scope, row/statement atomicity and local values surviving rollback.
5. For every CASE, check selector/expression types, first matching arm, null treatment,
   ELSE/no-match behaviour and which scope catches CASE_NOT_FOUND.
6. Map each accepted write's columns/values to saved constraints/indexes/defaults/FKs,
   ON CONFLICT target/action and filter. A matching constraint is only a candidate.
   Establish one-write/deduplication semantics and what happens after a retry/error.

Share conclusions as anonymous event/target numbers and supported/unknown flags only.
If the construct cannot be assessed, retain that specific blocker; no new catalog
inspection or attempted function execution is authorised to make it pass.

## Faithful integration and release gates

The new fictional tests demonstrate protected-write rollback, surviving locals,
handler-write persistence/outer rollback, simple/searched CASE null/no-ELSE behaviour
and a successful AFTER UPDATE despite a caught history-write failure. They are NOT
an execution or reproduction of the saved LIVE body.

To build a faithful fixture we still need the private review's actual event/WHEN
conditions, write/column mappings, conflict/index/default/FK contracts, helper effects
and exception outcome per lifecycle operation. Then preserve that contract with the
central entry guard and protected Finish Round/start operations. In particular, a
validator rejection must not be swallowed by a legacy trigger's handler. Rehearse
legacy exceptions and guard errors together under the same transaction boundaries.

Production organiser credential issuance/recovery, real client routing, remaining
operation validators and exact rollback/recovery rehearsal also remain unfinished.
TEST identity/schema parity, privileges and writer controls require separate later
approval. This stage does not supply installation SQL. Installation/release: NO-GO.
