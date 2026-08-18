-- 10's In shared database setup
-- Run this entire file once in Supabase SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.tens_in_groups (
  id uuid primary key default gen_random_uuid(),
  group_name text not null,
  pin_hash text not null,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.tens_in_groups enable row level security;
revoke all on table public.tens_in_groups from anon, authenticated;

-- Remove an old copy of the demo group if re-running setup.
delete from public.tens_in_groups where group_name = '10''s In';

insert into public.tens_in_groups (group_name, pin_hash, state)
values (
  '10''s In',
  crypt('1010', gen_salt('bf')),
  '{
    "course":"Hazel Grove Golf Club",
    "date":"Saturday",
    "stake":20,
    "players":[
      {"id":"ga","name":"Greg A","handicap":11,"paid":false,"score":null,"wins":0,"netWinnings":0},
      {"id":"gr","name":"Greg R","handicap":14,"paid":false,"score":null,"wins":0,"netWinnings":0},
      {"id":"to","name":"Tony","handicap":16,"paid":false,"score":null,"wins":0,"netWinnings":0},
      {"id":"bi","name":"Billy","handicap":18,"paid":false,"score":null,"wins":0,"netWinnings":0}
    ],
    "history":[]
  }'::jsonb
);

create or replace function public.get_group_state(p_pin text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select state
  from public.tens_in_groups
  where group_name = '10''s In'
    and pin_hash = crypt(p_pin, pin_hash)
  limit 1;
$$;

create or replace function public.save_group_state(p_pin text, p_state jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.tens_in_groups
  set state = p_state, updated_at = now()
  where group_name = '10''s In'
    and pin_hash = crypt(p_pin, pin_hash);
  return found;
end;
$$;

revoke all on function public.get_group_state(text) from public;
revoke all on function public.save_group_state(text,jsonb) from public;
grant execute on function public.get_group_state(text) to anon, authenticated;
grant execute on function public.save_group_state(text,jsonb) to anon, authenticated;
