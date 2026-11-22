-- Run against the installed migration. All fixtures stay in local variables.
DO $test$
DECLARE
  s jsonb := '{"gameType":"money","stake":10,"pointsCompetition":"net","roundOpen":true,
    "players":[{"id":"a","paid":true,"netScore":0},{"id":"b","paid":true},{"id":"c","paid":false}],
    "history":[{"players":[{"id":"a","netScore":71}]}]}';
  view_state jsonb;
  changed jsonb;
BEGIN
  IF iig_closed_entry.initial_field(s) IS NOT NULL
     OR iig_closed_entry.completed_field(jsonb_set(s,'{players}','[]')) IS NOT NULL THEN
    RAISE EXCEPTION 'An empty or incomplete field closed entries';
  END IF;
  view_state := iig_closed_entry.member_view(s,'b');
  IF view_state#>'{players,0,netScore}' IS NOT NULL
     OR view_state#>'{history,0,players,0,netScore}' IS DISTINCT FROM '71'::jsonb
     OR iig_closed_entry.member_view(s,'a')#>'{players,0,netScore}' IS DISTINCT FROM '0'::jsonb THEN
    RAISE EXCEPTION 'Current score privacy or historical results changed';
  END IF;
  changed := jsonb_set(s,'{players,1,noReturn}','true');
  IF iig_closed_entry.completed_field(changed) IS DISTINCT FROM '["a","b"]'::jsonb
     OR iig_closed_entry.member_view(changed,'b')#>'{players,0,netScore}' IS DISTINCT FROM '0'::jsonb
     OR iig_closed_entry.member_view(changed,'c')#>'{players,0,netScore}' IS NOT NULL THEN
    RAISE EXCEPTION 'Final Net NR, zero score or spectator visibility is incorrect';
  END IF;
  changed := jsonb_set(changed,'{players,2,paid}','true');
  IF iig_closed_entry.completed_field(changed) IS NOT NULL THEN
    RAISE EXCEPTION 'A late paid entrant with an outstanding score must count';
  END IF;
  changed := jsonb_set(s,'{pointsCompetition}','"stableford"');
  IF iig_closed_entry.result_in(changed,'{"scoreSubmitted":true,"noReturn":true,"netScore":70}')
     OR NOT iig_closed_entry.result_in(changed,'{"stableford":0}') THEN
    RAISE EXCEPTION 'Only a result in the current format counts';
  END IF;
  IF iig_closed_entry.initial_field(jsonb_set(s,'{gameType}','"points"')) IS NULL
     OR iig_closed_entry.visible_scores(jsonb_set(s,'{roundOpen}','false'),'b')#>'{players,0,netScore}' IS DISTINCT FROM '0'::jsonb THEN
    RAISE EXCEPTION 'Existing Points or finished-round behavior changed';
  END IF;
END
$test$;
