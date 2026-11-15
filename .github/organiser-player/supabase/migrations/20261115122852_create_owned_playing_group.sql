-- Add a transactional entry point; existing creation, membership and auth writers stay unchanged.
BEGIN;
SET LOCAL lock_timeout = '2s';
CREATE FUNCTION public.iig_create_owned_playing_group(p_name text, p_organiser_name text, p_handicap numeric, p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE created jsonb; owned jsonb; member jsonb; player_id text;
BEGIN
 IF p_handicap IS NULL OR p_handicap NOT BETWEEN -10 AND 60 OR p_handicap<>round(p_handicap,1) THEN
  RAISE EXCEPTION 'Enter your handicap from -10 to 60, with up to one decimal place.' USING ERRCODE='22023';
 END IF;
 -- The established writer verifies the account, registration policy and retry key.
 created:=public.iig_create_owned_group(p_name,p_organiser_name,p_request_id);
 owned:=public.iig_read_entry_group();
 IF owned IS NULL OR owned->>'group_pin' IS DISTINCT FROM created->>'group_pin' OR owned->>'invite_token' IS NULL THEN
  RAISE EXCEPTION 'Your new group could not be confirmed. Please try again.';
 END IF;
 -- Same verified membership operation used by the existing player setup. A retry
 -- returns the linked player instead of adding a duplicate. Both writes commit together.
 player_id:=public.iig_join_release_group(owned->>'group_pin',(owned->>'invite_token')::uuid,p_organiser_name,p_handicap);
 member:=public.iig_read_entry_group(owned->>'group_pin');
 IF player_id IS NULL OR member->>'player_id' IS DISTINCT FROM player_id
 OR (SELECT count(*) FROM jsonb_array_elements(member->'state'->'players') p WHERE p->>'id'=player_id)<>1 THEN
  RAISE EXCEPTION 'Your player profile could not be confirmed. Please try again.';
 END IF;
 RETURN created||jsonb_build_object('player_id',player_id);
END $$;
REVOKE ALL ON FUNCTION public.iig_create_owned_playing_group(text,text,numeric,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.iig_create_owned_playing_group(text,text,numeric,uuid) TO authenticated;
COMMIT;
