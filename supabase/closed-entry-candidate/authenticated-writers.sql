-- OFFLINE TEST REVIEW CANDIDATE, not an installer. Load after boundary.sql in
-- fictional fixtures only. Requires the existing iig_private TEST account schema.
-- Reuses registration branch 38f81215331224079aa7c19ba6e5de0dbc4bcb2e:
-- integration-hardening.sql and protected-gameplay.sql narrow writer checks.
-- Does not replace Auth, access helpers, getters, RLS, policies or notifications.
-- Exact saved TEST definitions/ACLs/dependencies must be bound by the installer.

CREATE OR REPLACE FUNCTION iig_closed_entry.require_legacy_group(g text) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM iig_private.group_owners WHERE group_id::text=g)
 THEN RAISE EXCEPTION 'USE_AUTHENTICATED_GROUP_API' USING ERRCODE='42501';END IF;
END $$;

-- Keep the account writer lock order: account, owner revision, canonical
-- group, private round. Transfer/join and member writes serialise on the same owner.
CREATE FUNCTION iig_closed_entry.lock_authenticated(p_pin text,p_revision bigint,p_authority text,p_invite uuid DEFAULT NULL)
RETURNS TABLE(group_id bigint,revision bigint,player_id uuid,state jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE uid uuid;o iig_private.group_owners;g public.tens_in_groups;pid uuid;
BEGIN
 IF p_authority IS NULL OR p_authority NOT IN ('owner','member','join') THEN RAISE EXCEPTION 'INVALID_AUTHORITY';END IF;
 IF p_authority='member' THEN
  -- Saved TEST member authority is the authenticated account-to-player mapping,
  -- not the organiser registration policy. Auth still validates the session;
  -- this RPC adds no email/anonymous/ban-status requirement to membership.
  uid:=auth.uid();
  IF uid IS NULL THEN RAISE EXCEPTION 'Member sign-in required' USING ERRCODE='42501';END IF;
  PERFORM 1 FROM auth.users WHERE id=uid FOR UPDATE;
  IF NOT FOUND OR EXISTS(SELECT 1 FROM iig_private.account_deletions WHERE user_id=uid)
  THEN RAISE EXCEPTION 'Member sign-in required' USING ERRCODE='42501';END IF;
 ELSE uid:=iig_private.verified_organiser();END IF;
 SELECT owners.* INTO o FROM iig_private.group_owners owners JOIN public.tens_in_groups groups ON groups.id=owners.group_id
 WHERE groups.group_pin=p_pin FOR UPDATE OF owners;
 IF NOT FOUND THEN RAISE EXCEPTION 'Group membership required' USING ERRCODE='42501';END IF;
 IF p_authority='owner' AND o.owner_id IS DISTINCT FROM uid THEN RAISE EXCEPTION 'Organiser access required' USING ERRCODE='42501';END IF;
 IF p_authority='join' AND (p_invite IS NULL OR o.invite_token IS DISTINCT FROM p_invite) THEN RAISE EXCEPTION 'Invitation is invalid' USING ERRCODE='42501';END IF;
 SELECT m.player_id INTO pid FROM iig_private.group_members m WHERE m.group_id=o.group_id AND m.user_id=uid FOR SHARE;
 IF p_authority='member' AND pid IS NULL THEN RAISE EXCEPTION 'Group membership required' USING ERRCODE='42501';END IF;
 PERFORM iig_private.check_group_access(p_pin);
 IF p_authority<>'join' AND (p_revision IS NULL OR p_revision<>o.revision) THEN RAISE EXCEPTION 'Group changed; reload before saving' USING ERRCODE='40001';END IF;
 SELECT * INTO g FROM public.tens_in_groups WHERE id=o.group_id AND group_pin=p_pin FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Group changed; reload before saving' USING ERRCODE='40001';END IF;
 IF p_authority<>'owner' AND pid IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(g.state->'players') p WHERE p->>'id'=pid::text)
 THEN RAISE EXCEPTION 'Player no longer in group' USING ERRCODE='42501';END IF;
 RETURN QUERY SELECT o.group_id,o.revision,pid,g.state;
END $$;

-- Called only by the authenticated writers below, after their identity/action
-- checks. No public EXECUTE, no GUC authority, no retry and no trigger disabling.
CREATE FUNCTION iig_closed_entry.write_authenticated(gid bigint,rev bigint,op text,s jsonb,actor text DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE old_s jsonb;r iig_closed_entry.rounds;next_rev bigint;affected bigint;
BEGIN
 PERFORM 1 FROM iig_private.group_owners WHERE group_id=gid AND revision=rev FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Group changed; reload before saving' USING ERRCODE='40001';END IF;
 SELECT state INTO old_s FROM public.tens_in_groups WHERE id=gid FOR UPDATE;
 IF op NOT IN ('member_attendance','member_score') AND
  (s IS NULL OR jsonb_typeof(s)<>'object' OR jsonb_typeof(s->'players') IS DISTINCT FROM 'array'
  OR jsonb_typeof(s->'history') IS DISTINCT FROM 'array' OR s ?| ARRAY['adminPin','adminSetupToken'] OR octet_length(s::text)>1048576)
 THEN RAISE EXCEPTION 'Invalid group state';END IF;
 PERFORM iig_closed_entry.initialise(gid::text,old_s);
 SELECT * INTO r FROM iig_closed_entry.rounds WHERE group_id=gid::text FOR UPDATE;
 IF op IN ('member_attendance','member_score') THEN
  IF r.phase<>'open' THEN RAISE EXCEPTION 'ROUND_NOT_OPEN';END IF;
  -- Validate even identical attendance requests, which do not run the row guard.
  -- The row guard repeats this exact field check before any changed state persists.
  PERFORM iig_closed_entry.validate_member_update(old_s,s,op,actor,r.closed,r.entrant_ids);
 END IF;
 INSERT INTO iig_closed_entry.permits VALUES(pg_backend_pid(),gid::text,pg_current_xact_id()::text,op,r.revision,iig_closed_entry.digest(s),true,actor)
 ON CONFLICT(backend,group_id) DO UPDATE SET transaction_id=excluded.transaction_id,operation=excluded.operation,
 expected_revision=excluded.expected_revision,state_digest=excluded.state_digest,available=true,actor_id=excluded.actor_id;
 UPDATE public.tens_in_groups SET state=s,updated_at=now() WHERE id=gid;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>1 OR (SELECT state FROM public.tens_in_groups WHERE id=gid) IS DISTINCT FROM s
  OR (SELECT revision FROM iig_closed_entry.rounds WHERE group_id=gid::text)
   IS DISTINCT FROM (r.revision+CASE WHEN old_s IS DISTINCT FROM s THEN 1 ELSE 0 END)
  OR (old_s IS DISTINCT FROM s AND EXISTS(SELECT 1 FROM iig_closed_entry.permits WHERE backend=pg_backend_pid() AND group_id=gid::text AND available))
 THEN RAISE EXCEPTION 'AUTHENTICATED_WRITE_NOT_APPLIED';END IF;
 -- An identical-state update still runs the original hooks and increments the
 -- existing account revision, as before; never leave a usable no-op permit.
 UPDATE iig_closed_entry.permits SET available=false WHERE backend=pg_backend_pid() AND group_id=gid::text;
 UPDATE iig_private.group_owners SET revision=revision+1 WHERE group_id=gid RETURNING revision INTO next_rev;
 IF next_rev IS DISTINCT FROM rev+1 THEN RAISE EXCEPTION 'AUTHENTICATED_REVISION_NOT_APPLIED';END IF;
 RETURN next_rev;
END $$;

-- Existing whole-state signature remains deliberately limited to an ordinary
-- save. It must never guess finish/start/correction from a JSON diff.
CREATE OR REPLACE FUNCTION public.iig_save_owned_group(p_pin text,p_state jsonb,p_revision bigint)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE g record;
BEGIN
 SELECT * INTO g FROM iig_closed_entry.lock_authenticated(p_pin,p_revision,'owner');
 RETURN iig_closed_entry.write_authenticated(g.group_id,g.revision,'save',p_state);
END $$;

-- Candidate-local projection, adapted from the existing protected gameplay
-- allowlist. Never replace the installed getters or their access checks. Unknown
-- fields (including future profile/security fields) are omitted at every depth.
-- Private payout links belong only to the named winner; Side Game records belong
-- only to their participants. No arbitrary nested JSON is returned unchanged.
CREATE FUNCTION iig_closed_entry.member_view(v jsonb,pid text,context text DEFAULT 'state',depth integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE k text;x jsonb;out jsonb='{}';
BEGIN
 IF depth>24 THEN RAISE EXCEPTION 'MEMBER_PROJECTION_TOO_DEEP';END IF;
 IF jsonb_typeof(v)='array' THEN
  RETURN coalesce((SELECT jsonb_agg(iig_closed_entry.member_view(value,pid,context,depth+1) ORDER BY ordinality)
   FROM jsonb_array_elements(v) WITH ORDINALITY),'[]');
 END IF;
 IF jsonb_typeof(v) IS DISTINCT FROM 'object' THEN RETURN v;END IF;
 FOR k,x IN SELECT * FROM jsonb_each(v) LOOP
  IF context='state' AND NOT k=ANY(ARRAY['groupName','roundId','course','date','stake','gameType','pointsCompetition',
   'pointsValue','roundOpen','players','history','splitPrizes','firstPrize','secondPrize','thirdPrize','paymentLink',
   'paymentProvider','trip','sideGame']) THEN CONTINUE;END IF;
  IF context='players' AND NOT k=ANY(ARRAY['id','name','handicap','paid','playingThisRound','stableford','netScore',
   'noReturn','scoreSubmitted','competition','leaguePoints','wins','netWinnings','tripPointsExcluded']) THEN CONTINUE;END IF;
  IF k='paymentLink' OR (context='payouts' AND k='paymentProvider') THEN
   IF (context='state' OR (context='payouts' AND v->>'winnerPlayerId'=pid)) AND jsonb_typeof(x)='string'
   THEN out=out||jsonb_build_object(k,x);END IF;
  ELSIF context='sideGame' THEN
   IF k='bets' AND jsonb_typeof(x)='array' THEN
    SELECT coalesce(jsonb_agg(iig_closed_entry.member_view(b,pid,'bets',depth+1) ORDER BY n),'[]') INTO x
    FROM jsonb_array_elements(x) WITH ORDINALITY a(b,n) WHERE pid IN(b->>'player1Id',b->>'player2Id');
   ELSIF k='scores' AND jsonb_typeof(x)='array' THEN
    SELECT coalesce(jsonb_agg(iig_closed_entry.member_view(b,pid,'scores',depth+1) ORDER BY n),'[]') INTO x
    FROM jsonb_array_elements(x) WITH ORDINALITY a(b,n) WHERE b->>'playerId'=pid OR EXISTS(
     SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v->'bets')='array' THEN v->'bets' ELSE '[]' END) bet
     WHERE pid IN(bet->>'player1Id',bet->>'player2Id') AND b->>'playerId' IN(bet->>'player1Id',bet->>'player2Id') AND b->>'date'=bet->>'date');
   ELSIF k='settlements' AND jsonb_typeof(x)='array' THEN
    SELECT coalesce(jsonb_agg(iig_closed_entry.member_view(b,pid,'settlements',depth+1) ORDER BY n),'[]') INTO x
    FROM jsonb_array_elements(x) WITH ORDINALITY a(b,n) WHERE pid IN(b->>'debtorId',b->>'creditorId');
   ELSE CONTINUE;END IF;
   out=out||jsonb_build_object(k,x);
  ELSIF k=ANY(ARRAY['standings','teamStandings','currentTeamScores']) AND jsonb_typeof(x)='object' THEN
   out=out||jsonb_build_object(k,(SELECT coalesce(jsonb_object_agg(key,value),'{}') FROM jsonb_each(x) WHERE jsonb_typeof(value)='number'));
  ELSIF k=ANY(ARRAY['players','history','payouts','prizePlaces','winners','stablefordWinnerNames','netWinnerNames','stablefordCountback',
   'netCountback','pointsResults','trip','plan','rounds','playerIds','currentPlayingIds','currentGroups','currentTeams',
   'teams','groups','playingIds','teamResults','winnerTeamIds','winnerNames','winnerPlayerNames','notPlayingNames',
   'champion','pointsChampion','teamChampion','tripTieNames','pastTrips','countback']) OR (context='state' AND k='sideGame') THEN
   out=out||jsonb_build_object(k,iig_closed_entry.member_view(x,pid,k,depth+1));
  ELSIF k=ANY(ARRAY['id','name','groupName','roundId','course','date','stake','gameType','pointsCompetition','pointsValue',
   'roundOpen','paid','playingThisRound','competition','handicap','stableford','netScore','noReturn','scoreSubmitted',
   'leaguePoints','wins','netWinnings','splitPrizes','firstPrize','secondPrize','thirdPrize','prizePlaces',
   'winnerPlayerId','winnerName','amount','status','paymentProvider','claimedAt','paidAt','position','score','points',
   'stablefordPot','netPot','stablefordSplit','netSplit','active','completed','totalRounds','currentRound','currentFormat','format','teamPot',
   'sharedWin','tripPointsValue','tripPointsEnabled','tripPointsExcluded','teamEventPointsAwarded','tripFormat',
   'player1Id','player2Id','player1Name','player2Name','playerId','playerName','setup','createdAt','acceptedAt','declinedAt',
   'resolvedAt','updatedAt','result','winnerId','loserId','debtorId','creditorId','debtorName','creditorName','requestedAt','confirmedAt'])
   AND jsonb_typeof(x) IN('string','number','boolean','null') THEN out=out||jsonb_build_object(k,x);
  END IF;
 END LOOP;
 RETURN out;
END $$;
REVOKE ALL ON FUNCTION iig_closed_entry.member_view(jsonb,text,text,integer) FROM PUBLIC,anon,authenticated,service_role;

-- Preserve the installed owner projection and both getters' access checks. Read
-- closure metadata at the same locked account revision, including after score
-- resets. NULL pin means the caller's existing owned group, never a PIN claim.
-- This read does not initialise or modify private guard records.
CREATE FUNCTION public.iig_read_entry_group(p_pin text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;g record;r iig_closed_entry.rounds;entry jsonb;closed boolean;
BEGIN
 IF p_pin IS NULL THEN result:=public.iig_get_owned_group();
 ELSE result:=public.iig_get_player_group(p_pin);END IF;
 IF result IS NULL THEN RETURN NULL;END IF;
 SELECT * INTO g FROM iig_closed_entry.lock_authenticated(coalesce(p_pin,result->>'group_pin'),
  (result->>'revision')::bigint,CASE WHEN p_pin IS NULL THEN 'owner' ELSE 'member' END);
 IF p_pin IS NULL THEN result:=public.iig_get_owned_group();
 ELSE result:=public.iig_get_player_group(p_pin);END IF;
 IF (result->>'revision')::bigint IS DISTINCT FROM g.revision THEN RAISE EXCEPTION 'READ_REVISION_CHANGED';END IF;
 IF p_pin IS NOT NULL THEN
  IF result->>'player_id' IS DISTINCT FROM g.player_id::text THEN RAISE EXCEPTION 'READ_MEMBER_CHANGED';END IF;
  result:=jsonb_build_object('player_id',g.player_id,'revision',g.revision,
   'plan_type',(SELECT plan_type FROM public.tens_in_groups WHERE id=g.group_id),
   'state',iig_closed_entry.member_view(g.state,g.player_id::text)||jsonb_build_object(
    'sideGameDate',to_char(now() AT TIME ZONE 'Europe/London','YYYY-MM-DD')));
 END IF;
 SELECT * INTO r FROM iig_closed_entry.rounds WHERE group_id=g.group_id::text;
 IF FOUND THEN
  entry:=jsonb_build_object('open',r.phase='open','closed',r.closed,'entrantIds',r.entrant_ids);
 ELSE
  closed:=iig_closed_entry.has_score(g.state);
  entry:=jsonb_build_object('open',iig_closed_entry.round_is_open(g.state),'closed',closed,
   'entrantIds',CASE WHEN closed THEN (SELECT coalesce(jsonb_agg(p->'id'),'[]') FROM jsonb_array_elements(g.state->'players') p WHERE iig_closed_entry.eligible(g.state,p)) ELSE NULL END);
 END IF;
 RETURN result||jsonb_build_object('entry',entry);
END $$;

-- Reuse the existing server-derived maintenance proposals. A proposal does not
-- write; the subsequent explicit operation must still match this exact revision.
CREATE FUNCTION public.iig_prepare_owned_entry(p_pin text,p_operation text,p_revision bigint,p_selection integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE g record;
BEGIN
 SELECT * INTO g FROM iig_closed_entry.lock_authenticated(p_pin,p_revision,'owner');
 IF p_operation='resetpayments' AND (iig_closed_entry.has_score(g.state) OR EXISTS(
  SELECT 1 FROM iig_closed_entry.rounds WHERE group_id=g.group_id::text AND closed)) THEN RAISE EXCEPTION 'ENTRIES_CLOSED';END IF;
 RETURN iig_closed_entry.derive_operation(g.state,p_operation,p_selection);
END $$;

-- The existing organiser controls must explicitly name their validated action
-- when the compatible TEST client is separately prepared. No UI changes here.
CREATE FUNCTION public.iig_operate_owned_group(p_pin text,p_operation text,p_state jsonb,p_revision bigint)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE g record;
BEGIN
 IF p_operation IS NULL OR p_operation NOT IN ('payment','finish','start','correct','cancel','settings','members','settle','tripreturn','tripcancel','resetscores','resetpayments','deletelast','clearleague','deletepasttrip','configure')
 THEN RAISE EXCEPTION 'EXPLICIT_ORGANISER_OPERATION_REQUIRED';END IF;
 SELECT * INTO g FROM iig_closed_entry.lock_authenticated(p_pin,p_revision,'owner');
 IF p_operation IN ('start','tripreturn','tripcancel') THEN p_state:=jsonb_set(p_state,'{roundId}',to_jsonb(gen_random_uuid()::text));END IF;
 RETURN iig_closed_entry.write_authenticated(g.group_id,g.revision,p_operation,p_state);
END $$;

CREATE OR REPLACE FUNCTION public.iig_join_owned_group(p_pin text,p_invite uuid,p_name text,p_handicap numeric)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE g record;pid uuid;s jsonb;
BEGIN
 SELECT * INTO g FROM iig_closed_entry.lock_authenticated(p_pin,NULL,'join',p_invite);
 IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 80 OR p_handicap IS NULL
  OR p_handicap NOT BETWEEN -10 AND 60 OR p_handicap<>round(p_handicap,1) THEN RAISE EXCEPTION 'Invalid player name or handicap';END IF;
 IF g.player_id IS NOT NULL THEN RETURN g.player_id;END IF;
 IF jsonb_array_length(g.state->'players')>=200 THEN RAISE EXCEPTION 'Test group capacity reached';END IF;
 INSERT INTO iig_private.group_members(group_id,user_id) VALUES(g.group_id,auth.uid()) RETURNING player_id INTO pid;
 s:=jsonb_set(g.state,'{players}',(g.state->'players')||jsonb_build_array(jsonb_build_object('id',pid,'name',btrim(p_name),'handicap',p_handicap,
  'paid',false,'stableford',NULL,'netScore',NULL,'playingThisRound',false)));
 PERFORM iig_closed_entry.write_authenticated(g.group_id,g.revision,'join',s,pid::text);
 RETURN pid;
END $$;

-- Saved TEST member field contract, with the central closure/payment protection.
create or replace function public.iig_set_my_attendance(p_pin text,p_attending boolean,p_revision bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_id bigint; v_player uuid; v_state jsonb; v_revision bigint; v_players jsonb;
begin
  select group_id,revision,player_id,state into v_id,v_revision,v_player,v_state
    from iig_closed_entry.lock_authenticated(p_pin,p_revision,'member');
  if p_attending is null or p_revision is null or p_revision<>v_revision
  then raise exception 'Group changed; reload before saving' using errcode='40001'; end if;
  if v_state->'roundOpen' is distinct from 'true'::jsonb or iig_closed_entry.has_score(v_state)
  then raise exception 'Entries are closed'; end if;
  if not exists(select 1 from jsonb_array_elements(v_state->'players') p where p->>'id'=v_player::text)
  then raise exception 'Player no longer in group' using errcode='42501'; end if;
  select jsonb_agg(case when p->>'id'=v_player::text
    then p || jsonb_build_object('playingThisRound',p_attending) else p end order by pos)
    into v_players from jsonb_array_elements(v_state->'players') with ordinality as entries(p,pos);
  v_revision:=iig_closed_entry.write_authenticated(v_id,v_revision,'member_attendance',jsonb_set(v_state,'{players}',v_players),v_player::text);
  return v_revision;
end $$;

create or replace function public.iig_submit_my_score(
  p_pin text, p_score integer, p_format text, p_revision bigint
) returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_id bigint; v_player uuid; v_state jsonb; v_me jsonb;
  v_revision bigint; v_players jsonb; v_field text;
begin
  select group_id,revision,player_id,state into v_id,v_revision,v_player,v_state
    from iig_closed_entry.lock_authenticated(p_pin,p_revision,'member');
  if p_revision is null or p_revision<>v_revision then
    raise exception 'Group changed; reload before submitting' using errcode='40001';
  end if;
  if v_state->'roundOpen' is distinct from 'true'::jsonb
    or nullif(btrim(v_state->>'course'),'') is null
    or nullif(v_state->>'date','') is null then raise exception 'Scoring is closed'; end if;
  if p_format is null or p_format not in ('stableford','net')
    or p_format is distinct from v_state->>'pointsCompetition' then
    raise exception 'Competition format changed; reload before submitting';
  end if;
  if p_score is null or p_score<0 or p_score>(case when p_format='net' then 999 else 99 end) then
    raise exception 'Invalid final score';
  end if;
  select p into v_me from jsonb_array_elements(v_state->'players') p where p->>'id'=v_player::text;
  if v_me is null then raise exception 'Player no longer in group' using errcode='42501';end if;
  if v_me->'scoreSubmitted'='true'::jsonb or v_me->'noReturn'='true'::jsonb
    or v_me->>'stableford' is not null or v_me->>'netScore' is not null then
    raise exception 'A result is already recorded. Ask your organiser about corrections.';
  end if;
  v_field := case when p_format='net' then 'netScore' else 'stableford' end;
  select jsonb_agg(case when p->>'id'=v_player::text then
    p || jsonb_build_object(v_field,p_score,'scoreSubmitted',true)
    else p end order by pos) into v_players
  from jsonb_array_elements(v_state->'players') with ordinality as entries(p,pos);
  v_revision:=iig_closed_entry.write_authenticated(v_id,v_revision,'member_score',jsonb_set(v_state,'{players}',v_players),v_player::text);
  return v_revision;
end $$;

create or replace function public.iig_player_action(p_pin text,p_action text,p_payload jsonb,p_revision bigint)
returns bigint language plpgsql security definer set search_path='' as $$
declare gid bigint; rev bigint; pid uuid; s jsonb; me jsonb; other jsonb; item jsonb; arr jsonb; sg jsonb;
 fmt text; team jsonb; eligible boolean; val numeric; day text=to_char(now() at time zone 'Europe/London','YYYY-MM-DD');
 field text; ident text; balance numeric; before_score boolean; provider text;
begin
 select group_id,revision,player_id,state into gid,rev,pid,s from iig_closed_entry.lock_authenticated(p_pin,p_revision,'member');
 if p_revision is null or p_revision<>rev then raise exception 'Group changed; reload before saving' using errcode='40001'; end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>4096 then raise exception 'Invalid action'; end if;
 -- Reuse the same field contract for current clients and older narrow RPC calls.
 -- No whole-state/client player ID is accepted by either endpoint.
 if p_action in ('attendance','score') then
  if coalesce(p_payload->>'round_id','')<>coalesce(s->>'roundId','') then raise exception 'Competition changed; reload before saving' using errcode='40001';end if;
  if p_action='attendance' then
   if jsonb_typeof(p_payload->'attending') is distinct from 'boolean' then raise exception 'Invalid attendance';end if;
   return public.iig_set_my_attendance(p_pin,(p_payload->>'attending')::boolean,p_revision);
  end if;
  val=(p_payload->>'score')::numeric;
  if val is null or val<>trunc(val) or val<0 or val>999 then raise exception 'Invalid final score';end if;
  return public.iig_submit_my_score(p_pin,val::integer,p_payload->>'format',p_revision);
 end if;
 select p into me from jsonb_array_elements(s->'players') p where p->>'id'=pid::text;
 if me is null then raise exception 'Player no longer in group' using errcode='42501'; end if;
 fmt=coalesce(s->>'pointsCompetition','stableford');
 eligible=not coalesce((s->'trip'->>'active')::boolean,false) or exists(
 select 1 from jsonb_array_elements_text(coalesce(s->'trip'->'currentPlayingIds',s->'trip'->'playerIds','[]')) x where x=pid::text);
 before_score=not exists(select 1 from jsonb_array_elements(s->'players') p where p->>'stableford' is not null or p->>'netScore' is not null or p->'scoreSubmitted'='true' or p->'noReturn'='true')
 and not exists(select 1 from jsonb_each(coalesce(s->'trip'->'currentTeamScores','{}')) where value<>'null')
 and not coalesce((select closed from iig_closed_entry.rounds where group_id=gid::text),false);
 if p_action in ('payment','no_return','team_score') then
  if s->>'gameType' not in ('points','money') or s->>'gameType' is null then raise exception 'Unknown competition type'; end if;
  if s->'roundOpen' is distinct from 'true'::jsonb or not eligible or nullif(btrim(s->>'course'),'') is null or nullif(s->>'date','') is null
  then raise exception 'This competition is closed or you are not playing today'; end if;
  if coalesce(p_payload->>'round_id','')<>coalesce(s->>'roundId','') then raise exception 'Competition changed; reload before saving' using errcode='40001'; end if;
 end if;
 if p_action in ('side_create','side_accept') and exists(select 1 from public.tens_in_groups where id=gid and plan_type='free') then raise exception 'Side Game requires I’m In Golf+'; end if;
 if p_action='payment' then
  if s->>'gameType' is distinct from 'money' or not before_score then raise exception 'Payment entry is closed'; end if;
  if p_payload->'confirmed' is distinct from 'true'::jsonb then raise exception 'Confirm your own payment first'; end if;
  me=me||jsonb_build_object('paid',true,'paymentMarkedAt',now(),'paymentMarkMethod','player-confirmed');
 elsif p_action in ('no_return','team_score') then
  if s->>'gameType'='money' and coalesce((s->>'stake')::numeric,0)>0 and me->'paid' is distinct from 'true'::jsonb then raise exception 'Pay before submitting a score'; end if;
  if s->>'gameType'='points' and s->'trip'->'active' is distinct from 'true'::jsonb and me->'playingThisRound' is distinct from 'true'::jsonb then raise exception 'You must be marked as playing'; end if;
  if p_payload->>'format' is distinct from fmt or fmt not in ('stableford','net') then raise exception 'Competition format changed'; end if;
  if p_action='team_score' then
   if s->'trip'->'active' is distinct from 'true'::jsonb or coalesce(s->'trip'->>'currentFormat','individual') not in ('betterball','pairsaggregate') then raise exception 'No pair competition'; end if;
   select t into team from jsonb_array_elements(s->'trip'->'currentTeams') t where t->>'id'=p_payload->>'team_id' and t->'playerIds' ? pid::text;
   if team is null then raise exception 'Only a team member can submit this score' using errcode='42501'; end if;
   if s->'trip'->'currentTeamScores'->(team->>'id') is not null and s->'trip'->'currentTeamScores'->(team->>'id')<>'null' then raise exception 'Team result already recorded'; end if;
   if s->>'gameType'='money' and coalesce((s->>'stake')::numeric,0)>0 and exists(select 1 from jsonb_array_elements(s->'players') p where team->'playerIds' ? (p->>'id') and p->'paid' is distinct from 'true'::jsonb) then raise exception 'Both partners must be paid'; end if;
   val=(p_payload->>'score')::numeric;
   if val is null or val<>trunc(val) or val<0 or val>(case when s->'trip'->>'currentFormat'='pairsaggregate' then (case when fmt='net' then 1998 else 198 end) else 99 end) then raise exception 'Invalid pair score'; end if;
   s=jsonb_set(s,'{trip,currentTeamScores}',coalesce(s->'trip'->'currentTeamScores','{}')||jsonb_build_object(team->>'id',val));
  else
   if s->'trip'->'active'='true' and coalesce(s->'trip'->>'currentFormat','individual')<>'individual' then raise exception 'Use the pair score'; end if;
   if me->'scoreSubmitted'='true' or me->'noReturn'='true' or me->>'stableford' is not null or me->>'netScore' is not null then raise exception 'A result is already recorded; ask your organiser for corrections'; end if;
   if fmt<>'net' then raise exception 'No Return is only available for Net'; end if;
   me=me||jsonb_build_object('noReturn',true,'scoreSubmitted',true,'stableford',null,'netScore',null);
  end if;
 elsif p_action like 'side_%' then
  sg=coalesce(s->'sideGame','{}');
  sg=jsonb_build_object('bets',coalesce(sg->'bets','[]'),'scores',coalesce(sg->'scores','[]'),'settlements',coalesce(sg->'settlements','[]'));
  if p_action='side_create' then
   select p into other from jsonb_array_elements(s->'players') p where p->>'id'=p_payload->>'other_id' and p->>'id'<>pid::text;
   if other is null then raise exception 'Choose another group player'; end if;
   val=(p_payload->>'stake')::numeric; fmt=p_payload->>'format';
   if val is null or val<=0 or val>10000 or val<>round(val,2) or fmt is null or fmt not in ('stableford','net') then raise exception 'Invalid Side Game stake or format'; end if;
   if exists(select 1 from jsonb_array_elements(sg->'bets') b where b->>'date'=day and b->>'status' in ('pending','active','resolved') and ((b->>'player1Id'=pid::text and b->>'player2Id'=other->>'id') or (b->>'player2Id'=pid::text and b->>'player1Id'=other->>'id'))) then raise exception 'Side Game already exists today'; end if;
   if exists(select 1 from jsonb_array_elements(sg->'scores') b where b->>'date'=day and b->>'playerId' in(pid::text,other->>'id')) then raise exception 'Create games before scores are entered'; end if;
   if exists(select 1 from jsonb_array_elements(sg->'bets') b where b->>'date'=day and b->>'status' in('active','resolved') and pid::text in(b->>'player1Id',b->>'player2Id') and b->>'format'<>fmt) then raise exception 'Today already uses a different format'; end if;
   -- Even an in-person agreement needs the other signed-in player's confirmation.
   item=jsonb_build_object('id',gen_random_uuid(),'player1Id',pid,'player1Name',me->>'name','player2Id',other->>'id','player2Name',other->>'name','stake',val,'format',fmt,'date',day,'status','pending','setup','challenge','createdAt',now());
   sg=jsonb_set(sg,'{bets}',(sg->'bets')||jsonb_build_array(item));
  elsif p_action in ('side_accept','side_decline') then
   select b into item from jsonb_array_elements(sg->'bets') b where b->>'id'=p_payload->>'id' and b->>'player2Id'=pid::text and b->>'status'='pending' and b->>'date'=day;
   if item is null then raise exception 'No pending challenge for you' using errcode='42501'; end if;
   if p_action='side_accept' and (exists(select 1 from jsonb_array_elements(sg->'scores') sc where sc->>'date'=day and sc->>'playerId' in(item->>'player1Id',pid::text)) or exists(select 1 from jsonb_array_elements(sg->'bets') b where b->>'date'=day and b->>'status' in('active','resolved') and pid::text in(b->>'player1Id',b->>'player2Id') and b->>'format'<>item->>'format')) then raise exception 'Scores or format already fixed'; end if;
   item=item||jsonb_build_object('status',case when p_action='side_accept' then 'active' else 'declined' end,'acceptedAt',now());
   select jsonb_agg(case when b->>'id'=item->>'id' then item else b end order by n) into arr from jsonb_array_elements(sg->'bets') with ordinality x(b,n);
   sg=jsonb_set(sg,'{bets}',arr);
  elsif p_action='side_score' then
   fmt=p_payload->>'format';val=(p_payload->>'score')::numeric;
   if fmt is null or fmt not in('stableford','net') or val is null or val<>trunc(val) or val<0 or val>(case when fmt='net' then 999 else 99 end) then raise exception 'Invalid Side Game score'; end if;
   if not exists(select 1 from jsonb_array_elements(sg->'bets') b where b->>'date'=day and b->>'status'='active' and b->>'format'=fmt and pid::text in(b->>'player1Id',b->>'player2Id')) then raise exception 'No active Side Game'; end if;
   if exists(select 1 from jsonb_array_elements(sg->'scores') b where b->>'date'=day and b->>'playerId'=pid::text) then raise exception 'Score already recorded'; end if;
   sg=jsonb_set(sg,'{scores}',(sg->'scores')||jsonb_build_array(jsonb_build_object('playerId',pid,'playerName',me->>'name','score',val,'format',fmt,'date',day,'createdAt',now())));
   -- Resolve results from stored scores; no client-provided winner or amount.
   select coalesce(jsonb_agg(case when b->>'status'='active' and a.score is not null and z.score is not null then
    b||jsonb_build_object('status','resolved','resolvedAt',now(),'result',case when a.score=z.score then 'draw' else 'win' end,
    'winnerId',case when a.score=z.score then null when (b->>'format'='net' and a.score<z.score) or (b->>'format'='stableford' and a.score>z.score) then b->>'player1Id' else b->>'player2Id' end,
    'loserId',case when a.score=z.score then null when (b->>'format'='net' and a.score<z.score) or (b->>'format'='stableford' and a.score>z.score) then b->>'player2Id' else b->>'player1Id' end,
    'amount',case when a.score=z.score then 0 else (b->>'stake')::numeric end) else b end order by n),'[]') into arr
   from jsonb_array_elements(sg->'bets') with ordinality x(b,n)
   left join lateral(select (sc->>'score')::numeric score from jsonb_array_elements(sg->'scores') sc where sc->>'date'=b->>'date' and sc->>'format'=b->>'format' and sc->>'playerId'=b->>'player1Id' limit 1) a on true
   left join lateral(select (sc->>'score')::numeric score from jsonb_array_elements(sg->'scores') sc where sc->>'date'=b->>'date' and sc->>'format'=b->>'format' and sc->>'playerId'=b->>'player2Id' limit 1) z on true;
   sg=jsonb_set(sg,'{bets}',arr);
  elsif p_action='side_settle' then
   select p into other from jsonb_array_elements(s->'players') p where p->>'id'=p_payload->>'other_id' and p->>'id'<>pid::text;
   if other is null then raise exception 'Choose another player'; end if;
   select coalesce(sum(case when b->>'winnerId'=other->>'id' and b->>'loserId'=pid::text then (b->>'amount')::numeric when b->>'winnerId'=pid::text and b->>'loserId'=other->>'id' then -(b->>'amount')::numeric else 0 end),0) into balance from jsonb_array_elements(sg->'bets') b where b->>'status'='resolved';
   select balance-coalesce(sum(case when b->>'debtorId'=pid::text and b->>'creditorId'=other->>'id' then (b->>'amount')::numeric when b->>'debtorId'=other->>'id' and b->>'creditorId'=pid::text then -(b->>'amount')::numeric else 0 end),0) into balance from jsonb_array_elements(sg->'settlements') b where b->>'status'='confirmed';
   if balance<=0 then raise exception 'No debt to settle'; end if;
   if exists(select 1 from jsonb_array_elements(sg->'settlements') b where b->>'status'='pending' and b->>'debtorId'=pid::text and b->>'creditorId'=other->>'id') then raise exception 'Settlement already pending'; end if;
   sg=jsonb_set(sg,'{settlements}',(sg->'settlements')||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'debtorId',pid,'debtorName',me->>'name','creditorId',other->>'id','creditorName',other->>'name','amount',balance,'status','pending','requestedAt',now())));
  elsif p_action='side_confirm' then
   select b into item from jsonb_array_elements(sg->'settlements') b where b->>'id'=p_payload->>'id' and b->>'creditorId'=pid::text and b->>'status'='pending';
   if item is null then raise exception 'Only the creditor can confirm receipt' using errcode='42501'; end if;
   select jsonb_agg(case when b->>'id'=item->>'id' then b||jsonb_build_object('status','confirmed','confirmedAt',now()) else b end order by n) into arr from jsonb_array_elements(sg->'settlements') with ordinality x(b,n);
   sg=jsonb_set(sg,'{settlements}',arr);
  else raise exception 'Unknown Side Game action'; end if;
  s=jsonb_set(s,'{sideGame}',sg);
 elsif p_action='claim_prize' then
  ident=p_payload->>'payout_id';
  select h into item from jsonb_array_elements(s->'history') h where h->>'id'=p_payload->>'history_id';
  if item is null then raise exception 'Saved round not found'; end if;
  select p into other from jsonb_array_elements(item->'payouts') p where p->>'id'=ident and p->>'winnerPlayerId'=pid::text and p->>'status'<>'paid';
  if other is null then raise exception 'Only the named winner can claim this prize' using errcode='42501'; end if;
  field=p_payload->>'payment_link';
  if field is null or (field<>'' and field !~ '^https://([a-z0-9-]+[.])*(monzo[.]me|monzo[.]com|paypal[.]me|paypal[.]com|revolut[.]me|revolut[.]com|starlingbank[.]com|wise[.]com)/[^[:space:]]+$') then raise exception 'Use a supported secure payment link or private bank transfer'; end if;
  -- Use the existing guard's validated provider label, never a client-supplied
  -- label or an unvalidated hostname. Its supported-link allowlist is unchanged.
  select label into provider from unnest(array['Monzo','Revolut','PayPal','Starling','Wise']) label
   where iig_closed_entry.safe_payment_link(field,label);
  if field<>'' and provider is null then raise exception 'INVALID_PAYMENT_LINK';end if;
  other=other||jsonb_build_object('status',case when field='' then 'bank_details_needed' else 'ready' end,'paymentLink',field,'paymentProvider',case when field='' then 'Private bank transfer' else provider end,'claimedAt',now());
  select jsonb_agg(case when p->>'id'=ident then other else p end order by n) into arr from jsonb_array_elements(item->'payouts') with ordinality x(p,n);
  item=jsonb_set(item,'{payouts}',arr);
  select jsonb_agg(case when h->>'id'=item->>'id' then item else h end order by n) into arr from jsonb_array_elements(s->'history') with ordinality x(h,n);
  s=jsonb_set(s,'{history}',arr);
 else raise exception 'Unknown player action'; end if;
 select jsonb_agg(case when p->>'id'=pid::text then me else p end order by n) into arr from jsonb_array_elements(s->'players') with ordinality x(p,n);
 s=jsonb_set(s,'{players}',arr);
 if p_action<>'no_return' and octet_length(s::text)>1048576 then raise exception 'Group capacity reached; ask your organiser'; end if;
 rev:=iig_closed_entry.write_authenticated(gid,rev,case when p_action='payment' then 'payment' when p_action like 'side_%' then 'sidegame' when p_action='claim_prize' then 'claim' when p_action='no_return' then 'member_score' else 'save' end,s,pid::text);
 return rev;
end $$;

REVOKE ALL ON FUNCTION iig_closed_entry.lock_authenticated(text,bigint,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION iig_closed_entry.write_authenticated(bigint,bigint,text,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.iig_join_owned_group(text,uuid,text,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.iig_join_owned_group(text,uuid,text,numeric) TO authenticated;
REVOKE ALL ON FUNCTION public.iig_set_my_attendance(text,boolean,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.iig_set_my_attendance(text,boolean,bigint) TO authenticated;
REVOKE ALL ON FUNCTION public.iig_submit_my_score(text,integer,text,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.iig_submit_my_score(text,integer,text,bigint) TO authenticated;
REVOKE ALL ON FUNCTION public.iig_player_action(text,text,jsonb,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.iig_player_action(text,text,jsonb,bigint) TO authenticated;
REVOKE ALL ON FUNCTION public.iig_save_owned_group(text,jsonb,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.iig_save_owned_group(text,jsonb,bigint) TO authenticated;
REVOKE ALL ON FUNCTION public.iig_operate_owned_group(text,text,jsonb,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.iig_operate_owned_group(text,text,jsonb,bigint) TO authenticated;
REVOKE ALL ON FUNCTION public.iig_read_entry_group(text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.iig_read_entry_group(text) TO authenticated;
REVOKE ALL ON FUNCTION public.iig_prepare_owned_entry(text,text,bigint,integer) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.iig_prepare_owned_entry(text,text,bigint,integer) TO authenticated;
