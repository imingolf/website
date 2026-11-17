-- Review candidate. Apply only after pilot review; starts disabled and never backfills.
BEGIN;
SET LOCAL lock_timeout='2s';
CREATE TABLE iig_private.side_invite_rollout (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), enabled boolean NOT NULL DEFAULT false,
 pilot_user_ids uuid[] NOT NULL DEFAULT '{}', activated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO iig_private.side_invite_rollout(singleton) VALUES(true);
CREATE TABLE iig_private.side_invite_preferences (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 enabled boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE iig_private.side_invite_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), group_id bigint NOT NULL REFERENCES public.tens_in_groups(id) ON DELETE CASCADE,
 invite_id text NOT NULL, recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 player_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
 UNIQUE(group_id,invite_id)
);
CREATE TABLE iig_private.side_invite_deliveries (
 event_id uuid PRIMARY KEY REFERENCES iig_private.side_invite_events(id) ON DELETE CASCADE,
 fid text NOT NULL,
 claim_id uuid NOT NULL DEFAULT gen_random_uuid(), status text NOT NULL CHECK(status IN ('claimed','sending','sent','failed','skipped')),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE iig_private.side_invite_rollout ENABLE ROW LEVEL SECURITY;
ALTER TABLE iig_private.side_invite_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE iig_private.side_invite_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE iig_private.side_invite_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON iig_private.side_invite_rollout,iig_private.side_invite_preferences,iig_private.side_invite_events,iig_private.side_invite_deliveries FROM PUBLIC,anon,authenticated,service_role;

-- Match the established member-first identity contract. Ambiguous recipients fail closed.
CREATE FUNCTION iig_private.side_invite_player(p_group bigint,p_user uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce((SELECT player_id::text FROM iig_private.group_members WHERE group_id=p_group AND user_id=p_user),
  (SELECT player_id FROM iig_private.player_links WHERE group_id=p_group AND user_id=p_user));
$$;
CREATE FUNCTION iig_private.capture_side_invites() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b jsonb; recipient uuid; matches integer; today text=to_char(now() AT TIME ZONE 'Europe/London','YYYY-MM-DD');
BEGIN
 IF NEW.state->'sideGame'->'bets' IS NOT DISTINCT FROM OLD.state->'sideGame'->'bets' THEN RETURN NEW;END IF;
 FOR b IN SELECT value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(NEW.state->'sideGame'->'bets')='array' THEN NEW.state->'sideGame'->'bets' ELSE '[]'::jsonb END) LOOP
  IF b->>'status' IS DISTINCT FROM 'pending' OR b->>'setup' IS DISTINCT FROM 'challenge' OR b->>'date' IS DISTINCT FROM today
   OR coalesce(length(b->>'id'),0) NOT BETWEEN 1 AND 200 OR b->>'player1Id'=b->>'player2Id' THEN CONTINUE;END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(OLD.state->'sideGame'->'bets')='array' THEN OLD.state->'sideGame'->'bets' ELSE '[]'::jsonb END) x WHERE x->>'id'=b->>'id') THEN CONTINUE;END IF;
  -- Snapshot only the current verified account binding; later claims cannot inherit old invites.
  SELECT count(*),min(c.user_id::text)::uuid INTO matches,recipient FROM (
   SELECT user_id FROM iig_private.group_members WHERE group_id=NEW.id
   UNION SELECT user_id FROM iig_private.player_links WHERE group_id=NEW.id) c
   WHERE iig_private.side_invite_player(NEW.id,c.user_id)=b->>'player2Id';
  IF matches<>1 THEN CONTINUE;END IF;
  IF NOT EXISTS(SELECT 1 FROM iig_private.side_invite_preferences p CROSS JOIN iig_private.side_invite_rollout r
   WHERE p.user_id=recipient AND p.enabled AND r.singleton AND (r.enabled OR recipient=ANY(r.pilot_user_ids))) THEN CONTINUE;END IF;
  INSERT INTO iig_private.side_invite_events(group_id,invite_id,recipient_id,player_id,expires_at)
   VALUES(NEW.id,b->>'id',recipient,b->>'player2Id',least(now()+interval '12 hours',((now() AT TIME ZONE 'Europe/London')::date+1)::timestamp AT TIME ZONE 'Europe/London'))
   ON CONFLICT(group_id,invite_id) DO NOTHING;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER iig_capture_side_invites AFTER UPDATE OF state ON public.tens_in_groups FOR EACH ROW EXECUTE FUNCTION iig_private.capture_side_invites();

CREATE FUNCTION iig_private.side_invite_eligible(p_event uuid,p_fid text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(
  SELECT 1 FROM iig_private.side_invite_events e
  JOIN public.tens_in_groups g ON g.id=e.group_id
  JOIN iig_private.native_reminder_devices d ON d.fid=p_fid AND d.user_id=e.recipient_id
  JOIN auth.users u ON u.id=e.recipient_id JOIN auth.sessions s ON s.id=d.session_id AND s.user_id=u.id
  JOIN iig_private.side_invite_preferences p ON p.user_id=u.id AND p.enabled
  CROSS JOIN iig_private.side_invite_rollout r
  LEFT JOIN iig_private.release_groups rg ON rg.group_id=g.id
  WHERE e.id=p_event AND r.singleton AND (r.enabled OR u.id=ANY(r.pilot_user_ids))
   AND e.created_at>=greatest(r.activated_at,p.updated_at,d.created_at) AND e.expires_at>now()
   AND u.email_confirmed_at IS NOT NULL AND u.email IS NOT NULL AND NOT coalesce(u.is_anonymous,false)
   AND (u.banned_until IS NULL OR u.banned_until<=now()) AND (s.not_after IS NULL OR s.not_after>now())
   AND NOT EXISTS(SELECT 1 FROM iig_private.account_deletions ad WHERE ad.user_id=u.id)
   AND d.updated_at>now()-interval '90 days' AND coalesce(g.status,'active')='active'
   AND rg.retired_at IS NULL AND rg.owner_departed_at IS NULL
   AND iig_private.side_invite_player(g.id,u.id)=e.player_id
   AND (SELECT count(*) FROM jsonb_array_elements(g.state->'players') x WHERE x->>'id'=e.player_id)=1
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(g.state->'sideGame'->'bets','[]')) b
    WHERE b->>'id'=e.invite_id AND b->>'status'='pending' AND b->>'setup'='challenge'
     AND b->>'player2Id'=e.player_id AND b->>'date'=to_char(now() AT TIME ZONE 'Europe/London','YYYY-MM-DD'))
 );
$$;
CREATE FUNCTION public.iig_claim_side_invites(p_limit integer DEFAULT 20) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 WITH candidates AS (
  SELECT e.id,d.fid FROM iig_private.side_invite_events e
  CROSS JOIN LATERAL (SELECT device.fid FROM iig_private.native_reminder_devices device
   WHERE device.user_id=e.recipient_id AND iig_private.side_invite_eligible(e.id,device.fid)
   ORDER BY device.updated_at DESC,device.fid LIMIT 1) d
  WHERE NOT EXISTS(SELECT 1 FROM iig_private.side_invite_deliveries prior WHERE prior.event_id=e.id)
  ORDER BY e.created_at,e.id LIMIT least(greatest(coalesce(p_limit,20),1),50)
 ), claimed AS (
  INSERT INTO iig_private.side_invite_deliveries(event_id,fid,status) SELECT id,fid,'claimed' FROM candidates
  ON CONFLICT(event_id) DO NOTHING RETURNING event_id,fid,claim_id
 ) SELECT coalesce(jsonb_agg(to_jsonb(c)),'[]') INTO result FROM claimed c;
 RETURN result;
END $$;
CREATE FUNCTION public.iig_authorize_side_invite(p_event uuid,p_fid text,p_claim uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 -- A claim can authorize exactly once: ambiguous delivery is never retried automatically.
 UPDATE iig_private.side_invite_deliveries SET status=CASE WHEN iig_private.side_invite_eligible(p_event,p_fid) THEN 'sending' ELSE 'skipped' END,updated_at=now()
  WHERE event_id=p_event AND fid=p_fid AND claim_id=p_claim AND status='claimed';
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM iig_private.side_invite_deliveries WHERE event_id=p_event AND status='sending') THEN RETURN NULL;END IF;
 SELECT jsonb_build_object('event_id',e.id,'fid',p_fid,'group_pin',g.group_pin,'title','I’m In Golf — Side Game invite',
  'body','You have a Side Game invite. Open your group and tap View invite.','expires_at',e.expires_at) INTO result
 FROM iig_private.side_invite_events e JOIN public.tens_in_groups g ON g.id=e.group_id WHERE e.id=p_event;
 RETURN result;
END $$;
CREATE FUNCTION public.iig_finish_side_invite(p_event uuid,p_fid text,p_claim uuid,p_status text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF p_status IS NULL OR p_status NOT IN ('sent','failed') THEN RAISE EXCEPTION 'Invalid delivery state';END IF;
 UPDATE iig_private.side_invite_deliveries SET status=p_status,updated_at=now() WHERE event_id=p_event AND fid=p_fid AND claim_id=p_claim AND status='sending';
 RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION public.iig_get_native_reminders(p_account uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE uid uuid=iig_private.native_reminder_uid();
BEGIN
 IF uid IS DISTINCT FROM p_account THEN RAISE EXCEPTION 'Account changed. Sign in again.' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('available',(SELECT enabled OR uid=ANY(pilot_user_ids) FROM iig_private.native_reminder_rollout WHERE singleton),
  'enabled',coalesce((SELECT enabled FROM iig_private.native_reminder_preferences WHERE user_id=uid),true),
  'sideAvailable',(SELECT enabled OR uid=ANY(pilot_user_ids) FROM iig_private.side_invite_rollout WHERE singleton),
  'sideEnabled',coalesce((SELECT enabled FROM iig_private.side_invite_preferences WHERE user_id=uid),false));
END $$;
CREATE FUNCTION public.iig_set_side_invites(p_enabled boolean,p_account uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE uid uuid=iig_private.native_reminder_uid();
BEGIN
 IF uid IS DISTINCT FROM p_account THEN RAISE EXCEPTION 'Account changed. Sign in again.' USING ERRCODE='42501';END IF;
 IF p_enabled IS NULL THEN RAISE EXCEPTION 'Choose on or off';END IF;
 IF p_enabled AND NOT EXISTS(SELECT 1 FROM iig_private.side_invite_rollout WHERE singleton AND (enabled OR uid=ANY(pilot_user_ids)))
 THEN RAISE EXCEPTION 'Side Game alerts are not available yet' USING ERRCODE='42501';END IF;
 INSERT INTO iig_private.side_invite_preferences(user_id,enabled) VALUES(uid,p_enabled)
 ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled,
  updated_at=CASE WHEN side_invite_preferences.enabled=excluded.enabled THEN side_invite_preferences.updated_at ELSE now() END;
 IF NOT p_enabled THEN UPDATE iig_private.side_invite_deliveries d SET status='skipped',updated_at=now()
  FROM iig_private.side_invite_events e WHERE e.id=d.event_id AND e.recipient_id=uid AND d.status='claimed';END IF;
 RETURN public.iig_get_native_reminders(p_account);
END $$;
CREATE OR REPLACE FUNCTION public.iig_register_native_reminders(p_fid text,p_account uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE uid uuid=iig_private.native_reminder_uid();sid uuid=(auth.jwt()->>'session_id')::uuid;
BEGIN
 IF uid IS DISTINCT FROM p_account THEN RAISE EXCEPTION 'Account changed. Sign in again.' USING ERRCODE='42501';END IF;
 IF p_fid IS NULL OR p_fid !~ '^[A-Za-z0-9_-]{20,128}$' THEN RAISE EXCEPTION 'Invalid phone registration' USING ERRCODE='22023';END IF;
 IF NOT (
  (EXISTS(SELECT 1 FROM iig_private.native_reminder_rollout WHERE singleton AND (enabled OR uid=ANY(pilot_user_ids)))
   AND coalesce((SELECT enabled FROM iig_private.native_reminder_preferences WHERE user_id=uid),true))
  OR (EXISTS(SELECT 1 FROM iig_private.side_invite_rollout WHERE singleton AND (enabled OR uid=ANY(pilot_user_ids)))
   AND coalesce((SELECT enabled FROM iig_private.side_invite_preferences WHERE user_id=uid),false))
 ) THEN RETURN false;END IF;
 IF NOT EXISTS(SELECT 1 FROM iig_private.group_members WHERE user_id=uid) AND NOT EXISTS(SELECT 1 FROM iig_private.group_owners WHERE owner_id=uid)
 THEN RAISE EXCEPTION 'Join or create your group first' USING ERRCODE='42501';END IF;
 INSERT INTO iig_private.native_reminder_devices(fid,user_id,session_id) VALUES(p_fid,uid,sid)
 ON CONFLICT(fid) DO UPDATE SET user_id=excluded.user_id,session_id=excluded.session_id,updated_at=now(),
  created_at=CASE WHEN native_reminder_devices.user_id=excluded.user_id THEN native_reminder_devices.created_at ELSE now() END;
 RETURN true;
END $$;

REVOKE ALL ON FUNCTION iig_private.side_invite_player(bigint,uuid),iig_private.capture_side_invites(),iig_private.side_invite_eligible(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.iig_set_side_invites(boolean,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.iig_set_side_invites(boolean,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.iig_claim_side_invites(integer),public.iig_authorize_side_invite(uuid,text,uuid),public.iig_finish_side_invite(uuid,text,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.iig_claim_side_invites(integer),public.iig_authorize_side_invite(uuid,text,uuid),public.iig_finish_side_invite(uuid,text,uuid,text) TO service_role;
COMMIT;
