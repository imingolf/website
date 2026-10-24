-- FICTIONAL SETUP ADAPTER ONLY. Source-compatibility prototype, not installable LIVE SQL.
CREATE FUNCTION iig_legacy_fixture.start_with_setup(p_pin text,expected_round text,expected_revision bigint,
 capability text,setup_state jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE legacy iig_legacy_fixture.tens_in_groups; meta iig_entry_prototype.groups; old_s jsonb;
 is_trip boolean; p jsonb; n jsonb; planned jsonb; item jsonb; next_id text; playing jsonb; groups jsonb; teams jsonb;
BEGIN
 SELECT * INTO legacy FROM iig_legacy_fixture.tens_in_groups WHERE group_pin=p_pin FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'GROUP_NOT_FOUND'; END IF;
 PERFORM iig_legacy_fixture.authorise_transition(legacy.id,capability,'start');
 SELECT * INTO meta FROM iig_entry_prototype.groups WHERE id=legacy.id FOR UPDATE;
 IF expected_round IS NULL OR expected_revision IS NULL OR meta.phase<>'finished' OR meta.revision<>expected_revision
   OR meta.state->>'roundId' IS DISTINCT FROM expected_round THEN RAISE EXCEPTION 'STALE_ROUND_OR_REVISION'; END IF;
 IF setup_state ? '_entry_revision' THEN
   IF setup_state->>'_entry_revision' IS DISTINCT FROM expected_revision::text THEN RAISE EXCEPTION 'STALE_ROUND_OR_REVISION'; END IF;
   setup_state:=setup_state-'_entry_revision';
 END IF;
 old_s:=meta.state;is_trip:=coalesce(old_s#>'{trip,active}'='true'::jsonb,false);
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
 -- Server issues authoritative identity; client-generated round ID never authorises a transition.
 next_id:=gen_random_uuid()::text;setup_state:=jsonb_set(setup_state,'{roundId}',to_jsonb(next_id));
 UPDATE iig_entry_prototype.groups SET state=setup_state,phase='open',closed=false,revision=revision+1 WHERE id=legacy.id;
 UPDATE iig_legacy_fixture.tens_in_groups SET state=setup_state WHERE id=legacy.id;
 RETURN jsonb_build_object('roundId',next_id,'revision',expected_revision+1);
END $$;
REVOKE ALL ON FUNCTION iig_legacy_fixture.start_with_setup(text,text,bigint,text,jsonb) FROM PUBLIC;
-- Full team partition and financial-plan validation remain release gates.
