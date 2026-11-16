-- Additive, dormant until a pilot account or full rollout is explicitly enabled.
-- Existing web notification events, sender state and all golf records are untouched.
BEGIN;
SET LOCAL lock_timeout='2s';
CREATE TABLE iig_private.native_reminder_rollout (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 enabled boolean NOT NULL DEFAULT false,
 pilot_user_ids uuid[] NOT NULL DEFAULT '{}',
 activated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO iig_private.native_reminder_rollout(singleton) VALUES(true);
CREATE TABLE iig_private.native_reminder_preferences (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 enabled boolean NOT NULL DEFAULT true,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE iig_private.native_reminder_devices (
 fid text PRIMARY KEY CHECK(fid ~ '^[A-Za-z0-9_-]{20,128}$'),
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 session_id uuid NOT NULL REFERENCES auth.sessions(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX native_reminder_devices_user ON iig_private.native_reminder_devices(user_id);
CREATE INDEX native_reminder_devices_session ON iig_private.native_reminder_devices(session_id);
CREATE TABLE iig_private.native_reminder_deliveries (
 event_id uuid NOT NULL REFERENCES public.iig_notification_events(id) ON DELETE CASCADE,
 fid text NOT NULL REFERENCES iig_private.native_reminder_devices(fid) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 status text NOT NULL CHECK(status IN ('sending','retry','sent','failed','skipped')),
 claim_id uuid NOT NULL DEFAULT gen_random_uuid(),
 attempts integer NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(event_id,fid)
);
CREATE INDEX native_reminder_deliveries_user ON iig_private.native_reminder_deliveries(user_id);
CREATE INDEX native_reminder_deliveries_fid ON iig_private.native_reminder_deliveries(fid);
ALTER TABLE iig_private.native_reminder_rollout ENABLE ROW LEVEL SECURITY;
ALTER TABLE iig_private.native_reminder_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE iig_private.native_reminder_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE iig_private.native_reminder_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON iig_private.native_reminder_rollout,iig_private.native_reminder_preferences,
 iig_private.native_reminder_devices,iig_private.native_reminder_deliveries FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION iig_private.native_reminder_uid() RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE uid uuid=iig_private.verified_organiser(); sid uuid;
BEGIN
 sid:=nullif(auth.jwt()->>'session_id','')::uuid;
 IF NOT EXISTS(SELECT 1 FROM auth.sessions s WHERE s.id=sid AND s.user_id=uid AND (s.not_after IS NULL OR s.not_after>now()))
 THEN RAISE EXCEPTION 'Sign in again to manage reminders' USING ERRCODE='42501';END IF;
 RETURN uid;
END $$;
REVOKE ALL ON FUNCTION iig_private.native_reminder_uid() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.iig_get_native_reminders(p_account uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE uid uuid=iig_private.native_reminder_uid();
BEGIN
 IF uid IS DISTINCT FROM p_account THEN RAISE EXCEPTION 'Account changed. Sign in again.' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('available',(SELECT enabled OR uid=ANY(pilot_user_ids) FROM iig_private.native_reminder_rollout WHERE singleton),
  'enabled',coalesce((SELECT enabled FROM iig_private.native_reminder_preferences WHERE user_id=uid),true));
END $$;
CREATE FUNCTION public.iig_set_native_reminders(p_enabled boolean,p_account uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE uid uuid=iig_private.native_reminder_uid();
BEGIN
 IF uid IS DISTINCT FROM p_account THEN RAISE EXCEPTION 'Account changed. Sign in again.' USING ERRCODE='42501';END IF;
 IF p_enabled IS NULL THEN RAISE EXCEPTION 'Choose on or off' USING ERRCODE='22023';END IF;
 IF p_enabled AND NOT EXISTS(SELECT 1 FROM iig_private.native_reminder_rollout WHERE singleton AND (enabled OR uid=ANY(pilot_user_ids)))
 THEN RAISE EXCEPTION 'Phone reminders are not available yet' USING ERRCODE='42501';END IF;
 INSERT INTO iig_private.native_reminder_preferences(user_id,enabled) VALUES(uid,p_enabled)
 ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled,
  updated_at=CASE WHEN native_reminder_preferences.enabled=excluded.enabled THEN native_reminder_preferences.updated_at ELSE now() END;
 IF NOT p_enabled THEN
  UPDATE iig_private.native_reminder_deliveries SET status='skipped',updated_at=now()
   WHERE user_id=uid AND status IN ('sending','retry');
 END IF;
 RETURN public.iig_get_native_reminders(p_account);
END $$;
CREATE FUNCTION public.iig_register_native_reminders(p_fid text,p_account uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE uid uuid=iig_private.native_reminder_uid();sid uuid=(auth.jwt()->>'session_id')::uuid;
BEGIN
 IF uid IS DISTINCT FROM p_account THEN RAISE EXCEPTION 'Account changed. Sign in again.' USING ERRCODE='42501';END IF;
 IF p_fid IS NULL OR p_fid !~ '^[A-Za-z0-9_-]{20,128}$' THEN RAISE EXCEPTION 'Invalid phone registration' USING ERRCODE='22023';END IF;
 IF NOT EXISTS(SELECT 1 FROM iig_private.native_reminder_rollout WHERE singleton AND (enabled OR uid=ANY(pilot_user_ids)))
 THEN RAISE EXCEPTION 'Phone reminders are not available yet' USING ERRCODE='42501';END IF;
 IF EXISTS(SELECT 1 FROM iig_private.native_reminder_preferences WHERE user_id=uid AND NOT enabled) THEN RETURN false;END IF;
 IF NOT EXISTS(SELECT 1 FROM iig_private.group_members WHERE user_id=uid) AND NOT EXISTS(SELECT 1 FROM iig_private.group_owners WHERE owner_id=uid)
 THEN RAISE EXCEPTION 'Join or create your group first' USING ERRCODE='42501';END IF;
 INSERT INTO iig_private.native_reminder_devices(fid,user_id,session_id) VALUES(p_fid,uid,sid)
 ON CONFLICT(fid) DO UPDATE SET user_id=excluded.user_id,session_id=excluded.session_id,updated_at=now(),
  created_at=CASE WHEN native_reminder_devices.user_id=excluded.user_id THEN native_reminder_devices.created_at ELSE now() END;
 RETURN true;
END $$;
CREATE FUNCTION public.iig_unregister_native_reminders(p_fid text,p_account uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE uid uuid=iig_private.native_reminder_uid();
BEGIN
 IF uid IS DISTINCT FROM p_account THEN RAISE EXCEPTION 'Account changed. Sign in again.' USING ERRCODE='42501';END IF;
 DELETE FROM iig_private.native_reminder_devices WHERE fid=p_fid AND user_id=uid;
 RETURN true;
END $$;

-- Every claim and send rechecks current membership, account, session, opt-out,
-- rollout, group availability, current round identity and reminder age.
CREATE FUNCTION iig_private.native_reminder_eligible(p_event uuid,p_fid text,p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(
  SELECT 1 FROM public.iig_notification_events e
  JOIN public.tens_in_groups g ON g.group_pin=e.group_pin
  JOIN public.iig_notification_settings gs ON gs.group_pin=g.group_pin AND gs.enabled
  JOIN iig_private.native_reminder_devices d ON d.fid=p_fid AND d.user_id=p_user
  JOIN auth.users u ON u.id=d.user_id
  JOIN auth.sessions s ON s.id=d.session_id AND s.user_id=d.user_id
  CROSS JOIN iig_private.native_reminder_rollout r
  LEFT JOIN iig_private.native_reminder_preferences p ON p.user_id=d.user_id
  LEFT JOIN iig_private.release_groups rg ON rg.group_id=g.id
  WHERE e.id=p_event AND r.singleton AND (r.enabled OR d.user_id=ANY(r.pilot_user_ids))
   AND coalesce(p.enabled,true) AND u.email_confirmed_at IS NOT NULL AND u.email IS NOT NULL
   AND NOT coalesce(u.is_anonymous,false) AND (u.banned_until IS NULL OR u.banned_until<=now())
   AND NOT EXISTS(SELECT 1 FROM iig_private.account_deletions ad WHERE ad.user_id=u.id)
   AND (s.not_after IS NULL OR s.not_after>now())
   AND d.updated_at>now()-interval '90 days'
   AND coalesce(g.status,'active')='active' AND rg.retired_at IS NULL AND rg.owner_departed_at IS NULL
   AND (EXISTS(SELECT 1 FROM iig_private.group_members m WHERE m.group_id=g.id AND m.user_id=u.id)
     OR EXISTS(SELECT 1 FROM iig_private.group_owners o WHERE o.group_id=g.id AND o.owner_id=u.id))
   AND coalesce(g.state->>'roundOpen','false')='true'
   AND e.event_type IN ('competition_created','three_days_before','night_before')
   AND e.scheduled_for>=greatest(r.activated_at,d.created_at,coalesce(p.updated_at,d.created_at))
   AND e.scheduled_for<=now() AND e.scheduled_for>now()-interval '12 hours'
   AND e.round_key=concat(g.state->>'date','|',lower(trim(g.state->>'course')),'|',
    CASE WHEN jsonb_typeof(g.state->'history')='array' THEN jsonb_array_length(g.state->'history') ELSE 0 END)
 );
$$;
REVOKE ALL ON FUNCTION iig_private.native_reminder_eligible(uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.iig_claim_native_reminders(p_limit integer DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 WITH candidates AS (
  SELECT e.id event_id,d.fid,d.user_id FROM public.iig_notification_events e
  JOIN public.tens_in_groups g ON g.group_pin=e.group_pin
  JOIN public.iig_notification_settings gs ON gs.group_pin=g.group_pin AND gs.enabled
  JOIN iig_private.native_reminder_devices d ON
   EXISTS(SELECT 1 FROM iig_private.group_members m WHERE m.group_id=g.id AND m.user_id=d.user_id)
   OR EXISTS(SELECT 1 FROM iig_private.group_owners o WHERE o.group_id=g.id AND o.owner_id=d.user_id)
  LEFT JOIN iig_private.native_reminder_deliveries prior ON prior.event_id=e.id AND prior.fid=d.fid
  WHERE e.event_type IN ('competition_created','three_days_before','night_before')
   AND e.scheduled_for<=now() AND e.scheduled_for>now()-interval '12 hours'
   AND iig_private.native_reminder_eligible(e.id,d.fid,d.user_id)
   AND (prior.event_id IS NULL OR (prior.attempts<3 AND
    (prior.status='retry' OR prior.status='sending' AND prior.updated_at<now()-interval '10 minutes')))
  ORDER BY e.scheduled_for,e.id,d.fid LIMIT least(greatest(coalesce(p_limit,50),1),100)
 ), claimed AS (
  INSERT INTO iig_private.native_reminder_deliveries(event_id,fid,user_id,status)
  SELECT event_id,fid,user_id,'sending' FROM candidates
  ON CONFLICT(event_id,fid) DO UPDATE SET status='sending',claim_id=gen_random_uuid(),
   attempts=native_reminder_deliveries.attempts+1,updated_at=now()
  WHERE native_reminder_deliveries.attempts<3 AND
   (native_reminder_deliveries.status='retry' OR native_reminder_deliveries.status='sending' AND native_reminder_deliveries.updated_at<now()-interval '10 minutes')
  RETURNING event_id,fid,user_id,claim_id
 ) SELECT coalesce(jsonb_agg(to_jsonb(c)),'[]') INTO result FROM claimed c;
 RETURN result;
END $$;
CREATE FUNCTION public.iig_authorize_native_reminder(p_event uuid,p_fid text,p_claim uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d iig_private.native_reminder_deliveries; e public.iig_notification_events;
BEGIN
 SELECT * INTO d FROM iig_private.native_reminder_deliveries
  WHERE event_id=p_event AND fid=p_fid AND claim_id=p_claim AND status='sending';
 IF NOT FOUND OR NOT iig_private.native_reminder_eligible(p_event,p_fid,d.user_id) THEN
  UPDATE iig_private.native_reminder_deliveries SET status='skipped',updated_at=now()
   WHERE event_id=p_event AND fid=p_fid AND claim_id=p_claim AND status='sending';
  RETURN NULL;
 END IF;
 SELECT * INTO e FROM public.iig_notification_events WHERE id=p_event;
 RETURN jsonb_build_object('fid',p_fid,'event_id',e.id,'group_pin',e.group_pin,'title',e.title,'body',e.message,'expires_at',e.scheduled_for+interval '12 hours');
END $$;
CREATE FUNCTION public.iig_finish_native_reminder(p_event uuid,p_fid text,p_claim uuid,p_status text,p_invalid_device boolean DEFAULT false) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF p_status NOT IN ('sent','retry','failed') OR p_status IS NULL THEN RAISE EXCEPTION 'Invalid delivery state';END IF;
 UPDATE iig_private.native_reminder_deliveries SET status=CASE WHEN p_status='retry' AND attempts>=3 THEN 'failed' ELSE p_status END,updated_at=now()
  WHERE event_id=p_event AND fid=p_fid AND claim_id=p_claim AND status='sending';
 IF FOUND AND p_invalid_device THEN
  DELETE FROM iig_private.native_reminder_devices d WHERE d.fid=p_fid
   AND d.user_id=(SELECT user_id FROM iig_private.native_reminder_deliveries WHERE event_id=p_event AND fid=p_fid AND claim_id=p_claim);
 END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.iig_get_native_reminders(uuid),public.iig_set_native_reminders(boolean,uuid),public.iig_register_native_reminders(text,uuid),public.iig_unregister_native_reminders(text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.iig_get_native_reminders(uuid),public.iig_set_native_reminders(boolean,uuid),public.iig_register_native_reminders(text,uuid),public.iig_unregister_native_reminders(text,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.iig_claim_native_reminders(integer),public.iig_authorize_native_reminder(uuid,text,uuid),public.iig_finish_native_reminder(uuid,text,uuid,text,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.iig_claim_native_reminders(integer),public.iig_authorize_native_reminder(uuid,text,uuid),public.iig_finish_native_reminder(uuid,text,uuid,text,boolean) TO service_role;
COMMIT;
