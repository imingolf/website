-- OFFLINE REVIEW CANDIDATE. Load after core.sql and validators.sql ONLY in fixtures.
-- Activating this central guard blocks unversioned legacy saves. NOT RELEASE READY.
CREATE FUNCTION iig_closed_entry.round_is_open(s jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE
 WHEN s->'roundOpen'='false'::jsonb THEN false
 WHEN s#>'{trip,completed}'='true'::jsonb AND coalesce(s#>'{trip,active}','false')<>'true'::jsonb THEN false
 WHEN s->'roundOpen'='true'::jsonb THEN true
 WHEN (s->'roundOpen' IS NULL OR s->'roundOpen'='null'::jsonb) AND jsonb_array_length(coalesce(s->'history','[]'))=0
  AND coalesce(btrim(s->>'course'),'')='' AND coalesce(btrim(s->>'date'),'')='' THEN false
 WHEN s->'history'->0 IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(s->'players','[]')) p
  WHERE p->'paid'='true'::jsonb OR (p->'stableford' IS NOT NULL AND p->'stableford'<>'null'::jsonb)
  OR (p->'netScore' IS NOT NULL AND p->'netScore'<>'null'::jsonb) OR p->'noReturn'='true'::jsonb)
  AND coalesce(s#>>'{history,0,course}','')=coalesce(s->>'course','')
  AND coalesce(s#>>'{history,0,date}','')=coalesce(s->>'date','') THEN false
 ELSE true END
$$;
CREATE FUNCTION iig_closed_entry.initialise(g text,s jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 INSERT INTO iig_closed_entry.rounds(group_id,phase,closed,entrant_ids)
 VALUES(g,CASE WHEN iig_closed_entry.round_is_open(s) THEN 'open' ELSE 'finished' END,
 iig_closed_entry.has_score(s),CASE WHEN iig_closed_entry.has_score(s) THEN (SELECT coalesce(jsonb_agg(p->'id'),'[]') FROM jsonb_array_elements(s->'players') p WHERE iig_closed_entry.eligible(s,p)) ELSE NULL END) ON CONFLICT(group_id) DO NOTHING;
 IF FOUND THEN PERFORM iig_closed_entry.reserve_identities(g,s);END IF;
END $$;
CREATE FUNCTION iig_closed_entry.envelope(g text) RETURNS jsonb
LANGUAGE sql SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('groupId',r.group_id,'roundId',r.round_id,'revision',r.revision,'phase',r.phase,'closed',r.closed,'entrantIds',r.entrant_ids)
 FROM iig_closed_entry.rounds r WHERE group_id=g $$;
CREATE FUNCTION iig_closed_entry.guard_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m iig_closed_entry.rounds; p iig_closed_entry.permits; g text;expected jsonb;selection integer;matched boolean:=false;person jsonb;prior_person jsonb;backup jsonb;submitted_team jsonb;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'PROTECTED_GROUP_DELETE_NOT_IMPLEMENTED'; END IF;
 IF NEW.id IS DISTINCT FROM OLD.id THEN RAISE EXCEPTION 'PROTECTED_GROUP_IDENTITY'; END IF;
 -- Preserve existing owner metadata-only updates and ordinary notification hooks.
 IF NEW.state IS NOT DISTINCT FROM OLD.state THEN RETURN NEW; END IF;
 g:=OLD.id::text;
 PERFORM iig_closed_entry.initialise(g,OLD.state);
 SELECT * INTO m FROM iig_closed_entry.rounds WHERE group_id=g FOR UPDATE;
 SELECT * INTO p FROM iig_closed_entry.permits WHERE backend=pg_backend_pid() AND group_id=g FOR UPDATE;
 IF NOT FOUND OR NOT p.available OR p.transaction_id<>pg_current_xact_id()::text OR p.expected_revision<>m.revision
 OR p.state_digest IS DISTINCT FROM iig_closed_entry.digest(NEW.state)
 THEN RAISE EXCEPTION 'VERSIONED_WRITE_REQUIRED'; END IF;
 UPDATE iig_closed_entry.permits SET available=false WHERE backend=p.backend AND group_id=g;
 IF p.operation IN ('join','members') THEN
  FOR person IN SELECT value FROM jsonb_array_elements(NEW.state->'players') LOOP
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(OLD.state->'players') existing WHERE existing->>'id'=person->>'id')
    AND EXISTS(SELECT 1 FROM iig_closed_entry.identity_ids WHERE group_id=g AND identity_id=person->>'id')
   THEN RAISE EXCEPTION 'MEMBER_ID_ALREADY_USED';END IF;
  END LOOP;
 END IF;
 IF p.operation IN ('save','member_attendance','member_score') THEN
  IF p.operation IN ('member_attendance','member_score') THEN
   IF m.phase<>'open' THEN RAISE EXCEPTION 'ROUND_NOT_OPEN';END IF;
   PERFORM iig_closed_entry.validate_member_update(OLD.state,NEW.state,p.operation,p.actor_id,m.closed,m.entrant_ids);
  ELSE
  IF m.closed AND m.entrant_ids IS NOT NULL THEN
   FOR person IN SELECT value FROM jsonb_array_elements(NEW.state->'players') LOOP
    SELECT value INTO prior_person FROM jsonb_array_elements(OLD.state->'players') x WHERE x->>'id'=person->>'id';
    IF NOT m.entrant_ids ? (person->>'id') AND
     iig_closed_entry.score_signature(person) IS DISTINCT FROM iig_closed_entry.score_signature(prior_person)
    THEN RAISE EXCEPTION 'INELIGIBLE_SCORER';END IF;
   END LOOP;
   FOR submitted_team IN SELECT value FROM jsonb_array_elements(coalesce(OLD.state#>'{trip,currentTeams}','[]')) LOOP
    IF NEW.state#>ARRAY['trip','currentTeamScores',submitted_team->>'id'] IS DISTINCT FROM OLD.state#>ARRAY['trip','currentTeamScores',submitted_team->>'id']
     AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(submitted_team->'playerIds') member WHERE NOT m.entrant_ids ? member)
    THEN RAISE EXCEPTION 'INELIGIBLE_PAIR';END IF;
   END LOOP;
  END IF;
  IF m.phase<>'open' THEN
   -- Harmless activity/side-data still needs a separately reviewed validator.
   IF (OLD.state-'lastActivityAt') IS DISTINCT FROM (NEW.state-'lastActivityAt') THEN RAISE EXCEPTION 'ROUND_NOT_OPEN';END IF;
  ELSE PERFORM iig_closed_entry.validate_snapshot(OLD.state,NEW.state,m.closed);END IF;
  END IF;
  UPDATE iig_closed_entry.rounds SET revision=revision+1,
   closed=closed OR iig_closed_entry.has_score(OLD.state) OR iig_closed_entry.has_score(NEW.state),
   entrant_ids=CASE WHEN entrant_ids IS NULL AND (iig_closed_entry.has_score(OLD.state) OR iig_closed_entry.has_score(NEW.state))
    THEN (SELECT coalesce(jsonb_agg(entry.value->'id'),'[]') FROM jsonb_array_elements(OLD.state->'players') entry(value) WHERE iig_closed_entry.eligible(OLD.state,entry.value)) ELSE entrant_ids END WHERE group_id=g;
 ELSIF p.operation='payment' THEN
  IF m.phase<>'open' THEN RAISE EXCEPTION 'ROUND_NOT_OPEN';END IF;
  PERFORM iig_closed_entry.validate_payment(OLD.state,NEW.state,m.closed OR iig_closed_entry.has_score(OLD.state),m.entrant_ids,p.actor_id);
  INSERT INTO iig_closed_entry.operation_audit VALUES(g,m.revision,p.operation,OLD.state);
  UPDATE iig_closed_entry.rounds SET revision=revision+1 WHERE group_id=g;
 ELSIF p.operation IN ('tripreturn','tripcancel','resetscores','resetpayments','deletelast','clearleague','deletepasttrip') THEN
  IF p.operation='resetpayments' AND (m.closed OR iig_closed_entry.has_score(OLD.state)) THEN RAISE EXCEPTION 'ENTRIES_CLOSED';END IF;
  IF p.operation='deletepasttrip' THEN
   FOR selection IN SELECT generate_series(0,jsonb_array_length(coalesce(OLD.state#>'{trip,pastTrips}','[]'))-1) LOOP
    expected:=iig_closed_entry.derive_operation(OLD.state,p.operation,selection);
    IF (expected-'lastActivityAt') IS NOT DISTINCT FROM (NEW.state-'lastActivityAt') THEN matched:=true;EXIT;END IF;
   END LOOP;
   IF NOT matched THEN RAISE EXCEPTION 'INVALID_TRIP_DELETION';END IF;
  ELSE
   expected:=iig_closed_entry.derive_operation(OLD.state,p.operation);
   IF p.operation IN ('tripreturn','tripcancel') THEN
    IF (expected-ARRAY['lastActivityAt','roundId']) IS DISTINCT FROM (NEW.state-ARRAY['lastActivityAt','roundId']) THEN RAISE EXCEPTION 'INVALID_TRIP_RESTORE';END IF;
   ELSIF (expected-'lastActivityAt') IS DISTINCT FROM (NEW.state-'lastActivityAt') THEN RAISE EXCEPTION 'INVALID_MAINTENANCE';END IF;
  END IF;
  INSERT INTO iig_closed_entry.operation_audit VALUES(g,m.revision,p.operation,OLD.state);
  IF p.operation IN ('tripreturn','tripcancel') THEN
   -- Legacy backups have no trusted private closure metadata. An open restored
   -- round stays closed to new entries; its existing entrants can score/finish.
   backup:=coalesce(nullif(OLD.state#>'{trip,normalRoundBackup}','null'),OLD.state#>'{trip,pastTrips,0,normalRoundBackup}');
   UPDATE iig_closed_entry.rounds SET revision=revision+1,round_id=gen_random_uuid(),closed=true,
    entrant_ids=(SELECT coalesce(jsonb_agg(entry.value->'id'),'[]') FROM jsonb_array_elements(NEW.state->'players') entry(value) WHERE iig_closed_entry.eligible(NEW.state,entry.value)
     AND EXISTS(SELECT 1 FROM jsonb_array_elements(backup->'players') saved WHERE saved->>'id'=entry.value->>'id')),
    phase=CASE WHEN iig_closed_entry.round_is_open(NEW.state) THEN 'open' ELSE 'finished' END WHERE group_id=g;
  ELSE UPDATE iig_closed_entry.rounds SET revision=revision+1,closed=closed OR iig_closed_entry.has_score(OLD.state) WHERE group_id=g;END IF;
 ELSIF p.operation='join' THEN
  IF (OLD.state-ARRAY['players','lastActivityAt']) IS DISTINCT FROM (NEW.state-ARRAY['players','lastActivityAt'])
   OR jsonb_array_length(NEW.state->'players')<>jsonb_array_length(OLD.state->'players')+1
   OR ((NEW.state->'players')-jsonb_array_length(OLD.state->'players')) IS DISTINCT FROM (OLD.state->'players')
  THEN RAISE EXCEPTION 'JOIN_MUST_ONLY_APPEND_UNENTERED_MEMBER';END IF;
  PERFORM iig_closed_entry.validate_players(OLD.state,NEW.state,true,NULL);
  UPDATE iig_closed_entry.rounds SET revision=revision+1 WHERE group_id=g;
 ELSIF p.operation IN ('members','profile') THEN
  PERFORM iig_closed_entry.validate_players(OLD.state,NEW.state,m.closed OR iig_closed_entry.has_score(OLD.state),p.actor_id,m.entrant_ids);
  INSERT INTO iig_closed_entry.operation_audit VALUES(g,m.revision,p.operation,OLD.state);
  IF p.operation='members' THEN
   UPDATE iig_closed_entry.member_credentials c SET revoked=true WHERE group_id=g
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.state->'players') remaining(value) WHERE remaining.value->>'id'=c.player_id);
  END IF;
  UPDATE iig_closed_entry.rounds SET revision=revision+1 WHERE group_id=g;
 ELSIF p.operation IN ('settle','claim') THEN
  PERFORM iig_closed_entry.validate_payout(OLD.state,NEW.state,p.actor_id);
  UPDATE iig_closed_entry.rounds SET revision=revision+1 WHERE group_id=g;
 ELSIF p.operation='sidegame' THEN
  PERFORM iig_closed_entry.validate_sidegame(OLD.state,NEW.state,p.actor_id);
  UPDATE iig_closed_entry.rounds SET revision=revision+1 WHERE group_id=g;
 ELSIF p.operation='configure' THEN
  IF m.phase<>'open' OR m.closed OR iig_closed_entry.has_score(OLD.state) THEN RAISE EXCEPTION 'ENTRIES_CLOSED';END IF;
  PERFORM iig_closed_entry.validate_configuration(OLD.state,NEW.state);
  INSERT INTO iig_closed_entry.operation_audit VALUES(g,m.revision,p.operation,OLD.state);
  UPDATE iig_closed_entry.rounds SET revision=revision+1 WHERE group_id=g;
 ELSIF p.operation='settings' THEN
  PERFORM iig_closed_entry.validate_settings(OLD.state,NEW.state);
  UPDATE iig_closed_entry.rounds SET revision=revision+1 WHERE group_id=g;
 ELSIF p.operation='correct' THEN
  IF m.phase<>'open' OR NOT m.closed THEN RAISE EXCEPTION 'NO_OPEN_SCORED_ROUND';END IF;
  PERFORM iig_closed_entry.validate_correction(OLD.state,NEW.state);
  UPDATE iig_closed_entry.rounds SET revision=revision+1,closed=true WHERE group_id=g;
 ELSIF p.operation='cancel' THEN
  IF m.phase<>'open' THEN RAISE EXCEPTION 'NO_OPEN_ROUND';END IF;
  PERFORM iig_closed_entry.validate_cancellation(OLD.state,NEW.state);
  INSERT INTO iig_closed_entry.archives VALUES(g,m.round_id,OLD.state);
  UPDATE iig_closed_entry.rounds SET phase='finished',closed=true,revision=revision+1 WHERE group_id=g;
 ELSIF p.operation='finish' THEN
  IF m.phase<>'open' OR NOT (m.closed OR iig_closed_entry.has_score(OLD.state)) THEN RAISE EXCEPTION 'NO_OPEN_SCORED_ROUND';END IF;
  IF OLD.state#>'{trip,active}'='true'::jsonb AND OLD.state#>>'{trip,currentFormat}' IN ('betterball','pairsaggregate') THEN
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(OLD.state#>'{trip,currentTeams}','[]')) team
    WHERE jsonb_array_length(team->'playerIds')=2 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(team->'playerIds') member WHERE NOT coalesce(m.entrant_ids,'[]') ? member)
    AND (OLD.state#>ARRAY['trip','currentTeamScores',team->>'id'] IS NULL OR OLD.state#>ARRAY['trip','currentTeamScores',team->>'id']='null'::jsonb))
   THEN RAISE EXCEPTION 'INCOMPLETE_ROUND';END IF;
  ELSE
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(OLD.state->'players') entered
    WHERE coalesce(m.entrant_ids,'[]') ? (entered->>'id') AND NOT iig_closed_entry.has_score(jsonb_build_object('players',jsonb_build_array(entered))))
   THEN RAISE EXCEPTION 'INCOMPLETE_ROUND';END IF;
  END IF;
  PERFORM iig_closed_entry.validate_finished_result(OLD.state,NEW.state);
  INSERT INTO iig_closed_entry.archives VALUES(g,m.round_id,OLD.state);
  UPDATE iig_closed_entry.rounds SET phase='finished',closed=true,revision=revision+1 WHERE group_id=g;
 ELSIF p.operation='start' THEN
  IF m.phase<>'finished' THEN RAISE EXCEPTION 'FINISH_CURRENT_ROUND_FIRST'; END IF;
  PERFORM iig_closed_entry.validate_setup(OLD.state,NEW.state);
  UPDATE iig_closed_entry.rounds SET phase='open',closed=false,entrant_ids=NULL,revision=revision+1,round_id=gen_random_uuid() WHERE group_id=g;
 ELSE RAISE EXCEPTION 'INVALID_OPERATION'; END IF;
 IF p.operation IN ('join','members') THEN
  INSERT INTO iig_closed_entry.identity_ids SELECT g,value->>'id' FROM jsonb_array_elements(NEW.state->'players') ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION public.iig_entry_prepare(p_pin text,p_group text,p_round uuid,p_revision bigint,
 p_operation text,p_credential text,p_selection integer DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE row public.tens_in_groups;m iig_closed_entry.rounds;proposal jsonb;
BEGIN
 IF p_operation IS NULL OR p_operation NOT IN ('tripreturn','tripcancel','resetscores','resetpayments','deletelast','clearleague','deletepasttrip')
 THEN RAISE EXCEPTION 'UNSUPPORTED_DERIVED_OPERATION';END IF;
 row:=iig_closed_entry.lock_group(p_pin);
 IF row.id::text IS DISTINCT FROM p_group THEN RAISE EXCEPTION 'GROUP_CHANGED';END IF;
 PERFORM iig_closed_entry.authorise(p_group,p_credential,p_operation);
 SELECT * INTO m FROM iig_closed_entry.rounds WHERE group_id=p_group;
 IF NOT FOUND OR m.round_id IS DISTINCT FROM p_round OR m.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'STALE_ROUND_OR_REVISION';END IF;
 IF p_operation='resetpayments' AND (m.closed OR iig_closed_entry.has_score(row.state)) THEN RAISE EXCEPTION 'ENTRIES_CLOSED';END IF;
 proposal:=iig_closed_entry.derive_operation(row.state,p_operation,p_selection);
 RETURN jsonb_build_object('context',iig_closed_entry.envelope(p_group),'state',proposal);
END $$;
CREATE TRIGGER iig_entry_before_write BEFORE UPDATE OR DELETE ON public.tens_in_groups
FOR EACH ROW EXECUTE FUNCTION iig_closed_entry.guard_row();

CREATE FUNCTION public.iig_entry_read(p_pin text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE row public.tens_in_groups;
BEGIN
 row:=iig_closed_entry.lock_group(p_pin);PERFORM iig_closed_entry.initialise(row.id::text,row.state);
 RETURN jsonb_build_object('context',iig_closed_entry.envelope(row.id::text),'state',row.state);
END $$;
CREATE FUNCTION public.iig_entry_check_credential(p_pin text,p_group text,p_credential text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE row public.tens_in_groups;
BEGIN
 row:=iig_closed_entry.lock_group(p_pin);
 IF row.id::text IS DISTINCT FROM p_group THEN RAISE EXCEPTION 'GROUP_CHANGED'; END IF;
 -- Both lifecycle rights currently required for this client; scoped RPCs also
 -- independently check each action. Separate limited-right UI is unfinished.
 PERFORM iig_closed_entry.authorise(p_group,p_credential,'finish');
 PERFORM iig_closed_entry.authorise(p_group,p_credential,'start');RETURN true;
END $$;
CREATE FUNCTION public.iig_entry_check_member(p_pin text,p_group text,p_credential text,p_scope text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE row public.tens_in_groups;actor text;
BEGIN
 row:=iig_closed_entry.lock_group(p_pin);
 IF row.id::text IS DISTINCT FROM p_group THEN RAISE EXCEPTION 'GROUP_CHANGED';END IF;
 actor:=iig_closed_entry.authorise_member(p_group,p_credential,p_scope);
 RETURN jsonb_build_object('playerId',actor);
END $$;
CREATE FUNCTION public.iig_entry_write(p_pin text,p_group text,p_round uuid,p_revision bigint,
 p_operation text,p_state jsonb,p_credential text,p_request uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE row public.tens_in_groups; m iig_closed_entry.rounds; prior iig_closed_entry.receipts;
 hashed text;credential_hash text;next_state jsonb;outcome jsonb;actor text;
BEGIN
 IF p_operation IS NULL OR p_operation NOT IN ('save','join','finish','start','correct','cancel','settings','members','settle','tripreturn','tripcancel','resetscores','resetpayments','deletelast','clearleague','deletepasttrip','configure','profile','sidegame','claim') OR p_round IS NULL OR p_revision IS NULL
 OR p_request IS NULL OR jsonb_typeof(p_state) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 row:=iig_closed_entry.lock_group(p_pin);
 IF row.id::text IS DISTINCT FROM p_group THEN RAISE EXCEPTION 'GROUP_CHANGED';END IF;
 IF p_operation IN ('profile','sidegame','claim') THEN
  actor:=iig_closed_entry.authorise_member(p_group,p_credential,p_operation);
  credential_hash:=iig_closed_entry.token_hash(p_credential);
 ELSIF p_operation NOT IN ('save','join') THEN
  PERFORM iig_closed_entry.authorise(p_group,p_credential,p_operation);
  credential_hash:=iig_closed_entry.token_hash(p_credential);
 END IF;
 hashed:=iig_closed_entry.digest(jsonb_build_object('group',p_group,'operation',p_operation,'round',p_round,'revision',p_revision,'state',p_state));
 SELECT * INTO prior FROM iig_closed_entry.receipts WHERE group_id=p_group AND request_id=p_request;
 IF FOUND THEN
  IF prior.digest IS DISTINCT FROM hashed OR prior.credential_hash IS DISTINCT FROM credential_hash
  THEN RAISE EXCEPTION 'REQUEST_ID_REUSED'; END IF;
  RETURN prior.outcome || '{"replayed":true}'::jsonb;
 END IF;
 PERFORM iig_closed_entry.initialise(p_group,row.state);
 SELECT * INTO m FROM iig_closed_entry.rounds WHERE group_id=p_group FOR UPDATE;
 IF m.round_id<>p_round OR m.revision<>p_revision THEN RAISE EXCEPTION 'STALE_ROUND_OR_REVISION'; END IF;
 IF p_operation<>'save' AND p_state IS NOT DISTINCT FROM row.state THEN RAISE EXCEPTION 'INVALID_TRANSITION';END IF;
 next_state:=p_state;
 IF p_operation IN ('start','tripreturn','tripcancel') THEN next_state:=jsonb_set(next_state,'{roundId}',to_jsonb(gen_random_uuid()::text)); END IF;
 INSERT INTO iig_closed_entry.permits VALUES(pg_backend_pid(),p_group,pg_current_xact_id()::text,p_operation,
  p_revision,iig_closed_entry.digest(next_state),true,actor)
 ON CONFLICT(backend,group_id) DO UPDATE SET transaction_id=excluded.transaction_id,operation=excluded.operation,
 expected_revision=excluded.expected_revision,state_digest=excluded.state_digest,available=true,actor_id=excluded.actor_id;
 UPDATE public.tens_in_groups SET state=next_state,updated_at=clock_timestamp() WHERE id=row.id;
 -- Existing AFTER hooks execute normally. No invented five-result ledger or
 -- duplicate League/payout calculations. Any downstream error aborts this RPC.
 IF next_state IS NOT DISTINCT FROM row.state THEN
  -- A no-op write must not leave an unused permit or fabricate a new revision.
  UPDATE iig_closed_entry.permits SET available=false WHERE backend=pg_backend_pid() AND group_id=p_group;
 END IF;
 SELECT * INTO m FROM iig_closed_entry.rounds WHERE group_id=p_group;
 IF EXISTS(SELECT 1 FROM iig_closed_entry.permits WHERE backend=pg_backend_pid() AND group_id=p_group AND available)
 THEN RAISE EXCEPTION 'UNCONSUMED_WRITE_PERMIT'; END IF;
 outcome:=iig_closed_entry.envelope(p_group)||jsonb_build_object('ok',true,'requestId',p_request,
  'applicationRoundId',next_state->'roundId','replayed',false);
 INSERT INTO iig_closed_entry.receipts VALUES(p_group,p_request,hashed,p_operation,credential_hash,outcome);
 RETURN outcome;
END $$;
CREATE FUNCTION public.iig_entry_receipt(p_pin text,p_group text,p_request uuid,p_credential text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE row public.tens_in_groups;r iig_closed_entry.receipts;
BEGIN
 row:=iig_closed_entry.lock_group(p_pin);
 IF row.id::text IS DISTINCT FROM p_group THEN RAISE EXCEPTION 'GROUP_CHANGED'; END IF;
 SELECT * INTO r FROM iig_closed_entry.receipts WHERE group_id=p_group AND request_id=p_request;
 IF NOT FOUND THEN RETURN '{"status":"not_found"}'::jsonb;END IF;
 IF r.operation IN ('profile','sidegame','claim') THEN
  PERFORM iig_closed_entry.authorise_member(p_group,p_credential,r.operation);
  IF r.credential_hash IS DISTINCT FROM iig_closed_entry.token_hash(p_credential) THEN RAISE EXCEPTION 'MEMBER_CREDENTIAL_REQUIRED';END IF;
 ELSIF r.operation NOT IN ('save','join') THEN
  PERFORM iig_closed_entry.authorise(p_group,p_credential,r.operation);
  IF r.credential_hash IS DISTINCT FROM iig_closed_entry.token_hash(p_credential) THEN RAISE EXCEPTION 'ORGANISER_CREDENTIAL_REQUIRED';END IF;
 END IF;
 RETURN jsonb_build_object('status','committed','response',r.outcome);
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA iig_closed_entry FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.iig_entry_prepare(text,text,uuid,bigint,text,text,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.iig_entry_prepare(text,text,uuid,bigint,text,text,integer) TO anon,authenticated;
REVOKE ALL ON FUNCTION public.iig_entry_check_member(text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.iig_entry_check_member(text,text,text,text) TO anon,authenticated;
REVOKE ALL ON FUNCTION public.iig_entry_read(text),public.iig_entry_check_credential(text,text,text),
 public.iig_entry_write(text,text,uuid,bigint,text,jsonb,text,uuid),public.iig_entry_receipt(text,text,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.iig_entry_read(text),public.iig_entry_check_credential(text,text,text),
 public.iig_entry_write(text,text,uuid,bigint,text,jsonb,text,uuid),public.iig_entry_receipt(text,text,uuid,text) TO anon,authenticated;
