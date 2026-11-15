// Monte Carlo robustness layer for the offline backtest.
//
// What this can and cannot tell you
// ---------------------------------
// A backtest is a single sample path. Monte Carlo resamples that path to show
// how much of the headline result is *path luck* and *sampling noise*. It does
// NOT create edge, and it cannot tell you how the model behaves in a regime the
// sample never contained.
//
// Two resampling schemes are provided because they answer different questions:
//
//   weekly  Circular block bootstrap of the weekly portfolio return series.
//           Blocks (default 4 weeks) preserve short-range clustering — stops
//           tend to fire together, and regimes persist for weeks — so the
//           drawdown distribution is not made artificially narrow. This is the
//           primary tool for "how bad could the next year have looked?".
//
//   trades  I.i.d. bootstrap of settled trades. Gives confidence intervals for
//           win rate, expectancy, average R and profit factor. Ignores
//           clustering, so treat it as a lower bound on uncertainty.
//
// Selection warning: running many variants and keeping the one with the best
// bootstrap is just overfitting with extra steps. The paired comparison below
// is the honest way to ask whether one variant beats another on the same weeks.

import type { BacktestTrade } from "./backtest.ts";

export type Distribution = {
  samples: number;
  mean: number;
  stdev: number;
  min: number;
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
  max: number;
};

export type MonteCarloOptions = {
  /** Number of resampled paths. Default 2000. */
  iterations?: number;
  /** Weeks per circular block. Default 4. 1 = i.i.d. weeks. */
  blockWeeks?: number;
  /** Deterministic RNG seed, so a run can be reproduced. Default 42. */
  seed?: number;
};

export type ObservedWeekly = {
  /** Number of weeks in the observed grid, including flat (cash) weeks. */
  weeks: number;
  totalReturn: number;
  maxDrawdown: number;
  worstWeek: number;
  bestWeek: number;
  meanWeekly: number;
  stdevWeekly: number;
  /** Annualised mean/stdev of weekly returns, in percent. Null under 2 weeks. */
  sharpe: number | null;
};

export type WeeklyBootstrap = {
  observed: ObservedWeekly;
  totalReturn: Distribution;
  maxDrawdown: Distribution;
  worstWeek: Distribution;
  /** Share of resampled paths that end below zero. */
  probNegative: number;
  /** Share of resampled paths whose max drawdown is worse than -20%. */
  probDrawdownBeyond20: number;
};

export type TradeBootstrap = {
  trades: number;
  observed: {
    winRate: number;
    avgReturn: number;
    avgR: number | null;
    profitFactor: number | null;
  };
  winRate: Distribution;
  avgReturn: Distribution;
  avgR: Distribution;
  profitFactor: Distribution;
  /** Share of resamples with non-positive average return. */
  probAvgReturnNegative: number;
  /** Share of resamples whose profit factor is below 1. */
  probProfitFactorBelow1: number;
  /** Resamples with no losing trade, so profit factor is undefined. */
  profitFactorUndefined: number;
};

export type MonteCarloResult = {
  options: Required<MonteCarloOptions>;
  weekly: WeeklyBootstrap;
  trades: TradeBootstrap;
  warnings: string[];
};

export type PairedComparison = {
  labelA: string;
  labelB: string;
  /** Weeks present in either series (flat where a variant was not invested). */
  weeks: number;
  /** Share of paired paths where A compounds to more than B. */
  probABeatsB: number;
  /** Distribution of terminal return difference A − B, in percentage points. */
  terminalDiff: Distribution;
  /** Distribution of mean weekly return difference A − B, in percentage points. */
  meanWeeklyDiff: Distribution;
};

const DEFAULT_OPTIONS: Required<MonteCarloOptions> = {
  iterations: 2000,
  blockWeeks: 4,
  seed: 42,
};

// ---------------------------------------------------------------------------
// Deterministic RNG (mulberry32) — reproducible without adding a dependency.
// ---------------------------------------------------------------------------

export function rngFor(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const mean = (values: number[]): number => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function percentiles(sorted: number[], position: number): number {
  if (!sorted.length) return 0;
  if (sorted.length === 1) return sorted[0];
  const index = (sorted.length - 1) * position;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}

export function distribution(values: number[]): Distribution {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    samples: sorted.length,
    mean: mean(sorted),
    stdev: stdev(sorted),
    min: sorted[0] ?? 0,
    p5: percentiles(sorted, 0.05),
    p25: percentiles(sorted, 0.25),
    p50: percentiles(sorted, 0.5),
    p75: percentiles(sorted, 0.75),
    p95: percentiles(sorted, 0.95),
    max: sorted[sorted.length - 1] ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Weekly series
// ---------------------------------------------------------------------------

const mondayOf = (date: string): string => {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
};

const DAYS_PER_WEEK = 7 * 86_400_000;

/**
 * Build the weekly weighted-return series exactly as `stats()` does, then fill
 * interior weeks with zero (cash). Flat weeks do not change compounding, but
 * they do belong in the denominator of any per-week statistic.
 */
export function weeklyReturns(trades: BacktestTrade[]): Array<{ week: string; returnPct: number }> {
  const weekly = new Map<string, number>();
  for (const trade of trades) {
    if (trade.status !== "CLOSED" || trade.returnPct === null || !trade.exitDate) continue;
    const week = mondayOf(trade.exitDate);
    weekly.set(week, (weekly.get(week) ?? 0) + (trade.weight / 100) * trade.returnPct);
  }
  if (weekly.size < 2) {
    return [...weekly.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([week, returnPct]) => ({ week, returnPct }));
  }
  const keys = [...weekly.keys()].sort();
  const start = new Date(`${keys[0]}T00:00:00Z`).getTime();
  const end = new Date(`${keys[keys.length - 1]}T00:00:00Z`).getTime();
  const out: Array<{ week: string; returnPct: number }> = [];
  for (let time = start; time <= end; time += DAYS_PER_WEEK) {
    const week = new Date(time).toISOString().slice(0, 10);
    out.push({ week, returnPct: weekly.get(week) ?? 0 });
  }
  return out;
}

function compound(returns: number[]): { total: number; maxDrawdown: number } {
  let equity = 1;
  let peak = 1;
  let drawdown = 0;
  for (const ret of returns) {
    equity *= 1 + ret / 100;
    if (equity <= 0) {
      equity = 0;
      drawdown = -100;
      break;
    }
    peak = Math.max(peak, equity);
    drawdown = Math.min(drawdown, equity / peak - 1);
  }
  return { total: (equity - 1) * 100, maxDrawdown: drawdown * 100 };
}

function observedWeekly(returns: number[]): ObservedWeekly {
  const { total, maxDrawdown } = compound(returns);
  const deviation = stdev(returns);
  return {
    weeks: returns.length,
    totalReturn: total,
    maxDrawdown: maxDrawdown,
    worstWeek: returns.length ? Math.min(...returns) : 0,
    bestWeek: returns.length ? Math.max(...returns) : 0,
    meanWeekly: mean(returns),
    stdevWeekly: deviation,
    sharpe: deviation > 0 ? (mean(returns) / deviation) * Math.sqrt(52) : null,
  };
}

/** One circular-block resample of `series`, preserving block order. */
function resampleBlocks(series: number[], blockWeeks: number, rng: () => number): number[] {
  const n = series.length;
  if (n === 0) return [];
  const block = Math.max(1, Math.min(blockWeeks, n));
  const out: number[] = [];
  while (out.length < n) {
    const start = Math.floor(rng() * n);
    for (let offset = 0; offset < block && out.length < n; offset += 1) out.push(series[(start + offset) % n]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Bootstrap engines
// ---------------------------------------------------------------------------

export function weeklyBootstrap(trades: BacktestTrade[], options: MonteCarloOptions = {}): WeeklyBootstrap {
  const resolved = { ...DEFAULT_OPTIONS, ...options };
  const series = weeklyReturns(trades);
  const returns = series.map((point) => point.returnPct);
  const rng = rngFor(resolved.seed);

  const totals: number[] = [];
  const drawdowns: number[] = [];
  const worstWeeks: number[] = [];
  let negative = 0;
  let deepDrawdown = 0;

  if (returns.length) {
    for (let i = 0; i < resolved.iterations; i += 1) {
      const path = resampleBlocks(returns, resolved.blockWeeks, rng);
      const { total, maxDrawdown } = compound(path);
      totals.push(total);
      drawdowns.push(maxDrawdown);
      worstWeeks.push(Math.min(...path));
      if (total < 0) negative += 1;
      if (maxDrawdown <= -20) deepDrawdown += 1;
    }
  }

  const iterations = Math.max(1, returns.length ? resolved.iterations : 1);
  return {
    observed: observedWeekly(returns),
    totalReturn: distribution(totals.length ? totals : [0]),
    maxDrawdown: distribution(drawdowns.length ? drawdowns : [0]),
    worstWeek: distribution(worstWeeks.length ? worstWeeks : [0]),
    probNegative: negative / iterations,
    probDrawdownBeyond20: deepDrawdown / iterations,
  };
}

export function tradeBootstrap(trades: BacktestTrade[], options: MonteCarloOptions = {}): TradeBootstrap {
  const resolved = { ...DEFAULT_OPTIONS, ...options };
  const settled = trades.filter((trade) => trade.status === "CLOSED" && trade.returnPct !== null);
  const returns = settled.map((trade) => trade.returnPct as number);
  const rValues = settled.map((trade) => trade.rMultiple);
  const rng = rngFor(resolved.seed ^ 0x9e3779b9);

  const winRates: number[] = [];
  const avgReturns: number[] = [];
  const avgRs: number[] = [];
  const profitFactors: number[] = [];
  let negative = 0;
  let pfBelowOne = 0;

  if (returns.length) {
    for (let i = 0; i < resolved.iterations; i += 1) {
      let wins = 0;
      let grossGain = 0;
      let grossLoss = 0;
      const sampledR: number[] = [];
      for (let j = 0; j < returns.length; j += 1) {
        // Sample the trade once so its return and its R stay tied together.
        const index = Math.floor(rng() * returns.length);
        const value = returns[index];
        if (value > 0) {
          wins += 1;
          grossGain += value;
        } else {
          grossLoss += Math.abs(value);
        }
        const rValue = rValues[index];
        if (rValue !== null) sampledR.push(rValue);
      }
      winRates.push((wins / returns.length) * 100);
      const average = (grossGain - grossLoss) / returns.length;
      avgReturns.push(average);
      if (average <= 0) negative += 1;
      if (sampledR.length) avgRs.push(mean(sampledR));
      if (grossLoss > 0) {
        const pf = grossGain / grossLoss;
        profitFactors.push(pf);
        if (pf < 1) pfBelowOne += 1;
      }
    }
  }

  const iterations = Math.max(1, returns.length ? resolved.iterations : 1);
  const wins = returns.filter((value) => value > 0);
  const grossGain = wins.reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(returns.filter((value) => value <= 0).reduce((sum, value) => sum + value, 0));

  return {
    trades: settled.length,
    observed: {
      winRate: returns.length ? (wins.length / returns.length) * 100 : 0,
      avgReturn: returns.length ? mean(returns) : 0,
      avgR: rValues.some((value) => value !== null) ? mean(rValues.filter((value): value is number => value !== null)) : null,
      profitFactor: grossLoss > 0 ? grossGain / grossLoss : null,
    },
    winRate: distribution(winRates.length ? winRates : [0]),
    avgReturn: distribution(avgReturns.length ? avgReturns : [0]),
    avgR: distribution(avgRs.length ? avgRs : [0]),
    profitFactor: distribution(profitFactors.length ? profitFactors : [0]),
    probAvgReturnNegative: negative / iterations,
    probProfitFactorBelow1: pfBelowOne / Math.max(1, profitFactors.length || 1),
    profitFactorUndefined: iterations - profitFactors.length,
  };
}

export function monteCarlo(trades: BacktestTrade[], options: MonteCarloOptions = {}): MonteCarloResult {
  const resolved = { ...DEFAULT_OPTIONS, ...options };
  const weekly = weeklyBootstrap(trades, resolved);
  const trade = tradeBootstrap(trades, resolved);
  const warnings: string[] = [];

  if (weekly.observed.weeks < 26) {
    warnings.push(
      `Only ${weekly.observed.weeks} weekly observations. Below ~26 weeks the drawdown distribution understates what a full year can do.`,
    );
  }
  if (trade.trades < 30) {
    warnings.push(`Only ${trade.trades} settled trades. Bootstrap intervals are wide by construction and trade selection noise dominates.`);
  }
  if (weekly.observed.weeks > 0 && resolved.blockWeeks * 5 > weekly.observed.weeks) {
    warnings.push(
      `A ${resolved.blockWeeks}-week block gives fewer than five independent blocks. Treat the tail percentiles as indicative.`,
    );
  }
  const losingTrades = trade.trades - Math.round((trade.observed.winRate / 100) * trade.trades);
  if (trade.trades > 0 && losingTrades < 5) {
    warnings.push(
      `Only ${losingTrades} losing trade${losingTrades === 1 ? "" : "s"} in the sample. Profit factor and the left tail are barely estimated.`,
    );
  }

  return { options: resolved, weekly, trades: trade, warnings };
}

// ---------------------------------------------------------------------------
// Paired variant comparison
// ---------------------------------------------------------------------------

/**
 * Compare two variants on the same weeks with the same block resamples. This is
 * the right test for "did the rule change help?", because both arms see the
 * same market path in every iteration. The result is the share of paths where
 * A outperforms B, not a p-value; read it as evidence, not proof.
 */
export function compareVariants(
  labelA: string,
  tradesA: BacktestTrade[],
  labelB: string,
  tradesB: BacktestTrade[],
  options: MonteCarloOptions = {},
): PairedComparison {
  const resolved = { ...DEFAULT_OPTIONS, ...options };
  const seriesA = new Map(weeklyReturns(tradesA).map((point) => [point.week, point.returnPct]));
  const seriesB = new Map(weeklyReturns(tradesB).map((point) => [point.week, point.returnPct]));
  if (!seriesA.size && !seriesB.size) {
    const flat = distribution([0]);
    return {
      labelA,
      labelB,
      weeks: 0,
      probABeatsB: 0,
      terminalDiff: flat,
      meanWeeklyDiff: flat,
    };
  }

  // Union with zero fill: a week one variant did not trade is cash for that arm.
  const weeks: string[] = [];
  const start = Math.min(
    ...[...seriesA.keys(), ...seriesB.keys()].map((week) => new Date(`${week}T00:00:00Z`).getTime()),
  );
  const end = Math.max(
    ...[...seriesA.keys(), ...seriesB.keys()].map((week) => new Date(`${week}T00:00:00Z`).getTime()),
  );
  for (let time = start; time <= end; time += DAYS_PER_WEEK) weeks.push(new Date(time).toISOString().slice(0, 10));

  const a = weeks.map((week) => seriesA.get(week) ?? 0);
  const b = weeks.map((week) => seriesB.get(week) ?? 0);
  const rng = rngFor(resolved.seed ^ 0x85ebca6b);

  const diffs: number[] = [];
  const weeklyDiffs: number[] = [];
  let wins = 0;
  for (let i = 0; i < resolved.iterations; i += 1) {
    // One set of block starts, applied to both arms: paired, not independent.
    const drawn: number[] = [];
    const block = Math.max(1, Math.min(resolved.blockWeeks, weeks.length));
    while (drawn.length < weeks.length) {
      const blockStart = Math.floor(rng() * weeks.length);
      for (let offset = 0; offset < block && drawn.length < weeks.length; offset += 1) drawn.push((blockStart + offset) % weeks.length);
    }
    const pathA = drawn.map((index) => a[index]);
    const pathB = drawn.map((index) => b[index]);
    const totalA = compound(pathA).total;
    const totalB = compound(pathB).total;
    const difference = totalA - totalB;
    diffs.push(difference);
    weeklyDiffs.push(mean(pathA) - mean(pathB));
    if (difference > 0) wins += 1;
  }

  return {
    labelA,
    labelB,
    weeks: weeks.length,
    probABeatsB: wins / Math.max(1, resolved.iterations),
    terminalDiff: distribution(diffs),
    meanWeeklyDiff: distribution(weeklyDiffs),
  };
}
