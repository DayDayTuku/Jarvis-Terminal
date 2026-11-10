import test from "node:test";
import assert from "node:assert/strict";
import { IDX_UNIVERSE, searchIDXStocks } from "../lib/idx-universe.ts";
import { exposureOf } from "../lib/setup-model.ts";

const SECTORS = new Set([
  "Basic Materials", "Consumer Cyclicals", "Consumer Non-Cyclicals", "Energy",
  "Financials", "Healthcare", "Industrials", "Infrastructures",
  "Properties & Real Estate", "Technology", "Transportation & Logistics",
]);

test("universe: tickers are unique and well-formed", () => {
  const seen = new Set<string>();
  for (const stock of IDX_UNIVERSE) {
    assert.match(stock.ticker, /^[A-Z0-9]{4}\.JK$/, `${stock.ticker} is not a four-letter IDX ticker`);
    assert.ok(!seen.has(stock.ticker), `duplicate ticker ${stock.ticker}`);
    seen.add(stock.ticker);
    assert.ok(stock.name.trim().length > 0, `${stock.ticker} has no name`);
  }
});

test("universe: every name uses a known sector", () => {
  for (const stock of IDX_UNIVERSE) {
    assert.ok(SECTORS.has(stock.sector), `${stock.ticker} has unknown sector "${stock.sector}"`);
  }
});

test("universe: industry metadata is populated, with documented exceptions", () => {
  // ALII is a coal-logistics operator that the snapshot labels as hotels, so the
  // field is deliberately null there rather than copying a wrong peer group.
  const excepted = new Set(["ALII.JK"]);
  for (const stock of IDX_UNIVERSE) {
    if (excepted.has(stock.ticker)) {
      assert.equal(stock.industry, null, `${stock.ticker} is on the exception list but has an industry`);
      continue;
    }
    assert.equal(typeof stock.industry, "string", `${stock.ticker} is missing industry metadata`);
    assert.ok((stock.industry ?? "").trim().length > 0, `${stock.ticker} has a blank industry`);
  }
});

test("universe: the liquid additions are present and the delisted name is gone", () => {
  const tickers = new Set(IDX_UNIVERSE.map((stock) => stock.ticker));
  for (const ticker of ["EMAS.JK", "ARCI.JK", "PSAB.JK", "CMNT.JK", "PACK.JK", "INET.JK"]) {
    assert.ok(tickers.has(ticker), `${ticker} should be in the universe`);
  }
  // Mandala Multifinance no longer trades (Yahoo and TradingView both return no
  // data), so keeping it only offered users a dead search result.
  assert.ok(!tickers.has("MFIN.JK"), "MFIN is delisted and should not be in the universe");
});

test("exposure groups cover the new names", () => {
  assert.equal(exposureOf("EMAS"), "metals");
  assert.equal(exposureOf("PSAB"), "metals");
  assert.equal(exposureOf("CMNT"), "cement");
  assert.equal(exposureOf("ALII"), "coal");
  assert.equal(exposureOf("INET"), "telco");
  assert.equal(exposureOf("SSMS"), "palm_oil");
  assert.equal(exposureOf("PKPK"), "construction");
  // A name with no cross-sector group still falls back to its sector.
  assert.equal(exposureOf("SRTG", "Financials"), "sector:Financials");
});

test("search returns additions by ticker and by name", () => {
  assert.equal(searchIDXStocks("EMAS")[0]?.ticker, "EMAS.JK");
  assert.equal(searchIDXStocks("merdeka gold")[0]?.ticker, "EMAS.JK");
  assert.ok(!searchIDXStocks("MFIN").some((stock) => stock.ticker === "MFIN.JK"));
});
