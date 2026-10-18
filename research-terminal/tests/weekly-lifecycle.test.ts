import test from "node:test";
import assert from "node:assert/strict";
import {
  alignPrice,
  collapseStreaks,
  deriveStatus,
  evaluatePosition,
  isShortSetup,
  nextPriceTick,
  positionTriggers,
  previousPriceTick,
  priceStep,
  stopTrigger,
  targetTrigger,
  tradeOutcome,
  weightOr,
  type PriceBar,
  type PriorPosition,
} from "../lib/weekly-lifecycle.ts";

const bar = (date: string, open: number, high: number, low: number, close: number): PriceBar => ({ date, open, high, low, close });
const round = (value: number | null, digits = 2) => (value === null ? null : Number(value.toFixed(digits)));

const long: PriorPosition = { ticker: "AAAA", setup: "breakout", score: 70, planned_entry_low: 980, planned_entry_high: 1000, invalidation: 940, target_one: 1080 };
const short: PriorPosition = { ticker: "BBBB", setup: "short_breakdown", score: 60, planned_entry_low: 1000, planned_entry_high: 1020, invalidation: 1060, target_one: 900 };

test("IDX tick maths", () => {
  assert.equal(priceStep(150), 1);
  assert.equal(priceStep(300), 2);
  assert.equal(priceStep(1000), 5);
  assert.equal(priceStep(3000), 10);
  assert.equal(priceStep(6000), 25);
  assert.equal(alignPrice(996, "nearest"), 995);
  assert.equal(alignPrice(996, "up"), 1000);
  assert.equal(alignPrice(996, "down"), 995);
  assert.equal(previousPriceTick(1000), 995);
  assert.equal(nextPriceTick(1000), 1005);
});

test("stop and target levels round away from the trade", () => {
  assert.equal(stopTrigger(long), 935);
  assert.equal(targetTrigger(long), 1080);
  assert.equal(stopTrigger({ ...long, hard_stop: 950 }), 945);
  assert.equal(stopTrigger({ ...long, hard_stop: 900 }), 935);
  assert.equal(stopTrigger(short), 1065);
  assert.equal(targetTrigger(short), 900);
  assert.equal(stopTrigger({ ...short, hard_stop: 1040 }), 1045);
  assert.equal(isShortSetup(short), true);
  assert.equal(isShortSetup(long), false);
});

test("tradeOutcome books a target win", () => {
  const bars = [bar("2026-10-12", 990, 1005, 975, 1000), bar("2026-10-13", 1000, 1090, 995, 1085)];
  const out = tradeOutcome(long, bars);
  assert.equal(out.status, "CLOSED");
  assert.equal(out.exitReason, "TARGET");
  assert.equal(out.entryPrice, 990);
  assert.equal(out.exitPrice, 1080);
  assert.equal(round(out.returnPct), 9.09);
  assert.equal(round(out.rMultiple), 1.64);
});

test("tradeOutcome books a stop loss", () => {
  const bars = [bar("2026-10-12", 990, 1005, 975, 1000), bar("2026-10-13", 1000, 1005, 930, 935)];
  const out = tradeOutcome(long, bars);
  assert.equal(out.status, "CLOSED");
  assert.equal(out.exitReason, "STOP");
  assert.equal(out.exitPrice, 935);
  assert.equal(round(out.returnPct), -5.56);
  assert.equal(round(out.rMultiple), -1);
});

test("tradeOutcome returns NO_ENTRY when the range never trades", () => {
  const bars = [bar("2026-10-12", 1010, 1030, 1005, 1020), bar("2026-10-13", 1020, 1040, 1015, 1030)];
  const out = tradeOutcome(long, bars);
  assert.equal(out.status, "NO_ENTRY");
  assert.equal(out.exitReason, "NO_ENTRY");
  assert.equal(out.returnPct, null);
  assert.equal(out.rMultiple, null);
});

test("tradeOutcome handles a profitable short", () => {
  const bars = [bar("2026-10-12", 1010, 1020, 990, 1000), bar("2026-10-13", 1000, 1005, 895, 900)];
  const out = tradeOutcome(short, bars);
  assert.equal(out.direction, "SHORT");
  assert.equal(out.exitReason, "TARGET");
  assert.equal(round(out.returnPct), 10.89);
  assert.equal(round(out.rMultiple), 2);
});

test("a bar touching both stop and target is booked as a stop", () => {
  const bars = [bar("2026-10-12", 990, 1005, 975, 1000), bar("2026-10-13", 1000, 1090, 930, 1000)];
  const out = tradeOutcome(long, bars);
  assert.equal(out.exitReason, "STOP");
  assert.equal(out.exitPrice, 935);
});

test("tradeOutcome is OPEN at the end of the window", () => {
  const bars = [bar("2026-10-12", 990, 1005, 975, 1000), bar("2026-10-13", 1000, 1030, 960, 1025)];
  const out = tradeOutcome(long, bars);
  assert.equal(out.status, "OPEN");
  assert.equal(out.exitReason, "WEEK_END");
  assert.equal(out.exitPrice, 1025);
  assert.equal(round(out.returnPct), 3.54);
});

test("collapseStreaks joins consecutive weeks and closes gaps", () => {
  assert.deepEqual(collapseStreaks([], 4), []);
  assert.deepEqual(collapseStreaks([0, 1, 2], 4), [{ openIndex: 0, closeIndex: 3 }]);
  assert.deepEqual(collapseStreaks([0, 2], 4), [{ openIndex: 0, closeIndex: 1 }, { openIndex: 2, closeIndex: 3 }]);
  assert.deepEqual(collapseStreaks([3], 4), [{ openIndex: 3, closeIndex: null }]);
  assert.deepEqual(collapseStreaks([0], 1), [{ openIndex: 0, closeIndex: null }]);
  assert.deepEqual(collapseStreaks([0, 1], 2), [{ openIndex: 0, closeIndex: null }]);
  assert.deepEqual(collapseStreaks([1, 0], 3), [{ openIndex: 0, closeIndex: 2 }]);
  assert.deepEqual(collapseStreaks([0, 1, 2, 3], 4), [{ openIndex: 0, closeIndex: null }]);
  assert.deepEqual(collapseStreaks([0, 3], 4), [{ openIndex: 0, closeIndex: 1 }, { openIndex: 3, closeIndex: null }]);
  assert.deepEqual(collapseStreaks([0, 2, 4], 5), [{ openIndex: 0, closeIndex: 1 }, { openIndex: 2, closeIndex: 3 }, { openIndex: 4, closeIndex: null }]);
});

test("deriveStatus always lets a stop win over a target", () => {
  assert.equal(deriveStatus({ action: "EXIT", entryFilled: true, targetReached: true, invalidated: true }), "STOPPED");
  assert.equal(deriveStatus({ action: "REDUCE", entryFilled: true, targetReached: true, invalidated: false }), "TARGET_HIT");
  assert.equal(deriveStatus({ action: "NO_ENTRY", entryFilled: false, targetReached: false, invalidated: false }), "NO_ENTRY");
  assert.equal(deriveStatus({ action: "EXPIRED", entryFilled: false, targetReached: false, invalidated: false }), "EXPIRED");
  assert.equal(deriveStatus({ action: "EXIT", entryFilled: true, targetReached: false, invalidated: false }), "CLOSED");
  assert.equal(deriveStatus({ action: "BUY", entryFilled: false, targetReached: false, invalidated: false }), "AWAITING_ENTRY");
  assert.equal(deriveStatus({ action: "HOLD", entryFilled: true, targetReached: false, invalidated: false }), "OPEN");
});

test("evaluatePosition closes a stopped position and never relabels it a hit", () => {
  const bars = [bar("2026-10-12", 990, 1005, 975, 1000), bar("2026-10-13", 1000, 1090, 930, 1000)];
  const out = evaluatePosition(long, bars);
  assert.equal(out.action, "EXIT");
  assert.equal(out.invalidated, true);
  assert.equal(out.targetReached, true);
  assert.equal(out.targetWeight, 0);
});

test("evaluatePosition treats a stopped-then-reselected name as a fresh BUY", () => {
  const bars = [bar("2026-10-12", 990, 1005, 975, 1000), bar("2026-10-13", 1000, 1005, 930, 935)];
  const out = evaluatePosition(long, bars, { ticker: "AAAA", score: 80, position_weight: 10 });
  assert.equal(out.action, "BUY");
  assert.equal(out.previousScore, null);
  assert.equal(out.invalidated, true);
});

test("evaluatePosition reduces on a first target while still selected", () => {
  const bars = [bar("2026-10-12", 990, 1005, 975, 1000), bar("2026-10-13", 1000, 1090, 995, 1085)];
  const out = evaluatePosition(long, bars, { ticker: "AAAA", score: 72 });
  assert.equal(out.action, "REDUCE");
  assert.equal(out.targetReached, true);
  assert.equal(out.targetWeight, 6.25);
});

test("evaluatePosition closes on a target when the name drops out", () => {
  const bars = [bar("2026-10-12", 990, 1005, 975, 1000), bar("2026-10-13", 1000, 1090, 995, 1085)];
  const out = evaluatePosition(long, bars);
  assert.equal(out.action, "EXIT");
  assert.equal(out.targetReached, true);
});

test("evaluatePosition holds a filled position that drops off the list", () => {
  const bars = [bar("2026-10-12", 990, 1005, 975, 1000)];
  const out = evaluatePosition(long, bars);
  assert.equal(out.action, "HOLD");
  assert.equal(out.entryFilled, true);
  assert.equal(out.invalidated, false);
  assert.equal(out.targetWeight, 12.5);
});

test("tradeOutcome marks a hold out at the session cap", () => {
  const bars = [bar("2026-10-12", 990, 1005, 975, 1000), bar("2026-10-13", 1000, 1030, 960, 1025)];
  const out = tradeOutcome(long, bars, { maxHoldingDays: 1 });
  assert.equal(out.status, "CLOSED");
  assert.equal(out.exitReason, "TIME");
  assert.equal(out.exitPrice, 1025);
});

test("evaluatePosition carries a filled position whose entry is outside the window", () => {
  // No bar touches the entry range, so entryTouch finds nothing. Without the
  // carried state this would wrongly read the live position as EXPIRED.
  const bars = [bar("2026-10-14", 1010, 1030, 1005, 1020)];
  const out = evaluatePosition(long, bars, undefined, { entryFilled: true, targetReached: false });
  assert.equal(out.action, "HOLD");
  assert.equal(out.entryFilled, true);
  assert.equal(out.targetWeight, 12.5);
});

test("evaluatePosition stops a carried position when the stop is breached", () => {
  const bars = [bar("2026-10-14", 1000, 1010, 900, 910)];
  const out = evaluatePosition(long, bars, undefined, { entryFilled: true, targetReached: false });
  assert.equal(out.action, "EXIT");
  assert.equal(out.invalidated, true);
});

test("positionTriggers tracks a carried position over the whole window", () => {
  const bars = [bar("2026-10-14", 1000, 1010, 900, 910)];
  const triggers = positionTriggers(long, bars, { entered: true });
  assert.equal(triggers.entered, true);
  assert.equal(triggers.stopped, true);
});

test("evaluatePosition expires an unfilled name that drops out", () => {
  const bars = [bar("2026-10-12", 1010, 1030, 1005, 1020)];
  const out = evaluatePosition(long, bars);
  assert.equal(out.action, "EXPIRED");
  assert.equal(out.entryFilled, false);
});

test("evaluatePosition flags NO_ENTRY when still selected but never filled", () => {
  const bars = [bar("2026-10-12", 1010, 1030, 1005, 1020)];
  const out = evaluatePosition(long, bars, { ticker: "AAAA", score: 71 });
  assert.equal(out.action, "NO_ENTRY");
  assert.equal(out.targetWeight, 0);
});

test("evaluatePosition reduces on a five-point score drop", () => {
  const bars = [bar("2026-10-12", 990, 1005, 975, 1000)];
  const out = evaluatePosition(long, bars, { ticker: "AAAA", score: 60 });
  assert.equal(out.action, "REDUCE");
  assert.equal(out.previousScore, 70);
});

test("evaluatePosition holds a stable, filled continuation", () => {
  const bars = [bar("2026-10-12", 990, 1005, 975, 1000)];
  const out = evaluatePosition(long, bars, { ticker: "AAAA", score: 69 });
  assert.equal(out.action, "HOLD");
  assert.equal(out.targetWeight, 12.5);
});

test("positionTriggers reports the same window the rollover uses", () => {
  const bars = [bar("2026-10-12", 990, 1005, 975, 1000), bar("2026-10-13", 1000, 1030, 960, 1025)];
  const triggers = positionTriggers(long, bars);
  assert.equal(triggers.entered, true);
  assert.equal(triggers.stopped, false);
  assert.equal(triggers.targetHit, false);
  assert.equal(triggers.sessionLow, 960);
  assert.equal(triggers.sessionHigh, 1030);
  assert.equal(triggers.stopTrigger, 935);
  assert.equal(triggers.targetTrigger, 1080);
});

test("weightOr keeps a deliberate 0% and only defaults a missing weight", () => {
  assert.equal(weightOr(0), 0);
  assert.equal(weightOr(12.5), 12.5);
  assert.equal(weightOr(7), 7);
  assert.equal(weightOr(null), 12.5);
  assert.equal(weightOr(undefined), 12.5);
  assert.equal(weightOr(Number.NaN), 12.5);
  assert.equal(weightOr(0, 9), 0);
  assert.equal(weightOr(undefined, 9), 9);
});

test("a 0% stand-aside week never resurrects a full-size position", () => {
  // Fresh re-entry after a stop, but the week is standing aside (0%).
  const stopped = [bar("2026-10-12", 990, 1005, 975, 1000), bar("2026-10-13", 1000, 1005, 930, 935)];
  assert.equal(evaluatePosition(long, stopped, { ticker: "AAAA", score: 80, position_weight: 0 }).targetWeight, 0);
  // A held 0% position keeps its 0% on HOLD and on REDUCE.
  const filled = [bar("2026-10-12", 990, 1005, 975, 1000)];
  assert.equal(evaluatePosition({ ...long, position_weight: 0 }, filled, { ticker: "AAAA", score: 69 }).targetWeight, 0);
  assert.equal(evaluatePosition({ ...long, position_weight: 0 }, filled, { ticker: "AAAA", score: 60 }).targetWeight, 0);
  assert.equal(evaluatePosition({ ...long, position_weight: 0 }, filled).targetWeight, 0);
});
