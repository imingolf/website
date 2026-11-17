-- Preserve the existing action function and all checks; correct only the response timestamp.
DO $patch$
DECLARE definition text; old_line text := $old$item=item||jsonb_build_object('status',case when p_action='side_accept' then 'active' else 'declined' end,'acceptedAt',now());$old$;
BEGIN
 SELECT pg_get_functiondef('public.iig_player_action(text,text,jsonb,bigint)'::regprocedure) INTO definition;
 IF (length(definition)-length(replace(definition,old_line,'')))/length(old_line) <> 1 THEN
  RAISE EXCEPTION 'Expected Side Game response implementation not found';
 END IF;
 EXECUTE replace(definition,old_line,$new$item=item||jsonb_build_object('status',case when p_action='side_accept' then 'active' else 'declined' end,case when p_action='side_accept' then 'acceptedAt' else 'declinedAt' end,now());$new$);
END $patch$;
