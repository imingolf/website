# Closed-entry compatibility follow-up after 6e2e467

**Offline candidate only. NOT installable; guarded mode remains disabled.**
No online database, existing group, hosted application or demonstration changed.

## Bounded compatibility corrections from 05018589

The member read now reconstructs gameplay fields from the locked canonical state
using explicit recursive allowlists, after both existing getter/access checks.
The owner getter is unchanged. Member output includes payment status/link, League,
Trip/team scores and history; unknown security/profile fields and normal-round
backups are omitted. Winner payout links are visible only to their named winner;
Side Game bets/settlements and opponent scores are participant/date filtered.
The player client refuses incomplete stake/open/history data rather than treating
a missing stake as free. No existing getter, authority helper, RLS or grant is widened.

Organiser unpaid corrections accept exactly `paid=false`, `paymentMarkedAt=null`,
`paymentMarkMethod=null`, matching the existing client. The prior audited correction
form remains valid. Member declarations still require true and player metadata;
paid=true still requires its proper metadata. Frozen entrant IDs, unpaid scoring
refusal, stale revisions, atomic hooks and the closure latch are unchanged.

**Member correction from edeaca74, based on the completed private Mac review.**
The owner reported SPECIFIC CORRECTION REQUIRED: organiser-registration restrictions
had been applied to member authority, Money/Trip rounds were excluded, and owner
whole-state validation rejected server-built field updates because of unrelated
saved data. These findings are now addressed in the offline candidate. Do not
repeat the completed diagnosis or PIN work; the private definitions remain on the Mac.

Member locks require an authenticated account, its current player mapping/roster,
group-access permission and the expected owner revision. They no longer add email
verification, non-anonymous or non-banned registration requirements to that mapping.
Actual Auth session validation is still required; fictional tests do not prove real
JWT issuance/revocation. Pending account deletion remains revoked, and the existing
verified organiser/join helper, ownership checks, getters and grants are unchanged.

Attendance and individual score RPCs now support Money and individual Trip rounds.
The current dispatcher reuses these RPCs rather than a conflicting field contract.
Paid Money scoring requires a declaration; free Money scoring does not. Points
attendance and organiser-selected Trip eligibility still govern entry. A member's
attendance flag cannot change payment, the Trip roster or a frozen entrant set.
Pair rounds continue through the existing team score action, not individual scores.

Private `member_attendance`/`member_score` permits validate only the exact member
field changes, retaining every unrelated state/player field. The same check runs
at the central row boundary; no client can request these operations or supply a
state replacement. Existing malformed unrelated flags, absent/non-array history,
owner metadata or an already oversized row do not block a bounded field update.
Owner whole-state restrictions are unchanged. Individual Net No Return uses the
same score boundary. First score freezes eligibility atomically, including free
rounds; attendance remains closed after score resets. Both revisions, canonical
notification hooks, stale-write rejection and rollback postconditions are retained.

The saved reviewer now records all 14 public identity signatures, actual additions/
replacements against the saved catalog, and hashes of replacement metadata. It
requires explicit all-group ownership/writer-hold coverage and a baseline-bound
rehearsal of the corrected member writers.
Both remain hard NO-GO gates; an empty session list or claimed approval cannot clear
them. The corrected installation/retaining rollback sequence includes all four
SQL files and exact allowed replacement metadata. No installer or linking bypass
has been invented. See [the existing plan](SAVED-TEST-INSTALL-ROLLBACK-PLAN.md).

Before installation: apply the completed local contract review to the target-bound
offline rehearsal, approved coverage
for every affected unlinked group, exact hooks/access/notification binding, and the
baseline-bound installation/retaining rollback and recovery rehearsal. The sole-
organiser account-deletion gap remains a LIVE release gate; it does not justify
changing these compatibility corrections or existing gameplay screens.

## Two-priority release integration — 26 October 2026

**Repository candidate only; installation/cutover remains NO-GO.** No flag,
registration setting, hosted function, notification hook, RLS policy or deployment
was activated. Work continues from pushed `ed50c35`, a descendant of `72adf30`.
The completed PIN compatibility review is not reopened.

The existing central row guard and authenticated writers are reused. Ordinary
whole-state saves cannot infer lifecycle intent. The organiser adapter now calls
`iig_operate_owned_group` with the explicit action, captures the observed revision,
rejects overlapping submissions, and reads back the committed state. Failed or
ambiguous responses require an explicit reload; no write is automatically retried.
A new round's server-generated ID is never guessed from the submitted snapshot.
Late declarations and Admin corrections cannot add a frozen entrant. Unpaid
players cannot score; free competitions require no payment. Score reset retains
the closure latch. Existing account/membership/access checks and canonical update
hooks remain in place, including rollback of revisions and notifications on error.

Two small read RPCs complete the adapter: `iig_read_entry_group(text default null)`
retains the installed owner projection and both getters' access checks, verifies
the same account revision under lock, and adds closure/entrant metadata. Member
gameplay projection is restored by the bounded allowlist described above. It performs no initialization
or data writes. `iig_prepare_owned_entry(text,text,bigint,integer default null)`
reuses the existing server-derived maintenance proposals; the following write must
still match the observed revision. Both require authenticated authority and deny
PUBLIC/anon/service_role. The candidate adds three public RPCs in total, including
`iig_operate_owned_group`, declares five CREATE OR REPLACE writers, and adds no
further tables. Actual additions/replacements must match the saved exact-signature
inventory. All three new names must be checked for baseline collisions.

The welcome screen, email-code registration, first-competition form, account
controls and protected player/organiser adapters are reused selectively from
`38f81215331224079aa7c19ba6e5de0dbc4bcb2e`. No branch merge or gameplay redesign.
Start a golf group is first and green; Join my golf group is white. Guided first
setup resets only competition fields, including for players who joined before
setup; identity and historical totals remain. Existing gameplay calculation,
League, Trip and result code is retained. Late config.js overrides now preserve
explicit operation names too.

Account modules are inert unless a separately prepared build provides
`IIG_ACCOUNT_BUILD`, validated against the exact TEST project, configured URL and
HTTPS origin. It cannot be combined with the legacy capability build. Missing or
invalid account configuration blocks connection rather than using LIVE/legacy
fallback. No such build configuration is committed. Original legacy deployment
configuration remains unchanged. Auth tokens stay in memory. Registration uses
verified account identity and the existing idempotent creation endpoint; neither
an email address nor a shared PIN claims an existing group.

### Essential remaining gates

1. **Saved TEST baseline and notification/access compatibility.** On the Mac,
   bind the existing registration/getter/access/deletion definitions, writer
   replacements, exact hooks/dependencies, owners, grants and RLS to the saved
   catalog. Preserve all canonical rows and security metadata. The reused TEST
   player adapter does not enable unverified legacy push-registration RPCs;
   account-bound notification setup/native delivery remains a specific cutover
   gate, not a reason to change hooks or silently claim notification parity.
2. **Trusted ownership and writer cutover.** Existing verified TEST mappings and
   new-group creation can be reused. No trusted mechanism for linking existing
   unowned LIVE groups was supplied here. That remains a blocker. Installing the
   row boundary rejects unversioned legacy writes, including older clients; a
   compatible-client/update plan is essential. No bypass fallback is acceptable.
3. **Baseline-bound installer and retaining rollback.** Rehearse installation,
   drift refusal, backup restoration/security recovery and rollback against the
   saved private TEST baseline. Preserve closure/entrant metadata, existing groups,
   results, payments, League/Trip history, policies, grants and notification state.
   Prove real independent-session score/payment/finish/start races before cutover.
4. **Release journey checks.** The reused account-deletion handler and SQL tests
   verify authenticated deletion of a non-owner and preservation of golf history.
   SQL explicitly refuses deletion while an account owns a group. A sole/new
   organiser with nobody to transfer to has no complete deletion route: a genuine
   release blocker, not fixed by deleting a group or weakening ownership checks.
   Actual OTP delivery, mobile rendering, native-wrapper/App Store packaging,
   notifications and end-to-end deletion still require controlled validation.
   Native-wrapper source is not in this repository.

### Offline evidence and limits

- Full 17-script incident suite PASS, including 394 authenticated-writer
  checks and modelled race orderings (not independent sessions). The bounded
  follow-up covers private projection filtering, exact unpaid metadata and rollback
  after every candidate file/private-binding stage, including all five fictional
  writer replacements and their original definitions/ACLs/settings. Member tests
  include account variants, paid/free Money and Trip rounds, attendance/score race
  orderings, score boundaries, denied/revoked membership, private field tampering,
  unchanged legacy metadata, duplicate identities, stale requests and hook failures.
  Direct fictional permit probes also verify the row trigger independently rejects
  protected-field changes, invalid scores and non-frozen late scorers.
- `node tests/authenticated-release.cjs`: 91 checks PASS; actual reused client code with mocked
  DOM/HTTP, explicit actions, conflict/ambiguous ACK handling, session invalidation,
  closure readback, guided setup and email-code/idempotent creation.
- Existing 15 closed-entry and 10 sync regression scenarios.
- 132 preflight and 153 inspection Python tests. The existing saved reviewer now
  hashes the reused client files/config, checks all new RPC name collisions and
  distinguishes exact baseline additions/replacements from overloads/unknown signatures.
  Collector/hash-bound connection runner files and private evidence are untouched.
- Existing registration source `38f8121`: 51 protected gameplay/account-lifecycle
  assertions, 79 access assertions, creation/hardening/setup-bundle suites and
  the deletion-handler suite passed in fictional local databases with mocked
  Auth. The reference access/setup fixtures required adding the standard
  `service_role` to their scratch role setup; their assertions were unchanged. These establish reused-source behavior, not hosted parity.

No Docker/PostgreSQL server is installed for the independent-session runner.
No browser executable or linkedom is installed for the existing rendered/DOM
suites. Automatic approval review rejected downloading linkedom under the
offline-only restriction; no substitute network download was attempted. The VM
client checks are not rendered-browser tests. No private Mac baseline, real JWT,
email, APNs/Web Push, hosted hooks or online SQL was accessed or tested.

**Next task:** use the existing saved Mac evidence to finish the baseline-bound
installation/rollback and compatible-client cutover review. Do not recollect PIN
or database evidence just to repeat completed checks. Do not install or activate
until the listed gates and separate controlled TEST approval are complete.

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

The legacy files alone contain eight private RLS tables and six public RPCs. The
full candidate, including authenticated-writers, has **eight private RLS tables,
42 private helper signatures and 14 public signatures** (nine declared new, five
classified against the saved catalog), one private schema and one canonical trigger. No new
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
