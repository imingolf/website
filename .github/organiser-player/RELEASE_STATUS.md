# Release approval and verification — 15 November 2026

Greg explicitly approved publishing this automatic-player fix to LIVE, including its database update, and confirmed that he had deleted Pam's old group.

- Source: PR 11, https://github.com/imingolf/website/pull/11. The frontend publishes through Netlify when this PR merges; refer to its merge/deployment status for publication.
- Tested implementation commit: 9d7da261fc956817e8139ada2bcdb1be0e9ee55c.
- Local database: 12 checks passed using audited server functions and synthetic data.
- Isolated browser: 67 integration checks passed; no real email, payment or group-creation requests.
- New backend RPC installed and read back exactly, body MD5 d5f5deb46b9f3e81ef03bcccfa588784.
- SECURITY INVOKER, fixed pg_catalog search path, authenticated execute only; anon denied.
- All existing function definitions unchanged. All 12 existing groups unchanged by installation; 22 accounts preserved.
- Existing security advisory counts unchanged; no new-function findings.
- Read-only verification confirms Pam's former group ID 41 is absent. No group deletion, restoration, or customer account modification was performed by this release.
- No Apple submission.

Automatic approval review initially blocked the LIVE migration while only private-preview authorization was established. The subsequent explicit user approval resolved that restriction. The migration succeeded through the normal approved migration tool. Production frontend rollback target before this release: commit 5d644901ea54805020542960989ed2a4c72becba, Netlify deploy 6af9a3fb420f2975ae66abfb.

Step 1 collects name, email, group name and handicap. After existing email verification, the new group and linked organiser player are created in one transaction. Steps 2–4 remain Invite, Payments and Ready. Real device signup is not claimed by the isolated checks.
