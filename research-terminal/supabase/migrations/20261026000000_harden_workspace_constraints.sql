-- Server-side limits for the account workspace.
--
-- The application already validates every write, but the anon key is public and
-- PostgREST lets a signed-in user write their own rows directly. These
-- constraints make the caps and payload shapes hold even when the API route is
-- bypassed.
--
-- The product-events constraints are added as NOT VALID so an older row that
-- predates the route-level checks cannot block the migration. NOT VALID still
-- enforces the rule for every new insert and update.

-- Watchlists: at most 50 tickers per account.
--
-- A plain count-then-insert in the route can race two concurrent requests past
-- the cap, so take a per-user transaction lock before counting. The lock is
-- released automatically when the transaction ends.
create or replace function public.jarvis_enforce_watchlist_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  total integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('jarvis_watchlist:' || new.user_id::text, 0));
  select count(*) into total
  from public.jarvis_watchlist
  where user_id = new.user_id;

  if total >= 50 then
    raise exception 'A watchlist can hold at most 50 tickers.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists jarvis_watchlist_limit on public.jarvis_watchlist;
create trigger jarvis_watchlist_limit
  before insert on public.jarvis_watchlist
  for each row execute function public.jarvis_enforce_watchlist_limit();

-- Portfolios: one JSON array of at most 50 positions, bounded in size.
alter table public.jarvis_portfolios
  drop constraint if exists jarvis_portfolios_positions_array,
  drop constraint if exists jarvis_portfolios_positions_count,
  drop constraint if exists jarvis_portfolios_positions_size;

alter table public.jarvis_portfolios
  add constraint jarvis_portfolios_positions_array
    check (jsonb_typeof(positions) = 'array'),
  add constraint jarvis_portfolios_positions_count
    check (
      jsonb_array_length(
        case when jsonb_typeof(positions) = 'array' then positions else '[]'::jsonb end
      ) <= 50
    ),
  add constraint jarvis_portfolios_positions_size
    check (octet_length(positions::text) <= 65536);

-- Preferences: the visit snapshot is a small object, never an arbitrary blob.
alter table public.jarvis_user_preferences
  drop constraint if exists jarvis_user_preferences_snapshot_object,
  drop constraint if exists jarvis_user_preferences_snapshot_size;

alter table public.jarvis_user_preferences
  add constraint jarvis_user_preferences_snapshot_object
    check (jsonb_typeof(last_snapshot) = 'object'),
  add constraint jarvis_user_preferences_snapshot_size
    check (octet_length(last_snapshot::text) <= 4096);

-- Product events: keep the same shape the route enforces, including a bound on
-- metadata so direct inserts cannot bloat the analytics table.
alter table public.jarvis_product_events
  drop constraint if exists jarvis_product_events_page_path,
  drop constraint if exists jarvis_product_events_metadata_object,
  drop constraint if exists jarvis_product_events_metadata_size;

alter table public.jarvis_product_events
  add constraint jarvis_product_events_page_path
    check (char_length(page_path) between 1 and 180 and page_path like '/%') not valid,
  add constraint jarvis_product_events_metadata_object
    check (jsonb_typeof(metadata) = 'object') not valid,
  add constraint jarvis_product_events_metadata_size
    check (octet_length(metadata::text) <= 8192) not valid;
