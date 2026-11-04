# Quantamental Module — Technical & Financial Audit

Audit date: 3 November 2026
Scope: `lib/quantamental.ts`, `lib/idx-universe.ts`, `app/api/quantamental/route.ts`,
`components/QuantamentalMap.tsx`, `tests/quantamental.test.ts`, plus the directly used
`lib/upstream.ts`, `lib/rate-limit.ts`, `utils/supabase/server.ts`, `vercel.json`.
No other module was audited. This document records the state **before** the upgrade.

Live field availability was verified against the actual upstream endpoint
(`https://scanner.tradingview.com/indonesia/scan`) on the audit date. Claims marked
"verified" were reproduced with a direct request; claims marked "risk" are inferred
from code and are not proven failures.

---

## A. EXECUTIVE SUMMARY

The module is a well-engineered **relative-valuation scatter**, not a fundamental
screening system.

What it genuinely does today:

- Fetches one batch of 15 columns for a curated IDX universe.
- Builds a peer-relative valuation gap (X) from a single valuation multiple.
- Builds the vertical axis from **6-month price return** (`Perf.6M`).
- Classifies stocks into six price/valuation states and renders an SVG bubble map.
- Handles missing quotes honestly: names without a gap or momentum are excluded and
  counted, never zero-filled.

What it does **not** do:

- It does not measure fundamental momentum. `lib/quantamental.ts:270-277` sets
  `momentum = perf6m ?? perf3m`; `components/QuantamentalMap.tsx:553` labels that axis
  `6M PRICE MOMENTUM`. The quadrant names ("RE-RATING", "IMPROVING") therefore sound
  fundamental while being driven entirely by price.
- It has no revenue growth, earnings growth, margin trend, ROE/ROIC trend, FCF trend,
  balance-sheet trend, forward estimates, revisions, EV bridge, dividend yield, NAV,
  or historical valuation percentile.
- It stores no history. `app/api/quantamental/route.ts:25` keeps one in-process
  object with a 15-minute TTL. There is no database table, no snapshot, and no cron
  entry for this route in `vercel.json`.
- Its "as of" timestamp is the request time (`route.ts:146`), not the market-data
  time or the disclosure time.

**Verdict:** not reliable as an institutional screening tool in its current form.
The visual language is strong and the missing-data discipline is better than most
retail tools, but the analytical claim ("valuation vs fundamental momentum") is not
supported by the inputs. The gap between label and calculation is the critical issue,
because it can make a purely price-driven move look like a fundamental re-rating.

Severity totals: 4 critical, 7 high, 8 medium, 5 low.

---

## B. SYSTEM ARCHITECTURE

### Actual data flow

```
IDX_UNIVERSE (lib/idx-universe.ts, 5 names per curated sector)
        │
        ▼
buildQuantamentalUniverse()            lib/quantamental.ts:168-186
        │  tickers → IDX:<ticker>
        ▼
POST scanner.tradingview.com/indonesia/scan    app/api/quantamental/route.ts:55-110
        │  15 columns, one batch, 15s timeout, 2 attempts, cache: no-store
        ▼
QuantamentalRaw[]                      route.ts:90-106
        │
        ▼
buildQuantamentalMap()                 lib/quantamental.ts:264-376
        │  valuationFor → peer median → gap → price momentum → quadrant
        ▼
QuantamentalMap (in-process cache, TTL 15 min)   route.ts:25, 133-138
        │
        ▼
GET /api/quantamental                  auth + 30 req/min/user rate limit
        │
        ▼
components/QuantamentalMap.tsx         SVG scatter + readout
```

### Component inventory

| Layer | File | Responsibility |
|---|---|---|
| Universe | `lib/idx-universe.ts` | Curated ticker/name/sector list |
| Engine | `lib/quantamental.ts` | Basis selection, peer median, gap, momentum, quadrant, coverage |
| API | `app/api/quantamental/route.ts` | Auth, rate limit, scanner fetch, cache, stale fallback |
| UI | `components/QuantamentalMap.tsx` | SVG map, axes, quadrants, hover/readout, region select, capture |
| Tests | `tests/quantamental.test.ts` | 10 unit tests over the pure engine |
| Upstream | `lib/upstream.ts` | Timeout/retry wrapper |
| Rate limit | `lib/rate-limit.ts` | Supabase-backed buckets, in-memory fallback |

### Database, ingestion, scheduling

- **No Quantamental table exists.** `supabase/migrations/` contains weekly shortlist,
  workspace, analytics, rate-limit, email and research-paper tables only.
- **No ingestion pipeline.** The route is the pipeline: request → fetch → compute →
  return. Nothing is written down.
- **No scheduled refresh.** `vercel.json` declares exactly one cron,
  `/api/cron/weekly-picks`. Quantamental has none.
- **No external estimate/consensus provider.** Only the TradingView scanner.

### Dependency map (failure blast radius)

- Scanner down + cache warm → stale map (`route.ts:155-162`).
- Scanner down + cache cold → HTTP 503 with no map (`route.ts:163-170`).
- Supabase auth down → 401/500 from the outer catch (`route.ts:112-118, 172-178`).
- Any server restart or cold instance → cache is empty; a new scan is required.

This is a single-provider, single-instance-cache design. It is honest, but it cannot
support history, percentile, revision tracking, or change detection.

---

## C. DATA QUALITY & FRESHNESS

### Field-by-field (current module)

| Field | Source column | Used for | Refresh | Status |
|---|---|---|---|---|
| Price | `close` | Display, turnover | Per request, 15-min cache | Live |
| Daily change | `change` | **Nothing** | Per request | Fetched but unused |
| Market cap | `market_cap_basic` | Bubble size, P/S | Per request | Live |
| P/B | `price_book_fq` | Basis, P/B÷ROE | Per request | Live |
| P/E | `price_earnings_ttm` | Basis | Per request | Live (TTM) |
| ROE | `return_on_equity_fq` | P/B÷ROE | Per request | Live |
| Revenue | `total_revenue` | P/S | Per request | **Verified to equal latest FY revenue, not TTM** |
| Net income | `net_income` | Loss-maker test | Per request | **Verified to equal latest FY net income** |
| EPS diluted TTM | `earnings_per_share_diluted_ttm` | **Nothing** | Per request | Fetched but never mapped (`route.ts:90-106` omits it) |
| Sector | `sector` | Display only | Per request | Live; peers use curated sector instead |
| 3M return | `Perf.3M` | Momentum fallback | Per request | Live |
| 6M return | `Perf.6M` | **Vertical axis** | Per request | Live |
| 10D avg volume | `average_volume_10d_calc` | Liquidity | Per request | Live |
| Volume | `volume` | **Nothing** | Per request | Fetched but unused |
| Name | `name` | **Nothing** | Per request | Overwritten by curated name |

### Why the module feels "not consistently updated"

1. **No persistence.** Cache is one module-level variable. Any cold start rescans;
   any warm process can serve data up to 15 minutes old. There is no cross-instance
   coherence.
2. **No scheduled job.** Nothing refreshes overnight, after close, or after a
   disclosure. Freshness depends entirely on a user loading the page.
3. **`asOf` is misleading.** `route.ts:146` writes `new Date().toISOString()` at
   response build time. It is the fetch time, not the quote time or statement date.
   A stale upstream snapshot can be stamped as current.
4. **Staleness is only detected on transport failure.** `status: "stale"` is set only
   when `fetchScannerRows()` throws (`route.ts:155-162`). If the vendor returns old
   values successfully, the map reports `LIVE`.
5. **`partial` is row-count based.** `rows.length === universe.length` (`route.ts:147`)
   counts rows, not populated fields. A row of nulls still counts as coverage.
6. **Fundamental timestamps are absent.** No `earnings_release_date` is requested, so
   the UI cannot say when the statements behind a multiple were published.
7. **Silent field loss.** `numberValue()` returns `null` for non-numeric values with no
   logging, so a renamed vendor column degrades silently to "no valuation".

### Upstream fields verified available but unused

Verified with a live request on 3 Nov 2026 (BBCA/ADRO/TLKM sample):

`total_revenue_ttm`, `net_income_ttm`, `ebitda_ttm`, `ebit_ttm`,
`free_cash_flow_ttm`, `total_revenue_fy`, `net_income_fy`, `ebitda_fy`,
`free_cash_flow_fy`, `total_revenue_fq`, `net_income_fq`, `ebitda_fq`,
`free_cash_flow_fq`, `total_equity_fy`, `total_equity_fq`, `total_assets_fy`,
`total_assets_fq`, `total_liabilities_fy`, `total_liabilities_fq`, `total_debt_fq`,
`net_debt`, `enterprise_value_fq`, `return_on_invested_capital_fq`,
`debt_to_equity_fy`, `debt_to_equity_fq`, `gross_profit_fy`, `gross_profit_fq`,
`net_margin_fy`, `operating_margin_fy`, `ebitda_margin_fy`, `current_ratio`,
`total_shares_outstanding`, `dps_common_stock_prim_issue_fy`,
`earnings_per_share_diluted_fy`, `earnings_per_share_diluted_fq`,
`earnings_per_share_forecast_next_fy`, `earnings_release_date`,
`earnings_release_next_date`, `industry`, `price_sales`, `beta_1_year`.

Verified **unavailable** (returned null): all `*_yoy_growth` / `*_growth` columns,
`revenue_estimate_next_year`, `eps_estimate_next_year`,
`price_earnings_forward`, `ev_to_ebitda`, `ev_to_ebit`, `enterprise_value` (plain),
`dividend_yield`, `cash`, `cash_fq`, `inventory`, `total_equity` (plain),
`operating_income`, `shares_outstanding` (plain, but `total_shares_outstanding` works),
`gross_margin_fq`, `net_margin_fq`, `roic_fy`.

**Important consequence:** no prior-year column exists, so a true YoY growth rate is
not directly available. Growth must be computed as a **latest-quarter run-rate versus
the latest fiscal year** (`fq × 4 ÷ fy − 1`) or **TTM versus the latest fiscal year**,
and must be labelled as such. It must never be presented as YoY.

---

## D. FINANCIAL METHODOLOGY

### D1. Current valuation basis (`lib/quantamental.ts:199-227`)

```
Financials:  if pb > 0 and roe > 0  → metric = pb / roe      (P/B per ROE point)
             else if pb > 0          → metric = pb
             else                    → none
Non-financial: if pe > 0             → metric = pe (TTM)
             else if netIncome ≤ 0 and cap>0 and revenue>0 → metric = cap/revenue
             else if pb > 0          → metric = pb
             else if cap>0 and revenue>0 → metric = cap/revenue
             else                    → none
```

Gap: `(peerMedian / metric − 1) × 100` (`:311-313`). Positive = cheaper. This sign
convention is correct and unit-tested (`tests/quantamental.test.ts:70-86`).

### D2. Findings

| # | Finding | Evidence | Impact |
|---|---|---|---|
| V1 | **P/S uses FY revenue, not TTM** | Live probe: `total_revenue` equals `total_revenue_fy` for all three sampled names; route maps `total_revenue` (`route.ts:101`) | P/S is stale between annual reports and inconsistent with the TTM P/E used beside it |
| V2 | **No forward P/E** | `QUANTAMENTAL_COLUMNS` (`:85-101`) has no estimate column | Cannot measure whether expected earnings justify the price |
| V3 | **No EV/EBITDA or EV/EBIT** | No EV, debt, cash or EBITDA columns | Capital-structure-heavy names (telco, mining, utilities) are compared on equity multiples only |
| V4 | **No dividend yield** | No DPS or yield column | Income names look expensive with no offset for cash returned |
| V5 | **No NAV/discount** | No NAV, portfolio or holding-company inputs | Holding companies are valued on consolidated P/E, which is structurally misleading |
| V6 | **No historical percentile** | No stored series | "Cheap" means cheap vs today's peers, not vs its own history |
| V7 | **P/B ÷ ROE is non-standard** | `:210` | Internally consistent but units ("P/B per ROE point") are not comparable to published valuation; sensitive to ROE near zero |
| V8 | **Median only, no outlier guard** | `median()` `:192-197` | Median is robust, but no winsorisation of the metric itself; gap can explode and is then clamped at ±50% (`:252`) |
| V9 | **No share-count or EV reconciliation** | No `total_shares_outstanding` used | Relies entirely on vendor market cap; cannot detect share-count or ADR errors |
| V10 | **Loss-maker test uses FY net income** | `:218` | A company with a profitable recent quarter but a loss-making FY is still treated as a loss-maker, and vice versa |

### D3. Independent validation of the gap maths

For `CHEAP pe=10`, `MID pe=20`, `RICH pe=30`, peer median 20:

- CHEAP gap = (20/10 − 1)×100 = **+100%** → cheaper ✓
- MID gap = 0 ✓
- RICH gap = (20/30 − 1)×100 = **−33.33%** → richer ✓

The arithmetic is correct. The problem is not the arithmetic; it is the input and
the label.

---

## E. QUANTAMENTAL LOGIC

### E1. Peer construction (`:288-309`)

1. Group by `${curatedSector}::${basis}`.
2. If that group has ≥ 3 names, use its median.
3. Otherwise fall back to **all sectors** sharing the basis.
4. Otherwise `null` → `no-valuation`.

Findings:

| # | Finding | Evidence | Impact |
|---|---|---|---|
| P1 | Peer groups are tiny | `QUANTAMENTAL_SECTORS_PER_NAME = 5` (`:83`), universe builder caps 5/sector (`:168-186`); test asserts ≤ 5 (`tests:33-44`) | A 3-name median is not a peer benchmark |
| P2 | Curated sector overrides vendor sector | `route.ts:90-106` uses `entry.sector`; `tvSector` stored but unused | Coverage/classification depends on hand-maintained taxonomy |
| P3 | Cross-sector fallback mixes businesses | `:304-308` | If a sector has <3 same-basis names, a bank P/E can be compared to a retailer P/E |
| P4 | "Financials" is one bucket | `:206` | Banks, insurers, multifinance and fintech share a peer set |
| P5 | No size/liquidity screen inside the peer set | none | A micro-cap can set the median for a large-cap |
| P6 | No holding-company special case | none | Holdcos compared on consolidated multiples |

### E2. Vertical axis — the critical conflation

`:270-277`:

```ts
const perf6m = finite(row.perf6m);
const perf3m = finite(row.perf3m);
const momentum = perf6m ?? perf3m;
```

`components/QuantamentalMap.tsx:553` labels the axis `6M PRICE MOMENTUM`, yet the
panel header (`:415`) says "peer-relative valuation vs **price momentum**", while the
quadrants are named RE-RATING / VALUE TRAP / PRICED IN / DE-RATING (`:118-146`) —
language that reads as fundamental.

This is not a bug in the sense of wrong arithmetic. It is a **semantic mismatch**
between the investment question the module appears to answer and the data it uses.
A stock can be labelled "RE-RATING" purely because its price rose, with no change in
earnings, margins, or returns.

### E3. Classification (`:229-242`)

```
gap > +5  and momentum >= 0 → re-rating
gap > +5  and momentum <  0 → value-trap
gap < −5  and momentum >= 0 → priced-in
gap < −5  and momentum <  0 → de-rating
|gap| ≤ 5 and momentum >= 0 → improving
|gap| ≤ 5 and momentum <  0 → drifting
gap null                    → no-valuation
momentum null               → no-momentum
```

- Thresholds ±5% and 0% are **arbitrary**, with no distributional or backtested
  basis.
- `momentum >= 0` means exactly zero price return is classified as positive
  (`tests:96`).
- Six states are produced, not the four quadrants the product language implies.
- No confidence, no minimum peer count surfaced, no separation of "cheap for a
  reason".

### E4. Liquidity semantics

`thin = turnover !== null && turnover < 5bn` (`:325`). Therefore `turnover === null`
gives `thin === false`, and the UI renders full opacity (`QuantamentalMap.tsx:573`).
Unknown liquidity is displayed identically to confirmed liquid. Test `:129` locks
this behaviour in. This is a real presentation error: unknown should be a third state.

### E5. Coverage bookkeeping

`fundamentals` counts stocks with a gap; `momentum` counts price momentum; `both`
counts plotted. The names are misleading (`fundamentals` is really "has a valuation
gap"). Output is otherwise honest and does not zero-fill.

### E6. What is worth retaining

- The pure-engine split (`fetch in route`, `compute in lib`).
- The explicit `no-valuation` / `no-momentum` states.
- The sign convention for the gap.
- Symlog X positioning and clamping with an off-scale marker.
- Bubble size = market cap, shape = basis, opacity = liquidity.
- Coverage counts and the "not assigned a zero" copy.
- Accessibility (tab focus, aria labels), region select, capture, fullscreen.
- The test style: small pure assertions.

---

## F. CRITICAL FINDINGS (ranked)

### Critical — materially misleading signals

| ID | Finding | Evidence |
|---|---|---|
| C1 | **Vertical axis is price return, presented in fundamental language.** The map claims valuation vs fundamental momentum; Y is `Perf.6M`. | `lib/quantamental.ts:270-277`; `QuantamentalMap.tsx:415,553`; tests `:101-115` |
| C2 | **No fundamental momentum exists.** Zero of the six required inputs (earnings growth, revenue growth, margin, ROE/ROIC, FCF, balance sheet) influence position or classification. | Full read of `lib/quantamental.ts`; no such fields in `QUANTAMENTAL_COLUMNS` `:85-101` |
| C3 | **No historical snapshots.** Cannot reconstruct a prior map, compute a percentile, or audit a past classification. `asOf` is fetch time. | `route.ts:25,146`; no migration; no cron in `vercel.json` |
| C4 | **P/S uses stale FY revenue while price is live.** | Live probe; `route.ts:101`; `:219-225` |

### High — major reliability issues

| ID | Finding | Evidence |
|---|---|---|
| H1 | 15-minute in-process cache only; cold starts and multi-instance deployments diverge; no persistence. | `route.ts:22-25,133-138` |
| H2 | No scheduled refresh; freshness depends on user traffic. | `vercel.json` |
| H3 | Stale detection only on transport error; an old successful payload is labelled `LIVE`. | `route.ts:140-162` |
| H4 | Peer groups of 3–5 names, capped at 5/sector, with cross-sector fallback. | `:83,168-186,304-308` |
| H5 | `partial` is row-count based, not field-coverage based. | `route.ts:147` |
| H6 | `thin=false` for unknown turnover; unknown liquidity looks liquid. | `:325`; UI `:573`; test `:129` |
| H7 | No disclosure dates, so fundamental freshness is unknowable. | No `earnings_release_date` column |

### Medium — incomplete methodology

| ID | Finding | Evidence |
|---|---|---|
| M1 | No forward P/E, EV/EBITDA, EV/EBIT, dividend yield, NAV discount. | `:85-101` |
| M2 | No historical valuation percentile. | no storage |
| M3 | Arbitrary ±5% / 0% thresholds; six states instead of four quadrants. | `:81,229-242` |
| M4 | No sector-specific metric logic (bank NIM/NPL/CASA, mining unit cost, consumer volume, holdco NAV). | none |
| M5 | "Financials" is one peer bucket; banks vs insurers vs fintech not separated. | `:206` |
| M6 | Dead columns: `earnings_per_share_diluted_ttm`, `volume`, `change`, `name` fetched and unused; `tvSector` displayed but not used for peers. | `:85-101`; `route.ts:90-106` |
| M7 | No outlier treatment beyond the median; gap clamps at ±50%. | `:192-197,252` |
| M8 | No "what changed" diff between updates. | none |

### Low — technical / presentation

| ID | Finding | Evidence |
|---|---|---|
| L1 | `asOf` labelled WIB but derived from fetch time. | `route.ts:146`; UI `:445` |
| L2 | `momentum >= 0` treats exactly 0% as positive. | `:235-241` |
| L3 | Axis pointer copy says "price momentum" in aria-label and footer but quadrant copy implies fundamentals. | `:464,775` |
| L4 | No sector/basis/style filter; only region select. | `:418-424` |
| L5 | `capture()` omits new CSS vars if added later; currently fine. | `:310-328` |

---

## G. RECOMMENDED REMEDIATION

Priority: **P0** before the module can be called quantamental; **P1** required for
institutional use; **P2** quality.

| ID | Problem | Evidence | Implication | Correction | Files | Priority |
|---|---|---|---|---|---|---|
| C1/C2 | Price return is the Y axis | `quantamental.ts:270-277` | Misleading classification | Replace Y with a 0–100 fundamental momentum score; keep price momentum as a separate, clearly labelled field | `lib/quantamental.ts`, `components/QuantamentalMap.tsx` | P0 |
| C2 | No fundamental inputs | `:85-101` | No fundamental signal | Add verified FY/FQ/TTM statement columns, EV, debt, equity, FCF, EPS, estimates | `lib/quantamental.ts`, `app/api/quantamental/route.ts` | P0 |
| C4 | FY revenue in P/S | `route.ts:101` | Stale multiple | Use TTM revenue for P/S; expose `periodBasis` per metric | same | P0 |
| C3/H1 | No history | `route.ts:25` | No percentile, no audit | Add `jarvis_quantamental_snapshots` table, daily upsert, history endpoint | migration, route, cron | P0 |
| C3/H2 | No schedule | `vercel.json` | Stale by default | Add daily post-close cron; keep manual refresh | `vercel.json`, `app/api/cron/quantamental/route.ts` | P1 |
| H3 | Weak stale detection | `route.ts:155` | Old data labelled live | Age the payload from quote/statement metadata; label stale after threshold | route, engine | P1 |
| H5 | Row-count coverage | `route.ts:147` | False completeness | Compute per-field coverage; `partial` when key fields missing | engine | P1 |
| H6 | Unknown liquidity = liquid | `:325` | Visual misrepresentation | Add `liquidity: "known" \| "thin" \| "unknown"`; render unknown distinctly | engine, UI | P1 |
| H4/M5 | Weak peers | `:288-309` | Misleading medians | Sector profile + minimum peer count + expose peer set and count; no cross-sector fallback unless flagged | engine | P1 |
| M1 | Missing multiples | `:85-101` | Incomplete valuation | Add forward P/E, PBV, EV/EBITDA, EV/EBIT, dividend yield; NAV as provider-ready null | engine | P1 |
| M2 | No percentile | no storage | No own-history context | Percentile from stored snapshots once ≥ N observations | engine, history route | P2 |
| M3 | Arbitrary thresholds | `:81,229-242` | Unstable classification | Four quadrants on score 50 and gap 0, ±5 fair band as visual only; document thresholds | engine, UI | P2 |
| M4 | No sector logic | none | Banks/miners judged like industrials | Sector profile selects margin and balance-sheet measures | engine | P1 |
| M7 | Outliers | `:192` | Distorted gap | Winsorise metric at peer 5th/95th before gap; keep raw value | engine | P2 |
| M8 | No change view | none | No "why now" | Diff current vs previous stored snapshot | engine, route, UI | P1 |
| L1-L5 | Minor | see above | Polish | Fix copy, filters, third liquidity state | UI | P2 |

---

## H. IMPLEMENTATION ROADMAP

**Phase 0 — Foundations (P0)**
1. Add a snapshot migration with service-role-only access.
2. Extend the scanner columns to the verified statement/estimate set.
3. Build a pure fundamental-momentum engine with per-component provenance.
4. Build a multi-multiple valuation engine with explicit period basis.
5. Replace the Y axis with the score; keep price momentum separate.

**Phase 1 — Freshness and trust (P1)**
6. Persist a daily snapshot; add a post-close cron.
7. Add manual refresh, `asOf` from data, stale-age warnings, per-field coverage.
8. Add history read + valuation percentile.
9. Add "WHAT CHANGED?" via snapshot diff.
10. Add sector profiles for banks, mining, consumer, holding companies.

**Phase 2 — Peer and classification quality (P1/P2)**
11. Peer sets keyed by sector profile, minimum 3, expose count and members.
12. Winsorise outliers; flag thin peer groups.
13. Four-quadrant classification on score 50 / gap 0, with a fair-band visual.

**Phase 3 — Surface (P2)**
14. Filters (sector, basis, liquidity), date selection.
15. Stock detail with score breakdown, peer table, valuation history, revisions,
    price performance and classification reasons.
16. Accessibility, copy, and legend updates.
17. Tests for every new calculation, including missing-data paths.

**Explicit non-goals / unresolved inputs**
- Consensus *revision history* requires repeated estimate snapshots; until at least
  two snapshots exist, revision direction must be `null`, not inferred.
- NAV/holding-company discount requires portfolio holdings data that no current feed
  provides; expose as provider-ready `null`.
- True YoY growth requires a prior-year column that the provider does not expose;
  use latest-quarter run-rate vs latest FY and label it exactly that way.
- Bank NIM/NPL/CASA and mining unit costs/realised prices are not available from the
  scanner; do not fabricate. Use the available proxies and label them.

---

## Readiness assessment

| Capability | Ready? |
|---|---|
| Reconstruct a prior map | No |
| Track multiple changes | No |
| Fundamental momentum | No |
| Peer-relative valuation | Partially — arithmetic correct, peer set weak |
| Distinguish fundamental from price moves | No |
| Historical percentile | No |
| Backtest classifications | No — no point-in-time store |
| Survivorship bias | Present — universe is today's curated list, applied retroactively |
| Look-ahead bias | Not assessable; no history |
| Historical overwriting | Not applicable yet; nothing is stored |
