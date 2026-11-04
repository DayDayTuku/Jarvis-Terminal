import test from "node:test";
import assert from "node:assert/strict";
import { buildQuantamentalMap, type QuantamentalRaw, type QuantamentalStock } from "../lib/quantamental.ts";
import {
  WEEKLY_WEIGHTS,
  rankWeeklyPicks,
  scoreWeeklyPick,
  type WeeklyPickIntelligence,
  type WeeklyTechnicalInput,
} from "../lib/weekly-intelligence.ts";

const now = new Date("2026-11-04T02:00:00.000Z");

const macro = { exposure: 0.8, flags: [], indexChangePct: 0.45 };

function raw(overrides: Partial<QuantamentalRaw> = {}): QuantamentalRaw {
  return {
    ticker: "TEST",
    name: "Test Ticker",
    sector: "Industrials",
    tvSector: "Producer Manufacturing",
    close: 1_000,
    change: 1.2,
    marketCap: 5_000_000_000_000,
    pb: 1.4,
    pe: 12,
    roe: 16,
    revenue: 2_000_000_000_000,
    netIncome: 300_000_000_000,
    perf3m: 8,
    perf6m: 15,
    avgVolume10d: 80_000_000,
    revenueTtm: 2_100_000_000_000,
    netIncomeTtm: 330_000_000_000,
    revenueFy: 1_800_000_000_000,
    netIncomeFy: 250_000_000_000,
    revenueFq: 560_000_000_000,
    netIncomeFq: 92_000_000_000,
    ebitdaFy: 600_000_000_000,
    fcfFy: 260_000_000_000,
    grossProfitFy: 700_000_000_000,
    equityFy: 2_000_000_000_000,
    assetsFy: 3_000_000_000_000,
    liabilitiesFy: 1_000_000_000_000,
    epsTtm: 120,
    epsForward: 150,
    dividendPerShare: 40,
    ...overrides,
  };
}

function baseStock(overrides: Partial<QuantamentalStock> = {}): QuantamentalStock {
  const stock = buildQuantamentalMap([raw()]).stocks[0];
  return { ...stock, ...overrides };
}

const strongInput: WeeklyTechnicalInput = {
  ticker: "TEST",
  setup: "breakout",
  sector: "Industrials",
  score: 90,
  close: 1_000,
  change: 1.2,
  rsi: 60,
  relativeVolume: 1.4,
  distance20: 2,
  ema25: 980,
  ema50: 950,
  distance25: 2.04,
  baseSupport: 980,
  baseResistance: null,
  trend: true,
  aboveLongTrend: true,
  nearHigh: true,
  nearLow: false,
  invalidation: 940,
  riskReward: 2.4,
};

function strongStock(overrides: Partial<QuantamentalStock> = {}) {
  return baseStock({
    ticker: "TEST",
    fundamentalScore: 88,
    momentumScore: {
      score: 88,
      coverage: 0.9,
      confidence: "high",
      components: [
        {
          key: "earnings",
          label: "Earnings growth",
          weight: 30,
          value: 18,
          unit: "percent",
          score: 88,
          contribution: 24,
          status: "available",
          periodBasis: "FQ vs FY",
          detail: "Latest-quarter run-rate versus the last fiscal year.",
        },
      ],
      sectorProfile: "general",
      notes: [],
    },
    gap: 22,
    valuationPercentile: 18,
    historyObservations: 6,
    priceMomentum: 15,
    momentum: 15,
    momentumBasis: "6M",
    revisionDirection: "up",
    liquidity: "liquid",
    nextEarningsDate: "2026-11-14T00:00:00.000Z",
    ...overrides,
  });
}

test("weekly weights follow the 25/25/20/15/15 framework", () => {
  assert.deepEqual(WEEKLY_WEIGHTS, {
    fundamental: 25,
    technical: 25,
    quantitative: 20,
    valuation: 15,
    catalyst: 15,
  });
  assert.equal(Object.values(WEEKLY_WEIGHTS).reduce((sum, value) => sum + value, 0), 100);
});

test("technical structure uses EMA25/EMA50 as base support and resistance", () => {
  const result = scoreWeeklyPick(strongInput, strongStock(), macro, { now });
  const technical = result.components.find((item) => item.key === "technical");
  assert.ok(technical?.evidence.some((line) => /EMA25 .*first support.*EMA50.*base support/.test(line)));
  assert.ok(technical?.evidence.some((line) => /Base support/.test(line)));

  const below = scoreWeeklyPick(
    { ...strongInput, ema25: 1_100, ema50: 1_150, baseSupport: null, baseResistance: 1_100, distance25: -9.09 },
    strongStock(),
    macro,
    { now },
  );
  const brokenTechnical = below.components.find((item) => item.key === "technical");
  assert.ok(brokenTechnical?.evidence.some((line) => /both EMAs act as resistance/.test(line)));
  assert.ok(brokenTechnical?.evidence.some((line) => /Base resistance at 1.100/.test(line)));
});

test("missing fundamental and valuation feeds never score as zero", () => {
  const result = scoreWeeklyPick(strongInput, undefined, macro, { now });
  assert.equal(result.jarvisScore, null);
  assert.equal(result.stance, "WATCH");
  assert.equal(result.confidence, "none");
  assert.equal(result.components.find((item) => item.key === "fundamental")?.status, "unavailable");
  assert.equal(result.components.find((item) => item.key === "valuation")?.status, "unavailable");
  assert.equal(result.coverage, 0.4);
  assert.ok(result.dataGaps.some((gap) => /at least two available components/i.test(gap)));
});

test("available components are renormalised over their own weight", () => {
  const stock = strongStock({ gap: null, valuationPercentile: null, historyObservations: 0 });
  stock.valuation = stock.valuation.map((metric) => ({ ...metric, value: null, peerMedian: null }));
  const result = scoreWeeklyPick(strongInput, stock, macro, { now });
  const available = result.components.filter((item) => item.status === "available");
  const weight = available.reduce((sum, item) => sum + item.weight, 0);
  const expected = available.reduce((sum, item) => sum + (item.score as number) * item.weight, 0) / weight;
  assert.equal(result.jarvisScore, Math.round(expected * 10) / 10);
  assert.equal(result.coverage, weight / 100);
  assert.equal(result.components.find((item) => item.key === "valuation")?.score, null);
});

test("a strong integrated setup earns BUY only with a verified fundamental", () => {
  const result = scoreWeeklyPick(strongInput, strongStock(), macro, { now });
  assert.ok((result.jarvisScore ?? 0) >= 70, `expected a high score, got ${result.jarvisScore}`);
  assert.equal(result.stance, "BUY");
  assert.equal(result.confidence, "high");
  assert.ok(result.catalysts.some((item) => /Earnings release/.test(item)));
});

test("a weak integrated score is AVOID, not a forced pick", () => {
  const weak = strongStock({
    fundamentalScore: 20,
    gap: -40,
    valuationPercentile: 95,
    priceMomentum: -30,
    momentumBasis: "6M",
    revisionDirection: "down",
    liquidity: "thin",
    nextEarningsDate: null,
  });
  const input: WeeklyTechnicalInput = {
    ...strongInput,
    score: 40,
    trend: false,
    aboveLongTrend: false,
    ema25: 1100,
    ema50: 1150,
    distance25: -9.09,
    baseSupport: null,
    baseResistance: 1100,
    rsi: 28,
    relativeVolume: 0.5,
    distance20: -8,
    nearHigh: false,
    nearLow: true,
  };
  const result = scoreWeeklyPick(input, weak, macro, { now });
  assert.ok((result.jarvisScore ?? 100) < 55);
  assert.equal(result.stance, "AVOID");
  assert.ok(result.risks.some((risk) => /below the research threshold/i.test(risk)));
  assert.ok(result.catalysts.length === 0);
});

test("earnings inside the holding window becomes a dated catalyst and event risk", () => {
  const result = scoreWeeklyPick(strongInput, strongStock(), macro, { now });
  const catalyst = result.components.find((item) => item.key === "catalyst");
  assert.ok(catalyst?.evidence.some((line) => /9 days/.test(line)));
  assert.ok(result.catalysts.some((line) => /14 Nov 2026/.test(line)));
  assert.ok(result.risks.every((risk) => !/inside the holding window/.test(risk)));
});

test("imminent earnings are flagged as event risk rather than a clean catalyst", () => {
  const imminent = strongStock({ nextEarningsDate: "2026-11-06T00:00:00.000Z" });
  const result = scoreWeeklyPick(strongInput, imminent, macro, { now });
  assert.ok(result.risks.some((risk) => /inside the holding window/.test(risk)));
  assert.equal(result.catalysts.length, 0);
});

test("macro exposure and thin liquidity are surfaced in risk, not hidden", () => {
  const result = scoreWeeklyPick(
    strongInput,
    strongStock({ liquidity: "thin" }),
    { exposure: 0, flags: ["RUPIAH BELOW 50D", "VIX +5D"], indexChangePct: -1.4 },
    { now },
  );
  assert.ok(result.risks.some((risk) => /Thin liquidity/.test(risk)));
  assert.ok(result.risks.some((risk) => /Macro flags: RUPIAH BELOW 50D, VIX \+5D/.test(risk)));
  assert.ok(result.risks.some((risk) => /stands the book aside/.test(risk)));
  const catalyst = result.components.find((item) => item.key === "catalyst");
  assert.ok(catalyst?.evidence.some((line) => /0% of full size/.test(line)));
});

test("unavailable macro is a data gap, not a neutral zero", () => {
  const result = scoreWeeklyPick(strongInput, strongStock(), null, { now });
  assert.ok(result.dataGaps.some((gap) => /Macro overlay is unavailable/.test(gap)));
});

test("ranking keeps unscored names last and preserves order otherwise", () => {
  const scored = (ticker: string, value: number | null): { ticker: string; intel: WeeklyPickIntelligence } => ({
    ticker,
    intel: { jarvisScore: value } as WeeklyPickIntelligence,
  });
  const ranked = rankWeeklyPicks([scored("B", 62), scored("NONE", null), scored("A", 81), scored("C", 70)]);
  assert.deepEqual(ranked.map((row) => row.ticker), ["A", "C", "B", "NONE"]);
});
