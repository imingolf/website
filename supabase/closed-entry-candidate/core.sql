-- OFFLINE REVIEW CANDIDATE ONLY. NOT an installation/migration script.
-- Tested ONLY in fresh fictional databases. Resolver is deliberately unbound.
-- Expected root composite: public.tens_in_groups with id, state, updated_at.
-- Do not install: exact baseline/resolver, operation coverage and rollback gates open.
CREATE SCHEMA iig_closed_entry;
REVOKE ALL ON SCHEMA iig_closed_entry FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE iig_closed_entry.rounds(
 group_id text PRIMARY KEY,round_id uuid NOT NULL DEFAULT gen_random_uuid(),revision bigint NOT NULL DEFAULT 0,
 phase text NOT NULL CHECK(phase IN ('open','finished')),closed boolean NOT NULL,entrant_ids jsonb
);
CREATE TABLE iig_closed_entry.credentials(
 group_id text NOT NULL,token_hash text NOT NULL,expires_at timestamptz NOT NULL,revoked boolean NOT NULL DEFAULT false,
 scopes text[] NOT NULL CHECK(scopes <@ ARRAY['finish','start','correct','cancel','settings','members','settle','tripreturn','tripcancel','resetscores','resetpayments','deletelast','clearleague','deletepasttrip','configure']::text[] AND cardinality(scopes)>0),
 PRIMARY KEY(group_id,token_hash)
);
CREATE TABLE iig_closed_entry.permits(
 backend integer NOT NULL,group_id text NOT NULL,transaction_id text NOT NULL,
 operation text NOT NULL CHECK(operation IN ('save','join','finish','start','correct','cancel','settings','members','settle','tripreturn','tripcancel','resetscores','resetpayments','deletelast','clearleague','deletepasttrip','configure','profile','sidegame','claim','payment','member_attendance','member_score')),expected_revision bigint NOT NULL,
 state_digest text NOT NULL,available boolean NOT NULL,actor_id text,PRIMARY KEY(backend,group_id)
);
CREATE TABLE iig_closed_entry.receipts(
 group_id text NOT NULL,request_id uuid NOT NULL,digest text NOT NULL,operation text NOT NULL,
 credential_hash text,outcome jsonb NOT NULL,PRIMARY KEY(group_id,request_id)
);
CREATE TABLE iig_closed_entry.archives(
 group_id text NOT NULL,round_id uuid NOT NULL,state jsonb NOT NULL,PRIMARY KEY(group_id,round_id)
);
ALTER TABLE iig_closed_entry.rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE iig_closed_entry.credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE iig_closed_entry.permits ENABLE ROW LEVEL SECURITY;
ALTER TABLE iig_closed_entry.receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE iig_closed_entry.archives ENABLE ROW LEVEL SECURITY;
CREATE TABLE iig_closed_entry.member_credentials(
 group_id text NOT NULL,player_id text NOT NULL,token_hash text NOT NULL,
 expires_at timestamptz NOT NULL,revoked boolean NOT NULL DEFAULT false,
 scopes text[] NOT NULL CHECK(scopes <@ ARRAY['profile','sidegame','claim']::text[] AND cardinality(scopes)>0),
 PRIMARY KEY(group_id,token_hash)
);
ALTER TABLE iig_closed_entry.member_credentials ENABLE ROW LEVEL SECURITY;
CREATE TABLE iig_closed_entry.operation_audit(
 group_id text NOT NULL,revision bigint NOT NULL,operation text NOT NULL,state jsonb NOT NULL,
 PRIMARY KEY(group_id,revision)
);
ALTER TABLE iig_closed_entry.operation_audit ENABLE ROW LEVEL SECURITY;
CREATE TABLE iig_closed_entry.identity_ids(group_id text NOT NULL,identity_id text NOT NULL,PRIMARY KEY(group_id,identity_id));
ALTER TABLE iig_closed_entry.identity_ids ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA iig_closed_entry FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION iig_closed_entry.digest(value jsonb) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT encode(sha256(convert_to(value::text,'UTF8')),'hex') $$;
CREATE FUNCTION iig_closed_entry.token_hash(token text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT encode(sha256(convert_to(token,'UTF8')),'hex') $$;
-- IDs are opaque and never reissued. Include saved historical recipients, not
-- current names, so a deleted winner's ID cannot be reused to claim an old prize.
CREATE FUNCTION iig_closed_entry.reserve_identities(g text,s jsonb) RETURNS void
LANGUAGE sql SET search_path=pg_catalog AS $$
 INSERT INTO iig_closed_entry.identity_ids
 SELECT g,value#>>'{}' FROM (
  SELECT value FROM jsonb_path_query(s,'$.**.id') q(value)
  UNION SELECT value FROM jsonb_path_query(s,'$.**.winnerPlayerId') q(value)
  UNION SELECT value FROM jsonb_path_query(s,'$.**.playerId') q(value)
  UNION SELECT value FROM jsonb_path_query(s,'$.**.playerIds[*]') q(value)
 ) ids(value) WHERE jsonb_typeof(value)='string' AND value#>>'{}'<>'' ON CONFLICT DO NOTHING $$;
CREATE FUNCTION iig_closed_entry.resolve_pin(p_pin text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'PIN_RESOLVER_NOT_BOUND'; END $$;
-- No guess at LIVE PIN hashing/search_path/filters. Fixture supplies its OWN resolver.
-- The authenticated TEST adapter replaces this hook. Its owned groups must never
-- be readable/writable through the shared-PIN/capability API.
CREATE FUNCTION iig_closed_entry.require_legacy_group(g text) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF to_regclass('iig_private.group_owners') IS NOT NULL THEN
  RAISE EXCEPTION 'AUTHENTICATED_ADAPTER_REQUIRED';
 END IF;
END $$;
CREATE FUNCTION iig_closed_entry.lock_group(p_pin text) RETURNS public.tens_in_groups
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE g text; row public.tens_in_groups;
BEGIN
 g:=iig_closed_entry.resolve_pin(p_pin);
 SELECT * INTO row FROM public.tens_in_groups WHERE id::text=g FOR UPDATE;
 IF NOT FOUND OR iig_closed_entry.resolve_pin(p_pin) IS DISTINCT FROM g THEN RAISE EXCEPTION 'GROUP_NOT_FOUND'; END IF;
 PERFORM iig_closed_entry.require_legacy_group(g); RETURN row;
END $$;
CREATE FUNCTION iig_closed_entry.authorise(g text,token text,scope text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE cap iig_closed_entry.credentials;
BEGIN
 IF scope IS NULL OR scope NOT IN ('finish','start','correct','cancel','settings','members','settle','tripreturn','tripcancel','resetscores','resetpayments','deletelast','clearleague','deletepasttrip','configure') OR token IS NULL OR token !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'ORGANISER_CREDENTIAL_REQUIRED'; END IF;
 SELECT * INTO cap FROM iig_closed_entry.credentials WHERE group_id=g AND token_hash=iig_closed_entry.token_hash(token) FOR SHARE;
 IF NOT FOUND OR cap.revoked OR cap.expires_at<=clock_timestamp() OR NOT scope=ANY(cap.scopes)
 THEN RAISE EXCEPTION 'ORGANISER_CREDENTIAL_REQUIRED'; END IF;
END $$;
-- Provision/revoke are intentionally NOT Data API RPCs. Only trusted deployment
-- operator may call after independent organiser verification. No shared PIN/Admin
-- JSON/global creation code may authorise issuance. Tokens generated with CSPRNG.
CREATE FUNCTION iig_closed_entry.provision(g text,token text,expiry timestamptz,permissions text[]) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF token IS NULL OR token !~ '^[a-f0-9]{64}$' OR expiry IS NULL OR expiry<=clock_timestamp()
 OR expiry>clock_timestamp()+interval '90 days' THEN RAISE EXCEPTION 'INVALID_CREDENTIAL'; END IF;
 PERFORM 1 FROM public.tens_in_groups WHERE id::text=g FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'GROUP_NOT_FOUND'; END IF;
 INSERT INTO iig_closed_entry.credentials VALUES(g,iig_closed_entry.token_hash(token),expiry,false,permissions);
END $$;
CREATE FUNCTION iig_closed_entry.revoke(g text,token text) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN PERFORM 1 FROM public.tens_in_groups WHERE id::text=g FOR UPDATE;
 UPDATE iig_closed_entry.credentials SET revoked=true WHERE group_id=g AND token_hash=iig_closed_entry.token_hash(token);END $$;
-- Independent player verification/delivery is required before an operator uses
-- this helper. Selecting a player name/group PIN is never proof of identity.
CREATE FUNCTION iig_closed_entry.provision_member(g text,player text,token text,expiry timestamptz,permissions text[])
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE s jsonb;
BEGIN
 SELECT state INTO s FROM public.tens_in_groups WHERE id::text=g FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'GROUP_NOT_FOUND';END IF;
 IF token IS NULL OR token !~ '^[a-f0-9]{64}$' OR expiry IS NULL OR expiry<=clock_timestamp()
 OR expiry>clock_timestamp()+interval '90 days'
 OR (SELECT count(*) FROM jsonb_array_elements(s->'players') p WHERE p->>'id'=player)<>1
 THEN RAISE EXCEPTION 'INVALID_MEMBER_CREDENTIAL';END IF;
 INSERT INTO iig_closed_entry.member_credentials VALUES(g,player,iig_closed_entry.token_hash(token),expiry,false,permissions);
END $$;
CREATE FUNCTION iig_closed_entry.authorise_member(g text,token text,scope text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE cap iig_closed_entry.member_credentials;
BEGIN
 IF scope IS NULL OR scope NOT IN ('profile','sidegame','claim') OR token IS NULL OR token !~ '^[a-f0-9]{64}$'
 THEN RAISE EXCEPTION 'MEMBER_CREDENTIAL_REQUIRED';END IF;
 SELECT * INTO cap FROM iig_closed_entry.member_credentials WHERE group_id=g AND token_hash=iig_closed_entry.token_hash(token) FOR SHARE;
 IF NOT FOUND OR cap.revoked OR cap.expires_at<=clock_timestamp() OR NOT scope=ANY(cap.scopes)
 OR (SELECT count(*) FROM public.tens_in_groups t CROSS JOIN LATERAL jsonb_array_elements(t.state->'players') p
     WHERE t.id::text=g AND p->>'id'=cap.player_id)<>1
 THEN RAISE EXCEPTION 'MEMBER_CREDENTIAL_REQUIRED';END IF;
 RETURN cap.player_id;
END $$;
CREATE FUNCTION iig_closed_entry.revoke_member(g text,token text) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN PERFORM 1 FROM public.tens_in_groups WHERE id::text=g FOR UPDATE;
 UPDATE iig_closed_entry.member_credentials SET revoked=true WHERE group_id=g AND token_hash=iig_closed_entry.token_hash(token);
END $$;
CREATE FUNCTION iig_closed_entry.replace_member_credentials(g text,player text,expected_hashes text[],
 new_token text,expiry timestamptz,permissions text[]) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE observed text[];expected text[];
BEGIN
 PERFORM 1 FROM public.tens_in_groups WHERE id::text=g FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'GROUP_NOT_FOUND';END IF;
 IF expected_hashes IS NULL OR EXISTS(SELECT 1 FROM unnest(expected_hashes) x WHERE x IS NULL OR x !~ '^[a-f0-9]{64}$')
 THEN RAISE EXCEPTION 'INVALID_CREDENTIAL_SNAPSHOT';END IF;
 SELECT coalesce(array_agg(x ORDER BY x),ARRAY[]::text[]) INTO expected FROM unnest(expected_hashes) x;
 SELECT coalesce(array_agg(token_hash ORDER BY token_hash),ARRAY[]::text[]) INTO observed
 FROM iig_closed_entry.member_credentials WHERE group_id=g AND player_id=player AND NOT revoked;
 IF expected IS DISTINCT FROM observed THEN RAISE EXCEPTION 'CREDENTIAL_SET_CHANGED';END IF;
 PERFORM iig_closed_entry.provision_member(g,player,new_token,expiry,permissions);
 UPDATE iig_closed_entry.member_credentials SET revoked=true WHERE group_id=g AND player_id=player AND token_hash<>iig_closed_entry.token_hash(new_token);
END $$;
-- Trusted operator ONLY, after independent group-organiser verification. The
-- expected set is compare-and-swap evidence, NOT proof of organiser identity.
-- Used for rotation/lost-device recovery; retains revoked rows and old receipts.
-- No public RPC, shared-PIN issuance or browser recovery bypass is introduced.
CREATE FUNCTION iig_closed_entry.replace_credentials(g text,expected_hashes text[],
 new_token text,expiry timestamptz,permissions text[]) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE observed text[]; expected text[];
BEGIN
 PERFORM 1 FROM public.tens_in_groups WHERE id::text=g FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'GROUP_NOT_FOUND';END IF;
 IF expected_hashes IS NULL OR EXISTS(SELECT 1 FROM unnest(expected_hashes) x WHERE x IS NULL OR x !~ '^[a-f0-9]{64}$')
 THEN RAISE EXCEPTION 'INVALID_CREDENTIAL_SNAPSHOT';END IF;
 SELECT coalesce(array_agg(x ORDER BY x),ARRAY[]::text[]) INTO expected FROM unnest(expected_hashes) x;
 SELECT coalesce(array_agg(token_hash ORDER BY token_hash),ARRAY[]::text[]) INTO observed
  FROM iig_closed_entry.credentials WHERE group_id=g AND NOT revoked;
 IF expected IS DISTINCT FROM observed THEN RAISE EXCEPTION 'CREDENTIAL_SET_CHANGED';END IF;
 -- Provision first: invalid/duplicate credentials abort without revoking anything.
 PERFORM iig_closed_entry.provision(g,new_token,expiry,permissions);
 UPDATE iig_closed_entry.credentials SET revoked=true WHERE group_id=g AND token_hash<>iig_closed_entry.token_hash(new_token);
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA iig_closed_entry FROM PUBLIC,anon,authenticated,service_role;
