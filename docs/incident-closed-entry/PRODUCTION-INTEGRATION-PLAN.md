# Smallest practical production integration plan — offline review only

Uses owner-supplied saved LIVE findings and tested prototype 56c39e1. No new
connection, SQL execution, online change or private evidence access occurred.
Group 1010 has completed its round; preserve that result and all other groups.

## 1. Authority decision

The existing owner_* functions appear to validate a creation code against
current_setting. In repository source that code opens a dashboard listing groups
and permits group deletion, suspension and Admin PIN reset. This is platform-owner
maintenance authority, NOT demonstrated per-group organiser authority.

Do not distribute that code to golfers or use it as an app-wide fallback for Finish
Round. Public EXECUTE alone is not an authentication failure: a properly enforced
server credential can protect an RPC. Conversely, current_setting alone is not a
secret vault or authorisation proof. Exact saved code must establish:

- Invalid, empty and NULL input/configuration fail closed. IF input <> setting THEN
  reject may allow NULL to skip the rejection; missing_ok and exception paths matter.
- No caller can replace the value through startup/custom GUC settings, a set_config
  helper, dynamic SQL or other exposed operation. Review actual role/connection scope.
- The credential is not returned by a public getter/listing and is not stored in
  shared group JSON. Do not read/share the credential to answer these questions.
- Caller scope, overloads, dependencies, search_path and effective grants are sound.

If proven, this may be reused for a narrowly scoped platform-owner bootstrap/repair
operation. It still must not stand in for individual organiser identity. None of
owner_list_groups/update/delete/reset is approved as a round-transition gate on the
current evidence. A new protected per-group transition mechanism is the default
plan; reuse an existing scoped mechanism only if exact review establishes one.

A missing direct auth.uid call is not conclusive if checks are delegated. No finish/
start names in the inspected list is not proof none exist. Avoid both assumptions.

## 2. Minimal protected boundary

Retain the real state/history format and existing calculations. Do not install the
prototype schema or registration beta migrations into LIVE as a shortcut.

A. Central guard: put validation on the actual group-row update boundary, covering
legacy saves, owner helpers and normal service-role writes. Capture current trigger
order and effects first. Lock the group row, derive committed round/revision, reject
stale snapshots, and retain server-controlled closure/entry metadata. First score
captures PRE-transition entrants. Admin requests do not bypass closure. Membership
can expand without granting active entry. Payment metadata/stake/eligibility cannot
alter a closed pot. Score corrections cannot clear the latch.

B. Ordinary save: keep only compatible non-lifecycle behaviour. Preserve history,
existing scores and unrelated fields on legitimate updates. Expected server round/
revision must be trustworthy; legacy unversioned snapshots cannot be blindly assigned
the latest revision. Version the client contract if needed. An unused new RPC alone
does not protect the old unrestricted one. Do not allow legacy resets as an exemption.

C. Organiser finish/start/Trip advance: a narrow authenticated transition RPC locks
the same row, checks group scope, phase and expected revision, then performs one
bounded transaction. It archives the exact eligible entry/payment snapshot, preserves
all prior history, applies the existing verified awards once and issues the next
server round identity. Retries return an established receipt or a conflict without
reapplying awards. Delayed old-round requests never enter the fresh round.

D. Authority: use existing verified per-group Supabase Auth ownership if established.
If absent, a minimal group-bound, high-entropy lifecycle capability is an alternative
requiring separate design review: private hash-only storage, limited permissions,
expiry/revocation, no raw secret in state/getters/logs/URLs, TLS body transport,
approved organiser issuance and secure device handling. Bootstrap by a proven
operator mechanism or separately approved operator process after identity checking;
never infer ownership from knowing the shareable group PIN or exposed Admin PIN.
No capability is issued, stored or implemented by this plan. The prototype database
role registry remains a lab tool, not production Supabase user identity.

E. Trigger trust: do not use a caller-supplied JSON flag, custom GUC, p_is_admin,
application_name, backend role alone or changed roundId to identify a protected
transition. Use an internal server-controlled intent/metadata path writable only by
reviewed transition functions; bind any one-use intent to group/round/revision and
transaction and consume it atomically. Review function-owner privileges and every
writer so ordinary SECURITY DEFINER save cannot fabricate this intent. PostgreSQL
superusers/object owners remain an operational trust boundary, not something a
trigger can prevent from deliberately disabling protection.

## 3. Existing trigger and history dependency gate

The substantial trigger must be understood before changing write ordering or
lifecycle behaviour. It may calculate, normalise, archive, notify or invoke helpers.
Do not replace it with the prototype archive or run two award/history processors.
Build a source map from save -> relevant row triggers (BEFORE/AFTER and name/order)
-> helpers -> affected tables/functions. Identify input/output fields and rejection/
exception behaviour. Trace dynamic SQL separately. Keep helpers' private names and
bodies on the Mac; source can be reviewed locally without sharing credentials.

An unresolved call is not automatically a security helper: a built-in such as now()
can appear unresolved in the deliberately small redaction allowlist. Classify each
from the saved body, not its anonymous label. Conversely, a trigger referring to
history/payment is not proof its changes enforce entry closure or are harmless.

The saved capture may contain only the trigger body, not definitions of all called
helpers. First inventory what IS already saved locally. If a required definition is
absent, record that exact evidence gap. Do not invent it or reconnect automatically;
any further narrowly scoped catalog collection needs separate approval.

## 4. Next offline integration/regression tranche

Use a faithful fictional copy of the actual legacy table/functions/triggers, with
private literals replaced by test-only constants. This requires the precise saved
control-flow/dependency review above. Do not load real group data or credentials.

Compare old and guarded lifecycle results on identical fixtures:

- Normal Money/Points: existing three entrants, paid metadata, every final-score/NR
  format, tie/countback/prize splits, League/wins/net-winnings, finish/history shape.
- Trip: individual, Better Ball, Pairs Aggregate, playing/resting membership,
  partner score rights, daily payouts, advancing/completing/cancelling and summaries.
- Side Games, settlements, settings/profile edits and unpaid group joins remain
  independent while no ordinary write changes active-round entries/history.
- Entry/score in both commit orders; Admin/player payment returns; late entry bundled
  with first score; score correction/removal without reopening; old save after finish
  and new setup; untagged legacy requests, forged reset/history/ID; duplicate finish/
  start, failed/retried transactions and group lock isolation.
- New authority: wrong group, revoked/expired credential, replay, guessed PIN, forged
  isAdmin/custom GUC, owner maintenance without organiser rights, overload/direct
  UPDATE/service writers, and missing/null/overridden server configuration.
- Verify exact preexisting history/payment snapshots, exactly-once awards and trigger
  effects, no unrelated group changes and recovery after failed operations.

The current prototype already passed 39 embedded checks, seven real-session race
cases and six actual fixture-login permission checks. Those prove the listed lab
behaviour, NOT these real legacy integrations. Keep the tests separate in reports.

## 5. Information needed before an installable TEST migration

1. Exact saved creation-code guard semantics and scope (not its secret value).
2. Exact substantial trigger timing/order, side effects and helper definitions;
   classify the save function's one unresolved call. Identify any missing captures.
3. Chosen group-scoped organiser identity/issuance and legacy client update path.
4. Existing trigger/function/table owners, dependency and grants needed for exact
   migration and rollback; present initial capture is not a full recovery package.
5. A separately approved isolated TEST target/restore fixture whose existing baseline
   will not be overwritten, plus current recovery evidence and migration hashes.

No need to rerun a successful sanitiser or reconnect for information already saved.
The remaining action is precise local source/dependency review, not another blanket
capture. Do not ask for passwords, owner codes, raw state or unredacted function bodies.

## 6. Release boundary

After the evidence gate, implement the compatible adapter and a bounded additive
migration with exact captured-definition rollback and protected data guards. Test
locally, then obtain TEST installation approval. Archive current recovery evidence
including Group 1010's completed result. Removing enforcement reopens the original
bug; prefer forward repair or retain a compatible fail-closed boundary with controlled
writers. No CASCADE, data deletion or historic snapshot restoration over new scores.

A database-only change cannot simultaneously trust indistinguishable legacy Admin
whole-state saves and reject forged resets. If no real organiser identity exists,
a small organiser/client transition update is required. Do not promise transparent
old-client Finish Round without that evidence. Native dynamic loading/caching and
Apple update requirements remain unverified. No LIVE release is authorised here.
