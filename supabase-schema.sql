-- Flexible Finance Tracker: Supabase schema
-- Run this in Supabase Dashboard -> SQL Editor for a new project.
-- It is also safe to rerun on an existing project; existing duplicate usernames
-- are resolved before the unique username index is created.

begin;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_length check (char_length(btrim(username)) between 2 and 40),
  constraint profiles_username_trimmed check (username = btrim(username))
);

create table if not exists public.finance_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  categories jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.statements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  file_name text not null,
  currency_code text not null default 'SGD',
  statement_date date,
  available_balance numeric(14,2),
  ledger_balance numeric(14,2),
  sheet_rows jsonb not null default '[]'::jsonb,
  mask_rules jsonb not null default '[]'::jsonb,
  imported_at timestamptz not null default now()
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  statement_id uuid references public.statements(id) on delete cascade,
  transaction_date date not null,
  description text not null,
  amount numeric(14,2) not null,
  category text not null,
  exclude_from_spending boolean not null default false,
  is_payroll boolean not null default false,
  source_code text not null default '',
  currency text not null default 'SGD',
  source_kind text not null default 'manual' check (source_kind in ('imported', 'manual')),
  source_ref text,
  created_at timestamptz not null default now()
);

create table if not exists public.saving_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  category text not null,
  target_amount numeric(14,2) not null check (target_amount > 0),
  current_amount numeric(14,2) not null default 0 check (current_amount >= 0),
  target_date date,
  notes text not null default '',
  status text not null default 'active' check (status in ('active', 'completed', 'paused')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Create profiles for existing Auth users before uniqueness is enforced.
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

-- If duplicate usernames already existed, the oldest account keeps the original
-- and later duplicates receive a stable UUID-based suffix.
with ranked as (
  select
    user_id,
    username,
    row_number() over (partition by lower(username) order by created_at asc, user_id asc) as duplicate_rank,
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
create index if not exists transactions_user_date_idx
  on public.transactions(user_id, transaction_date);
create index if not exists statements_user_date_idx
  on public.statements(user_id, statement_date desc, imported_at desc);
create index if not exists saving_goals_user_idx
  on public.saving_goals(user_id, created_at);

alter table public.profiles enable row level security;
alter table public.finance_settings enable row level security;
alter table public.statements enable row level security;
alter table public.transactions enable row level security;
alter table public.saving_goals enable row level security;

revoke all on public.profiles from anon;
revoke all on public.finance_settings from anon;
revoke all on public.statements from anon;
revoke all on public.transactions from anon;
revoke all on public.saving_goals from anon;

grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.finance_settings to authenticated;
grant select, insert, update, delete on public.statements to authenticated;
grant select, insert, update, delete on public.transactions to authenticated;
grant select, insert, update, delete on public.saving_goals to authenticated;

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

drop policy if exists "Users manage own finance settings" on public.finance_settings;
create policy "Users manage own finance settings"
on public.finance_settings
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage own statements" on public.statements;
create policy "Users manage own statements"
on public.statements
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage own transactions" on public.transactions;
create policy "Users manage own transactions"
on public.transactions
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage own saving goals" on public.saving_goals;
create policy "Users manage own saving goals"
on public.saving_goals
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

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
