-- ISOLATED PROTOTYPE ONLY. No public/Auth objects, existing tables or records touched.
-- Not an installable LIVE migration. Database-role identity here is a lab fixture,
-- NOT a claim that Supabase authenticated is a per-user role.
CREATE SCHEMA iig_entry_prototype;
REVOKE ALL ON SCHEMA iig_entry_prototype FROM PUBLIC;
CREATE TABLE iig_entry_prototype.groups (
 id text PRIMARY KEY, revision bigint NOT NULL DEFAULT 0,
 phase text NOT NULL CHECK (phase IN ('open','finished')),
 closed boolean NOT NULL DEFAULT false, state jsonb NOT NULL
);
CREATE TABLE iig_entry_prototype.principals (
 role_name name NOT NULL, group_id text NOT NULL REFERENCES iig_entry_prototype.groups(id),
 player_id text NOT NULL, organiser boolean NOT NULL DEFAULT false,
 PRIMARY KEY(role_name, group_id)
);
CREATE TABLE iig_entry_prototype.archives (
 group_id text NOT NULL REFERENCES iig_entry_prototype.groups(id), round_id text NOT NULL,
 snapshot jsonb NOT NULL, PRIMARY KEY(group_id, round_id)
);
REVOKE ALL ON ALL TABLES IN SCHEMA iig_entry_prototype FROM PUBLIC;

CREATE FUNCTION iig_entry_prototype.has_score(s jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(s->'players') p
   WHERE p->'stableford' IS NOT NULL AND p->'stableford'<>'null'::jsonb
      OR p->'netScore' IS NOT NULL AND p->'netScore'<>'null'::jsonb
      OR p->'noReturn'='true'::jsonb)
 OR EXISTS (SELECT 1 FROM jsonb_each(coalesce(s#>'{trip,currentTeamScores}','{}'::jsonb)) x
            WHERE x.value<>'null'::jsonb AND x.value<>'""'::jsonb)
$$;

CREATE FUNCTION iig_entry_prototype.eligible(s jsonb,p jsonb) RETURNS boolean
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

CREATE FUNCTION iig_entry_prototype.validate_snapshot(old_s jsonb,new_s jsonb,latched boolean)
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
 locked:=latched OR iig_entry_prototype.has_score(old_s);
 first_score:=NOT locked AND iig_entry_prototype.has_score(new_s);
 FOR p IN SELECT value FROM jsonb_array_elements(old_s->'players') LOOP
   SELECT value INTO n FROM jsonb_array_elements(new_s->'players') WHERE value->>'id'=p->>'id';
   IF n IS NULL THEN RAISE EXCEPTION 'PLAYER_REMOVAL_REQUIRES_PROTECTED_OPERATION'; END IF;
   IF (locked OR first_score) AND (p-scores) IS DISTINCT FROM (n-scores) THEN
     RAISE EXCEPTION 'ENTRIES_CLOSED'; END IF;
   IF (p-scores) IS DISTINCT FROM (n-scores) AND iig_entry_prototype.has_score(old_s) THEN
     RAISE EXCEPTION 'ENTRIES_CLOSED'; END IF;
   IF EXISTS (SELECT 1 FROM unnest(scores) AS keys(k) WHERE
      p->keys.k IS NOT NULL AND p->keys.k<>'null'::jsonb AND p->keys.k<>'false'::jsonb
      AND p->keys.k IS DISTINCT FROM n->keys.k) THEN
      RAISE EXCEPTION 'SCORE_CORRECTION_REQUIRES_PROTECTED_OPERATION'; END IF;
   IF (p-scores)=(n-scores) AND (p IS DISTINCT FROM n)
      AND NOT iig_entry_prototype.eligible(old_s,p) THEN
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
   IF n->'scoreSubmitted'='true'::jsonb AND NOT iig_entry_prototype.has_score(
      jsonb_build_object('players',jsonb_build_array(n))) THEN RAISE EXCEPTION 'MISSING_SCORE'; END IF;
   -- Do not admit a previously ineligible scorer in the same ordinary save.
   IF NOT iig_entry_prototype.eligible(old_s,p)
      AND EXISTS (SELECT 1 FROM unnest(scores) AS keys(k) WHERE p->keys.k IS DISTINCT FROM n->keys.k) THEN
      RAISE EXCEPTION 'INELIGIBLE_SCORER'; END IF;
 END LOOP;
 FOR n IN SELECT value FROM jsonb_array_elements(new_s->'players') LOOP
   IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(old_s->'players') AS existing(value) WHERE existing.value->>'id'=n->>'id')
      AND (iig_entry_prototype.eligible(new_s,n) OR n->'paid'='true'::jsonb
           OR iig_entry_prototype.has_score(jsonb_build_object('players',jsonb_build_array(n)))) THEN
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
          WHERE person->>'id'=member AND iig_entry_prototype.eligible(old_s,person))) THEN RAISE EXCEPTION 'INELIGIBLE_PAIR'; END IF;
   END IF;
 END LOOP;
 IF EXISTS (SELECT 1 FROM jsonb_each(coalesce(old_s#>'{trip,currentTeamScores}','{}'::jsonb)) t
   WHERE t.value<>'null'::jsonb AND (new_s#>ARRAY['trip','currentTeamScores',t.key]) IS DISTINCT FROM t.value)
 THEN RAISE EXCEPTION 'PAIR_SCORE_REMOVAL'; END IF;
END $$;

CREATE FUNCTION iig_entry_prototype.actor(g text) RETURNS iig_entry_prototype.principals
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result iig_entry_prototype.principals; who name;
BEGIN
 who:=CASE WHEN current_setting('role')='none' THEN session_user ELSE current_setting('role') END;
 SELECT * INTO result FROM iig_entry_prototype.principals WHERE role_name=who AND group_id=g;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;
 RETURN result;
END $$;

CREATE FUNCTION iig_entry_prototype.save(g text,expected_round text,expected_revision bigint,next_state jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE row iig_entry_prototype.groups; a iig_entry_prototype.principals; p jsonb; n jsonb;
BEGIN
 a:=iig_entry_prototype.actor(g);
 SELECT * INTO row FROM iig_entry_prototype.groups WHERE id=g FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;
 IF expected_round IS NULL OR expected_revision IS NULL OR row.phase<>'open' OR row.state->>'roundId' IS DISTINCT FROM expected_round
    OR row.revision<>expected_revision THEN RAISE EXCEPTION 'STALE_ROUND_OR_REVISION'; END IF;
 PERFORM iig_entry_prototype.validate_snapshot(row.state,next_state,row.closed);
 -- Organiser capability never overrides entry closure. Ordinary players may alter
 -- only their own existing player record; pair score is organiser-only in this lab.
 IF NOT a.organiser THEN
   IF (row.state-'players'-'lastActivityAt') IS DISTINCT FROM (next_state-'players'-'lastActivityAt') THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;
   IF jsonb_array_length(row.state->'players')<>jsonb_array_length(next_state->'players') THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;
   FOR p IN SELECT value FROM jsonb_array_elements(row.state->'players') LOOP
     SELECT value INTO n FROM jsonb_array_elements(next_state->'players') WHERE value->>'id'=p->>'id';
     IF p->>'id'<>a.player_id AND p IS DISTINCT FROM n THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;
   END LOOP;
 END IF;
 UPDATE iig_entry_prototype.groups SET state=next_state,closed=row.closed OR
   iig_entry_prototype.has_score(row.state) OR iig_entry_prototype.has_score(next_state),
   revision=revision+1 WHERE id=g RETURNING revision INTO expected_revision;
 RETURN expected_revision;
END $$;

CREATE FUNCTION iig_entry_prototype.correct_score(g text,expected_round text,expected_revision bigint,
 player_id text,new_score integer)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE row iig_entry_prototype.groups; a iig_entry_prototype.principals; player jsonb; idx integer; key text;
BEGIN
 a:=iig_entry_prototype.actor(g);
 IF NOT a.organiser THEN RAISE EXCEPTION 'ORGANISER_REQUIRED'; END IF;
 SELECT * INTO row FROM iig_entry_prototype.groups WHERE id=g FOR UPDATE;
 IF expected_round IS NULL OR expected_revision IS NULL OR row.phase<>'open' OR row.state->>'roundId' IS DISTINCT FROM expected_round OR row.revision<>expected_revision
    THEN RAISE EXCEPTION 'STALE_ROUND_OR_REVISION'; END IF;
 SELECT value,(ordinality-1)::integer INTO player,idx FROM jsonb_array_elements(row.state->'players') WITH ORDINALITY
   WHERE value->>'id'=player_id;
 IF player IS NULL OR NOT iig_entry_prototype.eligible(row.state,player) THEN RAISE EXCEPTION 'INELIGIBLE_SCORER'; END IF;
 key:=CASE WHEN row.state->>'pointsCompetition'='net' THEN 'netScore' ELSE 'stableford' END;
 IF new_score IS NOT NULL AND (new_score<0 OR new_score>(CASE WHEN key='stableford' THEN 99 ELSE 999 END))
    THEN RAISE EXCEPTION 'INVALID_SCORE'; END IF;
 player:=player || jsonb_build_object(key,new_score,'noReturn',false,'scoreSubmitted',new_score IS NOT NULL);
 UPDATE iig_entry_prototype.groups SET
  state=jsonb_set(row.state,ARRAY['players',idx::text],player),
  closed=row.closed OR iig_entry_prototype.has_score(row.state) OR new_score IS NOT NULL,
  revision=revision+1 WHERE id=g RETURNING revision INTO expected_revision;
 RETURN expected_revision;
END $$;

CREATE FUNCTION iig_entry_prototype.finish(g text,expected_round text,expected_revision bigint)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE row iig_entry_prototype.groups; a iig_entry_prototype.principals;
BEGIN
 a:=iig_entry_prototype.actor(g);
 IF NOT a.organiser THEN RAISE EXCEPTION 'ORGANISER_REQUIRED'; END IF;
 SELECT * INTO row FROM iig_entry_prototype.groups WHERE id=g FOR UPDATE;
 IF expected_round IS NULL OR expected_revision IS NULL OR row.phase<>'open' OR row.state->>'roundId' IS DISTINCT FROM expected_round OR row.revision<>expected_revision
    THEN RAISE EXCEPTION 'STALE_ROUND_OR_REVISION'; END IF;
 IF NOT (row.closed OR iig_entry_prototype.has_score(row.state)) THEN RAISE EXCEPTION 'NO_SUBMITTED_SCORE'; END IF;
 -- Archive exact committed data, including payment metadata; never client-provided history.
 INSERT INTO iig_entry_prototype.archives VALUES(g,expected_round,row.state);
 UPDATE iig_entry_prototype.groups SET phase='finished',closed=true,revision=revision+1
   WHERE id=g RETURNING revision INTO expected_revision;
 RETURN expected_revision;
END $$;

CREATE FUNCTION iig_entry_prototype.start(g text,expected_round text,expected_revision bigint,
 course text,round_date text,stake numeric,format text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE row iig_entry_prototype.groups; a iig_entry_prototype.principals; next_id text; players jsonb;
BEGIN
 a:=iig_entry_prototype.actor(g);
 IF NOT a.organiser THEN RAISE EXCEPTION 'ORGANISER_REQUIRED'; END IF;
 SELECT * INTO row FROM iig_entry_prototype.groups WHERE id=g FOR UPDATE;
 IF expected_round IS NULL OR expected_revision IS NULL OR row.phase<>'finished' OR row.state->>'roundId' IS DISTINCT FROM expected_round OR row.revision<>expected_revision
    THEN RAISE EXCEPTION 'STALE_ROUND_OR_REVISION'; END IF;
 IF stake<0 OR stake::text IN ('NaN','Infinity','-Infinity') OR stake IS NULL OR format NOT IN ('stableford','net') OR format IS NULL
    OR coalesce(btrim(course),'')='' OR coalesce(btrim(round_date),'')='' THEN RAISE EXCEPTION 'INVALID_SETUP'; END IF;
 IF row.state#>'{trip,active}'='true'::jsonb THEN RAISE EXCEPTION 'TRIP_TRANSITION_REQUIRES_ADAPTER'; END IF;
 next_id:=gen_random_uuid()::text;
 SELECT jsonb_agg((p-ARRAY['paymentMarkedAt','paymentMarkMethod']) ||
   '{"paid":false,"playingThisRound":false,"stableford":null,"netScore":null,"noReturn":false,"scoreSubmitted":false}'::jsonb)
   INTO players FROM jsonb_array_elements(row.state->'players') p;
 UPDATE iig_entry_prototype.groups SET phase='open',closed=false,revision=revision+1,
 state=jsonb_set(row.state,'{players}',coalesce(players,'[]'::jsonb)) || jsonb_build_object(
   'roundId',next_id,'course',course,'date',round_date,'stake',stake,'pointsCompetition',format,
   'roundOpen',true,'trip','{}'::jsonb) WHERE id=g;
 RETURN jsonb_build_object('roundId',next_id,'revision',expected_revision+1);
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA iig_entry_prototype FROM PUBLIC;
-- No production browser role grants. Fixture roles and data are created ONLY by tests.
