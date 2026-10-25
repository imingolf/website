# Closed-entry compatibility follow-up after 6e2e467

**Offline candidate only. NOT installable; guarded mode remains disabled.**
No online database, existing group, hosted application or demonstration changed.

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

Candidate inventory is now **eight private RLS tables and six public RPCs**. No new
public application tables, Auth-managed objects, extensions or broad Data API grants
are required. These files remain outside automatic migrations.

## Credential arrangements: honest boundary

The 64-hex credential prompt is an engineering TEST facility, **not production UX**.
Hashed, scoped, expiring/revocable credentials and compare-and-swap recovery exist;
independent identity verification, secure issuance/delivery and ordinary-user recovery
are not implemented. A group PIN, selected player name, client Admin flag or platform
creation code cannot issue organiser/member authority.

Production should reuse a verified account/session and bind its authority once to the
specific group/player through a trusted issuer; subsequent scoped capability access
should be automatic. Do not ask golfers to copy tokens or sign up before every score.
The actual issuer/account-to-group proof and recovery process need approval and TEST
verification. Existing simple group joining/scoring retains its legacy group-PIN/name
trust model; this work does not claim authenticated per-player score identity.

## Essential gates before controlled TEST installation

1. **Approved TEST-only read-only preflight.** Verify exact current TEST identity,
   source definitions/PIN predicate, column types, grants/ownership, trigger dependencies,
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
