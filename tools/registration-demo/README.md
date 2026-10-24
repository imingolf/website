# Local registration demonstration — no deployment

Use the actual registration/handicap/organiser/player screen code on
improve-new-user-registration. The server makes filtered copies in memory;
production application files and their real host safeguards are not changed.
All eight source assets are SHA-256-pinned to approved commit a5b1b6a; changed
source requires explicit adapter/manifest review rather than automatic adoption.

## One Mac Terminal block

Uses the existing clone at ~/Downloads/imingolf-rollback. Git contacts GitHub for
source updates only. It does not upload your captures, backups or credentials.
Checkout stops if existing tracked changes would be overwritten; do not force it
or run git clean/reset to get past such a stop.

```bash
(
  set -e
  cd "$HOME/Downloads/imingolf-rollback"
  git fetch origin improve-new-user-registration
  git switch improve-new-user-registration
  git pull --ff-only origin improve-new-user-registration
  python3 tools/registration-demo/serve.py
)
```

Python 3 is required; no npm installation, Supabase tooling or Docker is needed.
The server reads local Mac interface settings and binds one specific private en
interface address. It chooses a fresh available port. The Terminal prints an
address such as http://192.168.1.20:54321/app/ — use the actual printed address,
not this example. Open it on your Mac and in Safari on your iPhone, connected to
the same trusted Wi-Fi. If macOS asks whether Python may accept incoming network
connections, allowing it is needed for iPhone access. No firewall changes are
made by the script. Guest Wi-Fi/client isolation or a VPN may prevent access.

If no suitable private interface is detected, startup explicitly reports Mac-only
loopback mode. You can restart with --host followed by the Mac's actual private
Wi-Fi IPv4 address. Public addresses, hostnames and 0.0.0.0 are rejected. Do not
configure router forwarding or a public tunnel. The server does not create either.

**Stop:** press **Control+C** in the server Terminal. Close the demo browser tabs
to discard their in-memory state. Stopping prevents new page loads; already
loaded tabs can still run their local simulation until closed/reloaded. Resetting
or reloading a tab starts a fresh simulation. Mac and iPhone data are separate.

## What to review

The compact **DEMO MODE — Fictional data only** button stays at the top. Tap it
for the full explanation and **Review controls** to select a scenario and reset, fill fictional
details, or fill the demonstration email code. Close the controls to use the
actual app buttons. Nothing is automatically submitted by the fill buttons.

- **New organiser:** Alex Taylor / Weekend Demo Golfers / alex@example.test.
  Start a golf group, request the simulated code, and verify with **123456**.
  Try **000000** for the incorrect/expired-code message. No email is sent.
- **Organiser self-joining:** open “I'm playing too”, enter a handicap and add
  yourself. Organiser access remains available; no round is opened automatically.
- **Handicap typing/paste:** try 11.2, 12, 22.7 and 8.5. A third whole-number digit
  is blocked; a dot must be explicitly entered before a decimal digit. Pasting
  112, 120, 227 or 11.22 leaves the previous value unchanged. Review controls has
  a playground and selectable valid/invalid samples for manual copy/paste.
- **Invitations:** Invite friends → Share on WhatsApp displays the exact fictional
  invitation in the review panel. Nothing is sent or opened. Copy invitation is
  also simulated; use manual copy only if you choose. Link hrefs/targets are
  neutralised, so a normal click or long-press cannot launch WhatsApp.
- **First competition:** course, date, scoring and save. Review the saved round.
  No real payment link or transaction is involved. Purchases/sharing are disabled.
- **Returning organiser:** use alex@example.test and 123456 to reopen fictional
  group **4826**, rather than create a second group.
- **Friend joining:** fictional Jamie Green / jamie@example.test enters through
  a seeded invitation, verifies their email, and enters their name and handicap.
- **Readback failure / creation failure:** choose the named scenario to see the
  real recovery controls. Each error occurs once; Check my group or retry works.

Only fictional @example.test email addresses are accepted. Use made-up names and
group/course details too. Typed values stay in browser memory; do not enter any
real passwords, bank details or personal data. PIN **7394** is a demonstration
allocation; it is not a registered TEST/LIVE group. Do not use 1010/1260/3520/5021.

## Exact isolation boundaries

- No database driver, SQL, migrations, email client or outgoing server connection.
  Mock Auth/group responses are generated entirely in the browser, not by an API.
- The Supabase CDN and production config.js script tags are removed from the
  served document. No production configuration, real publishable key, JWT or
  notification key is served. The demo has a dummy configuration only.
- The actual app's host allowlists remain unchanged on disk. Only the explicitly
  served demo copies accept the demo marker on a private LAN address. Build
  transforms fail closed if the expected source markers or any pinned source asset change.
- Runtime fetch has an explicit mock endpoint allowlist and no native network
  fallback. XMLHttpRequest, WebSocket, EventSource, workers and beacon are blocked.
  HTTP CSP independently sets connect-src/worker-src/form-action to none, permits
  only local scripts/styles/images, and disallows framing and remote assets.
- The WhatsApp action is generated as a local fragment, never a real outgoing
  WhatsApp href. Other anchor targets are removed and hrefs replaced with a
  harmless local fragment;
  the original invitation is retained only for the simulation display. window.open
  returns a simulated window so payment code cannot fall through to real navigation.
  The served app copies reference explicit simulated purchase/share/copy/open
  functions, including on insecure-context LAN Safari. DNS prefetch is disabled. Review reset navigation stays
  on this local origin. The demo cannot stop you manually visiting another site
  through Safari's address bar; that is outside the application boundary.
- All application localStorage/sessionStorage references are replaced in served
  copies with an in-memory map. Existing browser stores are neither read nor
  cleared. No cookies, service worker, local database or demo data file is created.
  A fresh random server port reduces accidental reuse of other local app origins.
- The HTTP server exposes a fixed in-memory allowlist of 13 routes/assets only.
  It does not serve the repository root, directories, .git, documentation, backups,
  original captures/rollbacks, config.js, manifests or service-worker scripts.
  Symlink asset files are rejected. Unknown paths get 404; writable methods get
  405. There are no writable API endpoints or request/body logs.
- Requests need the exact bound Host/port and a private/loopback client address.
  Foreign Origin values are rejected. No permissive CORS, proxy, public tunnel,
  TLS certificate installation, Netlify deployment or App Store action is used.
- HTTP over the trusted local LAN is intentional for fictional-data review only.
  Physical iPhone clipboard/decimal keyboard layout can be reviewed in Safari;
  the installed native wrapper, real email, JWT/RLS, WhatsApp hand-off and payment
  services are not tested by this demonstration.

## Existing server-side handicap gap

The real Supabase join function already validates the handicap's range and one
decimal place. The owner-only bulk group-save RPC does not independently validate
every edited player handicap. This remains a separate database/rollback review,
not something the demo fixes or proves. Any eventual validator must allow
unchanged legacy values and preserve historical rounds. No SQL definition or
permission is changed here. Existing TEST rollback-authority/writer-control
approval gates remain in force; this demonstration is not release approval.

## Offline verification

From the repository root:

```bash
python3 tools/registration-demo/test_server.py
node tests/onboarding-offline.cjs
TEST_BROWSER=/path/to/chromium node tests/onboarding-offline.cjs
```

Python tests use loopback HTTP only and verify the asset/credential filter,
CSP/no-store headers, private binding, Host/Origin checks, rejected writes,
path isolation, source-drift refusal, symlink refusal, pinned asset hashes and unchanged app files.
The browser regression runs the actual demo server on a fresh loopback port.
Its safety net aborts every external request before contact and asserts none were
attempted through that route. It exercises all five scenarios at phone widths,
self-joining, real handicap events, invitation interception/no popups, competition
save, preserved unrelated browser storage and reset. It also verifies CSP blocking
native fetch independently of the mock wrapper. No SQL/security migration suites
are executed by this runner.

## Separate HTTPS demonstration preparation

The local-only server above remains available and unchanged in its binding rules.
For the separately prepared static iPhone task demonstration, see
[HOSTED-DEMO.md](HOSTED-DEMO.md). The static builder does not publish anything;
it requires an explicit new-site HTTPS origin and a new output folder outside
Git. A distinct Free hosting site and publication still require approval.
