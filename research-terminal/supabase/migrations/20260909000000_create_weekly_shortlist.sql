create extension if not exists pgcrypto;

create table if not exists public.jarvis_weekly_runs (
  id uuid primary key default gen_random_uuid(), week_of date not null unique,
  snapshot_kind text not null check (snapshot_kind in ('pilot','forward')),
  methodology_version text not null default 'v1', status text not null default 'locked' check (status='locked'),
  universe_count integer not null default 174, market_regime text,
  capital_idr numeric not null default 10000000, benchmark_symbol text not null default '^JKSE',
  benchmark_entry numeric, generated_at timestamptz not null default now(), note text
);
create table if not exists public.jarvis_weekly_candidates (
  id uuid primary key default gen_random_uuid(), run_id uuid not null references public.jarvis_weekly_runs(id) on delete restrict,
  rank integer not null check(rank between 1 and 5), ticker text not null, setup text not null, score numeric not null,
  signal_close numeric not null, planned_entry_low numeric not null, planned_entry_high numeric not null,
  invalidation numeric not null, hard_stop numeric not null, target_one numeric not null, risk_reward numeric not null,
  position_size_idr numeric not null, position_weight numeric not null,
  status text not null default 'new' check(status in ('new','progressing','stalled','at_risk','invalidated','target_reached','closed')),
  reasons jsonb not null default '[]'::jsonb, caution text, created_at timestamptz not null default now(),
  unique(run_id,ticker), unique(run_id,rank)
);
create table if not exists public.jarvis_weekly_reviews (
  id uuid primary key default gen_random_uuid(), run_id uuid not null references public.jarvis_weekly_runs(id) on delete restrict,
  candidate_id uuid not null references public.jarvis_weekly_candidates(id) on delete restrict,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  decision text not null check(decision in ('approved','rejected','pending')),
  checklist jsonb not null default '{}'::jsonb, note text, reviewed_at timestamptz not null default now(),
  unique(candidate_id,user_id)
);
alter table public.jarvis_weekly_runs enable row level security;
alter table public.jarvis_weekly_candidates enable row level security;
alter table public.jarvis_weekly_reviews enable row level security;
create policy "authenticated read weekly runs" on public.jarvis_weekly_runs for select to authenticated using(true);
create policy "admin creates weekly runs" on public.jarvis_weekly_runs for insert to authenticated with check((auth.jwt()->'app_metadata'->>'role')='admin');
create policy "authenticated read weekly candidates" on public.jarvis_weekly_candidates for select to authenticated using(true);
create policy "admin creates weekly candidates" on public.jarvis_weekly_candidates for insert to authenticated with check((auth.jwt()->'app_metadata'->>'role')='admin');
create policy "users read own weekly reviews" on public.jarvis_weekly_reviews for select to authenticated using(auth.uid()=user_id);
create policy "users create own weekly reviews" on public.jarvis_weekly_reviews for insert to authenticated with check(auth.uid()=user_id);
create policy "users update own weekly reviews" on public.jarvis_weekly_reviews for update to authenticated using(auth.uid()=user_id) with check(auth.uid()=user_id);
revoke update,delete on public.jarvis_weekly_runs from anon,authenticated;
revoke update,delete on public.jarvis_weekly_candidates from anon,authenticated;
grant select,insert on public.jarvis_weekly_runs to authenticated;
grant select,insert on public.jarvis_weekly_candidates to authenticated;
grant select,insert,update on public.jarvis_weekly_reviews to authenticated;
insert into public.jarvis_weekly_runs(week_of,snapshot_kind,status,note)
values('2026-09-04','pilot','locked','Pilot inception. No model candidates were backfilled; first fully forward immutable shortlist follows the next Friday close.')
on conflict(week_of) do nothing;
