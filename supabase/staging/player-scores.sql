-- Apply only to Im In Golf Test (nyavvwrsrxqfyhiygkgw), after setup-test-project.sql.
-- Adds final totals only. Does not change existing scores or legacy groups.
begin;
create or replace function public.iig_submit_my_score(
  p_pin text, p_score integer, p_format text, p_revision bigint
) returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_id bigint; v_player uuid; v_state jsonb; v_me jsonb;
  v_revision bigint; v_players jsonb; v_field text;
begin
  select o.group_id,o.revision,m.player_id into v_id,v_revision,v_player
  from iig_private.group_owners o join public.tens_in_groups g on g.id=o.group_id
  join iig_private.group_members m on m.group_id=g.id
  where g.group_pin=p_pin and m.user_id=auth.uid() for update of o;
  if not found then raise exception 'Group membership required' using errcode='42501'; end if;
  perform iig_private.check_group_access(p_pin);
  if p_revision is null or p_revision<>v_revision then
    raise exception 'Group changed; reload before submitting' using errcode='40001';
  end if;
  select state into v_state from public.tens_in_groups where id=v_id;
  if v_state->'roundOpen' is distinct from 'true'::jsonb
    or nullif(btrim(v_state->>'course'),'') is null
    or nullif(v_state->>'date','') is null then raise exception 'Scoring is closed'; end if;
  if p_format is null or p_format not in ('stableford','net')
    or p_format is distinct from v_state->>'pointsCompetition' then
    raise exception 'Competition format changed; reload before submitting';
  end if;
  if p_score is null or p_score<0 or p_score>(case when p_format='net' then 999 else 99 end) then
    raise exception 'Invalid final score';
  end if;
  select p into v_me from jsonb_array_elements(v_state->'players') p where p->>'id'=v_player::text;
  if v_me is null or v_me->'playingThisRound' is distinct from 'true'::jsonb then
    raise exception 'You must be marked as playing';
  end if;
  if v_me->'scoreSubmitted'='true'::jsonb or v_me->'noReturn'='true'::jsonb
    or v_me->>'stableford' is not null or v_me->>'netScore' is not null then
    raise exception 'A result is already recorded. Ask your organiser about corrections.';
  end if;
  v_field := case when p_format='net' then 'netScore' else 'stableford' end;
  select jsonb_agg(case when p->>'id'=v_player::text then
    p || jsonb_build_object(v_field,p_score,'scoreSubmitted',true)
    else p end order by pos) into v_players
  from jsonb_array_elements(v_state->'players') with ordinality as entries(p,pos);
  update public.tens_in_groups set state=jsonb_set(state,'{players}',v_players),updated_at=now() where id=v_id;
  update iig_private.group_owners set revision=revision+1 where group_id=v_id returning revision into v_revision;
  return v_revision;
end $$;
revoke all on function public.iig_submit_my_score(text,integer,text,bigint) from public,anon;
grant execute on function public.iig_submit_my_score(text,integer,text,bigint) to authenticated;
commit;
