-- Owner-requested permanent group deletion. Installation deletes no group data.
BEGIN;
SET LOCAL lock_timeout = '2s';

CREATE TABLE iig_private.group_delete_permits (
 backend integer NOT NULL, transaction_id text NOT NULL, group_id bigint NOT NULL,
 actor_id uuid NOT NULL, PRIMARY KEY(backend, transaction_id, group_id)
);
CREATE TABLE iig_private.group_delete_receipts (
 request_id uuid PRIMARY KEY, actor_id uuid NOT NULL, group_id bigint NOT NULL,
 deleted_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE iig_private.group_delete_permits ENABLE ROW LEVEL SECURITY;
ALTER TABLE iig_private.group_delete_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON iig_private.group_delete_permits, iig_private.group_delete_receipts FROM PUBLIC, anon, authenticated;

CREATE FUNCTION iig_private.require_delete_owner(p_recent boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE uid uuid := iig_private.verified_organiser(); claims jsonb := coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM iig_private.platform_owners WHERE user_id=uid) THEN RAISE EXCEPTION 'Platform owner required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.sessions s WHERE s.id::text=(claims->>'session_id') AND s.user_id=uid AND (s.not_after IS NULL OR s.not_after>now())) THEN RAISE EXCEPTION 'Sign in again before managing group deletion' USING ERRCODE='42501'; END IF;
 IF p_recent THEN PERFORM iig_private.recent_signin(); END IF;
 RETURN uid;
END $$;

CREATE FUNCTION iig_private.authorise_group_delete(p_id bigint, p_pin text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE uid uuid := iig_private.require_delete_owner(true);
BEGIN
 IF p_pin IN ('1010','2026') OR NOT EXISTS(SELECT 1 FROM iig_private.group_delete_permits WHERE backend=pg_backend_pid() AND transaction_id=pg_current_xact_id()::text AND group_id=p_id AND actor_id=uid)
 THEN RAISE EXCEPTION 'Use the owner dashboard to confirm permanent deletion' USING ERRCODE='42501'; END IF;
END $$;

-- These tables lack foreign keys. Locking the parent on new links prevents a late
-- subscription, archive, receipt or audit row from reappearing after deletion.
CREATE FUNCTION iig_private.group_exists_before_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE key text := to_jsonb(NEW)->>TG_ARGV[0];
BEGIN
 -- Null group IDs in the existing release audit represent account-wide events.
 IF key IS NULL AND TG_TABLE_SCHEMA='iig_private' AND TG_TABLE_NAME='release_audit' THEN RETURN NEW; END IF;
 IF TG_ARGV[1]='pin' THEN
  PERFORM 1 FROM public.tens_in_groups WHERE group_pin=key FOR KEY SHARE;
 ELSE
  PERFORM 1 FROM public.tens_in_groups WHERE id::text=key FOR KEY SHARE;
 END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'Group no longer exists' USING ERRCODE='23503'; END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION iig_private.group_delete_snapshot(p_id bigint)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('group',to_jsonb(g),
 'public.iig_notification_settings', (select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb) from public.iig_notification_settings x where x.group_pin=g.group_pin),
'public.iig_push_subscriptions', (select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb) from public.iig_push_subscriptions x where x.group_pin=g.group_pin),
'public.iig_notification_events', (select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb) from public.iig_notification_events x where x.group_pin=g.group_pin),
'iig_closed_entry.rounds', (select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb) from iig_closed_entry.rounds x where x.group_id=g.id::text),
'iig_closed_entry.credentials', (select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb) from iig_closed_entry.credentials x where x.group_id=g.id::text),
'iig_closed_entry.permits', (select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb) from iig_closed_entry.permits x where x.group_id=g.id::text),
'iig_closed_entry.receipts', (select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb) from iig_closed_entry.receipts x where x.group_id=g.id::text),
'iig_closed_entry.archives', (select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb) from iig_closed_entry.archives x where x.group_id=g.id::text),
'iig_closed_entry.member_credentials', (select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb) from iig_closed_entry.member_credentials x where x.group_id=g.id::text),
'iig_closed_entry.operation_audit', (select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb) from iig_closed_entry.operation_audit x where x.group_id=g.id::text),
'iig_closed_entry.identity_ids', (select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb) from iig_closed_entry.identity_ids x where x.group_id=g.id::text),
'iig_private.group_owners', (select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb) from iig_private.group_owners x where x.group_id=g.id),
'iig_private.group_members', (select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb) from iig_private.group_members x where x.group_id=g.id),
'iig_private.release_groups', (select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb) from iig_private.release_groups x where x.group_id=g.id),
'iig_private.player_links', (select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb) from iig_private.player_links x where x.group_id=g.id),
'iig_private.relink_grants', (select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb) from iig_private.relink_grants x where x.group_id=g.id),
'iig_private.release_audit', (select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb) from iig_private.release_audit x where x.group_id=g.id),
'iig_private.subscription_bindings', (select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb) from iig_private.subscription_bindings x where x.group_id=g.id)
 ) FROM public.tens_in_groups g WHERE g.id=p_id;
$$;

CREATE FUNCTION public.iig_owner_group_deletion_review(p_pin text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE uid uuid := iig_private.require_delete_owner(); g public.tens_in_groups; snapshot jsonb; reason text; fresh boolean:=true;
BEGIN
 IF p_pin IS NULL OR p_pin !~ '^[0-9]{4}$' THEN RAISE EXCEPTION 'Enter the four-digit group PIN'; END IF;
 SELECT * INTO STRICT g FROM public.tens_in_groups WHERE group_pin=p_pin;
 snapshot:=iig_private.group_delete_snapshot(g.id);
 IF p_pin IN ('1010','2026') THEN reason:='This retained or demo group is protected.';
 ELSIF EXISTS(SELECT 1 FROM iig_private.subscription_bindings WHERE group_id=g.id) THEN reason:='This group has an Apple subscription record and cannot be deleted here.'; END IF;
 BEGIN PERFORM iig_private.recent_signin(); EXCEPTION WHEN insufficient_privilege THEN fresh:=false; END;
 RETURN jsonb_build_object('group_id',g.id::text,'group_pin',g.group_pin,'group_name',g.group_name,
 'fingerprint',encode(sha256(convert_to(snapshot::text,'UTF8')),'hex'),
 'can_delete',reason IS NULL,'blocked_reason',reason,'needs_verification',NOT fresh,
 'counts',jsonb_build_object(
 'players',jsonb_array_length(CASE WHEN jsonb_typeof(g.state->'players')='array' THEN g.state->'players' ELSE '[]'::jsonb END),
 'history_entries',jsonb_array_length(CASE WHEN jsonb_typeof(g.state->'history')='array' THEN g.state->'history' ELSE '[]'::jsonb END),
 'past_trips',jsonb_array_length(CASE WHEN jsonb_typeof(g.state#>'{trip,pastTrips}')='array' THEN g.state#>'{trip,pastTrips}' ELSE '[]'::jsonb END),
 'saved_snapshots',jsonb_array_length(snapshot->'iig_closed_entry.archives')+jsonb_array_length(snapshot->'iig_closed_entry.operation_audit'),
 'notifications',jsonb_array_length(snapshot->'public.iig_notification_events'),
 'linked_accounts',(SELECT count(DISTINCT id) FROM (SELECT owner_id id FROM iig_private.group_owners WHERE group_id=g.id UNION ALL SELECT user_id FROM iig_private.group_members WHERE group_id=g.id UNION ALL SELECT user_id FROM iig_private.player_links WHERE group_id=g.id) accounts)));
EXCEPTION WHEN no_data_found THEN RAISE EXCEPTION 'Group not found';
END $$;

CREATE FUNCTION public.iig_owner_delete_group(p_group_id text, p_pin text, p_confirmation text, p_fingerprint text, p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='2s' AS $$
DECLARE uid uuid:=iig_private.require_delete_owner(true); g public.tens_in_groups; snapshot jsonb; receipt iig_private.group_delete_receipts;
BEGIN
 IF p_pin IS NULL OR p_pin !~ '^[0-9]{4}$' OR p_group_id IS NULL OR p_group_id !~ '^[0-9]+$' OR p_request_id IS NULL
 OR p_confirmation IS DISTINCT FROM ('DELETE '||p_pin) OR p_fingerprint IS NULL OR p_fingerprint !~ '^[a-f0-9]{64}$'
 THEN RAISE EXCEPTION 'Confirm the selected group before deleting'; END IF;
 SELECT * INTO receipt FROM iig_private.group_delete_receipts WHERE request_id=p_request_id;
 IF FOUND THEN
  IF receipt.actor_id<>uid OR receipt.group_id::text<>p_group_id THEN RAISE EXCEPTION 'Deletion request does not match' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('deleted',true,'group_id',p_group_id,'request_id',p_request_id);
 END IF;
 IF p_pin IN ('1010','2026') THEN RAISE EXCEPTION 'This retained or demo group is protected.' USING ERRCODE='42501'; END IF;
 -- Match the existing authenticated-write lock order: owner row, group row, children.
 PERFORM 1 FROM iig_private.group_owners WHERE group_id::text=p_group_id FOR UPDATE;
 SELECT * INTO g FROM public.tens_in_groups WHERE id::text=p_group_id AND group_pin=p_pin FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Group not found or changed; refresh the dashboard'; END IF;
 PERFORM 1 FROM public.iig_notification_settings x WHERE x.group_pin=g.group_pin FOR UPDATE;
PERFORM 1 FROM public.iig_push_subscriptions x WHERE x.group_pin=g.group_pin FOR UPDATE;
PERFORM 1 FROM public.iig_notification_events x WHERE x.group_pin=g.group_pin FOR UPDATE;
PERFORM 1 FROM iig_closed_entry.rounds x WHERE x.group_id=g.id::text FOR UPDATE;
PERFORM 1 FROM iig_closed_entry.credentials x WHERE x.group_id=g.id::text FOR UPDATE;
PERFORM 1 FROM iig_closed_entry.permits x WHERE x.group_id=g.id::text FOR UPDATE;
PERFORM 1 FROM iig_closed_entry.receipts x WHERE x.group_id=g.id::text FOR UPDATE;
PERFORM 1 FROM iig_closed_entry.archives x WHERE x.group_id=g.id::text FOR UPDATE;
PERFORM 1 FROM iig_closed_entry.member_credentials x WHERE x.group_id=g.id::text FOR UPDATE;
PERFORM 1 FROM iig_closed_entry.operation_audit x WHERE x.group_id=g.id::text FOR UPDATE;
PERFORM 1 FROM iig_closed_entry.identity_ids x WHERE x.group_id=g.id::text FOR UPDATE;
PERFORM 1 FROM iig_private.group_owners x WHERE x.group_id=g.id FOR UPDATE;
PERFORM 1 FROM iig_private.group_members x WHERE x.group_id=g.id FOR UPDATE;
PERFORM 1 FROM iig_private.release_groups x WHERE x.group_id=g.id FOR UPDATE;
PERFORM 1 FROM iig_private.player_links x WHERE x.group_id=g.id FOR UPDATE;
PERFORM 1 FROM iig_private.relink_grants x WHERE x.group_id=g.id FOR UPDATE;
PERFORM 1 FROM iig_private.release_audit x WHERE x.group_id=g.id FOR UPDATE;
PERFORM 1 FROM iig_private.subscription_bindings x WHERE x.group_id=g.id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM iig_private.subscription_bindings WHERE group_id=g.id) THEN RAISE EXCEPTION 'This group has an Apple subscription record and cannot be deleted here.' USING ERRCODE='42501'; END IF;
 snapshot:=iig_private.group_delete_snapshot(g.id);
 IF encode(sha256(convert_to(snapshot::text,'UTF8')),'hex') IS DISTINCT FROM p_fingerprint THEN RAISE EXCEPTION 'Group changed; review its latest details before deleting' USING ERRCODE='40001'; END IF;
 INSERT INTO iig_private.group_delete_permits VALUES(pg_backend_pid(),pg_current_xact_id()::text,g.id,uid);
 DELETE FROM public.iig_notification_settings x WHERE x.group_pin=g.group_pin;
DELETE FROM public.iig_push_subscriptions x WHERE x.group_pin=g.group_pin;
DELETE FROM public.iig_notification_events x WHERE x.group_pin=g.group_pin;
DELETE FROM iig_closed_entry.rounds x WHERE x.group_id=g.id::text;
DELETE FROM iig_closed_entry.credentials x WHERE x.group_id=g.id::text;
DELETE FROM iig_closed_entry.permits x WHERE x.group_id=g.id::text;
DELETE FROM iig_closed_entry.receipts x WHERE x.group_id=g.id::text;
DELETE FROM iig_closed_entry.archives x WHERE x.group_id=g.id::text;
DELETE FROM iig_closed_entry.member_credentials x WHERE x.group_id=g.id::text;
DELETE FROM iig_closed_entry.operation_audit x WHERE x.group_id=g.id::text;
DELETE FROM iig_closed_entry.identity_ids x WHERE x.group_id=g.id::text;
DELETE FROM iig_private.group_members x WHERE x.group_id=g.id;
DELETE FROM iig_private.release_groups x WHERE x.group_id=g.id;
DELETE FROM iig_private.player_links x WHERE x.group_id=g.id;
DELETE FROM iig_private.relink_grants x WHERE x.group_id=g.id;
DELETE FROM iig_private.release_audit x WHERE x.group_id=g.id;
DELETE FROM iig_private.group_owners x WHERE x.group_id=g.id;
 DELETE FROM public.tens_in_groups WHERE id=g.id;
 IF EXISTS(SELECT 1 FROM public.tens_in_groups WHERE id=g.id) THEN RAISE EXCEPTION 'Group deletion could not be confirmed'; END IF;
 DELETE FROM iig_private.group_delete_permits WHERE backend=pg_backend_pid() AND transaction_id=pg_current_xact_id()::text AND group_id=g.id;
 -- Minimal operational receipt for safe retries: no group name, PIN, players or golf history.
 INSERT INTO iig_private.group_delete_receipts(request_id,actor_id,group_id) VALUES(p_request_id,uid,g.id);
 RETURN jsonb_build_object('deleted',true,'group_id',p_group_id,'request_id',p_request_id);
END $$;

REVOKE ALL ON FUNCTION iig_private.require_delete_owner(boolean),iig_private.authorise_group_delete(bigint,text),iig_private.group_exists_before_write(),iig_private.group_delete_snapshot(bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.iig_owner_group_deletion_review(text),public.iig_owner_delete_group(text,text,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.iig_owner_group_deletion_review(text),public.iig_owner_delete_group(text,text,text,text,uuid) TO authenticated;

CREATE TRIGGER iig_group_exists_before_write BEFORE INSERT OR UPDATE OF group_pin ON public.iig_notification_settings FOR EACH ROW EXECUTE FUNCTION iig_private.group_exists_before_write('group_pin', 'pin');

CREATE TRIGGER iig_group_exists_before_write BEFORE INSERT OR UPDATE OF group_pin ON public.iig_push_subscriptions FOR EACH ROW EXECUTE FUNCTION iig_private.group_exists_before_write('group_pin', 'pin');

CREATE TRIGGER iig_group_exists_before_write BEFORE INSERT OR UPDATE OF group_pin ON public.iig_notification_events FOR EACH ROW EXECUTE FUNCTION iig_private.group_exists_before_write('group_pin', 'pin');

CREATE TRIGGER iig_group_exists_before_write BEFORE INSERT OR UPDATE OF group_id ON iig_closed_entry.rounds FOR EACH ROW EXECUTE FUNCTION iig_private.group_exists_before_write('group_id', 'text');

CREATE TRIGGER iig_group_exists_before_write BEFORE INSERT OR UPDATE OF group_id ON iig_closed_entry.credentials FOR EACH ROW EXECUTE FUNCTION iig_private.group_exists_before_write('group_id', 'text');

CREATE TRIGGER iig_group_exists_before_write BEFORE INSERT OR UPDATE OF group_id ON iig_closed_entry.permits FOR EACH ROW EXECUTE FUNCTION iig_private.group_exists_before_write('group_id', 'text');

CREATE TRIGGER iig_group_exists_before_write BEFORE INSERT OR UPDATE OF group_id ON iig_closed_entry.receipts FOR EACH ROW EXECUTE FUNCTION iig_private.group_exists_before_write('group_id', 'text');

CREATE TRIGGER iig_group_exists_before_write BEFORE INSERT OR UPDATE OF group_id ON iig_closed_entry.archives FOR EACH ROW EXECUTE FUNCTION iig_private.group_exists_before_write('group_id', 'text');

CREATE TRIGGER iig_group_exists_before_write BEFORE INSERT OR UPDATE OF group_id ON iig_closed_entry.member_credentials FOR EACH ROW EXECUTE FUNCTION iig_private.group_exists_before_write('group_id', 'text');

CREATE TRIGGER iig_group_exists_before_write BEFORE INSERT OR UPDATE OF group_id ON iig_closed_entry.operation_audit FOR EACH ROW EXECUTE FUNCTION iig_private.group_exists_before_write('group_id', 'text');

CREATE TRIGGER iig_group_exists_before_write BEFORE INSERT OR UPDATE OF group_id ON iig_closed_entry.identity_ids FOR EACH ROW EXECUTE FUNCTION iig_private.group_exists_before_write('group_id', 'text');

CREATE TRIGGER iig_group_exists_before_write BEFORE INSERT OR UPDATE OF group_id ON iig_private.release_audit FOR EACH ROW EXECUTE FUNCTION iig_private.group_exists_before_write('group_id', 'id');

DO $patch$ DECLARE source text; BEGIN
 SELECT pg_get_functiondef('iig_closed_entry.guard_row()'::regprocedure) INTO source;
 IF md5(source)<>'be1b7dcd62c8880bd710d2f0271b61df' THEN RAISE EXCEPTION 'Deletion guard changed; review before installing'; END IF;
 EXECUTE replace(source, $old$IF TG_OP='DELETE' THEN RAISE EXCEPTION 'PROTECTED_GROUP_DELETE_NOT_IMPLEMENTED'; END IF;$old$, $new$IF TG_OP='DELETE' THEN PERFORM iig_private.authorise_group_delete(OLD.id, OLD.group_pin); RETURN OLD; END IF;$new$);
END $patch$;

DO $patch$ DECLARE source text; BEGIN
 SELECT pg_get_functiondef('iig_private.release_hold()'::regprocedure) INTO source;
 IF md5(source)<>'6122eef855e16af105ae4781ff7d2f6e' THEN RAISE EXCEPTION 'Deletion guard changed; review before installing'; END IF;
 EXECUTE replace(source, $old$IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Retire groups instead of deleting them';END IF;$old$, $new$IF TG_OP='DELETE' THEN PERFORM iig_private.authorise_group_delete(OLD.id, OLD.group_pin); RETURN OLD; END IF;$new$);
END $patch$;

COMMIT;
