# Closed-entry compatibility follow-up after 6e2e467

**Offline candidate only. NOT installable; guarded mode remains disabled.**
No online database, existing group, hosted application or demonstration changed.

## Authenticated writer integration — 26 October 2026

The offline candidate now includes `authenticated-writers.sql`, loaded after the
existing three candidate files **only in fictional tests**. It reuses the narrow
TEST writers from registration commit `38f81215331224079aa7c19ba6e5de0dbc4bcb2e`,
without merging that branch or copying its UI. It retains the existing
`verified_organiser()` and `check_group_access()` helpers, membership/ownership
tables, getters and projections, RLS and notification hooks. This is repository
source integration, not proof those definitions match the saved TEST baseline.

- Joining still binds the verified account to its own generated player ID and
  requires the current invite. Attendance/scoring remain member-only. Group access,
  ban/deletion checks and owner revision conflicts remain enforced.
- Payment is the player's self-declaration. Unpaid Money players cannot score;
  zero-stake competitions need no payment. First score/NR/pair score freezes
  entrants atomically. New members can join the group without entering that round.
- An explicit `payment` organiser operation can correct a frozen entrant's status,
  but cannot admit a new entrant after closure. Score resets cannot reopen entries.
- Each writer supplies an exact transaction/revision/state-bound permit to the
  existing central guard. Canonical state, account revision, guard revision,
  membership, closure/audit and existing hook effects commit or fail together.
- `iig_save_owned_group` permits only ordinary validated saves.
  `iig_operate_owned_group` requires an explicit validated organiser operation;
  it never guesses lifecycle intent from a whole-state diff. The compatible
  authenticated TEST client's organiser controls still need this explicit routing
  before cutover. No client fallback or guarded activation was added.
- Shared-PIN candidate endpoints reject account-owned groups, including reads;
  golfers continue to use the existing private member projections. Without the
  authenticated adapter, the presence of the ownership schema fails closed.

This adds **one public RPC** and replaces **five existing authenticated writer
signatures**, with no new tables. The six legacy candidate RPCs and eight private
RLS tables remain. Saved-review plans now hash the adapter too. Replacement owners,
ACLs, default grants and dependencies must still match the private baseline; no
blanket Auth/schema/security changes are authorised.

Next task: on the Mac, bind these writer replacements and the explicit organiser
call sites to the existing saved TEST catalog, then incorporate them into the
already planned isolated installer/retaining-rollback rehearsal. Do not collect
PIN evidence again. Remaining essential gates are exact hooks/dependencies and
writer/client cutover, baseline-bound installer/rollback with independent-session
races, and proven backup/security recovery. Installation remains **NO-GO**.

Verification for this increment: 101 authenticated-writer checks PASS; full
17-script incident suite PASS; 15 closed-entry and 10 sync scenarios PASS;
130 preflight and 153 inspection Python tests PASS. Checks include unchanged
pre-existing rows/security helpers, identity denial, trust-based Money entry,
free rounds, Points/NR/pairs, explicit lifecycle/corrections, Side Game/payout
dispatch and rollback after failing or suppressed hooks. Existing supported-link
validation remains strict; the adapter converts valid links to the guard's provider
labels without broadening its allowlist.

Docker is unavailable in this environment, so the independent-session race/actual
login-role suite was not run for this increment. The saved private TEST baseline
and actual hooks are on the Mac; target-specific installation/rollback, real
PostgREST/JWT and physical-device validation were not performed. Earlier recorded
concurrency results below are historical, not a rerun of this adapter.

## Completed in this follow-up

- Trip return and cancellation are server-derived and version-bound. Current roster,
  profiles and unknown player fields survive; normal statistics and saved financial
  defaults restore by stable player ID. Cancel restores saved normal scores/payment
  flags, return archives the completed Trip. Neither revives removed people nor
  drops newly joined members. Missing essential legacy backup fields stop safely.
  Restored old rounds conservatively keep entries closed. Exact pre-change snapshots
  are audited atomically; downstream failures undo both operation and audit.
- Score/payment resets, last-result removal, League clear, past-Trip removal and
  open-round configuration route through scoped organiser operations. Payment reset
  cannot clear the closure latch. Existing source calculations and AFTER hooks remain.
- Legacy results without payout arrays can materialise the original source amounts,
  including JavaScript binary rounding. Historical IDs identify renamed winners;
  current names never grant authority. Missing historic IDs use the existing organiser
  private-payment/mark-paid path; they cannot grant an unverified player claim.
  Existing payout arrays and historical records are not automatically backfilled.
- First score freezes entrant IDs, including zero-stake rounds. Later group joining
  remains possible, without entering that competition. Late joiners see Entries Closed.
  Finish requires the frozen entrants' scores (or complete entered pairs). Retired IDs
  cannot be reused to inherit old payouts or credentials. Ordinary saves cannot forge
  profile, League or winnings fields, even before the first score.
- Joining/scoring adds no credential prompt. Organiser and member capabilities coexist
  in memory per group and clear on identity/logout/group changes. Payment-return retries
  acknowledge an already-confirmed payment without writing it again after closure.

Legacy candidate inventory is **eight private RLS tables and six public RPCs**. No new
public application tables, Auth-managed objects, extensions or broad Data API grants
are required. These files remain outside automatic migrations.

## Credential arrangements: honest boundary

The 64-hex credential prompt is an engineering TEST facility, **not production UX**.
Hashed, scoped, expiring/revocable credentials and compare-and-swap recovery exist;
independent identity verification, secure issuance/delivery and ordinary-user recovery
are not implemented. A group PIN, selected player name, client Admin flag or platform
creation code cannot issue organiser/member authority.

For legacy groups, production should reuse a verified account/session and bind its authority once to the
specific group/player through a trusted issuer; subsequent scoped capability access
should be automatic. Do not ask golfers to copy tokens or sign up before every score.
The actual issuer/account-to-group proof and recovery process need approval and TEST
verification. Existing simple group joining/scoring retains its legacy group-PIN/name
trust model. The new TEST adapter above uses existing account-bound player identity;
it does not migrate legacy groups or invent ownership from a PIN/name.

## Essential gates before controlled TEST installation

The completed saved-evidence PIN review is **COMPATIBLE — supported by evidence**:
the resolver identifies the same intended canonical group as TEST. See the
[recorded finding](SAVED-TEST-INSTALL-ROLLBACK-PLAN.md#pre-installation-evidence-and-blockers).
Do not repeat PIN investigation. Separate save-path/security, hook/dependency,
installer/retaining-rollback rehearsal and recovery gates remain unresolved.
Installation and guarded activation remain NO-GO.

1. **Approved TEST-only read-only preflight.** Verify exact current TEST identity,
   remaining source definitions, column types, grants/ownership, trigger dependencies,
   data fingerprints and backup/recovery evidence. The user's private resolver stays on
   the Mac. Its completed derivation is not repeated. No further LIVE inspection is
   presently identified as necessary; saved evidence cannot prove current TEST parity.
2. **Concrete baseline-bound installer and preserving rollback.** The existing review
   generator is not an installer. Generate and review atomic installation and rollback
   against the approved TEST capture; rehearse exact hooks, exception/conflict behaviour
   and post-install/rollback fingerprints locally. Preserve populated closure metadata,
   receipts, credential revocations, identity reservations and audits during recovery.
   Do not drop populated guard tables, overwrite newer state or use CASCADE. Source
   result/Trip coverage is not proof of all adversarial result/award payload validation;
   finish-result invariants and actual legacy hook compatibility remain review gates.
3. **Compatible TEST client, credential and writer plan.** Establish fictional TEST
   organiser/member identities through an explicitly trusted operator/issuer, inventory
   and control every writer, and coordinate the client cutover. Installing the guard
   blocks unversioned legacy state writes even while the browser flag is off. Metadata-
   only owner operations can remain; owner whole-state/global-delete controls are not
   exempted and are not fully routed. Resolve those required workflows before broad
   activation. Then test real TEST REST/RPC roles and iPhone lifecycle/reconnect flows.

The earlier Auth-trigger DROP authority blocker is not a dependency of this candidate:
no Auth trigger is added or removed. No pg_cron/pg_net, Supabase upgrade or SSL setting
change is proposed. No hosted/iPhone/Auth-delivery or online installation success is
claimed. Legacy backups missing essential fields and unusually large legacy payout
amounts (>=1e12) fail closed for review instead of guessing or deleting data.

## Offline verification

Run `npm test` in `incident-tests/closed-entry`, the existing inspection Python unittest
suite, and `test-concurrency.py` using its own pinned, network-none disposable PostgreSQL
17.6 container. Regression coverage includes actual app source operations, Trip variants,
zero-score/NR, nullable legacy flags, renamed winners, JavaScript rounding, stale payment
returns, lost acknowledgements, revoked credentials, downstream failures and rollback.
The independent-session races test both lock orders; they do not connect to Supabase.

Verified in this follow-up: full incident npm suite PASS (including 146 extended
operation checks, 61 maintenance checks and 62 canonical boundary checks); all 153
inspection Python tests PASS; 38 independent-session PostgreSQL races and six actual
local-login authority/permission checks PASS. Installation-error rollback is fictional
transactional DDL coverage, not a claim of a generated operational TEST rollback.

The next bounded preflight is now prepared in
[TEST read-only preparation](TEST-READONLY-PREFLIGHT.md). It remains offline by default;
no authenticated TEST connection has been performed or authorised by that preparation.
