create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  user_email text,
  category text not null check (category in ('BUG', 'DATA', 'FEATURE', 'OTHER')),
  message text not null check (char_length(message) between 10 and 1200),
  section text not null default 'UNKNOWN',
  ticker text,
  page_url text,
  contact_ok boolean not null default true,
  status text not null default 'new' check (status in ('new', 'reviewing', 'resolved'))
);

create index if not exists feedback_created_at_idx on public.feedback (created_at desc);
create index if not exists feedback_status_idx on public.feedback (status);

alter table public.feedback enable row level security;

drop policy if exists "Authenticated users can submit feedback" on public.feedback;
create policy "Authenticated users can submit feedback"
on public.feedback for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Admins can read feedback" on public.feedback;
create policy "Admins can read feedback"
on public.feedback for select
to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "Admins can update feedback" on public.feedback;
create policy "Admins can update feedback"
on public.feedback for update
to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
