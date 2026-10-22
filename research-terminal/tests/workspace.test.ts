import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_WATCHLIST_TICKERS,
  normalizeTicker,
  normalizeTickerList,
  sanitizeNoteBody,
  sanitizePositions,
  sanitizeSnapshot,
} from "../lib/workspace.ts";

test("tickers are normalized and validated", () => {
  assert.equal(normalizeTicker(" bbca "), "BBCA");
  assert.equal(normalizeTicker("ADRO.JK"), "ADRO");
  assert.equal(normalizeTicker("bmri.jk"), "BMRI");
  assert.equal(normalizeTicker("A B C"), null);
  assert.equal(normalizeTicker("<script>"), null);
  assert.equal(normalizeTicker(null), null);
  assert.equal(normalizeTicker("TOOLONGTICKER"), null);
});

test("watchlist ticker lists are deduplicated, normalized, and capped", () => {
  assert.deepEqual(normalizeTickerList(["bbca", "BBCA.JK", "adro", "bad ticker"]), ["BBCA", "ADRO"]);
  const many = Array.from({ length: MAX_WATCHLIST_TICKERS + 20 }, (_, index) => `T${index}`);
  assert.equal(normalizeTickerList(many).length, MAX_WATCHLIST_TICKERS);
  assert.deepEqual(normalizeTickerList("BBCA"), []);
});

test("portfolio positions are validated and duplicates merged", () => {
  const clean = sanitizePositions([
    { ticker: "bbca", value: 10_000_000 },
    { ticker: "BBCA.JK", value: 5_000_000 },
    { ticker: "ADRO", value: "2500000" },
  ]);
  assert.equal(clean.error, null);
  assert.deepEqual(clean.positions, [
    { ticker: "BBCA", value: 15_000_000 },
    { ticker: "ADRO", value: 2_500_000 },
  ]);

  assert.match(sanitizePositions([{ ticker: "!!!", value: 1 }]).error ?? "", /valid IDX ticker/);
  assert.match(sanitizePositions([{ ticker: "BBCA", value: -1 }]).error ?? "", /finite positive/);
  assert.match(sanitizePositions([{ ticker: "BBCA", value: Infinity }]).error ?? "", /finite positive/);
  assert.match(sanitizePositions("nope").error ?? "", /array/);
});

test("notes are trimmed and length-limited", () => {
  assert.equal(sanitizeNoteBody("  Watch Core PCE.  "), "Watch Core PCE.");
  assert.equal(sanitizeNoteBody("   "), null);
  assert.equal(sanitizeNoteBody("x".repeat(2001)), null);
  assert.equal(sanitizeNoteBody(42), null);
});

test("visit snapshots only retain expected fields", () => {
  const snapshot = sanitizeSnapshot({
    takenAt: "2026-10-22T00:00:00.000Z",
    regime: "REFLATION",
    breadthPositive: 6.7,
    breadthTotal: 11,
    liveFeeds: 5,
    secret: "do not store",
    nested: { a: 1 },
  });
  assert.deepEqual(snapshot, {
    takenAt: "2026-10-22T00:00:00.000Z",
    regime: "REFLATION",
    breadthPositive: 7,
    breadthTotal: 11,
    liveFeeds: 5,
  });
  assert.deepEqual(sanitizeSnapshot(null), {});
  assert.deepEqual(sanitizeSnapshot(["nope"]), {});
});
