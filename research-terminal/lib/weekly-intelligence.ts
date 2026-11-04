/**
 * JARVIS weekly pick intelligence.
 *
 * The weekly module already decides *which* technical setups qualify. This file
 * answers the next question: of those setups, which ones are attractive once
 * fundamentals, valuation, quantitative context and catalysts are included?
 *
 * Weights follow the weekly framework exactly:
 *   fundamental quality 25% · technical strength 25% · quantitative 20%
 *   · valuation 15% · catalysts & positioning 15%
 *
 * Rules:
 * - A missing input marks its component unavailable and removes its weight from
 *   the denominator. It is never scored as zero and never filled in.
 * - A pick needs at least two available components and 50% weight coverage for a
 *   JARVIS score; otherwise the score is null and the stance is WATCH.
 * - Price momentum is quantitative context. It is not fundamental momentum.
 * - Technical structure uses EMA25/EMA50 as the base support/resistance band;
 *   the 20/50/200-day trend read is not used in this layer.
 * - Nothing here predicts returns. A high score is a research priority, not a
 *   guarantee, and every result carries its data gaps.
 */

import type { QuantamentalStock } from "./quantamental";

export type WeeklyComponentKey =
  | "fundamental"
  | "technical"
  | "quantitative"
  | "valuation"
  | "catalyst";

export type WeeklyStance = "BUY" | "WATCH" | "AVOID";

export type WeeklyComponent = {
  key: WeeklyComponentKey;
  label: string;
  weight: number;
  score: number | null;
  status: "available" | "unavailable";
  evidence: string[];
  detail: string;
};

export type WeeklyPickIntelligence = {
  ticker: string;
  jarvisScore: number | null;
  coverage: number;
  confidence: "high" | "medium" | "low" | "none";
  stance: WeeklyStance;
  components: WeeklyComponent[];
  thesis: string;
  catalysts: string[];
  risks: string[];
  dataGaps: string[];
  /** Compact one-line summary for the stored weekly run's reason list. */
  summary: string;
};

export type WeeklyTechnicalInput = {
  ticker: string;
  setup: string;
  sector?: string | null;
  score: number;
  close: number;
  change?: number | null;
  rsi?: number | null;
  relativeVolume?: number | null;
  distance20?: number | null;
  /** EMA25/EMA50 form the base support/resistance band. */
  ema25?: number | null;
  ema50?: number | null;
  distance25?: number | null;
  baseSupport?: number | null;
  baseResistance?: number | null;
  trend?: boolean;
  aboveLongTrend?: boolean;
  nearHigh?: boolean;
  nearLow?: boolean;
  invalidation?: number | null;
  riskReward?: number | null;
};

export type WeeklyMacroInput = {
  exposure: number;
  flags: string[];
  indexChangePct: number | null;
} | null;

export const WEEKLY_WEIGHTS: Record<WeeklyComponentKey, number> = {
  fundamental: 25,
  technical: 25,
  quantitative: 20,
  valuation: 15,
  catalyst: 15,
};

export const WEEKLY_LABELS: Record<WeeklyComponentKey, string> = {
  fundamental: "Fundamental quality",
  technical: "Technical strength",
  quantitative: "Quantitative signals",
  valuation: "Valuation attractiveness",
  catalyst: "Catalysts & positioning",
};

const COMPONENT_ORDER: WeeklyComponentKey[] = [
  "fundamental",
  "technical",
  "quantitative",
  "valuation",
  "catalyst",
];

const MIN_SCORE_COVERAGE = 0.5;
const MIN_SCORE_COMPONENTS = 2;

function clamp(value: number, low = 0, high = 100): number {
  return Math.max(low, Math.min(high, value));
}

function round(value: number, places = 1): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function signed(value: number, places = 1): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(places)}`;
}

function component(
  key: WeeklyComponentKey,
  score: number | null,
  evidence: string[],
  detail: string,
  gaps: string[] = [],
): { component: WeeklyComponent; gaps: string[] } {
  const available = score !== null;
  return {
    component: {
      key,
      label: WEEKLY_LABELS[key],
      weight: WEEKLY_WEIGHTS[key],
      score: score === null ? null : round(clamp(score)),
      status: available ? "available" : "unavailable",
      evidence,
      detail,
    },
    gaps,
  };
}

function dayDistance(date: string | null | undefined, now: Date): number | null {
  if (!date) return null;
  const time = new Date(date).getTime();
  if (!Number.isFinite(time)) return null;
  const days = Math.floor((time - now.getTime()) / 86_400_000);
  return days >= -1 ? days : null;
}

function shortDate(date: string): string {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  });
}

function technicalScore(input: WeeklyTechnicalInput): { score: number; evidence: string[] } {
  const evidence: string[] = [];
  let structure = 50;

  const ema25 = finite(input.ema25);
  const ema50 = finite(input.ema50);
  const level = (value: number) => value.toLocaleString("id-ID", { maximumFractionDigits: 0 });

  if (ema25 !== null && ema50 !== null) {
    if (input.close > ema25 && ema25 >= ema50) {
      structure += 20;
      evidence.push(`Price is above EMA25 (${level(ema25)}) and EMA50 (${level(ema50)}); EMA25 is the first support and EMA50 the base support.`);
    } else if (input.close > ema25 && input.close > ema50) {
      structure += 10;
      evidence.push(`Price is above both EMAs, but EMA25 (${level(ema25)}) sits below EMA50 (${level(ema50)}); the base is still repairing.`);
    } else if (input.close > ema25) {
      structure -= 2;
      evidence.push(`Price is above EMA25 (${level(ema25)}) but below EMA50 (${level(ema50)}); EMA50 is the base resistance to clear.`);
    } else if (input.close > ema50) {
      structure -= 6;
      evidence.push(`Price is below EMA25 (${level(ema25)}) but above EMA50 (${level(ema50)}); EMA25 caps the rebound.`);
    } else {
      structure -= 16;
      evidence.push(`Price is below EMA25 (${level(ema25)}) and EMA50 (${level(ema50)}); both EMAs act as resistance.`);
    }
  } else if (ema25 !== null) {
    if (input.close > ema25) {
      structure += 6;
      evidence.push(`Price is above EMA25 (${level(ema25)}); EMA50 is unavailable.`);
    } else {
      structure -= 8;
      evidence.push(`Price is below EMA25 (${level(ema25)}); EMA50 is unavailable, so the base check is partial.`);
    }
  } else if (ema50 !== null) {
    if (input.close > ema50) {
      structure += 4;
      evidence.push(`Price is above EMA50 (${level(ema50)}); EMA25 is unavailable.`);
    } else {
      structure -= 10;
      evidence.push(`Price is below EMA50 (${level(ema50)}); EMA25 is unavailable, so the base check is partial.`);
    }
  } else {
    structure -= 4;
    evidence.push("EMA25/EMA50 are unavailable; the trend check is skipped rather than assumed.");
  }

  const support = finite(input.baseSupport);
  const resistance = finite(input.baseResistance);
  if (support !== null) {
    evidence.push(`Base support at ${level(support)} (nearest EMA25/EMA50 below the close).`);
  }
  if (resistance !== null) {
    evidence.push(`Base resistance at ${level(resistance)} (nearest EMA25/EMA50 above the close).`);
  }

  const rsi = finite(input.rsi);
  if (rsi !== null) {
    if (rsi >= 50 && rsi <= 70) {
      structure += 10;
      evidence.push(`RSI ${rsi.toFixed(1)} sits in the constructive 50–70 band.`);
    } else if (rsi > 70 && rsi <= 80) {
      structure -= 4;
      evidence.push(`RSI ${rsi.toFixed(1)} is stretched; entry timing risk is higher.`);
    } else if (rsi > 80) {
      structure -= 12;
      evidence.push(`RSI ${rsi.toFixed(1)} is overbought.`);
    } else if (rsi < 30) {
      structure -= 10;
      evidence.push(`RSI ${rsi.toFixed(1)} is oversold; the trend may still be broken.`);
    } else {
      structure += 2;
      evidence.push(`RSI ${rsi.toFixed(1)} is neutral.`);
    }
  }

  const relVolume = finite(input.relativeVolume);
  if (relVolume !== null) {
    if (relVolume >= 1.2) {
      structure += 8;
      evidence.push(`Relative volume ${relVolume.toFixed(1)}× confirms participation.`);
    } else if (relVolume < 0.7) {
      structure -= 6;
      evidence.push(`Relative volume ${relVolume.toFixed(1)}× is below normal.`);
    } else {
      evidence.push(`Relative volume ${relVolume.toFixed(1)}× is unremarkable.`);
    }
  }

  const distance25 = finite(input.distance25);
  const distance = distance25 ?? finite(input.distance20);
  if (distance !== null) {
    if (distance > 15) {
      structure -= 8;
      evidence.push(`Price is ${distance.toFixed(1)}% above its ${distance25 !== null ? "EMA25 base" : "20-day anchor"}; chase risk.`);
    } else if (distance >= -3) {
      structure += 5;
      evidence.push(`Price is ${signed(distance)}% versus its ${distance25 !== null ? "EMA25 base" : "20-day anchor"}.`);
    }
  }

  if (input.nearHigh) {
    structure += 7;
    evidence.push("Price is near its one-month high.");
  }
  if (input.nearLow) {
    structure -= 10;
    evidence.push("Price is near its one-month low.");
  }

  const model = clamp(input.score);
  const score = clamp(model * 0.65 + structure * 0.35);
  evidence.unshift(
    `Technical model score ${model.toFixed(1)}/100, blended 65/35 with the structure checks below.`,
  );
  return { score, evidence };
}

function fundamentalComponent(
  stock: QuantamentalStock | undefined,
): { component: WeeklyComponent; gaps: string[] } {
  if (!stock) {
    return component(
      "fundamental",
      null,
      ["No fundamental feed matched this ticker."],
      "Revenue, earnings, margin, returns, cash flow and balance-sheet trend.",
      ["Fundamental and valuation feeds do not cover this ticker in the current scan."],
    );
  }

  const score = finite(stock.fundamentalScore);
  if (score === null) {
    return component(
      "fundamental",
      null,
      ["Too few statement inputs for a fundamental momentum score."],
      stock.momentumScore?.notes?.[0] ?? "Fundamental momentum could not be computed.",
      ["Fundamental momentum is unavailable: fewer than two statement components or under 50% weight coverage."],
    );
  }

  const available = (stock.momentumScore?.components ?? [])
    .filter((item) => item.status === "available")
    .sort((a, b) => (b.contribution ?? 0) - (a.contribution ?? 0))
    .slice(0, 3)
    .map((item) => `${item.label}: ${signed(item.value ?? 0, 2)}${item.unit === "pp" ? "pp" : "%"}`);

  const coverage = stock.momentumScore?.coverage ?? 0;
  const gaps = coverage < 0.85
    ? [`Fundamental score uses ${Math.round(coverage * 100)}% of its weight; missing components are excluded.`]
    : [];

  return component(
    "fundamental",
    score,
    available.length ? available : ["Statement components are available but not individually populated."],
    `Fundamental momentum ${score.toFixed(1)}/100 · ${stock.momentumScore?.confidence ?? "unknown"} confidence · ${Math.round(coverage * 100)}% weight coverage · ${stock.momentumScore?.sectorProfile ?? "general"} model.`,
    gaps,
  );
}

function quantitativeComponent(
  stock: QuantamentalStock | undefined,
  input: WeeklyTechnicalInput,
): { component: WeeklyComponent; gaps: string[] } {
  const momentum = finite(stock?.priceMomentum);
  const relVolume = finite(input.relativeVolume);
  const revision = stock?.revisionDirection ?? null;

  if (momentum === null) {
    return component(
      "quantitative",
      null,
      ["No 3M/6M price momentum in the feed for this ticker."],
      "Momentum, relative strength, volatility and revisions.",
      ["Quantitative signals need price history; momentum is unavailable rather than inferred from one session."],
    );
  }

  const basis = stock?.momentumBasis ?? "6M";
  const scale = basis === "6M" ? 1.2 : 1.6;
  let score = 50 + clamp(momentum * scale, -45, 45);
  const evidence = [`${basis} price momentum ${signed(momentum, 2)}%.`];

  if (relVolume !== null) {
    const volumeAdj = clamp((relVolume - 1) * 10, -8, 8);
    score += volumeAdj;
    evidence.push(`Volume anomaly adjustment ${signed(volumeAdj, 1)} from relative volume ${relVolume.toFixed(1)}×.`);
  }

  if (revision === "up") {
    score += 8;
    evidence.push("Forward estimate revisions are positive across stored snapshots.");
  } else if (revision === "down") {
    score -= 8;
    evidence.push("Forward estimate revisions are negative across stored snapshots.");
  }

  const day = finite(input.change);
  if (day !== null) {
    const adjustment = clamp(day * 0.3, -3, 3);
    score += adjustment;
    evidence.push(`Session move ${signed(day, 2)}% contributes ${signed(adjustment, 1)}.`);
  }

  const gaps: string[] = [];
  if (revision === null) gaps.push("Estimate revision direction needs at least two stored snapshots; it is not inferred.");
  if (!stock) gaps.push("Peer-relative context is unavailable for this ticker.");

  return component(
    "quantitative",
    score,
    evidence,
    "Momentum is separate from fundamental momentum. Volatility, MACD and relative strength versus the JCI are not in the live feed and are not scored.",
    gaps,
  );
}

function valuationComponent(stock: QuantamentalStock | undefined): { component: WeeklyComponent; gaps: string[] } {
  const gap = finite(stock?.gap);
  const percentile = finite(stock?.valuationPercentile);
  if (gap === null && percentile === null) {
    return component(
      "valuation",
      null,
      ["No peer-relative gap or own-history percentile is available."],
      "P/E, P/BV, EV/EBITDA, dividend yield, peer median and history.",
      ["Valuation is unavailable: no comparable peer gap and no valuation history."],
    );
  }

  let score: number;
  const evidence: string[] = [];
  if (gap !== null) {
    score = 50 + clamp(gap, -45, 45);
    evidence.push(
      `${gap >= 0 ? "Cheaper" : "Richer"} than peers by ${Math.abs(gap).toFixed(1)}% on ${stock?.basis ?? "the primary basis"}.`,
    );
  } else {
    score = 50 + clamp(50 - (percentile as number), -45, 45);
    evidence.push(`Own-history valuation percentile ${(percentile as number).toFixed(0)} (lower is cheaper).`);
  }

  if (gap !== null && percentile !== null) {
    const percentileScore = 50 + clamp(50 - percentile, -45, 45);
    score = score * 0.6 + percentileScore * 0.4;
    evidence.push(`Own-history percentile ${percentile.toFixed(0)} blends 40% into the valuation score.`);
  }

  const metrics = stock?.valuation ?? [];
  const dividend = finite(metrics.find((metric) => metric.key === "dividend_yield")?.value);
  if (dividend !== null && dividend > 0) {
    const bonus = clamp(dividend * 0.8, 0, 6);
    score += bonus;
    evidence.push(`Dividend yield ${dividend.toFixed(2)}% adds ${bonus.toFixed(1)}.`);
  }

  const pe = metrics.find((metric) => metric.key === "pe_trailing");
  if (pe?.value != null && pe.peerMedian != null) {
    evidence.push(`P/E trailing ${pe.value.toFixed(1)}× versus peer median ${pe.peerMedian.toFixed(1)}× (${pe.peerCount} peers).`);
  }
  const ev = metrics.find((metric) => metric.key === "ev_ebitda");
  if (ev?.value != null) {
    evidence.push(`EV/EBITDA ${ev.value.toFixed(1)}×${ev.peerMedian != null ? ` versus peer median ${ev.peerMedian.toFixed(1)}×` : ""}.`);
  }

  const gaps: string[] = [];
  if (percentile === null) gaps.push("Own-history valuation percentile needs five stored snapshots; it is not estimated.");
  if (stock?.basis === "pb_roe") gaps.push("Financials are valued on P/B per ROE point, not on P/E.");

  return component(
    "valuation",
    score,
    evidence,
    "A positive peer gap means cheaper than the peer median. Valuation alone never justifies a buy.",
    gaps,
  );
}

function catalystComponent(
  stock: QuantamentalStock | undefined,
  input: WeeklyTechnicalInput,
  macro: WeeklyMacroInput,
  now: Date,
  risks: string[],
  catalysts: string[],
  gaps: string[],
): { component: WeeklyComponent } {
  let score = 50;
  const evidence: string[] = [];

  const revision = stock?.revisionDirection ?? null;
  if (revision === "up") {
    score += 12;
    evidence.push("Estimate revisions are moving up.");
  } else if (revision === "down") {
    score -= 12;
    evidence.push("Estimate revisions are moving down.");
  } else {
    evidence.push("No estimate revision history yet.");
    gaps.push("Catalyst scoring cannot use revision direction until two estimate snapshots exist.");
  }

  const earnings = dayDistance(stock?.nextEarningsDate, now);
  if (earnings !== null) {
    if (earnings <= 5) {
      score -= 2;
      evidence.push(`Earnings release in ${earnings} day${earnings === 1 ? "" : "s"}; event risk is immediate.`);
      risks.push(`Earnings release on ${shortDate(stock?.nextEarningsDate as string)} is inside the holding window.`);
    } else if (earnings <= 21) {
      score += 6;
      evidence.push(`Earnings release in ${earnings} days acts as a dated catalyst.`);
      catalysts.push(`Earnings release on ${shortDate(stock?.nextEarningsDate as string)}.`);
    } else {
      evidence.push(`Next earnings release is ${earnings} days away, outside the primary horizon.`);
    }
  } else {
    gaps.push("No next earnings date is available for this ticker.");
  }

  if (stock?.liquidity === "liquid") {
    score += 6;
    evidence.push("Ten-day turnover clears the institutional liquidity floor.");
  } else if (stock?.liquidity === "thin") {
    score -= 10;
    evidence.push("Turnover is below the IDR 5bn thin-liquidity threshold.");
    risks.push("Thin liquidity raises execution and exit risk.");
  } else {
    evidence.push("Liquidity could not be confirmed from the feed.");
    gaps.push("Liquidity is unknown for this ticker; the module does not treat unknown as liquid.");
  }

  if (macro) {
    const exposureAdj = clamp((macro.exposure - 0.6) * 10, -8, 4);
    score += exposureAdj;
    evidence.push(
      `Macro overlay allows ${Math.round(macro.exposure * 100)}% of full size${macro.flags.length ? ` (${macro.flags.join(", ")})` : ""}; adjustment ${signed(exposureAdj, 1)}.`,
    );
    if (macro.flags.length) risks.push(`Macro flags: ${macro.flags.join(", ")}.`);
    if (macro.exposure <= 0) risks.push("The macro overlay stands the book aside at 0% deployed.");
  } else {
    gaps.push("Macro overlay is unavailable; catalyst scoring uses no regime adjustment.");
  }

  const rsi = finite(input.rsi);
  if (rsi !== null && rsi > 75) risks.push(`RSI ${rsi.toFixed(1)} is overbought; the entry can mean-revert.`);

  return { component: component("catalyst", score, evidence, "Dated events, estimate revisions, liquidity and the macro overlay. No event is invented.").component };
}

export type WeeklyIntelligenceOptions = { now?: Date };

/**
 * Score one technically-qualified setup. `stock` comes from the Quantamental
 * map; when it is missing the fundamental and valuation components are marked
 * unavailable rather than scored at zero.
 */
export function scoreWeeklyPick(
  input: WeeklyTechnicalInput,
  stock: QuantamentalStock | undefined,
  macro: WeeklyMacroInput,
  options: WeeklyIntelligenceOptions = {},
): WeeklyPickIntelligence {
  const now = options.now ?? new Date();
  const risks: string[] = [];
  const catalysts: string[] = [];
  const dataGaps: string[] = [];

  const technical = technicalScore(input);
  const technicalResult = component(
    "technical",
    technical.score,
    technical.evidence,
    "Model score and price structure: EMA25/EMA50 base support and resistance, RSI, relative volume and distance from the EMA25 base.",
  );
  const fundamental = fundamentalComponent(stock);
  const quantitative = quantitativeComponent(stock, input);
  const valuation = valuationComponent(stock);
  const catalyst = catalystComponent(stock, input, macro, now, risks, catalysts, dataGaps);

  const byKey: Record<WeeklyComponentKey, WeeklyComponent> = {
    fundamental: fundamental.component,
    technical: technicalResult.component,
    quantitative: quantitative.component,
    valuation: valuation.component,
    catalyst: catalyst.component,
  };
  const components = COMPONENT_ORDER.map((key) => byKey[key]);

  for (const gaps of [technicalResult.gaps, fundamental.gaps, quantitative.gaps, valuation.gaps]) {
    for (const gap of gaps) if (!dataGaps.includes(gap)) dataGaps.push(gap);
  }

  const available = components.filter((item) => item.status === "available");
  const availableWeight = available.reduce((sum, item) => sum + item.weight, 0);
  const coverage = availableWeight / 100;
  const weighted = available.reduce((sum, item) => sum + (item.score as number) * item.weight, 0);
  const jarvisScore = available.length >= MIN_SCORE_COMPONENTS && coverage >= MIN_SCORE_COVERAGE && availableWeight > 0
    ? round(weighted / availableWeight, 1)
    : null;

  const confidence: WeeklyPickIntelligence["confidence"] = jarvisScore === null
    ? "none"
    : coverage >= 0.85
      ? "high"
      : coverage >= 0.6
        ? "medium"
        : "low";

  if (jarvisScore === null) {
    dataGaps.push("JARVIS score needs at least two available components and 50% weight coverage.");
  } else if (coverage < 0.85) {
    dataGaps.push(`JARVIS score uses ${Math.round(coverage * 100)}% of the configured weight; unavailable components are excluded.`);
  }

  const technicalScoreValue = byKey.technical.score;
  let stance: WeeklyStance;
  if (jarvisScore === null) {
    stance = "WATCH";
  } else if (
    jarvisScore >= 70
    && technicalScoreValue !== null
    && technicalScoreValue >= 55
    && byKey.fundamental.status === "available"
  ) {
    stance = "BUY";
  } else if (jarvisScore >= 55) {
    stance = "WATCH";
  } else {
    stance = "AVOID";
  }

  if (stance === "AVOID") {
    risks.push("Integrated score is below the research threshold; the technical setup alone is not enough.");
  }
  if (byKey.fundamental.status === "unavailable") {
    risks.push("Fundamental quality could not be verified for this name.");
  }
  if (byKey.valuation.status === "unavailable") {
    risks.push("Valuation could not be compared with peers or its own history.");
  }
  if (input.invalidation != null && Number.isFinite(input.invalidation)) {
    risks.push(`The thesis is invalidated at ${input.invalidation.toLocaleString("id-ID")} on the existing stop.`);
  }

  const valuationText = byKey.valuation.status === "available"
    ? byKey.valuation.evidence[0]
    : "valuation unavailable";
  const fundamentalText = byKey.fundamental.status === "available"
    ? `fundamental momentum ${(byKey.fundamental.score as number).toFixed(0)}/100`
    : "fundamentals not verified";
  const thesis = `${input.ticker}: ${input.setup.replace(/_/g, " ")} setup with a technical score of ${(technicalScoreValue ?? 0).toFixed(0)}/100. ${fundamentalText}; ${valuationText} Catalysts: ${catalysts[0] ?? "no dated event; price and revisions are the only live drivers"}.`;

  const summary = `JARVIS ${jarvisScore === null ? "N/A" : jarvisScore.toFixed(1)} (${stance}) · F ${formatComponent(byKey.fundamental)} · T ${formatComponent(byKey.technical)} · Q ${formatComponent(byKey.quantitative)} · V ${formatComponent(byKey.valuation)} · C ${formatComponent(byKey.catalyst)} · ${Math.round(coverage * 100)}% coverage`;

  return {
    ticker: input.ticker,
    jarvisScore,
    coverage: round(coverage, 3),
    confidence,
    stance,
    components,
    thesis,
    catalysts,
    risks,
    dataGaps,
    summary,
  };
}

function formatComponent(item: WeeklyComponent): string {
  return item.score === null ? "—" : item.score.toFixed(0);
}

/** Rank picks by JARVIS score, keeping unscored names last and stable. */
export function rankWeeklyPicks<T extends { intel: WeeklyPickIntelligence }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const scoreA = a.intel.jarvisScore;
    const scoreB = b.intel.jarvisScore;
    if (scoreA === null && scoreB === null) return 0;
    if (scoreA === null) return 1;
    if (scoreB === null) return -1;
    return scoreB - scoreA;
  });
}
