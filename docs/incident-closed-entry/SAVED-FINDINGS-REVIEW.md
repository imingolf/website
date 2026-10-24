# Review of owner-supplied saved LIVE findings

Source: sanitised summary supplied by the owner, not a new connection. Project
kzzzputsqxdntfqpprnz identity passed. Group 1010 has finished normally; do not repair
or re-save it. No SQL executed, records read or settings changed in this review.

## Established evidence and its limits

Owner reports tens_in_groups RLS enabled, FORCE disabled, anon/authenticated no
direct table access, service_role direct access. save_group_state is postgres-owned
SECURITY DEFINER with anon/authenticated/service_role EXECUTE and a whole-state
assignment reference. No closure/auth.uid/admin-pin/explicit row-lock references
were detected in that function's lexical scan. These references are not an AST or
control-flow proof. Trigger definitions and delegated helpers can change the result.

RLS is not sufficient protection against a granted SECURITY DEFINER path whose owner
bypasses RLS. FORCE=false is not by itself a vulnerability; authorization must be
assessed at the actual function/trigger boundary. Service-role writers must also be
accounted for. An UPDATE automatically takes a row lock: absence of FOR UPDATE does
NOT prove no locking. The issue is whether checks/latch/snapshot replacement are
atomic against current committed state, and stale writes are rejected.

## Source control-flow review

The production web source uses save_group_state for payment entry, scores and
organiser round lifecycle. There is no distinct trusted operation flag conveyed
by save() to distinguish a player's whole-state save from Admin's whole-state save.

- Normal setup resets paid/score/NR flags, sets roundOpen=true and a client-generated
  roundId, then invokes save().
- Both Points and Money Finish Round construct a history (or Trip rounds) record,
  update relevant win/league/payout state, clear current paid/score/NR/competition
  flags, close the round, and save. Trip also increments the round or completes it.
- The normal Admin PIN check compares input to state.adminPin locally. The legacy
  repository get_group_state returns the entire state. Whether deployed reads redact
  this field or provide other trusted authority is not yet established.
- app/config.js overrides cancellation: it clears current setup/payment/score fields
  and saves via the same whole-state function, retaining previous history.
- Owner dashboard update/reset/create helpers provide alternate dependencies and
  can call save_group_state as a fallback. Their captured definitions matter.

Therefore: freezing every paid/score change while OLD has scores would also block
legitimate Finish Round. Exempting any JSON that declares roundOpen=false, changes
roundId or appends history would let callers fabricate the exemption. Comparing a
PIN already in shared JSON would not establish trusted organiser authority. Do not
ship either shortcut, or use owner code discovered in a function body as a new
browser credential.

## Smallest safe design to develop once authority is established

Keep the current group/state/history format and scoring calculations. Add one
central atomic transition boundary and server-controlled round metadata/latch.
Use a row guard covering all ordinary table writers or prove exclusive entry through
a single guarded writer. No broad registration/multi-group migration is needed.

Under the same group-row lock: validate expected server round/revision, preserve
committed history/entries/payment fields, admit entries only before closure, and
latch closure on the first eligible score using the PRE-score entrant snapshot.
Reject first-score-plus-new-entry bundles. Once latched, score correction never
reopens entry. Permit an unpaid member joining the group without active eligibility.
Older snapshots cannot replace a completed round or erase scores to reopen it.

Finish/start/Trip advance must have separate verified server authority. Reuse an
existing server-verified organiser mechanism ONLY if saved definitions establish
it is non-public and enforced. Otherwise a minimal secure organiser lifecycle
credential/endpoint and compatible client change is unavoidable. That is a distinct
small incident change, not permission to install registration PR migrations. Server
must archive exact eligible entries/payments and apply awards once, then issue a
fresh round identity; ordinary saves cannot impersonate this transition.

For existing completed groups, do not modify historical records or repopulate reset
paid flags. Define legacy identity/initialisation from committed state before testing;
never treat a missing latch/roundId as permission to accept arbitrary stale rounds.
Future installation is object/guard work, not a data repair of Group 1010.

## Specific remaining evidence from the ALREADY GENERATED summary

No sanitiser rerun or new connection is requested. Need only these existing generated
JSON entries, not raw function bodies/configuration/credentials:

1. group_trigger_indicators and group_policy_count.
2. get_group_state references_NOT_proof and execute flags.
3. owner_update_group, owner_reset_admin_pin and owner_list_groups entries (if present),
   including execute flags and references_NOT_proof.
4. Any listed finish_round/start_round/reset_group entries, or confirm absent.

If all authority is delegated to unknown helpers, the summary cannot prove their
control flow. Prepare an additional local-only safe analysis of the SAVED function
bodies after identifying that precise gap; no new database query by default. Do not
ask the owner to paste bodies with literals, owner codes, PINs or embedded secrets.
No automatic heuristic can certify authorisation merely from an auth.uid reference.

## Concrete next gate

Review the remaining existing summary entries, identify whether central triggers or
server-owned organiser checks exist, and choose the exact compatible transition
boundary. Then prepare a pure offline validator/fixtures and proposed migration/
rollback for review, without executing SQL. Required cases: three eligible entrants,
one scorer, fourth blocked; score=0/Net/NR/pairs; concurrent score/entry orderings;
late returns after finish and after next setup; forged reset/history; existing
entrant scoring/correction; legitimate Finish/new round/Trip lifecycle; unchanged
completed history/payment snapshots and exactly-once awards. Actual database tests
need separate local/TEST execution approval; LIVE release remains NO-GO.

A completed round removes the immediate active-round disruption concern, but other
groups and a possible new competition still require review. Later release needs a
current recovery capture including the completed result; do not overwrite newer
history using an older snapshot or reuse the old TEST rollback as LIVE recovery.
