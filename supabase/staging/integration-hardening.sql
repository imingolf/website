-- STAGING ONLY: apply after self-service-registration.sql and player-scores.sql.
-- Incremental; never rerun the empty baseline. No application on production is authorised.
-- No group rows, membership rows or historical results are rewritten.
begin;
create or replace function public.iig_join_owned_group(p_pin text,p_invite uuid,p_name text,p_handicap numeric)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_id bigint; v_player uuid; v_state jsonb;
begin
  perform iig_private.verified_organiser();
  if v_uid is null then raise exception 'Player session required' using errcode='42501'; end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 80 or p_handicap is null
    or p_handicap not between -10 and 60 or p_handicap<>round(p_handicap,1)
  then raise exception 'Invalid player name or handicap'; end if;
  select o.group_id into v_id from iig_private.group_owners o
    join public.tens_in_groups g on g.id=o.group_id
    where g.group_pin=p_pin and o.invite_token=p_invite for update of o;
  if not found then raise exception 'Invitation is invalid' using errcode='42501'; end if;
  perform iig_private.check_group_access(p_pin);
  select player_id into v_player from iig_private.group_members where group_id=v_id and user_id=v_uid;
  if found then return v_player; end if;
  select state into v_state from public.tens_in_groups where id=v_id;
  if jsonb_array_length(v_state->'players')>=200 then raise exception 'Test group capacity reached'; end if;
  insert into iig_private.group_members(group_id,user_id) values(v_id,v_uid) returning player_id into v_player;
  update public.tens_in_groups set state=jsonb_set(state,'{players}',(state->'players') ||
    jsonb_build_array(jsonb_build_object('id',v_player,'name',btrim(p_name),'handicap',p_handicap,
      'paid',false,'stableford',null,'netScore',null,'playingThisRound',false))),updated_at=now() where id=v_id;
  update iig_private.group_owners set revision=revision+1 where group_id=v_id;
  return v_player;
end $$;

create or replace function public.iig_set_my_attendance(p_pin text,p_attending boolean,p_revision bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_id bigint; v_player uuid; v_state jsonb; v_revision bigint; v_players jsonb;
begin
  perform iig_private.verified_organiser();
  select o.group_id,o.revision,m.player_id into v_id,v_revision,v_player
    from iig_private.group_owners o join public.tens_in_groups g on g.id=o.group_id
    join iig_private.group_members m on m.group_id=g.id
    where g.group_pin=p_pin and m.user_id=auth.uid() for update of o;
  if not found then raise exception 'Group membership required' using errcode='42501'; end if;
  perform iig_private.check_group_access(p_pin);
  if p_attending is null or p_revision is null or p_revision<>v_revision
  then raise exception 'Group changed; reload before saving' using errcode='40001'; end if;
  select state into v_state from public.tens_in_groups where id=v_id;
  if v_state->>'gameType' is distinct from 'points' or v_state->'trip'->'active'='true'::jsonb
  then raise exception 'This action requires an individual Points Game outside Trip Mode'; end if;
  if v_state->'roundOpen' is distinct from 'true'::jsonb or exists(
    select 1 from jsonb_array_elements(v_state->'players') p
    where p->'scoreSubmitted'='true'::jsonb or p->'noReturn'='true'::jsonb
      or (p->>'stableford') is not null or (p->>'netScore') is not null)
  then raise exception 'Entries are closed'; end if;
  if not exists(select 1 from jsonb_array_elements(v_state->'players') p where p->>'id'=v_player::text)
  then raise exception 'Player no longer in group' using errcode='42501'; end if;
  select jsonb_agg(case when p->>'id'=v_player::text
    then p || jsonb_build_object('playingThisRound',p_attending) else p end order by pos)
    into v_players from jsonb_array_elements(v_state->'players') with ordinality as entries(p,pos);
  update public.tens_in_groups set state=jsonb_set(state,'{players}',v_players),updated_at=now() where id=v_id;
  update iig_private.group_owners set revision=revision+1 where group_id=v_id returning revision into v_revision;
  return v_revision;
end $$;

create or replace function public.iig_submit_my_score(
  p_pin text, p_score integer, p_format text, p_revision bigint
) returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_id bigint; v_player uuid; v_state jsonb; v_me jsonb;
  v_revision bigint; v_players jsonb; v_field text;
begin
  perform iig_private.verified_organiser();
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
  if v_state->>'gameType' is distinct from 'points' or v_state->'trip'->'active'='true'::jsonb
  then raise exception 'This action requires an individual Points Game outside Trip Mode'; end if;
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

create or replace function iig_private.player_result(p_result jsonb) returns jsonb
language sql immutable set search_path = '' as $$
 select coalesce(jsonb_object_agg(key,value),'{}'::jsonb)
 from jsonb_each(p_result) where key=any(array[
 'id','name','handicap','stableford','netScore','scoreSubmitted','noReturn',
 'playingThisRound','leaguePoints','wins','score','points','position','countback'
 ]);
$$;
create or replace function public.iig_get_player_group(p_pin text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_state jsonb; v_player uuid; v_revision bigint; v_out jsonb; v_history jsonb;
begin
 perform iig_private.verified_organiser();
 select g.state,m.player_id,o.revision into v_state,v_player,v_revision
 from public.tens_in_groups g join iig_private.group_owners o on o.group_id=g.id
 join iig_private.group_members m on m.group_id=g.id
 where g.group_pin=p_pin and m.user_id=auth.uid();
 if not found then raise exception 'Group membership required' using errcode='42501'; end if;
 perform iig_private.check_group_access(p_pin);
 select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into v_out from jsonb_each(v_state)
 where key=any(array['groupName','course','date','roundOpen','pointsCompetition','gameType']);
 select coalesce(jsonb_agg(
   (select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) from jsonb_each(h)
    where key=any(array['date','course','gameType','pointsCompetition'])) ||
   jsonb_build_object(
    'players',(select coalesce(jsonb_agg(iig_private.player_result(p) order by n),'[]'::jsonb)
      from jsonb_array_elements(h->'players') with ordinality as x(p,n)),
    'pointsResults',(select coalesce(jsonb_agg(iig_private.player_result(p) order by n),'[]'::jsonb)
      from jsonb_array_elements(h->'pointsResults') with ordinality as x(p,n)))
   order by pos),'[]'::jsonb) into v_history
 from jsonb_array_elements(v_state->'history') with ordinality as x(h,pos)
 where h->>'gameType'='points';
 return jsonb_build_object('player_id',v_player,'revision',v_revision,'state',v_out ||
  jsonb_build_object('trip',jsonb_build_object('active',v_state->'trip'->'active'),'history',v_history,'players',(
   select coalesce(jsonb_agg(iig_private.player_result(p) order by pos),'[]'::jsonb)
   from jsonb_array_elements(v_state->'players') with ordinality as x(p,pos))));
end $$;
revoke all on function iig_private.player_result(jsonb) from public,anon,authenticated;

commit;
