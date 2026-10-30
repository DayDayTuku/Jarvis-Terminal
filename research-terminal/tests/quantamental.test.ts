import test from "node:test";
import assert from "node:assert/strict";
import {
  buildQuantamentalMap,
  buildQuantamentalUniverse,
  classifyQuadrant,
  median,
  symlogFraction,
  type QuantamentalRaw,
} from "../lib/quantamental.ts";

function raw(overrides: Partial<QuantamentalRaw> = {}): QuantamentalRaw {
  return {
    ticker: "TEST",
    name: "Test Ticker",
    sector: "Energy",
    tvSector: "Energy Minerals",
    close: 1_000,
    change: 0,
    marketCap: 1_000_000_000_000,
    pb: 1,
    pe: 10,
    roe: 10,
    revenue: 1_000_000_000_000,
    netIncome: 100_000_000_000,
    perf3m: null,
    perf6m: null,
    avgVolume10d: 10_000_000,
    ...overrides,
  };
}

test("the map universe is unique and capped per sector", () => {
  const universe = buildQuantamentalUniverse();
  assert.equal(new Set(universe.map((entry) => entry.ticker)).size, universe.length);
  assert.ok(universe.length >= 40);

  const counts = new Map<string, number>();
  for (const entry of universe) {
    counts.set(entry.sector, (counts.get(entry.sector) ?? 0) + 1);
  }
  for (const count of counts.values()) assert.ok(count <= 5);
  assert.equal(universe.find((entry) => entry.ticker === "BBCA")?.sector, "Financials");
});

test("valuation basis follows the sector and profitability rules", () => {
  const rows = [
    raw({ ticker: "BANK", sector: "Financials", pb: 2, roe: 20 }),
    raw({ ticker: "PROFIT", sector: "Energy", pe: 10 }),
    raw({ ticker: "LOSS", sector: "Technology", pe: -4, marketCap: 1_000, revenue: 500, netIncome: -100 }),
    raw({ ticker: "ZERO", sector: "Healthcare", pe: null, marketCap: null, revenue: null, pb: 1.5, roe: 0 }),
    raw({ ticker: "NONE", sector: "Industrials", pe: null, pb: null, revenue: null, marketCap: null }),
  ];
  const stocks = buildQuantamentalMap(rows).stocks;
  const byTicker = new Map(stocks.map((stock) => [stock.ticker, stock]));

  assert.equal(byTicker.get("BANK")?.basis, "pb_roe");
  assert.equal(byTicker.get("BANK")?.metric, 0.1);
  assert.equal(byTicker.get("PROFIT")?.basis, "pe");
  assert.equal(byTicker.get("PROFIT")?.metric, 10);
  assert.equal(byTicker.get("LOSS")?.basis, "ps");
  assert.equal(byTicker.get("LOSS")?.metric, 2);
  assert.equal(byTicker.get("ZERO")?.basis, "pb");
  assert.equal(byTicker.get("ZERO")?.metric, 1.5);
  assert.equal(byTicker.get("NONE")?.basis, "none");
  assert.equal(byTicker.get("NONE")?.metric, null);
  assert.equal(byTicker.get("NONE")?.gap, null);
});

test("the valuation gap is positive when a stock is cheaper than its peers", () => {
  const rows = [
    raw({ ticker: "CHEAP", pe: 10, perf6m: 10 }),
    raw({ ticker: "MID", pe: 20, perf6m: -10 }),
    raw({ ticker: "RICH", pe: 30, perf6m: 10 }),
  ];
  const stocks = buildQuantamentalMap(rows).stocks;
  const byTicker = new Map(stocks.map((stock) => [stock.ticker, stock]));

  assert.equal(byTicker.get("CHEAP")?.peerMedian, 20);
  assert.equal(byTicker.get("CHEAP")?.gap, 100);
  assert.equal(byTicker.get("MID")?.gap, 0);
  assert.equal(byTicker.get("RICH")?.gap, -33.33);
  assert.equal(byTicker.get("CHEAP")?.quadrant, "re-rating");
  assert.equal(byTicker.get("MID")?.quadrant, "drifting");
  assert.equal(byTicker.get("RICH")?.quadrant, "priced-in");
});

test("quadrants split on the fair band and the zero momentum line", () => {
  assert.equal(classifyQuadrant(6, 1), "re-rating");
  assert.equal(classifyQuadrant(6, -1), "value-trap");
  assert.equal(classifyQuadrant(-6, 1), "priced-in");
  assert.equal(classifyQuadrant(-6, -1), "de-rating");
  assert.equal(classifyQuadrant(5, 1), "improving");
  assert.equal(classifyQuadrant(-5, 1), "improving");
  assert.equal(classifyQuadrant(0, -1), "drifting");
  assert.equal(classifyQuadrant(6, 0), "re-rating");
  assert.equal(classifyQuadrant(6, null), "no-momentum");
  assert.equal(classifyQuadrant(null, 6), "no-valuation");
});

test("momentum falls back to three months and never invents a value", () => {
  const stocks = buildQuantamentalMap([
    raw({ ticker: "SIX", perf6m: 20, perf3m: 5 }),
    raw({ ticker: "THREE", perf6m: null, perf3m: 12.5 }),
    raw({ ticker: "NONE", perf6m: null, perf3m: null }),
  ]).stocks;
  const byTicker = new Map(stocks.map((stock) => [stock.ticker, stock]));

  assert.equal(byTicker.get("SIX")?.momentum, 20);
  assert.equal(byTicker.get("SIX")?.momentumBasis, "6M");
  assert.equal(byTicker.get("THREE")?.momentum, 12.5);
  assert.equal(byTicker.get("THREE")?.momentumBasis, "3M");
  assert.equal(byTicker.get("NONE")?.momentum, null);
  assert.equal(byTicker.get("NONE")?.momentumBasis, null);
});

test("thin turnover is flagged and missing volume stays unknown", () => {
  const stocks = buildQuantamentalMap([
    raw({ ticker: "THIN", close: 100, avgVolume10d: 1_000_000 }),
    raw({ ticker: "LIQUID", close: 1_000, avgVolume10d: 10_000_000 }),
    raw({ ticker: "UNKNOWN", avgVolume10d: null }),
  ]).stocks;
  const byTicker = new Map(stocks.map((stock) => [stock.ticker, stock]));

  assert.equal(byTicker.get("THIN")?.turnover, 100_000_000);
  assert.equal(byTicker.get("THIN")?.thin, true);
  assert.equal(byTicker.get("LIQUID")?.thin, false);
  assert.equal(byTicker.get("UNKNOWN")?.turnover, null);
  assert.equal(byTicker.get("UNKNOWN")?.thin, false);
});

test("coverage separates no-momentum from no-valuation names", () => {
  const map = buildQuantamentalMap([
    raw({ ticker: "PLOTTED", pe: 10, perf6m: 10 }),
    raw({ ticker: "NOMOM", pe: 20, perf6m: null, perf3m: null }),
    raw({ ticker: "NOVAL", pe: null, pb: null, marketCap: null, revenue: null, perf6m: 5 }),
    raw({ ticker: "ALSO", pe: 30, perf6m: 10 }),
  ]);

  assert.equal(map.plotted, 2);
  assert.equal(map.noMomentum, 1);
  assert.equal(map.noValuation, 1);
  assert.deepEqual(map.coverage, { fundamentals: 3, momentum: 3, both: 2 });
  assert.equal(map.quadrantCounts["re-rating"], 1);
  assert.equal(map.quadrantCounts["priced-in"], 1);
  assert.equal(map.universeSize, 4);
});

test("off-scale values are clamped and marked", () => {
  const map = buildQuantamentalMap([
    raw({ ticker: "CHEAP", pe: 10, perf6m: 250 }),
    raw({ ticker: "MID", pe: 20, perf6m: 0 }),
    raw({ ticker: "RICH", pe: 30, perf6m: 0 }),
  ]);
  const cheap = map.stocks.find((stock) => stock.ticker === "CHEAP");
  assert.ok(cheap);
  assert.equal(cheap?.offScaleX, true);
  assert.equal(cheap?.offScaleY, true);
});

test("median handles even, odd, and empty samples", () => {
  assert.equal(median([]), null);
  assert.equal(median([3]), 3);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([1, Number.NaN, 3]), 2);
});

test("the symlog scale is monotonic, centred, and clamped", () => {
  assert.equal(symlogFraction(0), 0);
  assert.ok(symlogFraction(5) > 0);
  assert.ok(symlogFraction(-5) < 0);
  assert.equal(symlogFraction(50), 1);
  assert.equal(symlogFraction(-50), -1);
  assert.equal(symlogFraction(500), 1);
  assert.equal(symlogFraction(-500), -1);
  assert.ok(symlogFraction(10) > symlogFraction(5));
  assert.ok(symlogFraction(20) > symlogFraction(10));
  assert.ok(symlogFraction(5) < 0.5);
  assert.equal(symlogFraction(5), -symlogFraction(-5));
});
