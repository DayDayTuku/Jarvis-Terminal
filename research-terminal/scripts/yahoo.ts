// Shared Yahoo Finance loading for the offline scripts (backtest and fit-score).
//
// Bars are daily and unadjusted (Yahoo's `chart` endpoint). The scan calendar is
// the set of Fridays on the Jakarta Composite, which is the live cron's cadence.

import { IDX_UNIVERSE } from "../lib/idx-universe.ts";
import type { BacktestBar } from "../lib/backtest.ts";

export async function fetchBars(symbol: string, from: string): Promise<BacktestBar[]> {
  const period1 = Math.floor(Date.parse(`${from}T00:00:00Z`) / 1000);
  const period2 = Math.floor(Date.now() / 1000) + 86_400;
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d`;
  try {
    const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!response.ok) return [];
    const json: any = await response.json();
    const result = json?.chart?.result?.[0];
    const quote = result?.indicators?.quote?.[0];
    const stamps: number[] = Array.isArray(result?.timestamp) ? result.timestamp : [];
    if (!quote || !stamps.length) return [];
    return stamps
      .map((stamp, index) => ({
        date: new Date(stamp * 1000).toISOString().slice(0, 10),
        open: Number(quote.open?.[index]),
        high: Number(quote.high?.[index]),
        low: Number(quote.low?.[index]),
        close: Number(quote.close?.[index]),
        volume: Number(quote.volume?.[index]),
      }))
      .filter((bar) => bar.date && [bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite));
  } catch {
    return [];
  }
}

export async function pool<T, R>(items: T[], size: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;
  const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

export type LoadedUniverse = {
  barsByTicker: Map<string, BacktestBar[]>;
  sectors: Map<string, string>;
  scanDates: string[];
};

export async function loadUniverse(options: { years: number; limit: number; tickers: string[] | null; concurrency: number }): Promise<LoadedUniverse> {
  const universe = options.tickers
    ? options.tickers.map((ticker) => ({ ticker, sector: "Other" }))
    : IDX_UNIVERSE.map((stock) => ({ ticker: stock.ticker.replace(".JK", ""), sector: stock.sector })).slice(0, options.limit || undefined);

  const from = new Date(Date.now() - options.years * 365 * 86_400_000).toISOString().slice(0, 10);
  console.error(`Fetching ${universe.length} tickers from ${from} …`);

  const calendar = await fetchBars("^JKSE", from);
  if (!calendar.length) throw new Error("Could not load the Jakarta Composite for the scan calendar.");
  const scanDates = calendar.filter((bar, index) => new Date(`${bar.date}T00:00:00Z`).getUTCDay() === 5 && index > 60).map((bar) => bar.date);
  console.error(`Calendar: ${calendar.length} bars, ${scanDates.length} weekly scans.`);

  const bars = await pool(universe, options.concurrency, async (entry) => ({ entry, bars: await fetchBars(`${entry.ticker}.JK`, from) }));
  const barsByTicker = new Map<string, BacktestBar[]>();
  const sectors = new Map<string, string>();
  for (const { entry, bars: series } of bars) {
    if (series.length > 60) {
      barsByTicker.set(entry.ticker, series);
      sectors.set(entry.ticker, entry.sector);
    }
  }
  console.error(`Replaying ${barsByTicker.size} tickers with data.`);
  return { barsByTicker, sectors, scanDates };
}
