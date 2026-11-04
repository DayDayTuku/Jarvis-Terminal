import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFundamentalMomentum,
  buildQuantamentalMap,
  buildQuantamentalUniverse,
  classifyQuadrant,
  median,
  sectorProfileFor,
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

function bank(overrides: Partial<QuantamentalRaw> = {}): QuantamentalRaw {
  return raw({
    ticker: "BANK",
    sector: "Financials",
    tvSector: "Finance",
    industry: "Major Banks",
    pb: 2,
    roe: 20,
    pe: 10,
    marketCap: 1_000_000_000_000,
    revenue: 220_000_000_000,
    netIncome: 55_000_000_000,
    revenueTtm: 220_000_000_000,
    netIncomeTtm: 55_000_000_000,
    revenueFy: 200_000_000_000,
    netIncomeFy: 50_000_000_000,
    revenueFq: 55_000_000_000,
    netIncomeFq: 15_000_000_000,
    equityFy: 250_000_000_000,
    equityFq: 260_000_000_000,
    assetsFy: 1_000_000_000_000,
    assetsFq: 1_020_000_000_000,
    epsTtm: 500,
    epsForward: 600,
    fcfFy: 40_000_000_000,
    fcfFq: 12_000_000_000,
    ...overrides,
  });
}

test("the map universe is unique and capped per sector", () => {
  const universe = buildQuantamentalUniverse();
  assert.equal(new Set(universe.map((entry) => entry.ticker)).size, universe.length);
  assert.ok(universe.length >= 40);

  const counts = new Map<string, number>();
  for (const entry of universe) counts.set(entry.sector, (counts.get(entry.sector) ?? 0) + 1);
  for (const count of counts.values()) assert.ok(count <= 5);
  assert.equal(universe.find((entry) => entry.ticker === "BBCA")?.sector, "Financials");
});

test("valuation basis follows the sector and profitability rules", () => {
  const stocks = buildQuantamentalMap([
    bank({ ticker: "BANK" }),
    raw({ ticker: "PROFIT", pe: 10 }),
    raw({ ticker: "LOSS", sector: "Technology", pe: -4, marketCap: 1_000, revenue: 500, netIncome: -100 }),
    raw({ ticker: "ZERO", sector: "Healthcare", pe: null, marketCap: null, revenue: null, pb: 1.5, roe: 0 }),
    raw({ ticker: "NONE", sector: "Industrials", pe: null, pb: null, revenue: null, marketCap: null }),
  ]).stocks;
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
  assert.equal(byTicker.get("NONE")?.gap, null);
});

test("P/S uses TTM revenue when it is supplied", () => {
  const [stock] = buildQuantamentalMap([
    raw({
      sector: "Technology",
      pe: null,
      pb: null,
      marketCap: 1_000,
      revenue: 400,
      revenueTtm: 500,
      netIncome: -10,
      netIncomeTtm: -10,
    }),
  ]).stocks;
  assert.equal(stock.basis, "ps");
  assert.equal(stock.metric, 2);
});

test("the valuation gap is positive when a stock is cheaper than its peers", () => {
  const stocks = buildQuantamentalMap([
    raw({ ticker: "CHEAP", pe: 10 }),
    raw({ ticker: "MID", pe: 20 }),
    raw({ ticker: "RICH", pe: 30 }),
  ]).stocks;
  const byTicker = new Map(stocks.map((stock) => [stock.ticker, stock]));
  assert.equal(byTicker.get("CHEAP")?.peerMedian, 20);
  assert.equal(byTicker.get("CHEAP")?.gap, 100);
  assert.equal(byTicker.get("MID")?.gap, 0);
  assert.equal(byTicker.get("RICH")?.gap, -33.33);
});

test("price momentum is separate from fundamental momentum", () => {
  const base = bank({ ticker: "SEPARATE", perf6m: 80, perf3m: 10 });
  const withoutPrice = buildFundamentalMomentum({ ...base, perf6m: null, perf3m: null });
  const withPrice = buildFundamentalMomentum(base);
  assert.equal(withPrice.score, withoutPrice.score);
  assert.ok(withPrice.score !== null);

  const stocks = buildQuantamentalMap([base]).stocks;
  assert.equal(stocks[0].priceMomentum, 80);
  assert.equal(stocks[0].momentum, 80);
});

test("fundamental momentum is a weighted 0-100 score with contributions", () => {
  const momentum = buildFundamentalMomentum(bank());
  assert.ok(momentum.score !== null);
  assert.ok(momentum.score >= 0 && momentum.score <= 100);
  assert.equal(momentum.components.length, 6);
  assert.deepEqual(
    momentum.components.map((component) => component.weight),
    [25, 20, 20, 15, 10, 10],
  );
  const available = momentum.components.filter((item) => item.status === "available");
  assert.ok(available.length >= 5);
  const contributionSum = available.reduce((sum, item) => sum + (item.contribution ?? 0), 0);
  assert.ok(Math.abs(contributionSum - momentum.score) < 0.2);
  assert.equal(momentum.sectorProfile, "bank");
});

test("missing fundamentals produce no score rather than zero", () => {
  const momentum = buildFundamentalMomentum(raw({ ticker: "BARE" }));
  assert.equal(momentum.score, null);
  assert.equal(momentum.confidence, "none");
  assert.ok(momentum.coverage < 0.5);
  assert.ok(momentum.components.every((component) => component.score === null));
});

test("unavailable components are excluded from the denominator, not zero-filled", () => {
  const withFcf = buildFundamentalMomentum(bank());
  const withoutFcf = buildFundamentalMomentum(bank({ fcfFy: null, fcfFq: null, fcfTtm: null }));
  assert.ok(withFcf.score !== null);
  assert.ok(withoutFcf.score !== null);
  assert.ok(withoutFcf.coverage < withFcf.coverage);
  const cash = withoutFcf.components.find((component) => component.key === "cashflow");
  assert.equal(cash?.status, "unavailable");
  assert.equal(cash?.contribution, null);
});

test("sector profiles select the right measure", () => {
  assert.equal(sectorProfileFor({ sector: "Financials", tvSector: "Finance", industry: "Major Banks" }), "bank");
  assert.equal(sectorProfileFor({ sector: "Energy", tvSector: "Energy Minerals", industry: "Coal" }), "mining");
  assert.equal(sectorProfileFor({ sector: "Consumer Non-Durables", tvSector: "Consumer Non-Durables", industry: "Food: Specialty/Candy" }), "consumer");
  assert.equal(sectorProfileFor({ sector: "Industrials", tvSector: "Industrial Services", industry: "Holding Company" }), "holding");
  assert.equal(sectorProfileFor({ sector: "Technology", tvSector: "Technology Services", industry: "Packaged Software" }), "general");
});

test("liquidity distinguishes thin and unknown", () => {
  const stocks = buildQuantamentalMap([
    raw({ ticker: "THIN", close: 100, avgVolume10d: 1_000_000 }),
    raw({ ticker: "LIQUID", close: 1_000, avgVolume10d: 10_000_000 }),
    raw({ ticker: "UNKNOWN", avgVolume10d: null }),
  ]).stocks;
  const byTicker = new Map(stocks.map((stock) => [stock.ticker, stock]));
  assert.equal(byTicker.get("THIN")?.liquidity, "thin");
  assert.equal(byTicker.get("LIQUID")?.liquidity, "liquid");
  assert.equal(byTicker.get("UNKNOWN")?.liquidity, "unknown");
  assert.equal(byTicker.get("UNKNOWN")?.thin, false);
});

test("quadrants split on the fair band and the score midpoint", () => {
  assert.equal(classifyQuadrant(6, 70), "re-rating");
  assert.equal(classifyQuadrant(6, 30), "value-trap");
  assert.equal(classifyQuadrant(-6, 70), "priced-in");
  assert.equal(classifyQuadrant(-6, 30), "de-rating");
  assert.equal(classifyQuadrant(5, 70), "improving");
  assert.equal(classifyQuadrant(-5, 30), "drifting");
  assert.equal(classifyQuadrant(6, null), "no-momentum");
  assert.equal(classifyQuadrant(null, 70), "no-valuation");
  assert.equal(classifyQuadrant(0, 50), "improving");
});

test("coverage separates no-score from no-valuation names", () => {
  const map = buildQuantamentalMap([
    bank({ ticker: "PLOTTED", perf6m: 5 }),
    bank({ ticker: "ALSO", perf6m: 8 }),
    bank({ ticker: "THIRD", perf6m: -3 }),
    raw({ ticker: "NOMOM", sector: "Financials", industry: "Major Banks", pb: 2, roe: 10, pe: 20, perf6m: null }),
    raw({ ticker: "NOVAL", pe: null, pb: null, marketCap: null, revenue: null, perf6m: 5 }),
  ]);
  assert.equal(map.plotted, 3);
  assert.equal(map.noMomentum, 1);
  assert.equal(map.noValuation, 1);
  assert.equal(map.coverage.fundamentals, 4);
  assert.equal(map.coverage.momentum, 4);
  assert.equal(map.coverage.both, 3);
  assert.equal(map.coverage.fundamentalScore, 3);
  assert.equal(map.universeSize, 5);
});

test("the valuation engine reports forward P/E, EV multiples and dividend yield only from real inputs", () => {
  const [stock] = buildQuantamentalMap([
    bank({
      ticker: "METRICS",
      close: 1_000,
      epsForward: 100,
      dividendPerShare: 50,
      enterpriseValue: 900_000_000_000,
      ebitdaTtm: 100_000_000_000,
      ebitTtm: 80_000_000_000,
    }),
  ]).stocks;
  const metric = (key: string) => stock.valuation.find((item) => item.key === key);

  assert.equal(metric("pe_forward")?.value, 10);
  assert.equal(metric("ev_ebitda")?.value, 9);
  assert.equal(metric("ev_ebit")?.value, 11.25);
  assert.equal(metric("dividend_yield")?.value, 5);
  assert.equal(metric("nav_discount")?.value, null);
  assert.equal(metric("nav_discount")?.providerReady, true);
});

test("valuation percentile needs at least five observations", () => {
  const rows = [raw({ ticker: "P1", pe: 10 })];
  const short = buildQuantamentalMap(rows, { history: { P1: [9, 10, 11] } }).stocks[0];
  assert.equal(short.valuationPercentile, null);
  assert.equal(short.historyObservations, 3);

  const long = buildQuantamentalMap(rows, { history: { P1: [9, 10, 11, 12, 13] } }).stocks[0];
  assert.equal(long.valuationPercentile, 40);
});

test("revision direction needs two estimate snapshots and is never guessed", () => {
  const rows = [raw({ ticker: "REV", epsForward: 100 })];
  assert.equal(buildQuantamentalMap(rows).stocks[0].revisionDirection, null);
  assert.equal(buildQuantamentalMap(rows, { revisionHistory: { REV: [100] } }).stocks[0].revisionDirection, null);
  assert.equal(buildQuantamentalMap(rows, { revisionHistory: { REV: [100, 110] } }).stocks[0].revisionDirection, "up");
  assert.equal(buildQuantamentalMap(rows, { revisionHistory: { REV: [100, 90] } }).stocks[0].revisionDirection, "down");
  assert.equal(buildQuantamentalMap(rows, { revisionHistory: { REV: [100, 100] } }).stocks[0].revisionDirection, "flat");
});

test("what changed diffs against a previous map", () => {
  const first = buildQuantamentalMap([bank({ ticker: "DIFF", perf6m: 5 })]);
  const second = buildQuantamentalMap([bank({ ticker: "DIFF", perf6m: 12, netIncomeFq: 20_000_000_000 })], {
    previous: first,
  });
  const changes = second.stocks[0].whatChanged;
  assert.ok(changes.length >= 3);
  const price = changes.find((change) => change.label === "Price momentum 6M");
  assert.equal(price?.delta, 7);
  const score = changes.find((change) => change.label === "Fundamental score");
  assert.ok(score && score.delta !== null && score.delta > 0);
  assert.deepEqual(buildQuantamentalMap([raw({ ticker: "NEW" })]).stocks[0].whatChanged, []);
});

test("median handles even, odd, empty and NaN samples", () => {
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
  assert.equal(symlogFraction(5), -symlogFraction(-5));
});
