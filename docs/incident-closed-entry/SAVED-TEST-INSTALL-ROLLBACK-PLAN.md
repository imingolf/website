# Saved TEST review and preserving installation/rollback plan

Status: OFFLINE REVIEW ONLY. Installation and activation remain NO-GO.
Target: `nyavvwrsrxqfyhiygkgw` only. No LIVE connection or change is in scope.

The owner reported a successful single read-only TEST capture using collector
8eda5d8. The private catalog remains on the Mac. The authorised PIN compatibility
review used saved evidence without another database query.

The 26 October authenticated-writer candidate is included in the saved review's
source hashes. It must be bound to the saved TEST `iig_private` account/membership
schema and the five CREATE OR REPLACE writer signatures before installation. Their
actual additions/replacements are determined by exact saved signatures, not SQL keywords. Its source
checks are documented in [controlled readiness](CONTROLLED-TEST-READINESS.md).
The new `iig_operate_owned_group`, `iig_read_entry_group` and
`iig_prepare_owned_entry` signatures are name-collision gates. The reused account
clients and config are included in the source hash set. No account-to-group
ownership linking is inferred from email or shared PIN. See the controlled
readiness document for the sole-organiser deletion and notification cutover gaps.
Do not infer approval, current baseline parity or client compatibility from the
offline tests. The original package, resolver, evidence and the unrelated PR6
rollback-preparation directory stay untouched.

## Run the saved-evidence review

`tools/closed-entry-test-preflight/review-saved.py --package <existing-package>`
validates the saved package, original input and collector hashes, strict TEST
service/CA, recorded attempt, saved identity/TLS/read-only fields and recomputed
baseline/report consistency. It reads the backup to verify its already recorded
hash; it does not run pg_restore, psql, git, a shell, a DNS probe or any subprocess.
The consumed package is never passed back to the connection runner.

The collector's three hash-bound files remain unchanged. Pulling this additive
review tool does not invalidate the successful package. The tool creates a new
private folder outside the source package and repository, containing:

- `baseline.PRIVATE.json`: exact file and catalog-section hashes, original evidence
  pointers, protected whole-row fingerprints, candidate/source hashes and blockers.
- `INSTALL-ROLLBACK-PLAN.PRIVATE.md`: this plan bound to that baseline's SHA-256.
- `review.SANITISED.json`: fixed categories, booleans and counts safe to share.

Only the sanitised summary is printed. Raw definitions, PIN predicates, ownership,
ACL strings, application data and original evidence paths stay private. The new
plan is not SQL, and no executable installer or rollback is produced or approved.
Any existing package, input, attempt marker, certificate or service is left intact.
Missing or inconsistent evidence stops; it is never repaired or replaced.

The tool optionally reuses the newest saved `pin-binding-review-<timestamp>` folder
under the existing Mac-local `Documents/ImInGolf-LIVE-Inspection` directory. That is
a historical folder name, not a connection to LIVE. An explicit existing location
can be supplied with `--pin-binding-folder`. It checks the previous derivation's
manifest/resolver hashes and compares the source-definition hash with the saved
TEST getter. It does not repeat derivation, copy the private SQL or accept invalid
newest evidence by falling back to an older folder. Missing/mismatched bindings
remain blockers. A hash match establishes saved source parity only; it does not
prove predicate uniqueness, search-path/overload resolution or authority semantics.

## What a successful review establishes

PASS means local evidence is internally consistent and a review plan was prepared.
It does not mean installation readiness, present-day online parity, approved writer
control, backup restoration, complete DDL authority or complete hook compatibility.
The collection did not seal its output hashes at collection time. This review
records hashes now; retain the owner's provenance confirmation and originals. The
new hashes cannot retrospectively prove that saved outputs were never modified.
The old backup's historical checksum and full recovery proof remain unavailable.

## Pre-installation evidence and blockers

1. **PIN compatibility: COMPATIBLE — supported by evidence.** The saved TEST getter
   and existing resolver use the same PIN comparison, canonical table and first-match
   ordering; the resolver returns the selected row's canonical ID. TEST ownership
   checks restrict access without selecting another group. Search-path differences
   do not alter relevant bindings; group selection calls no custom helper.
   Evidence: saved TEST getter, manifest-bound original LIVE getter, existing private
   resolver and relevant saved dependency metadata. Originals remain unchanged and
   private. Do not repeat this investigation. Separate save-path/security review
   remains required. Installation and guarded activation remain NO-GO.
2. Review actual BEFORE/AFTER trigger definitions, enabled state and ordering,
   exception scopes, conflict handling, recursive/indirect calls and external effects.
   Include constraints, defaults, indexes, policies, event triggers and extensions.
   Catalog dependency entries do not prove a complete dynamic PL/pgSQL call graph.
   Record any genuine missing dependency precisely before considering more collection.
3. Build the exact installer and separate retaining rollback from the matched
   candidate and target catalog, then rehearse both against faithful isolated hooks,
   roles, ACLs, RLS, policies, types and data shapes. Existing fictional DDL rollback
   and source tests are useful evidence, not an operational target-specific rehearsal.
   Exercise failure after each stage, lost acknowledgement, concurrency, credential
   revocation/replay and malicious winner/ranking/tie/payout/Trip payloads.
4. Verify backup/recovery coverage for every affected application/security object.
   A listed archive is not a restore. Retain the original capture and PR6 rollback,
   but do not execute that old rollback for this incident. Separately review complete
   role/grantor/default-ACL/membership/sequence and managed Auth/service recovery gaps.
   No full-backup restore is authorised by this plan.
5. Inventory and control ALL TEST writers and existing groups: old websites/URLs,
   browsers/iPhones, owner dashboard, Auth-related writers, Edge Functions, schedules,
   APIs and manual/CI tools. Empty saved sessions do not prove writer control. The
   guard affects all canonical group rows, not just a fictional pilot group; it blocks
   old unversioned state writes even while the browser flag is off. Resolve or hold
   unsupported owner whole-state/delete workflows without adding a guard bypass.
   **Hard NO-GO until every canonical group is covered:** a private, baseline-bound
   row inventory must identify each already-linked group and each unlinked group.
   For each unlinked group, record either an independently approved trusted
   account-to-group link (proof, exact account/group IDs and approving authority),
   or an explicitly approved writer hold (affected clients/jobs, responsible person,
   acknowledgement of unavailable writes, recovery action and review point).
   Email, shared PIN, an empty session list or a blanket "approved" note is not
   ownership or hold evidence. No owner/service/direct-write exemption is allowed.
   Missing rows, unsupported writers, unapproved holds or stale evidence abort the
   whole installation; do not install first and silently strand existing groups.
   The existing reviewer deliberately leaves this gate UNPROVEN: aggregate saved
   fingerprints cannot prove per-group coverage, and it is not an installer.
6. Prepare compatible TEST client cutover and a trusted fictional organiser/member
   verification, private credential delivery, expiry, rotation/revocation and recovery
   plan. Never derive authority from a shared group PIN, selected name or client flag.
   Do not issue tokens during offline review or put secrets in SQL/logs/group JSON.
7. Complete the saved member-writer contract comparison locally. The exact
   `iig_set_my_attendance(text,boolean,bigint)` and
   `iig_submit_my_score(text,integer,text,bigint)` bodies/helpers/ACLs are not
   available here. The candidate still contains the identified verified-account
   and Points-only/non-Trip restrictions. Do not install these replacements yet.
   Using the existing private catalog, record their actual identity/member/access,
   eligibility, payment, Trip/format, existing-score and revision rules, including
   indirect helpers and hooks. Translate only those rules into fictional differential
   cases locally; then remove only demonstrated extra restrictions at those endpoints.
   Do not relax the shared organiser/join authority helper or infer new authority.
   Include member projection privacy and notification compatibility in this same
   local adapter review. Share only sanitised findings/tests, never private definitions.

No new database connection is requested for this review. A saved snapshot cannot
guarantee that TEST will remain unchanged. A separately approved installation must
include the bounded baseline checks below inside its own controlled transaction;
this is a future installation requirement, not authority to reconnect now.

## Baseline-bound installation sequence — plan only

1. Approve the exact candidate, private resolver, installer and retaining rollback
   hashes together with the plan's evidence binding. Confirm independently that the
   target is TEST. Review and hold every affected writer; drain in-flight work.
2. In one bounded transaction with the reviewed lock order, establish TEST identity,
   strict verified TLS, role/version and sufficient exact DDL authority. Acquire the
   required object/data locks before checking catalog and row fingerprints. Any
   mismatch, timeout, privilege gap, unsupported type or object-name collision aborts.
   Do not silently refresh the baseline, normalise data or disable security to pass.
3. Assert the bound definitions, owners, raw and effective ACLs (preserving NULL
   versus explicit grants and grantors), function settings/search paths, role
   memberships, schema/default privileges, RLS/FORCE, policies, columns/defaults,
   indexes, constraints, triggers/order/enabled state and dependencies. Assert exact
   whole-row counts/fingerprints for every captured application table. This preserves
   existing groups, scores/results/history, payments/payouts and other JSON fields.
4. Apply the bound candidate files in order: `core.sql`, `validators.sql`, the
   existing matched private PIN binding, `boundary.sql`, then
   **`authenticated-writers.sql`**. All four candidate files are in
   `supabase/closed-entry-candidate/`. Inventory: one private schema, eight private
   RLS tables, 41 distinct private helper signatures, 14 public signatures and one
   canonical BEFORE UPDATE/DELETE trigger. The private resolver binding replaces
   the candidate resolver stub; authenticated-writers replaces the candidate-local
   `require_legacy_group` stub. These are not replacements of installed TEST writers.
   The 14 exact public signatures and saved function metadata hashes are recorded
   in `baseline.PRIVATE.json`. Nine use CREATE (six entry RPCs plus operate/read/
   prepare owned entry); five use CREATE OR REPLACE (save, join, attendance, score,
   player action). If all five exact signatures exist, this is nine additions and
   five replacements; if one is absent it is ten additions and four replacements,
   requiring explicit local review. Same-name overloads are not matching signatures.
   Do not approve an unexpected addition or collision automatically.
   Leave existing AFTER hooks and their ownership/settings unchanged. No Auth trigger,
   extension, new public table, broad grant or default-privilege change is included.
5. Apply and verify explicit reviewed ownership and least-privilege ACLs, including
   effective inherited/default access. API roles must not access private metadata or
   provisioning helpers; new public RPC access must be exactly the reviewed allowlist.
   Bind each replaced function's definition, return/argument contract, owner, raw
   ACL/grantors, effective permissions and settings to the approved before/after
   inventory. CREATE OR REPLACE is not proof that grants or search paths are safe.
   Preserve existing access restrictions, RLS/policies and metadata-only owner behaviour.
6. Before commit, compare all original data fingerprints and original security
   metadata with the bound baseline, allowing only explicitly inventoried additions
   and the exact approved replacement definitions/security metadata. All unrelated
   functions, hooks, owners, grants and policies must remain byte-for-byte equivalent
   under the catalog comparison. No existing group data is rewritten/backfilled or restored from an old
   snapshot. Any failure rolls back this complete transaction; do not retry blindly.
7. Record the exact committed object/security inventory and baseline-bound receipt.
   A missing commit acknowledgement is an ambiguous outcome: retain writer holds and
   evidence for separately reviewed status verification; never rerun the installer.
   Keep writers held until the separately approved compatible client/credential and
   real-role checks pass. Installation does not itself authorise guarded activation.

## Rollback and recovery — preserve newer state

**Failure before commit:** roll back the installation transaction. Rehearse that no
candidate objects survive and the original rows, results, payments, owners, grants,
RLS/policies, triggers and definitions match the original baseline exactly. Do not
run a data-restoring backup as a substitute for transactional DDL rollback.
Inject failure after each of the four SQL files and private binding, including
after writer replacements/ACL statements. Verify all replaced definitions and
their exact security metadata restore as well as the new objects disappearing.

**After commit, or after any runtime activity:** hold writers and use the reviewed
fail-closed write-suspension/forward-repair path. Retain the canonical current rows
and all populated private rounds/closure/revisions, credentials and revocations,
member credentials, permits, receipts, archives, operation audits and identity
reservations. An unexpected permit is evidence to investigate, not permission to
delete it. Preserve read access only where the verified boundary permits it.

Restrict/retire only the explicitly inventoried new write surface as reviewed;
preserve its exact pre-suspension security metadata for subsequent repair. Existing
owner/service/direct writers must remain controlled. Keep the central guard blocking
unsafe old writes. Rolling back the website alone does not make old writes safe.
Restoring an old authenticated writer is not a safe runtime rollback unless it
has separately passed the same boundary, authority, revision and hook checks;
otherwise retain the writer hold. Keep both owner and guard revisions and each
frozen entrant set, including unpaid corrections and post-install scores.
Do not replay obsolete group JSON, reset payment flags, rewrite historical results,
drop populated private tables, use CASCADE or remove the guard to restore service.

An object teardown requires separate proof of no committed runtime activity plus
exact current data/security equivalence, controlled writers and reviewed dependency-
safe reversal. That teardown is NOT generated or authorised here. Full restoration
is a separate disaster-recovery decision with explicit data-loss/reconciliation
review. Prefer retention and forward repair whenever the no-activity proof is absent.

## Activation gates after an approved installation

Test actual TEST REST/RPC roles and effective permissions, compatible browser/iPhone
lifecycle, refresh/payment-return/reconnect, real credential delivery/recovery and
released native asset/cache behaviour. Keep all existing groups covered by the writer
plan. Approve the precise TEST origin/build and activation separately. Neither a
collection PASS nor this offline review PASS enables the guard or publishes a build.
