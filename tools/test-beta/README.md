# Step 1 — isolated TEST-only beta build, not published

Branch: improve-new-user-registration. This is an offline build/transport change
only. It does not connect to Supabase, change permissions, execute SQL, create a
hosting site, merge branches or deploy. It is not approval for a functioning
online beta, database installation or production release.

## What is isolated

The beta output uses the actual approved screens from a5b1b6a, with nine pinned
application assets. It is a separate generated directory, never the repository or
the shared app directory. The local demonstration in tools/registration-demo is
unchanged and remains a separate, fully mocked local service. No demo bootstrap,
mock requests, fake group seed, example result injection or real source config.js
is included in the beta artifact. The old special demo-PIN behaviour is disabled
in the beta, so a legitimate TEST group numbered 2026 is not treated as a demo.

The development branch's shared app/config.js now has a frozen empty URL/key,
with the old production endpoint and encoded publishable key removed. Its UI
helpers remain intact. LIVE's deployed file and the production branch are not
changed. The isolated beta never loads even this blank shared configuration.

The builder removes the Supabase CDN client, legacy client construction, saved-PIN
autoconnect, unauthenticated group-state loading/activity writes and legacy
Admin-setup hand-off. Old PIN entry and ?pin= links are routed to verified TEST
player sign-in, not a legacy RPC. An invitation is still required for a new member.
Old remembered Admin/player identity cannot grant access. The old owner dashboard
program is removed; the email-verified private TEST register remains.

Legacy database calls fail through a denial stub. There is no SDK network client.
Remembered Admin PINs, owner creation codes and name-selection identity paths are
disabled. The only active data transport is the verified registration module's
narrow TEST API, shared with the protected organiser/player/account adapters.
Server-side authentication and permissions still require their separate review.

## Configuration is explicit; omission means disabled

The only database endpoint allowed is the exact HTTPS TEST project
nyavvwrsrxqfyhiygkgw. Build and runtime require all four explicit fields:
projectRef, supabaseUrl, publishableKey and betaOrigin. The publishable key must
match the SHA-256 of the previously reviewed TEST client key. It is a public
client key, not a password, service-role key or database connection string.
Rotation requires explicit revalidation; this build does not assume the key is
still active online. No environment variable, source config or baked-in key
supplies a fallback. The sample configuration intentionally has an empty key
and cannot enable access. Do not configure it or publish anything during Step 1.

The website origin must be an exact, separate HTTPS beta hostname. The production
custom domains, production Netlify site and its previews are rejected. At runtime
it must match the current origin, and a controlling service worker causes a hard
stop; use a fresh dedicated beta hosting site in a later approved step. This is
not a permissive hostname wildcard or a localhost bypass. Wrong/missing project,
key, origin, configuration script or security setup locks the interface before
loading the authenticated adapters. A second connect-src none policy is applied
on failure. No sign-in or database requests are sent by the locked page.

## Transport and browser defences

- Frozen validated config and a sealed fetch gateway accept only the exact TEST
  endpoint paths and HTTP methods used by the protected app. Unknown RPCs,
  get_group_state/save_group_state, other projects, arbitrary query parameters,
  wrong keys and production-issued JWTs are rejected before transport.
- Authenticated requests require an authenticated-role token whose issuer names
  TEST. This is a credential-confusion check, not signature verification:
  Supabase must still verify the JWT signature, expiry, account and RLS.
- Requests force redirect:error, credentials:omit, no-store and no-referrer. An
  API response cannot silently redirect a credential-bearing request to LIVE.
  Email-change redirects must return to the exact configured beta /app/ URL.
- Both HTTP security headers and an early document CSP restrict connect-src to
  the explicit TEST Auth/RPC paths, not merely the project host. This independently
  blocks LIVE and legacy TEST RPCs even if native fetch is recovered from another
  JavaScript realm. Workers, frames, manifests and form navigation are disabled;
  scripts/styles/images are local only (including necessary trusted inline app code).
- XHR, WebSocket, EventSource, workers, beacon, SDK construction and unrestricted
  window.open are denied. A hardening failure prevents app startup. Existing
  session/role/PIN values cannot create a legacy database client or grant roles.
- App-owned production sharing links become beta-origin links. Live-project links
  and arbitrary external/payment destinations are neutralised or blocked. The
  only intended external navigation is user-initiated WhatsApp sharing. Native
  Apple purchasing, Edge-function account deletion/subscription verification and
  push notifications are deliberately not enabled by Step 1. These need separate
  TEST configuration/review; no production native bridge or notification key is used.
- API keys/JWTs are not put in navigation URLs, logs or browser persistence. The
  current sign-in session remains in memory, as in the approved registration code.
- The output allowlist excludes original config.js, SDKs, SQL, source tools,
  backups, captures, service workers, demo pages and unreviewed files. Source
  hashes and replacement markers fail closed on drift. Artifact verification
  reconstructs the reviewed build and detects modified files, changed manifests,
  symlinks or extra files such as an accidentally copied config.js.

These policies cover application-owned requests/navigation. They cannot prevent a
person manually visiting another site through the browser address bar. Browser
extensions and the hosting service's own configuration are outside the client
artifact; the eventual separate host must apply and verify the supplied _headers.
No hosting settings were changed here. Never publish the repository root or app/.

## Offline build and verification

No Node packages, database credentials or network access are needed for the Python
builder. The command below creates a deliberately disabled package for inspection:

    python3 tools/test-beta/build.py --out /tmp/imingolf-test-beta-step1

It refuses to overwrite an existing directory and writes only a new directory
outside the repository. Inspect build-manifest.json: configured is false and
deployed is false. This is expected; no beta hostname/configuration has been
approved yet. A read-only verification command is:

    python3 tools/test-beta/build.py --verify --out /tmp/imingolf-test-beta-step1

For later approval only, the builder accepts --config pointing to an explicit
reviewed TEST public configuration file (see config.example.json). There is no
deployment command or hosting automation in this package. Do not publish or
activate it as part of Step 1. For an HTTP local visual review, continue using the
separate demonstration; the real beta intentionally requires its approved HTTPS
origin and will lock on localhost or a mismatching origin.

## Tests performed without online access or SQL

    python3 tools/test-beta/test_build.py
    TEST_BROWSER=/path/to/chromium node tests/test-beta-isolation.cjs
    TEST_BROWSER=/path/to/chromium node tests/onboarding-offline.cjs

Build tests reject other projects/hosts, production/secret keys, ambiguous origins,
environment fallbacks, source drift and artifact tampering. They verify the blank
shared configuration, output allowlist, checksums, removed legacy paths and CSP.
Browser tests use fictional data and locally intercepted responses; every request
is fulfilled or aborted before network contact. They exercise missing/wrong
config, saved/query PINs, legacy Admin access, production endpoints and JWTs, wrong
keys, forbidden RPCs, redirects, sockets and outbound links. Native fetch probes
verify independent CSP blocking, including on a locked configuration. A mocked
TEST signup/group creation and verified dashboard still work. This is not a real
email, JWT-signature, database-permissions or end-to-end online test.

## Outstanding — no further steps authorised

1. Revalidate TEST capture/backups/rollback, establish Auth trigger rollback
   authority (including the recorded Supautils question), and confirm/drain TEST
   writers before any separately approved installation. None is resolved here.
2. Review the existing server-side bulk handicap validation gap, then prepare the
   database/rollback changes separately. Joining already validates handicaps;
   client-side restrictions do not close the owner-only bulk save gap.
3. Review current TEST Auth/email settings, SMTP delivery, exact public key,
   redirects, RLS, grants, ownership and prerequisite/migration state read-only.
4. Separately approve any TEST database installation and TEST-only Edge/native
   services. Recheck data integrity, error recovery and rollback readiness.
5. Approve a distinct HTTPS beta hostname/hosting site, configure only TEST, apply
   and verify security headers, then explicitly approve publication. There is no
   online beta link from Step 1. Perform real new-user/email/iPhone/WhatsApp and
   full golf regression tests before inviting external testers.

Stop after this build review. LIVE, production hosting, the production branch,
PR #6 and all online database permissions/data remain untouched.

## Read-only Step 2 preparation after reconciliation

The approved remote implementation specification is preserved in
[IMPLEMENTATION.md](../../docs/online-beta/IMPLEMENTATION.md). See the separately
prepared [Step 2 review](../../docs/online-beta/STEP2-READONLY.md) and offline query
exporter prepare-step2.py. These prepare read-only SQL files; they do not connect
or execute them. In particular, the expanded specification still needs multi-group,
session, plus-handicap and invite-lifecycle work; Step 1 is not that implementation.
