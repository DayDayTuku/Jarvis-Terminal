create table if not exists public.jarvis_product_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_name text not null check (event_name in ('session_start','page_view','weekly_picks_view','research_paper_open','stock_detail_open')),
  page_path text not null,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists jarvis_product_events_user_time_idx
  on public.jarvis_product_events (user_id, occurred_at desc);
create index if not exists jarvis_product_events_name_time_idx
  on public.jarvis_product_events (event_name, occurred_at desc);

alter table public.jarvis_product_events enable row level security;

drop policy if exists "Users can create their own product events" on public.jarvis_product_events;
create policy "Users can create their own product events"
  on public.jarvis_product_events for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can read their own product events" on public.jarvis_product_events;
create policy "Users can read their own product events"
  on public.jarvis_product_events for select to authenticated
  using (auth.uid() = user_id);

revoke update, delete on public.jarvis_product_events from anon, authenticated;
