/**
 * Server-side plumbing that attaches an order-flow read to live setups.
 *
 * The scanner reads indicator values from TradingView, which carries no price
 * history. The order-flow read needs OHLCV bars, so this module fetches them
 * from Yahoo for the names that actually qualified (not the whole universe) and
 * caches them. A name whose history cannot be fetched simply carries
 * `flow: null`; the screener shows "unavailable" rather than a neutral-looking
 * read that was never computed.
 */

import { fetchUpstream } from "./upstream.ts";
import { YAHOO_HEADERS } from "./yahoo.ts";
import { DEFAULT_ORDER_FLOW_POLICY, readOrderFlow, summarizeOrderFlow, type FlowBar, type OrderFlowRead } from "./order-flow.ts";
import type { Setup } from "./setup-model.ts";

const BARS_TTL_MS = 6 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE_ENTRIES = 400;

type CachedBars = { at: number; bars: FlowBar[] };
const barsCache = new Map<string, CachedBars>();

function prune(now: number): void {
  if (barsCache.size <= MAX_CACHE_ENTRIES) return;
  for (const [key, entry] of barsCache) {
    if (now - entry.at > BARS_TTL_MS) barsCache.delete(key);
  }
  if (barsCache.size > MAX_CACHE_ENTRIES) barsCache.clear();
}

function parseChartBars(payload: unknown): FlowBar[] {
  const result = (payload as { chart?: { result?: Array<{ timestamp?: unknown[]; indicators?: { quote?: Array<Record<string, unknown[]>> } }> | null } })
    ?.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  const stamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
  if (!quote || !stamps.length) return [];
  const out: FlowBar[] = [];
  for (let index = 0; index < stamps.length; index += 1) {
    const stamp = Number(stamps[index]);
    const open = Number((quote.open as unknown[])?.[index]);
    const high = Number((quote.high as unknown[])?.[index]);
    const low = Number((quote.low as unknown[])?.[index]);
    const close = Number((quote.close as unknown[])[index]);
    const volume = Number((quote.volume as unknown[])?.[index]);
    if (!Number.isFinite(stamp) || ![open, high, low, close, volume].every(Number.isFinite)) continue;
    out.push({
      date: new Date(stamp * 1000).toISOString().slice(0, 10),
      open,
      high,
      low,
      close,
      volume,
    });
  }
  return out;
}

/** Six months of daily bars, cached. Returns [] when the feed cannot be read. */
export async function fetchFlowBars(ticker: string, now = Date.now()): Promise<FlowBar[]> {
  const symbol = `${ticker.replace(/^IDX:/, "").replace(/\.JK$/, "")}.JK`;
  const cached = barsCache.get(symbol);
  if (cached) {
    const ttl = cached.bars.length ? BARS_TTL_MS : NEGATIVE_TTL_MS;
    if (now - cached.at < ttl) return cached.bars;
  }

  let bars: FlowBar[] = [];
  try {
    const response = await fetchUpstream(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=6mo&interval=1d`,
      { headers: YAHOO_HEADERS, timeoutMs: 5_000, attempts: 1, next: { revalidate: 21_600 } } as RequestInit,
    );
    if (response.ok) bars = parseChartBars(await response.json());
  } catch {
    bars = [];
  }

  prune(now);
  barsCache.set(symbol, { at: now, bars });
  return bars;
}

/**
 * Attach a read to every setup that has enough history. Runs at a fixed
 * concurrency so one scan cannot open dozens of sockets at once. `limit` caps
 * how many of the highest-ranked setups get a read: each one costs a Yahoo
 * request, and a name far down the ranking cannot reach the 0–5 book anyway.
 * Setups beyond the cap keep `flow: null` and are therefore never vetoed.
 */
export async function attachOrderFlow<T extends Pick<Setup, "ticker">>(
  setups: T[],
  options: { policy?: typeof DEFAULT_ORDER_FLOW_POLICY; concurrency?: number; limit?: number } = {},
): Promise<Array<T & { flow: OrderFlowRead | null }>> {
  const policy = options.policy ?? DEFAULT_ORDER_FLOW_POLICY;
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 6, 10));
  const limit = Math.max(1, options.limit ?? 40);
  const out = new Array<T & { flow: OrderFlowRead | null }>(setups.length);
  for (let index = 0; index < setups.length; index += 1) out[index] = { ...setups[index], flow: null };
  const targets = setups.slice(0, limit);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, targets.length) }, async () => {
    while (cursor < targets.length) {
      const index = cursor;
      cursor += 1;
      const setup = targets[index];
      const bars = await fetchFlowBars(setup.ticker);
      out[index] = { ...setup, flow: bars.length ? readOrderFlow(bars, { policy }) : null };
    }
  });
  await Promise.all(runners);
  return out;
}

/** One line for the pick rationale, or null when there is no read. */
export function orderFlowLine(read: OrderFlowRead | null | undefined): string | null {
  if (!read) return null;
  return summarizeOrderFlow(read);
}
