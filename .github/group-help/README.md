# Group Help and member totals — 16 November 2026

Group Help is available inside the existing Group/account options for organisers and players, including when no competition is open or the player's entry controls are hidden. It offers Ask for help, Report a problem and Send feedback, validates email/message, and prepares an email to hello@imingolf.co.uk with current group/PIN and reply details. The user still sends the email in their email app.

The header shows the current group's unique player-ID count. Existing badges refresh after roster changes; missing data does not become a zero count, and sign-out clears the previous group label. DOM updates settle instead of triggering a mutation loop.

Only `app/simple-clean.js` changes in the shipped app. Authentication, origin guard, joining, payments, scores, database data/schema, native code and Apple submissions are unchanged. Tests under `.github/group-help` use synthetic data and are not loaded by the application.

## Verified

- 57 full-app browser integration checks PASS. Actual app UI and session/adaptor modules with synthetic Auth/API transport, external network blocked by CSP. Player and organiser Group Help, existing controls, navigation, role switching, group switching, reload, sign-out, zero-member groups, closed entry, no mutation loop, and responsive widths 320/390/768px.
- 18 focused DOM checks PASS. Unique IDs, singular/plural, duplicate/missing IDs, unknown versus empty rosters, changed groups, refreshed badges, sign-out, validation, all three encoded mailto destinations/subjects/bodies, and repeated decoration without data changes.
- All 10 existing sync/gameplay regression checks PASS.
- JavaScript syntax and whitespace checks PASS.
- The tested app/simple-clean.js SHA-256: `3631dd8ea740da913847c4ea040418f1a9c245e57a57a5fde6cd65ba09e2210a`.
- Mailto generation is verified; no email was sent. Opening a physical-device email application is not claimed by the isolated tests.

## Reproduce

Install jsdom 26.1.0 in a separate test dependency directory, then set IIG_JSDOM_PATH to its jsdom directory and run `node .github/group-help/tests/dom.cjs` from the repository root. Run `node tests/sync-regression.cjs` and `node --check app/simple-clean.js`.

Run `python .github/group-help/tests/build-browser.py /workspace/sites/iig-group-help-qa`, serve that isolated directory using the managed preview, and open its root in the browser. The fixture rewrites configuration only in the generated QA copy and blocks external network; production guards are unchanged. Its review buttons reopen the actual Group view with synthetic player/organiser sessions.

## Rollback

Before publication, production was commit `c9c5a39642fdedc4b42cdbc937f7c2203e888511`, Netlify deploy `6af9ea6fe3fb404e71317f83`. The retained branch `rollback/before-group-help-20261116` points to this exact source. To undo this release, revert the PR #20 merge commit (first parent) and let the normal production deployment publish the reverted code. No data rollback or migration is required.
