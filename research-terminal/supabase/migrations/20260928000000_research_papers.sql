create table if not exists public.research_papers (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 140),
  summary text check (summary is null or char_length(summary) <= 500),
  sector text check (sector is null or char_length(sector) <= 60),
  published_on date not null default current_date,
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null,
  file_size bigint not null check (file_size > 0 and file_size <= 20971520),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

alter table public.research_papers enable row level security;

drop policy if exists "Authenticated users can read research papers" on public.research_papers;
create policy "Authenticated users can read research papers"
on public.research_papers for select
to authenticated
using (true);

drop policy if exists "Admins can publish research papers" on public.research_papers;
create policy "Admins can publish research papers"
on public.research_papers for insert
to authenticated
with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' and created_by = auth.uid());

drop policy if exists "Admins can update research papers" on public.research_papers;
create policy "Admins can update research papers"
on public.research_papers for update
to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "Admins can delete research papers" on public.research_papers;
create policy "Admins can delete research papers"
on public.research_papers for delete
to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'research-papers',
  'research-papers',
  false,
  20971520,
  array['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Authenticated users can read research files" on storage.objects;
create policy "Authenticated users can read research files"
on storage.objects for select
to authenticated
using (bucket_id = 'research-papers');

drop policy if exists "Admins can upload research files" on storage.objects;
create policy "Admins can upload research files"
on storage.objects for insert
to authenticated
with check (bucket_id = 'research-papers' and (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "Admins can update research files" on storage.objects;
create policy "Admins can update research files"
on storage.objects for update
to authenticated
using (bucket_id = 'research-papers' and (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
with check (bucket_id = 'research-papers' and (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "Admins can delete research files" on storage.objects;
create policy "Admins can delete research files"
on storage.objects for delete
to authenticated
using (bucket_id = 'research-papers' and (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
