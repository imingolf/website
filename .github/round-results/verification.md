# Admin Round: hide settled previous results

User approved hiding fully paid previous results after a new competition opens, and clarified that the issue occurs only in admin view.

The only production change is the display guard inside the existing admin branch of `prizeNextActionHtml`: when the current round is open and there is no outstanding prize action, omit the old result card. No data writer, authentication, payment operation, database function, history view or player-view branch changes.

Checked with the actual app in an isolated browser using synthetic records and the existing network-blocked preview adapter:

- New competition open, all three prior prizes paid: old result card absent; current competition and current-round payment panel present.
- New competition open, one prior prize ready to pay: result card and payment-status button remain visible.
- No new competition open: last result remains visible.
- League → All previous rounds → View details: complete standings and all three paid prizes remain accessible.
- All inline JavaScript passed syntax validation; git diff contains only the comment and display guard.

`admin-preview.jpg` is the observed checked layout with test data, not a screenshot of a customer's group. No LIVE group state was read or changed for this fix.
