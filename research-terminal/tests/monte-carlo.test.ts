import test from "node:test";
import assert from "node:assert/strict";
import {
  compareVariants,
  distribution,
  monteCarlo,
  tradeBootstrap,
  weeklyReturns,
  type Distribution,
} from "../lib/monte-carlo.ts";
import type { BacktestTrade } from "../lib/backtest.ts";

let serial = 0;

function trade(input: {
  exitDate: string | null;
  returnPct: number | null;
  weight?: number;
  rMultiple?: number | null;
  status?: BacktestTrade["status"];
}): BacktestTrade {
  serial += 1;
  return {
    weekOf: input.exitDate ?? "2026-01-05",
    ticker: `T${String(serial).padStart(3, "0")}`,
    setup: "breakout",
    score: 80,
    weight: input.weight ?? 100,
    direction: "LONG",
    status: input.status ?? "CLOSED",
    entryDate: input.exitDate,
    entryPrice: 1000,
    exitDate: input.exitDate,
    exitPrice: 1010,
    exitReason: "TARGET",
    returnPct: input.returnPct,
    rMultiple: input.rMultiple ?? (input.returnPct === null ? null : input.returnPct / 2),
  };
}

/** One trade per Friday, each earning `returnPct` at full weight. */
function weeklySeries(count: number, returnPct: number, start = Date.UTC(2026, 0, 9)): BacktestTrade[] {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(start + index * 7 * 86_400_000).toISOString().slice(0, 10);
    return trade({ exitDate: date, returnPct });
  });
}

const assertOrdered = (d: Distribution): void => {
  for (const value of [d.p5, d.p25, d.p50, d.p75, d.p95]) {
    assert.ok(value >= d.min - 1e-9 && value <= d.max + 1e-9, `percentile ${value} outside [${d.min}, ${d.max}]`);
  }
  assert.ok(d.p5 <= d.p25 && d.p25 <= d.p50 && d.p50 <= d.p75 && d.p75 <= d.p95, "percentiles must be ordered");
};

test("weeklyReturns fills interior cash weeks and ignores unsettled trades", () => {
  const series = weeklyReturns([
    trade({ exitDate: "2026-01-09", returnPct: 2 }), // week of Jan 5
    trade({ exitDate: "2026-01-23", returnPct: -1 }), // week of Jan 19, one week gap
    trade({ exitDate: "2026-01-30", returnPct: 5, status: "OPEN" }),
    trade({ exitDate: null, returnPct: null, status: "NO_ENTRY" }),
  ]);
  assert.deepEqual(
    series.map((point) => point.week),
    ["2026-01-05", "2026-01-12", "2026-01-19"],
  );
  assert.deepEqual(
    series.map((point) => point.returnPct),
    [2, 0, -1],
  );
});

test("distribution percentiles are ordered and bounded", () => {
  const d = distribution([-10, -2, 0, 1, 3, 5, 7, 9, 11, 40]);
  assertOrdered(d);
  assert.equal(d.samples, 10);
  assert.equal(d.min, -10);
  assert.equal(d.max, 40);
});

test("the same seed reproduces the same bootstrap", () => {
  const trades = weeklySeries(60, 0.4);
  const a = monteCarlo(trades, { iterations: 200, seed: 7 });
  const b = monteCarlo(trades, { iterations: 200, seed: 7 });
  assert.deepEqual(a.weekly.totalReturn, b.weekly.totalReturn);
  assert.deepEqual(a.trades.avgReturn, b.trades.avgReturn);
});

test("a constant positive weekly return has no path uncertainty", () => {
  const trades = weeklySeries(52, 1);
  const mc = monteCarlo(trades, { iterations: 500, seed: 3, blockWeeks: 4 });
  assert.equal(mc.weekly.observed.weeks, 52);
  assert.ok(Math.abs(mc.weekly.totalReturn.p50 - mc.weekly.observed.totalReturn) < 1e-9);
  assert.ok(Math.abs(mc.weekly.totalReturn.min - mc.weekly.totalReturn.max) < 1e-9);
  assert.equal(mc.weekly.maxDrawdown.max, 0);
  assert.equal(mc.weekly.probNegative, 0);
  assert.equal(mc.weekly.probDrawdownBeyond20, 0);
  assertOrdered(mc.weekly.totalReturn);
});

test("trade bootstrap keeps each trade's return and R tied together", () => {
  // Every trade has R = return / 2, so any resample must preserve that ratio.
  const trades = weeklySeries(40, 2);
  const boot = tradeBootstrap(trades, { iterations: 300, seed: 11 });
  assert.ok(boot.observed.avgR !== null);
  assert.ok(Math.abs((boot.avgR.p50 ?? 0) - (boot.observed.avgR ?? 0)) < 1e-9);
  assert.ok(boot.winRate.p5 >= 0 && boot.winRate.p95 <= 100);
});

test("trade bootstrap flags a losing sample as likely negative", () => {
  const losers = weeklySeries(40, -1);
  const boot = tradeBootstrap(losers, { iterations: 300, seed: 5 });
  assert.equal(boot.probAvgReturnNegative, 1);
  assert.equal(boot.probProfitFactorBelow1, 1);
});

test("paired comparison gives the stronger variant every path", () => {
  const base = weeklySeries(52, 0.5);
  const better = weeklySeries(52, 1.5);
  const comparison = compareVariants("better", better, "base", base, { iterations: 300, seed: 9, blockWeeks: 4 });
  assert.equal(comparison.weeks, 52);
  assert.equal(comparison.probABeatsB, 1);
  assert.ok(comparison.terminalDiff.p5 > 0, "even the 5th percentile of the advantage should be positive");
});

test("an identical variant ties every path and is never counted as a win", () => {
  const base = weeklySeries(52, 0.5);
  const copy = weeklySeries(52, 0.5);
  const comparison = compareVariants("base", base, "copy", copy, { iterations: 400, seed: 9 });
  assert.equal(comparison.probABeatsB, 0);
  assert.equal(comparison.terminalDiff.p50, 0);
});

test("small samples produce warnings instead of false precision", () => {
  const mc = monteCarlo(weeklySeries(6, 1), { iterations: 100, seed: 1 });
  assert.ok(mc.warnings.some((warning) => warning.includes("weekly observations")));
  assert.ok(mc.warnings.some((warning) => warning.includes("settled trades")));
});

test("empty input is handled without throwing", () => {
  const mc = monteCarlo([], { iterations: 50, seed: 1 });
  assert.equal(mc.weekly.observed.weeks, 0);
  assert.equal(mc.trades.trades, 0);
  assert.equal(mc.weekly.probNegative, 0);
  assert.equal(mc.trades.probAvgReturnNegative, 0);
  const comparison = compareVariants("a", [], "b", []);
  assert.equal(comparison.weeks, 0);
  assert.equal(comparison.terminalDiff.samples, 1);
});
