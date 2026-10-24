# Registration beta task order

## Main work: secure TEST review and beta readiness

1. Review [direct connection feasibility](DIRECT-CONNECTION-REVIEW.md): confirm
   TEST Connect metadata and address-family availability without changing settings.
   Prepare/validate an isolated private Mac profile only after approval; obtain
   explicit approval again before a database connection. No endpoint fallback.
2. Complete the guarded TEST read-only baseline/permissions review, including
   managed rollback authority, Data API default-grant drift and recovery coverage.
   Resolve writer controls before any separately approved installation.
3. Rehearse and review any expanded migration/ACL bundle, remaining registration
   implementation, hosted email/JWT and iPhone verification before beta publication.

## Separate upcoming task: fictional-data iPhone demonstration

Prepared on this development branch: a separate static HTTPS demonstration,
novice tasks, fictional scoring/results and manual feedback. See
[hosting and review instructions](../../tools/registration-demo/HOSTED-DEMO.md).
Publication and physical iPhone testing await separate approval. Keep it separate
from real TEST integration; the security/recovery tasks above remain open.
Use fictional data, permanent DEMONSTRATION labelling and mocked verification,
group/invitation/competition/returning-user scenarios. Preserve handicap typing
and paste checks. No real Supabase, Auth, email, payment or WhatsApp sending; no
public tunnel or deployment. The remaining task is approving the isolated publication, then observing the
independent iPhone usability session. It does not bypass the security/recovery
gates for the real beta.
