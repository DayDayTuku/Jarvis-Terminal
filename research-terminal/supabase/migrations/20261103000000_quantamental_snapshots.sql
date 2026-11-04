-- Point-in-time Quantamental snapshots.
--
-- One row per trading date and methodology version. The full computed map is
-- stored so a prior screen can be reconstructed exactly rather than recomputed
-- with today's data (which would introduce look-ahead bias).
--
-- Service-role only: snapshots are an internal research record, not user data.

create table if not exists public.jarvis_quantamental_snapshots (
  id bigserial primary key,
  trade_date date not null,
  as_of timestamptz not null,
  status text not null default 'live',
  universe_size integer not null default 0,
  plotted integer not null default 0,
  methodology_version text not null default 'v2',
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (trade_date, methodology_version)
);

create index if not exists jarvis_quantamental_snapshots_date_idx
  on public.jarvis_quantamental_snapshots (trade_date desc);

alter table public.jarvis_quantamental_snapshots enable row level security;
revoke all on public.jarvis_quantamental_snapshots from anon, authenticated;
grant all on public.jarvis_quantamental_snapshots to service_role;
