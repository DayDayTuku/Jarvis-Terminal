import test from "node:test";
import assert from "node:assert/strict";
import { stopTrigger, targetTrigger, tradeOutcome, type PriceBar, type PriorPosition } from "../lib/weekly-lifecycle.ts";
import { computeFeatures, runBacktest, simulateTrade, stats, type BacktestBar } from "../lib/backtest.ts";

const bar = (date: string, open: number, high: number, low: number, close: number): PriceBar => ({ date, open, high, low, close });
const round = (value: number | null, digits = 2) => (value === null ? null : Number(value.toFixed(digits)));

const item: PriorPosition = {
  ticker: "AAAA",
  setup: "breakout",
  score: 70,
  planned_entry_low: 980,
  planned_entry_high: 1000,
  invalidation: 940,
  target_one: 1080,
};

const project = (outcome: {
  status: string; entryDate: string | null; entryPrice: number | null;
  exitDate: string | null; exitPrice: number | null; exitReason: string;
  returnPct: number | null; rMultiple: number | null;
}) => ({
  status: outcome.status,
  entryDate: outcome.entryDate,
  entryPrice: outcome.entryPrice,
  exitDate: outcome.exitDate,
  exitPrice: outcome.exitPrice,
  exitReason: outcome.exitReason,
  returnPct: round(outcome.returnPct, 4),
  rMultiple: round(outcome.rMultiple, 4),
});

test("DEFAULT policy simulation is identical to tradeOutcome", () => {
  const scenarios: PriceBar[][] = [
    [bar("2026-01-05", 990, 1005, 985, 1000), bar("2026-01-06", 1000, 1020, 995, 1010), bar("2026-01-07", 1010, 1090, 1005, 1085)],
    [bar("2026-01-05", 990, 1005, 985, 1000), bar("2026-01-06", 995, 1000, 930, 940)],
    [bar("2026-01-05", 1100, 1110, 1050, 1060)], // never fills the 980-1000 range
    [bar("2026-01-05", 990, 1010, 985, 1005), bar("2026-01-06", 1005, 1030, 1000, 1020)],
  ];
  for (const bars of scenarios) {
    const simulated = simulateTrade({ item, bars, direction: "LONG", scaleOut: false, maxHoldingDays: null });
    assert.deepEqual(project(simulated), project(tradeOutcome(item, bars)));
  }
});

test("scale-out banks half at the target and holds the rest at break-even", () => {
  const bars = [
    bar("2026-01-05", 990, 1005, 985, 1000), // entry
    bar("2026-01-06", 1000, 1090, 995, 1080), // first target
    bar("2026-01-07", 1080, 1085, 985, 990), // falls back through break-even
  ];
  const scaled = simulateTrade({ item, bars, direction: "LONG", scaleOut: true, maxHoldingDays: null });
  const plain = simulateTrade({ item, bars, direction: "LONG", scaleOut: false, maxHoldingDays: null });
  assert.equal(plain.exitReason, "TARGET");
  assert.equal(scaled.exitReason, "SCALE");
  assert.equal(scaled.exitPrice, 990); // the break-even stop, not the original
  const target = targetTrigger(item);
  const expected = 0.5 * ((target - 990) / 990) * 100; // half at target, half at break-even
  assert.equal(round(scaled.returnPct, 4), round(expected, 4));
  assert.ok((scaled.returnPct as number) < (plain.returnPct as number));
});

test("a time stop closes a drifting position", () => {
  const bars = [
    bar("2026-01-05", 990, 1005, 985, 1000),
    bar("2026-01-06", 1001, 1007, 996, 1001),
    bar("2026-01-07", 1002, 1008, 997, 1002),
    bar("2026-01-08", 1003, 1009, 998, 1003),
    bar("2026-01-09", 1004, 1010, 999, 1004),
  ];
  const timed = simulateTrade({ item, bars, direction: "LONG", scaleOut: false, maxHoldingDays: 3 });
  assert.equal(timed.exitReason, "TIME");
  assert.equal(timed.exitDate, "2026-01-08");
  assert.equal(timed.exitPrice, 1003);
});

test("stopTrigger and targetTrigger agree with the price the simulation uses", () => {
  assert.equal(stopTrigger(item), 935);
  assert.equal(targetTrigger(item), 1080);
});

// ---------------------------------------------------------------------------

function businessDays(count: number, start = "2024-01-01"): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  while (dates.length < count) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function series(dates: string[], close: (index: number) => number, volumeAt: (index: number) => number): BacktestBar[] {
  return dates.map((date, index) => {
    const value = close(index);
    return {
      date,
      open: Math.round(value * 0.998),
      high: Math.round(value * 1.004),
      low: Math.round(value * 0.996),
      close: Math.round(value),
      volume: volumeAt(index),
    };
  });
}

test("computeFeatures reads a trend, a range and ATR from raw bars", () => {
  const dates = businessDays(260);
  const bars = series(dates, (index) => 1000 + index * 2, () => 1_000_000);
  const features = computeFeatures("AAAA", bars, bars.length - 1, "Tech");
  assert.ok(features.ema20 !== null && features.ema50 !== null && features.sma200 !== null);
  assert.ok((features.ema20 as number) >= (features.ema50 as number) && (features.ema50 as number) >= (features.sma200 as number));
  assert.ok(features.atr !== null && features.atr > 0);
  assert.ok(features.high1m !== null && features.low1m !== null);
  assert.ok(features.rsi !== null && features.rsi > 50);
});

test("runBacktest replays a weekly scan end to end and is deterministic", () => {
  const dates = businessDays(320);
  const tickers = ["AAAA", "BBBB", "CCCC"];
  const barsByTicker = new Map<string, BacktestBar[]>();
  tickers.forEach((ticker, offset) => {
    barsByTicker.set(
      ticker,
      series(
        dates,
        (index) => 1000 + offset * 40 + 90 * Math.sin(index / 22 + offset) + index * 1.2,
        (index) => 1_000_000 * (index % 5 === 0 ? 2.4 : 1),
      ),
    );
  });
  const scanDates = dates.filter((_, index) => index % 5 === 4 && index > 60);
  const sectors = new Map(tickers.map((ticker) => [ticker, "Tech"]));

  const first = runBacktest({ scanDates, barsByTicker, sectors });
  const second = runBacktest({ scanDates, barsByTicker, sectors });

  assert.deepEqual(first.summary, second.summary);
  assert.equal(first.scanDates.length, scanDates.length);
  assert.ok(first.trades.length > 0, "the synthetic universe should produce some trades");
  assert.deepEqual(Object.keys(first.bySetup[0] ?? {}).sort(), ["setup", "stats"]);
  // Every settled trade must carry a return and an R-multiple.
  for (const trade of first.trades.filter((t) => t.status === "CLOSED")) {
    assert.ok(typeof trade.returnPct === "number");
    assert.ok(typeof trade.rMultiple === "number");
  }
});

test("stats computes expectancy and profit factor from settled trades", () => {
  const trades = [
    { status: "CLOSED", returnPct: 10, rMultiple: 2 },
    { status: "CLOSED", returnPct: -5, rMultiple: -1 },
    { status: "CLOSED", returnPct: 5, rMultiple: 1 },
  ] as never;
  const summary = stats(trades);
  assert.equal(summary.trades, 3);
  assert.equal(summary.wins, 2);
  assert.equal(summary.winRate?.toFixed(0), "67");
  assert.equal(round(summary.avgReturn, 4), round(10 / 3, 4));
  assert.equal(round(summary.profitFactor, 4), 3); // 15 / 5
});
