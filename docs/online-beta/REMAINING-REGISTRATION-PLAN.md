# Remaining registration beta implementation plan

Development review only. No connection, SQL execution, installation, service change,
email, deployment or permission change is authorised. Target remains TEST
nyavvwrsrxqfyhiygkgw. Existing groups, player identities and historical snapshots
must remain intact. Supabase Free remains the default.

## Delivery order and gates

1. Resolve pooler TLS and managed rollback authority with existing support ticket
   SU-521759. Direct IPv6 currently has no route from the Mac; a trusted network
   with working IPv6 is an alternative, not a reason to buy an upgrade. Keep
   verify-full, hostname validation and backend TLS checks. No endpoint fallback.
2. After approval, run the guarded read-only TEST review. Any original baseline
   drift stops the original rollback path pending review; never rebaseline silently.
   Review default ACL drift after the October 30 change as well as application data.
3. Inventory TEST writers (web/mobile sessions, APIs, Auth, jobs and integrations).
   Agree a controlled pause/drain window; idle sessions do not prove quiescence.
   Establish recovery scope for Auth, ACLs, sequences and services. The original
   archive lacks a historical checksum; a new checksum is not historical proof.
   Approve a fresh backup separately if needed, keeping original evidence immutable.
4. Design features below, review additive migrations and grants, rehearse install
   and rollback against sanitised local data, then seek TEST installation approval.
   Do not combine unreviewed additions into the original four eadb495 files.
5. Separately approve TEST Auth/email configuration and real cross-account/iPhone
   testing, then approve a TEST-only hosted build. No LIVE release is implied.

## Multiple groups per organiser and player

Current owner uniqueness/single-group RPC is a limitation. Replace the owner_id
unique constraint only after catalog review; retain group identity and one-owner-
per-group guarantees. Add authenticated paginated group-list RPCs returning only
owned/joined groups, with explicit role per group. Membership uniqueness must be
per account/group, with idempotent joins. All read/write RPCs must independently
check membership/ownership for their explicit group; a selected PIN is not authority.
No direct browser table access or cross-group profile/email disclosure.

Migration: constraint/index and scoped RPC changes, explicit restricted grants,
fixed search_path and ownership review. Rollback: capture exact constraints,
functions, ACLs and policies; restoring one-group uniqueness becomes impossible
once an owner has multiple groups. Guard and STOP, retain all groups, use forward
repair or separately reviewed recovery; never delete groups to restore uniqueness.
Tests: two owned/two joined groups, owner/member mixed roles, concurrent creation,
forged group IDs, enumeration denial, pagination and preserved historical hashes.

## Secure persistent sign-in

Current tokens live in memory and reload requires a code. Decide session architecture
before coding: prefer a TEST-only same-origin backend with Secure HttpOnly SameSite
cookies, CSRF/origin checks and server-side Supabase refresh handling. This needs
hosting/backend review; it is not available in the static demo. If browser-managed
Supabase persistence is chosen instead, explicitly review XSS/token-storage risks,
CSP, refresh rotation, multi-tab races and device logout. Never store tokens in
URLs, logs or a generic app storage fallback. Use supported Supabase session APIs.

Migration: none necessarily for Auth sessions; a custom device/session registry
would require a separate private schema/grant design. Recovery: old clients must
reject incompatible cookies, clear sessions safely, retain accounts/data, and
support revocation; rollback must not resurrect revoked sessions. Tests: reload,
expiry, refresh race, offline/reconnect, revoked/banned/deleted account, sign-out,
shared-device isolation, no credentials in logs, CSRF and cross-origin rejection.
Physical iPhone Safari and standalone/background-resume tests required.

## Invitation expiry and revocation

Current shared token needs explicit lifecycle. Design private token records with
strong random opaque tokens stored as hashes, group binding, expiry and revoked
state. Owner-only issue/rotate/revoke; verified recipients redeem atomically with
idempotent membership creation. Do not consume a shared group invite after the
first recipient unless deliberately designing single-use invitations. PIN alone
must not bypass verification or expiry. Rate-limit lookup/redeem and use generic
errors; never leak an owner's email or token in telemetry/referrers.

Migration: private invitation table/indexes and narrow authenticated RPCs with
explicit grants, RLS/default deny. Existing invitations need an explicit transition
policy; no silent permanent compatibility bypass. Rollback: capture old definitions,
but do not reactivate expired/revoked legacy invitations. A guarded rollback may
have to STOP once lifecycle changes occur; preserve records and use forward repair.
Tests: expired/revoked/wrong-group/token guessing, concurrent redeem/revoke, repeated
join, email verification enforcement and owner-only management.

## Player profile reuse and group switching

Use auth.uid as account identity, not email or display name. A private own-profile
record can hold preferred name/current handicap; keep group-local player identity
and round/history handicap snapshots unchanged. Reuse is offered, not a bulk rewrite.
Group switching clears drafts and role state and cancels/ignores stale responses;
server authorisation remains per request. No profile discovery across other groups.

Migration: private profile table with own-user read/update RPCs, membership lookup
and necessary uniqueness constraints after checking existing mappings. No automatic
merging of ambiguous legacy players. Rollback: preserve exported profiles/new
memberships; stop destructive table removal when populated; original history is
never restored over legitimate new scores. Tests: same user in several groups,
name/email changes, legacy unmapped players, switch during save/refresh, draft
isolation, unauthorised profile access and account deletion/ownership transfer.

## Server-side bulk handicap validation

Close the owner bulk-save RPC gap without rewriting saved values. Compare players
by immutable identity; validate every new or changed handicap using the approved
whole-digit/one-decimal rule and existing range. Allow unchanged legacy values;
reject missing, nonnumeric and invalid changed values atomically. Do not round or
insert decimal points. Clarify plus-handicap representation before adding it;
current negative representation and historical values must remain compatible.

Migration: replace affected validation/RPC functions with ownership, revision and
identity checks retained; audit every alternate write path. Explicit grants must
not broaden access. Rollback: restore captured definitions/owner/ACLs only with
existing guards; security regression requires keeping beta writers paused. Tests:
112/120/227, repeated decimals, numeric JSON forms/exponents, boundary/negative
values, unchanged legacy entries, forged IDs, concurrent revisions, partial-invalid
bulk edits, no historical mutation. UI restrictions remain a second independent layer.

## Email verification and account security

Review actual TEST Auth settings and supported OTP length/expiry before promising
six-digit delivery. Keep UI and server settings aligned; resend cooldown is not a
server rate limit. Review approved TEST-only sender/SMTP, redirect allowlist,
site URL, abuse controls and Free-plan delivery limits before a small invited beta.
Do not assume default email delivery permits arbitrary novice testers at scale.
Use generic returning-account responses and handle duplicate signup, expired codes,
email changes and banned/deleted accounts. Verify JWT issuer/audience/expiry and
verified identity server-side; no client-trusted user ID or owner role.

Migration: any account-lifecycle RPC/trigger change requires exact Auth ownership
and managed DROP TRIGGER authority first; preserve existing original rollback.
Recovery: Auth/service configuration, email-change/deletion side effects and session
revocation are not fully reversed by public SQL. Define retained audit/recovery
coverage and a forward-repair route, never restore credentials or resurrect deleted
accounts blindly. Tests: wrong/replayed/expired code, resend throttling, returning
users, missing verification, JWT substitution, cross-group access, secure ownership
transfer, deletion retries and email-change confirmation. Mock offline first; real
mail delivery and end-to-end iPhone journeys require separate approval.

## Shared migration and release requirements

New public tables must have deliberately explicit least-privilege grants after
October 30; do not rely on platform defaults or broad anon/authenticated grants.
Prefer private storage behind narrow RPCs. Review service_role privileges separately
because it bypasses RLS. SECURITY DEFINER functions require safe search_path,
qualified objects, explicit EXECUTE revokes/grants and supported ownership.
Capture all replaced definitions, grants/grantors, policies, triggers, RLS flags,
sequences and dependencies. No CASCADE or deletion-based rollback. Expand the local
rehearsal and rollback guards for every new migration; original four-file rollback
is not coverage for this expanded plan. Validate unchanged data and security
fingerprints before/after, plus negative cross-account permission tests.

## Scoring wording and completed demonstration

Only scoring selection labels change to “Stableford — Final points total” and
“Net — Final net score”. Stored format values, calculations and workflow remain.
The TEST build hash manifest reviews these changed app bytes; source_commit still
identifies the original base, not an assertion that all bytes equal that commit.
The completed demo and its source manifest are untouched. Rebuild that approved
artifact only from its approved 6c5ce02 revision in a separate checkout; the demo's
source-drift guard intentionally refuses the changed app on this development head.
No demo deployment or redesign is part of this work.
