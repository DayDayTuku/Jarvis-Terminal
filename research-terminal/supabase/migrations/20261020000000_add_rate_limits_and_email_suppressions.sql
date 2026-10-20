-- Shared rate-limit buckets for serverless instances.
create table if not exists public.jarvis_rate_limits (
  bucket text primary key,
  count integer not null default 0,
  reset_at timestamptz not null
);

create index if not exists jarvis_rate_limits_reset_at_idx
  on public.jarvis_rate_limits (reset_at);

alter table public.jarvis_rate_limits enable row level security;
revoke all on public.jarvis_rate_limits from anon, authenticated;
grant all on public.jarvis_rate_limits to service_role;

-- Atomic compare-and-increment. Safe across concurrent instances; the caller
-- only needs service-role access.
create or replace function public.jarvis_rate_limit_hit(
  p_bucket text,
  p_limit integer,
  p_window_seconds integer
)
returns table (allowed boolean, remaining integer, reset_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_count integer;
  v_reset timestamptz;
begin
  insert into public.jarvis_rate_limits as r (bucket, count, reset_at)
  values (p_bucket, 1, v_now + make_interval(secs => p_window_seconds))
  on conflict (bucket) do update
    set count = case when r.reset_at <= v_now then 1 else r.count + 1 end,
        reset_at = case when r.reset_at <= v_now then v_now + make_interval(secs => p_window_seconds) else r.reset_at end
  returning r.count, r.reset_at into v_count, v_reset;

  -- Opportunistic cleanup so IP/user buckets do not grow forever.
  if random() < 0.01 then
    delete from public.jarvis_rate_limits where reset_at < v_now - interval '1 day';
  end if;

  return query select v_count <= p_limit, greatest(p_limit - v_count, 0), v_reset;
end;
$$;

revoke all on function public.jarvis_rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.jarvis_rate_limit_hit(text, integer, integer) to service_role;

-- Email suppression list, populated by one-click unsubscribe and Resend
-- bounce/complaint webhooks.
create table if not exists public.jarvis_email_suppressions (
  email text primary key,
  reason text not null,
  created_at timestamptz not null default now()
);

alter table public.jarvis_email_suppressions enable row level security;
revoke all on public.jarvis_email_suppressions from anon, authenticated;
grant all on public.jarvis_email_suppressions to service_role;
