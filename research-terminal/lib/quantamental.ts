/**
 * Quantamental stock map — v2 calculation engine.
 *
 * Pure by design: the API route only fetches and maps upstream rows, everything
 * that decides a number lives here so it can be unit tested.
 *
 * Two deliberate rules govern this file:
 *
 * 1. Price momentum and fundamental momentum are different quantities. The map's
 *    vertical axis is the fundamental score; `momentum` remains 3M/6M price return
 *    and is never mixed into the score.
 * 2. A missing input produces `null`, never zero. A component that cannot be
 *    calculated is marked unavailable and its weight is removed from the
 *    denominator. If less than half the weight is available there is no score.
 *
 * Growth inputs are limited by the upstream feed: it exposes latest fiscal year,
 * latest quarter and TTM statements, but no prior-year column. Growth is therefore
 * a latest-quarter run-rate versus the last fiscal year (or TTM versus the last
 * fiscal year) and is labelled as such everywhere. It is not a YoY growth rate.
 */

import { IDX_UNIVERSE, type IDXStock } from "./idx-universe";

export type QuantamentalBasis = "pb_roe" | "pe" | "ps" | "pb" | "none";

export type QuantamentalQuadrant =
  | "re-rating"
  | "priced-in"
  | "value-trap"
  | "de-rating"
  | "improving"
  | "drifting"
  | "no-momentum"
  | "no-valuation";

export type QuantamentalSectorProfile = "bank" | "mining" | "consumer" | "holding" | "general";

export type QuantamentalLiquidity = "liquid" | "thin" | "unknown";

export type QuantamentalRevision = "up" | "down" | "flat" | null;

export type ValuationMetricKey =
  | "pe_trailing"
  | "pe_forward"
  | "pbv"
  | "pb_roe"
  | "ev_ebitda"
  | "ev_ebit"
  | "dividend_yield"
  | "ps"
  | "nav_discount";

export type ValuationMetric = {
  key: ValuationMetricKey;
  label: string;
  value: number | null;
  unit: "x" | "%";
  period: string;
  peerMedian: number | null;
  peerCount: number;
  providerReady: boolean;
};

export type MomentumComponentKey =
  | "earnings"
  | "revenue"
  | "margin"
  | "returns"
  | "cashflow"
  | "balance";

export type MomentumComponent = {
  key: MomentumComponentKey;
  label: string;
  weight: number;
  value: number | null;
  unit: "percent" | "pp" | "ratio";
  score: number | null;
  contribution: number | null;
  status: "available" | "unavailable";
  periodBasis: string;
  detail: string;
};

export type FundamentalMomentum = {
  score: number | null;
  coverage: number;
  confidence: "high" | "medium" | "low" | "none";
  components: MomentumComponent[];
  sectorProfile: QuantamentalSectorProfile;
  notes: string[];
};

export type QuantamentalUniverseEntry = {
  ticker: string;
  name: string;
  sector: string;
};

export type QuantamentalRaw = {
  ticker: string;
  name: string;
  sector: string;
  tvSector: string | null;
  industry?: string | null;
  close: number | null;
  change: number | null;
  marketCap: number | null;
  pb: number | null;
  pe: number | null;
  roe: number | null;
  roic?: number | null;
  revenue: number | null;
  netIncome: number | null;
  perf3m: number | null;
  perf6m: number | null;
  avgVolume10d: number | null;
  // Statement history — all optional so an older payload still builds.
  revenueTtm?: number | null;
  netIncomeTtm?: number | null;
  ebitdaTtm?: number | null;
  ebitTtm?: number | null;
  fcfTtm?: number | null;
  revenueFy?: number | null;
  netIncomeFy?: number | null;
  ebitdaFy?: number | null;
  fcfFy?: number | null;
  grossProfitFy?: number | null;
  equityFy?: number | null;
  assetsFy?: number | null;
  liabilitiesFy?: number | null;
  debtFy?: number | null;
  epsFy?: number | null;
  revenueFq?: number | null;
  netIncomeFq?: number | null;
  ebitdaFq?: number | null;
  fcfFq?: number | null;
  grossProfitFq?: number | null;
  equityFq?: number | null;
  assetsFq?: number | null;
  liabilitiesFq?: number | null;
  debtFq?: number | null;
  epsFq?: number | null;
  epsTtm?: number | null;
  epsForward?: number | null;
  dividendPerShare?: number | null;
  enterpriseValue?: number | null;
  netDebt?: number | null;
  earningsReleaseDate?: string | null;
  nextEarningsDate?: string | null;
};

export type QuantamentalStock = QuantamentalRaw & {
  basis: QuantamentalBasis;
  metric: number | null;
  peerMedian: number | null;
  peerCount: number;
  peers: string[];
  gap: number | null;
  priceMomentum: number | null;
  /**
   * Backwards-compatible alias of `priceMomentum`. The Research Desk consumes
   * `momentum`; keeping it as price return is intentional and explicit.
   */
  momentum: number | null;
  momentumBasis: "6M" | "3M" | null;
  fundamentalScore: number | null;
  momentumScore: FundamentalMomentum;
  valuation: ValuationMetric[];
  valuationPercentile: number | null;
  historyObservations: number;
  revisionDirection: QuantamentalRevision;
  liquidity: QuantamentalLiquidity;
  thin: boolean;
  nearMedian: boolean;
  quadrant: QuantamentalQuadrant;
  classificationReasons: string[];
  whatChanged: QuantamentalChange[];
  turnover: number | null;
  offScaleX: boolean;
  offScaleY: boolean;
};

export type QuantamentalChange = {
  label: string;
  current: number | null;
  previous: number | null;
  delta: number | null;
  unit: "percent" | "pp" | "score" | "x";
};

export type QuantamentalStatus = "live" | "stale" | "partial";

export type QuantamentalCoverage = {
  fundamentals: number;
  momentum: number;
  both: number;
  valuation: number;
  fundamentalScore: number;
  forwardEstimates: number;
  statements: number;
};

export type QuantamentalMap = {
  status: QuantamentalStatus;
  asOf: string;
  dataAsOf: string | null;
  methodologyVersion: string;
  universeSize: number;
  plotted: number;
  noMomentum: number;
  noValuation: number;
  quadrantCounts: Record<
    Exclude<QuantamentalQuadrant, "no-momentum" | "no-valuation">,
    number
  >;
  coverage: QuantamentalCoverage;
  sectorProfiles: Record<QuantamentalSectorProfile, number>;
  stocks: QuantamentalStock[];
  methodology: string;
  historyDates: string[];
  changeSummary: { improved: number; deteriorated: number; unchanged: number; unavailable: number };
};

export const QUANTAMENTAL_X_DOMAIN = 50;
/** Retained for payload compatibility; the Y axis is now the 0–100 score. */
export const QUANTAMENTAL_MOMENTUM_MIN = -50;
export const QUANTAMENTAL_MOMENTUM_MAX = 200;
export const QUANTAMENTAL_FAIR_BAND = 5;
export const QUANTAMENTAL_SCORE_SPLIT = 50;
export const THIN_TURNOVER_IDR = 5_000_000_000;
export const QUANTAMENTAL_SECTORS_PER_NAME = 5;
export const QUANTAMENTAL_MIN_HISTORY = 5;
export const QUANTAMENTAL_METHODOLOGY_VERSION = "v2";

export const QUANTAMENTAL_COLUMNS = [
  "name",
  "close",
  "change",
  "volume",
  "market_cap_basic",
  "price_book_fq",
  "price_earnings_ttm",
  "return_on_equity_fq",
  "return_on_invested_capital_fq",
  "total_revenue",
  "net_income",
  "earnings_per_share_diluted_ttm",
  "sector",
  "industry",
  "Perf.3M",
  "Perf.6M",
  "average_volume_10d_calc",
  "total_revenue_ttm",
  "net_income_ttm",
  "ebitda_ttm",
  "ebit_ttm",
  "free_cash_flow_ttm",
  "total_revenue_fy",
  "net_income_fy",
  "ebitda_fy",
  "free_cash_flow_fy",
  "gross_profit_fy",
  "total_equity_fy",
  "total_assets_fy",
  "total_liabilities_fy",
  "total_debt",
  "total_debt_fq",
  "earnings_per_share_diluted_fy",
  "total_revenue_fq",
  "net_income_fq",
  "ebitda_fq",
  "free_cash_flow_fq",
  "gross_profit_fq",
  "total_equity_fq",
  "total_assets_fq",
  "total_liabilities_fq",
  "earnings_per_share_diluted_fq",
  "earnings_per_share_forecast_next_fy",
  "dps_common_stock_prim_issue_fy",
  "enterprise_value_fq",
  "net_debt",
  "debt_to_equity_fq",
  "debt_to_equity_fy",
  "total_shares_outstanding",
  "earnings_release_date",
  "earnings_release_next_date",
] as const;

export const BASIS_META: Record<
  QuantamentalBasis,
  { short: string; label: string; shape: "circle" | "diamond" | "triangle" | "square" | "none" }
> = {
  pe: { short: "P/E", label: "Profitable non-financial · trailing P/E", shape: "circle" },
  pb_roe: { short: "P/B ÷ ROE", label: "Financial · P/B per ROE point", shape: "diamond" },
  ps: { short: "P/S", label: "Sales multiple · market cap / TTM revenue", shape: "triangle" },
  pb: { short: "P/B", label: "P/B fallback · no earnings multiple or ROE near zero", shape: "square" },
  none: { short: "—", label: "No comparable valuation basis", shape: "none" },
};

export const QUADRANT_META: Record<
  QuantamentalQuadrant,
  { label: string; short: string; note: string; tone: "positive" | "negative" | "blue" | "muted" }
> = {
  "re-rating": {
    label: "UNDERVALUED + IMPROVING",
    short: "RE-RATING",
    note: "Cheaper than peers · fundamental momentum improving",
    tone: "positive",
  },
  "priced-in": {
    label: "EXPENSIVE + IMPROVING",
    short: "PRICED IN",
    note: "Richer than peers · fundamentals improving",
    tone: "blue",
  },
  "value-trap": {
    label: "CHEAP + DETERIORATING",
    short: "VALUE TRAP",
    note: "Cheaper than peers · fundamentals deteriorating",
    tone: "negative",
  },
  "de-rating": {
    label: "EXPENSIVE + DETERIORATING",
    short: "DE-RATING",
    note: "Richer than peers · fundamentals deteriorating",
    tone: "negative",
  },
  improving: {
    label: "FAIR VALUE + IMPROVING",
    short: "IMPROVING",
    note: "Near peer median · fundamentals improving",
    tone: "positive",
  },
  drifting: {
    label: "FAIR VALUE + DETERIORATING",
    short: "DRIFTING",
    note: "Near peer median · fundamentals deteriorating",
    tone: "muted",
  },
  "no-momentum": {
    label: "NO FUNDAMENTAL SIGNAL",
    short: "NO SIGNAL",
    note: "Valuation available · too few statement inputs for a score",
    tone: "muted",
  },
  "no-valuation": {
    label: "NO COMPARABLE GAP",
    short: "NO GAP",
    note: "No peer-relative valuation could be computed",
    tone: "muted",
  },
};

export const SECTOR_PROFILE_META: Record<
  QuantamentalSectorProfile,
  { label: string; metrics: string }
> = {
  bank: {
    label: "BANK",
    metrics: "Net margin, ROE, equity/assets as the capital proxy. D/E is not used: deposits are funding, not leverage.",
  },
  mining: {
    label: "MINING",
    metrics: "Revenue run-rate, EBITDA margin, FCF and net leverage. Realised prices and unit costs are not in the feed.",
  },
  consumer: {
    label: "CONSUMER",
    metrics: "Revenue run-rate, gross margin where reported, net margin, FCF and leverage. Volume and inventory are not in the feed.",
  },
  holding: {
    label: "HOLDING",
    metrics: "Consolidated revenue, margin, ROE and leverage. NAV discount is provider-ready only: no holdings feed exists.",
  },
  general: {
    label: "GENERAL",
    metrics: "Revenue, earnings, margin, returns, FCF and leverage.",
  },
};

const VALUATION_META: Record<
  ValuationMetricKey,
  { label: string; unit: "x" | "%"; period: string; providerReady: boolean }
> = {
  pe_trailing: { label: "P/E trailing", unit: "x", period: "TTM", providerReady: false },
  pe_forward: { label: "P/E forward", unit: "x", period: "Next FY consensus EPS", providerReady: false },
  pbv: { label: "P/BV", unit: "x", period: "Latest quarter book value", providerReady: false },
  pb_roe: { label: "P/B ÷ ROE", unit: "x", period: "Latest quarter", providerReady: false },
  ev_ebitda: { label: "EV / EBITDA", unit: "x", period: "Latest quarter EV · TTM EBITDA", providerReady: false },
  ev_ebit: { label: "EV / EBIT", unit: "x", period: "Latest quarter EV · TTM EBIT", providerReady: false },
  dividend_yield: { label: "Dividend yield", unit: "%", period: "Latest FY DPS · current price", providerReady: false },
  ps: { label: "P/S", unit: "x", period: "TTM revenue", providerReady: false },
  nav_discount: { label: "NAV discount", unit: "%", period: "Requires a holdings feed", providerReady: true },
};

export const QUANTAMENTAL_METHODOLOGY =
  "Peer-relative valuation versus fundamental momentum. The x-axis is the valuation gap (peer median ÷ stock metric − 1) × 100; positive means cheaper. The y-axis is a 0–100 fundamental momentum score built from earnings 25%, revenue 20%, margin 20%, ROE/ROIC 15%, FCF 10% and balance sheet 10%. Because the feed has no prior-year column, growth is the latest-quarter run-rate versus the latest fiscal year (or TTM versus the latest fiscal year), not a YoY rate; it is labelled as such. Missing inputs remove their weight from the denominator and are never treated as zero. A score requires at least half the weight and two components. Price momentum is shown separately and never affects the score or quadrant. Valuation uses P/E trailing, forward P/E, P/BV, EV/EBITDA, EV/EBIT and dividend yield where the inputs exist; NAV discount is provider-ready only. The ±5% fair band is a guide, not a statistical threshold. Thin means 10-day turnover below IDR 5bn; unknown turnover is labelled unknown, not liquid.";

const WEIGHTS: Record<MomentumComponentKey, number> = {
  earnings: 25,
  revenue: 20,
  margin: 20,
  returns: 15,
  cashflow: 10,
  balance: 10,
};

function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function positive(value: number | null | undefined): number | null {
  const number = finite(value);
  return number !== null && number > 0 ? number : null;
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** First N names per sector, in the curated universe order. */
export function buildQuantamentalUniverse(
  limitPerSector = QUANTAMENTAL_SECTORS_PER_NAME,
): QuantamentalUniverseEntry[] {
  const counts = new Map<string, number>();
  const seen = new Set<string>();
  const entries: QuantamentalUniverseEntry[] = [];

  for (const stock of IDX_UNIVERSE as IDXStock[]) {
    const ticker = stock.ticker.replace(/\.JK$/i, "").toUpperCase();
    if (!ticker || seen.has(ticker)) continue;
    const used = counts.get(stock.sector) ?? 0;
    if (used >= limitPerSector) continue;
    counts.set(stock.sector, used + 1);
    seen.add(ticker);
    entries.push({ ticker, name: stock.name, sector: stock.sector });
  }

  return entries;
}

export function tradingViewSymbol(ticker: string): string {
  return `IDX:${ticker.replace(/\.JK$/i, "").toUpperCase()}`;
}

export function median(values: number[]): number | null {
  const valid = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!valid.length) return null;
  const middle = Math.floor(valid.length / 2);
  return valid.length % 2 ? valid[middle] : (valid[middle - 1] + valid[middle]) / 2;
}

/** Symmetric log position for the valuation gap. -1 is the left edge, 1 the right. */
export function symlogFraction(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const clamped = Math.max(-QUANTAMENTAL_X_DOMAIN, Math.min(QUANTAMENTAL_X_DOMAIN, value));
  const scale = 5;
  return Math.asinh(clamped / scale) / Math.asinh(QUANTAMENTAL_X_DOMAIN / scale);
}

export function sectorProfileFor(row: Pick<QuantamentalRaw, "sector" | "tvSector" | "industry">): QuantamentalSectorProfile {
  const haystack = `${row.sector} ${row.tvSector ?? ""} ${row.industry ?? ""}`.toLowerCase();
  if (/bank|financial services|insurance|multifinance|fintech/.test(haystack)
    && !/non-bank/.test(haystack)) {
    if (/bank/.test(haystack)) return "bank";
  }
  if (/bank/.test(haystack)) return "bank";
  if (/coal|mining|metal|gold|nickel|energy minerals|oil|gas/.test(haystack)) return "mining";
  if (/consumer|retail|food|beverage|tobacco|household|personal care|apparel/.test(haystack)) return "consumer";
  if (/holding|investment|conglomerate/.test(haystack)) return "holding";
  return "general";
}

/**
 * Percent change that handles negative bases without claiming a turnaround is
 * an infinite ratio. A swing from loss to profit scores +100, profit to loss −100.
 */
export function ratioDelta(current: number | null | undefined, base: number | null | undefined): number | null {
  const now = finite(current);
  const then = finite(base);
  if (now === null || then === null) return null;
  if (then === 0) return null;
  if (then > 0) {
    if (now > 0) return ((now - then) / then) * 100;
    return -100;
  }
  if (now < 0) return ((Math.abs(then) - Math.abs(now)) / Math.abs(then)) * 100;
  return 100;
}

function linearScore(value: number | null, low: number, high: number): number | null {
  if (value === null) return null;
  const fraction = (value - low) / (high - low);
  return Math.max(0, Math.min(100, fraction * 100));
}

function blend(parts: Array<{ value: number | null; weight: number }>): number | null {
  let total = 0;
  let weight = 0;
  for (const part of parts) {
    if (part.value === null) continue;
    total += part.value * part.weight;
    weight += part.weight;
  }
  return weight ? total / weight : null;
}

function margin(netIncome: number | null | undefined, revenue: number | null | undefined): number | null {
  const profit = finite(netIncome);
  const sales = positive(revenue);
  return profit !== null && sales !== null ? (profit / sales) * 100 : null;
}

function grossMargin(grossProfit: number | null | undefined, revenue: number | null | undefined): number | null {
  const gross = finite(grossProfit);
  const sales = positive(revenue);
  return gross !== null && sales !== null ? (gross / sales) * 100 : null;
}

type ComponentInput = {
  key: MomentumComponentKey;
  label: string;
  value: number | null;
  unit: MomentumComponent["unit"];
  low: number;
  high: number;
  periodBasis: string;
  detail: string;
};

function component(input: ComponentInput, totalWeight: number): MomentumComponent {
  const score = input.value === null ? null : linearScore(input.value, input.low, input.high);
  return {
    key: input.key,
    label: input.label,
    weight: WEIGHTS[input.key],
    value: input.value === null ? null : round(input.value, 2),
    unit: input.unit,
    score: score === null ? null : round(score, 1),
    contribution: score === null ? null : round((score * WEIGHTS[input.key]) / totalWeight, 1),
    status: score === null ? "unavailable" : "available",
    periodBasis: input.periodBasis,
    detail: input.detail,
  };
}

function buildComponents(row: QuantamentalRaw, profile: QuantamentalSectorProfile): ComponentInput[] {
  const revenueRunRate = ratioDelta(
    row.revenueFq !== null && row.revenueFq !== undefined ? row.revenueFq * 4 : null,
    row.revenueFy,
  );
  const revenueTtmDelta = ratioDelta(row.revenueTtm, row.revenueFy);
  const revenueValue = revenueRunRate ?? revenueTtmDelta;

  const earningsRunRate = ratioDelta(
    row.netIncomeFq !== null && row.netIncomeFq !== undefined ? row.netIncomeFq * 4 : null,
    row.netIncomeFy,
  );
  const earningsTtmDelta = ratioDelta(row.netIncomeTtm, row.netIncomeFy);
  const epsForwardDelta = ratioDelta(row.epsForward, row.epsTtm ?? row.epsFy);
  const earningsValue = blend([
    { value: earningsRunRate, weight: 0.55 },
    { value: epsForwardDelta, weight: 0.45 },
  ]) ?? earningsTtmDelta;

  const netMarginFq = margin(row.netIncomeFq, row.revenueFq);
  const netMarginFy = margin(row.netIncomeFy, row.revenueFy);
  const ebitdaMarginFq = margin(row.ebitdaFq, row.revenueFq);
  const ebitdaMarginFy = margin(row.ebitdaFy, row.revenueFy);
  const grossMarginFq = grossMargin(row.grossProfitFq, row.revenueFq);
  const grossMarginFy = grossMargin(row.grossProfitFy, row.revenueFy);

  const netMarginDelta = netMarginFq !== null && netMarginFy !== null ? netMarginFq - netMarginFy : null;
  const ebitdaMarginDelta = ebitdaMarginFq !== null && ebitdaMarginFy !== null ? ebitdaMarginFq - ebitdaMarginFy : null;
  const grossMarginDelta = grossMarginFq !== null && grossMarginFy !== null ? grossMarginFq - grossMarginFy : null;

  let marginValue: number | null;
  let marginDetail: string;
  if (profile === "mining") {
    marginValue = ebitdaMarginDelta ?? netMarginDelta;
    marginDetail = "EBITDA margin, latest quarter less latest FY; net margin fallback.";
  } else if (profile === "consumer") {
    marginValue = grossMarginDelta ?? netMarginDelta;
    marginDetail = "Gross margin, latest quarter less latest FY; net margin fallback.";
  } else if (profile === "bank") {
    marginValue = netMarginDelta;
    marginDetail = "Net margin, latest quarter less latest FY. NIM is not in the feed.";
  } else {
    marginValue = blend([
      { value: ebitdaMarginDelta, weight: 1 },
      { value: netMarginDelta, weight: 1 },
    ]);
    marginDetail = "EBITDA and net margin, latest quarter less latest FY.";
  }

  const roeFy = (() => {
    const profit = finite(row.netIncomeFy);
    const equity = positive(row.equityFy);
    return profit !== null && equity !== null ? (profit / equity) * 100 : null;
  })();
  const roeNow = finite(row.roe);
  const roeDelta = roeNow !== null && roeFy !== null ? roeNow - roeFy : null;
  const roaNow = (() => {
    const profit = finite(row.netIncomeTtm);
    const assets = positive(row.assetsFq) ?? positive(row.assetsFy);
    return profit !== null && assets !== null ? (profit / assets) * 100 : null;
  })();
  const roaFy = (() => {
    const profit = finite(row.netIncomeFy);
    const assets = positive(row.assetsFy);
    return profit !== null && assets !== null ? (profit / assets) * 100 : null;
  })();
  const roaDelta = roaNow !== null && roaFy !== null ? roaNow - roaFy : null;
  const returnsValue = blend([
    { value: roeDelta, weight: 2 },
    { value: roaDelta, weight: 1 },
  ]);

  const fcfRunRate = ratioDelta(
    row.fcfFq !== null && row.fcfFq !== undefined ? row.fcfFq * 4 : null,
    row.fcfFy,
  );
  const fcfTtmDelta = ratioDelta(row.fcfTtm, row.fcfFy);
  const fcfValue = fcfRunRate ?? fcfTtmDelta;

  let balanceValue: number | null;
  let balanceDetail: string;
  let balanceBasis: string;
  if (profile === "bank") {
    const equityAssetsFq = (() => {
      const equity = finite(row.equityFq);
      const assets = positive(row.assetsFq);
      return equity !== null && assets !== null ? (equity / assets) * 100 : null;
    })();
    const equityAssetsFy = (() => {
      const equity = finite(row.equityFy);
      const assets = positive(row.assetsFy);
      return equity !== null && assets !== null ? (equity / assets) * 100 : null;
    })();
    balanceValue = equityAssetsFq !== null && equityAssetsFy !== null
      ? ((equityAssetsFq - equityAssetsFy) / Math.max(0.01, Math.abs(equityAssetsFy))) * 100
      : null;
    balanceBasis = "Equity/assets, latest quarter versus latest FY";
    balanceDetail = "Capital ratio proxy. Debt/equity is not used for banks: deposits are funding, not leverage.";
  } else {
    const leverageFq = (() => {
      const debt = finite(row.debtFq);
      const equity = positive(row.equityFq);
      return debt !== null && equity !== null ? debt / equity : null;
    })();
    const leverageFy = (() => {
      const debt = finite(row.debtFy);
      const equity = positive(row.equityFy);
      return debt !== null && equity !== null ? debt / equity : null;
    })();
    balanceValue = leverageFq !== null && leverageFy !== null && leverageFy > 0
      ? (-(leverageFq - leverageFy) / leverageFy) * 100
      : null;
    balanceBasis = "Debt/equity, latest quarter versus latest FY";
    balanceDetail = "Positive means lower leverage. A falling ratio is an improvement.";
  }

  return [
    {
      key: "earnings",
      label: "Earnings momentum",
      value: earningsValue,
      unit: "percent",
      low: -20,
      high: 20,
      periodBasis: "Q run-rate vs FY · forward EPS vs TTM",
      detail: "Latest-quarter net income annualised versus latest FY net income (55%), forward consensus EPS versus TTM EPS (45%). TTM-vs-FY fallback.",
    },
    {
      key: "revenue",
      label: "Revenue momentum",
      value: revenueValue,
      unit: "percent",
      low: -20,
      high: 20,
      periodBasis: "Q run-rate vs FY",
      detail: "Latest-quarter revenue annualised versus latest FY revenue. TTM-vs-FY fallback.",
    },
    {
      key: "margin",
      label: "Margin expansion",
      value: marginValue,
      unit: "pp",
      low: -4,
      high: 4,
      periodBasis: "Latest quarter vs latest FY",
      detail: marginDetail,
    },
    {
      key: "returns",
      label: "ROE / ROIC improvement",
      value: returnsValue,
      unit: "pp",
      low: -4,
      high: 4,
      periodBasis: "Current vs latest FY",
      detail: "Current ROE versus FY net income ÷ FY equity (67%), ROA delta (33%). ROIC is reported on the stock but not used as a delta because FY ROIC is unavailable.",
    },
    {
      key: "cashflow",
      label: "FCF improvement",
      value: fcfValue,
      unit: "percent",
      low: -30,
      high: 30,
      periodBasis: "Q run-rate vs FY · TTM fallback",
      detail: "Latest-quarter free cash flow annualised versus latest FY free cash flow.",
    },
    {
      key: "balance",
      label: "Balance-sheet improvement",
      value: balanceValue,
      unit: "ratio",
      low: -25,
      high: 25,
      periodBasis: balanceBasis,
      detail: balanceDetail,
    },
  ];
}

export function buildFundamentalMomentum(row: QuantamentalRaw): FundamentalMomentum {
  const profile = sectorProfileFor(row);
  const components = buildComponents(row, profile).map((item) => component(item, 100));
  const availableWeight = components
    .filter((item) => item.status === "available")
    .reduce((sum, item) => sum + item.weight, 0);
  const coverage = availableWeight / 100;
  const availableCount = components.filter((item) => item.status === "available").length;
  const weighted = components.reduce((sum, item) => sum + (item.score ?? 0) * item.weight, 0);
  const score = coverage >= 0.5 && availableCount >= 2 && availableWeight > 0
    ? round(weighted / availableWeight, 1)
    : null;
  for (const item of components) {
    item.contribution = score === null || item.score === null
      ? null
      : round((item.score * item.weight) / availableWeight, 1);
  }
  const confidence: FundamentalMomentum["confidence"] = score === null
    ? "none"
    : coverage >= 0.85
      ? "high"
      : coverage >= 0.55
        ? "medium"
        : "low";
  const notes: string[] = [];
  if (coverage < 0.5 || availableCount < 2) {
    notes.push("Too few statement inputs for a score. The name is not plotted on the fundamental axis and is not assigned zero.");
  }
  if (coverage < 0.85 && score !== null) {
    notes.push(`Score uses ${Math.round(coverage * 100)}% of the configured weight. Unavailable components are excluded, not zero-filled.`);
  }
  notes.push("Growth is a latest-quarter run-rate versus the latest fiscal year, not a prior-year comparison.");
  if (profile === "bank") notes.push(SECTOR_PROFILE_META.bank.metrics);
  if (profile === "mining") notes.push(SECTOR_PROFILE_META.mining.metrics);
  if (profile === "consumer") notes.push(SECTOR_PROFILE_META.consumer.metrics);
  if (profile === "holding") notes.push(SECTOR_PROFILE_META.holding.metrics);

  return { score, coverage: round(coverage, 3), confidence, components, sectorProfile: profile, notes };
}

function valuationMetrics(row: QuantamentalRaw): Record<ValuationMetricKey, number | null> {
  const close = positive(row.close);
  const marketCap = positive(row.marketCap);
  const netIncomeTtm = finite(row.netIncomeTtm) ?? finite(row.netIncome);
  const revenueTtm = positive(row.revenueTtm) ?? positive(row.revenue);
  const ebitdaTtm = finite(row.ebitdaTtm);
  const ebitTtm = finite(row.ebitTtm);
  const enterpriseValue = positive(row.enterpriseValue);
  const pb = positive(row.pb);
  const roe = finite(row.roe);
  const epsForward = positive(row.epsForward);
  const dividendPerShare = finite(row.dividendPerShare);

  const peTrailing = positive(row.pe)
    ?? (marketCap !== null && netIncomeTtm !== null && netIncomeTtm > 0 ? marketCap / netIncomeTtm : null);
  const peForward = close !== null && epsForward !== null ? close / epsForward : null;
  const pbv = pb ?? (marketCap !== null && positive(row.equityFq) !== null
    ? marketCap / (positive(row.equityFq) as number)
    : null);
  const pbRoe = pb !== null && roe !== null && roe > 0 ? pb / roe : null;
  const evEbitda = enterpriseValue !== null && ebitdaTtm !== null && ebitdaTtm > 0
    ? enterpriseValue / ebitdaTtm
    : null;
  const evEbit = enterpriseValue !== null && ebitTtm !== null && ebitTtm > 0
    ? enterpriseValue / ebitTtm
    : null;
  const dividendYield = close !== null && dividendPerShare !== null
    ? (dividendPerShare / close) * 100
    : null;
  const ps = marketCap !== null && revenueTtm !== null ? marketCap / revenueTtm : null;

  return {
    pe_trailing: peTrailing,
    pe_forward: peForward,
    pbv,
    pb_roe: pbRoe,
    ev_ebitda: evEbitda,
    ev_ebit: evEbit,
    dividend_yield: dividendYield,
    ps,
    nav_discount: null,
  };
}

export function valuationBasisFor(
  row: QuantamentalRaw,
  metrics: Record<ValuationMetricKey, number | null> = valuationMetrics(row),
): { basis: QuantamentalBasis; metric: number | null } {
  const financial = sectorProfileFor(row) === "bank" || row.sector === "Financials";
  const pb = finite(row.pb);
  const roe = finite(row.roe);
  const pe = metrics.pe_trailing;
  const netIncome = finite(row.netIncomeTtm) ?? finite(row.netIncome);

  if (financial) {
    if (pb !== null && pb > 0 && roe !== null && roe > 0) return { basis: "pb_roe", metric: pb / roe };
    if (pb !== null && pb > 0) return { basis: "pb", metric: pb };
    return { basis: "none", metric: null };
  }

  if (pe !== null && pe > 0) return { basis: "pe", metric: pe };

  const lossMaking = netIncome !== null && netIncome <= 0;
  if (lossMaking && metrics.ps !== null && metrics.ps > 0) return { basis: "ps", metric: metrics.ps };
  if (pb !== null && pb > 0) return { basis: "pb", metric: pb };
  if (metrics.ps !== null && metrics.ps > 0) return { basis: "ps", metric: metrics.ps };
  return { basis: "none", metric: null };
}

const BASIS_METRIC: Record<Exclude<QuantamentalBasis, "none">, ValuationMetricKey> = {
  pe: "pe_trailing",
  pb_roe: "pb_roe",
  ps: "ps",
  pb: "pbv",
};

function peerValues(
  entries: Array<{ row: QuantamentalRaw; metrics: Record<ValuationMetricKey, number | null> }>,
): {
  bySector: Map<string, Map<ValuationMetricKey, number[]>>;
  global: Map<ValuationMetricKey, number[]>;
} {
  const bySector = new Map<string, Map<ValuationMetricKey, number[]>>();
  const global = new Map<ValuationMetricKey, number[]>();
  for (const entry of entries) {
    const sector = entry.row.sector;
    if (!bySector.has(sector)) bySector.set(sector, new Map());
    const sectorMap = bySector.get(sector) as Map<ValuationMetricKey, number[]>;
    for (const [key, value] of Object.entries(entry.metrics) as Array<[ValuationMetricKey, number | null]>) {
      if (value === null || !Number.isFinite(value) || value <= 0) continue;
      // P/B ÷ ROE is a financial-sector ratio. Letting an industrial name with a
      // positive P/B and ROE enter this peer set would silently move the median
      // that banks are measured against, so it is restricted at the source.
      if (key === "pb_roe" && sectorProfileFor(entry.row) !== "bank" && entry.row.sector !== "Financials") continue;
      if (!sectorMap.has(key)) sectorMap.set(key, []);
      (sectorMap.get(key) as number[]).push(value);
      if (!global.has(key)) global.set(key, []);
      (global.get(key) as number[]).push(value);
    }
  }
  return { bySector, global };
}

function peerStat(
  key: ValuationMetricKey,
  sector: string,
  peers: ReturnType<typeof peerValues>,
): { median: number | null; count: number; sameSector: boolean } {
  const sectorValues = peers.bySector.get(sector)?.get(key) ?? [];
  if (sectorValues.length >= 3) {
    return { median: median(sectorValues), count: sectorValues.length, sameSector: true };
  }
  const globalValues = peers.global.get(key) ?? [];
  if (globalValues.length >= 3) {
    return { median: median(globalValues), count: globalValues.length, sameSector: false };
  }
  return { median: null, count: sectorValues.length, sameSector: false };
}

function percentileOf(value: number, series: number[]): number | null {
  if (!Number.isFinite(value) || series.length < QUANTAMENTAL_MIN_HISTORY) return null;
  const below = series.filter((item) => Number.isFinite(item) && item <= value).length;
  return round((below / series.length) * 100, 1);
}

export type BuildQuantamentalOptions = {
  asOf?: string;
  dataAsOf?: string | null;
  status?: QuantamentalStatus;
  /** Curated universe size; defaults to the number of rows supplied. */
  universeSize?: number;
  /** Primary-metric history per ticker, oldest to newest. */
  history?: Record<string, number[]>;
  /** Forward-EPS history per ticker, oldest to newest. */
  revisionHistory?: Record<string, number[]>;
  /** Previous map, used to build the WHAT CHANGED diff. */
  previous?: QuantamentalMap | null;
  historyDates?: string[];
};

function revisionFrom(series: number[] | undefined): QuantamentalRevision {
  if (!series || series.length < 2) return null;
  const previous = series[series.length - 2];
  const current = series[series.length - 1];
  if (!Number.isFinite(previous) || !Number.isFinite(current) || previous === 0) return null;
  const change = (current - previous) / Math.abs(previous);
  if (Math.abs(change) < 0.0025) return "flat";
  return change > 0 ? "up" : "down";
}

export function classifyQuadrant(
  gap: number | null,
  score: number | null,
): QuantamentalQuadrant {
  if (gap === null) return "no-valuation";
  if (score === null) return "no-momentum";
  const improving = score >= QUANTAMENTAL_SCORE_SPLIT;
  if (Math.abs(gap) <= QUANTAMENTAL_FAIR_BAND) {
    return improving ? "improving" : "drifting";
  }
  if (gap > QUANTAMENTAL_FAIR_BAND) {
    return improving ? "re-rating" : "value-trap";
  }
  return improving ? "priced-in" : "de-rating";
}

function change(
  label: string,
  current: number | null,
  previous: number | null,
  unit: QuantamentalChange["unit"],
): QuantamentalChange {
  return {
    label,
    current,
    previous,
    delta: current !== null && previous !== null ? round(current - previous, 2) : null,
    unit,
  };
}

function buildChanges(
  stock: Pick<QuantamentalStock, "fundamentalScore" | "gap" | "valuation" | "priceMomentum" | "revisionDirection">,
  previous: QuantamentalStock | undefined,
): QuantamentalChange[] {
  if (!previous) return [];
  const metric = (key: ValuationMetricKey) => stock.valuation.find((item) => item.key === key)?.value ?? null;
  const priorMetric = (key: ValuationMetricKey) => previous.valuation.find((item) => item.key === key)?.value ?? null;
  const components: QuantamentalChange[] = [
    change("Fundamental score", stock.fundamentalScore, previous.fundamentalScore, "score"),
    change("Valuation gap", stock.gap, previous.gap, "percent"),
    change("P/E trailing", metric("pe_trailing"), priorMetric("pe_trailing"), "x"),
    change("EV/EBITDA", metric("ev_ebitda"), priorMetric("ev_ebitda"), "x"),
    change("Price momentum 6M", stock.priceMomentum, previous.priceMomentum, "percent"),
  ];
  return components.filter((item) => item.current !== null || item.previous !== null);
}

export function buildQuantamentalMap(
  rows: QuantamentalRaw[],
  options: BuildQuantamentalOptions = {},
): QuantamentalMap {
  const prepared = rows.map((row) => {
    const metrics = valuationMetrics(row);
    const valuation = valuationBasisFor(row, metrics);
    const momentumScore = buildFundamentalMomentum(row);
    const perf6m = finite(row.perf6m);
    const perf3m = finite(row.perf3m);
    const priceMomentum = perf6m ?? perf3m;
    const momentumBasis: QuantamentalStock["momentumBasis"] = perf6m !== null
      ? "6M"
      : perf3m !== null
        ? "3M"
        : null;
    const turnover = (() => {
      const volume = finite(row.avgVolume10d);
      const close = finite(row.close);
      return volume !== null && close !== null && volume > 0 && close > 0
        ? volume * close
        : null;
    })();
    return { row, metrics, valuation, momentumScore, priceMomentum, momentumBasis, turnover };
  });

  const peers = peerValues(prepared.map((item) => ({ row: item.row, metrics: item.metrics })));
  const previousByTicker = new Map((options.previous?.stocks ?? []).map((stock) => [stock.ticker, stock]));

  const stocks: QuantamentalStock[] = prepared.map((item) => {
    const { row, metrics, valuation, momentumScore, priceMomentum, momentumBasis, turnover } = item;
    const primaryKey = valuation.basis === "none" ? null : BASIS_METRIC[valuation.basis];
    const stat = primaryKey ? peerStat(primaryKey, row.sector, peers) : { median: null, count: 0, sameSector: false };
    const peerMedian = stat.median;
    const peerTickers = primaryKey
      ? prepared
        .filter((entry) => entry.row.sector === row.sector
          && entry.metrics[primaryKey] !== null
          && (entry.metrics[primaryKey] as number) > 0)
        .map((entry) => entry.row.ticker)
      : [];

    const gap = valuation.metric !== null && valuation.metric > 0 && peerMedian !== null && peerMedian > 0
      ? round((peerMedian / valuation.metric - 1) * 100, 2)
      : null;

    const history = options.history?.[row.ticker] ?? [];
    const valuationPercentile = valuation.metric !== null ? percentileOf(valuation.metric, history) : null;

    const valuationMetricsList: ValuationMetric[] = (Object.keys(VALUATION_META) as ValuationMetricKey[]).map((key) => {
      const meta = VALUATION_META[key];
      const metricStat = peerStat(key, row.sector, peers);
      return {
        key,
        label: meta.label,
        value: metrics[key] === null ? null : round(metrics[key] as number, key === "dividend_yield" ? 2 : 2),
        unit: meta.unit,
        period: meta.period,
        peerMedian: metricStat.median === null ? null : round(metricStat.median, 2),
        peerCount: metricStat.count,
        providerReady: meta.providerReady,
      };
    });

    const liquidity: QuantamentalLiquidity = turnover === null
      ? "unknown"
      : turnover < THIN_TURNOVER_IDR
        ? "thin"
        : "liquid";

    const quadrant = classifyQuadrant(gap, momentumScore.score);
    const reasons: string[] = [];
    if (gap !== null) {
      reasons.push(
        `Valuation gap ${gap >= 0 ? "+" : ""}${gap.toFixed(1)}% versus the ${stat.sameSector ? row.sector : "cross-sector"} ${BASIS_META[valuation.basis].short} median${peerMedian === null ? "" : ` of ${round(peerMedian, 2)}`} (${stat.count} peers).`,
      );
    } else {
      reasons.push("No peer-relative valuation gap: the basis is unavailable or fewer than three comparable names exist.");
    }
    if (momentumScore.score !== null) {
      reasons.push(
        `Fundamental momentum ${momentumScore.score.toFixed(0)}/100 (${momentumScore.confidence} confidence, ${Math.round(momentumScore.coverage * 100)}% weight coverage), driven by ${momentumScore.components
          .filter((part) => part.status === "available")
          .sort((a, b) => (b.contribution ?? 0) - (a.contribution ?? 0))
          .slice(0, 2)
          .map((part) => `${part.label.toLowerCase()} ${part.value === null ? "—" : `${part.value >= 0 ? "+" : ""}${part.value}${part.unit === "pp" ? "pp" : "%"}`}`)
          .join(" and ")}.`,
      );
    } else {
      reasons.push("No fundamental momentum score: fewer than two statement components or under 50% weight coverage.");
    }
    reasons.push(
      priceMomentum === null
        ? "Price momentum is unavailable and is not part of the score."
        : `Price momentum ${priceMomentum >= 0 ? "+" : ""}${priceMomentum.toFixed(1)}% (${momentumBasis}) is tracked separately and does not affect the score.`,
    );
    if (Math.abs(gap ?? 0) <= QUANTAMENTAL_FAIR_BAND && gap !== null) {
      reasons.push("Within the ±5% fair band: the quadrant label is directional, not a strong mispricing signal.");
    }
    if (stat.count > 0 && stat.count < 3) {
      reasons.push("Peer sample is below three names, so the median is not a robust benchmark.");
    }
    if (!stat.sameSector && stat.count >= 3) {
      reasons.push("Peer median falls back to all sectors because the sector had fewer than three same-basis names.");
    }

    const base: QuantamentalStock = {
      ...row,
      basis: valuation.basis,
      metric: valuation.metric === null ? null : round(valuation.metric, 4),
      peerMedian: peerMedian === null ? null : round(peerMedian, 4),
      peerCount: stat.count,
      peers: peerTickers.slice(0, 12),
      gap,
      priceMomentum: priceMomentum === null ? null : round(priceMomentum, 2),
      momentum: priceMomentum === null ? null : round(priceMomentum, 2),
      momentumBasis,
      fundamentalScore: momentumScore.score,
      momentumScore,
      valuation: valuationMetricsList,
      valuationPercentile,
      historyObservations: history.length,
      revisionDirection: revisionFrom(options.revisionHistory?.[row.ticker]),
      liquidity,
      thin: liquidity === "thin",
      nearMedian: gap !== null && Math.abs(gap) <= QUANTAMENTAL_FAIR_BAND,
      quadrant,
      classificationReasons: reasons,
      whatChanged: [],
      turnover: turnover === null ? null : round(turnover, 0),
      offScaleX: gap !== null && Math.abs(gap) > QUANTAMENTAL_X_DOMAIN,
      offScaleY: false,
    };
    base.whatChanged = buildChanges(base, previousByTicker.get(base.ticker));
    return base;
  });

  const quadrantCounts: QuantamentalMap["quadrantCounts"] = {
    "re-rating": 0,
    "value-trap": 0,
    "priced-in": 0,
    "de-rating": 0,
    improving: 0,
    drifting: 0,
  };

  let plotted = 0;
  let noMomentum = 0;
  let noValuation = 0;
  let fundamentals = 0;
  let momentumCoverage = 0;
  let both = 0;
  let fundamentalScore = 0;
  let valuationCount = 0;
  let forwardEstimates = 0;
  let statements = 0;
  let improved = 0;
  let deteriorated = 0;
  let unchanged = 0;
  let unavailable = 0;
  const sectorProfiles: Record<QuantamentalSectorProfile, number> = {
    bank: 0,
    mining: 0,
    consumer: 0,
    holding: 0,
    general: 0,
  };

  for (const stock of stocks) {
    sectorProfiles[stock.momentumScore.sectorProfile] += 1;
    if (stock.gap !== null) fundamentals += 1;
    if (stock.priceMomentum !== null) momentumCoverage += 1;
    if (stock.fundamentalScore !== null) fundamentalScore += 1;
    if (stock.metric !== null) valuationCount += 1;
    if (stock.valuation.some((metric) => metric.key === "pe_forward" && metric.value !== null)) forwardEstimates += 1;
    if ([stock.revenueFy, stock.netIncomeFy, stock.equityFy, stock.assetsFy].some((value) => value !== null && value !== undefined)) {
      statements += 1;
    }
    if (stock.gap !== null && stock.fundamentalScore !== null) {
      both += 1;
      plotted += 1;
      quadrantCounts[stock.quadrant as keyof typeof quadrantCounts] += 1;
    } else if (stock.gap !== null) {
      noMomentum += 1;
    } else {
      noValuation += 1;
    }
    const scoreChange = stock.whatChanged.find((item) => item.label === "Fundamental score")?.delta ?? null;
    if (stock.whatChanged.length === 0) unavailable += 1;
    else if (scoreChange === null) unavailable += 1;
    else if (scoreChange > 0.5) improved += 1;
    else if (scoreChange < -0.5) deteriorated += 1;
    else unchanged += 1;
  }

  return {
    status: options.status ?? "live",
    asOf: options.asOf ?? new Date().toISOString(),
    dataAsOf: options.dataAsOf ?? null,
    methodologyVersion: QUANTAMENTAL_METHODOLOGY_VERSION,
    universeSize: options.universeSize ?? stocks.length,
    plotted,
    noMomentum,
    noValuation,
    quadrantCounts,
    coverage: {
      fundamentals,
      momentum: momentumCoverage,
      both,
      valuation: valuationCount,
      fundamentalScore,
      forwardEstimates,
      statements,
    },
    sectorProfiles,
    stocks,
    methodology: QUANTAMENTAL_METHODOLOGY,
    historyDates: options.historyDates ?? [],
    changeSummary: { improved, deteriorated, unchanged, unavailable },
  };
}

/** Compact list of material changes for the WHAT CHANGED panel. */
export function materialChanges(map: QuantamentalMap): Array<QuantamentalChange & { ticker: string }> {
  const rows: Array<QuantamentalChange & { ticker: string }> = [];
  for (const stock of map.stocks) {
    for (const change of stock.whatChanged) {
      if (change.delta === null) continue;
      const threshold = change.unit === "score" ? 2 : change.unit === "pp" ? 0.3 : 1;
      if (Math.abs(change.delta) >= threshold) rows.push({ ...change, ticker: stock.ticker });
    }
  }
  return rows.sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0)).slice(0, 12);
}
