CREATE SCHEMA iig_closed_entry;
CREATE OR REPLACE FUNCTION public.iig_player_action(p_pin text, p_action text, p_payload jsonb, p_revision bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare gid bigint; rev bigint; pid text; s jsonb; me jsonb; other jsonb; item jsonb; arr jsonb; sg jsonb;
 fmt text; team jsonb; eligible boolean; val numeric; day text=to_char(now() at time zone 'Europe/London','YYYY-MM-DD');
 field text; ident text; balance numeric; before_score boolean; provider text;
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
  if s->>'gameType' is distinct from 'money' then raise exception 'Money Game required'; end if;
  if not before_score and not coalesce((select entrant_ids from iig_closed_entry.rounds where group_id=gid::text),'[]') ? pid then raise exception 'ENTRIES_CLOSED'; end if;
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
   item=item||jsonb_build_object('status',case when p_action='side_accept' then 'active' else 'declined' end,'acceptedAt',now());
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
 rev:=iig_closed_entry.write_authenticated(gid,rev,case when p_action='payment' then 'payment' when p_action like 'side_%' then 'sidegame' when p_action='claim_prize' then 'claim' when p_action='no_return' then 'member_score' else 'save' end,s,pid::text);
 return rev;
end $function$;

CREATE OR REPLACE FUNCTION iig_closed_entry.validate_sidegame(old_s jsonb, new_s jsonb, actor text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE o jsonb:=coalesce(old_s->'sideGame','{}');n jsonb:=new_s->'sideGame';a jsonb;b jsonb;p1 jsonb;p2 jsonb;
 k text;i integer;one jsonb;two jsonb;expected jsonb;first numeric;second numeric;balance numeric;settlement_changes integer:=0;
BEGIN
 IF actor IS NULL OR jsonb_typeof(n) IS DISTINCT FROM 'object'
 OR (old_s-ARRAY['sideGame','lastActivityAt']) IS DISTINCT FROM (new_s-ARRAY['sideGame','lastActivityAt'])
 OR (o-ARRAY['bets','scores','settlements']) IS DISTINCT FROM (n-ARRAY['bets','scores','settlements'])
 THEN RAISE EXCEPTION 'SIDEGAME_CHANGED_COMPETITION';END IF;
 FOREACH k IN ARRAY ARRAY['bets','scores','settlements'] LOOP
  IF jsonb_typeof(n->k) IS DISTINCT FROM 'array' OR jsonb_array_length(n->k)<jsonb_array_length(coalesce(o->k,'[]'))
   OR jsonb_array_length(n->k)>jsonb_array_length(coalesce(o->k,'[]'))+1
  THEN RAISE EXCEPTION 'INVALID_SIDEGAME_COLLECTION';END IF;
 END LOOP;
 IF (SELECT count(*) FROM jsonb_array_elements(n->'bets'))<>(SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(n->'bets') x)
 OR (SELECT count(*) FROM jsonb_array_elements(n->'settlements'))<>(SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(n->'settlements') x)
 OR (SELECT count(*) FROM jsonb_array_elements(n->'scores'))<>(SELECT count(DISTINCT (x->>'playerId',x->>'date')) FROM jsonb_array_elements(n->'scores') x)
 THEN RAISE EXCEPTION 'DUPLICATE_SIDEGAME_IDENTITY';END IF;
 -- Scores may change only for the server-identified actor, preserving prior rows.
 FOR i IN SELECT generate_series(0,jsonb_array_length(n->'scores')-1) LOOP
  a:=o->'scores'->i;b:=n->'scores'->i;
  IF a IS NOT DISTINCT FROM b THEN CONTINUE;END IF;
  IF b->>'playerId' IS DISTINCT FROM actor OR b->>'date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR b->>'date' IS NULL
   OR jsonb_typeof(b->'score') IS DISTINCT FROM 'number' OR b->>'format' NOT IN ('stableford','net') OR b->>'format' IS NULL
   OR b->>'score' !~ '^[0-9]+$' OR (b->>'score')::numeric>(CASE WHEN b->>'format'='net' THEN 999 ELSE 99 END)
  THEN RAISE EXCEPTION 'INVALID_SIDEGAME_SCORE';END IF;
  IF a IS NOT NULL AND (a-ARRAY['score','format','updatedAt']) IS DISTINCT FROM (b-ARRAY['score','format','updatedAt'])
  THEN RAISE EXCEPTION 'SIDEGAME_SCORE_IDENTITY';END IF;
  IF a IS NULL THEN
   SELECT value INTO p1 FROM jsonb_array_elements(old_s->'players') x WHERE x->>'id'=actor;
   IF b->>'playerName' IS DISTINCT FROM p1->>'name' OR
    (b-ARRAY['playerId','playerName','score','format','date','createdAt'])<>'{}'::jsonb THEN RAISE EXCEPTION 'SIDEGAME_SCORE_IDENTITY';END IF;
  END IF;
 END LOOP;
 FOR i IN SELECT generate_series(0,jsonb_array_length(n->'bets')-1) LOOP
  a:=o->'bets'->i;b:=n->'bets'->i;
  IF a IS NOT DISTINCT FROM b THEN CONTINUE;END IF;
  IF a IS NULL THEN
   SELECT value INTO p1 FROM jsonb_array_elements(old_s->'players') x WHERE x->>'id'=b->>'player1Id';
   SELECT value INTO p2 FROM jsonb_array_elements(old_s->'players') x WHERE x->>'id'=b->>'player2Id';
   IF p1 IS NULL OR p2 IS NULL OR b->>'player1Id' IS DISTINCT FROM actor OR b->>'player2Id'=actor
    OR b->>'player1Name' IS DISTINCT FROM p1->>'name' OR b->>'player2Name' IS DISTINCT FROM p2->>'name'
    OR jsonb_typeof(b->'id') IS DISTINCT FROM 'string' OR b->>'id' !~ '^[A-Za-z0-9_-]{1,100}$' OR b->>'date' IS NULL OR b->>'date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    OR jsonb_typeof(b->'stake') IS DISTINCT FROM 'number' OR (b->>'stake')::numeric<=0
    OR b->>'format' IS NULL OR b->>'format' NOT IN ('stableford','net')
    OR b->>'setup' IS NULL OR b->>'status' IS NULL
    OR NOT ((b->>'setup'='challenge' AND b->>'status'='pending') OR (b->>'setup'='in_person' AND b->>'status'='active'))
    OR (b-ARRAY['id','player1Id','player1Name','player2Id','player2Name','stake','format','date','status','setup','createdAt'])<>'{}'::jsonb
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(o->'bets','[]')) x WHERE x->>'date'=b->>'date' AND x->>'status' IN ('pending','active')
      AND ((x->>'player1Id'=actor AND x->>'player2Id'=b->>'player2Id') OR (x->>'player2Id'=actor AND x->>'player1Id'=b->>'player2Id')))
   THEN RAISE EXCEPTION 'INVALID_SIDEGAME_BET';END IF;
  ELSIF a->>'status'='pending' AND a->>'setup'='challenge' AND a->>'player2Id'=actor THEN
   IF b->>'status'='active' AND EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(o->'bets','[]')) x WHERE x->>'id'<>a->>'id'
    AND x->>'date'=a->>'date' AND x->>'status' IN ('active','resolved') AND x->>'format' IS DISTINCT FROM a->>'format'
    AND (x->>'player1Id' IN (a->>'player1Id',a->>'player2Id') OR x->>'player2Id' IN (a->>'player1Id',a->>'player2Id')))
   THEN RAISE EXCEPTION 'SIDEGAME_FORMAT_CONFLICT';END IF;
   IF (a-ARRAY['status','acceptedAt','declinedAt']) IS DISTINCT FROM (b-ARRAY['status','acceptedAt','declinedAt'])
    OR b->>'status' IS NULL OR b->>'status' NOT IN ('active','declined')
    OR (b->>'status'='active' AND (b->'declinedAt' IS DISTINCT FROM a->'declinedAt' OR jsonb_typeof(b->'acceptedAt') IS DISTINCT FROM 'string'))
    OR (b->>'status'='declined' AND (b->'acceptedAt' IS DISTINCT FROM a->'acceptedAt' OR jsonb_typeof(b->'declinedAt') IS DISTINCT FROM 'string'))
   THEN RAISE EXCEPTION 'INVALID_CHALLENGE_RESPONSE';END IF;
  ELSIF a->>'status'='active' AND b->>'status'='resolved' THEN
   SELECT value INTO one FROM jsonb_array_elements(n->'scores') x WHERE x->>'playerId'=a->>'player1Id' AND x->>'date'=a->>'date';
   SELECT value INTO two FROM jsonb_array_elements(n->'scores') x WHERE x->>'playerId'=a->>'player2Id' AND x->>'date'=a->>'date';
   IF one IS NULL OR two IS NULL OR one->>'format' IS DISTINCT FROM a->>'format' OR two->>'format' IS DISTINCT FROM a->>'format'
    OR jsonb_typeof(b->'resolvedAt') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'MISSING_SIDEGAME_SCORES';END IF;
   first:=(one->>'score')::numeric;second:=(two->>'score')::numeric;
   IF first=second THEN expected:=jsonb_build_object('result','draw','winnerId',NULL,'loserId',NULL,'amount',0);
   ELSE
    expected:=jsonb_build_object('result','win','winnerId',CASE WHEN (a->>'format'='net' AND first<second) OR (a->>'format'='stableford' AND first>second) THEN a->>'player1Id' ELSE a->>'player2Id' END,
    'loserId',CASE WHEN (a->>'format'='net' AND first<second) OR (a->>'format'='stableford' AND first>second) THEN a->>'player2Id' ELSE a->>'player1Id' END,'amount',a->'stake');END IF;
   expected:=a||expected||jsonb_build_object('status','resolved','resolvedAt',b->'resolvedAt');
   IF b IS DISTINCT FROM expected THEN RAISE EXCEPTION 'FORGED_SIDEGAME_RESULT';END IF;
  ELSE RAISE EXCEPTION 'IMMUTABLE_SIDEGAME_BET';END IF;
 END LOOP;
 FOR i IN SELECT generate_series(0,jsonb_array_length(n->'settlements')-1) LOOP
  a:=o->'settlements'->i;b:=n->'settlements'->i;
  IF a IS NOT DISTINCT FROM b THEN CONTINUE;END IF;
  settlement_changes:=settlement_changes+1;
  IF settlement_changes>1 THEN RAISE EXCEPTION 'ONE_SETTLEMENT_REQUIRED';END IF;
  IF a IS NULL THEN
   SELECT value INTO p1 FROM jsonb_array_elements(old_s->'players') x WHERE x->>'id'=b->>'debtorId';
   SELECT value INTO p2 FROM jsonb_array_elements(old_s->'players') x WHERE x->>'id'=b->>'creditorId';
   IF b->>'debtorId' IS DISTINCT FROM actor OR b->>'creditorId'=actor OR p1 IS NULL OR p2 IS NULL
    OR b->>'debtorName' IS DISTINCT FROM p1->>'name' OR b->>'creditorName' IS DISTINCT FROM p2->>'name'
    OR jsonb_typeof(b->'id') IS DISTINCT FROM 'string' OR b->>'id' !~ '^[A-Za-z0-9_-]{1,100}$' OR b->>'status' IS DISTINCT FROM 'pending'
    OR jsonb_typeof(b->'amount') IS DISTINCT FROM 'number' OR (b->>'amount')::numeric<=0
    OR (b-ARRAY['id','debtorId','debtorName','creditorId','creditorName','amount','status','requestedAt'])<>'{}'::jsonb
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(o->'settlements','[]')) x WHERE x->>'debtorId'=actor AND x->>'creditorId'=b->>'creditorId' AND x->>'status'='pending')
   THEN RAISE EXCEPTION 'INVALID_SIDEGAME_SETTLEMENT';END IF;
  ELSE
   IF a->>'status' IS DISTINCT FROM 'pending' OR a->>'creditorId' IS DISTINCT FROM actor
    OR b->>'status' IS DISTINCT FROM 'confirmed' OR jsonb_typeof(b->'confirmedAt') IS DISTINCT FROM 'string'
    OR (a-ARRAY['status','confirmedAt']) IS DISTINCT FROM (b-ARRAY['status','confirmedAt'])
   THEN RAISE EXCEPTION 'INVALID_SIDEGAME_CONFIRMATION';END IF;
  END IF;
  -- A request/confirmation may not exceed the existing committed net debt.
  SELECT coalesce(sum(CASE WHEN x->>'winnerId'=b->>'creditorId' AND x->>'loserId'=b->>'debtorId' THEN (x->>'amount')::numeric
    WHEN x->>'winnerId'=b->>'debtorId' AND x->>'loserId'=b->>'creditorId' THEN -(x->>'amount')::numeric ELSE 0 END),0)
   INTO balance FROM jsonb_array_elements(coalesce(o->'bets','[]')) x WHERE x->>'status'='resolved' AND x->>'result'='win';
  SELECT balance-coalesce(sum(CASE WHEN x->>'debtorId'=b->>'debtorId' AND x->>'creditorId'=b->>'creditorId' THEN (x->>'amount')::numeric
    WHEN x->>'debtorId'=b->>'creditorId' AND x->>'creditorId'=b->>'debtorId' THEN -(x->>'amount')::numeric ELSE 0 END),0)
   INTO balance FROM jsonb_array_elements(coalesce(o->'settlements','[]')) x WHERE x->>'status'='confirmed';
  IF (b->>'amount')::numeric>balance THEN RAISE EXCEPTION 'SIDEGAME_SETTLEMENT_EXCEEDS_DEBT';END IF;
 END LOOP;
END $function$;
