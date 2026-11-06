import test from "node:test";
import assert from "node:assert/strict";
import {
  BREADTH_BUFFER,
  BREADTH_CRASH,
  BREADTH_THRESHOLDS,
  applyBreadthHysteresis,
  rawBreadthRegime,
  readBreadth,
  type BreadthRow,
} from "../lib/market-breadth.ts";

const bull = (overrides: Partial<BreadthRow> = {}): BreadthRow => ({
  close: 100,
  change: 1,
  ema25: 90,
  ema50: 80,
  sma200: 70,
  high1m: 100,
  ...overrides,
});
const bear = (overrides: Partial<BreadthRow> = {}): BreadthRow => ({
  close: 50,
  change: -1,
  ema25: 90,
  ema50: 100,
  sma200: 120,
  high1m: 100,
  ...overrides,
});
const repeat = <T>(items: T[], count: number): T[] => Array.from({ length: count }, () => items).flat();

test("readBreadth: full participation reads 100 and RISK ON", () => {
  const read = readBreadth(repeat([bull()], 20));
  assert.equal(read.state, "live");
  assert.equal(Number(read.score?.toFixed(2)), 100);
  assert.equal(read.regime, "RISK ON");
  assert.equal(read.components.length, 5);
  assert.ok(read.components.every((item) => item.score === 100));
});

test("readBreadth: no participation reads 0 and RISK OFF", () => {
  const read = readBreadth(repeat([bear()], 20));
  assert.equal(Number(read.score?.toFixed(2)), 0);
  assert.equal(read.regime, "RISK OFF");
});

test("readBreadth: missing inputs leave the denominator instead of zero-filling", () => {
  const rows = repeat([bull({ sma200: null, high1m: null })], 20);
  const read = readBreadth(rows);
  assert.equal(read.state, "live");
  assert.equal(Number(read.score?.toFixed(2)), 100);
  // EMA25 + EMA50 + advance/decline are still available: 65% of the weight.
  assert.equal(Number(read.coverage.toFixed(2)), 0.65);
  assert.equal(read.components.filter((item) => item.score === null).length, 2);
});

test("readBreadth: a sample too thin to read yields no score and no regime", () => {
  const read = readBreadth(repeat([bull()], 4));
  assert.equal(read.state, "unavailable");
  assert.equal(read.score, null);
  assert.equal(read.regime, null);
});

test("readBreadth: near-high is centred on its 25% base rate", () => {
  const rows = [
    ...repeat([bull()], 5),
    ...repeat([bull({ high1m: 150 })], 15),
  ];
  const read = readBreadth(rows);
  const near = read.components.find((item) => item.key === "nearHigh");
  assert.ok(near);
  assert.equal(Number(near?.score?.toFixed(2)), 50);
  assert.equal(near?.sample, 20);
});

test("rawBreadthRegime: thresholds are inclusive", () => {
  assert.equal(rawBreadthRegime(BREADTH_THRESHOLDS.riskOn), "RISK ON");
  assert.equal(rawBreadthRegime(BREADTH_THRESHOLDS.riskOn - 0.01), "EMERGING");
  assert.equal(rawBreadthRegime(BREADTH_THRESHOLDS.emerging), "EMERGING");
  assert.equal(rawBreadthRegime(BREADTH_THRESHOLDS.emerging - 0.01), "NEUTRAL");
  assert.equal(rawBreadthRegime(BREADTH_THRESHOLDS.neutral), "NEUTRAL");
  assert.equal(rawBreadthRegime(BREADTH_THRESHOLDS.neutral - 0.01), "RISK OFF");
  assert.equal(rawBreadthRegime(null), null);
});

test("applyBreadthHysteresis: the buffer stops a single week flipping the book", () => {
  // RISK ON keeps its platform until the score falls BREADTH_BUFFER below 65.
  assert.equal(applyBreadthHysteresis(BREADTH_THRESHOLDS.riskOn - 1, "RISK ON"), "RISK ON");
  assert.equal(applyBreadthHysteresis(BREADTH_THRESHOLDS.riskOn - BREADTH_BUFFER, "RISK ON"), "EMERGING");
  assert.equal(applyBreadthHysteresis(BREADTH_THRESHOLDS.riskOn - BREADTH_BUFFER + 1, "RISK ON"), "RISK ON");

  // EMERGING upgrades only after the raw read is RISK ON and clears 65 + buffer.
  assert.equal(applyBreadthHysteresis(BREADTH_THRESHOLDS.riskOn + BREADTH_BUFFER - 1, "EMERGING"), "EMERGING");
  assert.equal(applyBreadthHysteresis(BREADTH_THRESHOLDS.riskOn + BREADTH_BUFFER, "EMERGING"), "RISK ON");

  // NEUTRAL steps up only once the read is EMERGING and clears 50 + buffer.
  assert.equal(applyBreadthHysteresis(BREADTH_THRESHOLDS.emerging + BREADTH_BUFFER - 1, "NEUTRAL"), "NEUTRAL");
  assert.equal(applyBreadthHysteresis(BREADTH_THRESHOLDS.emerging + BREADTH_BUFFER, "NEUTRAL"), "EMERGING");
  // ...and steps down only below 35 - buffer.
  assert.equal(applyBreadthHysteresis(BREADTH_THRESHOLDS.neutral - BREADTH_BUFFER + 1, "NEUTRAL"), "NEUTRAL");
  assert.equal(applyBreadthHysteresis(BREADTH_THRESHOLDS.neutral - BREADTH_BUFFER, "NEUTRAL"), "RISK OFF");
});

test("applyBreadthHysteresis: moves at most one step, and only with a prior", () => {
  assert.equal(applyBreadthHysteresis(90, "RISK OFF"), "NEUTRAL");
  assert.equal(applyBreadthHysteresis(90, null), "RISK ON");
  assert.equal(applyBreadthHysteresis(30, "RISK ON"), "EMERGING");
  assert.equal(applyBreadthHysteresis(90, "RISK ON"), "RISK ON");
});

test("applyBreadthHysteresis: a collapse overrides the buffer", () => {
  assert.equal(applyBreadthHysteresis(BREADTH_CRASH, "RISK ON"), "RISK OFF");
  assert.equal(applyBreadthHysteresis(BREADTH_CRASH + 1, "RISK ON"), "EMERGING");
  assert.equal(applyBreadthHysteresis(null, "RISK ON"), null);
});
