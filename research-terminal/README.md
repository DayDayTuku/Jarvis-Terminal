# Jarvis Research Terminal

A personal macro and IDX research terminal. It combines macro regimes, market
signals, geopolitical risk, natural hazards, portfolio stress tests, a weekly
picks workflow, and research notes in one focused workspace.

## Stack

- **Next.js 16** (App Router) + **React 19**
- **Supabase** for authentication, Postgres, and row-level security
- **Vercel Cron** for the weekday weekly-picks job
- **Resend** for optional Weekly Picks and market-alert email
- **Tailwind CSS 4** with app-level CSS in `app/globals.css`
- Upstream data: Yahoo Finance, FRED, CFTC, GDELT, GDACS, Trading Economics,
  EODHD, and TradingView's public scanner

## Requirements

- Node.js **22.13+**
- pnpm **10**
- A Supabase project (for auth and the weekly-picks tables)

## Quick start

```bash
pnpm install
cp .env.example .env.local
# fill in the Supabase values, then:
pnpm dev
```

Open <http://localhost:3000>. Unauthenticated visitors are redirected to
`/access`, where they can create an account or sign in. Sign-up is open by
design; free accounts are not added to any email list.

### Supabase setup

1. Create a project at <https://supabase.com>.
2. Apply the migrations, either with the Supabase CLI:

   ```bash
   supabase link --project-ref <project-ref>
   supabase db push
   ```

   or by running every file in `supabase/migrations/` in filename order from the
   SQL editor.
3. Copy the project URL, anon key, and service-role key into `.env.local`.
4. Keep email confirmation enabled if you want digest recipients to be verified.
5. To access admin features (`/admin/analytics`, research-paper publishing,
   feedback triage, weekly locking), grant the `admin` app role:

   ```sql
   update auth.users
   set raw_app_meta_data =
     coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
   where email = 'you@example.com';
   ```

   Sign out and back in so the new JWT contains the role.

### Weekly Picks email opt-in

There are two recipient groups:

- Addresses in `JARVIS_EMAIL_TO` always receive the digest.
- Signed-in users receive it only after they explicitly enable **Weekly Picks**
  in **Settings** and have a confirmed email address. The preference is stored
  in Supabase `user_metadata.weekly_picks_opt_in`; no migration is needed.

Market-close stop/target alerts use the same recipient list. Email is disabled
when `RESEND_API_KEY` is unset.

### Unsubscribe and bounces

Every digest and alert includes a signed one-click unsubscribe link and the
`List-Unsubscribe` headers. Unsubscribing writes the address to
`jarvis_email_suppressions` and clears `weekly_picks_opt_in` where an account
exists. To also suppress hard bounces and complaints, point a Resend webhook at
`/api/webhooks/resend` and set `RESEND_WEBHOOK_SECRET` to its Svix secret.

### Rate limits

`/api/v1`, stock detail, search, analytics events, and feedback use a shared
Postgres limiter (`jarvis_rate_limit_hit`). Buckets are hashed, expire
automatically, and fall back to a per-instance limiter if the database is
unavailable during a deployment. The migration in
`supabase/migrations/20261020000000_add_rate_limits_and_email_suppressions.sql`
creates both the limiter and the suppression list.

### Personal workspace sync

Watchlists, portfolios, thesis notes, accessibility preferences, onboarding state,
and the compact "since last visit" snapshot are stored per account:

| Table | Purpose |
| --- | --- |
| `jarvis_watchlist` | Ticker list, one row per ticker |
| `jarvis_portfolios` | One saved portfolio with a JSONB positions array |
| `jarvis_notes` | Append-only thesis history (latest 20 shown in the drawer) |
| `jarvis_user_preferences` | Color scheme, onboarding flag, last visit snapshot |

All tables use row-level security scoped to `auth.uid()`. The migration is
`supabase/migrations/20261022000000_add_user_workspace.sql`. If it has not been
applied, the APIs return `503` and the browser keeps a local fallback so the
terminal still works.

Authenticated workspace endpoints:

- `GET/POST/DELETE /api/watchlist`
- `GET /api/watchlist/quotes` (prices for saved tickers; private, uncached)
- `GET/PUT /api/portfolio`
- `GET/POST/DELETE /api/notes`
- `GET/PUT /api/preferences`

Writes are rate limited. Notes are capped at 2,000 characters, portfolios at 50
positions, and watchlists at 50 tickers. The caps for watchlists, portfolio
payloads, visit snapshots, and event metadata are also enforced in Postgres by
`supabase/migrations/20261026000000_harden_workspace_constraints.sql`, because a
signed-in client can otherwise write its own rows directly through PostgREST and
skip the API checks. If the watchlist write fails, the row is reverted rather
than left looking saved and the panel footer reports local-only state instead of
claiming the account is in sync.

### Plans and pricing

`/pricing` is public. Free access stays open; Pro and Desk tiers are scaffolded
for workflow depth, exports, alerts, and white-label/team use. Checkout is not
wired until a provider is selected. Set `NEXT_PUBLIC_UPGRADE_URL` to a checkout
URL to enable the Pro CTA, and `NEXT_PUBLIC_SALES_EMAIL` to enable the Desk
contact link. Current plan is read from `user_metadata.plan` (`free`, `pro`, or
`desk`). Existing research features are not hard-paywalled.

Product analytics now includes activation and pricing events
(`onboarding_complete`, `watchlist_add`, `portfolio_save`, `note_save`,
`pricing_view`, `upgrade_click`, and others) in the same migration.

### Data honesty

Production panels never substitute synthetic values for a failed feed. The
global data-status bar reports each connection as live, partial, stale, or
offline. Unavailable macro, market, calendar, seasonality, and COT panels are
withheld or show an explicit unavailable state. The only remaining placeholder
surface is the starter watchlist when a user has not saved any tickers; ticker
prices still require the live market feed.

### Cron

`vercel.json` schedules `/api/cron/weekly-picks` at **09:30 UTC, Monday–Friday**
(16:30 WIB). The route requires `Authorization: Bearer $CRON_SECRET`; Vercel
adds this automatically for cron invocations when `CRON_SECRET` is configured.

The cron route calls the production scanner at
`https://jarvisfinance.my.id/api/swing-setups` using
`JARVIS_READONLY_API_KEY`. A `?dryRun=1` request returns the scan result without
writing a run or sending email.

## Environment variables

See `.env.example` for placeholders. Summary:

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Browser auth client |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes for cron/admin APIs | Server-side database access; never expose to the browser |
| `CRON_SECRET` | Yes for cron | Bearer token for `/api/cron/*` |
| `JARVIS_READONLY_API_KEY` | Recommended | Read-only access to `/api/v1` and the internal scanner bypass |
| `JARVIS_V1_ALLOWED_ORIGIN` | Optional | Browser origin allowed to call `/api/v1` |
| `NEXT_PUBLIC_SITE_URL` | Production | Canonical metadata/OG URL |
| `RESEND_API_KEY` | Optional | Sends digests and alerts; email is skipped when empty |
| `JARVIS_EMAIL_FROM` | Optional | Verified Resend sender |
| `JARVIS_EMAIL_TO` | Optional | Owner recipients, comma-separated |
| `EMAIL_UNSUBSCRIBE_SECRET` | Optional | Signs unsubscribe links; falls back to `CRON_SECRET` |
| `RESEND_WEBHOOK_SECRET` | Optional | Svix secret for Resend bounce/complaint webhooks |
| `FRED_API_KEY` | Optional | Uses the FRED API; otherwise the keyless CSV fallback |
| `EODHD_API_TOKEN` | Optional | Adds EODHD fundamentals to stock detail |
| `TRADING_ECONOMICS_API_KEY` | Optional | Economic calendar |
| `NEXT_PUBLIC_UPGRADE_URL` | Optional | Checkout URL for the Pro plan CTA |
| `NEXT_PUBLIC_SALES_EMAIL` | Optional | Contact address for Desk/white-label enquiries |
| `JARVIS_SHORT_ELIGIBLE` | Optional | Comma-separated tickers allowed in the short overlay |

Never commit `.env.local` or a service-role key.

## Scripts

```bash
pnpm dev        # local development
pnpm build      # production build
pnpm start      # serve the production build
pnpm lint       # ESLint
pnpm test       # node:test suite (160+ tests)
pnpm smoke      # boots the production build and checks headers + auth gates
pnpm backtest   # macro-overlay backtest (requires network access)
pnpm fit-score  # score-model fitting helper
```

CI runs type checking (app and tests), lint, the unit tests, and a production
build on every push and pull request (`.github/workflows/ci.yml`). Dependabot
checks npm and GitHub Actions weekly.

## Project layout

```
app/                  App Router pages and API routes
  api/                Data, auth-protected, cron, and public v1 endpoints
  access/             Sign-in / sign-up gate
  pricing/            Public plan comparison and upgrade CTAs
  admin/analytics/    Admin-only product analytics
components/           Dashboard panels, modals, and settings
lib/                  Models, lifecycle logic, upstream fetch wrapper, email rules
proxy.ts              Route protection and auth bypass policy
supabase/migrations/  Database schema and RLS policies
tests/                node:test suites
scripts/              Backtest and score-fitting helpers
public/               PWA icons, manifest, and service worker assets
```

## Security notes

- `proxy.ts` protects application routes. Public paths (`/access`, `/_next/*`,
  `/api/cron/*`, `/api/v1/*`, `/api/email/unsubscribe`, `/api/webhooks/resend`,
  and PWA assets) authenticate themselves.
- Missing service keys are filtered out, so an absent secret can never create a
  literal `Bearer undefined` bypass.
- `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, and `RESEND_API_KEY` must stay
  server-side. Only `NEXT_PUBLIC_*` values reach the browser.
- The service worker is registered in production only, so local development
  never serves stale cached shells. It caches only public assets and `/access`;
  authenticated dashboards are never written to Cache Storage.
- Security headers (CSP, HSTS, frame denial, permissions policy) are configured
  in `next.config.ts`.
- Dashboard sections render inside an error boundary, so one failing panel does
  not blank the terminal.
- Research notes, the watchlist, and the color palette persist locally in the
  browser. Notes are not sent to the server.
