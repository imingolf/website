-- FICTIONAL FIXTURE ONLY, applied after prototype.sql and legacy-adapter.sql.
-- Preserve source-produced results; capability is mandatory. Not a LIVE migration.
CREATE FUNCTION iig_legacy_fixture.validate_finished_result(old_s jsonb,new_s jsonb)
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
     WHERE player->>'name'=winner AND iig_entry_prototype.eligible(old_s,player)
       AND (CASE WHEN old_s->>'pointsCompetition'='net' THEN player->'netScore' ELSE player->'stableford' END) IS NOT NULL
       AND (CASE WHEN old_s->>'pointsCompetition'='net' THEN player->'netScore' ELSE player->'stableford' END)<>'null'::jsonb))
 THEN RAISE EXCEPTION 'INELIGIBLE_WINNER'; END IF;
 IF EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(record->'payouts','[]')) payout
   WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(old_s->'players') player
    WHERE player->>'name'=payout->>'winnerName' AND iig_entry_prototype.eligible(old_s,player)
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

CREATE FUNCTION iig_legacy_fixture.finish_with_result(p_pin text,expected_round text,expected_revision bigint,
 capability text,finished_state jsonb) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE legacy iig_legacy_fixture.tens_in_groups; meta iig_entry_prototype.groups;
BEGIN
 SELECT * INTO legacy FROM iig_legacy_fixture.tens_in_groups WHERE group_pin=p_pin FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'GROUP_NOT_FOUND'; END IF;
 PERFORM iig_legacy_fixture.authorise_transition(legacy.id,capability,'finish');
 SELECT * INTO meta FROM iig_entry_prototype.groups WHERE id=legacy.id FOR UPDATE;
 IF expected_round IS NULL OR expected_revision IS NULL OR meta.phase<>'open' OR meta.revision<>expected_revision
   OR meta.state->>'roundId' IS DISTINCT FROM expected_round THEN RAISE EXCEPTION 'STALE_ROUND_OR_REVISION'; END IF;
 IF NOT (meta.closed OR iig_entry_prototype.has_score(meta.state)) THEN RAISE EXCEPTION 'NO_SUBMITTED_SCORE'; END IF;
 IF finished_state ? '_entry_revision' THEN
   IF finished_state->>'_entry_revision' IS DISTINCT FROM expected_revision::text THEN RAISE EXCEPTION 'STALE_ROUND_OR_REVISION'; END IF;
   finished_state:=finished_state-'_entry_revision';
 END IF;
 PERFORM iig_legacy_fixture.validate_finished_result(meta.state,finished_state);
 INSERT INTO iig_entry_prototype.archives VALUES(legacy.id,expected_round,meta.state);
 UPDATE iig_entry_prototype.groups SET state=finished_state,phase='finished',closed=true,revision=revision+1 WHERE id=legacy.id;
 UPDATE iig_legacy_fixture.tens_in_groups SET state=finished_state WHERE id=legacy.id;
 RETURN expected_revision+1;
END $$;
REVOKE ALL ON FUNCTION iig_legacy_fixture.validate_finished_result(jsonb,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION iig_legacy_fixture.finish_with_result(text,text,bigint,text,jsonb) FROM PUBLIC;
-- Award ranking, tie choices, full payout/Trip map/champion validation are still
-- incomplete. Do NOT expose this prototype as a production endpoint.
