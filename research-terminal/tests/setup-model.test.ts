import test from "node:test";
import assert from "node:assert/strict";
import {
  CORE_SETUPS,
  DEFAULT_POLICY,
  classify,
  pickLongs,
  pickShort,
  planLevels,
  positionKind,
  positionWeight,
  regimeFor,
  selectWeek,
  shortWeight,
  type Regime,
  type SetupFeatures,
  type ScoredSetup,
} from "../lib/setup-model.ts";

const base: SetupFeatures = {
  ticker: "IDX:BBCA",
  name: "Bank Central Asia",
  sector: "Financials",
  close: 1000,
  change: 0.5,
  volume: 500_000,
  averageVolume: 300_000,
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

const shortEligible = new Set(["BBRI"]);

test("classify: a breakout scores and plans exactly as before", () => {
  const setup = classify(base, { shortEligible });
  assert.ok(setup);
  assert.equal(setup.setup, "breakout");
  // The active score is the fitted percentile; the legacy heuristic is preserved
  // separately so the old behaviour is still pinned by a test.
  assert.equal(setup.legacyScore, 87); // 58 + 9 + 12 + 8
  assert.ok(setup.score >= 0 && setup.score <= 100);
  assert.equal(setup.entryLow, 990);
  assert.equal(setup.entryHigh, 1010);
  assert.equal(setup.invalidation, 940); // close * 0.94
  assert.equal(setup.target, 1120); // close + risk * 2
  assert.equal(setup.riskReward, 2);
  assert.equal(setup.measuredRiskReward, 2);
  assert.equal(Number(setup.stopDistancePct.toFixed(2)), 6);
});

test("classify: rejects illiquid and sub-50 rupiah names", () => {
  assert.equal(classify({ ...base, close: 40 }, { shortEligible }), null);
  assert.equal(classify({ ...base, volume: 50_000 }, { shortEligible }), null);
  assert.equal(classify({ ...base, averageVolume: 100_000 }, { shortEligible }), null);
});

test("classify: shorts only fire for BEI-eligible tickers", () => {
  const weak: SetupFeatures = {
    ...base,
    ticker: "IDX:BBRI",
    close: 1000,
    ema20: 1020,
    ema50: 1030,
    sma200: 1100,
    low1m: 950,
    high1m: 1200,
    relativeVolume: 1.3,
    rsi: 40,
    recommendation: -0.3,
  };
  const eligible = classify(weak, { shortEligible });
  assert.ok(eligible);
  assert.equal(eligible.setup, "short_breakdown");
  assert.equal(eligible.riskReward, 2);
  // The same row for a non-eligible ticker must never be a short.
  const blocked = classify({ ...weak, ticker: "IDX:ZZZZ" }, { shortEligible });
  assert.notEqual(blocked?.setup, "short_breakdown");
});

test("planLevels: an ATR stop widens with volatility", () => {
  const calm = planLevels({ close: 1000, ema20: 980, low1m: 800, high1m: 1200, atr: 25, setup: "breakout", policy: { ...DEFAULT_POLICY, stopMode: "atr" } });
  const wild = planLevels({ close: 1000, ema20: 980, low1m: 800, high1m: 1200, atr: 50, setup: "breakout", policy: { ...DEFAULT_POLICY, stopMode: "atr" } });
  assert.equal(calm.invalidation, 950); // 1000 - 2*25
  assert.equal(wild.invalidation, 900); // 1000 - 2*50
  assert.ok(wild.stopDistancePct > calm.stopDistancePct);
});

test("planLevels: room mode stops claiming reward it cannot reach", () => {
  const capped = planLevels({ close: 1000, ema20: 980, low1m: 800, high1m: 1080, atr: 25, setup: "breakout", policy: { ...DEFAULT_POLICY, targetMode: "room" } });
  assert.equal(capped.target, 1080); // capped at the 1-month high, not 1000 + 2*60
  assert.ok(capped.riskReward < 2);
  assert.equal(capped.riskReward, capped.measuredRiskReward);
});

test("regimeFor: breadth decides the regime", () => {
  const made = (score: number): ScoredSetup => ({ setup: "pullback", score, riskReward: 2 });
  assert.equal(regimeFor([made(76), made(76), made(76), made(76), made(76)]), "RISK ON");
  assert.equal(regimeFor([made(76), made(76), made(76)]), "EMERGING");
  assert.equal(regimeFor([made(90)]), "NEUTRAL");
  assert.equal(regimeFor([made(60)]), "RISK OFF");
});

test("pickLongs: regime gates the count, sector caps at two", () => {
  const made = (ticker: string, score: number, sector: string): ScoredSetup & { ticker: string } => ({ ticker, setup: "momentum", score, riskReward: 2, sector });
  const crowded = [made("A", 90, "Energy"), made("B", 89, "Energy"), made("C", 88, "Energy")];
  assert.equal(pickLongs(crowded, "RISK ON").length, 2);
  assert.equal(pickLongs(crowded, "NEUTRAL").length, 1);
  assert.equal(pickLongs(crowded, "RISK OFF").length, 0);
  const pick = pickLongs([made("A", 80, "Tech"), made("B", 88, "Tech")], "NEUTRAL");
  assert.equal(pick[0].ticker, "B"); // 80 fails the 85 gate
});

test("pickShort: one short, and only a strong one", () => {
  const made = (score: number): ScoredSetup => ({ setup: "short_breakdown", score, riskReward: 2 });
  assert.equal(pickShort([made(80)]).length, 0);
  assert.equal(pickShort([made(90)]).length, 1);
});

test("positionKind documents that only a high pullback is CORE", () => {
  assert.deepEqual([...CORE_SETUPS], ["pullback"]);
  assert.equal(positionKind({ setup: "pullback", score: 86 }), "CORE");
  assert.equal(positionKind({ setup: "momentum", score: 95 }), "TACTICAL");
  assert.equal(positionKind({ setup: "pullback", score: 80 }), "TACTICAL");
});

test("positionWeight: regime scales the weight, with a floor", () => {
  assert.equal(positionWeight({ setup: "pullback", score: 92 }, "RISK ON"), 15);
  assert.equal(positionWeight({ setup: "momentum", score: 92 }, "RISK ON"), 10);
  assert.equal(positionWeight({ setup: "momentum", score: 80 }, "NEUTRAL"), 5); // 7.5 * 0.6 -> floor
});

test("shortWeight: capped by the long book and by stop distance", () => {
  const longs: ScoredSetup[] = [{ setup: "pullback", score: 92, riskReward: 2 }];
  const wide = shortWeight({ invalidation: 1200, close: 1000 }, longs, "RISK ON"); // 20% stop -> 50/20 = 2.5
  const tight = shortWeight({ invalidation: 1030, close: 1000 }, longs, "RISK ON"); // 3% stop -> capped at 8
  assert.ok(wide <= 3);
  assert.ok(tight <= 8);
  assert.ok(tight >= wide);
});

test("selectWeek: a RISK OFF week carries no picks", () => {
  const weak: ScoredSetup[] = [{ setup: "momentum", score: 60, riskReward: 2 }];
  assert.deepEqual(selectWeek(weak as never).longs, []);
  const strong = selectWeek([{ setup: "momentum", score: 90, riskReward: 2 }] as never);
  assert.equal(strong.regime, "NEUTRAL");
  assert.equal(strong.longs.length, 1);
});
