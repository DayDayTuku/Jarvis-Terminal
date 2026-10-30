/**
 * Quantamental stock map.
 *
 * This module is pure on purpose: the API route only fetches and validates the
 * upstream rows, and every ranking, peer median, quadrant and coverage count is
 * computed here where it can be unit tested. No value is invented. If a feed
 * column is missing the stock either moves to an explicit "no valuation" or
 * "no momentum" state, or drops out of the plotted set with a count.
 */

import { IDX_UNIVERSE, type IDXStock } from "./idx-universe";

export type QuantamentalBasis = "pb_roe" | "pe" | "ps" | "pb" | "none";

export type QuantamentalQuadrant =
  | "re-rating"
  | "value-trap"
  | "priced-in"
  | "de-rating"
  | "improving"
  | "drifting"
  | "no-momentum"
  | "no-valuation";

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
  close: number | null;
  change: number | null;
  marketCap: number | null;
  pb: number | null;
  pe: number | null;
  roe: number | null;
  revenue: number | null;
  netIncome: number | null;
  perf3m: number | null;
  perf6m: number | null;
  avgVolume10d: number | null;
};

export type QuantamentalStock = QuantamentalRaw & {
  basis: QuantamentalBasis;
  metric: number | null;
  peerMedian: number | null;
  gap: number | null;
  momentum: number | null;
  momentumBasis: "6M" | "3M" | null;
  quadrant: QuantamentalQuadrant;
  turnover: number | null;
  thin: boolean;
  offScaleX: boolean;
  offScaleY: boolean;
};

export type QuantamentalStatus = "live" | "stale" | "partial";

export type QuantamentalMap = {
  status: QuantamentalStatus;
  asOf: string;
  universeSize: number;
  plotted: number;
  noMomentum: number;
  noValuation: number;
  quadrantCounts: Record<Exclude<QuantamentalQuadrant, "no-momentum" | "no-valuation">, number>;
  coverage: { fundamentals: number; momentum: number; both: number };
  stocks: QuantamentalStock[];
  methodology: string;
};

export const QUANTAMENTAL_X_DOMAIN = 50;
export const QUANTAMENTAL_MOMENTUM_MIN = -50;
export const QUANTAMENTAL_MOMENTUM_MAX = 200;
export const QUANTAMENTAL_FAIR_BAND = 5;
export const THIN_TURNOVER_IDR = 5_000_000_000;
export const QUANTAMENTAL_SECTORS_PER_NAME = 5;

export const QUANTAMENTAL_COLUMNS = [
  "name",
  "close",
  "change",
  "volume",
  "market_cap_basic",
  "price_book_fq",
  "price_earnings_ttm",
  "return_on_equity_fq",
  "total_revenue",
  "net_income",
  "earnings_per_share_diluted_ttm",
  "sector",
  "Perf.3M",
  "Perf.6M",
  "average_volume_10d_calc",
] as const;

export const BASIS_META: Record<
  QuantamentalBasis,
  { short: string; label: string; shape: "circle" | "diamond" | "triangle" | "square" | "none" }
> = {
  pe: { short: "P/E", label: "Profitable non-financial · price / earnings", shape: "circle" },
  pb_roe: { short: "P/B ÷ ROE", label: "Financial · price/book per ROE point", shape: "diamond" },
  ps: { short: "P/S", label: "Sales multiple · market cap / revenue", shape: "triangle" },
  pb: { short: "P/B", label: "P/B fallback · no earnings multiple or ROE near zero", shape: "square" },
  none: { short: "—", label: "No comparable valuation basis", shape: "none" },
};

export const QUADRANT_META: Record<
  QuantamentalQuadrant,
  { label: string; note: string; tone: "positive" | "negative" | "blue" | "muted" }
> = {
  "re-rating": {
    label: "RE-RATING",
    note: "Cheaper than peers · momentum positive",
    tone: "positive",
  },
  "value-trap": {
    label: "VALUE TRAP",
    note: "Cheaper than peers · momentum negative",
    tone: "negative",
  },
  "priced-in": {
    label: "PRICED IN",
    note: "Richer than peers · momentum positive",
    tone: "blue",
  },
  "de-rating": {
    label: "DE-RATING",
    note: "Richer than peers · momentum negative",
    tone: "negative",
  },
  improving: {
    label: "IMPROVING",
    note: "Near peer median · momentum positive",
    tone: "positive",
  },
  drifting: {
    label: "DRIFTING",
    note: "Near peer median · momentum negative",
    tone: "muted",
  },
  "no-momentum": {
    label: "NO MOMENTUM SIGNAL",
    note: "Valuation available · price history unavailable",
    tone: "muted",
  },
  "no-valuation": {
    label: "NO COMPARABLE GAP",
    note: "No peer-relative valuation could be computed",
    tone: "muted",
  },
};

export const QUANTAMENTAL_METHODOLOGY =
  "Peer-relative valuation versus price momentum. Financials use price/book divided by ROE percentage points; profitable non-financials use trailing P/E; loss-makers use market cap divided by revenue; P/B is the fallback when no earnings multiple is available or ROE is near zero. The x-axis gap is (peer median ÷ stock metric − 1) × 100, so positive means cheaper than the peer group. Peers are the same sector when at least three names share a basis, otherwise the whole universe for that basis. Momentum is six-month performance, falling back to three months. The fair band is ±5 points and the momentum split is zero. Thin means average ten-day turnover below IDR 5bn. Off-scale values are clamped to the edge and marked. This is a screen for questions, not a recommendation.";

function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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

function valuationFor(row: QuantamentalRaw): { basis: QuantamentalBasis; metric: number | null } {
  const pb = finite(row.pb);
  const pe = finite(row.pe);
  const roe = finite(row.roe);
  const revenue = finite(row.revenue);
  const marketCap = finite(row.marketCap);
  const netIncome = finite(row.netIncome);
  const financial = row.sector === "Financials";

  if (financial) {
    if (pb !== null && pb > 0 && roe !== null && roe > 0) {
      return { basis: "pb_roe", metric: pb / roe };
    }
    if (pb !== null && pb > 0) return { basis: "pb", metric: pb };
    return { basis: "none", metric: null };
  }

  if (pe !== null && pe > 0) return { basis: "pe", metric: pe };

  const lossMaking = netIncome !== null && netIncome <= 0;
  if (lossMaking && marketCap !== null && marketCap > 0 && revenue !== null && revenue > 0) {
    return { basis: "ps", metric: marketCap / revenue };
  }
  if (pb !== null && pb > 0) return { basis: "pb", metric: pb };
  if (marketCap !== null && marketCap > 0 && revenue !== null && revenue > 0) {
    return { basis: "ps", metric: marketCap / revenue };
  }
  return { basis: "none", metric: null };
}

export function classifyQuadrant(
  gap: number | null,
  momentum: number | null,
): QuantamentalQuadrant {
  if (gap === null) return "no-valuation";
  if (momentum === null) return "no-momentum";
  if (gap > QUANTAMENTAL_FAIR_BAND) {
    return momentum >= 0 ? "re-rating" : "value-trap";
  }
  if (gap < -QUANTAMENTAL_FAIR_BAND) {
    return momentum >= 0 ? "priced-in" : "de-rating";
  }
  return momentum >= 0 ? "improving" : "drifting";
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** Symmetric log position for the valuation gap. -1 is the left edge, 1 the right. */
export function symlogFraction(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const clamped = Math.max(-QUANTAMENTAL_X_DOMAIN, Math.min(QUANTAMENTAL_X_DOMAIN, value));
  const scale = 5;
  return Math.asinh(clamped / scale) / Math.asinh(QUANTAMENTAL_X_DOMAIN / scale);
}

export type BuildQuantamentalOptions = {
  asOf?: string;
  status?: QuantamentalStatus;
  /** Curated universe size; defaults to the number of rows supplied. */
  universeSize?: number;
};

export function buildQuantamentalMap(
  rows: QuantamentalRaw[],
  options: BuildQuantamentalOptions = {},
): QuantamentalMap {
  const prepared = rows.map((row) => {
    const valuation = valuationFor(row);
    const perf6m = finite(row.perf6m);
    const perf3m = finite(row.perf3m);
    const momentum = perf6m ?? perf3m;
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
    return { row, valuation, momentum, momentumBasis, turnover };
  });

  const sectorBasis = new Map<string, number[]>();
  const basis = new Map<string, number[]>();
  for (const item of prepared) {
    if (item.valuation.metric === null) continue;
    const sectorKey = `${item.row.sector}::${item.valuation.basis}`;
    sectorBasis.set(sectorKey, [...(sectorBasis.get(sectorKey) ?? []), item.valuation.metric]);
    basis.set(item.valuation.basis, [...(basis.get(item.valuation.basis) ?? []), item.valuation.metric]);
  }

  const stocks: QuantamentalStock[] = prepared.map((item) => {
    const { row, valuation, momentum, momentumBasis, turnover } = item;
    let peerMedian: number | null = null;

    if (valuation.metric !== null) {
      const sectorValues = sectorBasis.get(`${row.sector}::${valuation.basis}`) ?? [];
      const basisValues = basis.get(valuation.basis) ?? [];
      peerMedian = sectorValues.length >= 3
        ? median(sectorValues)
        : basisValues.length >= 3
          ? median(basisValues)
          : null;
    }

    const gap = valuation.metric !== null && valuation.metric > 0 && peerMedian !== null && peerMedian > 0
      ? round((peerMedian / valuation.metric - 1) * 100, 2)
      : null;

    return {
      ...row,
      basis: valuation.basis,
      metric: valuation.metric === null ? null : round(valuation.metric, 4),
      peerMedian: peerMedian === null ? null : round(peerMedian, 4),
      gap,
      momentum: momentum === null ? null : round(momentum, 2),
      momentumBasis,
      quadrant: classifyQuadrant(gap, momentum),
      turnover: turnover === null ? null : round(turnover, 0),
      thin: turnover !== null && turnover < THIN_TURNOVER_IDR,
      offScaleX: gap !== null && Math.abs(gap) > QUANTAMENTAL_X_DOMAIN,
      offScaleY: momentum !== null
        && (momentum < QUANTAMENTAL_MOMENTUM_MIN || momentum > QUANTAMENTAL_MOMENTUM_MAX),
    };
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

  for (const stock of stocks) {
    if (stock.gap !== null) {
      fundamentals += 1;
      if (stock.momentum !== null) {
        both += 1;
        plotted += 1;
        quadrantCounts[stock.quadrant as keyof typeof quadrantCounts] += 1;
      } else {
        noMomentum += 1;
      }
    } else {
      noValuation += 1;
    }
    if (stock.momentum !== null) momentumCoverage += 1;
  }

  return {
    status: options.status ?? "live",
    asOf: options.asOf ?? new Date().toISOString(),
    universeSize: options.universeSize ?? stocks.length,
    plotted,
    noMomentum,
    noValuation,
    quadrantCounts,
    coverage: { fundamentals, momentum: momentumCoverage, both },
    stocks,
    methodology: QUANTAMENTAL_METHODOLOGY,
  };
}
