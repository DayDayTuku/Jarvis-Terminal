import test from "node:test";
import assert from "node:assert/strict";
import {
  SCORE_SETUPS,
  buildReference,
  designRow,
  fitRidge,
  percentileRank,
  predictR,
  rawContinuous,
  scoreSignals,
  signalsOf,
  type FitSample,
  type ScoreModel,
  type ScoreSignals,
} from "../lib/score-model.ts";
import { classify, type SetupFeatures } from "../lib/setup-model.ts";

const signals = (overrides: Partial<ScoreSignals> = {}): ScoreSignals => ({
  relativeVolume: 1.2,
  rsi: 58,
  distance20: 1,
  change: 0.5,
  trend: true,
  aboveLongTrend: true,
  nearHigh: false,
  nearLow: false,
  setup: "pullback",
  ...overrides,
});

test("rawContinuous matches the trained feature definition", () => {
  const row = rawContinuous(signals({ relativeVolume: 3, rsi: 75, distance20: 10, change: 0 }));
  assert.equal(row.length, 8);
  assert.equal(row[0], 2); // relVol - 1, capped at 3
  assert.equal(row[1], 0.5); // (75 - 50) / 50
  assert.equal(row[2], 2); // distance20/5 clamped to 2
  assert.equal(row[3], 0); // change/5
  assert.equal(row[4], 1); // trend
});

test("designRow standardises continuous features then appends setup dummies", () => {
  const model: ScoreModel = {
    center: 50,
    scale: 50,
    standardization: Array.from({ length: 8 }, () => ({ mean: 0, std: 1 })),
    weights: new Array(1 + 8 + SCORE_SETUPS.length).fill(0),
    reference: [],
  };
  const row = designRow(model, signals({ setup: "momentum" }));
  assert.equal(row.length, 8 + SCORE_SETUPS.length);
  // Only the momentum dummy is on.
  const dummies = row.slice(8);
  assert.deepEqual(dummies, SCORE_SETUPS.map((key) => (key === "momentum" ? 1 : 0)));
});

test("percentileRank interpolates monotonically between reference points", () => {
  const reference = [0, 1, 2, 3];
  assert.equal(percentileRank(reference, -5), 0);
  assert.equal(percentileRank(reference, 5), 100);
  assert.equal(percentileRank(reference, 0), 0);
  assert.equal(percentileRank(reference, 3), 100);
  assert.ok(Math.abs(percentileRank(reference, 1) - 33.333) < 0.01);
  assert.ok(percentileRank(reference, 1) < percentileRank(reference, 2));
});

test("scoreSignals is a percentile of the reference when one is present", () => {
  const model: ScoreModel = {
    center: 50,
    scale: 50,
    standardization: Array.from({ length: 8 }, () => ({ mean: 0, std: 1 })),
    weights: [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // intercept 0, relVol weight 1
    reference: [0, 1, 2, 3],
  };
  // relVol 1.2 -> raw 0.2, standardised 0.2 -> predicted R 0.2.
  const score = scoreSignals(signals(), model);
  assert.ok(score > 0 && score < 100);
  // A higher relative volume must never score lower.
  assert.ok(scoreSignals(signals({ relativeVolume: 2.5 }), model) >= score);
});

test("fitRidge recovers a simple linear relationship", () => {
  const samples: FitSample[] = [];
  for (let i = 0; i < 400; i++) {
    const relativeVolume = 1 + (i % 40) / 20;
    samples.push({ signals: signals({ relativeVolume }), r: 0.5 * (relativeVolume - 1) });
  }
  const model = fitRidge(samples, 0.01);
  const high = predictR(model, signals({ relativeVolume: 2.5 }));
  const low = predictR(model, signals({ relativeVolume: 1.05 }));
  assert.ok(high > low, "higher relative volume should predict a higher R");
});

test("buildReference returns sorted quantiles spanning the predictions", () => {
  const model: ScoreModel = {
    center: 50,
    scale: 50,
    standardization: Array.from({ length: 8 }, () => ({ mean: 0, std: 1 })),
    weights: [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    reference: [],
  };
  const samples: FitSample[] = Array.from({ length: 50 }, (_, i) => ({ signals: signals({ relativeVolume: 1 + i / 50 }), r: 0 }));
  const reference = buildReference(samples, model, 11);
  assert.equal(reference.length, 11);
  assert.ok(reference.every((value, index) => index === 0 || value >= reference[index - 1]));
});

test("signalsOf reads the trained fields off a classified setup", () => {
  const features: SetupFeatures = {
    ticker: "IDX:BBCA",
    name: "Bank Central Asia",
    sector: "Financials",
    close: 1000,
    change: 0.5,
    volume: 500_000,
    averageVolume: 20_000_000,
    relativeVolume: 1.5,
    rsi: 60,
    ema20: 980,
    ema50: 960,
    sma200: 900,
    high1m: 990,
    low1m: 800,
    recommendation: 0.2,
    marketCap: 1_000_000_000,
    atr: 25,
  };
  const setup = classify(features, { shortEligible: new Set() });
  assert.ok(setup);
  const extracted = signalsOf(setup!);
  assert.equal(extracted.setup, setup!.setup);
  assert.equal(extracted.relativeVolume, setup!.relativeVolume);
  assert.equal(extracted.rsi, setup!.rsi);
  // The active score is the fitted percentile, and the legacy value is still kept.
  assert.ok(setup!.score >= 0 && setup!.score <= 100);
  assert.ok(typeof setup!.legacyScore === "number");
});
