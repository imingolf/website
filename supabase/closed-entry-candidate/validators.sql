-- OFFLINE REVIEW CANDIDATE. Requires core.sql schema/tables BEFORE this file.
-- Ported pure validators; no laboratory role identity or duplicate group state.
-- Ranking/champion/new-Trip/maintenance coverage remains incomplete: NOT INSTALLABLE.
CREATE FUNCTION iig_closed_entry.has_score(s jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(s->'players') p
   WHERE p->'stableford' IS NOT NULL AND p->'stableford'<>'null'::jsonb
      OR p->'netScore' IS NOT NULL AND p->'netScore'<>'null'::jsonb
      OR p->'noReturn'='true'::jsonb)
 OR EXISTS (SELECT 1 FROM jsonb_each(coalesce(s#>'{trip,currentTeamScores}','{}'::jsonb)) x
            WHERE x.value<>'null'::jsonb AND x.value<>'""'::jsonb)
$$;

CREATE FUNCTION iig_closed_entry.eligible(s jsonb,p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT (CASE WHEN s#>'{trip,active}'='true'::jsonb THEN
   coalesce(s#>'{trip,currentPlayingIds}',s#>'{trip,playerIds}',
     (SELECT jsonb_agg(x->'id') FROM jsonb_array_elements(s->'players') x)) ? (p->>'id')
   ELSE true END)
 AND CASE WHEN s->>'gameType'='money' AND (s->>'stake')::numeric>0
   THEN coalesce(p->'paid'='true'::jsonb,false)
   WHEN s#>'{trip,active}'='true'::jsonb THEN true
   ELSE coalesce(p->'playingThisRound'='true'::jsonb,false) END
$$;

CREATE FUNCTION iig_closed_entry.validate_snapshot(old_s jsonb,new_s jsonb,latched boolean)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE p jsonb; n jsonb; locked boolean; first_score boolean; scores text[]; key text; v jsonb; team jsonb; old_v jsonb;
BEGIN
 scores:=ARRAY['stableford','netScore','noReturn','scoreSubmitted'];
 IF jsonb_typeof(old_s) IS DISTINCT FROM 'object' OR jsonb_typeof(new_s) IS DISTINCT FROM 'object'
    OR jsonb_typeof(old_s->'players') IS DISTINCT FROM 'array' OR jsonb_typeof(new_s->'players') IS DISTINCT FROM 'array'
    OR new_s->>'roundId' IS NULL OR new_s->>'roundId'='' THEN
   RAISE EXCEPTION 'INVALID_STATE'; END IF;
 -- Reject forged identity/reset/history/stake/game type/team eligibility changes.
 IF (old_s-'players'-'trip'-'lastActivityAt') IS DISTINCT FROM (new_s-'players'-'trip'-'lastActivityAt')
    OR (coalesce(old_s->'trip','{}'::jsonb)-'currentTeamScores') IS DISTINCT FROM
       (coalesce(new_s->'trip','{}'::jsonb)-'currentTeamScores') THEN
   RAISE EXCEPTION 'PROTECTED_ROUND_FIELDS'; END IF;
 IF EXISTS (SELECT 1 FROM jsonb_array_elements(new_s->'players') x
   WHERE jsonb_typeof(x)<>'object' OR coalesce(x->>'id','')='' OR jsonb_typeof(x->'id')<>'string'
     OR jsonb_typeof(x->'paid') IS DISTINCT FROM 'boolean'
     OR jsonb_typeof(x->'playingThisRound') IS DISTINCT FROM 'boolean')
 OR (SELECT count(*) FROM jsonb_array_elements(new_s->'players')) <>
    (SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(new_s->'players') x) THEN
   RAISE EXCEPTION 'INVALID_PLAYERS'; END IF;
 locked:=latched OR iig_closed_entry.has_score(old_s);
 first_score:=NOT locked AND iig_closed_entry.has_score(new_s);
 FOR p IN SELECT value FROM jsonb_array_elements(old_s->'players') LOOP
   SELECT value INTO n FROM jsonb_array_elements(new_s->'players') WHERE value->>'id'=p->>'id';
   IF n IS NULL THEN RAISE EXCEPTION 'PLAYER_REMOVAL_REQUIRES_PROTECTED_OPERATION'; END IF;
   IF (locked OR first_score) AND (p-scores) IS DISTINCT FROM (n-scores) THEN
     RAISE EXCEPTION 'ENTRIES_CLOSED'; END IF;
   IF (p-scores) IS DISTINCT FROM (n-scores) AND iig_closed_entry.has_score(old_s) THEN
     RAISE EXCEPTION 'ENTRIES_CLOSED'; END IF;
   IF EXISTS (SELECT 1 FROM unnest(scores) AS keys(k) WHERE
      p->keys.k IS NOT NULL AND p->keys.k<>'null'::jsonb AND p->keys.k<>'false'::jsonb
      AND p->keys.k IS DISTINCT FROM n->keys.k) THEN
      RAISE EXCEPTION 'SCORE_CORRECTION_REQUIRES_PROTECTED_OPERATION'; END IF;
   IF (p-scores)=(n-scores) AND (p IS DISTINCT FROM n)
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
      AND EXISTS (SELECT 1 FROM unnest(scores) AS keys(k) WHERE p->keys.k IS DISTINCT FROM n->keys.k) THEN
      RAISE EXCEPTION 'INELIGIBLE_SCORER'; END IF;
 END LOOP;
 FOR n IN SELECT value FROM jsonb_array_elements(new_s->'players') LOOP
   IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(old_s->'players') AS existing(value) WHERE existing.value->>'id'=n->>'id')
      AND (iig_closed_entry.eligible(new_s,n) OR n->'paid'='true'::jsonb
           OR iig_closed_entry.has_score(jsonb_build_object('players',jsonb_build_array(n)))) THEN
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
END $$;

-- Narrow non-financial group settings; never score, entry or payout changes.
CREATE FUNCTION iig_closed_entry.validate_settings(old_s jsonb,new_s jsonb)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF jsonb_typeof(new_s) IS DISTINCT FROM 'object'
 OR (old_s-ARRAY['groupName','adminPin','lastActivityAt']) IS DISTINCT FROM (new_s-ARRAY['groupName','adminPin','lastActivityAt'])
 THEN RAISE EXCEPTION 'SETTINGS_CHANGED_PROTECTED_FIELDS';END IF;
 IF old_s->'groupName' IS DISTINCT FROM new_s->'groupName' AND
  (jsonb_typeof(new_s->'groupName') IS DISTINCT FROM 'string' OR length(btrim(new_s->>'groupName')) NOT BETWEEN 1 AND 80)
 THEN RAISE EXCEPTION 'INVALID_GROUP_NAME';END IF;
 IF old_s->'adminPin' IS DISTINCT FROM new_s->'adminPin' AND
  (jsonb_typeof(new_s->'adminPin') IS DISTINCT FROM 'string' OR new_s->>'adminPin' !~ '^[0-9]{4}$')
 THEN RAISE EXCEPTION 'INVALID_ADMIN_PIN';END IF;
END $$;

-- An explicit scoped correction changes ONLY an existing submitted score. It
-- never clears the server closure latch or edits entry/payment/eligibility data.
CREATE FUNCTION iig_closed_entry.validate_correction(old_s jsonb,new_s jsonb)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE scores text[]:=ARRAY['stableford','netScore','noReturn','scoreSubmitted'];
 p jsonb; n jsonb; team jsonb; key text; v jsonb; old_v jsonb; changed boolean:=false;
BEGIN
 IF jsonb_typeof(new_s) IS DISTINCT FROM 'object'
 OR jsonb_typeof(new_s->'players') IS DISTINCT FROM 'array'
 OR (old_s-ARRAY['players','trip','lastActivityAt']) IS DISTINCT FROM (new_s-ARRAY['players','trip','lastActivityAt'])
 OR (coalesce(old_s->'trip','{}')-'currentTeamScores') IS DISTINCT FROM (coalesce(new_s->'trip','{}')-'currentTeamScores')
 OR jsonb_array_length(old_s->'players')<>jsonb_array_length(new_s->'players')
 THEN RAISE EXCEPTION 'CORRECTION_CHANGED_PROTECTED_FIELDS';END IF;
 -- Preserve order as well as identities: a correction is not player maintenance.
 FOR key IN SELECT generate_series(0,jsonb_array_length(old_s->'players')-1)::text LOOP
  p:=old_s#>ARRAY['players',key];n:=new_s#>ARRAY['players',key];
  IF (p-scores) IS DISTINCT FROM (n-scores) THEN RAISE EXCEPTION 'CORRECTION_CHANGED_PROTECTED_FIELDS';END IF;
  IF p IS NOT DISTINCT FROM n THEN CONTINUE;END IF;
  changed:=true;
  IF NOT iig_closed_entry.eligible(old_s,p)
  OR NOT iig_closed_entry.has_score(jsonb_build_object('players',jsonb_build_array(p)))
  OR n->'scoreSubmitted' IS DISTINCT FROM 'true'::jsonb
  OR jsonb_typeof(n->'noReturn') IS DISTINCT FROM 'boolean'
  THEN RAISE EXCEPTION 'CORRECTION_REQUIRES_EXISTING_SUBMITTED_SCORE';END IF;
  IF old_s->>'pointsCompetition'='stableford' THEN
   v:=n->'stableford';
   IF n->'netScore' IS DISTINCT FROM 'null'::jsonb OR n->'noReturn' IS DISTINCT FROM 'false'::jsonb
    OR jsonb_typeof(v) IS DISTINCT FROM 'number' OR v::text !~ '^[0-9]{1,2}$'
   THEN RAISE EXCEPTION 'INVALID_CORRECTED_SCORE';END IF;
  ELSIF old_s->>'pointsCompetition'='net' THEN
   IF n->'stableford' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'INVALID_CORRECTED_SCORE';END IF;
   IF n->'noReturn'='true'::jsonb THEN
    IF n->'netScore' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'INVALID_CORRECTED_SCORE';END IF;
   ELSE
    v:=n->'netScore';
    IF jsonb_typeof(v) IS DISTINCT FROM 'number' OR v::text !~ '^[0-9]{1,3}$'
    THEN RAISE EXCEPTION 'INVALID_CORRECTED_SCORE';END IF;
   END IF;
  ELSE RAISE EXCEPTION 'UNSUPPORTED_CORRECTION_FORMAT';END IF;
 END LOOP;
 IF (SELECT coalesce(jsonb_agg(e.key ORDER BY e.key),'[]') FROM jsonb_each(coalesce(old_s#>'{trip,currentTeamScores}','{}')) e)
  IS DISTINCT FROM
  (SELECT coalesce(jsonb_agg(e.key ORDER BY e.key),'[]') FROM jsonb_each(coalesce(new_s#>'{trip,currentTeamScores}','{}')) e)
 THEN RAISE EXCEPTION 'CORRECTION_CHANGED_TEAM_KEYS';END IF;
 FOR key,v IN SELECT * FROM jsonb_each(coalesce(new_s#>'{trip,currentTeamScores}','{}')) LOOP
  old_v:=old_s#>ARRAY['trip','currentTeamScores',key];
  IF v IS NOT DISTINCT FROM old_v THEN CONTINUE;END IF;
  changed:=true;
  IF old_v IS NULL OR old_v='null'::jsonb OR old_v='""'::jsonb
   OR jsonb_typeof(v) IS DISTINCT FROM 'number' OR v::text !~ '^[0-9]+$' OR v::text::numeric>1998
  THEN RAISE EXCEPTION 'INVALID_PAIR_CORRECTION';END IF;
  SELECT value INTO team FROM jsonb_array_elements(coalesce(old_s#>'{trip,currentTeams}','[]')) t WHERE t->>'id'=key;
  IF team IS NULL OR jsonb_array_length(team->'playerIds')<>2
   OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(team->'playerIds') member WHERE NOT EXISTS(
    SELECT 1 FROM jsonb_array_elements(old_s->'players') person WHERE person->>'id'=member AND iig_closed_entry.eligible(old_s,person)))
  THEN RAISE EXCEPTION 'INELIGIBLE_PAIR';END IF;
 END LOOP;
 IF NOT changed THEN RAISE EXCEPTION 'NO_CORRECTED_SCORE';END IF;
END $$;

-- Matches the actual non-Trip cancelCurrentRound reset. Exact old state is archived
-- by the boundary, without erasing result history, League totals or payment evidence.
CREATE FUNCTION iig_closed_entry.validate_cancellation(old_s jsonb,new_s jsonb)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE p jsonb;n jsonb;key text;
 reset text[]:=ARRAY['paid','competition','stableford','netScore','noReturn','scoreSubmitted'];
BEGIN
 IF old_s#>'{trip,active}'='true'::jsonb THEN RAISE EXCEPTION 'TRIP_CANCELLATION_REQUIRES_REVIEW';END IF;
 IF jsonb_typeof(new_s) IS DISTINCT FROM 'object' OR jsonb_typeof(new_s->'players') IS DISTINCT FROM 'array'
 OR (old_s-ARRAY['players','course','date','gameType','pointsCompetition','pointsValue','roundOpen','lastActivityAt'])
  IS DISTINCT FROM (new_s-ARRAY['players','course','date','gameType','pointsCompetition','pointsValue','roundOpen','lastActivityAt'])
 OR new_s->'course' IS DISTINCT FROM '""'::jsonb OR new_s->'date' IS DISTINCT FROM '""'::jsonb
 OR new_s->'gameType' IS DISTINCT FROM '"money"'::jsonb OR new_s->'pointsCompetition' IS DISTINCT FROM '"stableford"'::jsonb
 OR new_s->'pointsValue' IS DISTINCT FROM '10'::jsonb OR new_s->'roundOpen' IS DISTINCT FROM 'false'::jsonb
 OR jsonb_array_length(old_s->'players')<>jsonb_array_length(new_s->'players')
 THEN RAISE EXCEPTION 'INVALID_CANCELLATION';END IF;
 FOR key IN SELECT generate_series(0,jsonb_array_length(old_s->'players')-1)::text LOOP
  p:=old_s#>ARRAY['players',key];n:=new_s#>ARRAY['players',key];
  IF (p-reset) IS DISTINCT FROM (n-reset)
   OR n->'paid' IS DISTINCT FROM 'false'::jsonb OR n->'competition' IS DISTINCT FROM 'null'::jsonb
   OR n->'stableford' IS DISTINCT FROM 'null'::jsonb OR n->'netScore' IS DISTINCT FROM 'null'::jsonb
   OR n->'noReturn' IS DISTINCT FROM 'false'::jsonb OR n->'scoreSubmitted' IS DISTINCT FROM 'false'::jsonb
  THEN RAISE EXCEPTION 'INVALID_CANCELLATION_RESET';END IF;
 END LOOP;
END $$;



CREATE FUNCTION iig_closed_entry.validate_finished_result(old_s jsonb,new_s jsonb)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE is_trip boolean; old_records jsonb; new_records jsonb; record jsonb;
 p jsonb; n jsonb; r jsonb; stripped text[]; money_pot numeric; active_ids jsonb;
 current_round integer; total_rounds integer; old_wins numeric; new_wins numeric; award numeric;
BEGIN
 IF jsonb_typeof(new_s) IS DISTINCT FROM 'object' OR jsonb_typeof(new_s->'players') IS DISTINCT FROM 'array'
 THEN RAISE EXCEPTION 'INVALID_FINISHED_RESULT'; END IF;
 is_trip:=coalesce(old_s#>'{trip,active}'='true'::jsonb,false);
 IF (old_s-ARRAY['players','history','trip','roundOpen','lastActivityAt']) IS DISTINCT FROM
    (new_s-ARRAY['players','history','trip','roundOpen','lastActivityAt']) THEN RAISE EXCEPTION 'FINISH_CHANGED_SETUP'; END IF;
 IF NOT is_trip THEN
   IF coalesce(old_s->'trip','{}') IS DISTINCT FROM coalesce(new_s->'trip','{}')
      OR new_s->'roundOpen' IS DISTINCT FROM 'false'::jsonb THEN RAISE EXCEPTION 'INVALID_FINISH_PHASE'; END IF;
   old_records:=coalesce(old_s->'history','[]');new_records:=new_s->'history';
   IF jsonb_typeof(new_records) IS DISTINCT FROM 'array' OR jsonb_array_length(new_records)<>jsonb_array_length(old_records)+1
      OR (new_records-0) IS DISTINCT FROM old_records THEN RAISE EXCEPTION 'HISTORY_REPLACEMENT'; END IF;
   record:=new_records->0;
 ELSE
   IF coalesce(old_s->'history','[]') IS DISTINCT FROM coalesce(new_s->'history','[]') THEN RAISE EXCEPTION 'HISTORY_REPLACEMENT'; END IF;
   old_records:=coalesce(old_s#>'{trip,rounds}','[]');new_records:=new_s#>'{trip,rounds}';
   IF jsonb_typeof(new_records) IS DISTINCT FROM 'array' OR jsonb_array_length(new_records)<>jsonb_array_length(old_records)+1
      OR (new_records-(jsonb_array_length(new_records)-1)) IS DISTINCT FROM old_records THEN RAISE EXCEPTION 'TRIP_HISTORY_REPLACEMENT'; END IF;
   record:=new_records->(jsonb_array_length(new_records)-1);
   stripped:=ARRAY['rounds','standings','teamStandings','currentTeamScores','currentRound','completed','active',
      'champion','tripTieNames','pointsChampion','teamChampion'];
   IF ((old_s->'trip')-stripped) IS DISTINCT FROM ((new_s->'trip')-stripped) THEN RAISE EXCEPTION 'FINISH_CHANGED_TRIP_SETUP'; END IF;
   current_round:=(old_s#>>'{trip,currentRound}')::integer;total_rounds:=(old_s#>>'{trip,totalRounds}')::integer;
   IF current_round<total_rounds THEN
     IF (new_s#>>'{trip,currentRound}')::integer IS DISTINCT FROM current_round+1
        OR new_s->'roundOpen' IS DISTINCT FROM 'false'::jsonb
        OR new_s#>'{trip,active}' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'INVALID_TRIP_ADVANCE'; END IF;
   ELSE
     IF new_s#>'{trip,completed}' IS DISTINCT FROM 'true'::jsonb
        OR new_s#>'{trip,active}' IS DISTINCT FROM 'false'::jsonb
        OR new_s#>'{trip,currentRound}' IS DISTINCT FROM old_s#>'{trip,currentRound}' THEN RAISE EXCEPTION 'INVALID_TRIP_COMPLETION'; END IF;
   END IF;
 END IF;
 IF record->'course' IS DISTINCT FROM old_s->'course' OR record->'date' IS DISTINCT FROM old_s->'date'
    OR record->'gameType' IS DISTINCT FROM old_s->'gameType'
    OR record->>'pointsCompetition' IS DISTINCT FROM coalesce(old_s->>'pointsCompetition','stableford')
 THEN RAISE EXCEPTION 'FINISH_RECORD_IDENTITY'; END IF;
 active_ids:=CASE WHEN is_trip THEN coalesce(old_s#>'{trip,currentPlayingIds}',old_s#>'{trip,playerIds}') ELSE NULL END;
 SELECT count(*)*coalesce((old_s->>'stake')::numeric,0) INTO money_pot
 FROM jsonb_array_elements(old_s->'players') x
 WHERE x->'paid'='true'::jsonb AND (active_ids IS NULL OR active_ids ? (x->>'id'));
 IF NOT record ? 'teamResults' THEN
   IF jsonb_typeof(record->'players') IS DISTINCT FROM 'array'
      OR jsonb_array_length(record->'players')<>jsonb_array_length(old_s->'players') THEN RAISE EXCEPTION 'MISSING_HISTORICAL_PLAYERS'; END IF;
 END IF;
 IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(coalesce(record->'winners','[]')) winner
   WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(old_s->'players') player
     WHERE player->>'name'=winner AND iig_closed_entry.eligible(old_s,player)
       AND (CASE WHEN old_s->>'pointsCompetition'='net' THEN player->'netScore' ELSE player->'stableford' END) IS NOT NULL
       AND (CASE WHEN old_s->>'pointsCompetition'='net' THEN player->'netScore' ELSE player->'stableford' END)<>'null'::jsonb))
 THEN RAISE EXCEPTION 'INELIGIBLE_WINNER'; END IF;
 IF EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(record->'payouts','[]')) payout
   WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(old_s->'players') player
    WHERE player->>'name'=payout->>'winnerName' AND iig_closed_entry.eligible(old_s,player)
      AND (payout->>'winnerPlayerId' IS NULL OR payout->>'winnerPlayerId'=player->>'id')))
 THEN RAISE EXCEPTION 'INELIGIBLE_PAYOUT'; END IF;
 IF old_s->>'gameType'='money' THEN
   IF record ? 'teamPot' THEN
     IF (record->>'teamPot')::numeric IS DISTINCT FROM money_pot THEN RAISE EXCEPTION 'FINISH_POT_CHANGED'; END IF;
   ELSE
     IF record->'splitPrizes' IS DISTINCT FROM old_s->'splitPrizes'
        OR coalesce((record->>'secondPrize')::numeric,0) IS DISTINCT FROM coalesce((old_s->>'secondPrize')::numeric,0)
        OR coalesce((record->>'thirdPrize')::numeric,0) IS DISTINCT FROM coalesce((old_s->>'thirdPrize')::numeric,0)
     THEN RAISE EXCEPTION 'FINISH_PRIZE_SETUP_CHANGED'; END IF;
     IF jsonb_typeof(record->'payouts') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'MISSING_PAYOUTS'; END IF;
     IF EXISTS (SELECT 1 FROM jsonb_array_elements(record->'payouts') x
       WHERE jsonb_typeof(x->'amount') IS DISTINCT FROM 'number' OR (x->>'amount')::numeric<0)
     OR (SELECT coalesce(sum((x->>'amount')::numeric),0) FROM jsonb_array_elements(record->'payouts') x)
       > money_pot + jsonb_array_length(record->'payouts')::numeric/200
     THEN RAISE EXCEPTION 'PAYOUT_BUDGET_CHANGED'; END IF;
     IF coalesce((record->>'stablefordPot')::numeric,0) IS DISTINCT FROM
        (CASE WHEN old_s->>'pointsCompetition'='net' THEN 0 ELSE money_pot END)
      OR coalesce((record->>'netPot')::numeric,0) IS DISTINCT FROM
        (CASE WHEN old_s->>'pointsCompetition'='net' THEN money_pot ELSE 0 END)
      OR record->'stake' IS DISTINCT FROM old_s->'stake' THEN RAISE EXCEPTION 'FINISH_POT_CHANGED'; END IF;
   END IF;
 END IF;
 IF jsonb_array_length(new_s->'players')<>jsonb_array_length(old_s->'players')
 OR (SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(new_s->'players') x)<>jsonb_array_length(old_s->'players')
 THEN RAISE EXCEPTION 'FINISH_PLAYERS_CHANGED'; END IF;
 stripped:=ARRAY['paid','stableford','netScore','noReturn','scoreSubmitted','competition','wins','leaguePoints'];
 FOR p IN SELECT value FROM jsonb_array_elements(old_s->'players') LOOP
   SELECT value INTO n FROM jsonb_array_elements(new_s->'players') WHERE value->>'id'=p->>'id';
   IF n IS NULL OR (p-stripped) IS DISTINCT FROM (n-stripped)
     OR n->'paid' IS DISTINCT FROM 'false'::jsonb OR n->'stableford' IS DISTINCT FROM 'null'::jsonb
     OR n->'netScore' IS DISTINCT FROM 'null'::jsonb OR n->'noReturn' IS DISTINCT FROM 'false'::jsonb
     OR n->'scoreSubmitted' IS DISTINCT FROM 'false'::jsonb OR n->'competition' IS DISTINCT FROM 'null'::jsonb
   THEN RAISE EXCEPTION 'INVALID_FINISH_PLAYER_RESET'; END IF;
   old_wins:=coalesce((p->>'wins')::numeric,0);new_wins:=coalesce((n->>'wins')::numeric,0);
   IF new_wins IS DISTINCT FROM old_wins+(CASE WHEN NOT is_trip AND coalesce(record->'winners','[]') ? (p->>'name') THEN 1 ELSE 0 END)
   THEN RAISE EXCEPTION 'INVALID_WIN_AWARD'; END IF;
   award:=0;
   IF NOT is_trip AND old_s->>'gameType'='points' THEN
     SELECT coalesce(sum((x->>'points')::numeric),0) INTO award FROM jsonb_array_elements(coalesce(record->'pointsResults','[]')) x
     WHERE x->>'name'=p->>'name';
   END IF;
   IF coalesce((n->>'leaguePoints')::numeric,0) IS DISTINCT FROM coalesce((p->>'leaguePoints')::numeric,0)+award
   THEN RAISE EXCEPTION 'INVALID_LEAGUE_AWARD'; END IF;
   IF record ? 'players' THEN
     SELECT value INTO r FROM jsonb_array_elements(record->'players') WHERE
       (value ? 'id' AND value->>'id'=p->>'id') OR (NOT value ? 'id' AND value->>'name'=p->>'name');
     IF r IS NULL OR r->'name' IS DISTINCT FROM p->'name' OR r->'handicap' IS DISTINCT FROM p->'handicap'
        OR r->'stableford' IS DISTINCT FROM p->'stableford' OR r->'netScore' IS DISTINCT FROM p->'netScore'
        OR coalesce(r->'noReturn','false') IS DISTINCT FROM coalesce(p->'noReturn','false')
     THEN RAISE EXCEPTION 'HISTORICAL_SCORE_CHANGED'; END IF;
   END IF;
 END LOOP;
 -- Pair record must preserve all submitted teams and scores from committed state.
 IF record ? 'teamResults' THEN
   IF record->'teams' IS NULL OR jsonb_array_length(record->'teamResults')<1 THEN RAISE EXCEPTION 'INVALID_TEAM_RESULT'; END IF;
   FOR r IN SELECT value FROM jsonb_array_elements(record->'teamResults') LOOP
     IF r->'score' IS DISTINCT FROM old_s#>ARRAY['trip','currentTeamScores',r->>'id'] THEN RAISE EXCEPTION 'HISTORICAL_TEAM_SCORE_CHANGED'; END IF;
   END LOOP;
 END IF;
END $$;

CREATE FUNCTION iig_closed_entry.validate_setup(old_s jsonb,setup_state jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE is_trip boolean; p jsonb; n jsonb; planned jsonb; item jsonb; playing jsonb; groups jsonb; teams jsonb;
BEGIN
 is_trip:=coalesce(old_s#>'{trip,active}'='true'::jsonb,false);
 IF jsonb_typeof(setup_state) IS DISTINCT FROM 'object' OR jsonb_typeof(setup_state->'players') IS DISTINCT FROM 'array'
   OR setup_state->'roundOpen' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'INVALID_SETUP'; END IF;
 IF (old_s-ARRAY['players','trip','course','date','stake','gameType','pointsCompetition','pointsValue','splitPrizes','firstPrize','secondPrize','thirdPrize','roundId','roundOpen','lastActivityAt'])
    IS DISTINCT FROM (setup_state-ARRAY['players','trip','course','date','stake','gameType','pointsCompetition','pointsValue','splitPrizes','firstPrize','secondPrize','thirdPrize','roundId','roundOpen','lastActivityAt'])
 THEN RAISE EXCEPTION 'SETUP_CHANGED_HISTORY_OR_UNRELATED_FIELDS'; END IF;
 IF coalesce(setup_state->>'course','')='' OR coalesce(setup_state->>'date','')=''
    OR setup_state->>'gameType' NOT IN ('money','points') OR setup_state->>'gameType' IS NULL
    OR setup_state->>'pointsCompetition' NOT IN ('stableford','net') OR setup_state->>'pointsCompetition' IS NULL
    OR jsonb_typeof(setup_state->'stake') IS DISTINCT FROM 'number'
    OR (setup_state->>'stake')::numeric<0 THEN RAISE EXCEPTION 'INVALID_SETUP'; END IF;
 IF setup_state->'firstPrize' IS DISTINCT FROM '0'::jsonb
    OR (setup_state->>'gameType'='points' AND
       (setup_state->'stake' IS DISTINCT FROM '0'::jsonb OR setup_state->'splitPrizes' IS DISTINCT FROM 'false'::jsonb
        OR setup_state->'secondPrize' IS DISTINCT FROM '0'::jsonb OR setup_state->'thirdPrize' IS DISTINCT FROM '0'::jsonb))
 THEN RAISE EXCEPTION 'INVALID_SETUP_FINANCES'; END IF;
 IF jsonb_array_length(old_s->'players')<>jsonb_array_length(setup_state->'players')
    OR (SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(setup_state->'players') x)<>jsonb_array_length(old_s->'players')
 THEN RAISE EXCEPTION 'SETUP_PLAYERS_CHANGED'; END IF;
 FOR p IN SELECT value FROM jsonb_array_elements(old_s->'players') LOOP
   SELECT value INTO n FROM jsonb_array_elements(setup_state->'players') WHERE value->>'id'=p->>'id';
   IF n IS NULL OR (p-ARRAY['paid','playingThisRound','stableford','netScore','noReturn','scoreSubmitted','competition','tripNotPlayingToday'])
      IS DISTINCT FROM (n-ARRAY['paid','playingThisRound','stableford','netScore','noReturn','scoreSubmitted','competition','tripNotPlayingToday'])
     OR n->'paid' IS DISTINCT FROM 'false'::jsonb OR n->'stableford' IS DISTINCT FROM 'null'::jsonb
     OR n->'netScore' IS DISTINCT FROM 'null'::jsonb OR n->'noReturn' IS DISTINCT FROM 'false'::jsonb
     OR n->'scoreSubmitted' IS DISTINCT FROM 'false'::jsonb OR n->'competition' IS DISTINCT FROM 'null'::jsonb
   THEN RAISE EXCEPTION 'SETUP_CHANGED_PLAYER_IDENTITY_OR_SCORE'; END IF;
 END LOOP;
 IF is_trip THEN
   IF ((old_s->'trip')-ARRAY['currentFormat','currentPlayingIds','currentGroups','currentTeams','currentTeamScores'])
       IS DISTINCT FROM ((setup_state->'trip')-ARRAY['currentFormat','currentPlayingIds','currentGroups','currentTeams','currentTeamScores'])
   THEN RAISE EXCEPTION 'SETUP_CHANGED_TRIP_HISTORY_OR_AWARDS'; END IF;
   planned:=old_s#>ARRAY['trip','plan',(((old_s#>>'{trip,currentRound}')::integer)-1)::text];
   IF planned IS NULL THEN RAISE EXCEPTION 'UNPLANNED_TRIP_SETUP_REQUIRES_REVIEW'; END IF;
   IF setup_state->'course' IS DISTINCT FROM planned->'course' OR setup_state->'date' IS DISTINCT FROM planned->'date'
      OR setup_state->'gameType' IS DISTINCT FROM planned->'gameType'
      OR setup_state#>>'{trip,currentFormat}' IS DISTINCT FROM coalesce(planned->>'format','individual')
   THEN RAISE EXCEPTION 'SETUP_DIFFERS_FROM_TRIP_PLAN'; END IF;
   IF setup_state->'stake' IS DISTINCT FROM (CASE WHEN planned->>'gameType'='money' THEN coalesce(planned->'stake','0') ELSE '0'::jsonb END)
     OR setup_state->'splitPrizes' IS DISTINCT FROM to_jsonb(planned->>'gameType'='money' AND planned->'splitPrizes'='true'::jsonb)
     OR setup_state->>'pointsCompetition' IS DISTINCT FROM (CASE WHEN planned->>'format'='betterball' THEN 'stableford' ELSE coalesce(old_s#>>'{trip,competition}',planned->>'competition','stableford') END)
   THEN RAISE EXCEPTION 'SETUP_DIFFERS_FROM_TRIP_PLAN'; END IF;
   playing:=setup_state#>'{trip,currentPlayingIds}';
   IF jsonb_typeof(playing) IS DISTINCT FROM 'array' OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(playing) x
      WHERE NOT (old_s#>'{trip,playerIds}') ? x)
      OR jsonb_array_length(playing)<>(SELECT count(DISTINCT x) FROM jsonb_array_elements_text(playing) x)
      OR setup_state#>'{trip,currentTeamScores}' IS DISTINCT FROM '{}'::jsonb THEN RAISE EXCEPTION 'INVALID_TRIP_PLAYERS'; END IF;
   groups:=setup_state#>'{trip,currentGroups}';teams:=setup_state#>'{trip,currentTeams}';
   IF jsonb_array_length(playing)<2 OR jsonb_typeof(groups) IS DISTINCT FROM 'array'
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(groups) a WHERE jsonb_typeof(a) IS DISTINCT FROM 'array' OR jsonb_array_length(a)<1 OR jsonb_array_length(a)>4)
      OR (SELECT count(*) FROM jsonb_array_elements(groups) a CROSS JOIN LATERAL jsonb_array_elements_text(a) member)<>jsonb_array_length(playing)
      OR (SELECT count(DISTINCT member) FROM jsonb_array_elements(groups) a CROSS JOIN LATERAL jsonb_array_elements_text(a) member)<>jsonb_array_length(playing)
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(groups) a CROSS JOIN LATERAL jsonb_array_elements_text(a) member WHERE NOT playing ? member)
   THEN RAISE EXCEPTION 'INVALID_TRIP_GROUPS'; END IF;
   IF jsonb_typeof(teams) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID_TRIP_TEAMS'; END IF;
   IF planned->>'format'='individual' THEN
     IF jsonb_array_length(teams)<>0 THEN RAISE EXCEPTION 'INVALID_TRIP_TEAMS'; END IF;
   ELSE
     IF jsonb_array_length(playing)%2<>0
       OR EXISTS(SELECT 1 FROM jsonb_array_elements(teams) t WHERE jsonb_typeof(t->'playerIds') IS DISTINCT FROM 'array' OR jsonb_array_length(t->'playerIds')<>2)
       OR (SELECT count(*) FROM jsonb_array_elements(teams) t CROSS JOIN LATERAL jsonb_array_elements_text(t->'playerIds') member)<>jsonb_array_length(playing)
       OR (SELECT count(DISTINCT member) FROM jsonb_array_elements(teams) t CROSS JOIN LATERAL jsonb_array_elements_text(t->'playerIds') member)<>jsonb_array_length(playing)
       OR EXISTS(SELECT 1 FROM jsonb_array_elements(teams) t CROSS JOIN LATERAL jsonb_array_elements_text(t->'playerIds') member WHERE NOT playing ? member)
     THEN RAISE EXCEPTION 'INVALID_TRIP_TEAMS'; END IF;
   END IF;
   FOR p IN SELECT value FROM jsonb_array_elements(setup_state->'players') LOOP
     IF p->'tripNotPlayingToday' IS DISTINCT FROM to_jsonb(NOT playing ? (p->>'id')) THEN RAISE EXCEPTION 'INVALID_TRIP_ATTENDANCE'; END IF;
   END LOOP;
 ELSE
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(setup_state->'players') x WHERE x->'playingThisRound' IS DISTINCT FROM 'false'::jsonb) THEN RAISE EXCEPTION 'INVALID_NORMAL_ATTENDANCE'; END IF;
   IF (coalesce(old_s->'trip','{}')-'active') IS DISTINCT FROM (coalesce(setup_state->'trip','{}')-'active')
      OR setup_state#>'{trip,active}'='true'::jsonb THEN RAISE EXCEPTION 'NEW_TRIP_CREATION_REQUIRES_REVIEW'; END IF;
 END IF;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA iig_closed_entry FROM PUBLIC,anon,authenticated,service_role;
