-- Add unique usernames and public account profiles to an existing Finance Tracker project.
-- Run this once in Supabase Dashboard -> SQL Editor.

begin;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_length check (char_length(btrim(username)) between 2 and 40),
  constraint profiles_username_trimmed check (username = btrim(username))
);

-- Backfill profiles for accounts created before this table existed.
insert into public.profiles (user_id, username, created_at, updated_at)
select
  u.id,
  case
    when char_length(candidate.username) between 2 and 40 then candidate.username
    else 'user_' || substr(replace(u.id::text, '-', ''), 1, 8)
  end,
  coalesce(u.created_at, now()),
  now()
from auth.users u
cross join lateral (
  select btrim(coalesce(
    nullif(u.raw_user_meta_data ->> 'username', ''),
    nullif(u.raw_user_meta_data ->> 'display_name', ''),
    nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
    'user_' || substr(replace(u.id::text, '-', ''), 1, 8)
  )) as username
) candidate
on conflict (user_id) do nothing;

-- Resolve usernames that were already duplicated before uniqueness was enforced.
-- The oldest account keeps the original name; later duplicates receive a stable
-- suffix based on their existing Supabase Auth UUID.
with ranked as (
  select
    user_id,
    username,
    row_number() over (
      partition by lower(username)
      order by created_at asc, user_id asc
    ) as duplicate_rank,
    count(*) over (partition by lower(username)) as duplicate_count
  from public.profiles
)
update public.profiles p
set
  username = left(p.username, 26) || '_' || substr(replace(p.user_id::text, '-', ''), 1, 12),
  updated_at = now()
from ranked r
where p.user_id = r.user_id
  and r.duplicate_count > 1
  and r.duplicate_rank > 1;

create unique index if not exists profiles_username_unique_ci
  on public.profiles ((lower(username)));

alter table public.profiles enable row level security;
revoke all on public.profiles from anon;
grant select, update on public.profiles to authenticated;

drop policy if exists "Users read own profile" on public.profiles;
create policy "Users read own profile"
on public.profiles
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users update own profile" on public.profiles;
create policy "Users update own profile"
on public.profiles
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

-- This exposes only a yes/no availability check. It does not expose the list of usernames.
create or replace function public.username_available(candidate text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    char_length(btrim(coalesce(candidate, ''))) between 2 and 40
    and not exists (
      select 1
      from public.profiles
      where lower(username) = lower(btrim(candidate))
    );
$$;

revoke all on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;

-- New Auth users automatically receive a profile row. The case-insensitive unique
-- index is the final race-safe guard if two signups request the same username.
create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_username text;
begin
  requested_username := btrim(coalesce(
    nullif(new.raw_user_meta_data ->> 'username', ''),
    nullif(new.raw_user_meta_data ->> 'display_name', ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'user_' || substr(replace(new.id::text, '-', ''), 1, 8)
  ));

  if char_length(requested_username) < 2 or char_length(requested_username) > 40 then
    requested_username := 'user_' || substr(replace(new.id::text, '-', ''), 1, 8);
  end if;

  insert into public.profiles (user_id, username)
  values (new.id, requested_username);

  return new;
exception
  when unique_violation then
    raise exception 'Username is already taken' using errcode = '23505';
end;
$$;

drop trigger if exists create_profile_after_auth_signup on auth.users;
create trigger create_profile_after_auth_signup
after insert on auth.users
for each row execute function public.create_profile_for_new_user();

commit;
