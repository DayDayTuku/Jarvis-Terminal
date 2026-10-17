// The V5 setup model, in one place.
//
// Before this module the setup scoring, the market regime, the weekly selection
// and the position weights each lived inside a different route (the screener,
// the cron lock and the public API all re-implemented the same thresholds). A
// tuning change in one of them could silently disagree with the others.
//
// Everything that decides *what we pick and how big* now comes from here, and
// the offline backtest imports the exact same functions. That is the only way a
// backtest can tell you anything about the model that actually runs.
//
// Policy: stop/target construction is parameterised so a variant can be measured
// against the current rule. DEFAULT_POLICY reproduces the shipped behaviour
// exactly (flat ~6% stop, fixed 2R target), so importing this changes nothing
// until a policy is deliberately switched on.

// Self-contained on purpose: the offline tests load this file directly under
// Node's type-stripping loader, which does not resolve extensionless imports.
import { scoreSignals } from "./score-model.ts";

// `isShortSetup` is the same one-liner as in lib/weekly-lifecycle.
export function isShortSetup(item: { setup?: string } | null | undefined): boolean {
  return String(item?.setup || "").toLowerCase().startsWith("short_");
}

/**
 * When true, a setup's `score` is the fitted model's prediction (lib/score-model)
 * instead of the legacy additive heuristic; `legacyScore` keeps the old value for
 * comparison. Flipped on only once the backtest shows the fitted score ranks
 * out-of-sample returns better than the heuristic.
 */
export const USE_FITTED_SCORE = true;

export type SetupKey = "breakout" | "pullback" | "momentum" | "reversal" | "short_breakdown";
export type Regime = "RISK ON" | "EMERGING" | "NEUTRAL" | "RISK OFF";
export type SetupKind = "CORE" | "TACTICAL";

/** Normalised inputs for one scan row. Any data source (TradingView, Yahoo, a
 *  backtest bar series) only has to fill this in. */
export type SetupFeatures = {
  ticker: string;
  name: string;
  sector?: string;
  close: number;
  change: number | null;
  volume: number | null;
  averageVolume: number | null;
  relativeVolume: number | null;
  rsi: number | null;
  ema20: number | null;
  ema50: number | null;
  sma200: number | null;
  high1m: number | null;
  low1m: number | null;
  recommendation: number | null;
  marketCap: number | null;
  atr: number | null;
};

/** How the entry/stop/target are built. */
export type PlanPolicy = {
  stopMode: "percent" | "atr";
  atrStopMult: number;
  targetMode: "rr" | "room";
  /** Multiple used in "room" mode (and to derive the fallback room). */
  roomMultiple: number;
  /** Target distance in R for "rr" mode. The shipped value is 2 (1.7 for reversals). */
  targetR: number;
};

/** The shipped rule: flip to "atr"/"room" only after the backtest justifies it. */
export const DEFAULT_POLICY: PlanPolicy = {
  stopMode: "percent",
  atrStopMult: 2,
  targetMode: "rr",
  roomMultiple: 2,
  targetR: 2,
};

/**
 * Minimum average daily turnover (close × average volume) in rupiah for a name to
 * be tradeable. Share-count floors are not enough: 250k shares of a 1,000-rupiah
 * stock is only 0.25bn IDR a day, far too thin to enter and exit without moving
 * the price. IDR 20bn/day is a conservative institutional floor (roughly USD
 * 1.2m of turnover); it lowers both the left tail and the portfolio drawdown
 * versus a 10bn floor with no loss of return. `ctx.minTurnoverIdr` overrides it
 * so variants can be tested.
 */
export const MIN_TURNOVER_IDR = 20_000_000_000;

export type Setup = {
  ticker: string;
  name: string;
  sector: string;
  setup: SetupKey;
  close: number;
  change: number | null;
  volume: number | null;
  relativeVolume: number | null;
  rsi: number | null;
  marketCap: number | null;
  atr: number | null;
  distance20: number | null;
  trend: boolean;
  aboveLongTrend: boolean;
  nearHigh: boolean;
  nearLow: boolean;
  /** The active score (fitted when enabled, otherwise the legacy heuristic). */
  score: number;
  /** The original hand-tuned score, kept so it can still be compared. */
  legacyScore: number;
  reasons: string[];
  caution: string;
  entryLow: number;
  entryHigh: number;
  invalidation: number;
  target: number;
  /** What the regime/selection filters compare against. In "rr" mode this is the
   *  theoretical multiple (the shipped behaviour); in "room" mode it is measured
   *  from the actual levels. */
  riskReward: number;
  /** Always measured from the actual levels, whatever the mode. */
  measuredRiskReward: number;
  /** Distance from the signal close to the stop, in percent. */
  stopDistancePct: number;
};

function clamp(value: number): number {
  return Math.round(Math.max(0, Math.min(100, value)));
}

export type PlanLevels = {
  entryLow: number;
  entryHigh: number;
  invalidation: number;
  target: number;
  riskReward: number;
  measuredRiskReward: number;
  stopDistancePct: number;
};

/**
 * Build entry/stop/target for one setup. Long logic mirrors the original
 * `riskPlan`, short logic mirrors `shortRiskPlan`; both keep the same rounding
 * and the `low1m`/`high1m` floor so behaviour is unchanged under DEFAULT_POLICY.
 */
export function planLevels(args: {
  close: number;
  ema20: number | null;
  low1m: number | null;
  high1m: number | null;
  atr: number | null;
  setup: SetupKey;
  policy: PlanPolicy;
}): PlanLevels {
  const { close, ema20, low1m, high1m, atr, setup, policy } = args;
  const short = setup === "short_breakdown";
  const useAtr = policy.stopMode === "atr" && atr !== null && Number.isFinite(atr) && atr > 0;

  if (!short) {
    const percentStop = setup === "breakout" ? close * 0.94 : Math.min(ema20 ?? close * 0.95, close * 0.96);
    const rawStop = useAtr ? close - (atr as number) * policy.atrStopMult : percentStop;
    const risk = Math.max(close - rawStop, close * 0.025);
    const invalidation = Math.round(Math.max(low1m ?? 0, rawStop));
    const multiple = setup === "reversal" ? 1.7 : policy.targetR;
    const room = high1m !== null ? Math.max(0, high1m - close) : risk * policy.roomMultiple;
    const rawTarget = policy.targetMode === "room"
      ? close + Math.min(risk * policy.roomMultiple, room)
      : close + risk * multiple;
    const target = Math.round(rawTarget);
    const measured = risk > 0 ? (target - close) / risk : 0;
    return {
      entryLow: Math.round(close * 0.99),
      entryHigh: Math.round(close * 1.01),
      invalidation,
      target,
      riskReward: policy.targetMode === "room" ? measured : multiple,
      measuredRiskReward: measured,
      stopDistancePct: ((close - invalidation) / close) * 100,
    };
  }

  const percentStop = Math.min(high1m ?? close * 1.08, Math.max(ema20 ?? close * 1.05, close * 1.04));
  const rawStop = useAtr ? close + (atr as number) * policy.atrStopMult : percentStop;
  const risk = Math.max(rawStop - close, close * 0.025);
  const invalidation = Math.round(rawStop);
  const room = low1m !== null ? Math.max(0, close - low1m) : risk * policy.roomMultiple;
  const rawTarget = policy.targetMode === "room"
    ? close - Math.min(risk * policy.roomMultiple, room)
    : close - risk * policy.targetR;
  const target = Math.round(Math.max(1, rawTarget));
  const measured = risk > 0 ? (close - target) / risk : 0;
  return {
    entryLow: Math.round(close * 0.99),
    entryHigh: Math.round(close * 1.01),
    invalidation,
    target,
    riskReward: policy.targetMode === "room" ? measured : policy.targetR,
    measuredRiskReward: measured,
    stopDistancePct: ((invalidation - close) / close) * 100,
  };
}

/**
 * Classify one row into a scored setup (or null when nothing qualifies).
 * Ported verbatim from the screener; the only additions are the `atr` input and
 * the policy-driven plan.
 */
export function classify(features: SetupFeatures, ctx: { shortEligible: Set<string>; policy?: PlanPolicy; minTurnoverIdr?: number }): Setup | null {
  const policy = ctx.policy ?? DEFAULT_POLICY;
  const close = features.close;
  const change = features.change;
  const volume = features.volume;
  const avgVolume = features.averageVolume;
  const relativeVolume = features.relativeVolume ?? (volume && avgVolume ? volume / avgVolume : null);
  const rsi = features.rsi;
  const ema20 = features.ema20;
  const ema50 = features.ema50;
  const sma200 = features.sma200;
  const high1m = features.high1m;
  const low1m = features.low1m;
  const recommendation = features.recommendation;
  const marketCap = features.marketCap;

  if (!close || !volume || close < 50 || volume < 100_000) return null;
  if (close * (avgVolume ?? volume) < (ctx.minTurnoverIdr ?? MIN_TURNOVER_IDR)) return null;

  const distance20 = ema20 ? (close / ema20 - 1) * 100 : null;
  const trend = ema20 !== null && ema50 !== null && close >= ema20 && ema20 >= ema50;
  const aboveLongTrend = sma200 === null || close >= sma200;
  const nearHigh = high1m ? close >= high1m * 0.965 : false;
  const nearLow = low1m ? close <= low1m * 1.12 : false;

  const ticker = features.ticker.replace("IDX:", "");
  const shortTrend = ema20 !== null && ema50 !== null && close < ema20 && ema20 <= ema50;
  const belowLongTrend = sma200 !== null && close < sma200;
  const shortBreakdown =
    ctx.shortEligible.has(ticker) &&
    nearLow &&
    shortTrend &&
    belowLongTrend &&
    (relativeVolume ?? 0) >= 1.1 &&
    (rsi ?? 50) >= 28 &&
    (rsi ?? 50) <= 48 &&
    (recommendation ?? 0) <= -0.1;

  const base = {
    ticker,
    name: features.name,
    sector: features.sector ?? "Other",
    close,
    change,
    volume,
    relativeVolume,
    rsi,
    marketCap,
    atr: features.atr,
    distance20,
    trend,
    aboveLongTrend,
    nearHigh,
    nearLow,
  };

  // The signals are exactly what lib/score-model was trained on.
  const signals = (setup: SetupKey) => ({ relativeVolume, rsi, distance20, change, trend, aboveLongTrend, nearHigh, nearLow, setup });
  const activeScore = (setup: SetupKey, heuristic: number) => (USE_FITTED_SCORE ? scoreSignals(signals(setup)) : clamp(heuristic));

  if (shortBreakdown) {
    const heuristic = clamp(58 + Math.min(14, ((relativeVolume ?? 1) - 1) * 18) + 10 + 8 + Math.min(10, Math.abs(recommendation ?? 0) * 20));
    return {
      ...base,
      setup: "short_breakdown",
      score: activeScore("short_breakdown", heuristic),
      legacyScore: heuristic,
      reasons: ["Price is breaking toward its 1-month low", "The 20-day trend is below the 50-day trend", "Volume and broader technical readings confirm weakness"],
      caution: "Short only when the ticker is on the official BEI list and borrow is available. A move above resistance invalidates the trade.",
      ...planLevels({ close, ema20, low1m, high1m, atr: features.atr, setup: "short_breakdown", policy }),
    };
  }

  let setup: SetupKey;
  let score: number;
  let reasons: string[];
  let caution: string;

  if (nearHigh && (relativeVolume ?? 0) >= 1.15 && (rsi ?? 50) >= 52 && (rsi ?? 50) <= 76) {
    setup = "breakout";
    score = 58 + Math.min(18, ((relativeVolume ?? 1) - 1) * 18) + (trend ? 12 : 0) + (aboveLongTrend ? 8 : 0);
    reasons = ["Price is testing its 1-month high", "Volume is above its 10-day average", trend ? "Short-term trend is rising" : "Momentum is strengthening"];
    caution = (rsi ?? 0) > 70 ? "Momentum is already stretched; avoid chasing a large gap." : "A close back below the breakout area weakens this setup.";
  } else if (ema20 && ema50 && close >= ema50 && distance20 !== null && distance20 >= -3.5 && distance20 <= 2.5 && (rsi ?? 50) >= 40 && (rsi ?? 50) <= 62) {
    setup = "pullback";
    score = 62 + Math.max(0, 12 - Math.abs(distance20) * 3) + (ema20 >= ema50 ? 12 : 0) + (aboveLongTrend ? 7 : 0);
    reasons = ["Price is close to its 20-day trend", "The medium-term trend remains intact", (relativeVolume ?? 1) < 1 ? "Selling volume is relatively controlled" : "Trading activity remains healthy"];
    caution = "The setup is invalid if price closes decisively below support.";
  } else if (trend && aboveLongTrend && (rsi ?? 0) >= 54 && (rsi ?? 100) <= 72 && (recommendation ?? 0) >= 0.1) {
    setup = "momentum";
    score = 60 + Math.min(14, ((rsi ?? 54) - 54) * 1.2) + Math.min(12, Math.max(0, (relativeVolume ?? 1) - 1) * 12) + 10;
    reasons = ["Price is above its 20- and 50-day trends", "Momentum is positive without being extremely overbought", "Broader technical readings are constructive"];
    caution = "Momentum setups can reverse quickly when market breadth deteriorates.";
  } else if (nearLow && (rsi ?? 50) >= 30 && (rsi ?? 50) <= 49 && (change ?? 0) > -2) {
    setup = "reversal";
    score = 52 + Math.max(0, 15 - Math.abs((rsi ?? 40) - 40)) + ((change ?? 0) > 0 ? 10 : 3) + Math.min(10, (relativeVolume ?? 0) * 5);
    reasons = ["Price is near its 1-month low", "Selling pressure is no longer accelerating", (change ?? 0) > 0 ? "The latest close shows an initial rebound" : "Price is attempting to stabilise"];
    caution = "This is counter-trend and needs confirmation; use smaller size.";
  } else {
    return null;
  }

  const heuristic = clamp(score);
  return {
    ...base,
    setup,
    score: activeScore(setup, heuristic),
    legacyScore: heuristic,
    reasons,
    caution,
    ...planLevels({ close, ema20, low1m, high1m, atr: features.atr, setup, policy }),
  };
}

/** Classify a whole scan and sort by score, exactly like the screener does. */
export function classifyAll(features: SetupFeatures[], ctx: { shortEligible: Set<string>; policy?: PlanPolicy; minTurnoverIdr?: number }): Setup[] {
  return features
    .map((row) => classify(row, ctx))
    .filter((row): row is Setup => row !== null)
    .sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------------------
// Regime, selection and sizing
// ---------------------------------------------------------------------------

/** The minimum shape the selection rules need. Routes hold a lighter type than
 *  the full `Setup`, so the rules are generic over whatever carries these. */
export type ScoredSetup = { setup: string; score: number; riskReward: number; sector?: string };

/** Market regime read from the breadth of the current scan. */
export function regimeFor(setups: ScoredSetup[], excluded: ReadonlySet<string> = EXCLUDED_SETUPS): Regime {
  const valid = setups.filter((item) => !isShortSetup(item) && item.riskReward >= 1.7 && !excluded.has(item.setup.toLowerCase()));
  const broad = valid.filter((item) => item.score >= 75).length;
  const strong = valid.filter((item) => item.score >= 85).length;
  return broad >= 5 ? "RISK ON" : broad >= 3 ? "EMERGING" : strong ? "NEUTRAL" : "RISK OFF";
}

/**
 * CORE names carry the larger weight. The shipped rule matched
 * /(PULLBACK|ACCUMULATION|TREND)/ but the model only ever emits
 * breakout/pullback/momentum/reversal/short_breakdown, so ACCUMULATION and TREND
 * were dead branches and CORE collapsed to "a high-scoring pullback". Kept
 * identical here (flagged for the backtest) rather than changed silently.
 */
export const CORE_SETUPS: ReadonlySet<string> = new Set(["pullback"]);

/**
 * Setups the model deliberately does NOT trade. `reversal` is a counter-trend
 * entry whose returns are strongly regime-dependent (it was the best cohort in
 * one half of the backtest and the worst in the other) and whose losses cluster,
 * so it is the biggest single source of drawdown. Dropping it raises the
 * risk-adjusted result in BOTH halves and shrinks the portfolio drawdown. It is
 * still classified and shown in the screener; it is only excluded from selection.
 * Overridable so the backtest can measure the difference.
 */
export const EXCLUDED_SETUPS: ReadonlySet<string> = new Set(["reversal"]);

export function positionKind(item: { setup: string; score: number }): SetupKind {
  return item.score >= 85 && CORE_SETUPS.has(item.setup.toLowerCase()) ? "CORE" : "TACTICAL";
}

export function positionWeight(item: { setup: string; score: number }, regime: Regime): number {
  const base = positionKind(item) === "CORE" ? (item.score >= 90 ? 15 : 12.5) : item.score >= 90 ? 10 : 7.5;
  const multiplier = regime === "RISK ON" ? 1 : regime === "EMERGING" ? 0.8 : 0.6;
  return Math.max(5, Math.round((base * multiplier) / 2.5) * 2.5);
}

/** Per-regime score gates. Overridable so the backtest can retune them for a
 *  new score scale without disturbing the shipped defaults. */
export const REGIME_MINIMUM: Record<Regime, number> = { "RISK ON": 75, EMERGING: 80, NEUTRAL: 85, "RISK OFF": 101 };
export const REGIME_MAXIMUM: Record<Regime, number> = { "RISK ON": 5, EMERGING: 3, NEUTRAL: 1, "RISK OFF": 0 };

/** The week's long picks: score gate by regime, sector cap of two. */
export function pickLongs<T extends ScoredSetup>(
  setups: T[],
  regime: Regime,
  thresholds?: { minimum?: Partial<Record<Regime, number>>; maximum?: Partial<Record<Regime, number>> },
  excluded: ReadonlySet<string> = EXCLUDED_SETUPS,
): T[] {
  if (regime === "RISK OFF") return [];
  const minimum = thresholds?.minimum?.[regime] ?? REGIME_MINIMUM[regime];
  const maximum = thresholds?.maximum?.[regime] ?? REGIME_MAXIMUM[regime];
  const sectors = new Map<string, number>();
  return [...setups]
    .filter((item) => !isShortSetup(item) && !excluded.has(item.setup.toLowerCase()))
    .sort((a, b) => b.score - a.score || b.riskReward - a.riskReward)
    .filter((item) => item.score >= minimum && item.riskReward >= 1.7)
    .filter((item) => {
      const sector = item.sector || "Other";
      const count = sectors.get(sector) || 0;
      if (count >= 2) return false;
      sectors.set(sector, count + 1);
      return true;
    })
    .slice(0, maximum);
}

/** At most one short, and only a genuinely strong one. */
export function pickShort<T extends ScoredSetup>(setups: T[]): T[] {
  return [...setups]
    .filter((item) => isShortSetup(item))
    .filter((item) => item.score >= 85 && item.riskReward >= 2)
    .sort((a, b) => b.score - a.score || b.riskReward - a.riskReward)
    .slice(0, 1);
}

/** Risk-scaled weight for the optional short, relative to the long book. */
export function shortWeight(
  item: { invalidation: number; close: number },
  longs: Array<{ setup: string; score: number }>,
  regime: Regime,
): number {
  const weights = longs.map((row) => positionWeight(row, regime)).sort((a, b) => a - b);
  const median = weights.length ? weights[Math.floor(weights.length / 2)] : 10;
  const stop = Math.max(0.1, ((item.invalidation - item.close) / item.close) * 100);
  return Math.max(0, Math.floor(Math.min(8, median * 0.7, 50 / stop) * 2) / 2);
}

export type WeeklySelection = { regime: Regime; longs: Setup[]; shorts: Setup[] };

/** Everything the week needs: the regime, the longs and the optional short. */
export function selectWeek(
  setups: Setup[],
  thresholds?: { minimum?: Partial<Record<Regime, number>>; maximum?: Partial<Record<Regime, number>> },
): WeeklySelection {
  const regime = regimeFor(setups);
  const longs = pickLongs(setups, regime, thresholds);
  const shorts = regime === "RISK OFF" ? [] : pickShort(setups);
  return { regime, longs, shorts };
}
