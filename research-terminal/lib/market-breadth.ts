// Market breadth regime.
//
// The old regime was read from the setups the scanner happened to classify:
// "five names score >= 75" meant RISK ON. That is endogenous (change the score
// model and the market regime changes with it) and blind to the ~180 names that
// did not form a setup. This module reads the whole scan instead: participation
// above the EMA25/EMA50/SMA200 ribbon, the advance/decline line, and how many
// names are near their one-month high.
//
// Every component is optional. A component with no usable sample leaves the
// denominator, and the composite needs at least three components covering 60%
// of the weight. Missing data is never zero-filled and never invents a regime.

import type { Regime } from "./setup-model.ts";

/** The fields breadth needs from one scanned name. */
export type BreadthRow = {
  close: number | null;
  change: number | null;
  ema25?: number | null;
  ema50?: number | null;
  sma200?: number | null;
  high1m?: number | null;
};

export type BreadthComponent = {
  key: string;
  label: string;
  weight: number;
  /** 0–100, or null when the sample was too small to read. */
  score: number | null;
  sample: number;
  /** Sample as a share of the scanned rows, 0–1. */
  coverage: number;
  detail: string;
};

export type BreadthRead = {
  /** 0–100 participation score, or null when the scan is unusable. */
  score: number | null;
  /** Raw regime from the score, before the weekly hysteresis buffer. */
  regime: Regime | null;
  components: BreadthComponent[];
  sample: number;
  /** Available component weight as a share of total weight, 0–1. */
  coverage: number;
  state: "live" | "unavailable";
  methodology: string;
};

export const BREADTH_WEIGHTS = {
  aboveEma25: 0.25,
  aboveEma50: 0.25,
  aboveSma200: 0.2,
  advanceDecline: 0.15,
  nearHigh: 0.15,
} as const;

/** A component needs this many names before it is allowed to speak. */
const MIN_COMPONENT_SAMPLE = 5;
/** A component must cover at least this share of the scan. */
const MIN_COMPONENT_COVERAGE = 0.4;
/** The composite needs this much available weight and this many components. */
const MIN_COMPOSITE_COVERAGE = 0.6;
const MIN_COMPOSITE_COMPONENTS = 3;
/** A name within 5% of its one-month high counts as "near the high". */
const NEAR_HIGH_BAND = 0.05;

// The bands sit around a ~45 midpoint. An unscaled "above the 200-day" or
// "near the high" share is not symmetric (a normal tape is around 50% and 25%),
// so the composite is centred before these cut-offs are applied.
export const BREADTH_THRESHOLDS = { riskOn: 60, emerging: 45, neutral: 30 } as const;
export type BreadthBands = { riskOn: number; emerging: number; neutral: number };
/** Score must clear a boundary by this much before the weekly regime moves. */
export const BREADTH_BUFFER = 4;
/** A collapse this deep overrides the buffer and steps straight to RISK OFF. */
export const BREADTH_CRASH = 25;

const ORDER: readonly Regime[] = ["RISK OFF", "NEUTRAL", "EMERGING", "RISK ON"];

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function share(rows: BreadthRow[], test: (row: BreadthRow) => boolean | null): { score: number; sample: number } | null {
  let sample = 0;
  let hits = 0;
  for (const row of rows) {
    const value = test(row);
    if (value === null) continue;
    sample += 1;
    if (value) hits += 1;
  }
  if (sample < Math.max(MIN_COMPONENT_SAMPLE, Math.ceil(rows.length * MIN_COMPONENT_COVERAGE))) return null;
  return { score: (hits / sample) * 100, sample };
}

function above(row: BreadthRow, key: "ema25" | "ema50" | "sma200"): boolean | null {
  const close = finite(row.close);
  const level = finite(row[key]);
  if (close === null || close <= 0 || level === null || level <= 0) return null;
  return close > level;
}

function advanceDecline(rows: BreadthRow[]): { score: number; sample: number } | null {
  let advances = 0;
  let declines = 0;
  for (const row of rows) {
    const change = finite(row.change);
    if (change === null) continue;
    if (change > 0) advances += 1;
    else if (change < 0) declines += 1;
  }
  const sample = advances + declines;
  if (sample < Math.max(MIN_COMPONENT_SAMPLE, Math.ceil(rows.length * MIN_COMPONENT_COVERAGE))) return null;
  return { score: (advances / sample) * 100, sample };
}

function nearHigh(rows: BreadthRow[]): { score: number; sample: number } | null {
  const read = share(rows, (row) => {
    const close = finite(row.close);
    const high = finite(row.high1m);
    if (close === null || close <= 0 || high === null || high <= 0) return null;
    return close >= high * (1 - NEAR_HIGH_BAND);
  });
  if (!read) return null;
  // "Near the high" has a low base rate, so an unscaled share would drag the
  // composite down in every tape. Centre it on 25% (a normal market) and scale
  // by two, so 25% scores 50, 35% scores 70 and 15% scores 30.
  return { score: Math.max(0, Math.min(100, 50 + (read.score - 25) * 2)), sample: read.sample };
}

/** Raw regime for a breadth score. No hysteresis, no prior. */
export function rawBreadthRegime(score: number | null, bands: BreadthBands = BREADTH_THRESHOLDS): Regime | null {
  if (score === null || !Number.isFinite(score)) return null;
  if (score >= bands.riskOn) return "RISK ON";
  if (score >= bands.emerging) return "EMERGING";
  if (score >= bands.neutral) return "NEUTRAL";
  return "RISK OFF";
}

/**
 * Apply a weekly hysteresis buffer to the raw breadth regime.
 *
 * The regime moves at most one step per read, and only when the score clears the
 * boundary it is crossing by `BREADTH_BUFFER`. That stops a single noisy week
 * flipping a 5-name book to zero and back. A genuine collapse (score at or below
 * `BREADTH_CRASH`) overrides the buffer. With no prior regime the raw read wins.
 */
export function applyBreadthHysteresis(
  score: number | null,
  prior?: Regime | null,
  bands: BreadthBands = BREADTH_THRESHOLDS,
): Regime | null {
  if (score === null || !Number.isFinite(score)) return null;
  if (score <= BREADTH_CRASH) return "RISK OFF";
  const raw = rawBreadthRegime(score, bands);
  if (!raw) return null;
  const current = prior ? ORDER.indexOf(prior) : -1;
  if (current < 0) return raw;

  const target = ORDER.indexOf(raw);
  if (target === current) return prior ?? raw;

  if (target > current) {
    // Upgrade one step: clear the lower bound of the next regime by the buffer.
    const boundary = ORDER[current + 1] === "NEUTRAL"
      ? bands.neutral
      : ORDER[current + 1] === "EMERGING"
        ? bands.emerging
        : bands.riskOn;
    return score >= boundary + BREADTH_BUFFER ? ORDER[current + 1] ?? raw : prior ?? raw;
  }

  // Downgrade one step: fall through the lower bound of the current regime by
  // the buffer. RISK ON keeps its platform until 65 - buffer, and so on.
  const boundary = prior === "RISK ON"
    ? bands.riskOn
    : prior === "EMERGING"
      ? bands.emerging
      : bands.neutral;
  return score <= boundary - BREADTH_BUFFER ? ORDER[current - 1] ?? raw : prior ?? raw;
}

/**
 * Read breadth from a full scan. `rows` should be every name the scanner saw,
 * not only the names that qualified as setups.
 */
export function readBreadth(rows: BreadthRow[]): BreadthRead {
  const sample = rows.length;
  const component = (
    key: keyof typeof BREADTH_WEIGHTS,
    label: string,
    read: { score: number; sample: number } | null,
    detail: string,
  ): BreadthComponent => ({
    key,
    label,
    weight: BREADTH_WEIGHTS[key],
    score: read ? read.score : null,
    sample: read ? read.sample : 0,
    coverage: sample ? (read ? read.sample / sample : 0) : 0,
    detail,
  });

  const components: BreadthComponent[] = [
    component("aboveEma25", "Above EMA25", share(rows, (row) => above(row, "ema25")), "names trading above the fast ribbon"),
    component("aboveEma50", "Above EMA50", share(rows, (row) => above(row, "ema50")), "names trading above the base ribbon"),
    component("aboveSma200", "Above SMA200", share(rows, (row) => above(row, "sma200")), "names above the long-term filter"),
    component("advanceDecline", "Advance / decline", advanceDecline(rows), "advancing share of the names that moved"),
    component("nearHigh", "Near 1M high", nearHigh(rows), "names within 5% of their one-month high, centred on a 25% base rate"),
  ];

  const available = components.filter((item) => item.score !== null);
  const availableWeight = available.reduce((sum, item) => sum + item.weight, 0);
  const usable = available.length >= MIN_COMPOSITE_COMPONENTS && availableWeight >= MIN_COMPOSITE_COVERAGE;
  const score = usable
    ? available.reduce((sum, item) => sum + (item.score as number) * item.weight, 0) / availableWeight
    : null;

  return {
    score,
    regime: rawBreadthRegime(score),
    components,
    sample,
    coverage: availableWeight,
    state: score === null ? "unavailable" : "live",
    methodology:
      "Participation breadth across every scanned IDX name: EMA25 25%, EMA50 25%, SMA200 20%, advance/decline 15%, near one-month high 15% (centred on a 25% base rate). Missing components leave the denominator. The weekly regime adds a 4-point hysteresis buffer and a crash override at 25.",
  };
}
