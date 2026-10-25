-- FICTIONAL PATTERN MODEL ONLY. Never install into Supabase.
-- Requires finish-receipts.sql and its dependencies. These five domain mappings
-- are INVENTED fixture contracts, not the saved LIVE trigger's five INSERT paths.
CREATE TABLE iig_legacy_fixture.path_effects(
 group_id text NOT NULL REFERENCES iig_entry_prototype.groups(id),round_id text NOT NULL,
 path integer NOT NULL CHECK(path BETWEEN 1 AND 5),payload jsonb NOT NULL,
 PRIMARY KEY(group_id,round_id,path)
);
CREATE TABLE iig_legacy_fixture.path_faults(
 group_id text PRIMARY KEY,path integer NOT NULL CHECK(path BETWEEN 1 AND 5),
 mode text NOT NULL CHECK(mode IN ('return_new','fallthrough'))
);
REVOKE ALL ON iig_legacy_fixture.path_effects,iig_legacy_fixture.path_faults FROM PUBLIC;

CREATE FUNCTION iig_legacy_fixture.expected_paths(old_state jsonb,new_state jsonb)
RETURNS TABLE(path integer,payload jsonb) LANGUAGE sql SET search_path=pg_catalog AS $$
 WITH record AS (SELECT CASE WHEN old_state#>'{trip,active}'='true'::jsonb
  THEN new_state#>'{trip,rounds}'->(jsonb_array_length(new_state#>'{trip,rounds}')-1)
  ELSE new_state->'history'->0 END AS value)
 SELECT 1,coalesce(value,'null'::jsonb) FROM record
 UNION ALL SELECT 2,coalesce(old_state->'players','null'::jsonb) WHERE old_state->>'gameType'='money'
 UNION ALL SELECT 3,coalesce(new_state->'players','null'::jsonb) WHERE old_state->>'gameType'='points' AND coalesce(old_state#>'{trip,active}','false'::jsonb)<>'true'::jsonb
 UNION ALL SELECT 4,coalesce(new_state->'trip','null'::jsonb) WHERE old_state#>'{trip,active}'='true'::jsonb
 UNION ALL SELECT 5,coalesce(value->'payouts','null'::jsonb) FROM record WHERE old_state->>'gameType'='money'
$$;

CREATE FUNCTION iig_legacy_fixture.five_path_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE effect record; fault iig_legacy_fixture.path_faults;
BEGIN
 IF NEW.state->>'roundId' IS DISTINCT FROM OLD.state->>'roundId' THEN RETURN NEW; END IF;
 IF NOT (jsonb_array_length(coalesce(NEW.state->'history','[]'))=jsonb_array_length(coalesce(OLD.state->'history','[]'))+1
 OR jsonb_array_length(coalesce(NEW.state#>'{trip,rounds}','[]'))=jsonb_array_length(coalesce(OLD.state#>'{trip,rounds}','[]'))+1)
 THEN RETURN NEW; END IF;
 SELECT * INTO fault FROM iig_legacy_fixture.path_faults WHERE group_id=OLD.id;
 BEGIN
  FOR effect IN SELECT * FROM iig_legacy_fixture.expected_paths(OLD.state,NEW.state) ORDER BY path LOOP
   BEGIN
    INSERT INTO iig_legacy_fixture.path_effects VALUES(OLD.id,OLD.state->>'roundId',effect.path,effect.payload)
    ON CONFLICT(group_id,round_id,path) DO NOTHING;
    IF fault.path=effect.path THEN
     IF fault.mode='return_new' THEN RAISE unique_violation;
     ELSE RAISE EXCEPTION 'FICTIONAL_PATH_FAILURE'; END IF;
    END IF;
   EXCEPTION WHEN unique_violation THEN RETURN NEW; END;
  END LOOP;
 EXCEPTION WHEN OTHERS THEN NULL; END;
 RETURN NEW;
END $$;
CREATE TRIGGER zzz_five_path_contract AFTER UPDATE ON iig_legacy_fixture.tens_in_groups
FOR EACH ROW EXECUTE FUNCTION iig_legacy_fixture.five_path_trigger();

CREATE FUNCTION iig_legacy_fixture.finish_five_once(p_pin text,expected_round text,expected_revision bigint,
 capability text,request_id uuid,finished_state jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb; g text; old_state jsonb;
BEGIN
 -- The inner function acquires the existing group lock and verifies authority.
 -- Every subsequent assertion stays outside both trigger exception handlers.
 result:=iig_legacy_fixture.finish_once(p_pin,expected_round,expected_revision,capability,request_id,finished_state);
 g:=result->>'groupId';
 SELECT snapshot INTO old_state FROM iig_entry_prototype.archives WHERE group_id=g AND round_id=expected_round;
 IF old_state IS NULL OR EXISTS(
   SELECT 1 FROM iig_legacy_fixture.expected_paths(old_state,finished_state-'_entry_revision') e
   LEFT JOIN iig_legacy_fixture.path_effects p ON p.group_id=g AND p.round_id=expected_round AND p.path=e.path
   WHERE p.payload IS DISTINCT FROM e.payload)
 THEN RAISE EXCEPTION 'PATH_POSTCONDITION_FAILED'; END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION iig_legacy_fixture.expected_paths(jsonb,jsonb),
 iig_legacy_fixture.five_path_trigger(),iig_legacy_fixture.finish_five_once(text,text,bigint,text,uuid,jsonb) FROM PUBLIC;
