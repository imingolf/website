# Release status — 15 November 2026

Prepared and tested; NOT LIVE.

- Source: PR 11, https://github.com/imingolf/website/pull/11 (open, not merged).
- Tested source commit: 9d7da261fc956817e8139ada2bcdb1be0e9ee55c.
- Local database: 12 checks passed using audited functions and synthetic data.
- Isolated browser: 67 integration checks passed.
- Private internal review: Step 1 now contains required handicap and automatic-player explanation; screenshot saved as step-one-review.jpg.
- Production remains commit 5d644901ea54805020542960989ed2a4c72becba / deploy 6af9a3fb420f2975ae66abfb.
- No existing groups or accounts were modified. No Apple submission.

Automatic approval review rejected installation of the new RPC on LIVE because the user originally requested a private preview and no LIVE publication, and later explicit user authorization lifting that restriction was not established. The earlier assistant assertion that LIVE authorization existed was not sufficient. Readback confirmed the new RPC is absent. Do not merge the frontend before authorized installation and verification of the backend migration.

Outstanding: explicit user approval to apply the new RPC and publish this specific frontend fix to LIVE. After approval, install the already-tested migration, verify function permissions and preservation of existing data/functions, then merge the PR and verify production bytes/UI. Do not create real test groups or modify Pam's already-created group.
