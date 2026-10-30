/**
 * Quotes for tickers a user saved to their own watchlist.
 *
 * The shared market feed only knows a fixed starter list, so account-synced
 * tickers need their own lookup. Keep the provider call and the parsing in one
 * place, cache failures as well as successes, and never invent a price: a
 * missing quote must surface as "unavailable", not as zero.
 */

import { fetchUpstream } from "./upstream.ts";

export type WatchQuote = { ticker: string; price: number; change: number };

type ChartPayload = {
  chart?: {
    result?: Array<{
      meta?: { regularMarketPrice?: number };
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }> | null;
  };
};

const QUOTE_TTL_MS = 60_000;
const NEGATIVE_TTL_MS = 15_000;
const QUOTE_TIMEOUT_MS = 6_000;
const MAX_CACHE_ENTRIES = 500;

const cache = new Map<string, { at: number; quote: WatchQuote | null }>();

function validCloses(closes: Array<number | null> | undefined): number[] {
  return (closes ?? []).filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0,
  );
}

/** Turn one Yahoo chart payload into a quote, or null when it has no usable price. */
export function parseChartQuote(ticker: string, payload: unknown): WatchQuote | null {
  if (!ticker) return null;
  const result = (payload as ChartPayload)?.chart?.result?.[0];
  if (!result) return null;

  const closes = validCloses(result.indicators?.quote?.[0]?.close);
  const marketPrice = result.meta?.regularMarketPrice;
  const lastClose = closes.at(-1);
  const livePrice = typeof marketPrice === "number" && Number.isFinite(marketPrice) && marketPrice > 0
    ? marketPrice
    : undefined;
  const last = livePrice ?? lastClose;
  if (!last || last <= 0) return null;

  // If the live price is newer than the latest daily close, compare against
  // that close. Otherwise the latest close is the observation being compared.
  const prior = livePrice !== undefined && lastClose !== undefined && lastClose !== livePrice
    ? lastClose
    : closes.at(-2) ?? last;
  const change = prior > 0 ? ((last / prior) - 1) * 100 : 0;

  return {
    ticker,
    price: Number(last.toFixed(4)),
    change: Number(change.toFixed(4)),
  };
}

function pruneCache(now: number) {
  if (cache.size <= MAX_CACHE_ENTRIES) return;
  for (const [key, entry] of cache) {
    if (now - entry.at >= QUOTE_TTL_MS) cache.delete(key);
  }
  if (cache.size > MAX_CACHE_ENTRIES) cache.clear();
}

export async function fetchWatchQuote(ticker: string, now = Date.now()): Promise<WatchQuote | null> {
  const cached = cache.get(ticker);
  if (cached) {
    const ttl = cached.quote ? QUOTE_TTL_MS : NEGATIVE_TTL_MS;
    if (now - cached.at < ttl) return cached.quote;
  }

  let quote: WatchQuote | null = null;
  try {
    const symbol = `${ticker}.JK`;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1mo&interval=1d`;
    const response = await fetchUpstream(url, {
      headers: { "user-agent": "Mozilla/5.0", accept: "application/json" },
      cache: "no-store",
      timeoutMs: QUOTE_TIMEOUT_MS,
    });
    if (response.ok) {
      quote = parseChartQuote(ticker, await response.json());
    }
  } catch {
    quote = null;
  }

  cache.set(ticker, { at: now, quote });
  pruneCache(now);
  return quote;
}

export async function fetchWatchQuotes(
  tickers: string[],
): Promise<{ quotes: WatchQuote[]; failed: string[] }> {
  const quotes: WatchQuote[] = [];
  const failed: string[] = [];

  const results = await Promise.all(tickers.map((ticker) => fetchWatchQuote(ticker)));
  results.forEach((quote, index) => {
    if (quote) quotes.push(quote);
    else failed.push(tickers[index]);
  });

  return { quotes, failed };
}
