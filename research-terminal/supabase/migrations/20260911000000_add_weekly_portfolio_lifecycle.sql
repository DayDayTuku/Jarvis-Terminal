create table if not exists public.jarvis_weekly_actions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.jarvis_weekly_runs(id) on delete restrict,
  prior_run_id uuid references public.jarvis_weekly_runs(id) on delete restrict,
  ticker text not null,
  action text not null check(action in ('BUY','HOLD','REDUCE','EXIT','REPLACE','NO_ENTRY','EXPIRED')),
  previous_score numeric,
  current_score numeric,
  target_weight numeric not null default 0,
  theoretical_fill numeric,
  entry_filled boolean not null default false,
  target_reached boolean not null default false,
  invalidated boolean not null default false,
  reason text not null,
  created_at timestamptz not null default now(),
  unique(run_id,ticker)
);

alter table public.jarvis_weekly_actions enable row level security;
create policy "authenticated read weekly actions" on public.jarvis_weekly_actions for select to authenticated using(true);
create policy "admin creates weekly actions" on public.jarvis_weekly_actions for insert to authenticated with check((auth.jwt()->'app_metadata'->>'role')='admin');
revoke update,delete on public.jarvis_weekly_actions from anon,authenticated;
grant select,insert on public.jarvis_weekly_actions to authenticated;

alter table public.jarvis_weekly_runs alter column methodology_version set default 'v5';

