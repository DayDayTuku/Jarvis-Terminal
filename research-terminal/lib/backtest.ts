// Offline backtest for the V5 weekly model.
//
// It answers the only question that matters before a rule change ships: *does
// this variant actually make money, and better than the one that is live?*
//
// It reuses the exact classifier and selection rules from lib/setup-model and
// the exact level maths from lib/weekly-lifecycle, so a green backtest is
// evidence about the model we run, not about a lookalike.
//
// Two honest caveats:
//   1. Indicators are recomputed from daily bars here, whereas the live scanner
//      reads TradingView's values. They should agree closely but not exactly.
//   2. TradingView's "Recommend.All" rating is not available offline, so a
//      documented proxy is used. Momentum and short setups depend on it.
// Treat the output as a way to compare *variants*, not as an absolute forecast.

import {
  alignPrice,
  collapseStreaks,
  stopTrigger,
  targetTrigger,
  type PriceBar,
  type PriorPosition,
} from "./weekly-lifecycle.ts";
import {
  classifyAll,
  DEFAULT_POLICY,
  EXCLUDED_SETUPS,
  pickLongs,
  pickShort,
  positionWeight,
  regimeFor,
  shortWeight,
  type PlanPolicy,
  type Regime,
  type Setup,
  type SetupFeatures,
  type SetupKey,
} from "./setup-model.ts";
import { signalsOf, type ScoreSignals } from "./score-model.ts";

export type BacktestBar = { date: string; open: number; high: number; low: number; close: number; volume: number };

/**
 * Market context handed to a `macro` overlay. Every read is as of `date` and
 * returns null when the series is missing or too short, so an overlay can fail
 * open (full size) rather than silently stand the book down on bad data.
 */
export type MacroRead = {
  date: string;
  /** Latest close of `symbol` at or before the date. */
  value: (symbol: string) => number | null;
  /** Percent change of `symbol`'s close over the last `sessions` bars. */
  change: (symbol: string, sessions: number) => number | null;
  /** Percent distance of `symbol`'s close above/below its `window`-bar average. */
  distFromSma: (symbol: string, window: number) => number | null;
};

export type BacktestPolicy = {
  plan: PlanPolicy;
  /** Minimum R:R a pick must show. The live rule is 1.7. */
  minRiskReward: number;
  /** Sell half at the first target, move the stop to break-even, run the rest. */
  scaleOut: boolean;
  /** Close a position after this many sessions if it has not resolved. */
  maxHoldingDays: number | null;
  /**
   * When true, a position is NOT closed just because the name dropped off the
   * weekly list: it runs to its stop or target (or `maxHoldingDays`). The
   * shipped rule closes on the drop, which is how 56% of cells actually end.
   */
  holdThroughDrops?: boolean;
  /** Only open new positions while the week's regime is one of these. */
  regimes?: Regime[];
  /** Setups to take out of the book entirely. */
  excludeSetups?: SetupKey[];
  /** Round-trip cost in percent of notional, charged on every settled trade. */
  costPct?: number;
  /** Only open longs while the index closes above its N-day average (0 = off). */
  marketSma?: number;
  /**
   * Macro risk overlay. Given the market context at a scan date, return a gross
   * exposure multiplier in [0, 1] applied to every NEW pick that week (1 = full
   * size, 0 = stand aside). This is where FX, volatility and regional-equity
   * stress get turned into defence.
   */
  macro?: (read: MacroRead) => number;
  /** Minimum average daily turnover in rupiah (overrides the shipped floor). */
  minTurnoverIdr?: number;
};

export const DEFAULT_BACKTEST_POLICY: BacktestPolicy = {
  plan: DEFAULT_POLICY,
  minRiskReward: 1.7,
  scaleOut: false,
  maxHoldingDays: null,
};

export type BacktestExitReason = "STOP" | "TARGET" | "SCALE" | "TIME" | "WEEK_END" | "NO_ENTRY";

export type BacktestTrade = {
  weekOf: string;
  ticker: string;
  setup: SetupKey;
  score: number;
  weight: number;
  direction: "LONG" | "SHORT";
  status: "NO_ENTRY" | "OPEN" | "CLOSED";
  entryDate: string | null;
  entryPrice: number | null;
  exitDate: string | null;
  exitPrice: number | null;
  exitReason: "STOP" | "TARGET" | "SCALE" | "TIME" | "DROPPED" | "OPEN" | "NO_ENTRY";
  returnPct: number | null;
  rMultiple: number | null;
};

export type BacktestStats = {
  trades: number;
  noEntry: number;
  open: number;
  wins: number;
  losses: number;
  winRate: number | null;
  avgReturn: number | null;
  avgR: number | null;
  profitFactor: number | null;
  best: number | null;
  worst: number | null;
  /** Mean of the worst 5% of settled trades — the left tail that hurts. */
  tail: number | null;
  /** Standard deviation of per-trade returns. */
  stdev: number | null;
  /** Worst peak-to-trough of the trade-sequenced equity curve, in percent. */
  maxDrawdown: number | null;
  /** Total compounded return of the weekly weighted-exposure curve, in percent. */
  portfolioReturn: number | null;
};

export type BacktestResult = {
  policy: BacktestPolicy;
  scanDates: string[];
  trades: BacktestTrade[];
  summary: BacktestStats;
  bySetup: Array<{ setup: string; stats: BacktestStats }>;
  byScore: Array<{ bucket: string; stats: BacktestStats }>;
};

const mean = (values: number[]): number => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
const clampUnit = (value: number): number => Math.max(-1, Math.min(1, value));

// ---------------------------------------------------------------------------
// Indicators (computed locally; the "recommendation" is an explicit proxy)
// ---------------------------------------------------------------------------

function sma(values: number[], index: number, length: number): number | null {
  if (index + 1 < length) return null;
  return mean(values.slice(index + 1 - length, index + 1));
}

function ema(values: number[], index: number, length: number): number | null {
  if (index + 1 < length) return null;
  let current = mean(values.slice(0, length));
  const k = 2 / (length + 1);
  for (let i = length; i <= index; i++) current = values[i] * k + current * (1 - k);
  return current;
}

/** Wilder's RSI, computed from the start of the series up to `index`. */
function rsi(bars: BacktestBar[], index: number, length = 14): number | null {
  if (index < length) return null;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= index; i++) {
    const change = bars[i].close - bars[i - 1].close;
    const up = change > 0 ? change : 0;
    const down = change < 0 ? -change : 0;
    if (i <= length) {
      avgGain += up / length;
      avgLoss += down / length;
    } else {
      avgGain = (avgGain * (length - 1) + up) / length;
      avgLoss = (avgLoss * (length - 1) + down) / length;
    }
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

/** Wilder's ATR, computed from the start of the series up to `index`. */
function atr(bars: BacktestBar[], index: number, length = 14): number | null {
  if (index < length) return null;
  const tr = (i: number) =>
    Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - bars[i - 1].close), Math.abs(bars[i].low - bars[i - 1].close));
  let current = 0;
  for (let i = 1; i <= index; i++) {
    const value = tr(i);
    current = i <= length ? current + value / length : (current * (length - 1) + value) / length;
  }
  return current;
}

/** Bounded proxy for TradingView's `Recommend.All` (not available offline). */
function recommendationProxy(close: number, values: number[], index: number, rsiValue: number | null, ema20: number | null, ema50: number | null, sma200: number | null): number {
  const signals: number[] = [];
  if (ema20) signals.push(clampUnit((close / ema20 - 1) * 10));
  if (ema50) signals.push(clampUnit((close / ema50 - 1) * 8));
  if (sma200) signals.push(clampUnit((close / sma200 - 1) * 4));
  if (rsiValue !== null) signals.push(clampUnit((rsiValue - 50) / 25));
  const ema12 = ema(values, index, 12);
  const ema26 = ema(values, index, 26);
  if (ema12 !== null && ema26 !== null) signals.push(clampUnit((ema12 - ema26) / (close * 0.02)));
  return signals.length ? mean(signals) : 0;
}

/** Build the model's feature row for one ticker as of a bar index. */
export function computeFeatures(ticker: string, bars: BacktestBar[], index: number, sector?: string): SetupFeatures {
  const closes = bars.map((bar) => bar.close);
  const close = bars[index].close;
  const volume = bars[index].volume;
  const avgVolume = index >= 9 ? mean(bars.slice(index - 9, index + 1).map((bar) => bar.volume)) : null;
  const relativeVolume = avgVolume && avgVolume > 0 ? volume / avgVolume : null;
  const ema20 = ema(closes, index, 20);
  const ema50 = ema(closes, index, 50);
  const sma200 = sma(closes, index, 200);
  const rsiValue = rsi(bars, index, 14);
  const window1m = bars.slice(Math.max(0, index - 20), index + 1);
  return {
    ticker,
    name: ticker,
    sector,
    close,
    change: index >= 1 ? (close / bars[index - 1].close - 1) * 100 : null,
    volume,
    averageVolume: avgVolume,
    relativeVolume,
    rsi: rsiValue,
    ema20,
    ema50,
    sma200,
    high1m: window1m.length ? Math.max(...window1m.map((bar) => bar.high)) : null,
    low1m: window1m.length ? Math.min(...window1m.map((bar) => bar.low)) : null,
    recommendation: recommendationProxy(close, closes, index, rsiValue, ema20, ema50, sma200),
    marketCap: null,
    atr: atr(bars, index, 14),
  };
}

// ---------------------------------------------------------------------------
// Trade simulation
// ---------------------------------------------------------------------------

export type SimOutcome = {
  ticker: string;
  direction: "LONG" | "SHORT";
  status: "NO_ENTRY" | "OPEN" | "CLOSED";
  entryDate: string | null;
  entryPrice: number | null;
  exitDate: string | null;
  exitPrice: number | null;
  exitReason: BacktestExitReason;
  returnPct: number | null;
  rMultiple: number | null;
};

function pctReturn(direction: "LONG" | "SHORT", entry: number, exitPrice: number): number {
  return direction === "SHORT" ? ((entry - exitPrice) / entry) * 100 : ((exitPrice - entry) / entry) * 100;
}

/**
 * Resolve one position. With `scaleOut: false` and no `maxHoldingDays` this is
 * byte-for-byte the same decision as `tradeOutcome` — a parity test locks that.
 */
export function simulateTrade(input: {
  item: PriorPosition;
  bars: PriceBar[];
  direction: "LONG" | "SHORT";
  scaleOut: boolean;
  maxHoldingDays: number | null;
  /** How many sessions the entry order stays good for. Null = the whole window. */
  entryWindowDays?: number | null;
}): SimOutcome {
  const { item, bars, direction, scaleOut, maxHoldingDays, entryWindowDays = null } = input;
  const short = direction === "SHORT";
  const stop = stopTrigger(item);
  const target = targetTrigger(item);
  const hasTarget = Number.isFinite(target);

  const entrySearchEnd = entryWindowDays === null ? bars.length : Math.min(bars.length, entryWindowDays);
  let entryIndex = -1;
  for (let i = 0; i < entrySearchEnd; i++) {
    if (bars[i].high >= Number(item.planned_entry_low) && bars[i].low <= Number(item.planned_entry_high)) { entryIndex = i; break; }
  }
  if (entryIndex < 0) {
    return { ticker: item.ticker, direction, status: "NO_ENTRY", entryDate: null, entryPrice: null, exitDate: null, exitPrice: null, exitReason: "NO_ENTRY", returnPct: null, rMultiple: null };
  }
  const entry = alignPrice(Math.min(Number(item.planned_entry_high), Math.max(Number(item.planned_entry_low), bars[entryIndex].open)), "nearest");
  const entryDate = bars[entryIndex].date ?? null;
  const risk = short ? stop - entry : entry - stop;

  const finish = (exitDate: string | null, exitPrice: number, exitReason: BacktestExitReason, status: "OPEN" | "CLOSED", returnPct: number): SimOutcome => {
    // R is derived from the realised return so a scale-out (half banked, half
    // run) is scored on what was actually made, not on the runner's exit alone.
    return {
      ticker: item.ticker,
      direction,
      status,
      entryDate,
      entryPrice: entry,
      exitDate,
      exitPrice,
      exitReason,
      returnPct,
      rMultiple: Number.isFinite(risk) && risk > 0 ? ((returnPct / 100) * entry) / risk : null,
    };
  };

  let currentStop = stop;
  let scaledOut = false;

  for (let i = entryIndex; i < bars.length; i++) {
    const bar = bars[i];
    const stopHit = short ? bar.high >= currentStop : bar.low <= currentStop;
    const targetHit = hasTarget && (short ? bar.low <= target : bar.high >= target);

    if (scaleOut) {
      if (!scaledOut) {
        // The first target has not been reached, so this is a plain loss: bank
        // nothing at the target, or the accounting would credit a move that
        // never happened.
        if (stopHit) return finish(bar.date ?? null, currentStop, "STOP", "CLOSED", pctReturn(direction, entry, currentStop));
        if (targetHit) {
          scaledOut = true;
          currentStop = entry; // the runner's stop moves to break-even
          continue;
        }
      } else if (stopHit) {
        // Half was banked at the target; the runner exits at break-even.
        return finish(bar.date ?? null, currentStop, "SCALE", "CLOSED", 0.5 * pctReturn(direction, entry, target) + 0.5 * pctReturn(direction, entry, currentStop));
      }
    } else {
      if (stopHit) return finish(bar.date ?? null, currentStop, "STOP", "CLOSED", pctReturn(direction, entry, currentStop));
      if (targetHit) return finish(bar.date ?? null, target, "TARGET", "CLOSED", pctReturn(direction, entry, target));
    }

    if (maxHoldingDays !== null && i - entryIndex >= maxHoldingDays) {
      const returnPct = scaledOut ? 0.5 * pctReturn(direction, entry, target) + 0.5 * pctReturn(direction, entry, bar.close) : pctReturn(direction, entry, bar.close);
      return finish(bar.date ?? null, bar.close, "TIME", "CLOSED", returnPct);
    }
  }

  const last = bars[bars.length - 1];
  const exitPrice = last?.close ?? entry;
  const returnPct = scaledOut ? 0.5 * pctReturn(direction, entry, target) + 0.5 * pctReturn(direction, entry, exitPrice) : pctReturn(direction, entry, exitPrice);
  return finish(last?.date ?? null, exitPrice, "WEEK_END", "OPEN", returnPct);
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

export type BacktestInput = {
  /** ISO dates to scan, ascending. One per week is the natural choice. */
  scanDates: string[];
  barsByTicker: Map<string, BacktestBar[]>;
  /** The index series (e.g. ^JKSE), used by the `marketSma` filter. */
  marketBars?: BacktestBar[];
  /** Extra series keyed by symbol (FX, ^VIX, regional indices) for `macro`. */
  macroBars?: Map<string, BacktestBar[]>;
  sectors?: Map<string, string>;
  shortEligible?: Set<string>;
  policy?: Partial<BacktestPolicy>;
  /** Replace each setup's score before selection (e.g. with the fitted score). */
  scoreWith?: (setup: Setup) => number;
  /** Override the per-regime score gates, for a differently-scaled score. */
  thresholds?: { minimum?: Partial<Record<Regime, number>>; maximum?: Partial<Record<Regime, number>> };
};

export function stats(trades: BacktestTrade[]): BacktestStats {
  const settled = trades.filter((trade) => trade.status === "CLOSED" && trade.returnPct !== null);
  const wins = settled.filter((trade) => (trade.returnPct ?? 0) > 0);
  const losses = settled.filter((trade) => (trade.returnPct ?? 0) <= 0);
  const grossGain = wins.reduce((sum, trade) => sum + (trade.returnPct ?? 0), 0);
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + (trade.returnPct ?? 0), 0));
  const rValues = settled.map((trade) => trade.rMultiple).filter((value): value is number => value !== null);
  const returns = settled.map((trade) => trade.returnPct as number);

  // Left tail: the average of the worst 5% of trades. This is the number a
  // defensive mandate actually cares about, not the average.
  const sorted = [...returns].sort((a, b) => a - b);
  const tailCount = Math.max(1, Math.round(sorted.length * 0.05));
  const tail = sorted.length ? mean(sorted.slice(0, tailCount)) : null;
  const average = returns.length ? mean(returns) : 0;
  const stdev = returns.length > 1 ? Math.sqrt(mean(returns.map((value) => (value - average) ** 2))) : null;

  // Portfolio drawdown: group settled trades into the week their exit landed,
  // weight each return by its position weight, and compound the weekly returns.
  // (A serial equal-weight curve massively overstates drawdown for a portfolio
  // that runs several small positions at once.)
  const mondayOf = (date: string | null): string => {
    if (!date) return "";
    const day = new Date(`${date}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
    return day.toISOString().slice(0, 10);
  };
  const weekly = new Map<string, number>();
  for (const trade of settled) {
    const week = mondayOf(trade.exitDate);
    const contribution = (trade.weight / 100) * (trade.returnPct as number);
    weekly.set(week, (weekly.get(week) ?? 0) + contribution);
  }
  let equity = 1;
  let peak = 1;
  let drawdown = 0;
  for (const week of [...weekly.keys()].sort()) {
    equity *= 1 + (weekly.get(week) as number) / 100;
    peak = Math.max(peak, equity);
    drawdown = Math.min(drawdown, equity / peak - 1);
  }
  const maxDrawdown = weekly.size > 1 ? drawdown * 100 : null;
  const portfolioReturn = weekly.size ? (equity - 1) * 100 : null;

  return {
    trades: settled.length,
    noEntry: trades.filter((trade) => trade.status === "NO_ENTRY").length,
    open: trades.filter((trade) => trade.status === "OPEN").length,
    wins: wins.length,
    losses: losses.length,
    winRate: settled.length ? (wins.length / settled.length) * 100 : null,
    avgReturn: settled.length ? average : null,
    avgR: rValues.length ? mean(rValues) : null,
    profitFactor: grossLoss > 0 ? grossGain / grossLoss : null,
    best: settled.length ? Math.max(...returns) : null,
    worst: settled.length ? Math.min(...returns) : null,
    tail,
    stdev,
    maxDrawdown,
    portfolioReturn,
  };
}

const SCORE_BUCKETS: Array<{ label: string; test: (score: number) => boolean }> = [
  { label: "90+", test: (score) => score >= 90 },
  { label: "85-89", test: (score) => score >= 85 && score < 90 },
  { label: "80-84", test: (score) => score >= 80 && score < 85 },
  { label: "<80", test: (score) => score < 80 },
];

type Pick = { weekIndex: number; weekOf: string; setup: SetupKey; score: number; weight: number; direction: "LONG" | "SHORT"; item: PriorPosition };

export function setupToPosition(setup: Setup, direction: "LONG" | "SHORT", plan: PlanPolicy): PriorPosition {
  const short = direction === "SHORT";
  const atr = setup.atr !== null && Number.isFinite(setup.atr) && setup.atr > 0 ? setup.atr : null;
  // The mechanical hard stop is what actually caps risk, so an ATR policy has to
  // move it too — otherwise the flat 6% always wins the "tighter stop" rule.
  const hardStop = plan.stopMode === "atr" && atr !== null
    ? setup.close + (short ? 1 : -1) * atr * plan.atrStopMult
    : setup.close * (short ? 1.06 : 0.94);
  return {
    ticker: setup.ticker,
    setup: setup.setup,
    score: setup.score,
    planned_entry_low: alignPrice(setup.entryLow, "up"),
    planned_entry_high: alignPrice(setup.entryHigh, "down"),
    invalidation: alignPrice(setup.invalidation, "up"),
    hard_stop: alignPrice(hardStop, "up"),
    target_one: alignPrice(setup.target, short ? "up" : "down"),
  };
}

/** Resolve the ticker's bar index at or before `date` (the last closed session). */
function indexAsOf(bars: BacktestBar[], date: string): number {
  for (let i = bars.length - 1; i >= 0; i--) if (bars[i].date <= date) return i;
  return -1;
}

/**
 * Build the macro read for a date from a symbol→bars map. Exported so the CLI
 * can run the same reads for diagnostics (e.g. "were flagged weeks actually
 * worse?") instead of duplicating the definitions.
 */
export function macroReadFor(macro: Map<string, BacktestBar[]>, date: string): MacroRead {
  const series = (symbol: string): { bars: BacktestBar[]; index: number } | null => {
    const bars = macro.get(symbol);
    if (!bars || !bars.length) return null;
    const index = indexAsOf(bars, date);
    return index >= 0 ? { bars, index } : null;
  };
  return {
    date,
    value(symbol) {
      const found = series(symbol);
      return found ? found.bars[found.index].close : null;
    },
    change(symbol, sessions) {
      const found = series(symbol);
      if (!found) return null;
      const from = found.index - sessions;
      if (from < 0) return null;
      const base = found.bars[from].close;
      return base ? ((found.bars[found.index].close - base) / base) * 100 : null;
    },
    distFromSma(symbol, window) {
      const found = series(symbol);
      if (!found || found.index < window - 1) return null;
      const average = mean(found.bars.slice(found.index + 1 - window, found.index + 1).map((bar) => bar.close));
      return average ? ((found.bars[found.index].close - average) / average) * 100 : null;
    },
  };
}

/**
 * Label every classified candidate with the R it would have produced under the
 * shipped plan, so a score can be fitted. Selection is deliberately ignored:
 * labels come from all candidates that clear the R:R gate, which is exactly the
 * population the score is asked to rank.
 */
export type ScoreSample = { date: string; setup: SetupKey; signals: ScoreSignals; r: number; legacyScore: number };

export function collectSamples(input: {
  scanDates: string[];
  barsByTicker: Map<string, BacktestBar[]>;
  sectors?: Map<string, string>;
  shortEligible?: Set<string>;
  policy?: Partial<BacktestPolicy>;
  horizonDays?: number;
}): ScoreSample[] {
  const policy: BacktestPolicy = { ...DEFAULT_BACKTEST_POLICY, ...input.policy, plan: input.policy?.plan ?? DEFAULT_POLICY };
  const shortEligible = input.shortEligible ?? new Set<string>();
  const sectors = input.sectors ?? new Map<string, string>();
  const horizon = input.horizonDays ?? 20;
  const samples: ScoreSample[] = [];

  for (const scanDate of [...input.scanDates].sort()) {
    const features: SetupFeatures[] = [];
    for (const [ticker, bars] of input.barsByTicker) {
      const index = indexAsOf(bars, scanDate);
      if (index < 20) continue;
      features.push(computeFeatures(ticker, bars, index, sectors.get(ticker)));
    }
    const setups = classifyAll(features, { shortEligible, policy: policy.plan, minTurnoverIdr: policy.minTurnoverIdr }).filter((setup) => setup.riskReward >= policy.minRiskReward);
    for (const setup of setups) {
      const bars = (input.barsByTicker.get(setup.ticker) ?? []) as PriceBar[];
      const windowBars = bars.filter((bar) => bar.date && bar.date > scanDate);
      if (!windowBars.length) continue;
      const direction: "LONG" | "SHORT" = setup.setup.startsWith("short_") ? "SHORT" : "LONG";
      const outcome = simulateTrade({ item: setupToPosition(setup, direction, policy.plan), bars: windowBars, direction, scaleOut: false, maxHoldingDays: horizon });
      if (outcome.rMultiple === null) continue;
      samples.push({ date: scanDate, setup: setup.setup, signals: signalsOf(setup), r: outcome.rMultiple, legacyScore: setup.legacyScore });
    }
  }
  return samples;
}

export function runBacktest(input: BacktestInput): BacktestResult {
  const policy: BacktestPolicy = { ...DEFAULT_BACKTEST_POLICY, ...input.policy, plan: input.policy?.plan ?? DEFAULT_POLICY };
  const shortEligible = input.shortEligible ?? new Set<string>();
  const sectors = input.sectors ?? new Map<string, string>();
  const scanDates = [...input.scanDates].sort();
  const runCount = scanDates.length;

  const market = input.marketBars ?? [];
  const marketOpen = (date: string): boolean => {
    const window = policy.marketSma ?? 0;
    if (window <= 0 || market.length < window) return true;
    const index = indexAsOf(market, date);
    if (index < window - 1) return false;
    const average = mean(market.slice(index + 1 - window, index + 1).map((bar) => bar.close));
    return market[index].close > average;
  };

  const macro = input.macroBars ?? new Map<string, BacktestBar[]>();
  const macroRead = (date: string): MacroRead => macroReadFor(macro, date);

  const picksByTicker = new Map<string, Pick[]>();

  scanDates.forEach((scanDate, weekIndex) => {
    const features: SetupFeatures[] = [];
    for (const [ticker, bars] of input.barsByTicker) {
      let index = -1;
      for (let i = bars.length - 1; i >= 0; i--) {
        if (bars[i].date <= scanDate) { index = i; break; }
      }
      if (index < 20) continue;
      features.push(computeFeatures(ticker, bars, index, sectors.get(ticker)));
    }
    const classified = classifyAll(features, { shortEligible, policy: policy.plan, minTurnoverIdr: policy.minTurnoverIdr }).filter((setup) => setup.riskReward >= policy.minRiskReward);
    const scored = input.scoreWith
      ? classified.map((setup) => ({ ...setup, score: input.scoreWith!(setup) })).sort((a, b) => b.score - a.score)
      : classified;
    // The regime is read on the same tradeable set the selection uses, so a
    // setup we would never trade cannot inflate the breadth read.
    const excluded = new Set(policy.excludeSetups ?? [...EXCLUDED_SETUPS]);
    const regime = regimeFor(scored, excluded);
    const tradeThisWeek = (!policy.regimes || policy.regimes.includes(regime)) && marketOpen(scanDate);
    const longs = tradeThisWeek ? pickLongs(scored, regime, input.thresholds, excluded) : [];
    const shorts = tradeThisWeek ? pickShort(scored).filter((setup) => shortWeight(setup, longs, regime) >= 3) : [];
    // Macro overlay: shrink (or stand down) this week's NEW risk. Held positions
    // keep their size — defence applies to fresh exposure, not open trades.
    const exposure = policy.macro ? Math.max(0, Math.min(1, policy.macro(macroRead(scanDate)))) : 1;

    const push = (setup: Setup, direction: "LONG" | "SHORT", weight: number) => {
      const list = picksByTicker.get(setup.ticker) ?? [];
      list.push({ weekIndex, weekOf: scanDate, setup: setup.setup, score: setup.score, weight, direction, item: setupToPosition(setup, direction, policy.plan) });
      picksByTicker.set(setup.ticker, list);
    };
    if (exposure > 0) {
      for (const setup of longs) push(setup, "LONG", positionWeight(setup, regime) * exposure);
      for (const setup of shorts) push(setup, "SHORT", shortWeight(setup, longs, regime) * exposure);
    }
  });

  const trades: BacktestTrade[] = [];
  for (const [ticker, picks] of picksByTicker) {
    const bars = (input.barsByTicker.get(ticker) ?? []) as PriceBar[];
    const sorted = [...picks].sort((a, b) => a.weekIndex - b.weekIndex);
    for (const streak of collapseStreaks(sorted.map((pick) => pick.weekIndex), runCount)) {
      const plan = sorted.find((pick) => pick.weekIndex === streak.openIndex);
      if (!plan) continue;
      const openWeekOf = scanDates[streak.openIndex];
      const closeWeekOf = streak.closeIndex !== null ? scanDates[streak.closeIndex] : null;
      // Shipped: a name that drops off the list is closed at that week's close.
      // "Let it run": ignore the drop and hold to stop/target, capped by sessions.
      const holdThroughDrops = policy.holdThroughDrops === true;
      const windowBars = bars.filter((bar) => bar.date && bar.date > openWeekOf && (holdThroughDrops || closeWeekOf === null || bar.date < closeWeekOf));
      const holdingCap = holdThroughDrops ? policy.maxHoldingDays ?? 60 : policy.maxHoldingDays;
      // The planned entry order is only good for the week it was placed, in both
      // arms, so the comparison isolates the exit rule.
      const outcome = simulateTrade({ item: plan.item, bars: windowBars, direction: plan.direction, scaleOut: policy.scaleOut, maxHoldingDays: holdingCap, entryWindowDays: 5 });
      const exitReason: BacktestTrade["exitReason"] =
        outcome.exitReason === "WEEK_END" ? (closeWeekOf === null || holdThroughDrops ? "OPEN" : "DROPPED") : (outcome.exitReason as BacktestTrade["exitReason"]);
      const status = !holdThroughDrops && outcome.status === "OPEN" && closeWeekOf !== null ? "CLOSED" : outcome.status;
      // Charge the round-trip cost on every settled trade, in both percent and R.
      let returnPct = outcome.returnPct;
      let rMultiple = outcome.rMultiple;
      if (policy.costPct && status === "CLOSED" && returnPct !== null && outcome.entryPrice !== null) {
        returnPct -= policy.costPct;
        const risk = Math.abs(outcome.entryPrice - stopTrigger(plan.item));
        rMultiple = risk > 0 ? ((returnPct / 100) * outcome.entryPrice) / risk : rMultiple;
      }
      trades.push({
        weekOf: openWeekOf,
        ticker,
        setup: plan.setup,
        score: plan.score,
        weight: plan.weight,
        direction: plan.direction,
        status,
        entryDate: outcome.entryDate,
        entryPrice: outcome.entryPrice,
        exitDate: outcome.exitDate,
        exitPrice: outcome.exitPrice,
        exitReason,
        returnPct,
        rMultiple,
      });
    }
  }

  trades.sort((a, b) => (a.weekOf < b.weekOf ? 1 : a.weekOf > b.weekOf ? -1 : a.ticker.localeCompare(b.ticker)));
  const setups = [...new Set(trades.map((trade) => trade.setup))].sort();
  return {
    policy,
    scanDates,
    trades,
    summary: stats(trades),
    bySetup: setups.map((setup) => ({ setup, stats: stats(trades.filter((trade) => trade.setup === setup)) })),
    byScore: SCORE_BUCKETS.map((bucket) => ({ bucket: bucket.label, stats: stats(trades.filter((trade) => bucket.test(trade.score))) })),
  };
}
