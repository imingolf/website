# Notification tap to pending Side Game challenges

Build 7 passes only a group PIN on notification tap. The web handler now retains a short-lived route across reload/sign-in, performs an authenticated group refresh and opens the current recipient's pending invitations, scrolling the response controls into view. It uses the existing verified own-player transition for organisers. It never accepts or declines automatically.

This is group-level routing: any notification tap for a group with pending invitations prioritises those invitations. It cannot distinguish a competition notification or identify a specific invitation in Build 7. When none remain, the refreshed group view is retained. Exact notification-kind/invite routing requires a future native payload bridge change.

Incomplete actions block routing. Sign-out, account changes, failed reads and routes older than ten minutes cannot open stale challenges. A new player-ready event resumes routing after authentication.

Tests: `node --test .github/sidegame-tap/tests/router.cjs` (9 checks); existing Side Game and competition notification controller tests (10); response error client and invite filtering/inline JavaScript regression tests. No real-phone tap pass claimed until deployed and checked. Existing rollout/preferences and sending controls unchanged.

Publication blocked by Netlify account credit exhaustion. This candidate builds on merged PR24 and will also include its pending error-display changes when production publication resumes. No Apple build or submission is required for this web fallback.
