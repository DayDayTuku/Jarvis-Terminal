/**
 * Server-side Quantamental plumbing: upstream fetch + snapshot persistence.
 *
 * The calculation engine stays pure in `lib/quantamental.ts`. This file is the
 * only place that talks to TradingView and Supabase, so the route and the cron
 * job share one ingestion path and one retry policy.
 *
 * Snapshots are best-effort. If the service role or the table is missing the
 * live map still works; history-dependent fields stay null rather than being
 * estimated.
 */

import { createClient } from "@supabase/supabase-js";
import { fetchUpstream } from "./upstream";
import {
  QUANTAMENTAL_COLUMNS,
  QUANTAMENTAL_METHODOLOGY_VERSION,
  buildQuantamentalMap,
  buildQuantamentalUniverse,
  tradingViewSymbol,
  type QuantamentalMap,
  type QuantamentalRaw,
  type QuantamentalStock,
} from "./quantamental";

export const SCANNER_URL = "https://scanner.tradingview.com/indonesia/scan";
export const SCANNER_TIMEOUT_MS = 15_000;
export const SNAPSHOT_TABLE = "jarvis_quantamental_snapshots";
export const SNAPSHOT_LIMIT = 90;
export const QUANTAMENTAL_TIME_ZONE = "Asia/Jakarta";

type ScannerRow = { s?: unknown; d?: unknown[] };

const COLUMN_INDEX = new Map<string, number>(
  QUANTAMENTAL_COLUMNS.map((column, index) => [column, index] as const),
);

function value(row: ScannerRow, column: (typeof QUANTAMENTAL_COLUMNS)[number]): unknown {
  const index = COLUMN_INDEX.get(column);
  if (index === undefined || !Array.isArray(row.d)) return null;
  return row.d[index] ?? null;
}

function numberValue(row: ScannerRow, column: (typeof QUANTAMENTAL_COLUMNS)[number]): number | null {
  const raw = value(row, column);
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

function stringValue(row: ScannerRow, column: (typeof QUANTAMENTAL_COLUMNS)[number]): string | null {
  const raw = value(row, column);
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function dateValue(row: ScannerRow, column: (typeof QUANTAMENTAL_COLUMNS)[number]): string | null {
  const raw = value(row, column);
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return new Date(raw * 1000).toISOString();
  }
  if (typeof raw === "string" && raw.trim()) {
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
}

function tickerFromSymbol(symbol: unknown): string | null {
  if (typeof symbol !== "string") return null;
  const ticker = symbol.split(":").at(-1)?.replace(/\.JK$/i, "").trim().toUpperCase();
  return ticker ? ticker : null;
}

export function jakartaDate(date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: QUANTAMENTAL_TIME_ZONE }).format(date);
}

/**
 * `default` is the curated research universe (5 names per sector, ~55 stocks).
 * `full` scans every ticker in IDX_UNIVERSE so the weekly module can join its
 * own technical shortlist against fundamentals without losing names.
 */
export type QuantamentalScope = "default" | "full";

export function quantamentalUniverse(scope: QuantamentalScope = "default") {
  return buildQuantamentalUniverse(
    scope === "full" ? Number.POSITIVE_INFINITY : undefined,
  );
}

export async function fetchQuantamentalRows(
  scope: QuantamentalScope = "default",
): Promise<QuantamentalRaw[]> {
  const universe = quantamentalUniverse(scope);
  const response = await fetchUpstream(SCANNER_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0 Safari/537.36",
    },
    body: JSON.stringify({
      symbols: {
        tickers: universe.map((entry) => tradingViewSymbol(entry.ticker)),
        query: { types: [] },
      },
      columns: [...QUANTAMENTAL_COLUMNS],
    }),
    cache: "no-store",
    timeoutMs: SCANNER_TIMEOUT_MS,
    attempts: 2,
  });

  if (!response.ok) {
    throw new Error(`TradingView scanner returned ${response.status}`);
  }

  const payload = await response.json() as { data?: ScannerRow[] };
  const rows = Array.isArray(payload.data) ? payload.data : [];
  const byTicker = new Map<string, QuantamentalRaw>();

  for (const row of rows) {
    const ticker = tickerFromSymbol(row.s);
    if (!ticker) continue;
    const entry = universe.find((item) => item.ticker === ticker);
    if (!entry) continue;

    const revenue = numberValue(row, "total_revenue");
    const netIncome = numberValue(row, "net_income");
    const revenueTtm = numberValue(row, "total_revenue_ttm") ?? revenue;
    const netIncomeTtm = numberValue(row, "net_income_ttm") ?? netIncome;

    byTicker.set(ticker, {
      ticker,
      name: entry.name,
      sector: entry.sector,
      tvSector: stringValue(row, "sector"),
      industry: stringValue(row, "industry"),
      close: numberValue(row, "close"),
      change: numberValue(row, "change"),
      marketCap: numberValue(row, "market_cap_basic"),
      pb: numberValue(row, "price_book_fq"),
      pe: numberValue(row, "price_earnings_ttm"),
      roe: numberValue(row, "return_on_equity_fq"),
      roic: numberValue(row, "return_on_invested_capital_fq"),
      revenue: revenueTtm,
      netIncome: netIncomeTtm,
      perf3m: numberValue(row, "Perf.3M"),
      perf6m: numberValue(row, "Perf.6M"),
      avgVolume10d: numberValue(row, "average_volume_10d_calc"),

      revenueTtm,
      netIncomeTtm,
      ebitdaTtm: numberValue(row, "ebitda_ttm"),
      ebitTtm: numberValue(row, "ebit_ttm"),
      fcfTtm: numberValue(row, "free_cash_flow_ttm"),

      revenueFy: numberValue(row, "total_revenue_fy") ?? revenue,
      netIncomeFy: numberValue(row, "net_income_fy") ?? netIncome,
      ebitdaFy: numberValue(row, "ebitda_fy"),
      fcfFy: numberValue(row, "free_cash_flow_fy"),
      grossProfitFy: numberValue(row, "gross_profit_fy"),
      equityFy: numberValue(row, "total_equity_fy"),
      assetsFy: numberValue(row, "total_assets_fy"),
      liabilitiesFy: numberValue(row, "total_liabilities_fy"),
      debtFy: numberValue(row, "total_debt"),
      epsFy: numberValue(row, "earnings_per_share_diluted_fy"),

      revenueFq: numberValue(row, "total_revenue_fq"),
      netIncomeFq: numberValue(row, "net_income_fq"),
      ebitdaFq: numberValue(row, "ebitda_fq"),
      fcfFq: numberValue(row, "free_cash_flow_fq"),
      grossProfitFq: numberValue(row, "gross_profit_fq"),
      equityFq: numberValue(row, "total_equity_fq"),
      assetsFq: numberValue(row, "total_assets_fq"),
      liabilitiesFq: numberValue(row, "total_liabilities_fq"),
      debtFq: numberValue(row, "total_debt_fq"),
      epsFq: numberValue(row, "earnings_per_share_diluted_fq"),

      epsTtm: numberValue(row, "earnings_per_share_diluted_ttm"),
      epsForward: numberValue(row, "earnings_per_share_forecast_next_fy"),
      dividendPerShare: numberValue(row, "dps_common_stock_prim_issue_fy"),
      enterpriseValue: numberValue(row, "enterprise_value_fq"),
      netDebt: numberValue(row, "net_debt"),
      earningsReleaseDate: dateValue(row, "earnings_release_date"),
      nextEarningsDate: dateValue(row, "earnings_release_next_date"),
    });
  }

  return [...byTicker.values()];
}

export function absoluteScannerUrl(): string {
  return SCANNER_URL;
}

type ServiceClient = ReturnType<typeof createClient>;

export function quantamentalServiceClient(): ServiceClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export type QuantamentalSnapshotRow = {
  trade_date: string;
  as_of: string;
  status: string;
  payload: QuantamentalMap;
};

export type QuantamentalHistory = {
  /** Snapshot dates available, newest first. */
  dates: string[];
  /** Primary valuation metric series per ticker, oldest to newest. */
  history: Record<string, number[]>;
  /** Forward EPS series per ticker, oldest to newest. */
  revisionHistory: Record<string, number[]>;
  /** Most recent snapshot strictly before the requested cut-off. */
  previous: QuantamentalMap | null;
  /** Exact snapshot for a requested historical date. */
  snapshot: QuantamentalMap | null;
  available: boolean;
  error: string | null;
};

const EMPTY_HISTORY: QuantamentalHistory = {
  dates: [],
  history: {},
  revisionHistory: {},
  previous: null,
  snapshot: null,
  available: false,
  error: null,
};

function asStockList(payload: unknown): QuantamentalStock[] {
  if (!payload || typeof payload !== "object") return [];
  const stocks = (payload as { stocks?: unknown }).stocks;
  return Array.isArray(stocks) ? stocks as QuantamentalStock[] : [];
}

function mergeSeries(target: Record<string, number[]>, ticker: string, value: number | null) {
  if (value === null || !Number.isFinite(value)) return;
  if (!target[ticker]) target[ticker] = [];
  target[ticker].push(value);
}

/**
 * Load stored history. `before` excludes the current trade date so the live build
 * compares against genuinely prior data. `targetDate` returns that day's map.
 */
export async function loadQuantamentalHistory(options: {
  before?: string;
  targetDate?: string;
  limit?: number;
} = {}): Promise<QuantamentalHistory> {
  const supabase = quantamentalServiceClient();
  if (!supabase) return { ...EMPTY_HISTORY, error: "Snapshot storage is not configured." };

  const limit = options.limit ?? SNAPSHOT_LIMIT;
  let query = supabase
    .from(SNAPSHOT_TABLE)
    .select("trade_date,as_of,status,payload")
    .order("trade_date", { ascending: false })
    .limit(limit);

  if (options.targetDate) query = query.eq("trade_date", options.targetDate);
  if (options.before) query = query.lt("trade_date", options.before);

  const { data, error } = await query;
  if (error) {
    return { ...EMPTY_HISTORY, error: error.message };
  }

  const rows = (data ?? []) as QuantamentalSnapshotRow[];
  if (!rows.length) return { ...EMPTY_HISTORY, available: true };

  const chronological = [...rows].reverse();
  const history: Record<string, number[]> = {};
  const revisionHistory: Record<string, number[]> = {};

  for (const row of chronological) {
    for (const stock of asStockList(row.payload)) {
      mergeSeries(history, stock.ticker, typeof stock.metric === "number" ? stock.metric : null);
      const forward = stock.valuation?.find((metric) => metric.key === "pe_forward");
      const eps = typeof stock.epsForward === "number" && Number.isFinite(stock.epsForward)
        ? stock.epsForward
        : null;
      if (forward || eps !== null) mergeSeries(revisionHistory, stock.ticker, eps);
    }
  }

  const newest = rows[0]?.payload ?? null;
  const snapshot = options.targetDate
    ? (rows.find((row) => row.trade_date === options.targetDate)?.payload ?? null)
    : null;

  return {
    dates: rows.map((row) => row.trade_date),
    history,
    revisionHistory,
    previous: options.targetDate ? null : newest,
    snapshot,
    available: true,
    error: null,
  };
}

export async function saveQuantamentalSnapshot(map: QuantamentalMap): Promise<{ saved: boolean; error: string | null }> {
  const supabase = quantamentalServiceClient();
  if (!supabase) return { saved: false, error: "Snapshot storage is not configured." };

  const tradeDate = jakartaDate(new Date(map.asOf));
  const table = supabase.from(SNAPSHOT_TABLE) as unknown as {
    upsert: (value: Record<string, unknown>, options: { onConflict: string }) => Promise<{ error: { message: string } | null }>;
  };
  const { error } = await table.upsert({
    trade_date: tradeDate,
    as_of: map.asOf,
    status: map.status,
    universe_size: map.universeSize,
    plotted: map.plotted,
    methodology_version: QUANTAMENTAL_METHODOLOGY_VERSION,
    payload: { ...map, historyDates: [], changeSummary: map.changeSummary },
  }, { onConflict: "trade_date,methodology_version" });

  if (error) return { saved: false, error: error.message };
  return { saved: true, error: null };
}

/** Latest fundamental disclosure date across the fetched universe. */
export function latestDisclosure(rows: QuantamentalRaw[]): string | null {
  let newest: number | null = null;
  for (const row of rows) {
    if (!row.earningsReleaseDate) continue;
    const time = new Date(row.earningsReleaseDate).getTime();
    if (!Number.isFinite(time)) continue;
    if (newest === null || time > newest) newest = time;
  }
  return newest === null ? null : new Date(newest).toISOString();
}

export type LiveQuantamentalResult = {
  map: QuantamentalMap;
  snapshotSaved: boolean;
  snapshotError: string | null;
};

export async function buildLiveQuantamentalMap(options: {
  asOf?: string;
  persist?: boolean;
  history?: QuantamentalHistory;
  scope?: QuantamentalScope;
} = {}): Promise<LiveQuantamentalResult> {
  const scope = options.scope ?? "default";
  const today = jakartaDate();
  const history = options.history ?? await loadQuantamentalHistory({ before: today });
  const rows = await fetchQuantamentalRows(scope);
  if (!rows.length) throw new Error("The scanner returned no usable rows");

  const universe = quantamentalUniverse(scope);
  const asOf = options.asOf ?? new Date().toISOString();
  const withValues = rows.filter((row) => row.close !== null || row.marketCap !== null).length;
  const map = buildQuantamentalMap(rows, {
    asOf,
    dataAsOf: latestDisclosure(rows),
    status: withValues === universe.length ? "live" : "partial",
    universeSize: universe.length,
    history: history.history,
    revisionHistory: history.revisionHistory,
    previous: history.previous,
    historyDates: history.dates,
  });

  let snapshotSaved = false;
  let snapshotError: string | null = history.error;
  // Full-scope scans are a weekly-module convenience. Only the curated map is
  // stored, so history stays comparable across days and sectors keep their cap.
  if (options.persist !== false && scope === "default") {
    const result = await saveQuantamentalSnapshot(map);
    snapshotSaved = result.saved;
    snapshotError = result.error;
  }

  return { map, snapshotSaved, snapshotError };
}
