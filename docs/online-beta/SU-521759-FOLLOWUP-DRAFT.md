# Draft only — existing Supabase ticket SU-521759

Please add this to SU-521759; do not open a duplicate ticket. Not sent.

We are preparing a controlled registration beta on TEST project
nyavvwrsrxqfyhiygkgw (Free, PostgreSQL 17.11). No production change is requested.
Two issues block our read-only readiness review and rollback approval:

1. Session-pooler TLS: our Mac uses the project-specific session-pooler username
   at aws-0-eu-west-1.pooler.supabase.com:5432 with libpq sslmode=verify-full and
   trusted CA/hostname verification. The server reports backend_ssl=false via
   pg_stat_ssl. We understand that may describe the pooler-to-database leg, not
   client-to-pooler TLS. “Enforce SSL on incoming connections” is OFF and unchanged.
   Please confirm the supported way to establish and verify encryption on both
   legs for this project. Would enforcement change that internal leg, require a
   restart, or affect existing Auth/API/services and recovery connections? Is a
   supported remedy available on Free without that setting change? We will not
   weaken verify-full or change settings without a reviewed impact plan. Direct
   IPv6 from our current Mac network returns “No route to host”.

2. Auth trigger rollback: our guarded rollback must DROP an application-created
   trigger on auth.users. The postgres connection role is not proven to inherit
   ownership of that managed table. We found an exact matching
   supautils.drop_trigger_grants configuration in read-only evidence, but do not
   treat the setting alone as proof that DROP TRIGGER is supported. Please confirm
   the managed implementation/version and exact role/table/trigger conditions under
   which postgres is authorised, including whether CREATE OR REPLACE/rollback
   ordering or security context changes the result. Can you confirm the authority
   for this project through support-side review without us executing test DDL,
   granting privileges or changing Auth ownership?

We can provide sanitised exact trigger identity, role-membership evidence and the
relevant rollback statement privately in this existing ticket. No passwords, user
records or tokens are included here. We have rehearsed application rollback locally,
but that does not prove hosted managed-Auth authority. Please advise a supported
verification/recovery path if the configured grant is insufficient.
