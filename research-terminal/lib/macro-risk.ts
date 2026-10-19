// Macro / regional risk overlay.
//
// The mandate is capital preservation, so the model trims NEW risk when the
// external backdrop is hostile to Indonesian equities. Offline, on three years
// of history, four reads each separated trade outcomes in BOTH halves of the
// sample (flagged weeks produced worse trades than clear weeks):
//
//   - rupiah below its 50-day average   (foreign-outflow pressure)
//   - ^VIX up over 5 sessions           (global risk aversion)
//   - ^JKSE down over 20 sessions        (local tape rolling over)
//   - WTI up over 20 sessions           (import-cost / terms-of-trade hit)
//
// Each lit read cuts the size of the week's NEW picks, but the book never runs
// at full size "for no reason": it sits at BASE_EXPOSURE when the backdrop is
// calm and steps down as reads light. Held positions are never resized. The
// graded cut beat a constant-deleverage control on risk-adjusted return in both
// halves, and cut portfolio drawdown from -19.2% to -7.0% (A) and -7.1% to
// -2.4% (B). Reads that did NOT hold in both halves (DXY, US 10y, S&P, HSI, EEM,
// gold, ^JKSE below its 200-day) were deliberately left out.

import { YAHOO_HEADERS } from "./yahoo.ts";

export type MacroBar = { date: string; close: number };
export type MacroExposure = { exposure: number; flags: string[] };

/** Symbols fetched for the overlay, in the order their flags are reported. */
export const MACRO_SYMBOLS = ["IDR=X", "^VIX", "^JKSE", "CL=F"] as const;

/**
 * Default fraction of full size the book is allowed to run at. Going full size
 * with a calm, unremarkable backdrop is as unjustified as being defensive for
 * no reason, so the default is deliberately below 1 and the reads cut from here.
 * The backtest shows the risk-adjusted ratio is flat across base levels, so this
 * is a pure risk-appetite dial: 0.6 roughly gives 60% of the return at 60% of
 * the drawdown of a full-size book.
 */
export const BASE_EXPOSURE = 0.6;

/** Fraction of BASE_EXPOSURE taken for 0,1,2,3,4 lit reads. */
export const EXPOSURE_STEPS = [1, 0.75, 0.5, 0.25, 0] as const;

function indexAsOf(bars: MacroBar[], date: string): number {
  for (let i = bars.length - 1; i >= 0; i--) if (bars[i].date <= date) return i;
  return -1;
}

function changePct(bars: MacroBar[], index: number, sessions: number): number | null {
  const from = index - sessions;
  if (from < 0) return null;
  const base = bars[from].close;
  return base ? ((bars[index].close - base) / base) * 100 : null;
}

function aboveSma(bars: MacroBar[], index: number, window: number): boolean | null {
  if (index < window - 1) return null;
  const slice = bars.slice(index + 1 - window, index + 1);
  const average = slice.reduce((sum, bar) => sum + bar.close, 0) / slice.length;
  return average ? bars[index].close > average : null;
}

/**
 * The four risk reads as of `date`. A missing or too-short series leaves its
 * read unlit (false), which fails OPEN to full size rather than standing the
 * book down on bad data.
 */
export function macroFlags(series: Map<string, MacroBar[]>, date: string): string[] {
  const at = (symbol: string) => {
    const bars = series.get(symbol);
    if (!bars || !bars.length) return null;
    const index = indexAsOf(bars, date);
    return index >= 0 ? { bars, index } : null;
  };
  const flags: string[] = [];
  const idr = at("IDR=X");
  if (idr && aboveSma(idr.bars, idr.index, 50)) flags.push("IDR weak");
  const vix = at("^VIX");
  if (vix && (changePct(vix.bars, vix.index, 5) ?? 0) > 0) flags.push("VIX up");
  const jkse = at("^JKSE");
  if (jkse && (changePct(jkse.bars, jkse.index, 20) ?? 0) < 0) flags.push("JKSE down");
  const oil = at("CL=F");
  if (oil && (changePct(oil.bars, oil.index, 20) ?? 0) > 0) flags.push("oil up");
  return flags;
}

/** Gross-exposure multiplier for the week's new picks, with its reasons. */
export function macroExposure(series: Map<string, MacroBar[]>, date: string, base = BASE_EXPOSURE): MacroExposure {
  const flags = macroFlags(series, date);
  const step = EXPOSURE_STEPS[Math.min(flags.length, EXPOSURE_STEPS.length - 1)];
  return { exposure: base * step, flags };
}

/**
 * Daily closes from Yahoo for a raw symbol (no ".JK" suffix). Mirrors the
 * routes' own bar loader so the overlay reads exactly what the backtest read.
 */
export async function yahooDaily(symbol: string, since: string): Promise<MacroBar[]> {
  try {
    const period1 = Math.floor(Date.parse(`${since}T00:00:00Z`) / 1000);
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${Math.floor(Date.now() / 1000) + 86_400}&interval=1d`;
    const response = await fetch(url, { headers: YAHOO_HEADERS, cache: "no-store" });
    if (!response.ok) return [];
    const json: any = await response.json();
    const result = json?.chart?.result?.[0];
    const quote = result?.indicators?.quote?.[0];
    const stamps: number[] = Array.isArray(result?.timestamp) ? result.timestamp : [];
    if (!quote || !stamps.length) return [];
    return stamps
      .map((stamp, index) => ({ date: new Date(stamp * 1000).toISOString().slice(0, 10), close: Number(quote.close?.[index]) }))
      .filter((bar) => bar.date && Number.isFinite(bar.close));
  } catch {
    return [];
  }
}

// The overlay is identical for every surface in a short window, so cache it to
// keep a page load from firing four extra Yahoo calls.
const cache = new Map<string, { at: number; value: MacroExposure }>();
const CACHE_MS = 15 * 60 * 1000;

export async function loadMacroExposure(date: string): Promise<MacroExposure> {
  const hit = cache.get(date);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const since = new Date(Date.now() - 200 * 86_400_000).toISOString().slice(0, 10);
  const entries = await Promise.all(MACRO_SYMBOLS.map(async (symbol) => [symbol, await yahooDaily(symbol, since)] as const));
  const value = macroExposure(new Map(entries), date);
  cache.set(date, { at: Date.now(), value });
  return value;
}
