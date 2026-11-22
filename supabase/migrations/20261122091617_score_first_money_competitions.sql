-- Weekly Money Games use the existing entrant definition and the current format.
-- A valid zero is a result. A Net NR is a result. An empty field cannot close entry.
CREATE OR REPLACE FUNCTION iig_closed_entry.individual_money(s jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path TO pg_catalog AS $$
 SELECT s->>'gameType' = 'money' AND s#>'{trip,active}' IS DISTINCT FROM 'true'::jsonb
$$;

CREATE OR REPLACE FUNCTION iig_closed_entry.result_in(s jsonb,p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path TO pg_catalog AS $$
 SELECT CASE WHEN s->>'pointsCompetition' = 'net'
   THEN coalesce(p->'noReturn' = 'true'::jsonb, false) OR jsonb_typeof(p->'netScore') = 'number'
   ELSE jsonb_typeof(p->'stableford') = 'number' END IS TRUE
$$;

-- NULL means entry stays open. A non-empty array is the field to freeze.
CREATE OR REPLACE FUNCTION iig_closed_entry.completed_field(s jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path TO pg_catalog AS $$
 SELECT CASE WHEN bool_and(iig_closed_entry.result_in(s,p))
   THEN jsonb_agg(p->'id' ORDER BY n) END
 FROM jsonb_array_elements(s->'players') WITH ORDINALITY AS players(p,n)
 WHERE iig_closed_entry.eligible(s,p)
$$;

CREATE OR REPLACE FUNCTION iig_closed_entry.initial_field(s jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path TO pg_catalog AS $$
 SELECT CASE WHEN iig_closed_entry.individual_money(s) THEN iig_closed_entry.completed_field(s)
   WHEN iig_closed_entry.has_score(s) THEN
   (SELECT coalesce(jsonb_agg(p->'id' ORDER BY n),'[]') FROM jsonb_array_elements(s->'players')
     WITH ORDINALITY AS players(p,n) WHERE iig_closed_entry.eligible(s,p)) END
$$;

-- Only the top-level players array contains this competition's individual results.
-- History, league totals, side games and archived trip records retain their own projections.
CREATE OR REPLACE FUNCTION iig_closed_entry.visible_scores(s jsonb,pid text) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path TO pg_catalog AS $$
 SELECT CASE WHEN iig_closed_entry.individual_money(s) AND iig_closed_entry.round_is_open(s)
   AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(s->'players') p
     WHERE p->>'id'=pid AND iig_closed_entry.result_in(s,p))
 THEN jsonb_set(s,'{players}',(SELECT coalesce(jsonb_agg(
    CASE WHEN p->>'id'=pid THEN p ELSE p - ARRAY['stableford','netScore','scoreSubmitted','noReturn'] END
    ORDER BY n),'[]') FROM jsonb_array_elements(s->'players') WITH ORDINALITY AS players(p,n)))
 ELSE s END
$$;

REVOKE ALL ON FUNCTION iig_closed_entry.individual_money(jsonb), iig_closed_entry.result_in(jsonb,jsonb),
 iig_closed_entry.completed_field(jsonb), iig_closed_entry.initial_field(jsonb),
 iig_closed_entry.visible_scores(jsonb,text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION iig_closed_entry.initialise(g text, s jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE field jsonb := iig_closed_entry.initial_field(s);
BEGIN
 INSERT INTO iig_closed_entry.rounds(group_id,phase,closed,entrant_ids)
 VALUES(g,CASE WHEN iig_closed_entry.round_is_open(s) THEN 'open' ELSE 'finished' END,
 field IS NOT NULL,field) ON CONFLICT(group_id) DO NOTHING;
 IF FOUND THEN PERFORM iig_closed_entry.reserve_identities(g,s);END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.iig_read_owned_entry_group(p_pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE uid uuid=iig_private.verified_organiser();g record;r iig_closed_entry.rounds;result jsonb;entry jsonb;pin text;field jsonb;
BEGIN
 IF p_pin IS NULL OR p_pin !~ '^[0-9]{4}$' THEN RAISE EXCEPTION 'Choose a group' USING ERRCODE='22023'; END IF;
 pin:=p_pin;
 SELECT * INTO g FROM iig_private.lock_release(pin,NULL,'owner');
 result:=jsonb_build_object('group_pin',pin,'revision',g.revision,'state',g.state,'invite_token',
   (SELECT invite_token FROM iig_private.group_owners WHERE group_id=g.group_id));
 SELECT * INTO r FROM iig_closed_entry.rounds WHERE group_id=g.group_id::text;
 IF FOUND THEN entry:=jsonb_build_object('open',r.phase='open','closed',r.closed,'entrantIds',r.entrant_ids);
 ELSE
  field:=iig_closed_entry.initial_field(g.state);
  entry:=jsonb_build_object('open',iig_closed_entry.round_is_open(g.state),'closed',field IS NOT NULL,'entrantIds',field);
 END IF;
 RETURN result||jsonb_build_object('entry',entry,'plan_type',(SELECT plan_type FROM public.tens_in_groups WHERE id=g.group_id));
END $function$;

CREATE OR REPLACE FUNCTION public.iig_read_entry_group(p_pin text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE uid uuid=iig_private.verified_organiser();g record;r iig_closed_entry.rounds;result jsonb;entry jsonb;pin text;field jsonb;
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
 ELSE
  field:=iig_closed_entry.initial_field(g.state);
  entry:=jsonb_build_object('open',iig_closed_entry.round_is_open(g.state),'closed',field IS NOT NULL,'entrantIds',field);
 END IF;
 RETURN result||jsonb_build_object('entry',entry,'plan_type',(SELECT plan_type FROM public.tens_in_groups WHERE id=g.group_id));
END $function$;

CREATE OR REPLACE FUNCTION iig_closed_entry.member_view(v jsonb, pid text, context text DEFAULT 'state'::text, depth integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE k text;x jsonb;out jsonb='{}';
BEGIN
 IF depth=0 AND context='state' THEN v:=iig_closed_entry.visible_scores(v,pid);END IF;
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
   'noReturn','scoreSubmitted','competition','leaguePoints','wins','netWinnings','tripPointsExcluded','paymentDeclaration']) THEN CONTINUE;END IF;
  IF k='paymentDeclaration' THEN
   IF context='players' AND v->>'id'=pid THEN out=out||jsonb_build_object(k,iig_closed_entry.member_view(x,pid,k,depth+1));END IF;
  ELSIF k='paymentLink' OR (context='payouts' AND k='paymentProvider') THEN
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
END $function$;

CREATE OR REPLACE FUNCTION public.iig_get_player_group(p_pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_state jsonb; v_player uuid; v_out jsonb; v_revision bigint;
begin
  select g.state,m.player_id,o.revision into v_state,v_player,v_revision
    from public.tens_in_groups g join iig_private.group_owners o on o.group_id=g.id
    join iig_private.group_members m on m.group_id=g.id
    where g.group_pin=p_pin and m.user_id=auth.uid();
  if not found then raise exception 'Group membership required' using errcode='42501'; end if;
  perform iig_private.check_group_access(p_pin);
  v_state:=iig_closed_entry.visible_scores(v_state,v_player::text);
  -- Explicit projections: future admin-only fields cannot leak by default.
  select coalesce(jsonb_object_agg(key,value),'{}') into v_out from jsonb_each(v_state)
    where key=any(array['groupName','course','date','roundOpen','pointsCompetition','gameType']);
  return jsonb_build_object('state',v_out || jsonb_build_object('players',(
    select coalesce(jsonb_agg(jsonb_build_object('id',p->'id','name',p->'name','handicap',p->'handicap',
      'playingThisRound',p->'playingThisRound','stableford',p->'stableford','netScore',p->'netScore',
      'scoreSubmitted',p->'scoreSubmitted')),'[]') from jsonb_array_elements(v_state->'players') p)),
    'player_id',v_player,'revision',v_revision);
end $function$;

CREATE OR REPLACE FUNCTION public.iig_entry_read(p_pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE row public.tens_in_groups;
BEGIN
 row:=iig_closed_entry.lock_group(p_pin);PERFORM iig_closed_entry.initialise(row.id::text,row.state);
 RETURN jsonb_build_object('context',iig_closed_entry.envelope(row.id::text),'state',iig_closed_entry.visible_scores(row.state,NULL));
END $function$;

CREATE OR REPLACE FUNCTION iig_closed_entry.validate_member_update(old_s jsonb, new_s jsonb, operation text, actor text, latched boolean, frozen jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE p jsonb;n jsonb;fields text[];matched integer:=0;fmt text;field text;value jsonb;locked boolean;
BEGIN
 PERFORM iig_closed_entry.validate_payment_score_gate(old_s,new_s);
 IF actor IS NULL OR actor='' OR operation IS NULL OR operation NOT IN ('member_attendance','member_score')
 THEN RAISE EXCEPTION 'INVALID_MEMBER_OPERATION';END IF;
 IF jsonb_typeof(old_s) IS DISTINCT FROM 'object' OR jsonb_typeof(new_s) IS DISTINCT FROM 'object'
  OR jsonb_typeof(old_s->'players') IS DISTINCT FROM 'array' OR jsonb_typeof(new_s->'players') IS DISTINCT FROM 'array'
  OR (old_s-'players') IS DISTINCT FROM (new_s-'players')
  OR jsonb_array_length(old_s->'players')<>jsonb_array_length(new_s->'players')
 THEN RAISE EXCEPTION 'INVALID_MEMBER_CHANGE';END IF;
 IF old_s->'roundOpen' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'ROUND_NOT_OPEN';END IF;
 IF old_s->>'gameType' IS NULL OR old_s->>'gameType' NOT IN ('points','money') THEN RAISE EXCEPTION 'Unknown competition type';END IF;
 locked:=coalesce(latched,false) OR (NOT iig_closed_entry.individual_money(old_s) AND iig_closed_entry.has_score(old_s));
 IF operation='member_attendance' THEN
  IF locked THEN RAISE EXCEPTION 'ENTRIES_CLOSED';END IF;
  fields:=ARRAY['playingThisRound'];
 ELSE
  fields:=ARRAY['stableford','netScore','noReturn','scoreSubmitted'];
  fmt:=old_s->>'pointsCompetition';
  IF fmt IS NULL OR fmt NOT IN ('stableford','net') THEN RAISE EXCEPTION 'Competition format changed';END IF;
  IF nullif(btrim(old_s->>'course'),'') IS NULL OR nullif(old_s->>'date','') IS NULL THEN RAISE EXCEPTION 'Scoring is closed';END IF;
  IF old_s#>'{trip,active}'='true'::jsonb AND coalesce(old_s#>>'{trip,currentFormat}','individual')<>'individual'
  THEN RAISE EXCEPTION 'Use the pair score';END IF;
 END IF;
 FOR p,n IN SELECT a.value,b.value FROM jsonb_array_elements(old_s->'players') WITH ORDINALITY a
  JOIN jsonb_array_elements(new_s->'players') WITH ORDINALITY b USING(ordinality) LOOP
  IF p->>'id' IS DISTINCT FROM actor THEN
   IF p IS DISTINCT FROM n THEN RAISE EXCEPTION 'WRONG_PLAYER';END IF;
   CONTINUE;
  END IF;
  matched:=matched+1;
  IF (p-fields) IS DISTINCT FROM (n-fields) THEN RAISE EXCEPTION 'MEMBER_CHANGED_PROTECTED_FIELDS';END IF;
  IF operation='member_attendance' THEN
   IF jsonb_typeof(n->'playingThisRound') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Invalid attendance';END IF;
   -- New paid-round entries require payment; preserve existing entrants and Trip selection.
   IF old_s->>'gameType'='money' AND coalesce((old_s->>'stake')::numeric,0)>0
    AND old_s#>'{trip,active}' IS DISTINCT FROM 'true'::jsonb
    AND n->'playingThisRound'='true'::jsonb
    AND p->'playingThisRound' IS DISTINCT FROM 'true'::jsonb
    AND p->'paid' IS DISTINCT FROM 'true'::jsonb
   THEN RAISE EXCEPTION 'PAYMENT_DECLARATION_REQUIRED: Pay and confirm payment to enter this competition';END IF;
  ELSE
   IF p->'scoreSubmitted'='true'::jsonb OR p->'noReturn'='true'::jsonb OR p->>'stableford' IS NOT NULL OR p->>'netScore' IS NOT NULL
   THEN RAISE EXCEPTION 'A result is already recorded. Ask your organiser about corrections.';END IF;
   IF NOT coalesce(iig_closed_entry.eligible(old_s,p),false)
   THEN RAISE EXCEPTION 'INELIGIBLE_SCORER: You must be marked as playing in this competition';END IF;
   IF locked AND (jsonb_typeof(frozen) IS DISTINCT FROM 'array' OR NOT frozen ? actor)
   THEN RAISE EXCEPTION 'INELIGIBLE_SCORER';END IF;
   IF n->'scoreSubmitted' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'INVALID_SUBMISSION_FLAG';END IF;
   IF n->'noReturn' IS DISTINCT FROM p->'noReturn' AND jsonb_typeof(n->'noReturn') IS DISTINCT FROM 'boolean'
   THEN RAISE EXCEPTION 'INVALID_NR';END IF;
   IF n->'noReturn'='true'::jsonb THEN
    IF fmt<>'net' OR n->>'stableford' IS NOT NULL OR n->>'netScore' IS NOT NULL THEN RAISE EXCEPTION 'INVALID_NR';END IF;
   ELSE
    field:=CASE WHEN fmt='net' THEN 'netScore' ELSE 'stableford' END;
    value:=n->field;
    IF jsonb_typeof(value) IS DISTINCT FROM 'number' OR value::text !~ '^[0-9]+$'
     OR value::text::numeric>(CASE WHEN fmt='net' THEN 999 ELSE 99 END)
     OR n->>(CASE WHEN fmt='net' THEN 'stableford' ELSE 'netScore' END) IS NOT NULL
    THEN RAISE EXCEPTION 'INVALID_SCORE';END IF;
   END IF;
  END IF;
 END LOOP;
 IF matched<>1 THEN RAISE EXCEPTION 'MEMBER_IDENTITY_AMBIGUOUS_OR_MISSING';END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.iig_set_my_attendance(p_pin text, p_attending boolean, p_revision bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id bigint; v_player text; v_state jsonb; v_revision bigint; v_players jsonb;
begin
  select group_id,revision,player_id,state into v_id,v_revision,v_player,v_state
    from iig_private.lock_release(p_pin,p_revision,'member');
  if p_attending is null or p_revision is null or p_revision<>v_revision
  then raise exception 'Group changed; reload before saving' using errcode='40001'; end if;
  if v_state->'roundOpen' is distinct from 'true'::jsonb or (not iig_closed_entry.individual_money(v_state) and iig_closed_entry.has_score(v_state))
  then raise exception 'Entries are closed'; end if;
  if not exists(select 1 from jsonb_array_elements(v_state->'players') p where p->>'id'=v_player::text)
  then raise exception 'Player no longer in group' using errcode='42501'; end if;
  select jsonb_agg(case when p->>'id'=v_player::text
    then p || jsonb_build_object('playingThisRound',p_attending) else p end order by pos)
    into v_players from jsonb_array_elements(v_state->'players') with ordinality as entries(p,pos);
  v_revision:=iig_closed_entry.write_authenticated(v_id,v_revision,'member_attendance',jsonb_set(v_state,'{players}',v_players),v_player::text);
  return v_revision;
end $function$;

CREATE OR REPLACE FUNCTION public.iig_player_action(p_pin text, p_action text, p_payload jsonb, p_revision bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare gid bigint; rev bigint; pid text; s jsonb; me jsonb; other jsonb; item jsonb; arr jsonb; sg jsonb;
 fmt text; team jsonb; eligible boolean; val numeric; day text=to_char(now() at time zone 'Europe/London','YYYY-MM-DD');
 field text; ident text; balance numeric; entries_closed boolean; provider text;
begin
 select group_id,revision,player_id,state into gid,rev,pid,s from iig_private.lock_release(p_pin,p_revision,'member');
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
 -- Bind an imported scored round before deciding settlement eligibility. This
 -- changes only private closure metadata; it never replays or rewrites group JSON.
 perform iig_closed_entry.initialise(gid::text,s);
 select closed into strict entries_closed from iig_closed_entry.rounds where group_id=gid::text;
 if not iig_closed_entry.individual_money(s) then
  entries_closed:=entries_closed or iig_closed_entry.has_score(s) or exists(
   select 1 from jsonb_array_elements(s->'players') p where p->'scoreSubmitted'='true'::jsonb);
 end if;
 if p_action in ('payment','no_return','team_score') then
  if s->>'gameType' not in ('points','money') or s->>'gameType' is null then raise exception 'Unknown competition type'; end if;
  if s->'roundOpen' is distinct from 'true'::jsonb or not eligible or nullif(btrim(s->>'course'),'') is null or nullif(s->>'date','') is null
  then raise exception 'This competition is closed or you are not playing today'; end if;
  if coalesce(p_payload->>'round_id','')<>coalesce(s->>'roundId','') then raise exception 'Competition changed; reload before saving' using errcode='40001'; end if;
 end if;
 if p_action in ('side_create','side_accept') and exists(select 1 from public.tens_in_groups where id=gid and plan_type='free') then raise exception 'Side Game requires I’m In Golf+'; end if;
 if p_action='handicap' then
  if jsonb_typeof(p_payload->'handicap') is distinct from 'number' then raise exception 'Enter a valid handicap'; end if;
  val=(p_payload->>'handicap')::numeric;
  if val< -10 or val>60 or val*10<>trunc(val*10) then raise exception 'Enter a valid handicap'; end if;
  me=me||jsonb_build_object('handicap',val);
 elsif p_action='payment' then
  if s->>'gameType' is distinct from 'money' then raise exception 'Money Game required'; end if;
  if entries_closed and not coalesce((select entrant_ids from iig_closed_entry.rounds where group_id=gid::text),'[]') ? pid then raise exception 'ENTRIES_CLOSED'; end if;
  if jsonb_typeof(p_payload->'confirmed') is distinct from 'boolean' then raise exception 'Choose your own payment response';end if;
  if p_payload->'confirmed'='false'::jsonb and coalesce((s->>'stake')::numeric,0)<=0 then raise exception 'An explicit not-paid response is only for a stake-enabled round';end if;
  me=me||jsonb_build_object('paymentDeclaration',jsonb_build_object('status',case when p_payload->'confirmed'='true'::jsonb then 'paid' else 'not-paid' end,'roundId',coalesce(s->>'roundId',''),'updatedAt',now()));
  if p_payload->'confirmed'='true'::jsonb then
   me=me||jsonb_build_object('paid',true,'paymentMarkedAt',now(),'paymentMarkMethod','player-confirmed');
  end if;
 elsif p_action in ('no_return','team_score') then
  if s->>'gameType'='points' and s->'trip'->'active' is distinct from 'true'::jsonb and me->'playingThisRound' is distinct from 'true'::jsonb then raise exception 'You must be marked as playing'; end if;
  if p_payload->>'format' is distinct from fmt or fmt not in ('stableford','net') then raise exception 'Competition format changed'; end if;
  if p_action='team_score' then
   if s->'trip'->'active' is distinct from 'true'::jsonb or coalesce(s->'trip'->>'currentFormat','individual') not in ('betterball','pairsaggregate') then raise exception 'No pair competition'; end if;
   select t into team from jsonb_array_elements(s->'trip'->'currentTeams') t where t->>'id'=p_payload->>'team_id' and t->'playerIds' ? pid::text;
   if team is null then raise exception 'Only a team member can submit this score' using errcode='42501'; end if;
   if s->'trip'->'currentTeamScores'->(team->>'id') is not null and s->'trip'->'currentTeamScores'->(team->>'id')<>'null' then raise exception 'Team result already recorded'; end if;
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
   if val is null or val<=0 or val>10000 or val<>round(val,2) or fmt is null or fmt not in ('stableford','net','match') then raise exception 'Invalid Side Game stake or format'; end if;
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
   item=item||jsonb_build_object('status',case when p_action='side_accept' then 'active' else 'declined' end,case when p_action='side_accept' then 'acceptedAt' else 'declinedAt' end,now());
   select jsonb_agg(case when b->>'id'=item->>'id' then item else b end order by n) into arr from jsonb_array_elements(sg->'bets') with ordinality x(b,n);
   sg=jsonb_set(sg,'{bets}',arr);
  elsif p_action='side_match_result' then
   select b into item from jsonb_array_elements(sg->'bets') b
    where b->>'id'=p_payload->>'id' and b->>'format'='match' and b->>'status'='active'
    and b->>'date'=day and pid::text in (b->>'player1Id',b->>'player2Id');
   if item is null then raise exception 'No active match for this player'; end if;
   fmt=p_payload->>'outcome';
   if fmt is null or fmt not in ('won','lost','halved') then raise exception 'Choose a match result'; end if;
   other=to_jsonb(case when pid::text=item->>'player1Id' then item->>'player2Id' else item->>'player1Id' end);
   item=item||jsonb_build_object('status','resolved','resolvedAt',now(),
    'result',case when fmt='halved' then 'draw' else 'win' end,
    'amount',case when fmt='halved' then 0 else (item->>'stake')::numeric end,
    'winnerId',case fmt when 'won' then to_jsonb(pid) when 'lost' then other end,
    'loserId',case fmt when 'lost' then to_jsonb(pid) when 'won' then other end);
   select jsonb_agg(case when b->>'id'=item->>'id' then item else b end order by n) into arr
    from jsonb_array_elements(sg->'bets') with ordinality x(b,n);
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
 rev:=iig_closed_entry.write_authenticated(gid,rev,case when p_action='payment' then 'payment' when p_action like 'side_%' then 'sidegame' when p_action='claim_prize' then 'claim' when p_action='no_return' then 'member_score' when p_action='handicap' then 'profile' else 'save' end,s,pid::text);
 return rev;
end $function$;

CREATE OR REPLACE FUNCTION iig_closed_entry.validate_snapshot(old_s jsonb, new_s jsonb, latched boolean)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE p jsonb; n jsonb; locked boolean; first_score boolean; scores text[]; key text; v jsonb; team jsonb; old_v jsonb;
BEGIN
 PERFORM iig_closed_entry.validate_payment_score_gate(old_s,new_s);
 scores:=ARRAY['stableford','netScore','noReturn','scoreSubmitted'];
 IF jsonb_typeof(old_s) IS DISTINCT FROM 'object' OR jsonb_typeof(new_s) IS DISTINCT FROM 'object'
    OR jsonb_typeof(old_s->'players') IS DISTINCT FROM 'array' OR jsonb_typeof(new_s->'players') IS DISTINCT FROM 'array' THEN
   RAISE EXCEPTION 'INVALID_STATE'; END IF;
 -- Reject forged identity/reset/history/stake/game type/team eligibility changes.
 IF (old_s-'players'-'trip'-'lastActivityAt') IS DISTINCT FROM (new_s-'players'-'trip'-'lastActivityAt')
    OR (coalesce(old_s->'trip','{}'::jsonb)-'currentTeamScores') IS DISTINCT FROM
       (coalesce(new_s->'trip','{}'::jsonb)-'currentTeamScores') THEN
   RAISE EXCEPTION 'PROTECTED_ROUND_FIELDS'; END IF;
 IF EXISTS (SELECT 1 FROM jsonb_array_elements(new_s->'players') x
   WHERE jsonb_typeof(x)<>'object' OR coalesce(x->>'id','')='' OR jsonb_typeof(x->'id')<>'string'
     OR (x ? 'paid' AND jsonb_typeof(x->'paid') IS DISTINCT FROM 'boolean' AND NOT (x->'paid'='null'::jsonb AND EXISTS(SELECT 1 FROM jsonb_array_elements(old_s->'players') prior WHERE prior->>'id'=x->>'id' AND prior->'paid' IS NOT DISTINCT FROM x->'paid')))
     OR (x ? 'playingThisRound' AND jsonb_typeof(x->'playingThisRound') IS DISTINCT FROM 'boolean' AND NOT (x->'playingThisRound'='null'::jsonb AND EXISTS(SELECT 1 FROM jsonb_array_elements(old_s->'players') prior WHERE prior->>'id'=x->>'id' AND prior->'playingThisRound' IS NOT DISTINCT FROM x->'playingThisRound'))))
 OR (SELECT count(*) FROM jsonb_array_elements(new_s->'players')) <>
    (SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(new_s->'players') x) THEN
   RAISE EXCEPTION 'INVALID_PLAYERS'; END IF;
 locked:=latched OR (NOT iig_closed_entry.individual_money(old_s) AND iig_closed_entry.has_score(old_s));
 first_score:=NOT iig_closed_entry.has_score(old_s) AND iig_closed_entry.has_score(new_s);
 FOR p IN SELECT value FROM jsonb_array_elements(old_s->'players') LOOP
   SELECT value INTO n FROM jsonb_array_elements(new_s->'players') WHERE value->>'id'=p->>'id';
   IF n IS NULL THEN RAISE EXCEPTION 'PLAYER_REMOVAL_REQUIRES_PROTECTED_OPERATION'; END IF;
   IF (p-ARRAY['stableford','netScore','noReturn','scoreSubmitted','paid','playingThisRound','competition','paymentMarkedAt','paymentMarkMethod'])
    IS DISTINCT FROM (n-ARRAY['stableford','netScore','noReturn','scoreSubmitted','paid','playingThisRound','competition','paymentMarkedAt','paymentMarkMethod'])
   THEN RAISE EXCEPTION 'PROTECTED_PLAYER_FIELDS';END IF;
   IF p->'paymentMarkedAt' IS DISTINCT FROM n->'paymentMarkedAt' AND
    (n->'paymentMarkedAt' IS NULL OR jsonb_typeof(n->'paymentMarkedAt') NOT IN ('string','null')) THEN RAISE EXCEPTION 'INVALID_PAYMENT_METADATA';END IF;
   IF p->'paymentMarkMethod' IS DISTINCT FROM n->'paymentMarkMethod' AND
    (n->'paymentMarkMethod' IS NULL OR (n->'paymentMarkMethod'<>'null'::jsonb AND n->>'paymentMarkMethod' NOT IN ('admin-confirmed','admin-self-entry','player-confirmed-payment-return')))
   THEN RAISE EXCEPTION 'INVALID_PAYMENT_METADATA';END IF;

   IF (locked OR first_score) AND (p-scores) IS DISTINCT FROM (n-scores) THEN
     RAISE EXCEPTION 'ENTRIES_CLOSED'; END IF;
   -- Mid-round payment changes go through the validated payment operation.
   IF iig_closed_entry.individual_money(old_s) AND iig_closed_entry.has_score(old_s)
      AND (p-scores) IS DISTINCT FROM (n-scores) THEN
     RAISE EXCEPTION 'USE_PAYMENT_OPERATION'; END IF;
   IF iig_closed_entry.individual_money(old_s) AND iig_closed_entry.result_in(old_s,p)
      AND iig_closed_entry.score_signature(p) IS DISTINCT FROM iig_closed_entry.score_signature(n)
   THEN RAISE EXCEPTION 'SCORE_CORRECTION_REQUIRES_PROTECTED_OPERATION'; END IF;
   IF EXISTS (SELECT 1 FROM unnest(scores) AS keys(k) WHERE
      p->keys.k IS NOT NULL AND p->keys.k<>'null'::jsonb AND p->keys.k<>'false'::jsonb
      AND p->keys.k IS DISTINCT FROM n->keys.k) THEN
      RAISE EXCEPTION 'SCORE_CORRECTION_REQUIRES_PROTECTED_OPERATION'; END IF;
   IF (p-scores)=(n-scores) AND (iig_closed_entry.score_signature(p) IS DISTINCT FROM iig_closed_entry.score_signature(n))
      AND NOT iig_closed_entry.eligible(old_s,p) THEN
      RAISE EXCEPTION 'INELIGIBLE_SCORER'; END IF;
   FOR key IN SELECT unnest(ARRAY['stableford','netScore']) LOOP
     v:=n->key;
     IF v IS DISTINCT FROM p->key AND v IS NOT NULL AND v<>'null'::jsonb THEN
       IF jsonb_typeof(v)<>'number' THEN RAISE EXCEPTION 'INVALID_SCORE'; END IF;
       IF v::text !~ '^[0-9]+$' OR (v::text)::numeric>(CASE WHEN key='stableford' THEN 99 ELSE 999 END)
          OR (key='stableford' AND new_s->>'pointsCompetition'<>'stableford')
          OR (key='netScore' AND new_s->>'pointsCompetition'<>'net') THEN RAISE EXCEPTION 'INVALID_SCORE'; END IF;
     END IF;
   END LOOP;
   IF (n->'noReturn' IS DISTINCT FROM p->'noReturn') AND
       (jsonb_typeof(n->'noReturn') IS DISTINCT FROM 'boolean' OR
        (n->'noReturn'='true'::jsonb AND new_s->>'pointsCompetition'<>'net')) THEN RAISE EXCEPTION 'INVALID_NR'; END IF;
   IF n->'scoreSubmitted' IS DISTINCT FROM p->'scoreSubmitted' AND
      jsonb_typeof(n->'scoreSubmitted') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'INVALID_SUBMISSION_FLAG'; END IF;
   IF n->'scoreSubmitted'='true'::jsonb AND NOT iig_closed_entry.has_score(
      jsonb_build_object('players',jsonb_build_array(n))) THEN RAISE EXCEPTION 'MISSING_SCORE'; END IF;
   -- Do not admit a previously ineligible scorer in the same ordinary save.
   IF NOT iig_closed_entry.eligible(old_s,p)
      AND iig_closed_entry.score_signature(p) IS DISTINCT FROM iig_closed_entry.score_signature(n) THEN
      RAISE EXCEPTION 'INELIGIBLE_SCORER'; END IF;
 END LOOP;
 FOR n IN SELECT value FROM jsonb_array_elements(new_s->'players') LOOP
   IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(old_s->'players') AS existing(value) WHERE existing.value->>'id'=n->>'id') THEN
     RAISE EXCEPTION 'NEW_MEMBER_MUST_NOT_ENTER_VIA_MEMBERSHIP_SAVE'; END IF;
 END LOOP;
 FOR key,v IN SELECT * FROM jsonb_each(coalesce(new_s#>'{trip,currentTeamScores}','{}'::jsonb)) LOOP
   old_v:=old_s#>ARRAY['trip','currentTeamScores',key];
   IF v IS DISTINCT FROM old_v AND v<>'null'::jsonb THEN
     IF old_v IS NOT NULL AND old_v<>'null'::jsonb THEN RAISE EXCEPTION 'PAIR_CORRECTION_REQUIRES_PROTECTED_OPERATION'; END IF;
     IF jsonb_typeof(v)<>'number' OR v::text !~ '^[0-9]+$' THEN RAISE EXCEPTION 'INVALID_PAIR_SCORE'; END IF;
     IF (v::text)::numeric>1998 THEN RAISE EXCEPTION 'INVALID_PAIR_SCORE'; END IF;
     SELECT value INTO team FROM jsonb_array_elements(coalesce(old_s#>'{trip,currentTeams}','[]'::jsonb))
       WHERE value->>'id'=key;
     IF team IS NULL OR jsonb_array_length(team->'playerIds')<>2 THEN RAISE EXCEPTION 'INVALID_TEAM'; END IF;
     IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(team->'playerIds') member
        WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(old_s->'players') person
          WHERE person->>'id'=member AND iig_closed_entry.eligible(old_s,person))) THEN RAISE EXCEPTION 'INELIGIBLE_PAIR'; END IF;
   END IF;
 END LOOP;
 IF EXISTS (SELECT 1 FROM jsonb_each(coalesce(old_s#>'{trip,currentTeamScores}','{}'::jsonb)) t
   WHERE t.value<>'null'::jsonb AND (new_s#>ARRAY['trip','currentTeamScores',t.key]) IS DISTINCT FROM t.value)
 THEN RAISE EXCEPTION 'PAIR_SCORE_REMOVAL'; END IF;
END $function$;

CREATE OR REPLACE FUNCTION iig_closed_entry.guard_row()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE m iig_closed_entry.rounds; p iig_closed_entry.permits; g text;expected jsonb;selection integer;matched boolean:=false;person jsonb;prior_person jsonb;backup jsonb;submitted_team jsonb;field jsonb;individual boolean;
BEGIN
 IF TG_OP='DELETE' THEN PERFORM iig_private.authorise_group_delete(OLD.id, OLD.group_pin); RETURN OLD; END IF;
 IF NEW.id IS DISTINCT FROM OLD.id THEN RAISE EXCEPTION 'PROTECTED_GROUP_IDENTITY'; END IF;
 -- Preserve existing owner metadata-only updates and ordinary notification hooks.
 IF NEW.state IS NOT DISTINCT FROM OLD.state THEN RETURN NEW; END IF;
 g:=OLD.id::text;
 individual:=iig_closed_entry.individual_money(OLD.state);
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
  IF individual THEN
   UPDATE iig_closed_entry.rounds SET revision=revision+1 WHERE group_id=g;
  ELSE
  UPDATE iig_closed_entry.rounds SET revision=revision+1,
   closed=closed OR iig_closed_entry.has_score(OLD.state) OR iig_closed_entry.has_score(NEW.state),
   entrant_ids=CASE WHEN entrant_ids IS NULL AND (iig_closed_entry.has_score(OLD.state) OR iig_closed_entry.has_score(NEW.state))
    THEN (SELECT coalesce(jsonb_agg(entry.value->'id'),'[]') FROM jsonb_array_elements(OLD.state->'players') entry(value) WHERE iig_closed_entry.eligible(OLD.state,entry.value)) ELSE entrant_ids END WHERE group_id=g;
  END IF;
 ELSIF p.operation='payment' THEN
  IF m.phase<>'open' THEN RAISE EXCEPTION 'ROUND_NOT_OPEN';END IF;
  PERFORM iig_closed_entry.validate_payment(OLD.state,NEW.state,m.closed OR (NOT individual AND iig_closed_entry.has_score(OLD.state)),m.entrant_ids,p.actor_id);
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
  ELSE UPDATE iig_closed_entry.rounds SET revision=revision+1,closed=closed OR (NOT individual AND iig_closed_entry.has_score(OLD.state)) WHERE group_id=g;END IF;
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
  IF m.phase<>'open' THEN RAISE EXCEPTION 'ENTRIES_CLOSED';END IF; IF m.closed OR iig_closed_entry.has_score(OLD.state) THEN IF (OLD.state - ARRAY['splitPrizes','firstPrize','secondPrize','thirdPrize','lastActivityAt']) IS DISTINCT FROM (NEW.state - ARRAY['splitPrizes','firstPrize','secondPrize','thirdPrize','lastActivityAt']) OR OLD.state->>'gameType' IS DISTINCT FROM 'money' OR OLD.state->>'roundOpen' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'SCORED_ROUND_PRIZE_ONLY'; END IF; END IF;
  PERFORM iig_closed_entry.validate_configuration(OLD.state,NEW.state);
  INSERT INTO iig_closed_entry.operation_audit VALUES(g,m.revision,p.operation,OLD.state);
  UPDATE iig_closed_entry.rounds SET revision=revision+1 WHERE group_id=g;
 ELSIF p.operation='settings' THEN
  PERFORM iig_closed_entry.validate_settings(OLD.state,NEW.state);
  UPDATE iig_closed_entry.rounds SET revision=revision+1 WHERE group_id=g;
 ELSIF p.operation='correct' THEN
  IF m.phase<>'open' OR NOT (m.closed OR (individual AND iig_closed_entry.has_score(OLD.state))) THEN RAISE EXCEPTION 'NO_OPEN_SCORED_ROUND';END IF;
  PERFORM iig_closed_entry.validate_correction(OLD.state,NEW.state);
  UPDATE iig_closed_entry.rounds SET revision=revision+1 WHERE group_id=g;
 ELSIF p.operation='cancel' THEN
  IF m.phase<>'open' THEN RAISE EXCEPTION 'NO_OPEN_ROUND';END IF;
  PERFORM iig_closed_entry.validate_cancellation(OLD.state,NEW.state);
  INSERT INTO iig_closed_entry.archives VALUES(g,m.round_id,OLD.state);
  UPDATE iig_closed_entry.rounds SET phase='finished',closed=true,revision=revision+1 WHERE group_id=g;
 ELSIF p.operation='finish' THEN
  IF m.phase<>'open' OR NOT (m.closed OR iig_closed_entry.has_score(OLD.state)) THEN RAISE EXCEPTION 'NO_OPEN_SCORED_ROUND';END IF;
  IF individual AND (NOT m.closed OR jsonb_array_length(coalesce(m.entrant_ids,'[]'))=0 OR EXISTS(
   SELECT 1 FROM jsonb_array_elements_text(m.entrant_ids) frozen(id) WHERE NOT EXISTS(
    SELECT 1 FROM jsonb_array_elements(OLD.state->'players') entrant WHERE entrant->>'id'=frozen.id AND iig_closed_entry.result_in(OLD.state,entrant))))
  THEN RAISE EXCEPTION 'INCOMPLETE_ROUND';END IF;
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
 -- The group and round rows are already locked. Inspect the accepted post-write
 -- state before releasing either lock, including payments and attendance changes.
 IF individual AND m.phase='open' AND NOT m.closed
  AND p.operation IN ('save','member_score','member_attendance','payment','members','correct') THEN
  field:=iig_closed_entry.completed_field(NEW.state);
  IF field IS NOT NULL THEN
   UPDATE iig_closed_entry.rounds SET closed=true,entrant_ids=field WHERE group_id=g;
  END IF;
 END IF;
 IF p.operation IN ('join','members') THEN
  INSERT INTO iig_closed_entry.identity_ids SELECT g,value->>'id' FROM jsonb_array_elements(NEW.state->'players') ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $function$;
