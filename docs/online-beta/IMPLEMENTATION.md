# I'm In Golf — Online Beta
Status: implementation specification, not deployed. LIVE must remain unchanged.
## Organiser flow
1. Welcome: Start group green, Join white.
2. Registration: blank name, group, email; Continue; support multiple groups per organiser.
3. Real six-digit email verification, resend cooldown, returning-account recognition.
4. Group ready: PIN, prominent Yes I'm playing / No just organising.
5. Invite: WhatsApp, public HTTPS invite, copy link, skip.
6. First competition: course, date, Stableford or Net, optional fee, skip; dashboard.
## Player flow
1. Show invited group; no PIN when invite valid.
2. Real OTP, existing account recognition, persistent secure sessions.
3. Name, handicap (including plus), validated typing/paste, profile reuse.
4. You're in confirmation, group switcher, simplified dashboard.
## Release gates
- Dedicated Supabase TEST project, TEST-only email sender and HTTPS beta hosting; no LIVE credentials.
- Verify RLS, roles, group isolation, invite expiry/revocation and idempotent joining.
- Per-group Plus entitlement; beta simulated only, no real payments.
- Review existing TEST rollback authority issue before applying any schema migrations.
- Never publicly expose the local tools/registration-demo server or remove its safeguards.
- Independent iPhone tests: real OTP, organiser, invitation, player, competition, group switching.
- Require explicit approval for TEST writes and deployment after checking exact project identifiers.