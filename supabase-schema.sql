-- Flexible Finance Tracker: Supabase schema
-- Run this once in Supabase Dashboard -> SQL Editor.

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

create index if not exists transactions_user_date_idx
  on public.transactions(user_id, transaction_date);
create index if not exists statements_user_date_idx
  on public.statements(user_id, statement_date desc, imported_at desc);
create index if not exists saving_goals_user_idx
  on public.saving_goals(user_id, created_at);

alter table public.finance_settings enable row level security;
alter table public.statements enable row level security;
alter table public.transactions enable row level security;
alter table public.saving_goals enable row level security;

revoke all on public.finance_settings from anon;
revoke all on public.statements from anon;
revoke all on public.transactions from anon;
revoke all on public.saving_goals from anon;

grant select, insert, update, delete on public.finance_settings to authenticated;
grant select, insert, update, delete on public.statements to authenticated;
grant select, insert, update, delete on public.transactions to authenticated;
grant select, insert, update, delete on public.saving_goals to authenticated;

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
