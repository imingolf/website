# Automatic native competition reminders — prepared, not deployed

Prepared 15 November 2026; refreshed 16 November against website main 4c2812cc46d6af083ba74b74695997f13166efe5, retaining the published Group Help and Group organiser changes; sender v13. The existing five-minute cron and competition event trigger are retained. Native delivery uses the existing competition-created, three-days-before and night-before events (18:00 in the group's timezone for timed reminders). The unrelated first-player-joined alert is not sent to native devices by this change.

## Changes

- The companion Flutter patch adds Firebase 17 Installation ID registration through a trusted app-page bridge. Registration happens after a verified group opens and OS permission is granted. No login token or server key enters the native bridge.
- My account contains Competition reminders On/Off in the updated native app. The account preference persists; default is On once OS permission is allowed. Ordinary browsers and older native versions do not show this native control.
- Additive private tables and restricted RPCs link a phone to its current verified account/session. Every delivery checks membership/ownership, account status, session, preference, group notification setting, group availability and current round identity.
- A separate native-delivery ledger leaves the legacy Web Push sender and event status unchanged. Old events, events before device registration/opt-in, future events, closed/replaced rounds and non-members are excluded. Claims and bounded retries use per-event/device keys and unique claim IDs.
- The sender adds Firebase OAuth/HTTP v1 delivery. Server and database rollout both start disabled. Production Firebase credentials are never included in source.

## Verification

Run from repository root:

```sh
python .github/native-reminders/tests/build-fixture.py
npm --prefix .github/native-reminders ci --ignore-scripts
npm --prefix .github/native-reminders test
```

26 automated tests passed, including actual PostgreSQL migration/RPC checks on synthetic data, client state transitions, provider outcomes and OAuth signature verification. The schema and account verifier come from the audited LIVE definitions. Test fixtures seed golf state directly and omit unrelated gameplay-write triggers; existing gameplay validation was not rerun or altered.

14 browser integration assertions passed using the actual account dialog/reminder module with mocked native/API adapters and a CSP blocking external requests. Checks cover On/Off persistence, permission denial/recovery, save failure, sign-out and absence in an ordinary browser. This is not an iPhone delivery test.

Native preservation checks passed: dependencies, version/build, signing entitlements, Firebase project plist, purchase handlers and navigation logic are unchanged. Info.plist has only the FID feature flag added. On 16 November Greg supplied the Mac result: guarded patch applied with verified original backup, `flutter pub get` and unsigned iOS debug build passed, dependencies/lockfile and signing unchanged, version/build 1.0.1+4. Analysis reported no errors or warnings and one informational missing-braces lint at `lib/competition_notifications.dart:85` (exit 1). This is a reported Mac result, not a build run in this checkout. Signed installation, APNs delivery and notification taps on a real iPhone remain unverified.

The refreshed checkout passed all 26 reminder tests, 18 Group Help DOM checks, 10 existing sync/gameplay checks, JavaScript syntax and whitespace checks. These are isolated checks, not real notification delivery.

Read-only LIVE checks on 16 November confirmed the private rollout table is absent and the sender remains v13, matching the saved baseline apart from a trailing newline. After the account's two-step verification was completed, the Firebase console was accessible: FCM HTTP v1 is enabled and both development and production APNs authentication keys are configured for `uk.co.imingolf.app`. This confirms configuration presence, not key validity or delivery. Supabase Edge Function secret names were inspected without revealing values: `IIG_FIREBASE_SERVICE_ACCOUNT` and `IIG_NATIVE_REMINDERS_ENABLED` are absent. The Google Cloud service-account list could not be fully inspected because browser reads stalled. No migration, server deployment, credential creation, device installation, send, production website publication or Apple submission was performed for this refresh.

The next proposed access change is a dedicated `iig-native-reminder-sender` service account in `i-m-in-golf`, with only `cloudmessaging.messages.create` through a project-scoped custom role, and a private JSON credential stored as the Supabase server secret `IIG_FIREBASE_SERVICE_ACCOUNT`. This proposal is pending explicit confirmation because it creates new security-sensitive access. The credential must never enter chat, source control or the public app. Creating it does not enable native reminders; both rollout controls remain off until a separately verified pilot is ready.

## Release sequence — not executed

1. Apply the separate guarded native patch to the Mac source; its hash checks stop if the source differs from the uploaded ZIP. Uploaded pubspec reports 1.0.1+4, so do not replace a newer project wholesale. Run Flutter analysis and an iOS build on the Mac, then install on Greg's test iPhone.
2. Securely configure `IIG_FIREBASE_SERVICE_ACCOUNT` in Supabase Edge Function secrets for Firebase project `i-m-in-golf`. Use a service identity limited to Firebase message sending. Never paste the key into chat or commit it. Validate the iOS APNs configuration in Firebase. Credentials were not inspected or changed during this preparation.
3. After release approval, apply the migration; it is dormant by default. Deploy the updated `iig-notification-sender` with `verify_jwt=false` as before. Keep the existing cron secret check and cron job unchanged. Keep `IIG_NATIVE_REMINDERS_ENABLED` absent/false initially. Publish the web code only after migration and Mac checks are complete.
4. Enable only the verified pilot account in `native_reminder_rollout.pilot_user_ids`, set `activated_at` to activation time, then set the server gate `IIG_NATIVE_REMINDERS_ENABLED=true`. Do not reset old event statuses or replay old alerts. Use a dedicated test group. Enablement must use the verified account UUID, not a guessed name/email.
5. On the real phone: Allow notifications, verify My account shows On, create a test competition and wait for the existing cron (up to five minutes), check background/terminated delivery and opening the correct group, turn Off and confirm no further test notifications, sign out and confirm no new deliveries. Timed cases must be verified without rewriting a real competition's history or sending to other golfers.
6. Only after the pilot passes: approve broader rollout and a separate Apple submission/release. Existing App Store installs cannot receive the new native bridge until updated.

## Operational limits and rollback

The queue makes up to three attempts per event/device. Provider acceptance is not proof of display. As with other push systems, an acknowledgement lost after provider acceptance can cause a duplicate on retry; the APNs collapse ID reduces duplicate pending notifications. Already-accepted alerts cannot be recalled after opt-out, sign-out or competition cancellation. Expiration is bounded to twelve hours from the scheduled event. Phone registration is refreshed when the app opens/resumes; stale registrations older than 90 days are excluded.

Disable the server gate and database rollout to stop future native dispatch. Keep the additive tables for preferences/audit; no destructive rollback is required. Restore sender v13 and revert web files if needed. Native startup failures do not block the app or change purchases. Production data, cron, credentials, web deployment and Apple release were not modified by this work.
