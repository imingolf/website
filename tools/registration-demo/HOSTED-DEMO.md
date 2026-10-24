# Independent iPhone demonstration — prepared, NOT published

Branch: improve-new-user-registration. No database connection, migration, project
setting change, hosting operation or deployment has been performed. Supabase
remains on Free. No upgrade, domain purchase or App Store action is required.

## Ready experience

The generated site reuses the actual approved organiser/player registration,
handicap, competition, scoring, leaderboard and previous-results screens. The
original app files remain untouched and SHA-256-pinned to approved a5b1b6a.
Only generated copies receive demo isolation and wording changes.

The original golf-ball opening animation, app logo and source welcome wording
(“Welcome to I'm In Golf”, “Golf. Mates. You're In.”) appear before the tasks.
Get started then reveals two independent tasks:

1. **Organiser:** use made-up details (Alex Taylor, Weekend Demo Golfers,
   alex@example.test), request simulated verification, enter 123456, create a
   fictional group/PIN, optionally self-join, preview invitations, and create a
   free Stableford or Net competition. Practice controls add fictional friends
   and can fill their scores. Enter your own total in the actual Scores screen,
   finish the round, and find League → Previous rounds and full standings.
2. **Invited friend:** a separate seeded invitation opens Saturday Demo Golfers.
   Use Jamie Green / jamie@example.test, verify with 123456, enter a handicap,
   join, tap I'm Playing and submit your own final total. A clearly labelled
   demonstration-only role switch lets the tester act as organiser to finish
   and view the result. This switch does not exist as an authentication shortcut
   in the real app; it changes fictional in-memory state only.

The task guide changes as progress is made. The original Review controls also
retain returning-organiser, failed-creation, failed-readback and handicap practice
scenarios. Only @example.test addresses are accepted. No inbox is required.

A compact, single-line **DEMO MODE — Fictional data only** button stays visible.
Tap it for a keyboard-accessible, scrollable explanation dialog. Closed height
is about 45 CSS pixels plus any real safe top inset, rather than a paragraph-sized
warning. Content and overlays reserve its measured height. Invitations are text
previews: WhatsApp, copying, popups, payment navigation and sharing are simulated.
No real invitation is opened or sent. Optional payment/advanced first-competition
controls and account-lifecycle buttons are hidden from the core practice tasks.

## Hosting proposal — after explicit approval only

Use a **new, separate Netlify Free static site with manual upload**. Do not link
this repository to automatic builds, use the production site's deploy panel,
change production settings, or use a deploy preview belonging to the production
site. No Supabase, backend, environment variables, tokens or server functions
are required. Once hosted, the Mac can be off; Safari loads static files from the
new HTTPS site and every simulated operation runs inside the tab.

A potential name is `imingolf-usability-demo`, but availability has NOT been
checked and no URL/site has been reserved. The actual new HTTPS origin must be
confirmed after approval. The build is locked to that exact origin and rejects
production/Supabase origins. Upload only a new generated folder, never app/,
the repository root, credentials, backup/recovery folders or the local server.
The bundle contains no Netlify Functions, forms integration, analytics or SDKs.

If the existing account cannot host another site within Free limits, stop; do
not purchase an upgrade or change the production plan. The proposed site is
unlisted/noindex, not an access-controlled private portal. Everything is fictional;
any additional access requirement needs a separately reviewed hosting choice.

### Later operator steps, not publication instructions authorised now

1. Approve creating/publishing a distinct Free site and confirm its HTTPS origin.
2. Build locally using that origin, then verify the exact output. Example syntax
   below uses a deliberately NON-PUBLIC test hostname and must not be treated as
   a real site URL:

```sh
python3 tools/registration-demo/build_static.py \
  --origin https://fictional-usability.example.test \
  --out "$HOME/Documents/ImInGolf-Fictional-Demo-Review"
python3 tools/registration-demo/build_static.py --verify \
  --origin https://fictional-usability.example.test \
  --out "$HOME/Documents/ImInGolf-Fictional-Demo-Review"
```

The destination must be new, outside the repository. The builder refuses an
existing folder; do not delete backups or run a reset to make it pass. These
commands create/inspect local static files only, never publish. The placeholder
build locks on an actual hosting domain; rebuild in a new folder with the approved
real origin before an approved upload. No publish CLI is provided.

3. After publication approval, manually upload only the verified generated folder
   to the NEW site. Ensure its `_headers` and `_redirects` are honoured. Before
   sending the link, verify HTTPS, CSP/connect-src none, no-store/noindex headers,
   correct origin lock and both task flows on that actual host. Offline tests do
   not establish live hosting headers or iPhone compatibility.
4. Send the resulting new-site link only after these checks and approval. No link
   is available yet; no tester message has been sent.

## Exact safety boundaries

- No LIVE/TEST Supabase endpoints, production hostname, keys, JWTs, config.js,
  Supabase SDK, push credentials or environment credentials in generated files.
- No native fetch fallback: the explicit fake Auth/RPC endpoints return browser
  memory responses. Unknown/external calls fail. XHR, WebSocket, EventSource,
  workers and beacon are blocked. CSP independently sets connect-src, worker-src,
  frame-src and form-action to none; remote scripts/assets are forbidden.
- Configured HTTPS-origin guard precedes app scripts. A misplaced upload locks
  rather than running the simulation or discovering another backend.
- Existing localStorage/sessionStorage are untouched. Demo state is an in-memory
  Map, with no cookies, service worker, persistence API or server writes.
- Refreshing/closing starts again; tabs/devices do not share groups or scores.
  Every task is independent. Local Mac rehearsal/demo files are never uploaded.
- Generated static files are allowlisted and hashed. Verification rejects changed,
  unexpected, missing and symlinked files. There is no SPA/API fallback; unknown
  paths return a static 404. Only static files are published after approval.
- No input is sent to a feedback collector. Hosting providers can retain ordinary
  page/asset access logs; the demo adds no tracking and sends no form/input data.
- These safeguards apply to application behaviour, not the tester manually visiting
  another site or sharing a screenshot using Safari/iOS outside this app.

## Simple independent tester instructions

Tell your wife: “Please try the two tasks on the first page without me explaining
where to tap. Use the fictional examples. If you get stuck, that is useful feedback.”
Avoid coaching her through the screens. Ask her to note hesitation before using
practice controls. Do not request her real email or a real golf group.

**Give feedback** asks whether she could finish without help and where she got
stuck. Responses stay in memory; reopening the sheet keeps them until refresh.
Ask her to screenshot that sheet and any confusing screen and send them to Greg
using her usual method. No Send button or automatic submission is implied.
Record separately which task/screen, what she expected, and any help needed.

## Testing and limitations

Offline tests cover source pins, exact artifact files, credential/endpoint removal,
strict headers/meta CSP, origin rejection, immutable original app files and output
verification/tampering. Browser tests fulfil HTTPS responses from local files and
abort external requests before contact. They cover 320/390px organiser and player
journeys through Stableford/Net setup, scoring, finish/history, simulated invitation
and role switch, feedback, reset, existing-storage preservation, wrong-host lock
and native fetch blocked independently by CSP. No real HTTPS host was contacted.

Relevant commands from the repository root:

```sh
python3 tools/registration-demo/test_static.py
python3 tools/registration-demo/test_server.py
TEST_BROWSER=/path/to/chromium node tests/onboarding-offline.cjs
```

Remaining manual checks after approved publication: actual Safari keyboard and
paste behaviour, safe-area/scroll/dialog layout, tap targets, reload behaviour,
both tasks without guidance, and host response headers/absence of online requests.
Chromium phone widths are not physical iPhone tests.

Out of scope/missing intentionally: real email delivery, real Auth/JWT/RLS, shared
multi-device groups, real WhatsApp hand-off, payments, native purchase/push/install,
account lifecycle, Trip Mode/Side Game simulation and full golf-service integration.
Do not interpret the demo as release approval or security validation of real TEST.
The existing server-side bulk-handicap validation gap remains a separate database
review; browser restrictions and this mock do not close it. Saved real golf groups,
scores and history are never loaded or changed.

## Compact layout revision — not deployed

See [COMPACT-NOTICE-REVIEW.md](COMPACT-NOTICE-REVIEW.md) for the new phone layout,
source provenance and pending replacement approval. This changes the generated
package to 22 files. Existing b9765e5 folders contain the old layout and will not
verify against this revision. Do not overwrite or upload an old folder.
