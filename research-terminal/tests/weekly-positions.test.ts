import test from "node:test";
import assert from "node:assert/strict";
import { buildLifecycle } from "../lib/weekly-positions.ts";
import type { PriceBar } from "../lib/weekly-lifecycle.ts";

const bar = (date: string, open: number, high: number, low: number, close: number): PriceBar => ({ date, open, high, low, close });
const calm = async () => [bar("2026-10-13", 1000, 1030, 960, 1025)];
const plan = { ticker: "AAAA", setup: "breakout", score: 70, planned_entry_low: 980, planned_entry_high: 1000, invalidation: 940, target_one: 1080, position_weight: 12.5 };
const priorRun = { id: "r1", week_of: "2026-10-10" };

test("buildLifecycle holds a prior pick that drops off the list", async () => {
  const rows = await buildLifecycle({ runId: "r2", priorRun, prior: [plan], current: [], carried: [], getBars: calm });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ticker, "AAAA");
  assert.equal(rows[0].action, "HOLD");
  assert.equal(rows[0].target_weight, 12.5);
});

test("buildLifecycle reviews a carried position and keeps its reduced weight", async () => {
  const rows = await buildLifecycle({ runId: "r2", priorRun, prior: [], current: [], carried: [{ plan: { ...plan, position_weight: 6.25 }, entryFilled: true, targetReached: false }], getBars: calm });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, "HOLD");
  assert.equal(rows[0].target_weight, 6.25);
  assert.equal(rows[0].entry_filled, true);
});

test("buildLifecycle stops a carried position whose stop is breached", async () => {
  const rows = await buildLifecycle({ runId: "r2", priorRun, prior: [], current: [], carried: [{ plan, entryFilled: true, targetReached: false }], getBars: async () => [bar("2026-10-13", 1000, 1010, 900, 910)] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, "EXIT");
  assert.equal(rows[0].invalidated, true);
});

test("buildLifecycle books a BUY for a genuinely new pick", async () => {
  const rows = await buildLifecycle({ runId: "r2", priorRun, prior: [], current: [{ ticker: "BBBB", score: 80, position_weight: 10 }], carried: [], getBars: calm });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, "BUY");
  assert.equal(rows[0].current_score, 80);
  assert.equal(rows[0].prior_run_id, "r1");
});
