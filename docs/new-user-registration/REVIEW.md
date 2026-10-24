# Guided registration review — development only

Branch: improve-new-user-registration, based on PR #6 commit eadb495.
This work is separate from PR #6 and the rollback preparation branch.
No database/schema/data update, migration execution, merge or deployment is part
of this change. Existing Supabase database and authentication APIs are retained.

## Implemented journey

1. Enter group name, organiser name and email together.
2. Receive and enter the email code; successful verification creates the group
   automatically using the existing verified-owner API and retry identifier.
3. Confirm the returned group PIN and saved name, then invite friends or create
   the first competition. An existing organiser account loads its existing group
   instead of creating another. An explicit returning-account sign-in is provided.

Only non-secret draft details and retry IDs use sessionStorage. Tokens remain
in memory. Reloading therefore requires a new email code; this is deliberate,
not a silently persisted login. Draft details can be restored in the same tab.
Creation acknowledgements survive a failed readback, with a clear Check my group
recovery message. No automatic second creation is attempted after uncertainty.
Email-code errors and rate limits have plain messages; resend cooldowns remain.

The database still generates the unique PIN and handles collisions. This UI does
not generate PINs or reuse one belonging to a different group. Owner email access
is separate from the shareable group PIN/invitation token.

Invitations can be shared before a competition opens. WhatsApp receives an
encoded group-specific message and verified-player join link, with a clipboard
and manually selectable link fallback. No organiser login/session is included.
Players still verify their own email and explicitly choose attendance once a
competition is open. The organiser can add themselves as a player without losing
organiser access or automatically opening/entering a round.

The first competition has one form: course, date and Stableford/Net scoring.
No entry fee is the default (Points Game). An optional whole-pound fee uses the
existing Group Game and requires the existing payment link. Advanced settings,
prize splits and Trip Mode remain available via the existing full setup flow.
First-competition saving reloads the owner's current group first and refuses to
replace a competition another device has already created. Existing players and
other group state are preserved. Save conflicts stay blocked until reload.

## Handicap behaviour

A single shared input guard is connected to player joining, organiser self-join,
account switching, player handicap changes, legacy Admin add/edit dialogs and
both standalone test pages. All use text inputs with inputmode=decimal.

Typing/paste permits at most two digits before an optional decimal and one after.
112, 120, 227, 11.22, repeated dots, exponent notation, commas and mixed text are
rejected as complete edits; they are not truncated or guessed into another value.
Selection/replacement, deleting and a temporarily trailing decimal are supported.
A final value needs digits after an entered decimal. Existing negative-handicap
support and the existing -10 to 60 final range remain unchanged. Binding an input
does not rewrite a saved value. Historical scores/handicaps are never normalised.

The guard checks beforeinput/paste and rolls back invalid input events as a
fallback for different webviews/autofill. maxlength is deliberately removed from
bound fields: browsers must not truncate an invalid paste into a different valid
handicap before validation. Existing Supabase join precision/range validation
remains a second safeguard. No SQL definitions were changed or executed.

Important existing limitation: the owner-only bulk group-save RPC validates the
group structure/identity/revision, but not every edited player handicap as an
independent field. These UI changes do not claim to add that missing server-side
check. Closing this gap requires a separately reviewed database/rollback change
that allows unchanged legacy values and does not rewrite historical data.

## Automated validation

    cd tests
    npm run onboarding

This runner parses all app scripts and runs 11 offline suites without SQL,
migrations, a database engine or hosted requests. It covers the shared input
guard, new first-competition flow, creation/returning-user DOM, existing score
sync/finish/league flows, Trip/Side Games, owner/player controls and mocked account
and subscription services.

With a local Chromium executable, add rendered browser coverage:

    TEST_BROWSER=/usr/bin/chromium npm run onboarding

On this development machine, all 13 suites passed. Browser requests are all
fulfilled locally; no email, Supabase or Apple calls occur. New rendered tests
cover 320x640, 390x844 and 1024x900 viewports, real typing/paste rejection events,
email-code error/retry, automatic creation, duplicate-account reconciliation,
organiser joining, invitation content before a round, first-round save and
preserved players/history. Tests assert no page errors or horizontal overflow.
The existing browser regression also covers readback failure/retry, owner access,
protected payments, Trip pair scores and Side Game forms.

Full SQL/security suites were not rerun for this change because migration
execution was explicitly excluded. This report claims no new hosted/SQL test pass.

## Required manual checks and approval gates

- Real iPhone decimal keyboard, text selection, paste and autofill behaviour in
  Safari and the installed app. The keyboard request is verified in code/browser,
  but a desktop browser does not prove the physical iPhone keyboard layout.
- Switching to Mail and back, numeric code delivery/autofill/expiry/resend, reload
  and signing back in with an existing organiser or player account.
- Actual WhatsApp hand-off and reopening the complete invitation in the intended
  browser/app, including a new player joining before any competition exists.
- Actual Supabase JWT/RLS, PIN allocation under concurrent requests, save/reload
  failures and an owner playing in their own competition. Current tests mock HTTP.
- A full later round on an authorised test group: attendance, scoring, finishing,
  results and previous rounds; regression checks for leagues, Trip/Side Games and
  Admin controls. Do not use LIVE groups 1010/1260 for new-user tests.
- The existing TEST migration rollback-authority and paused-writer gates remain
  outstanding. The four PR #6 SQL files and original capture/rollback are untouched.
- The server-side bulk owner-edit validation gap above requires review before
  claiming the same server safeguard across every editing path.

Deployment is NOT approved by this implementation or by mocked test passes.
Host allowlists still permit only localhost/127.0.0.1 and the existing PR #6 test
preview, never arbitrary hosts or production. A new preview target requires
separate approval/configuration. No native iOS project is included here; app
wrapper/WhatsApp behaviour cannot be certified from these web sources alone.

## Local, isolated visual demonstration

An approved local-only demonstration is now available in
[tools/registration-demo](../../tools/registration-demo/README.md). It renders
filtered copies of these actual screens with fictional in-memory responses,
without changing this application's real host guards or connecting to any online
project. Follow its single Mac launch block to review on the Mac and an iPhone
on the same trusted Wi-Fi. This does not deploy or approve production release.

## Step 1: isolated beta build preparation

See [the TEST beta build review](../../tools/test-beta/README.md). A separate,
unpublished build strips legacy database clients and production configuration,
requires explicit TEST-only settings and blocks unapproved endpoints. The shared
development config is now blank by default. The local demonstration remains
separate and mocked. No database installation, permission change or publication
is authorised by this step; the earlier safety and server-validation gaps remain.
