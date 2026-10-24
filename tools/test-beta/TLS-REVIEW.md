# TEST pooler TLS review — no connection retried

Reviewed 24 October 2026. Target remains exclusively
`aws-0-eu-west-1.pooler.supabase.com:5432` with the exact TEST-qualified username.
No certificate chain was fetched from that endpoint. No database was contacted.

## Findings and official sources

The reported Mac uses Python LibreSSL 2.8.3, but Homebrew psql 18.6 loads
`/opt/homebrew/Cellar/postgresql@18/18.6_1/lib/postgresql/libpq.5.dylib`.
This establishes separate client stacks; it does not yet identify libpq's linked
OpenSSL version or actual default certificate file. Python's `/private/etc/ssl/cert.pem`
is not proof of libpq's trust selection. Generic TLS_CERTIFICATE_ERROR alone
cannot distinguish trust-chain failure, expiry or other certificate failures.

Official guidance reviewed through its public GitHub source (the documentation
websites were unavailable from this development environment):

- [Supabase SSL enforcement](https://supabase.com/docs/guides/platform/ssl-enforcement)
  ([official source](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/platform/ssl-enforcement.mdx)):
  download the Supabase CA from Database Settings / SSL Configuration and provide
  it to the client. Its verify-full example explicitly uses a shared-pooler
  `*.pooler.supabase.com` hostname. This supports using the official dashboard CA
  for the shared pooler; it does not prove the current endpoint's chain.
- [Supabase connection guidance](https://supabase.com/docs/guides/database/connecting-to-postgres)
  ([source](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/database/connecting-to-postgres.mdx)):
  use the dashboard's actual session-pooler hostname and qualified username,
  port 5432; supply sslrootcert and verify-full. Do not construct a different host.
- [PostgreSQL 18 SSL](https://www.postgresql.org/docs/18/libpq-ssl.html) and
  [connection parameters](https://www.postgresql.org/docs/18/libpq-connect.html#LIBPQ-CONNECT-SSLROOTCERT)
  ([official source](https://github.com/postgres/postgres/blob/REL_18_STABLE/doc/src/sgml/libpq.sgml)):
  system means roots from the SSL implementation, with OpenSSL locations affected
  by SSL_CERT_FILE/SSL_CERT_DIR. verify-full verifies both trust and hostname.
- [Homebrew OpenSSL formula](https://github.com/Homebrew/homebrew-core/blob/HEAD/Formula/o/openssl@3.rb)
  links its cert.pem to Homebrew's ca-certificates bundle; the
  [CA formula](https://github.com/Homebrew/homebrew-core/blob/HEAD/Formula/c/ca-certificates.rb)
  describes its Mozilla-derived store (current implementation also incorporates
  trusted system certificates). This is a legitimate public-root source, but it
  is not proof that the pooler chain uses those public roots. Do not reinstall or
  append arbitrary certificates to solve this without evidence.

## Safe correction

Use the official Supabase dashboard CA explicitly for this run, without editing
`.pg_service.conf`, changing host, or modifying a global trust store. We do not
assert a particular CA subject/fingerprint: the official downloaded file must
supply that evidence. Never use a server leaf certificate captured from a failed
handshake as a new trust anchor. Do not use the fictional regression fixture.

`--ca-file /absolute/path` overrides only CA selection. All target, project, TLS,
baseline, backup, rollback and query guards remain in force. It never downloads a
certificate or changes service settings. There is no automatic CA fallback.

The runner parses an explicit CA file offline, rejects missing/empty/malformed
files, private keys, unsafe ownership/write permissions and files without CA
certificates. It records the selected path and current SHA-256 privately. Python
parsing is a format check only: it cannot prove libpq compatibility, certificate
validity periods, current server trust chain or hostname match. These remain
subject to libpq verify-full during a separately approved connection. Explicit
CA files are rechecked before every client launch. SSL_CERT_FILE/SSL_CERT_DIR
are removed from child environments so they cannot silently redirect trust.
No other process environment or file is changed.

Certificate, hostname, expiry and issuer failures stop after one client attempt;
raw diagnostics are never persisted. More specific fixed labels are available
when libpq's error identifies those cases. There is no retry or downgrade.

## Exact next Mac steps — OFFLINE only

1. In the browser, open **only** TEST project `nyavvwrsrxqfyhiygkgw` in Supabase.
   In Database Settings / SSL Configuration, use **Download certificate**.
   Do not change the SSL-enforcement toggle or any project settings.
   Save the unedited official CA file as:
   `~/Documents/ImInGolf-TEST-Installation/test-supabase-ca.crt`.
   The browser's dashboard download is not a database connection. If the option
   is absent, stop for Supabase guidance rather than obtaining an arbitrary CA.
2. Run this block in Terminal. It does not connect to any database:

```sh
cd ~/Downloads/imingolf-rollback &&
git switch improve-new-user-registration &&
git pull --ff-only origin improve-new-user-registration &&
python3 tools/test-beta/test_readonly_runner.py &&
python3 tools/test-beta/readonly_runner.py --offline \
  --ca-file "$HOME/Documents/ImInGolf-TEST-Installation/test-supabase-ca.crt"
```

Stop on failure. Do not overwrite the original backup/capture/rollback. Return the
non-sensitive report summary and confirm the certificate came from that TEST
project's official dashboard. Never share passwords or the service file.
An offline PASS does not prove TLS will succeed. Request approval before any
connection, retaining this same explicit CA option in a later reviewed command.
If verify-full still fails, stop; request supported chain/hostname guidance from
Supabase rather than weakening verification. No support message is sent here.

Tests use a fictional CA certificate with its private key discarded. They cover
valid/missing/invalid/unsafe CA input, CLI propagation and private hash evidence,
environment isolation, removed-file detection and single-attempt failure for
trust, expiry and hostname errors. No real server/CA trust has been tested.
