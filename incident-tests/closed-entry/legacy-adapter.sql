-- FICTIONAL LEGACY ADAPTER ONLY: no public/Auth schema, real groups or live RPCs.
-- Apply ONLY after prototype.sql in an isolated test database.
CREATE SCHEMA iig_legacy_fixture;
REVOKE ALL ON SCHEMA iig_legacy_fixture FROM PUBLIC;
CREATE TABLE iig_legacy_fixture.tens_in_groups(
 id text PRIMARY KEY REFERENCES iig_entry_prototype.groups(id),
 group_pin text UNIQUE NOT NULL, state jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE iig_legacy_fixture.organiser_capabilities(
 group_id text NOT NULL REFERENCES iig_entry_prototype.groups(id), token_hash text NOT NULL,
 expires_at timestamptz NOT NULL, revoked boolean NOT NULL DEFAULT false,
 permissions text[] NOT NULL CHECK (permissions <@ ARRAY['finish','start']::text[] AND cardinality(permissions)>0),
 PRIMARY KEY(group_id,token_hash)
);
-- Deliberately synthetic trigger side effects, NOT the captured LIVE definitions.
CREATE TABLE iig_legacy_fixture.history_payment_events(
 group_id text NOT NULL, round_id text NOT NULL, phase text NOT NULL, pot numeric NOT NULL,
 PRIMARY KEY(group_id,round_id,phase,pot)
);
CREATE TABLE iig_legacy_fixture.enabled_status(group_id text PRIMARY KEY,enabled boolean NOT NULL);
REVOKE ALL ON ALL TABLES IN SCHEMA iig_legacy_fixture FROM PUBLIC;

CREATE FUNCTION iig_legacy_fixture.token_hash(token text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT encode(sha256(convert_to(token,'UTF8')),'hex')
$$;
CREATE FUNCTION iig_legacy_fixture.authorise_transition(g text,token text,permission text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE cap iig_legacy_fixture.organiser_capabilities;
BEGIN
 IF token IS NULL OR token !~ '^[a-f0-9]{64}$' OR permission NOT IN ('finish','start') OR permission IS NULL
 THEN RAISE EXCEPTION 'ORGANISER_CAPABILITY_REQUIRED'; END IF;
 SELECT * INTO cap FROM iig_legacy_fixture.organiser_capabilities
 WHERE group_id=g AND token_hash=iig_legacy_fixture.token_hash(token) FOR SHARE;
 IF NOT FOUND OR cap.revoked OR cap.expires_at<=clock_timestamp() OR NOT permission=ANY(cap.permissions)
 THEN RAISE EXCEPTION 'ORGANISER_CAPABILITY_REQUIRED'; END IF;
END $$;

CREATE FUNCTION iig_legacy_fixture.guard_projection() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE canonical jsonb;
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.group_pin IS DISTINCT FROM OLD.group_pin THEN
   RAISE EXCEPTION 'PROTECTED_GROUP_IDENTITY'; END IF;
 SELECT state INTO canonical FROM iig_entry_prototype.groups WHERE id=OLD.id FOR UPDATE;
 IF NOT FOUND OR canonical IS DISTINCT FROM NEW.state THEN RAISE EXCEPTION 'USE_GUARDED_SAVE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER a_guard_projection BEFORE UPDATE ON iig_legacy_fixture.tens_in_groups
FOR EACH ROW EXECUTE FUNCTION iig_legacy_fixture.guard_projection();

CREATE FUNCTION iig_legacy_fixture.fixture_history_payment_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE phase text; pot numeric;
BEGIN
 phase:=CASE WHEN NEW.state->'roundOpen'='true'::jsonb THEN 'open' ELSE 'finished' END;
 SELECT count(*)*(NEW.state->>'stake')::numeric INTO pot
 FROM jsonb_array_elements(NEW.state->'players') p WHERE p->'paid'='true'::jsonb;
 INSERT INTO iig_legacy_fixture.history_payment_events VALUES(NEW.id,NEW.state->>'roundId',phase,pot)
 ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
CREATE TRIGGER b_fixture_history_payment AFTER UPDATE ON iig_legacy_fixture.tens_in_groups
FOR EACH ROW EXECUTE FUNCTION iig_legacy_fixture.fixture_history_payment_trigger();
CREATE FUNCTION iig_legacy_fixture.fixture_enabled_status_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 INSERT INTO iig_legacy_fixture.enabled_status VALUES(NEW.id,NEW.state->'roundOpen'='true'::jsonb)
 ON CONFLICT(group_id) DO UPDATE SET enabled=excluded.enabled;
 RETURN NEW;
END $$;
CREATE TRIGGER c_fixture_enabled_status AFTER UPDATE ON iig_legacy_fixture.tens_in_groups
FOR EACH ROW EXECUTE FUNCTION iig_legacy_fixture.fixture_enabled_status_trigger();

CREATE FUNCTION iig_legacy_fixture.get_group_state(p_pin text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE g text; state jsonb; rev bigint;
BEGIN
 SELECT id INTO g FROM iig_legacy_fixture.tens_in_groups WHERE group_pin=p_pin;
 IF NOT FOUND THEN RAISE EXCEPTION 'GROUP_NOT_FOUND'; END IF;
 PERFORM iig_entry_prototype.actor(g);
 SELECT x.state,x.revision INTO state,rev FROM iig_entry_prototype.groups x WHERE id=g;
 RETURN state || jsonb_build_object('_entry_revision',rev);
END $$;

CREATE FUNCTION iig_legacy_fixture.save_group_state(p_pin text,p_state jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE row iig_legacy_fixture.tens_in_groups; rev bigint;
BEGIN
 -- Lock order is always legacy group row, then protected metadata row.
 SELECT * INTO row FROM iig_legacy_fixture.tens_in_groups WHERE group_pin=p_pin FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'GROUP_NOT_FOUND'; END IF;
 IF p_state->>'_entry_revision' IS NULL OR p_state->>'_entry_revision' !~ '^[0-9]+$'
 THEN RAISE EXCEPTION 'RELOAD_VERSIONED_STATE'; END IF;
 rev:=(p_state->>'_entry_revision')::bigint;
 PERFORM iig_entry_prototype.save(row.id,p_state->>'roundId',rev,p_state-'_entry_revision');
 UPDATE iig_legacy_fixture.tens_in_groups SET state=(SELECT state FROM iig_entry_prototype.groups WHERE id=row.id),
 updated_at=clock_timestamp() WHERE id=row.id;
 RETURN true;
END $$;

CREATE FUNCTION iig_legacy_fixture.finish_round(p_pin text,expected_round text,expected_revision bigint,capability text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE legacy iig_legacy_fixture.tens_in_groups; meta iig_entry_prototype.groups;
BEGIN
 SELECT * INTO legacy FROM iig_legacy_fixture.tens_in_groups WHERE group_pin=p_pin FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'GROUP_NOT_FOUND'; END IF;
 PERFORM iig_legacy_fixture.authorise_transition(legacy.id,capability,'finish');
 SELECT * INTO meta FROM iig_entry_prototype.groups WHERE id=legacy.id FOR UPDATE;
 IF expected_round IS NULL OR expected_revision IS NULL OR meta.phase<>'open' OR meta.revision<>expected_revision
    OR meta.state->>'roundId' IS DISTINCT FROM expected_round THEN RAISE EXCEPTION 'STALE_ROUND_OR_REVISION'; END IF;
 IF NOT (meta.closed OR iig_entry_prototype.has_score(meta.state)) THEN RAISE EXCEPTION 'NO_SUBMITTED_SCORE'; END IF;
 INSERT INTO iig_entry_prototype.archives VALUES(legacy.id,expected_round,meta.state);
 -- Exact archive retained; this prototype does NOT calculate League/payout results.
 UPDATE iig_entry_prototype.groups SET phase='finished',closed=true,revision=revision+1,
 state=jsonb_set(state,'{roundOpen}','false'::jsonb) WHERE id=legacy.id;
 UPDATE iig_legacy_fixture.tens_in_groups SET state=(SELECT state FROM iig_entry_prototype.groups WHERE id=legacy.id)
 WHERE id=legacy.id;
 RETURN expected_revision+1;
END $$;

CREATE FUNCTION iig_legacy_fixture.start_round(p_pin text,expected_round text,expected_revision bigint,capability text,
 course text,round_date text,stake numeric,format text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE legacy iig_legacy_fixture.tens_in_groups; meta iig_entry_prototype.groups; players jsonb; next_id text;
BEGIN
 SELECT * INTO legacy FROM iig_legacy_fixture.tens_in_groups WHERE group_pin=p_pin FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'GROUP_NOT_FOUND'; END IF;
 PERFORM iig_legacy_fixture.authorise_transition(legacy.id,capability,'start');
 SELECT * INTO meta FROM iig_entry_prototype.groups WHERE id=legacy.id FOR UPDATE;
 IF expected_round IS NULL OR expected_revision IS NULL OR meta.phase<>'finished' OR meta.revision<>expected_revision
    OR meta.state->>'roundId' IS DISTINCT FROM expected_round THEN RAISE EXCEPTION 'STALE_ROUND_OR_REVISION'; END IF;
 IF meta.state#>'{trip,active}'='true'::jsonb THEN RAISE EXCEPTION 'TRIP_TRANSITION_REQUIRES_ADAPTER'; END IF;
 IF stake IS NULL OR stake<0 OR stake::text IN ('NaN','Infinity','-Infinity') OR format IS NULL OR format NOT IN ('stableford','net')
    OR coalesce(btrim(course),'')='' OR coalesce(btrim(round_date),'')='' THEN RAISE EXCEPTION 'INVALID_SETUP'; END IF;
 SELECT jsonb_agg((p-ARRAY['paymentMarkedAt','paymentMarkMethod']) ||
   '{"paid":false,"playingThisRound":false,"stableford":null,"netScore":null,"noReturn":false,"scoreSubmitted":false}'::jsonb)
 INTO players FROM jsonb_array_elements(meta.state->'players') p;
 next_id:=gen_random_uuid()::text;
 UPDATE iig_entry_prototype.groups SET phase='open',closed=false,revision=revision+1,
 state=jsonb_set(meta.state,'{players}',coalesce(players,'[]'::jsonb)) || jsonb_build_object('roundId',next_id,
 'roundOpen',true,'course',course,'date',round_date,'stake',stake,'pointsCompetition',format)
 WHERE id=legacy.id;
 UPDATE iig_legacy_fixture.tens_in_groups SET state=(SELECT state FROM iig_entry_prototype.groups WHERE id=legacy.id)
 WHERE id=legacy.id;
 RETURN jsonb_build_object('roundId',next_id,'revision',expected_revision+1);
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA iig_legacy_fixture FROM PUBLIC;
-- No PUBLIC/anon/authenticated/service_role grants; no credential issuance API.
