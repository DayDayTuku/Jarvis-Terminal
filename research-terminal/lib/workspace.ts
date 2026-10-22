/**
 * Validation shared by the workspace APIs and their tests. Keeping these rules
 * in one place prevents the browser and the database from drifting apart.
 */

export const MAX_WATCHLIST_TICKERS = 50;
export const MAX_PORTFOLIO_POSITIONS = 50;
export const MAX_NOTE_LENGTH = 2000;

const TICKER_PATTERN = /^[A-Z0-9]{1,8}$/;
const SCHEMES = ["default", "deuteranopia", "protanopia", "tritanopia"] as const;

export type PortfolioPosition = { ticker: string; value: number };

/** Accepts `bbca`, `BBCA.JK`, or ` bbca ` and returns `BBCA`. */
export function normalizeTicker(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const normalized = raw.trim().toUpperCase().replace(/\.JK$/, "");
  return TICKER_PATTERN.test(normalized) ? normalized : null;
}

export function normalizeTickerList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  for (const item of raw) {
    const ticker = normalizeTicker(item);
    if (ticker) seen.add(ticker);
    if (seen.size >= MAX_WATCHLIST_TICKERS) break;
  }
  return [...seen];
}

export function sanitizePositions(
  raw: unknown,
): { positions: PortfolioPosition[]; error: string | null } {
  if (!Array.isArray(raw)) {
    return { positions: [], error: "Positions must be an array." };
  }
  if (raw.length > MAX_PORTFOLIO_POSITIONS) {
    return { positions: [], error: `A portfolio can hold at most ${MAX_PORTFOLIO_POSITIONS} positions.` };
  }

  const merged = new Map<string, number>();
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { positions: [], error: "Every position must be an object." };
    }
    const record = item as Record<string, unknown>;
    const ticker = normalizeTicker(record.ticker);
    const value = typeof record.value === "number" ? record.value : Number(record.value);
    if (!ticker) {
      return { positions: [], error: "Every position needs a valid IDX ticker." };
    }
    if (!Number.isFinite(value) || value < 0 || value > 1_000_000_000_000_000) {
      return { positions: [], error: `Position value for ${ticker} must be a finite positive amount.` };
    }
    merged.set(ticker, (merged.get(ticker) ?? 0) + value);
  }

  return {
    positions: [...merged.entries()].map(([ticker, value]) => ({ ticker, value })),
    error: null,
  };
}

export function sanitizeNoteBody(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const body = raw.trim();
  if (!body || body.length > MAX_NOTE_LENGTH) return null;
  return body;
}

export function isAccessibleScheme(value: unknown): value is (typeof SCHEMES)[number] {
  return typeof value === "string" && (SCHEMES as readonly string[]).includes(value);
}

export function sanitizeSnapshot(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  // Snapshots are intentionally small. Reject anything that would bloat the
  // preferences row or store unexpected nested payloads.
  const allowed = ["takenAt", "regime", "breadthPositive", "breadthTotal", "liveFeeds", "notes"] as const;
  const result: Record<string, unknown> = {};
  for (const key of allowed) {
    const value = (raw as Record<string, unknown>)[key];
    if (value === undefined) continue;
    if (key === "takenAt" && typeof value === "string" && value.length <= 40) result[key] = value;
    else if (key === "regime" && typeof value === "string" && value.length <= 40) result[key] = value;
    else if (key === "notes" && typeof value === "string" && value.length <= 280) result[key] = value;
    else if (["breadthPositive", "breadthTotal", "liveFeeds"].includes(key) && typeof value === "number" && Number.isFinite(value)) {
      result[key] = Math.max(0, Math.min(1000, Math.round(value)));
    }
  }
  return result;
}
