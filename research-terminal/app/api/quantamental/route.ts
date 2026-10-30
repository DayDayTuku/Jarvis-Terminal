import { NextResponse } from "next/server";
import { createClient } from "../../../utils/supabase/server";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { fetchUpstream } from "@/lib/upstream";
import {
  QUANTAMENTAL_COLUMNS,
  buildQuantamentalMap,
  buildQuantamentalUniverse,
  tradingViewSymbol,
  type QuantamentalMap,
  type QuantamentalRaw,
} from "@/lib/quantamental";

/**
 * One batch request to the TradingView Indonesia scanner covers the whole map.
 * The route is authenticated and rate limited so it cannot be used as a free
 * scanner proxy. A failed refresh keeps the last successful map and labels it
 * stale rather than mixing old and new values silently.
 */

const SCANNER_URL = "https://scanner.tradingview.com/indonesia/scan";
const CACHE_TTL_MS = 15 * 60 * 1000;
const SCANNER_TIMEOUT_MS = 15_000;

let cache: { at: number; map: QuantamentalMap } | null = null;

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

function tickerFromSymbol(symbol: unknown): string | null {
  if (typeof symbol !== "string") return null;
  const ticker = symbol.split(":").at(-1)?.replace(/\.JK$/i, "").trim().toUpperCase();
  return ticker ? ticker : null;
}

async function fetchScannerRows(): Promise<QuantamentalRaw[]> {
  const universe = buildQuantamentalUniverse();
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

    byTicker.set(ticker, {
      ticker,
      name: entry.name,
      sector: entry.sector,
      tvSector: stringValue(row, "sector"),
      close: numberValue(row, "close"),
      change: numberValue(row, "change"),
      marketCap: numberValue(row, "market_cap_basic"),
      pb: numberValue(row, "price_book_fq"),
      pe: numberValue(row, "price_earnings_ttm"),
      roe: numberValue(row, "return_on_equity_fq"),
      revenue: numberValue(row, "total_revenue"),
      netIncome: numberValue(row, "net_income"),
      perf3m: numberValue(row, "Perf.3M"),
      perf6m: numberValue(row, "Perf.6M"),
      avgVolume10d: numberValue(row, "average_volume_10d_calc"),
    });
  }

  return [...byTicker.values()];
}

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const limit = await checkRateLimit({
      scope: "quantamental",
      identifier: user.id,
      limit: 30,
      windowSeconds: 60,
    });
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Too many map requests. Try again shortly." },
        { status: 429, headers: rateLimitHeaders(limit) },
      );
    }

    const now = Date.now();
    if (cache && now - cache.at < CACHE_TTL_MS) {
      return NextResponse.json(cache.map, {
        headers: { "cache-control": "private, max-age=300" },
      });
    }

    try {
      const rows = await fetchScannerRows();
      if (!rows.length) throw new Error("The scanner returned no usable rows");

      const universe = buildQuantamentalUniverse();
      const map = buildQuantamentalMap(rows, {
        asOf: new Date().toISOString(),
        status: rows.length === universe.length ? "live" : "partial",
        universeSize: universe.length,
      });

      cache = { at: now, map };
      return NextResponse.json(map, {
        headers: { "cache-control": "private, max-age=300" },
      });
    } catch (error) {
      if (cache) {
        console.error("Quantamental refresh failed; serving stale map:", error);
        return NextResponse.json(
          { ...cache.map, status: "stale" as const },
          { headers: { "cache-control": "private, no-store" } },
        );
      }
      console.error("Quantamental feed unavailable:", error);
      return NextResponse.json(
        {
          status: "unavailable",
          error: "The Indonesian scanner did not return valuation or momentum data.",
        },
        { status: 503, headers: { "cache-control": "private, no-store" } },
      );
    }
  } catch (error) {
    console.error("Quantamental route failed:", error);
    return NextResponse.json(
      { status: "unavailable", error: "Unable to build the quantamental map." },
      { status: 500, headers: { "cache-control": "private, no-store" } },
    );
  }
}
