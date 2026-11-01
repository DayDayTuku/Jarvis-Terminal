/**
 * Market Explorer data helpers.
 *
 * The Explorer intentionally reads from the existing TradingView-backed
 * `/api/swing-setups` route and the Yahoo-backed market payload already used by
 * the dashboard. No new quote source and no fabricated weekly history: the
 * Explorer only shows fields the scanner actually returned.
 */

export type MarketQuote = {
  ticker: string;
  name: string;
  sector: string;
  close: number;
  change: number | null;
  volume: number | null;
  relativeVolume: number | null;
  rsi: number | null;
  ema20: number | null;
  ema50: number | null;
  sma200: number | null;
  high1m: number | null;
  low1m: number | null;
  marketCap: number | null;
};

export type ScannerPayload = {
  status: string;
  asOf: string;
  universe: number;
  scanned: number;
  quotes: MarketQuote[];
  message?: string;
};

type HeatmapSector = {
  label: string;
  daily: number | null;
  weekly: number | null;
  constituents: Array<{ ticker: string; price: number; daily: number | null; weekly: number | null }>;
};

export type SectorMove = {
  ticker: string;
  sector: string;
  price: number;
  daily: number | null;
  weekly: number | null;
};

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Normalise an exchange-prefixed ticker (`IDX:ADRO`) to `ADRO`. */
export function normaliseTicker(value: unknown): string {
  return text(value).replace(/^IDX:/i, "").replace(/\.JK$/i, "").toUpperCase();
}

/**
 * Coerce scanner rows defensively. Rows without a usable ticker or close are
 * dropped rather than filled with zeroes, so the UI can report coverage
 * honestly (`scanned` vs `universe`).
 */
export function coerceMarketQuotes(payload: unknown): MarketQuote[] {
  if (!payload || typeof payload !== "object") return [];
  const rows = (payload as { quotes?: unknown }).quotes;
  if (!Array.isArray(rows)) return [];
  const seen = new Set<string>();
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const raw = row as Record<string, unknown>;
    const ticker = normaliseTicker(raw.ticker);
    const close = finite(raw.close);
    if (!ticker || close === null || close <= 0 || seen.has(ticker)) return [];
    seen.add(ticker);
    return [{
      ticker,
      name: text(raw.name) || ticker,
      sector: text(raw.sector) || "Other",
      close,
      change: finite(raw.change),
      volume: finite(raw.volume),
      relativeVolume: finite(raw.relativeVolume),
      rsi: finite(raw.rsi),
      ema20: finite(raw.ema20),
      ema50: finite(raw.ema50),
      sma200: finite(raw.sma200),
      high1m: finite(raw.high1m),
      low1m: finite(raw.low1m),
      marketCap: finite(raw.marketCap),
    }];
  });
}

export type MoverKey = "change" | "volume" | "relativeVolume";

/** Rank rows that actually carry the requested metric. Nulls never rank as 0. */
export function rankMovers(
  quotes: readonly MarketQuote[],
  key: MoverKey,
  direction: "up" | "down",
  limit = 5,
): MarketQuote[] {
  const sign = direction === "up" ? -1 : 1;
  return quotes
    .filter((quote) => quote[key] !== null)
    .sort((a, b) => sign * ((a[key] as number) - (b[key] as number)) || a.ticker.localeCompare(b.ticker))
    .slice(0, Math.max(1, limit));
}

export type ScreenFilters = {
  query: string;
  sector: string;
  direction: "all" | "up" | "down";
  /** Sort key; only fields the scanner returns are allowed. */
  sort: "change" | "relativeVolume" | "rsi" | "marketCap" | "ticker";
};

export const DEFAULT_SCREEN_FILTERS: ScreenFilters = {
  query: "",
  sector: "ALL",
  direction: "all",
  sort: "change",
};

export function screenQuotes(quotes: readonly MarketQuote[], filters: ScreenFilters): MarketQuote[] {
  const query = filters.query.trim().toUpperCase();
  const rows = quotes.filter((quote) => {
    if (filters.sector !== "ALL" && quote.sector !== filters.sector) return false;
    if (filters.direction === "up" && !(quote.change !== null && quote.change > 0)) return false;
    if (filters.direction === "down" && !(quote.change !== null && quote.change < 0)) return false;
    if (!query) return true;
    return `${quote.ticker} ${quote.name} ${quote.sector}`.toUpperCase().includes(query);
  });
  return rows.sort((a, b) => {
    if (filters.sort === "ticker") return a.ticker.localeCompare(b.ticker);
    const av = a[filters.sort];
    const bv = b[filters.sort];
    if (av === null && bv === null) return a.ticker.localeCompare(b.ticker);
    if (av === null) return 1;
    if (bv === null) return -1;
    return bv - av || a.ticker.localeCompare(b.ticker);
  });
}

export function sectorOptions(quotes: readonly MarketQuote[]): string[] {
  return [...new Set(quotes.map((quote) => quote.sector))].sort((a, b) => a.localeCompare(b));
}

/** Flatten the dashboard heatmap's constituent baskets for the home pulse. */
export function sectorMoves(heatmap: readonly HeatmapSector[] | undefined): SectorMove[] {
  return (heatmap ?? []).flatMap((sector) =>
    (sector.constituents ?? []).flatMap((stock) => {
      if (!Number.isFinite(stock.price) || stock.price <= 0) return [];
      if (stock.daily === null && stock.weekly === null) return [];
      return [{
        ticker: stock.ticker,
        sector: sector.label,
        price: stock.price,
        daily: stock.daily,
        weekly: stock.weekly,
      }];
    }),
  );
}

export type HomeMarketPulse = {
  coverage: number;
  sectors: number;
  positiveSectors: number;
  gainers: SectorMove[];
  losers: SectorMove[];
};

/** Compact home summary built only from the market payload already on screen. */
export function homeMarketPulse(heatmap: readonly HeatmapSector[] | undefined, limit = 3): HomeMarketPulse {
  const moves = sectorMoves(heatmap);
  const validSectors = (heatmap ?? []).filter((sector) => sector.daily !== null);
  const byChange = moves.filter((move) => move.daily !== null);
  const gainers = byChange
    .filter((move) => (move.daily as number) > 0)
    .sort((a, b) => (b.daily as number) - (a.daily as number))
    .slice(0, limit);
  const losers = byChange
    .filter((move) => (move.daily as number) < 0)
    .sort((a, b) => (a.daily as number) - (b.daily as number))
    .slice(0, limit);
  return {
    coverage: moves.length,
    sectors: validSectors.length,
    positiveSectors: validSectors.filter((sector) => (sector.daily as number) > 0).length,
    gainers,
    losers,
  };
}
