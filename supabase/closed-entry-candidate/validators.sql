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
   WHEN s->>'gameType'='money' OR s#>'{trip,active}'='true'::jsonb THEN true
   ELSE coalesce(p->'playingThisRound'='true'::jsonb,false) END
$$;

CREATE FUNCTION iig_closed_entry.score_signature(p jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_array(coalesce(p->'stableford','null'),coalesce(p->'netScore','null'),
  coalesce(nullif(p->'noReturn','null'),'false'),coalesce(nullif(p->'scoreSubmitted','null'),'false')) $$;

CREATE FUNCTION iig_closed_entry.validate_snapshot(old_s jsonb,new_s jsonb,latched boolean)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE p jsonb; n jsonb; locked boolean; first_score boolean; scores text[]; key text; v jsonb; team jsonb; old_v jsonb;
BEGIN
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
 locked:=latched OR iig_closed_entry.has_score(old_s);
 first_score:=NOT locked AND iig_closed_entry.has_score(new_s);
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
   IF (p-scores) IS DISTINCT FROM (n-scores) AND iig_closed_entry.has_score(old_s) THEN
     RAISE EXCEPTION 'ENTRIES_CLOSED'; END IF;
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
END $$;

-- Server-built member changes preserve every unrelated field exactly. Do not
-- revalidate old owner/history/profile metadata as if the member supplied it.
-- The private permit fixes the actor and operation; public APIs cannot select
-- these operations or provide a replacement state.
CREATE FUNCTION iig_closed_entry.validate_member_update(old_s jsonb,new_s jsonb,operation text,actor text,latched boolean,frozen jsonb)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE p jsonb;n jsonb;fields text[];matched integer:=0;fmt text;field text;value jsonb;locked boolean;
BEGIN
 IF actor IS NULL OR actor='' OR operation IS NULL OR operation NOT IN ('member_attendance','member_score')
 THEN RAISE EXCEPTION 'INVALID_MEMBER_OPERATION';END IF;
 IF jsonb_typeof(old_s) IS DISTINCT FROM 'object' OR jsonb_typeof(new_s) IS DISTINCT FROM 'object'
  OR jsonb_typeof(old_s->'players') IS DISTINCT FROM 'array' OR jsonb_typeof(new_s->'players') IS DISTINCT FROM 'array'
  OR (old_s-'players') IS DISTINCT FROM (new_s-'players')
  OR jsonb_array_length(old_s->'players')<>jsonb_array_length(new_s->'players')
 THEN RAISE EXCEPTION 'INVALID_MEMBER_CHANGE';END IF;
 IF old_s->'roundOpen' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'ROUND_NOT_OPEN';END IF;
 IF old_s->>'gameType' IS NULL OR old_s->>'gameType' NOT IN ('points','money') THEN RAISE EXCEPTION 'Unknown competition type';END IF;
 locked:=coalesce(latched,false) OR iig_closed_entry.has_score(old_s);
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
  ELSE
   IF p->'scoreSubmitted'='true'::jsonb OR p->'noReturn'='true'::jsonb OR p->>'stableford' IS NOT NULL OR p->>'netScore' IS NOT NULL
   THEN RAISE EXCEPTION 'A result is already recorded. Ask your organiser about corrections.';END IF;
   IF old_s->>'gameType'='money' AND (old_s->>'stake')::numeric>0 AND p->'paid' IS DISTINCT FROM 'true'::jsonb
   THEN RAISE EXCEPTION 'Pay before submitting a score';END IF;
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
END $$;

-- Payment is an honest declaration/correction, not organiser approval. It cannot
-- grant entry after closure; the frozen entrant IDs never change here.
CREATE FUNCTION iig_closed_entry.validate_payment(old_s jsonb,new_s jsonb,locked boolean,frozen jsonb,actor text)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE p jsonb;n jsonb; fields text[]:=ARRAY['paid','paymentMarkedAt','paymentMarkMethod'];
BEGIN
 IF old_s->>'gameType' IS DISTINCT FROM 'money'
 OR (old_s-'players'-'lastActivityAt') IS DISTINCT FROM (new_s-'players'-'lastActivityAt')
 OR jsonb_typeof(new_s->'players') IS DISTINCT FROM 'array'
 OR jsonb_array_length(old_s->'players')<>jsonb_array_length(new_s->'players')
 THEN RAISE EXCEPTION 'INVALID_PAYMENT_CHANGE';END IF;
 FOR p,n IN SELECT a.value,b.value FROM jsonb_array_elements(old_s->'players') WITH ORDINALITY a
  JOIN jsonb_array_elements(new_s->'players') WITH ORDINALITY b USING(ordinality) LOOP
  IF (p-fields) IS DISTINCT FROM (n-fields) THEN RAISE EXCEPTION 'PAYMENT_CHANGED_PROTECTED_FIELDS';END IF;
  IF p IS DISTINCT FROM n THEN
   IF actor IS NOT NULL AND p->>'id' IS DISTINCT FROM actor THEN RAISE EXCEPTION 'WRONG_PLAYER';END IF;
   IF jsonb_typeof(n->'paid') IS DISTINCT FROM 'boolean'
    OR NOT ((jsonb_typeof(n->'paymentMarkedAt') IS NOT DISTINCT FROM 'string'
      AND n->>'paymentMarkMethod' IS NOT DISTINCT FROM (CASE WHEN actor IS NULL THEN 'admin-confirmed' ELSE 'player-confirmed' END))
     OR (actor IS NULL AND n->'paid' IS NOT DISTINCT FROM 'false'::jsonb
      AND n->'paymentMarkedAt' IS NOT DISTINCT FROM 'null'::jsonb
      AND n->'paymentMarkMethod' IS NOT DISTINCT FROM 'null'::jsonb))
   THEN RAISE EXCEPTION 'INVALID_PAYMENT_METADATA';END IF;
   IF actor IS NOT NULL AND n->'paid' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'PAYMENT_DECLARATION_REQUIRED';END IF;
   IF locked AND (actor IS NOT NULL OR (n->'paid'='true'::jsonb AND p->'paid' IS DISTINCT FROM 'true'::jsonb AND NOT coalesce(frozen,'[]') ? (p->>'id')))
   THEN RAISE EXCEPTION 'ENTRIES_CLOSED';END IF;
  END IF;
 END LOOP;
END $$;

-- Narrow non-financial group settings; never score, entry or payout changes.
CREATE FUNCTION iig_closed_entry.validate_settings(old_s jsonb,new_s jsonb)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF jsonb_typeof(new_s) IS DISTINCT FROM 'object'
 OR (old_s-ARRAY['groupName','adminPin','adminSetupToken','paymentLink','paymentProvider','lastActivityAt']) IS DISTINCT FROM (new_s-ARRAY['groupName','adminPin','adminSetupToken','paymentLink','paymentProvider','lastActivityAt'])
 THEN RAISE EXCEPTION 'SETTINGS_CHANGED_PROTECTED_FIELDS';END IF;
 IF old_s->'groupName' IS DISTINCT FROM new_s->'groupName' AND
  (jsonb_typeof(new_s->'groupName') IS DISTINCT FROM 'string' OR length(btrim(new_s->>'groupName')) NOT BETWEEN 1 AND 80)
 THEN RAISE EXCEPTION 'INVALID_GROUP_NAME';END IF;
 IF old_s->'adminPin' IS DISTINCT FROM new_s->'adminPin' AND
  (jsonb_typeof(new_s->'adminPin') IS DISTINCT FROM 'string' OR new_s->>'adminPin' !~ '^[0-9]{4}$')
 THEN RAISE EXCEPTION 'INVALID_ADMIN_PIN';END IF;
 IF old_s->'adminSetupToken' IS DISTINCT FROM new_s->'adminSetupToken' AND
  (new_s->'adminSetupToken' IS DISTINCT FROM '""'::jsonb OR new_s->>'adminPin' !~ '^[0-9]{4}$' OR new_s->>'adminPin' IS NULL)
 THEN RAISE EXCEPTION 'INVALID_ADMIN_SETUP_COMPLETION';END IF;

 IF old_s->'paymentLink' IS DISTINCT FROM new_s->'paymentLink' OR old_s->'paymentProvider' IS DISTINCT FROM new_s->'paymentProvider' THEN
  IF NOT (new_s->>'paymentLink'='' AND new_s->>'paymentProvider'='') AND
   NOT iig_closed_entry.safe_payment_link(new_s->>'paymentLink',CASE lower(new_s->>'paymentProvider') WHEN 'paypal' THEN 'PayPal' WHEN 'revolut' THEN 'Revolut' WHEN 'monzo' THEN 'Monzo' WHEN 'starling' THEN 'Starling' WHEN 'wise' THEN 'Wise' ELSE new_s->>'paymentProvider' END)
  THEN RAISE EXCEPTION 'INVALID_PAYMENT_LINK';END IF;
 END IF;
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
        OR coalesce(nullif(r->'noReturn','null'),'false') IS DISTINCT FROM coalesce(nullif(p->'noReturn','null'),'false')
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

CREATE FUNCTION iig_closed_entry.validate_trip_creation(old_s jsonb,new_s jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE t jsonb:=new_s->'trip';r jsonb;backup jsonb;players jsonb;
BEGIN
 IF t->'active' IS DISTINCT FROM 'true'::jsonb OR t->'completed' IS DISTINCT FROM 'false'::jsonb
 OR t->'currentRound' IS DISTINCT FROM '1'::jsonb OR jsonb_typeof(t->'totalRounds') IS DISTINCT FROM 'number'
 OR t->>'totalRounds' !~ '^[0-9]+$' OR (t->>'totalRounds')::integer NOT BETWEEN 1 AND 12
 OR jsonb_typeof(t->'name') IS DISTINCT FROM 'string' OR length(btrim(t->>'name')) NOT BETWEEN 1 AND 100
 OR t->>'competition' IS NULL OR t->>'competition' NOT IN ('stableford','net')
 OR jsonb_typeof(t->'tripPointsEnabled') IS DISTINCT FROM 'boolean' OR t->'tripPointsValue' IS DISTINCT FROM '10'::jsonb
 OR t->'rounds' IS DISTINCT FROM '[]'::jsonb OR t->'standings' IS DISTINCT FROM '{}'::jsonb OR t->'teamStandings' IS DISTINCT FROM '{}'::jsonb
 OR t->'champion' IS DISTINCT FROM 'null'::jsonb OR t->'teamChampion' IS DISTINCT FROM 'null'::jsonb
 OR t->'pastTrips' IS DISTINCT FROM coalesce(old_s#>'{trip,pastTrips}','[]')
 OR (t-ARRAY['active','name','totalRounds','currentRound','competition','tripPointsEnabled','tripPointsValue','playerIds','plan','currentFormat','currentPlayingIds','currentGroups','currentTeams','currentTeamScores','normalRoundBackup','rounds','standings','teamStandings','champion','teamChampion','completed','pastTrips'])<>'{}'::jsonb
 OR jsonb_typeof(t->'playerIds') IS DISTINCT FROM 'array' OR jsonb_array_length(t->'playerIds')<2
 OR jsonb_array_length(t->'playerIds')<>(SELECT count(DISTINCT x) FROM jsonb_array_elements_text(t->'playerIds') x)
 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(t->'playerIds') x WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(old_s->'players') p WHERE p->>'id'=x))
 OR jsonb_typeof(t->'plan') IS DISTINCT FROM 'array' OR jsonb_array_length(t->'plan')<>(t->>'totalRounds')::integer
 THEN RAISE EXCEPTION 'INVALID_NEW_TRIP';END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(t->'plan') LOOP
  IF r->>'format' IS NULL OR r->>'format' NOT IN ('individual','betterball','pairsaggregate')
   OR r->>'gameType' IS NULL OR r->>'gameType' NOT IN ('money','points')
   OR coalesce(btrim(r->>'course'),'')='' OR r->>'date' IS NULL OR r->>'date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
   OR jsonb_typeof(r->'stake') IS DISTINCT FROM 'number' OR (r->>'stake')::numeric<0
  THEN RAISE EXCEPTION 'INVALID_TRIP_PLAN';END IF;
 END LOOP;
 SELECT jsonb_agg(jsonb_build_object('id',x->'id','name',x->'name','handicap',x->'handicap','paid',x->'paid',
 'competition',coalesce(x->'competition','null'),'stableford',x->'stableford','netScore',x->'netScore',
 'noReturn',coalesce(x->'noReturn','false'),'scoreSubmitted',coalesce(x->'scoreSubmitted','false'),
 'wins',coalesce(x->'wins','0'),'leaguePoints',coalesce(x->'leaguePoints','0'),'netWinnings',coalesce(x->'netWinnings','0')) ORDER BY ord)
 INTO players FROM jsonb_array_elements(old_s->'players') WITH ORDINALITY a(x,ord);
 backup:=jsonb_build_object('course',old_s->'course','date',old_s->'date','stake',old_s->'stake','gameType',old_s->'gameType',
 'splitPrizes',coalesce(old_s->'splitPrizes','false'),'firstPrize',coalesce(old_s->'firstPrize','0'),
 'secondPrize',coalesce(old_s->'secondPrize','0'),'thirdPrize',coalesce(old_s->'thirdPrize','0'),
 'pointsCompetition',old_s->'pointsCompetition','pointsValue',old_s->'pointsValue','roundOpen',false,'players',players);
 IF t->'normalRoundBackup' IS DISTINCT FROM backup THEN RAISE EXCEPTION 'INVALID_NORMAL_ROUND_BACKUP';END IF;
END $$;

CREATE FUNCTION iig_closed_entry.validate_setup(old_s jsonb,setup_state jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE is_trip boolean; p jsonb; n jsonb; planned jsonb; item jsonb; playing jsonb; groups jsonb; teams jsonb;
BEGIN
 IF coalesce(old_s#>'{trip,active}','false')<>'true'::jsonb AND setup_state#>'{trip,active}'='true'::jsonb THEN
  PERFORM iig_closed_entry.validate_trip_creation(old_s,setup_state);
  PERFORM iig_closed_entry.validate_setup(jsonb_set(old_s,'{trip}',setup_state->'trip'),setup_state);
  RETURN;
 END IF;
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
       ((setup_state->'stake' IS DISTINCT FROM '0'::jsonb AND NOT (is_trip AND old_s#>ARRAY['trip','plan',(((old_s#>>'{trip,currentRound}')::integer)-1)::text] IS NULL AND setup_state->'stake' IS NOT DISTINCT FROM old_s->'stake')) OR setup_state->'splitPrizes' IS DISTINCT FROM 'false'::jsonb
        OR setup_state->'secondPrize' IS DISTINCT FROM '0'::jsonb OR setup_state->'thirdPrize' IS DISTINCT FROM '0'::jsonb))
 THEN RAISE EXCEPTION 'INVALID_SETUP_FINANCES'; END IF;
 IF jsonb_typeof(setup_state->'splitPrizes') IS DISTINCT FROM 'boolean'
  OR jsonb_typeof(setup_state->'secondPrize') IS DISTINCT FROM 'number' OR setup_state->>'secondPrize' !~ '^[0-9]+$'
  OR jsonb_typeof(setup_state->'thirdPrize') IS DISTINCT FROM 'number' OR setup_state->>'thirdPrize' !~ '^[0-9]+$'
  OR (setup_state->'splitPrizes'='false'::jsonb AND (setup_state->'secondPrize'<>'0'::jsonb OR setup_state->'thirdPrize'<>'0'::jsonb))
 THEN RAISE EXCEPTION 'INVALID_SETUP_FINANCES';END IF;
 IF NOT (is_trip AND old_s#>ARRAY['trip','plan',(((old_s#>>'{trip,currentRound}')::integer)-1)::text] IS NULL)
  AND setup_state->'pointsValue' IS DISTINCT FROM '10'::jsonb THEN RAISE EXCEPTION 'INVALID_SETUP_POINTS';END IF;

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
   planned:=old_s#>ARRAY['trip','plan',(((old_s#>>'{trip,currentRound}')::integer)-1)::text];
   IF planned IS NOT NULL AND ((old_s->'trip')-ARRAY['currentFormat','currentPlayingIds','currentGroups','currentTeams','currentTeamScores'])
       IS DISTINCT FROM ((setup_state->'trip')-ARRAY['currentFormat','currentPlayingIds','currentGroups','currentTeams','currentTeamScores'])
   THEN RAISE EXCEPTION 'SETUP_CHANGED_TRIP_HISTORY_OR_AWARDS'; END IF;
   planned:=old_s#>ARRAY['trip','plan',(((old_s#>>'{trip,currentRound}')::integer)-1)::text];
   IF planned IS NULL THEN
    -- Actual older nextTripRound changes only competition/points and normal round
    -- setup, retaining its existing Trip history/attendance. It is individual-only.
    IF coalesce(old_s#>>'{trip,currentFormat}','individual')<>'individual'
     OR ((old_s->'trip')-ARRAY['competition','tripPointsValue','completed']) IS DISTINCT FROM ((setup_state->'trip')-ARRAY['competition','tripPointsValue','completed'])
     OR setup_state#>'{trip,completed}' IS DISTINCT FROM 'false'::jsonb
     OR setup_state#>>'{trip,competition}' NOT IN ('stableford','net') OR setup_state#>>'{trip,competition}' IS NULL
     OR jsonb_typeof(setup_state#>'{trip,tripPointsValue}') IS DISTINCT FROM 'number'
     OR (setup_state#>>'{trip,tripPointsValue}')::numeric<=0
     OR setup_state->'splitPrizes' IS DISTINCT FROM 'false'::jsonb OR setup_state->'secondPrize' IS DISTINCT FROM '0'::jsonb OR setup_state->'thirdPrize' IS DISTINCT FROM '0'::jsonb
    THEN RAISE EXCEPTION 'INVALID_LEGACY_TRIP_SETUP';END IF;
    IF setup_state->>'gameType'='points' AND
     (setup_state->>'pointsCompetition' IS DISTINCT FROM setup_state#>>'{trip,competition}' OR setup_state->'pointsValue' IS DISTINCT FROM setup_state#>'{trip,tripPointsValue}')
    THEN RAISE EXCEPTION 'INVALID_LEGACY_TRIP_POINTS';END IF;
    RETURN;
   END IF;
   IF setup_state->'course' IS DISTINCT FROM planned->'course' OR setup_state->'date' IS DISTINCT FROM planned->'date'
      OR setup_state->'gameType' IS DISTINCT FROM planned->'gameType'
      OR setup_state#>>'{trip,currentFormat}' IS DISTINCT FROM coalesce(planned->>'format','individual')
   THEN RAISE EXCEPTION 'SETUP_DIFFERS_FROM_TRIP_PLAN'; END IF;
   IF setup_state->'stake' IS DISTINCT FROM (CASE WHEN planned->>'gameType'='money' THEN coalesce(planned->'stake','0') ELSE '0'::jsonb END)
     OR setup_state->'splitPrizes' IS DISTINCT FROM to_jsonb(planned->>'gameType'='money' AND planned->'splitPrizes'='true'::jsonb)
     OR setup_state->>'pointsCompetition' IS DISTINCT FROM (CASE WHEN planned->>'format'='betterball' THEN 'stableford' ELSE coalesce(old_s#>>'{trip,competition}',planned->>'competition','stableford') END)
   THEN RAISE EXCEPTION 'SETUP_DIFFERS_FROM_TRIP_PLAN'; END IF;
   IF setup_state->'secondPrize' IS DISTINCT FROM (CASE WHEN setup_state->'splitPrizes'='true'::jsonb THEN coalesce(planned->'secondPrize','0') ELSE '0'::jsonb END)
    OR setup_state->'thirdPrize' IS DISTINCT FROM (CASE WHEN setup_state->'splitPrizes'='true'::jsonb THEN coalesce(planned->'thirdPrize','0') ELSE '0'::jsonb END)
   THEN RAISE EXCEPTION 'SETUP_DIFFERS_FROM_TRIP_PLAN';END IF;
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

-- OFFLINE candidate extensions. No actor identity is accepted from JSON/UI flags.
CREATE FUNCTION iig_closed_entry.validate_players(old_s jsonb,new_s jsonb,locked boolean,actor text,frozen_ids jsonb DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE p jsonb;n jsonb;changed boolean; profile text[]:=ARRAY['name','handicap'];
BEGIN
 IF jsonb_typeof(new_s->'players') IS DISTINCT FROM 'array'
 OR (old_s-ARRAY['players','lastActivityAt']) IS DISTINCT FROM (new_s-ARRAY['players','lastActivityAt'])
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(new_s->'players') x WHERE jsonb_typeof(x)<>'object' OR jsonb_typeof(x->'id') IS DISTINCT FROM 'string' OR coalesce(x->>'id','')='')
 OR jsonb_array_length(new_s->'players')<>(SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(new_s->'players') x)
 THEN RAISE EXCEPTION 'INVALID_MEMBERSHIP_CHANGE';END IF;
 IF actor IS NOT NULL AND
 (SELECT jsonb_agg(x->'id' ORDER BY ord) FROM jsonb_array_elements(old_s->'players') WITH ORDINALITY a(x,ord))
 IS DISTINCT FROM (SELECT jsonb_agg(x->'id' ORDER BY ord) FROM jsonb_array_elements(new_s->'players') WITH ORDINALITY a(x,ord))
 THEN RAISE EXCEPTION 'PROFILE_CHANGED_PLAYER_ORDER';END IF;
 FOR p IN SELECT value FROM jsonb_array_elements(old_s->'players') LOOP
  SELECT value INTO n FROM jsonb_array_elements(new_s->'players') x WHERE x->>'id'=p->>'id';
  IF n IS NULL THEN
   IF actor IS NOT NULL OR (locked AND ((CASE WHEN frozen_ids IS NOT NULL THEN frozen_ids ? (p->>'id') ELSE iig_closed_entry.eligible(old_s,p) END) OR iig_closed_entry.has_score(jsonb_build_object('players',jsonb_build_array(p)))))
   OR (coalesce(old_s#>'{trip,playerIds}','[]') ? (p->>'id') AND old_s#>'{trip,active}'='true'::jsonb)
   THEN RAISE EXCEPTION 'PROTECTED_PLAYER_REMOVAL';END IF;
   CONTINUE;
  END IF;
  IF (p-profile) IS DISTINCT FROM (n-profile) THEN RAISE EXCEPTION 'PROFILE_CHANGED_COMPETITION_FIELDS';END IF;
  changed:=p IS DISTINCT FROM n;
  IF changed AND actor IS NOT NULL AND p->>'id'<>actor THEN RAISE EXCEPTION 'WRONG_PLAYER';END IF;
  -- Final totals are entered directly; profile maintenance changes no calculated
  -- score/entry/payment field. Preserve identity, history and unique current names.
  IF changed AND lower(btrim(p->>'name')) IS DISTINCT FROM lower(btrim(n->>'name')) AND EXISTS(
   SELECT 1 FROM jsonb_array_elements(new_s->'players') other WHERE other->>'id'<>p->>'id' AND lower(btrim(other->>'name'))=lower(btrim(n->>'name')))
  THEN RAISE EXCEPTION 'DUPLICATE_PLAYER_NAME';END IF;
  IF changed AND (btrim(n->>'name') IN ('__proto__','constructor','prototype') OR jsonb_typeof(n->'name') IS DISTINCT FROM 'string' OR length(btrim(n->>'name')) NOT BETWEEN 1 AND 100
   OR jsonb_typeof(n->'handicap') IS DISTINCT FROM 'number' OR n->>'handicap' !~ '^-?[0-9]{1,2}(\.[0-9])?$'
   OR (n->>'handicap')::numeric NOT BETWEEN -10 AND 60)
  THEN RAISE EXCEPTION 'INVALID_PROFILE';END IF;
 END LOOP;
 FOR n IN SELECT value FROM jsonb_array_elements(new_s->'players') LOOP
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(old_s->'players') x WHERE x->>'id'=n->>'id') THEN CONTINUE;END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(new_s->'players') other WHERE other->>'id'<>n->>'id' AND lower(btrim(other->>'name'))=lower(btrim(n->>'name'))) THEN RAISE EXCEPTION 'DUPLICATE_PLAYER_NAME';END IF;
  IF actor IS NOT NULL OR n->>'id' !~ '^[A-Za-z0-9_-]{1,100}$' OR n->>'id' IN ('__proto__','constructor','prototype') OR btrim(n->>'name') IN ('__proto__','constructor','prototype') OR jsonb_typeof(n->'name') IS DISTINCT FROM 'string' OR length(btrim(n->>'name')) NOT BETWEEN 1 AND 100
   OR jsonb_typeof(n->'handicap') IS DISTINCT FROM 'number' OR n->>'handicap' !~ '^-?[0-9]{1,2}(\.[0-9])?$'
   OR (n->>'handicap')::numeric NOT BETWEEN -10 AND 60
   OR (n-ARRAY['id','name','handicap','paid','playingThisRound','competition','stableford','netScore','noReturn','scoreSubmitted','wins','leaguePoints','netWinnings'])<>'{}'::jsonb
   OR coalesce(n->'paid','false')<>'false'::jsonb OR coalesce(n->'playingThisRound','false')<>'false'::jsonb
   OR coalesce(n->'competition','null')<>'null'::jsonb OR coalesce(n->'stableford','null')<>'null'::jsonb
   OR coalesce(n->'netScore','null')<>'null'::jsonb OR coalesce(n->'noReturn','false')<>'false'::jsonb
   OR coalesce(n->'scoreSubmitted','false')<>'false'::jsonb
   OR coalesce(n->'wins','0')<>'0'::jsonb OR coalesce(n->'leaguePoints','0')<>'0'::jsonb OR coalesce(n->'netWinnings','0')<>'0'::jsonb
  THEN RAISE EXCEPTION 'INVALID_NEW_MEMBER';END IF;
 END LOOP;
END $$;

CREATE FUNCTION iig_closed_entry.safe_payment_link(link text,provider text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT coalesce(CASE provider
 WHEN 'Monzo' THEN link ~ '^https://(www\.)?monzo\.me/[A-Za-z0-9_/?=&%+.#~-]+$'
 WHEN 'Revolut' THEN link ~ '^https://(www\.)?revolut\.me/[A-Za-z0-9_/?=&%+.#~-]+$'
 WHEN 'PayPal' THEN link ~ '^https://(www\.)?paypal\.me/[A-Za-z0-9_/?=&%+.#~-]+$'
 WHEN 'Starling' THEN link ~ '^https://([a-z0-9-]+\.)?starlingbank\.com/[A-Za-z0-9_/?=&%+.#~-]+$'
 WHEN 'Wise' THEN link ~ '^https://(www\.)?wise\.com/[A-Za-z0-9_/?=&%+.#~-]+$'
 ELSE false END,false)
$$;

-- Result economics and recipients are immutable. Claim authorises an identified
-- player; settlement authorises the group's organiser, never client isAdmin.
-- Deterministic compatibility for historical results, with no data backfill and
-- no current-name matching. Ambiguous rounding/identity fails closed.
-- Reproduce Number(value.toFixed(2)) for ordinary nonnegative money amounts.
-- Integer quotient/remainder of the exact IEEE-754 bits avoids decimal half-cent
-- guesses (e.g. JavaScript 1.005 -> 1.00, but 0.125 -> 0.13).
CREATE FUNCTION iig_closed_entry.js_money_round(value double precision) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE bytes bytea;exponent integer;mantissa numeric;fraction numeric;denominator numeric;numerator numeric;q numeric;i integer;
BEGIN
 IF value IS NULL OR value<0 OR value>=1000000000000 OR value='NaN'::double precision THEN RAISE EXCEPTION 'LEGACY_MONEY_RANGE_REVIEW_REQUIRED';END IF;
 bytes:=float8send(value);exponent:=((get_byte(bytes,0)&127)<<4)|(get_byte(bytes,1)>>4);
 fraction:=get_byte(bytes,1)&15;
 FOR i IN 2..7 LOOP fraction:=fraction*256+get_byte(bytes,i);END LOOP;
 IF exponent=0 THEN mantissa:=fraction;exponent:=-1074;
 ELSE mantissa:=4503599627370496+fraction;exponent:=exponent-1075;END IF;
 numerator:=mantissa*100;denominator:=1;
 IF exponent>=0 THEN numerator:=numerator*power(2::numeric,exponent);ELSE denominator:=power(2::numeric,-exponent);END IF;
 q:=div(numerator,denominator);IF mod(numerator,denominator)*2>=denominator THEN q:=q+1;END IF;
 RETURN q/100;
END $$;

CREATE FUNCTION iig_closed_entry.legacy_payouts(record jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE result jsonb:='[]';comp text;names jsonb;name text;place jsonb;person jsonb;recipient jsonb;pot double precision;amount double precision;position integer;idx integer;
BEGIN
 IF record->>'gameType' IS DISTINCT FROM 'money' THEN RETURN result;END IF;
 IF record->'splitPrizes'='true'::jsonb AND jsonb_array_length(coalesce(record->'prizePlaces','[]'))>0 THEN
  comp:=CASE WHEN record->>'pointsCompetition'='net' THEN 'net' ELSE 'stableford' END;
  pot:=coalesce((record->>(comp||'Pot'))::double precision,0);position:=0;
  FOR place IN SELECT value FROM jsonb_array_elements(record->'prizePlaces') LIMIT 3 LOOP
   position:=position+1;name:=place->>'name';
   amount:=CASE position WHEN 1 THEN greatest(0,pot-coalesce((record->>'secondPrize')::double precision,0)-coalesce((record->>'thirdPrize')::double precision,0)) WHEN 2 THEN coalesce((record->>'secondPrize')::double precision,0) ELSE coalesce((record->>'thirdPrize')::double precision,0) END;
   IF coalesce(name,'')='' OR amount<=0 THEN CONTINUE;END IF;
   SELECT value INTO person FROM jsonb_array_elements(coalesce(record->'players','[]')) x WHERE x->>'name'=name;
   IF (SELECT count(*) FROM jsonb_array_elements(coalesce(record->'players','[]')) x WHERE x->>'name'=name)<>1 THEN person:=NULL;END IF;
   recipient:=coalesce(nullif(place->'playerId','null'),person->'id','null');
   result:=result||jsonb_build_array(jsonb_build_object('id',comp||'-place-'||position||'-'||regexp_replace(lower(name),'[^a-z0-9]+','-','g'),
    'competition',comp,'position',position,'winnerName',name,'winnerPlayerId',recipient,'amount',iig_closed_entry.js_money_round(amount),'status','awaiting_details','paymentProvider','','paymentLink','','claimedAt',NULL,'paidAt',NULL));
  END LOOP;
 ELSE
  FOREACH comp IN ARRAY ARRAY['stableford','net'] LOOP
   SELECT coalesce(jsonb_agg(x),'[]') INTO names FROM jsonb_array_elements(coalesce(record->(comp||'WinnerNames'),'[]')) x WHERE x<>'null'::jsonb AND x<>'""'::jsonb;
   pot:=coalesce((record->>(comp||'Pot'))::double precision,0);IF jsonb_array_length(names)=0 OR pot<=0 THEN CONTINUE;END IF;
   amount:=pot/jsonb_array_length(names);
   idx:=0;
   FOR name IN SELECT value FROM jsonb_array_elements_text(names) LOOP
    SELECT value INTO person FROM jsonb_array_elements(coalesce(record->'players','[]')) x WHERE x->>'name'=name;
    IF (SELECT count(*) FROM jsonb_array_elements(coalesce(record->'players','[]')) x WHERE x->>'name'=name)<>1 THEN person:=NULL;END IF;
    result:=result||jsonb_build_array(jsonb_build_object('id',comp||'-'||idx||'-'||regexp_replace(lower(name),'[^a-z0-9]+','-','g'),
     'competition',comp,'winnerName',name,'winnerPlayerId',coalesce(person->'id','null'),'amount',iig_closed_entry.js_money_round(amount),'status','awaiting_details','paymentProvider','','paymentLink','','claimedAt',NULL,'paidAt',NULL));idx:=idx+1;
   END LOOP;
  END LOOP;
 END IF;
 RETURN result;
END $$;
CREATE FUNCTION iig_closed_entry.historical_payout_actor(record jsonb,payout jsonb) RETURNS text
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE person jsonb;id text;
BEGIN
 id:=payout->>'winnerPlayerId';IF coalesce(id,'')<>'' THEN RETURN id;END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(coalesce(record->'players','[]')) x WHERE x->>'name'=payout->>'winnerName')<>1 THEN RETURN NULL;END IF;
 SELECT value INTO person FROM jsonb_array_elements(record->'players') x WHERE x->>'name'=payout->>'winnerName';
 id:=person->>'id';
 IF coalesce(id,'')='' OR jsonb_typeof(person->'id')<>'string' OR
  (SELECT count(*) FROM jsonb_array_elements(record->'players') x WHERE x->>'id'=id)<>1 THEN RETURN NULL;END IF;
 RETURN id;
END $$;

CREATE FUNCTION iig_closed_entry.validate_payout(old_s jsonb,new_s jsonb,actor text)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE i integer;j integer;o jsonb;n jsonb;p jsonb;q jsonb;player jsonb;changes integer:=0;allowed text[];
BEGIN
 IF (old_s-ARRAY['history','lastActivityAt']) IS DISTINCT FROM (new_s-ARRAY['history','lastActivityAt'])
 OR jsonb_typeof(new_s->'history') IS DISTINCT FROM 'array'
 OR jsonb_array_length(old_s->'history')<>jsonb_array_length(new_s->'history')
 THEN RAISE EXCEPTION 'PAYOUT_CHANGED_COMPETITION';END IF;
 SELECT value INTO player FROM jsonb_array_elements(old_s->'players') x WHERE x->>'id'=actor;
 allowed:=CASE WHEN actor IS NULL THEN ARRAY['status','paidAt'] ELSE ARRAY['paymentLink','paymentProvider','status','claimedAt'] END;
 FOR i IN SELECT generate_series(0,jsonb_array_length(old_s->'history')-1) LOOP
  o:=old_s->'history'->i;n:=new_s->'history'->i;
  IF o IS NOT DISTINCT FROM n THEN CONTINUE;END IF;
  IF o->'payouts' IS NULL OR o->'payouts'='null'::jsonb THEN o:=jsonb_set(o,'{payouts}',iig_closed_entry.legacy_payouts(o));END IF;
  IF (o-'payouts') IS DISTINCT FROM (n-'payouts') OR jsonb_typeof(o->'payouts') IS DISTINCT FROM 'array'
   OR jsonb_typeof(n->'payouts') IS DISTINCT FROM 'array' OR jsonb_array_length(o->'payouts')<>jsonb_array_length(n->'payouts')
  THEN RAISE EXCEPTION 'PAYOUT_CHANGED_RESULT';END IF;
  FOR j IN SELECT generate_series(0,jsonb_array_length(o->'payouts')-1) LOOP
   p:=o->'payouts'->j;q:=n->'payouts'->j;
   IF p IS NOT DISTINCT FROM q THEN CONTINUE;END IF;changes:=changes+1;
   IF (p-allowed) IS DISTINCT FROM (q-allowed) OR coalesce(p->>'id','')='' OR p->>'status'='paid'
   THEN RAISE EXCEPTION 'IMMUTABLE_PAYOUT';END IF;
   IF actor IS NULL THEN
    IF p->>'status' NOT IN ('ready','bank_details_needed','awaiting_details') OR p->>'status' IS NULL
     OR q->>'status' IS DISTINCT FROM 'paid' OR jsonb_typeof(q->'paidAt') IS DISTINCT FROM 'string'
    THEN RAISE EXCEPTION 'INVALID_SETTLEMENT';END IF;
   ELSE
    -- Legacy name-only payouts are intentionally not guessed across identities.
    IF player IS NULL OR iig_closed_entry.historical_payout_actor(o,p) IS DISTINCT FROM actor
     OR p->>'status' NOT IN ('awaiting_details','ready','bank_details_needed') OR p->>'status' IS NULL
     OR jsonb_typeof(q->'claimedAt') IS DISTINCT FROM 'string'
    THEN RAISE EXCEPTION 'PAYOUT_IDENTITY_REQUIRED';END IF;
    IF q->>'status'='bank_details_needed' THEN
     IF q->>'paymentLink' IS DISTINCT FROM '' OR q->>'paymentProvider' IS DISTINCT FROM 'Private bank transfer'
     THEN RAISE EXCEPTION 'INVALID_BANK_CLAIM';END IF;
    ELSIF q->>'status'='ready' THEN
     IF NOT iig_closed_entry.safe_payment_link(q->>'paymentLink',q->>'paymentProvider') THEN RAISE EXCEPTION 'INVALID_PAYMENT_LINK';END IF;
    ELSE RAISE EXCEPTION 'INVALID_CLAIM';END IF;
   END IF;
  END LOOP;
 END LOOP;
 IF changes<>1 THEN RAISE EXCEPTION 'ONE_PAYOUT_REQUIRED';END IF;
END $$;


CREATE FUNCTION iig_closed_entry.validate_sidegame(old_s jsonb,new_s jsonb,actor text)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
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
END $$;


-- Server derives protected maintenance. Browser proposals cannot invent resets,
-- awards or restored fields. This is candidate code, NOT an installation script.
CREATE FUNCTION iig_closed_entry.derive_operation(s jsonb,op text,selection integer DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE result jsonb:=s;t jsonb:=s->'trip';backup jsonb;past jsonb;players jsonb:='[]';p jsonb;b jsonb;n jsonb;r jsonb;item jsonb;name text;key text;
BEGIN
 IF op IN ('tripreturn','tripcancel') THEN
  IF (op='tripreturn' AND (t->'completed' IS DISTINCT FROM 'true'::jsonb OR t->'active'='true'::jsonb))
   OR (op='tripcancel' AND t->'active' IS DISTINCT FROM 'true'::jsonb) THEN RAISE EXCEPTION 'INVALID_TRIP_RETURN_PHASE';END IF;
  backup:=coalesce(nullif(t->'normalRoundBackup','null'),t#>'{pastTrips,0,normalRoundBackup}');
  IF jsonb_typeof(backup) IS DISTINCT FROM 'object' OR jsonb_typeof(backup->'players') IS DISTINCT FROM 'array'
   OR (SELECT count(*) FROM jsonb_array_elements(backup->'players'))<>(SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(backup->'players') x)
  THEN RAISE EXCEPTION 'NORMAL_ROUND_BACKUP_REQUIRED';END IF;
  IF op='tripcancel' AND jsonb_typeof(backup->'roundOpen') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'AMBIGUOUS_ACTIVE_NORMAL_BACKUP';END IF;
  IF op='tripcancel' AND backup->'roundOpen'='true'::jsonb AND
   (backup->>'gameType' IS NULL OR backup->>'gameType' NOT IN ('money','points') OR backup->>'pointsCompetition' IS NULL OR backup->>'pointsCompetition' NOT IN ('stableford','net')
    OR coalesce(btrim(backup->>'course'),'')='' OR coalesce(btrim(backup->>'date'),'')='') THEN RAISE EXCEPTION 'AMBIGUOUS_ACTIVE_NORMAL_BACKUP';END IF;
  -- Keep the current membership/profile/order/unknown player fields. Never revive
  -- deleted people or discard new members by replacing the roster with the backup.
  FOR p IN SELECT value FROM jsonb_array_elements(s->'players') LOOP
   SELECT value INTO b FROM jsonb_array_elements(backup->'players') x WHERE x->>'id'=p->>'id';
   n:=p-'tripNotPlayingToday';
   IF b IS NOT NULL THEN
    FOREACH key IN ARRAY ARRAY['wins','leaguePoints','netWinnings'] LOOP
     IF b ? key THEN n:=jsonb_set(n,ARRAY[key],b->key);END IF;
    END LOOP;
   END IF;
   IF op='tripcancel' AND b IS NOT NULL THEN
    IF backup->'roundOpen'='true'::jsonb AND
     (NOT b ? 'stableford' OR NOT b ? 'netScore' OR NOT b ? 'noReturn'
      OR (backup->>'gameType'='points' AND NOT b ? 'playingThisRound'))
    THEN RAISE EXCEPTION 'AMBIGUOUS_ACTIVE_NORMAL_BACKUP';END IF;
    FOREACH key IN ARRAY ARRAY['paid','playingThisRound','competition','stableford','netScore','noReturn','scoreSubmitted'] LOOP
     IF b ? key THEN n:=jsonb_set(n,ARRAY[key],b->key);
     ELSE n:=jsonb_set(n,ARRAY[key],CASE WHEN key IN ('paid','playingThisRound','noReturn','scoreSubmitted') THEN 'false'::jsonb ELSE 'null'::jsonb END);END IF;
    END LOOP;
   ELSE
    n:=n||'{"paid":false,"playingThisRound":false,"competition":null,"stableford":null,"netScore":null,"noReturn":false,"scoreSubmitted":false}'::jsonb;
   END IF;
   players:=players||jsonb_build_array(n);
  END LOOP;
  FOREACH key IN ARRAY ARRAY['course','date','stake','gameType','splitPrizes','firstPrize','secondPrize','thirdPrize','pointsCompetition','pointsValue'] LOOP
   IF backup ? key THEN result:=jsonb_set(result,ARRAY[key],backup->key);
   ELSE result:=result-key;END IF;
  END LOOP;
  result:=result||jsonb_build_object('players',players,'roundOpen',CASE WHEN op='tripcancel' THEN coalesce(backup->'roundOpen','false') ELSE 'false'::jsonb END);
  IF op='tripreturn' THEN result:=result||'{"date":"","roundOpen":false}'::jsonb;END IF;
  past:=coalesce(t->'pastTrips','[]');
  IF jsonb_typeof(past) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID_PAST_TRIPS';END IF;
  IF op='tripreturn' THEN past:=jsonb_build_array((t-'pastTrips')||'{"active":false,"completed":true}'::jsonb)||past;END IF;
  result:=result||jsonb_build_object('trip',jsonb_build_object('active',false,'completed',false,'name','','totalRounds',0,'currentRound',0,
   'competition',NULL,'tripPointsEnabled',true,'tripPointsValue',10,'rounds','[]'::jsonb,'standings','{}'::jsonb,'teamStandings','{}'::jsonb,
   'champion',NULL,'tripTieNames','[]'::jsonb,'pointsChampion',NULL,'teamChampion',NULL,'pastTrips',past));
 ELSIF op IN ('resetscores','resetpayments','clearleague','deletelast') THEN
  r:=s#>'{history,0}';
  IF op='deletelast' AND r IS NULL THEN RAISE EXCEPTION 'NO_HISTORY';END IF;
  FOR p IN SELECT value FROM jsonb_array_elements(s->'players') LOOP
   n:=p;
   IF op='resetscores' THEN n:=n||'{"stableford":null,"netScore":null,"noReturn":false,"scoreSubmitted":false}'::jsonb;
   ELSIF op='resetpayments' THEN n:=n||'{"paid":false}'::jsonb;
   ELSIF op='clearleague' THEN n:=n||'{"wins":0,"leaguePoints":0,"netWinnings":0}'::jsonb;
   ELSE
    -- Match the existing explicit deleteLastRound arithmetic, including repeated
    -- recorded names; no recalculation of unrelated rounds or financial payouts.
    FOR name IN SELECT value FROM jsonb_array_elements_text(coalesce(r->'winners','[]')) LOOP
     IF n->>'name'=name AND coalesce((n->>'wins')::numeric,0)>0 THEN n:=jsonb_set(n,'{wins}',to_jsonb((n->>'wins')::numeric-1));END IF;
    END LOOP;
    IF r->>'gameType'='points' THEN
     FOR item IN SELECT value FROM jsonb_array_elements(coalesce(r->'pointsResults','[]')) LOOP
      IF n->>'name'=item->>'name' THEN n:=jsonb_set(n,'{leaguePoints}',to_jsonb(greatest(0,coalesce((n->>'leaguePoints')::numeric,0)-coalesce((item->>'points')::numeric,0))));END IF;
     END LOOP;
    END IF;
   END IF;
   players:=players||jsonb_build_array(n);
  END LOOP;
  result:=jsonb_set(result,'{players}',players);
  IF op='deletelast' THEN result:=jsonb_set(result,'{history}',(s->'history')-0);END IF;
  IF op='clearleague' THEN result:=jsonb_set(result,'{history}','[]');END IF;
 ELSIF op='deletepasttrip' THEN
  past:=s#>'{trip,pastTrips}';
  IF selection IS NULL OR jsonb_typeof(past) IS DISTINCT FROM 'array' OR selection<0 OR selection>=jsonb_array_length(past)
  THEN RAISE EXCEPTION 'INVALID_TRIP_SELECTION';END IF;
  result:=jsonb_set(result,'{trip,pastTrips}',past-selection);
 ELSE RAISE EXCEPTION 'UNSUPPORTED_DERIVED_OPERATION';END IF;
 RETURN result;
END $$;


CREATE FUNCTION iig_closed_entry.validate_configuration(o jsonb,n jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE p jsonb;q jsonb;k text;i integer;
BEGIN
 IF (o-ARRAY['course','date','stake','pointsCompetition','splitPrizes','firstPrize','secondPrize','thirdPrize','players','lastActivityAt'])
  IS DISTINCT FROM (n-ARRAY['course','date','stake','pointsCompetition','splitPrizes','firstPrize','secondPrize','thirdPrize','players','lastActivityAt'])
 OR jsonb_typeof(n->'players') IS DISTINCT FROM 'array' OR jsonb_array_length(o->'players')<>jsonb_array_length(n->'players')
 THEN RAISE EXCEPTION 'CONFIGURATION_CHANGED_UNRELATED_FIELDS';END IF;
 IF o->'course' IS DISTINCT FROM n->'course' AND (jsonb_typeof(n->'course') IS DISTINCT FROM 'string' OR length(btrim(n->>'course')) NOT BETWEEN 1 AND 200)
 THEN RAISE EXCEPTION 'INVALID_COURSE';END IF;
 IF o->'date' IS DISTINCT FROM n->'date' THEN
  IF n->>'date' IS NULL OR n->>'date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'INVALID_DATE';END IF;
  PERFORM (n->>'date')::date;
 END IF;
 IF o->'pointsCompetition' IS DISTINCT FROM n->'pointsCompetition' AND (n->>'pointsCompetition' IS NULL OR n->>'pointsCompetition' NOT IN ('stableford','net')) THEN RAISE EXCEPTION 'INVALID_COMPETITION';END IF;
 FOREACH k IN ARRAY ARRAY['stake','firstPrize','secondPrize','thirdPrize'] LOOP
  IF o->k IS DISTINCT FROM n->k AND (jsonb_typeof(n->k) IS DISTINCT FROM 'number' OR (n->>k)::numeric<0
   OR (k<>'stake' AND n->>k !~ '^[0-9]+$') OR (k='firstPrize' AND n->k<>'0'::jsonb)) THEN RAISE EXCEPTION 'INVALID_CONFIGURATION_FINANCES';END IF;
 END LOOP;
 IF o->'splitPrizes' IS DISTINCT FROM n->'splitPrizes' AND jsonb_typeof(n->'splitPrizes') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'INVALID_PRIZE_SPLIT';END IF;
 FOR i IN SELECT generate_series(0,jsonb_array_length(o->'players')-1) LOOP
  p:=o->'players'->i;q:=n->'players'->i;
  IF (p-'competition') IS DISTINCT FROM (q-'competition') OR (p->'competition' IS DISTINCT FROM q->'competition' AND q->'competition' IS DISTINCT FROM n->'pointsCompetition')
  THEN RAISE EXCEPTION 'CONFIGURATION_CHANGED_PLAYER';END IF;
 END LOOP;
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA iig_closed_entry FROM PUBLIC,anon,authenticated,service_role;
