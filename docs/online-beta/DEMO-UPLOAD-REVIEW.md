# Original b9765e5 upload review — historical layout

The owner subsequently reported uploading that original package. A new compact
notice/welcome revision is now prepared but NOT uploaded. See
[the current replacement review](../../tools/registration-demo/COMPACT-NOTICE-REVIEW.md).
The commands and 19-file count below document the old package, not the new revision.

The owner reports creating this separate empty Netlify Free project:

- Site: imingolf-usability-demo
- Exact HTTPS origin: https://imingolf-usability-demo.netlify.app
- Project ID: 565a22d1-81f6-47dd-9d0b-614caa460171
- Method: manual static upload only; no GitHub deployment integration.

This destination has not been contacted or altered during build verification.
No files have been uploaded, deployed or published by this work. Its current
hosting configuration/headers remain unverified until a separately approved
publication and live-host check. Production hosting, Supabase and branches stay
untouched. Refer to [HOSTED-DEMO.md](../../tools/registration-demo/HOSTED-DEMO.md)
for full safety requirements and tester instructions.

## Verified package

At this original review, all build/demo source files were byte-identical to b9765e5.
The test harness additionally accepts IIG_DEMO_TEST_ORIGIN to run its locally
fulfilled browser journeys using the confirmed origin. This changes no generated
application file. The original app assets remain pinned to a5b1b6a.

The package is locked to the exact origin above and contains 19 allowlisted files,
including its checksum manifest, restrictive headers, a static 404 and no-index
rules. Its verifier compares the entire file set and every byte against the
reviewed build, rejecting tampering, symlinks, wrong origins and extra files.
No credentials, database targets, production URLs, backups, Git metadata, server
functions or Netlify linking configuration are included.

## Exact Mac build and verification

Paste this block into Terminal. Git contacts GitHub for source only. Python
creates/verifies static files outside the repository; no hosting or database
operation is invoked. It needs Python 3, not Node/Docker/Supabase/Netlify CLI.

```sh
cd "$HOME/Downloads/imingolf-rollback" &&
git switch improve-new-user-registration &&
git pull --ff-only origin improve-new-user-registration &&
python3 tools/registration-demo/test_static.py &&
python3 tools/registration-demo/build_static.py \
  --origin https://imingolf-usability-demo.netlify.app \
  --out "$HOME/Documents/ImInGolf-Usability-Demo-b9765e5" &&
python3 tools/registration-demo/build_static.py --verify \
  --origin https://imingolf-usability-demo.netlify.app \
  --out "$HOME/Documents/ImInGolf-Usability-Demo-b9765e5"
```

Expected: seven static-package tests OK and two PASS / NOT DEPLOYED messages.
If the output directory already exists, stop. Do not delete it or choose another
folder silently. Its existing contents can be reviewed and verified separately.
Any failed command stops the remaining block. Do not upload a partially built or
unverified folder. Double-clicking index.html will lock intentionally: file://
is not the approved HTTPS origin. No localhost/public-tunnel bypass is provided.

Proposed future upload folder (not the repository or its parent Documents folder):
`~/Documents/ImInGolf-Usability-Demo-b9765e5`

Before any upload, report the verification result and obtain explicit approval
for this exact folder and the exact new project ID/hostname above. Do not run
netlify deploy, use Netlify Drop or drag any files into a dashboard yet.

## Offline evidence and remaining checks

Static security/build tests and existing offline beta/security tests pass. Browser
journeys at the confirmed HTTPS origin are fulfilled entirely from local generated
files; unknown origins are aborted. No network request reaches the named Netlify
site. The checks cover new organiser and invited player registration, simulation
code/invitation, Stableford and Net setup, scoring, finishing, previous results,
manual feedback, storage preservation/reset, native CSP blocking and wrong-host
lockout. No physical iPhone or real host result is claimed.

After separate publication approval, verify actual HTTPS headers/origin and both
flows on the real site before giving the link to the tester. Physical Safari
keyboard/paste, safe-area/dialog scrolling and independent novice usability remain
manual verification. No real email, authentication, shared-device state, payments,
WhatsApp sending or Supabase permissions are tested by this fictional demo.
