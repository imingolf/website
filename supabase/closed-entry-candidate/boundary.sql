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
 INSERT INTO iig_closed_entry.rounds(group_id,phase,closed)
 VALUES(g,CASE WHEN iig_closed_entry.round_is_open(s) THEN 'open' ELSE 'finished' END,
 iig_closed_entry.has_score(s)) ON CONFLICT(group_id) DO NOTHING;
END $$;
CREATE FUNCTION iig_closed_entry.envelope(g text) RETURNS jsonb
LANGUAGE sql SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('groupId',r.group_id,'roundId',r.round_id,'revision',r.revision,'phase',r.phase,'closed',r.closed)
 FROM iig_closed_entry.rounds r WHERE group_id=g $$;
CREATE FUNCTION iig_closed_entry.guard_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m iig_closed_entry.rounds; p iig_closed_entry.permits; g text;
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
 IF p.operation='save' THEN
  IF m.phase<>'open' THEN
   -- Harmless activity/side-data still needs a separately reviewed validator.
   IF (OLD.state-'lastActivityAt') IS DISTINCT FROM (NEW.state-'lastActivityAt') THEN RAISE EXCEPTION 'ROUND_NOT_OPEN';END IF;
  ELSE PERFORM iig_closed_entry.validate_snapshot(OLD.state,NEW.state,m.closed);END IF;
  UPDATE iig_closed_entry.rounds SET revision=revision+1,
   closed=closed OR iig_closed_entry.has_score(OLD.state) OR iig_closed_entry.has_score(NEW.state) WHERE group_id=g;
 ELSIF p.operation='finish' THEN
  IF m.phase<>'open' OR NOT (m.closed OR iig_closed_entry.has_score(OLD.state)) THEN RAISE EXCEPTION 'NO_OPEN_SCORED_ROUND';END IF;
  PERFORM iig_closed_entry.validate_finished_result(OLD.state,NEW.state);
  INSERT INTO iig_closed_entry.archives VALUES(g,m.round_id,OLD.state);
  UPDATE iig_closed_entry.rounds SET phase='finished',closed=true,revision=revision+1 WHERE group_id=g;
 ELSIF p.operation='start' THEN
  IF m.phase<>'finished' THEN RAISE EXCEPTION 'FINISH_CURRENT_ROUND_FIRST'; END IF;
  PERFORM iig_closed_entry.validate_setup(OLD.state,NEW.state);
  UPDATE iig_closed_entry.rounds SET phase='open',closed=false,revision=revision+1,round_id=gen_random_uuid() WHERE group_id=g;
 ELSE RAISE EXCEPTION 'INVALID_OPERATION'; END IF;
 RETURN NEW;
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
CREATE FUNCTION public.iig_entry_write(p_pin text,p_group text,p_round uuid,p_revision bigint,
 p_operation text,p_state jsonb,p_credential text,p_request uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE row public.tens_in_groups; m iig_closed_entry.rounds; prior iig_closed_entry.receipts;
 hashed text;credential_hash text;next_state jsonb;outcome jsonb;
BEGIN
 IF p_operation IS NULL OR p_operation NOT IN ('save','finish','start') OR p_round IS NULL OR p_revision IS NULL
 OR p_request IS NULL OR jsonb_typeof(p_state) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 row:=iig_closed_entry.lock_group(p_pin);
 IF row.id::text IS DISTINCT FROM p_group THEN RAISE EXCEPTION 'GROUP_CHANGED';END IF;
 IF p_operation<>'save' THEN
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
 IF p_operation='start' THEN next_state:=jsonb_set(next_state,'{roundId}',to_jsonb(gen_random_uuid()::text)); END IF;
 INSERT INTO iig_closed_entry.permits VALUES(pg_backend_pid(),p_group,pg_current_xact_id()::text,p_operation,
  p_revision,iig_closed_entry.digest(next_state),true)
 ON CONFLICT(backend,group_id) DO UPDATE SET transaction_id=excluded.transaction_id,operation=excluded.operation,
 expected_revision=excluded.expected_revision,state_digest=excluded.state_digest,available=true;
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
 IF r.operation<>'save' THEN
  PERFORM iig_closed_entry.authorise(p_group,p_credential,r.operation);
  IF r.credential_hash IS DISTINCT FROM iig_closed_entry.token_hash(p_credential) THEN RAISE EXCEPTION 'ORGANISER_CREDENTIAL_REQUIRED';END IF;
 END IF;
 RETURN jsonb_build_object('status','committed','response',r.outcome);
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA iig_closed_entry FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.iig_entry_read(text),public.iig_entry_check_credential(text,text,text),
 public.iig_entry_write(text,text,uuid,bigint,text,jsonb,text,uuid),public.iig_entry_receipt(text,text,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.iig_entry_read(text),public.iig_entry_check_credential(text,text,text),
 public.iig_entry_write(text,text,uuid,bigint,text,jsonb,text,uuid),public.iig_entry_receipt(text,text,uuid,text) TO anon,authenticated;
