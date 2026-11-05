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

`/api/v1`, stock detail, search, quantamental, analytics events, and feedback use a shared
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

### Quantamental stock map

`QUANTAMENTAL` is a decision-support scatter of the curated IDX universe. The
horizontal axis is the peer-relative valuation gap (positive means cheaper); the
vertical axis is a 0–100 **fundamental momentum score**. Price momentum is shown
separately and never enters the score or the quadrant.

**Fundamental momentum** (`lib/quantamental.ts`, `buildFundamentalMomentum`)
weights earnings growth 25%, revenue growth 20%, margin expansion 20%, ROE/ROIC
improvement 15%, FCF improvement 10% and balance-sheet improvement 10%. Each
component scores 0–100 from a fixed input band, and the final score is
`Σ(componentScore × weight) ÷ Σ(availableWeight)`, so contributions add up to the
score. A component with no input is removed from the denominator, not treated as
zero. A score needs at least two components and ≥50% weight coverage; otherwise
it is `null` and the name is listed as "no fundamental score" rather than plotted
at zero.

**Growth basis.** The upstream scanner exposes latest fiscal year, latest quarter
and TTM statements, but no prior-year column, so true YoY growth is unavailable.
Growth is computed as the latest-quarter run-rate versus the latest fiscal year
(`fq × 4 ÷ fy − 1`), or TTM versus the latest FY as a fallback, and is labelled
exactly that way in the UI and score detail. EPS growth blends this with forward
consensus EPS versus TTM EPS (45% weight) when a forward estimate exists.

**Sector logic.** `sectorProfileFor` selects a model: banks use net margin, ROE
and equity/assets (deposits are funding, not leverage, so D/E is not used);
mining uses EBITDA margin, revenue and net leverage; consumer prefers gross
margin where reported, then net margin; holding companies use consolidated
measures with NAV discount exposed as provider-ready `null` because no holdings
feed exists; everything else uses the general mix.

**Valuation engine.** Per name it computes trailing P/E, forward P/E, P/BV,
P/B ÷ ROE, EV/EBITDA, EV/EBIT, dividend yield and P/S, each with its period basis
and peer median. The plotted gap uses the basis implied by the financial profile:
financials use P/B per ROE point, profitable non-financials use trailing P/E,
loss-makers use P/S on TTM revenue, and P/B is the fallback. P/B ÷ ROE peer
medians are restricted to financials so industrial names cannot move a bank
median. NAV discount is provider-ready only and is never estimated.

**Classification.** Four quadrants split on score 50 and gap 0: Undervalued +
Improving, Expensive + Improving, Cheap + Deteriorating, Expensive + Deteriorating.
A ±5% fair band is drawn as a visual guide; names inside it classify as improving
or drifting rather than as a strong mispricing. Every stock carries its
classification reasons.

**Freshness and history.** `GET /api/quantamental` is authenticated and rate
limited. It fetches the universe in one TradingView scanner request and caches
for 15 minutes. `?refresh=1` bypasses the cache; `?date=YYYY-MM-DD` returns a
stored point-in-time snapshot, never a recomputation. `asOf` is when the response
was built and `dataAsOf` is the newest fundamental disclosure date in the
payload. A failed refresh keeps the last successful map and labels it `stale`;
with no successful map it returns `503`.

Snapshots are stored in `jarvis_quantamental_snapshots` (service-role only,
unique per `trade_date` + `methodology_version`), created by
`supabase/migrations/20261103000000_quantamental_snapshots.sql`. The cron
`/api/cron/quantamental` runs at 10:30 UTC (17:30 WIB) Monday–Friday and requires
`CRON_SECRET`; it refuses to store a snapshot when the scan fails. History powers
the own-history valuation percentile (needs ≥5 observations), estimate-revision
direction (needs ≥2 stored estimate snapshots — otherwise `null`, never
inferred), and the WHAT CHANGED diff against the prior snapshot.

Bubbles are sized by market cap; shape encodes the valuation basis; opacity
encodes liquidity (liquid, thin, or unknown — unknown is not rendered as liquid);
an outline encodes revision direction when it is known. Missing inputs are never
zero-filled: names without a comparable gap or score appear in explicit
"no gap" / "no score" lists.

### Swing setup engine

The live scanner (`GET /api/swing-setups`) reads price through the **EMA25/EMA50
ribbon**, not the old 20/50/200 stack. The ribbon is `bull` (price above EMA25
above EMA50), `bear` (below both), `recovery` (above both but EMA25 still below
EMA50), `rollover` (below both but EMA25 still above EMA50) or `compression`
(price inside the band). The nearest EMA below price is the base support and the
nearest above is the base resistance, so the same band flips between support and
resistance as price moves. Structural stops use EMA25.

The 200-day average is kept as a **long-term risk filter**, not a trend read:
breakouts and pullbacks require price above SMA200, momentum needs a bull ribbon
above SMA200, and shorts require price below SMA200. A missing SMA200 leaves the
filter unavailable rather than blocking the setup. Pullbacks are limited to
−2.5%…+1.5% around EMA25 with RSI 45–60, and momentum is capped at 12% above
EMA25 to avoid chasing.

The setup score is a ridge model re-fitted on the ribbon features with
`pnpm fit-score -- --years=3 --limit=100`. On the 2026 out-of-sample slice
(802 candidates) it separates the best quintile (R ≈ 0.00) from the worst
(R ≈ −0.43); a 60-name replay over 2026 returned +7.2% with a 1.64 profit factor
and −2.4% max drawdown, versus +1.0%, 1.04 and −2.8% for the pre-ribbon model.
That is one market regime and a small sample, not a promise of future returns.
The transparent heuristic remains available as `legacyScore` for comparison.

### Weekly Picks

The weekly module applies the JARVIS integrated framework to the setups that
already pass the technical scanner. Weights are fixed at **fundamental quality
25% · technical strength 25% · quantitative signals 20% · valuation 15% ·
catalysts & positioning 15%** (`lib/weekly-intelligence.ts`).

- **Technical** blends the live setup score (65%) with structure checks (35%):
  EMA25/EMA50 as the stock's ribbon and base support/resistance band, RSI,
  relative volume, distance from the EMA25 base, and proximity to the one-month
  high/low. The ribbon reads `bull` (price above EMA25 above EMA50), `bear`
  (price below EMA25 below EMA50), `recovery` (above both but EMA25 still below
  EMA50), `rollover` (below both but EMA25 still above EMA50) or `compression`
  (price inside the band). EMA25 is the first support in a stacked uptrend and
  EMA50 the base support; below both, they become the resistance a recovery must
  clear. This weekly layer does not reuse the scanner's old 20/50 trend read; the
  scanner keeps the ribbon plus SMA200 as a long-term risk filter. The setup score
  is the ribbon re-fit described in the Swing setup engine section.
- **Fundamental** reuses the Quantamental fundamental-momentum score and its
  sector profile; **valuation** reuses the peer gap and own-history percentile.
- **Quantitative** uses 3M/6M price momentum, volume anomaly, session move and
  estimate revisions when they exist. Price momentum is not fundamental momentum.
- **Catalysts** uses dated earnings, revision direction, liquidity and the macro
  overlay. No event is invented.

A component with no input is marked `unavailable` and its weight leaves the
denominator. The JARVIS score is `Σ(score × weight) ÷ Σ(availableWeight)` and
requires at least two available components and ≥50% weight coverage; otherwise
the score is `null` and the stance is `WATCH`. A **BUY** additionally needs a
JARVIS score ≥70, a technical score ≥55 and a verified fundamental component;
below 55 is **AVOID**. The Friday lock excludes AVOID names, records only the
available components, and keeps the stored technical `score` unchanged so the
existing lifecycle and backtest thresholds still apply. WATCH names are recorded
at 0% weight, so cash remains a valid outcome. Both the admin Friday POST and the
scheduled `/api/cron/weekly-picks` job apply the same integrated layer; if the
fundamental map cannot be fetched at lock time, the run falls back to the
technical screen and stores that fallback in the candidate reason rather than
inventing fundamentals.

`GET /api/quantamental?scope=full` scans all 236 `IDX_UNIVERSE` tickers so the
weekly technical shortlist never loses a name to the curated 5-per-sector cap.
Full-scope responses use their own 15-minute cache and are **never persisted**;
only the curated map writes snapshots. The UI states the as-of date, the newest
disclosure date, the fundamental-map status and the macro exposure, and each pick
expands to show component evidence, catalysts, risks and explicit data gaps.



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

`/api/cron/quantamental` runs at **10:30 UTC, Monday–Friday** (17:30 WIB), after
the IDX close. It uses the same `CRON_SECRET` bearer check, builds the map from
the live scanner, and upserts one snapshot per trade date and methodology
version so history accumulates even on days nobody opens the module.
`?dryRun=1` builds the map without writing. If the scan fails or the snapshot
cannot be stored it reports an error instead of fabricating a row.

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

A scheduled workflow (`.github/workflows/backtest.yml`) re-runs the 60-name,
2-year replay and the clean out-of-sample slice on the 1st of every month. It
publishes both tables to the Actions run summary and keeps the raw output as a
365-day artifact. The score is not re-fitted automatically: after a manual
`pnpm fit-score`, update `OOS_FROM` in that workflow to the new training split.

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
