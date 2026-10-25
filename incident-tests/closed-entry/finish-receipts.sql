-- FICTIONAL ISOLATED CONTRACT ONLY. NOT a production/Supabase migration.
-- Requires prototype.sql, legacy-adapter.sql and legacy-finish-result.sql.
-- Reproduces the REPORTED PATTERN (two exception scopes + conflict-do-nothing),
-- not the actual private LIVE body or its as-yet-unverified business semantics.
CREATE TABLE iig_legacy_fixture.result_effects (
 group_id text NOT NULL REFERENCES iig_entry_prototype.groups(id), round_id text NOT NULL,
 before_snapshot jsonb NOT NULL, finished_snapshot jsonb NOT NULL,
 PRIMARY KEY(group_id,round_id)
);
CREATE TABLE iig_legacy_fixture.receipt_faults(group_id text PRIMARY KEY,fail_history boolean NOT NULL);
CREATE TABLE iig_legacy_fixture.transition_receipts(
 group_id text NOT NULL REFERENCES iig_entry_prototype.groups(id),request_id uuid NOT NULL,
 request_digest text NOT NULL,credential_hash text NOT NULL,outcome jsonb NOT NULL,
 PRIMARY KEY(group_id,request_id)
);
REVOKE ALL ON iig_legacy_fixture.result_effects,iig_legacy_fixture.receipt_faults,
 iig_legacy_fixture.transition_receipts FROM PUBLIC;

CREATE FUNCTION iig_legacy_fixture.contract_result_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.state->>'roundId' IS DISTINCT FROM OLD.state->>'roundId' THEN RETURN NEW; END IF;
 IF jsonb_array_length(coalesce(NEW.state->'history','[]'))=jsonb_array_length(coalesce(OLD.state->'history','[]'))+1
 OR jsonb_array_length(coalesce(NEW.state#>'{trip,rounds}','[]'))=jsonb_array_length(coalesce(OLD.state#>'{trip,rounds}','[]'))+1 THEN
  BEGIN
   BEGIN
    INSERT INTO iig_legacy_fixture.result_effects VALUES(OLD.id,OLD.state->>'roundId',OLD.state,NEW.state)
    ON CONFLICT(group_id,round_id) DO NOTHING;
    IF EXISTS(SELECT 1 FROM iig_legacy_fixture.receipt_faults WHERE group_id=OLD.id AND fail_history)
    THEN RAISE EXCEPTION 'FICTIONAL_HISTORY_FAILURE'; END IF;
   EXCEPTION WHEN unique_violation THEN RETURN NEW; END;
  EXCEPTION WHEN OTHERS THEN RETURN NEW; END;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER zz_contract_result AFTER UPDATE ON iig_legacy_fixture.tens_in_groups
FOR EACH ROW EXECUTE FUNCTION iig_legacy_fixture.contract_result_trigger();

CREATE FUNCTION iig_legacy_fixture.finish_once(p_pin text,expected_round text,expected_revision bigint,
 capability text,request_id uuid,finished_state jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE legacy iig_legacy_fixture.tens_in_groups; original jsonb; normalized jsonb;
 prior iig_legacy_fixture.transition_receipts; digest text; result jsonb; next_revision bigint;
BEGIN
 IF request_id IS NULL OR expected_round IS NULL OR expected_revision IS NULL OR finished_state IS NULL
 THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 SELECT * INTO legacy FROM iig_legacy_fixture.tens_in_groups WHERE group_pin=p_pin FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'GROUP_NOT_FOUND'; END IF;
 -- Current scope/expiry/revocation are checked BEFORE every replay or lookup.
 PERFORM iig_legacy_fixture.authorise_transition(legacy.id,capability,'finish');
 digest:=encode(sha256(convert_to(jsonb_build_object('operation','finish','group',legacy.id,
  'round',expected_round,'revision',expected_revision,'proposal',finished_state)::text,'UTF8')),'hex');
 SELECT * INTO prior FROM iig_legacy_fixture.transition_receipts r WHERE r.group_id=legacy.id AND r.request_id=finish_once.request_id;
 IF FOUND THEN
  IF prior.request_digest IS DISTINCT FROM digest OR prior.credential_hash IS DISTINCT FROM iig_legacy_fixture.token_hash(capability)
  THEN RAISE EXCEPTION 'REQUEST_ID_REUSED'; END IF;
  RETURN prior.outcome || '{"replayed":true}'::jsonb;
 END IF;
 SELECT state INTO original FROM iig_entry_prototype.groups WHERE id=legacy.id FOR UPDATE;
 next_revision:=iig_legacy_fixture.finish_with_result(p_pin,expected_round,expected_revision,capability,finished_state);
 normalized:=finished_state-'_entry_revision';
 -- Assertions belong OUTSIDE the legacy trigger's exception scopes. A success
 -- receipt must not certify a caught/rolled-back or conflicting result write.
 IF NOT EXISTS(SELECT 1 FROM iig_legacy_fixture.result_effects e WHERE e.group_id=legacy.id
   AND e.round_id=expected_round AND e.before_snapshot=original AND e.finished_snapshot=normalized)
 OR NOT EXISTS(SELECT 1 FROM iig_entry_prototype.archives a WHERE a.group_id=legacy.id
   AND a.round_id=expected_round AND a.snapshot=original)
 OR NOT EXISTS(SELECT 1 FROM iig_entry_prototype.groups g WHERE g.id=legacy.id AND g.phase='finished'
   AND g.closed AND g.revision=expected_revision+1 AND g.state=normalized)
 OR NOT EXISTS(SELECT 1 FROM iig_legacy_fixture.tens_in_groups l WHERE l.id=legacy.id AND l.state=normalized)
 THEN RAISE EXCEPTION 'RESULT_POSTCONDITION_FAILED'; END IF;
 result:=jsonb_build_object('ok',true,'groupId',legacy.id,'roundId',expected_round,
  'revision',next_revision,'requestId',request_id,'replayed',false);
 INSERT INTO iig_legacy_fixture.transition_receipts VALUES(legacy.id,request_id,digest,
   iig_legacy_fixture.token_hash(capability),result);
 RETURN result;
END $$;

CREATE FUNCTION iig_legacy_fixture.finish_receipt(p_pin text,capability text,request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE legacy iig_legacy_fixture.tens_in_groups; prior iig_legacy_fixture.transition_receipts;
BEGIN
 IF request_id IS NULL THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 SELECT * INTO legacy FROM iig_legacy_fixture.tens_in_groups WHERE group_pin=p_pin FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'GROUP_NOT_FOUND'; END IF;
 PERFORM iig_legacy_fixture.authorise_transition(legacy.id,capability,'finish');
 SELECT * INTO prior FROM iig_legacy_fixture.transition_receipts r WHERE r.group_id=legacy.id AND r.request_id=finish_receipt.request_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found'); END IF;
 IF prior.credential_hash IS DISTINCT FROM iig_legacy_fixture.token_hash(capability)
 THEN RAISE EXCEPTION 'ORGANISER_CAPABILITY_REQUIRED'; END IF;
 RETURN jsonb_build_object('status','committed','response',prior.outcome);
END $$;
REVOKE ALL ON FUNCTION iig_legacy_fixture.contract_result_trigger(),
 iig_legacy_fixture.finish_once(text,text,bigint,text,uuid,jsonb),
 iig_legacy_fixture.finish_receipt(text,text,uuid) FROM PUBLIC;
-- No automatic grants, credential issuance, extension install, public schema or
-- production side-effect assertion. Full result/ranking validation remains open.
