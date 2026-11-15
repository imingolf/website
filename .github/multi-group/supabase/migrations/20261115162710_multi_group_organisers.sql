-- PRIVATE PREVIEW CANDIDATE: do not install on LIVE without release approval.
-- Preserve the existing closed private schema and owner-checked RPC boundary.
-- New public definers expose only this verified account's own groups, with fixed
-- search paths and explicit EXECUTE grants; no table/schema access is broadened.
BEGIN;
SET LOCAL lock_timeout='2s';

;
DO $audit$ BEGIN
IF md5(pg_get_functiondef('public.iig_create_owned_group(text,text,uuid)'::regprocedure)) IS DISTINCT FROM '5f25a233c99e7e4a6794923981df00b0' THEN RAISE EXCEPTION 'Audited function changed: public.iig_create_owned_group(text,text,uuid)'; END IF;
IF md5(pg_get_functiondef('public.iig_create_owned_playing_group(text,text,numeric,uuid)'::regprocedure)) IS DISTINCT FROM 'deaa0bd4612c4e6cdcb6c13fbe23adcd' THEN RAISE EXCEPTION 'Audited function changed: public.iig_create_owned_playing_group(text,text,numeric,uuid)'; END IF;
IF md5(pg_get_functiondef('public.iig_get_owned_group()'::regprocedure)) IS DISTINCT FROM 'f9f74c1010b53993e06401f91b7c7f8a' THEN RAISE EXCEPTION 'Audited function changed: public.iig_get_owned_group()'; END IF;
IF md5(pg_get_functiondef('public.iig_my_group_identity()'::regprocedure)) IS DISTINCT FROM 'af931d729ca6f6c3152ff60c17034338' THEN RAISE EXCEPTION 'Audited function changed: public.iig_my_group_identity()'; END IF;
IF md5(pg_get_functiondef('public.iig_read_entry_group(text)'::regprocedure)) IS DISTINCT FROM 'e79cdc8585fed8613d7cfad82ab6bc9a' THEN RAISE EXCEPTION 'Audited function changed: public.iig_read_entry_group(text)'; END IF;
END $audit$;
;

ALTER TABLE iig_private.group_owners DROP CONSTRAINT group_owners_owner_id_key;
ALTER TABLE iig_private.group_owners ADD CONSTRAINT group_owners_owner_request_key UNIQUE(owner_id,request_id);

;
CREATE OR REPLACE FUNCTION public.iig_create_owned_group(p_name text, p_organiser_name text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := iig_private.verified_organiser();
  v_existing iig_private.group_owners%rowtype;
  v_pin text; v_id bigint; v_try integer; v_name text := btrim(p_name);
begin
  if not exists(select 1 from iig_private.registration_settings where singleton and enabled)
     and not exists(select 1 from iig_private.setup_testers where user_id=v_uid)
  then raise exception 'Registration is not open yet' using errcode='42501'; end if;
  if p_request_id is null or v_name is null or length(v_name) not between 1 and 80
    or p_organiser_name is null or length(btrim(p_organiser_name)) not between 1 and 80
  then raise exception 'Enter a group name and organiser name (1–80 characters)'; end if;
  -- Serialise requests by account, including requests with different idempotency keys.
  perform 1 from auth.users where id=v_uid for update;
  select * into v_existing from iig_private.group_owners where owner_id=v_uid AND request_id=p_request_id;
  if found then
    if v_existing.request_id<>p_request_id or v_existing.requested_name<>v_name
    then raise exception 'This organiser already has a group'; end if;
    select group_pin into v_pin from public.tens_in_groups where id=v_existing.group_id;
    return jsonb_build_object('group_pin',v_pin,'group_id',v_existing.group_id);
  end if;
  IF EXISTS(SELECT 1 FROM iig_private.group_owners WHERE owner_id=v_uid) THEN RAISE EXCEPTION 'This organiser already has a group'; END IF;
  for v_try in 1..100 loop
    v_pin := (1000+floor(random()*9000))::integer::text;
    IF v_pin IN ('1010','2026') THEN CONTINUE; END IF;
    begin
      -- Plus is included free for now; retain creation/notification hooks and unpaid metadata.
      insert into public.tens_in_groups(group_name,group_pin,state,admin_name,admin_contact,plan_type,trial_expiry_date)
      values(v_name,v_pin,jsonb_build_object('groupName',v_name,'course','','date','',
        'stake',0,'gameType','money','roundOpen',false,'pointsCompetition','stableford',
        'pointsValue',10,'players','[]'::jsonb,'history','[]'::jsonb),
        btrim(p_organiser_name),(select email from auth.users where id=v_uid),'complimentary',NULL) returning id into v_id;
      exit;
    exception when unique_violation then
      if not exists(select 1 from public.tens_in_groups where group_pin=v_pin) then raise; end if;
      v_id := null;
    end;
  end loop;
  if v_id is null then raise exception 'No group PIN available; try again'; end if;
  insert into iig_private.group_owners(group_id,owner_id,request_id,requested_name,pin_join_enabled)
  values(v_id,v_uid,p_request_id,v_name,true);
  return jsonb_build_object('group_pin',v_pin,'group_id',v_id);
end $function$

;
CREATE OR REPLACE FUNCTION iig_private.create_additional_owned_group(p_name text, p_organiser_name text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := iig_private.verified_organiser();
  v_existing iig_private.group_owners%rowtype;
  v_pin text; v_id bigint; v_try integer; v_name text := btrim(p_name);
begin
  if not exists(select 1 from iig_private.registration_settings where singleton and enabled)
     and not exists(select 1 from iig_private.setup_testers where user_id=v_uid)
  then raise exception 'Registration is not open yet' using errcode='42501'; end if;
  if p_request_id is null or v_name is null or length(v_name) not between 1 and 80
    or p_organiser_name is null or length(btrim(p_organiser_name)) not between 1 and 80
  then raise exception 'Enter a group name and organiser name (1–80 characters)'; end if;
  -- Serialise requests by account, including requests with different idempotency keys.
  perform 1 from auth.users where id=v_uid for update;
  select * into v_existing from iig_private.group_owners where owner_id=v_uid AND request_id=p_request_id;
  if found then
    if v_existing.request_id<>p_request_id or v_existing.requested_name<>v_name
    then raise exception 'This organiser already has a group'; end if;
    select group_pin into v_pin from public.tens_in_groups where id=v_existing.group_id;
    return jsonb_build_object('group_pin',v_pin,'group_id',v_existing.group_id);
  end if;
  IF NOT EXISTS(SELECT 1 FROM iig_private.group_owners WHERE owner_id=v_uid) THEN RAISE EXCEPTION 'Create your first group before adding another'; END IF;
  for v_try in 1..100 loop
    v_pin := (1000+floor(random()*9000))::integer::text;
    IF v_pin IN ('1010','2026') THEN CONTINUE; END IF;
    begin
      -- Plus is included free for now; retain creation/notification hooks and unpaid metadata.
      insert into public.tens_in_groups(group_name,group_pin,state,admin_name,admin_contact,plan_type,trial_expiry_date)
      values(v_name,v_pin,jsonb_build_object('groupName',v_name,'course','','date','',
        'stake',0,'gameType','money','roundOpen',false,'pointsCompetition','stableford',
        'pointsValue',10,'players','[]'::jsonb,'history','[]'::jsonb),
        btrim(p_organiser_name),(select email from auth.users where id=v_uid),'complimentary',NULL) returning id into v_id;
      exit;
    exception when unique_violation then
      if not exists(select 1 from public.tens_in_groups where group_pin=v_pin) then raise; end if;
      v_id := null;
    end;
  end loop;
  if v_id is null then raise exception 'No group PIN available; try again'; end if;
  insert into iig_private.group_owners(group_id,owner_id,request_id,requested_name,pin_join_enabled)
  values(v_id,v_uid,p_request_id,v_name,true);
  return jsonb_build_object('group_pin',v_pin,'group_id',v_id);
end $function$

;
CREATE OR REPLACE FUNCTION public.iig_read_owned_entry_group(p_pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE uid uuid=iig_private.verified_organiser();g record;r iig_closed_entry.rounds;result jsonb;entry jsonb;pin text;
BEGIN
 IF p_pin IS NULL OR p_pin !~ '^[0-9]{4}$' THEN RAISE EXCEPTION 'Choose a group' USING ERRCODE='22023'; END IF;
 pin:=p_pin;
 SELECT * INTO g FROM iig_private.lock_release(pin,NULL,'owner');
 result:=jsonb_build_object('group_pin',pin,'revision',g.revision,'state',g.state,'invite_token',
   (SELECT invite_token FROM iig_private.group_owners WHERE group_id=g.group_id));
 SELECT * INTO r FROM iig_closed_entry.rounds WHERE group_id=g.group_id::text;
 IF FOUND THEN entry:=jsonb_build_object('open',r.phase='open','closed',r.closed,'entrantIds',r.entrant_ids);
 ELSE entry:=jsonb_build_object('open',iig_closed_entry.round_is_open(g.state),'closed',iig_closed_entry.has_score(g.state),'entrantIds',
  CASE WHEN iig_closed_entry.has_score(g.state) THEN (SELECT coalesce(jsonb_agg(p->'id'),'[]') FROM jsonb_array_elements(g.state->'players') p WHERE iig_closed_entry.eligible(g.state,p)) ELSE NULL END);END IF;
 RETURN result||jsonb_build_object('entry',entry,'plan_type',(SELECT plan_type FROM public.tens_in_groups WHERE id=g.group_id));
END $function$

;
CREATE OR REPLACE FUNCTION public.iig_read_entry_group(p_pin text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE uid uuid=iig_private.verified_organiser();g record;r iig_closed_entry.rounds;result jsonb;entry jsonb;pin text;
BEGIN
 IF p_pin IS NULL THEN
  IF (SELECT count(*) FROM iig_private.group_owners WHERE owner_id=uid)>1 THEN RAISE EXCEPTION 'Choose a group before opening organiser access' USING ERRCODE='22023'; END IF;
  SELECT groups.group_pin INTO pin FROM public.tens_in_groups groups JOIN iig_private.group_owners o ON o.group_id=groups.id WHERE o.owner_id=uid;
  IF pin IS NULL THEN RETURN NULL;END IF;
 ELSE pin:=p_pin;END IF;
 SELECT * INTO g FROM iig_private.lock_release(pin,NULL,CASE WHEN p_pin IS NULL THEN 'owner' ELSE 'member' END);
 IF p_pin IS NULL THEN
  result:=jsonb_build_object('group_pin',pin,'revision',g.revision,'state',g.state,'invite_token',
    (SELECT invite_token FROM iig_private.group_owners WHERE group_id=g.group_id));
 ELSE
  result:=jsonb_build_object('player_id',g.player_id,'revision',g.revision,'state',
   iig_closed_entry.member_view(g.state,g.player_id)||jsonb_build_object('sideGameDate',to_char(now() AT TIME ZONE 'Europe/London','YYYY-MM-DD')));
 END IF;
 SELECT * INTO r FROM iig_closed_entry.rounds WHERE group_id=g.group_id::text;
 IF FOUND THEN entry:=jsonb_build_object('open',r.phase='open','closed',r.closed,'entrantIds',r.entrant_ids);
 ELSE entry:=jsonb_build_object('open',iig_closed_entry.round_is_open(g.state),'closed',iig_closed_entry.has_score(g.state),'entrantIds',
  CASE WHEN iig_closed_entry.has_score(g.state) THEN (SELECT coalesce(jsonb_agg(p->'id'),'[]') FROM jsonb_array_elements(g.state->'players') p WHERE iig_closed_entry.eligible(g.state,p)) ELSE NULL END);END IF;
 RETURN result||jsonb_build_object('entry',entry,'plan_type',(SELECT plan_type FROM public.tens_in_groups WHERE id=g.group_id));
END $function$

;
CREATE OR REPLACE FUNCTION public.iig_get_owned_group()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := iig_private.verified_organiser(); v_result jsonb;
begin
 IF (SELECT count(*) FROM iig_private.group_owners WHERE owner_id=v_uid)>1 THEN RAISE EXCEPTION 'Choose a group before opening organiser access' USING ERRCODE='22023'; END IF;
  select jsonb_build_object('group_pin',g.group_pin,'group_id',g.id,'state',g.state,
    'revision',o.revision,'invite_token',o.invite_token) into v_result
  from iig_private.group_owners o join public.tens_in_groups g on g.id=o.group_id
  where o.owner_id=v_uid;
  if v_result is not null then perform iig_private.check_group_access(v_result->>'group_pin'); end if;
  return v_result;
end $function$

;
CREATE OR REPLACE FUNCTION public.iig_my_group_identity()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid=iig_private.verified_organiser(); out jsonb;
begin
 IF (SELECT count(*) FROM iig_private.group_owners WHERE owner_id=uid)>1 THEN RAISE EXCEPTION 'Choose a group before opening organiser access' USING ERRCODE='22023'; END IF;
 select jsonb_build_object('group_pin',g.group_pin,'plan_type',g.plan_type) into out
 from public.tens_in_groups g join iig_private.group_owners o on o.group_id=g.id where o.owner_id=uid;
 if out is not null then perform iig_private.release_access((select group_id from iig_private.group_owners where owner_id=uid)); end if;
 return out;
end $function$

;
CREATE OR REPLACE FUNCTION public.iig_create_owned_playing_group(p_name text, p_organiser_name text, p_handicap numeric, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE created jsonb; owned jsonb; member jsonb; player_id text;
BEGIN
 IF p_handicap IS NULL OR p_handicap NOT BETWEEN -10 AND 60 OR p_handicap<>round(p_handicap,1) THEN
  RAISE EXCEPTION 'Enter your handicap from -10 to 60, with up to one decimal place.' USING ERRCODE='22023';
 END IF;
 -- The established writer verifies the account, registration policy and retry key.
 created:=public.iig_create_owned_group(p_name,p_organiser_name,p_request_id);
 owned:=public.iig_read_owned_entry_group(created->>'group_pin');
 IF owned IS NULL OR owned->>'group_pin' IS DISTINCT FROM created->>'group_pin' OR owned->>'invite_token' IS NULL THEN
  RAISE EXCEPTION 'Your new group could not be confirmed. Please try again.';
 END IF;
 -- Same verified membership operation used by the existing player setup. A retry
 -- returns the linked player instead of adding a duplicate. Both writes commit together.
 player_id:=public.iig_join_release_group(owned->>'group_pin',(owned->>'invite_token')::uuid,p_organiser_name,p_handicap);
 member:=public.iig_read_entry_group(owned->>'group_pin');
 IF player_id IS NULL OR member->>'player_id' IS DISTINCT FROM player_id
 OR (SELECT count(*) FROM jsonb_array_elements(member->'state'->'players') p WHERE p->>'id'=player_id)<>1 THEN
  RAISE EXCEPTION 'Your player profile could not be confirmed. Please try again.';
 END IF;
 RETURN created||jsonb_build_object('player_id',player_id);
END $function$

;
CREATE OR REPLACE FUNCTION public.iig_create_additional_playing_group(p_name text, p_organiser_name text, p_handicap numeric, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE created jsonb; owned jsonb; member jsonb; player_id text;
BEGIN
 IF p_handicap IS NULL OR p_handicap NOT BETWEEN -10 AND 60 OR p_handicap<>round(p_handicap,1) THEN
  RAISE EXCEPTION 'Enter your handicap from -10 to 60, with up to one decimal place.' USING ERRCODE='22023';
 END IF;
 -- The established writer verifies the account, registration policy and retry key.
 created:=iig_private.create_additional_owned_group(p_name,p_organiser_name,p_request_id);
 owned:=public.iig_read_owned_entry_group(created->>'group_pin');
 IF owned IS NULL OR owned->>'group_pin' IS DISTINCT FROM created->>'group_pin' OR owned->>'invite_token' IS NULL THEN
  RAISE EXCEPTION 'Your new group could not be confirmed. Please try again.';
 END IF;
 -- Same verified membership operation used by the existing player setup. A retry
 -- returns the linked player instead of adding a duplicate. Both writes commit together.
 player_id:=public.iig_join_release_group(owned->>'group_pin',(owned->>'invite_token')::uuid,p_organiser_name,p_handicap);
 member:=public.iig_read_entry_group(owned->>'group_pin');
 IF player_id IS NULL OR member->>'player_id' IS DISTINCT FROM player_id
 OR (SELECT count(*) FROM jsonb_array_elements(member->'state'->'players') p WHERE p->>'id'=player_id)<>1 THEN
  RAISE EXCEPTION 'Your player profile could not be confirmed. Please try again.';
 END IF;
 RETURN created||jsonb_build_object('player_id',player_id);
END $function$

;
CREATE FUNCTION public.iig_list_owned_groups()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE uid uuid=iig_private.verified_organiser(); result jsonb;
BEGIN
 SELECT coalesce(jsonb_agg(jsonb_build_object('group_pin',g.group_pin,'group_name',g.group_name,
   'retired',r.retired_at IS NOT NULL,'status',g.status) ORDER BY lower(g.group_name),g.id),'[]'::jsonb)
 INTO result FROM iig_private.group_owners o JOIN public.tens_in_groups g ON g.id=o.group_id
 LEFT JOIN iig_private.release_groups r ON r.group_id=g.id WHERE o.owner_id=uid;
 RETURN result;
END $$;

;
REVOKE ALL ON FUNCTION iig_private.create_additional_owned_group(text,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.iig_list_owned_groups(),public.iig_read_owned_entry_group(text),public.iig_create_additional_playing_group(text,text,numeric,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.iig_list_owned_groups(),public.iig_read_owned_entry_group(text),public.iig_create_additional_playing_group(text,text,numeric,uuid) TO authenticated;
COMMIT;
