-- Personal workspace state. Before this migration, watchlists, notes, and
-- portfolios lived only in the browser. These tables make them portable across
-- devices while keeping every row scoped to its owner.

create table if not exists public.jarvis_watchlist (
  user_id uuid not null references auth.users(id) on delete cascade,
  ticker text not null check (ticker ~ '^[A-Z0-9]{1,8}$'),
  created_at timestamptz not null default now(),
  primary key (user_id, ticker)
);

alter table public.jarvis_watchlist enable row level security;

drop policy if exists "Users manage their own watchlist" on public.jarvis_watchlist;
create policy "Users manage their own watchlist"
  on public.jarvis_watchlist for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.jarvis_watchlist to authenticated;

create table if not exists public.jarvis_portfolios (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null default 'Main portfolio' check (char_length(name) between 1 and 80),
  positions jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.jarvis_portfolios enable row level security;

drop policy if exists "Users manage their own portfolio" on public.jarvis_portfolios;
create policy "Users manage their own portfolio"
  on public.jarvis_portfolios for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.jarvis_portfolios to authenticated;

create table if not exists public.jarvis_notes (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists jarvis_notes_user_time_idx
  on public.jarvis_notes (user_id, created_at desc);

alter table public.jarvis_notes enable row level security;

drop policy if exists "Users manage their own notes" on public.jarvis_notes;
create policy "Users manage their own notes"
  on public.jarvis_notes for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.jarvis_notes to authenticated;

create table if not exists public.jarvis_user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  color_scheme text not null default 'default'
    check (color_scheme in ('default', 'deuteranopia', 'protanopia', 'tritanopia')),
  onboarding_complete boolean not null default false,
  last_visit_at timestamptz,
  last_snapshot jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.jarvis_user_preferences enable row level security;

drop policy if exists "Users manage their own preferences" on public.jarvis_user_preferences;
create policy "Users manage their own preferences"
  on public.jarvis_user_preferences for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.jarvis_user_preferences to authenticated;

-- Extend product analytics for the activation and monetization funnel.
alter table public.jarvis_product_events
  drop constraint if exists jarvis_product_events_event_name_check;

alter table public.jarvis_product_events
  add constraint jarvis_product_events_event_name_check
  check (event_name in (
    'session_start',
    'page_view',
    'weekly_picks_view',
    'research_paper_open',
    'stock_detail_open',
    'onboarding_start',
    'onboarding_complete',
    'watchlist_add',
    'watchlist_remove',
    'portfolio_save',
    'note_save',
    'preferences_save',
    'pricing_view',
    'upgrade_click',
    'command_palette_open',
    'news_save',
    'paper_search',
    'seasonality_export'
  ));
