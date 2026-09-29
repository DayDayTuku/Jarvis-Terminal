create table if not exists public.jarvis_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_key text not null,
  event_type text not null check (event_type in ('weekly_digest','market_alert')),
  recipient text not null,
  status text not null default 'pending' check (status in ('pending','sent','failed')),
  provider_id text,
  error text,
  attempted_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_key, recipient)
);

create index if not exists jarvis_email_deliveries_status_idx
  on public.jarvis_email_deliveries (status, created_at desc);

alter table public.jarvis_email_deliveries enable row level security;
revoke all on public.jarvis_email_deliveries from anon, authenticated;
