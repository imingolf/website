# Compact demo notice and original welcome — replacement NOT approved/deployed

Only improve-new-user-registration is changed. No Netlify account/site setting,
visibility, production branch, LIVE/TEST database, deployment or hosted file was
accessed or changed during this revision. The black logged-in Netlify “Make public”
toolbar is outside this app's UI and was not targeted or removed.

## What changed

The landing page and all registration/app pages use one shared notice component.
It is a single-line button reading **DEMO MODE — Fictional data only**. Its normal
height is 45 CSS pixels, including a 44-pixel tap target and border. Real status-bar
safe area, when present, is added above it. There is no permanent paragraph or
second review button competing for the phone screen.

Tapping it opens the full fictional-data explanation in a native modal dialog.
The review controls remain below that explanation on app pages. A sticky Close
button, Escape/cancel handling, explicit Tab/Shift+Tab wrapping and focus return
keep it usable by keyboard and assistive technology. Nothing expands automatically
except when a simulated invitation explicitly opens its preview, as before.

The closed notice reserves its actual measured border-box height. ResizeObserver
tracks safe-area padding changes as well as window/visualViewport resizing.
Registration overlays and the opening animation start below that reserved area.
The old extra standalone-iPhone top spacer is removed only from demo styling, so
it cannot double the safe area. The expanded dialog uses the available visual
viewport height, scrolls internally and keeps its Close control reachable. The
notice remains visible while scrolling; the explanation takes no page space while
closed. Existing application, email and handicap screens are not rewritten.

## Authentic first-launch source and limits

Before practice tasks, the root page now shows the app's original golf-ball flight
and cup animation, the existing app icon and source welcome wording:

- Welcome to I'm In Golf
- Golf. Mates. You're In.

Get started reveals the organiser/player tasks. The splash honours reduced motion.
Its existing media policy remains unchanged; this is a visual welcome and does
not enable audio or external media. No storage remembers a visit: reopening or
refreshing the demo starts a new fictional exercise, as before.

Source reference: repository web-app commit
94318ca5a6d5774923e61df1bd6b6bed2f82d15a, app/index.html. Read-only inspection of that
Git object confirmed that its opening markup, JavaScript and CSS are byte-identical
to the approved a5b1b6a app source already used by the demo. Fragment hashes and
wording are recorded in welcome-reference.json. The builder verifies the opening
fragment hashes before reuse. Only the opening artwork/animation is extracted;
the released PIN-entry/configuration routes are not imported into the landing page.
This is a source-derived web welcome, not an assertion that an App Store binary or
the currently deployed production site was inspected. No LIVE request occurred.

## Isolation unchanged

The exact-origin lock remains https://imingolf-usability-demo.netlify.app when
built for the approved separate destination. Source app pins, static allowlist,
byte/hash verification, credential/production-target removal, local-only mock Auth
and group responses, CSP/connect-src none, worker/form/navigation restrictions,
in-memory data, fictional addresses and simulated sharing/payments are retained.
No security header or database safeguard was relaxed. Existing golf records are
never loaded, so their groups, scores and history remain untouched.

The new package has 22 files including its manifest. It must be generated into a
NEW folder for any later approved replacement; the old b9765e5 output is not the
new layout and must not be edited or silently overwritten. No replacement upload
command is authorised or executed by this review. The destination remains the
separate project 565a22d1-81f6-47dd-9d0b-614caa460171, never production.

## Offline checks

- Static builder/verification: exact 22-file set, unchanged security restrictions,
  source pins, fragment hashes, welcome-before-hidden-tasks and forbidden routes.
- Actual organiser/player screens still complete the fictional journeys through
  invitation, competition, Stableford/Net scoring, finish and previous results.
- Layout checks at 320×568, 375×667, 390×844 and 844×390: single-line notice, 44px
  target, no horizontal overflow, scrolling and native-dialog focus/close behaviour.
- A simulated 24px safe top inset verifies border-box remeasurement and prevents
  double spacing. A 320px visible height verifies form/button scrolling and dialog
  bounds. This is not a real iOS keyboard or physical-notch measurement.
- Existing local demonstration and full offline app regression suites remain part
  of the verification. Every external request is blocked/fulfilled locally; no
  actual Netlify site or Supabase project is contacted by these tests.

Physical Safari checks still required after a separately approved replacement:
real notch/home-indicator insets, Safari toolbar expansion/collapse, actual keyboard
and text sizing, portrait/landscape scrolling and the wife's unassisted first visit.
No hosted behaviour, access/visibility or security-header PASS is newly claimed.
Offline temporary builds were generated/verified for testing only. Stop for approval
before preparing the Mac upload folder or replacing the hosted demonstration.
