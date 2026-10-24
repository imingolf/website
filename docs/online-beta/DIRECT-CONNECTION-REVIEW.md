# Direct PostgreSQL TEST connection — offline recommendation

Status: prepared on improve-new-user-registration after f5a97a2. No database
connection, DNS lookup of a project endpoint, port/TLS probe, SQL execution,
project/service setting change, migration or deployment occurred in this review.
Official public documentation was read from Supabase's GitHub repository only.

## Recommendation

Prefer an explicitly selected direct connection for the next separately approved
TEST read-only review **if the TEST dashboard confirms its endpoint and the Mac's
network can reach the required address family**. The runner already supports the
exact TEST direct hostname, so no transport-code change or weaker guard is needed.
This recommendation is not confirmation that this project/network is reachable.

Use only the officially documented shape, checked against the TEST Connect panel:

| Setting | Proposed value |
| --- | --- |
| Project | nyavvwrsrxqfyhiygkgw |
| Connection type | Direct connection, not session/transaction/dedicated pooler |
| Host | db.nyavvwrsrxqfyhiygkgw.supabase.co |
| Port / database | 5432 / postgres |
| User | postgres, not the pooler-qualified username |
| TLS | verify-full with the official TEST dashboard CA file |

Do not infer the endpoint is available just because its hostname can be composed.
Confirm it in TEST's Connect dialog. Do not substitute a different project, address,
hostaddr, proxy, VPN gateway, port 6543 or pooler if it fails. No automatic fallback.

## Support and IPv4/IPv6 limitations

[Supabase's official connection guidance](https://supabase.com/docs/guides/database/connecting-to-postgres)
([reviewed source](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/database/connecting-to-postgres.mdx))
specifies direct access to the project's PostgreSQL instance on port 5432 as
postgres. It distinguishes this from Supavisor and documents IPv6 by default,
or IPv4 when the project has the IPv4 add-on. Direct access is therefore supported
in principle; this project's current endpoint/add-on/network restrictions remain
unverified because no project was queried.

Mac and Homebrew PostgreSQL 18.6 are compatible in principle with direct PostgreSQL
and IPv6/TLS. Python LibreSSL does not establish the libpq/OpenSSL connection.
Having Mac IPv6 support, an IPv6 interface or a link-local fe80 address does not
prove Internet IPv6 reachability. Router, ISP, active VPN, firewall and Supabase
network restrictions can still block access. A DNS AAAA record alone is not proof
that the Mac can reach the database. No reachability test was attempted here.

If the Mac network is IPv4-only and TEST has no IPv4 add-on, direct access is
**NO-GO under the current configuration**. Do not enable the add-on automatically.
It is a separately approved paid/platform change and can cause downtime/DNS
propagation effects. Never enable it on LIVE as part of this work. A suitable
IPv6-capable network can be considered separately; do not install a public tunnel
or bypass network policy to obtain access.

[Official IPv4 add-on documentation](https://supabase.com/docs/guides/platform/ipv4-address)
([reviewed source](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/platform/ipv4-address.mdx))
confirms the add-on and its potential direct-connection interruption. It also
links https://ipv6test.google.com/ as a non-database IPv6 check. A later approved
network check can use that public diagnostic without probing TEST, but successful
web IPv6 alone does not establish port 5432 access. No such check was run here.

## TLS: what direct access changes and what it does not

With a direct PostgreSQL connection there is no Supavisor hop. pg_stat_ssl for
pg_backend_pid() then observes the same database connection that libpq secured
from the Mac, rather than the pooler-to-database leg. A successful verify-full
direct connection is expected to report ssl=true, which must be checked.

SSL enforcement being OFF allows non-SSL clients; it does not require our client
to use plaintext. Explicit verify-full refuses unverified/plaintext connections.
There is no need to toggle enforcement merely to attempt verified direct TLS.
This avoids the particular pooler-hop ambiguity, **not** the requirement for a
successful handshake and backend SSL confirmation. A false/missing SSL result
still stops; it is not accepted on the basis of this architecture explanation.

Use the unedited official CA downloaded from this exact TEST project's dashboard
and already validated offline. The CA must validate the certificate for the exact
project direct hostname; do not use an IP in place of that hostname. Python
certificate parsing remains a format check only, not actual libpq/server-chain
validation. Expired/untrusted/hostname-mismatched certificates fail closed. No
certificate is learned from a failed handshake or added to global trust stores.

[Supabase SSL guidance](https://supabase.com/docs/guides/platform/ssl-enforcement)
([reviewed source](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/platform/ssl-enforcement.mdx))
and [PostgreSQL verify-full](https://www.postgresql.org/docs/18/libpq-ssl.html)
explain certificate trust and hostname verification. The PostgreSQL
[SSL statistics view](https://www.postgresql.org/docs/18/monitoring-stats.html#MONITORING-PG-STAT-SSL-VIEW)
describes the backend-connection observation; no server result was newly collected.

## Isolated Mac profile proposal — do not install/connect yet

[tools/test-beta/test-direct-service.example.conf](../../tools/test-beta/test-direct-service.example.conf)
is a credential-free example, not an installed service or database connection.
Keep ~/.pg_service.conf and its iig-test-only pooler profile untouched.

After separate approval, place the example in a private Mac file OUTSIDE Git, such
as ~/Documents/ImInGolf-TEST-Installation/test-direct-service.conf (mode 0600), and
select it only with the runner's existing --service-file option. The section name
remains iig-test-only, but libpq receives explicit verified parameters from the
selected file, not inherited/default service settings. Do not run psql yourself
or paste a password-bearing connection URI into Terminal.

No password is supplied in the example. A future approved online run can prompt
privately in Terminal; offline mode never prompts. The direct host/username differ
from the pooler, so the existing pooler password-file entry must not be reused
implicitly or relaxed to a wildcard. Only an exact direct TEST entry in a private
passfile is acceptable if one is separately configured. No credentials are copied,
stored in Git/evidence/arguments, or taken from another service/project.

No new connection mode was added: the runner already verifies this direct host.
All existing controls are retained:

- exact host/project binding, database, role, PostgreSQL 17.11 and optional project
  setting; verified TLS/hostname and database-side SSL=true;
- explicit READ ONLY in every transaction, local default/timeouts, server-side
  precondition checks before application metadata queries, and fixed query hashes;
- no arbitrary SQL, RPCs, role elevation, retries, service control or endpoint fallback;
- original immutable capture/rollback/backup/rehearsal evidence validation, repeated
  fingerprint/catalog comparisons and immediate stop on baseline drift;
- inherited PG/CA environment isolation, disabled default pgpass, private evidence,
  sanitised errors and explicit approval gate before the first connection.

Direct access should honour PostgreSQL startup options without pooler filtering,
but no safeguard relies on that expectation: transaction-local guards stay in
place and both read-only values must be on. Local settings disappear at transaction
end; role/database/service settings are never changed. READ ONLY is not a sandbox
for arbitrary side-effecting functions; the fixed query registry stays essential.

## Remaining risks are unchanged

- Connecting directly as postgres does not create new ownership/privileges.
  Original rollback DROP TRIGGER authority on auth.users, including the Supautils
  question, still requires establishment. Do not infer authority from the route.
- Original TEST data/security baseline must still match. Any new group, Auth,
  permissions or October default-ACL rollout drift must stop, not be accepted.
- External writers are not confirmed paused/drained. A read-only review can observe
  activity but cannot prove a controlled installation window from idle sessions.
- Missing historical backup checksum, incomplete full Supabase/Auth/ACL/service
  recovery proof and sequence ACL coverage remain documented limits.
- The extra Data API ACL tail is unexecuted and not part of the rehearsed four.
  It needs its own expanded rehearsal/approval. Existing original recovery files
  and the four eadb495 migration hashes remain unchanged.
- SMTP/real OTP, hosted JWT/RLS/cross-user behaviour, iPhone flows, broader beta
  specification gaps and production approval are not solved by a direct connection.

Support confirmation is not inherently required to use the documented direct
endpoint if it is reachable and all checks pass. Support is still needed for
unresolved managed rollback authority, unexplained direct TLS/backend observations
or project-specific restrictions. This proposal does not close the original pooler
SSL-enforcement question or authorise a support message/settings change.

## Next safe action

In the browser, view ONLY TEST project nyavvwrsrxqfyhiygkgw, Connect → Direct
connection. Report the host, port, username and any IPv4/IPv6 compatibility notice,
plus whether an IPv4 add-on is already active if the panel states it. Do not share
the password or full credential-bearing URI, change settings, enable an add-on or
try a connection. Then agree on non-database Mac network verification and private
profile preparation. Stop for approval before an actual database connection.

Optional code-only verification now (does not need Mac configuration or connect):

```sh
cd ~/Downloads/imingolf-rollback &&
git switch improve-new-user-registration &&
git pull --ff-only origin improve-new-user-registration &&
python3 tools/test-beta/test_readonly_runner.py
```

New offline tests cover the exact direct example, CA/verify-full/read-only
propagation, a fully mocked review, no pooler fallback on network/TLS/guard failures,
wrong host/port rejection, exact-host credential isolation and offline profile
selection without modifying the existing pooler profile. They do not prove IPv6
availability, certificate acceptance, real database permissions or recovery.
