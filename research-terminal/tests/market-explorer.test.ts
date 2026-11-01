import test from "node:test";
import assert from "node:assert/strict";
import {
  coerceMarketQuotes,
  homeMarketPulse,
  rankMovers,
  screenQuotes,
  sectorMoves,
  sectorOptions,
  type MarketQuote,
} from "../lib/market-explorer.ts";

const quote = (overrides: Partial<MarketQuote> = {}): MarketQuote => ({
  ticker: "BBCA",
  name: "Bank Central Asia",
  sector: "Financials",
  close: 9000,
  change: 1.2,
  volume: 1000,
  relativeVolume: 1.1,
  rsi: 55,
  ema20: 8900,
  ema50: 8700,
  sma200: 8500,
  high1m: 9200,
  low1m: 8400,
  marketCap: 1_000_000,
  ...overrides,
});

test("scanner rows are coerced defensively and unsafe closes dropped", () => {
  const quotes = coerceMarketQuotes({
    quotes: [
      { ticker: "IDX:BBCA", name: "Bank Central Asia", sector: "Financials", close: 9000, change: 1.2 },
      { ticker: "IDX:BBCA", name: "duplicate", close: 9001 },
      { ticker: "IDX:BAD", close: null },
      { ticker: "", close: 100 },
      { ticker: "IDX:TLKM", close: 3200, change: null },
    ],
  });
  assert.deepEqual(quotes.map((item) => item.ticker), ["BBCA", "TLKM"]);
  assert.equal(quotes[0].name, "Bank Central Asia");
  assert.equal(quotes[1].change, null);
  assert.equal(quotes[1].sector, "Other");
});

test("missing or malformed scanner payloads yield no rows", () => {
  assert.deepEqual(coerceMarketQuotes(null), []);
  assert.deepEqual(coerceMarketQuotes({}), []);
  assert.deepEqual(coerceMarketQuotes({ quotes: "nope" }), []);
});

test("movers never rank a null metric as zero", () => {
  const rows = [
    quote({ ticker: "A", change: 5 }),
    quote({ ticker: "B", change: null }),
    quote({ ticker: "C", change: -4 }),
    quote({ ticker: "D", change: 1 }),
  ];
  assert.deepEqual(rankMovers(rows, "change", "up", 2).map((item) => item.ticker), ["A", "D"]);
  assert.deepEqual(rankMovers(rows, "change", "down", 2).map((item) => item.ticker), ["C", "D"]);
  assert.equal(rankMovers(rows, "change", "up", 10).some((item) => item.ticker === "B"), false);
});

test("screener filters by sector, direction, query and sorts nulls last", () => {
  const rows = [
    quote({ ticker: "BBCA", sector: "Financials", change: 2 }),
    quote({ ticker: "TLKM", sector: "Infrastructures", change: -1 }),
    quote({ ticker: "GOTO", sector: "Technology", change: null }),
    quote({ ticker: "BMRI", sector: "Financials", change: 4 }),
  ];
  assert.deepEqual(
    screenQuotes(rows, { query: "", sector: "Financials", direction: "all", sort: "change" }).map((item) => item.ticker),
    ["BMRI", "BBCA"],
  );
  assert.deepEqual(
    screenQuotes(rows, { query: "tlk", sector: "ALL", direction: "all", sort: "change" }).map((item) => item.ticker),
    ["TLKM"],
  );
  assert.deepEqual(
    screenQuotes(rows, { query: "", sector: "ALL", direction: "down", sort: "change" }).map((item) => item.ticker),
    ["TLKM"],
  );
  assert.deepEqual(
    screenQuotes(rows, { query: "", sector: "ALL", direction: "all", sort: "ticker" }).map((item) => item.ticker),
    ["BBCA", "BMRI", "GOTO", "TLKM"],
  );
  assert.deepEqual(sectorOptions(rows), ["Financials", "Infrastructures", "Technology"]);
});

test("home pulse reports breadth and real gainers/losers only", () => {
  const heatmap = [
    { label: "ENERGY", daily: 1.2, weekly: 2, constituents: [
      { ticker: "ADRO", price: 2500, daily: 3.4, weekly: 4 },
      { ticker: "BUMI", price: 180, daily: -2.1, weekly: -1 },
    ] },
    { label: "FINANCIALS", daily: -0.4, weekly: -1, constituents: [
      { ticker: "BBCA", price: 9000, daily: -1.5, weekly: 0.5 },
      { ticker: "BMRI", price: 6000, daily: null, weekly: null },
    ] },
    { label: "NO DATA", daily: null, weekly: null, constituents: [] },
  ];
  const pulse = homeMarketPulse(heatmap, 1);
  assert.equal(pulse.coverage, 3);
  assert.equal(pulse.sectors, 2);
  assert.equal(pulse.positiveSectors, 1);
  assert.deepEqual(pulse.gainers.map((item) => item.ticker), ["ADRO"]);
  assert.deepEqual(pulse.losers.map((item) => item.ticker), ["BUMI"]);
  assert.equal(sectorMoves(heatmap).length, 3);
});
