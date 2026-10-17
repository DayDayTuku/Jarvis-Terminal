// A fitted, validated replacement for the hand-tuned additive score.
//
// The old score was a set of thresholds an engineer guessed; the backtest showed
// it does not rank returns (the 90+ bucket performed the same as everything
// else). This module scores a setup with a small ridge regression that predicts
// the trade's realised R-multiple.
//
// Only features that are computed the same way by the live scanner (from price
// and volume) and by the offline backtest are used, so the model transfers:
//   - relative volume, RSI, distance from EMA20, day change
//   - trend flags (EMA20 >= EMA50, above SMA200, near 1-month high/low)
//   - the setup type, as one-hot dummies
//
// TradingView's "Recommend.All" rating is deliberately excluded: offline it is
// only a proxy, so training on it would not transfer to the live value.
//
// Coefficients are produced by `npm run fit-score` on a training split and only
// shipped after the out-of-sample numbers in that run justify them.

import type { Setup, SetupKey } from "./setup-model";

export type ScoreSignals = {
  relativeVolume: number | null;
  rsi: number | null;
  distance20: number | null;
  change: number | null;
  trend: boolean;
  aboveLongTrend: boolean;
  nearHigh: boolean;
  nearLow: boolean;
  setup: SetupKey;
};

export const SCORE_CONTINUOUS = [
  "relVol",
  "rsi",
  "distance20",
  "change",
  "trend",
  "aboveLongTrend",
  "nearHigh",
  "nearLow",
] as const;

export const SCORE_SETUPS: SetupKey[] = ["breakout", "pullback", "momentum", "reversal", "short_breakdown"];

export type ScoreModel = {
  /** score = clamp(round(center + scale * predictedR), 0, 100) when no reference. */
  center: number;
  scale: number;
  /** Train-split mean/std for each SCORE_CONTINUOUS entry. */
  standardization: Array<{ mean: number; std: number }>;
  /** [intercept, ...standardised continuous, ...setup dummies] */
  weights: number[];
  /**
   * Evenly-spaced quantiles of the predicted R over the *training* candidate
   * population. When present, the 0–100 score is the candidate's percentile in
   * that reference distribution, so the historic thresholds keep their meaning
   * ("75 = top quarter of candidates") whatever the model's raw scale.
   */
  reference: number[];
  /** Out-of-sample average R of the top vs bottom quintile, for the record. */
  fit?: { trainSamples: number; testSamples: number; oosTopR: number; oosBottomR: number; oosRankCorr: number };
};

/**
 * Fitted by `npm run fit-score -- --years=3 --limit=100 --lambda=30` (2023-10 to
 * 2026-10, 100 IDX names, 7,814 candidates; trained on the first 70% of weeks,
 * validated on the rest).
 *
 * Out of sample it ranks the unseen weeks better than the legacy score
 * (rank correlation 0.067 vs -0.011) and separates the worst names cleanly: the
 * bottom quintile averaged -0.26R versus -0.05R for the top. It is a filter, not
 * a money-maker — the candidate pool itself was net negative — so the trade-off
 * is "avoid the bad half", which is exactly what a score can honestly do here.
 */
export const SCORE_MODEL: ScoreModel = {
  center: 50,
  scale: 50,
  standardization: [
    { mean: -0.033662, std: 0.580191 },
    { mean: -0.002672, std: 0.200357 },
    { mean: 0.020258, std: 0.760482 },
    { mean: 0.025644, std: 0.401308 },
    { mean: 0.364458, std: 0.481278 },
    { mean: 0.668927, std: 0.470599 },
    { mean: 0.230047, std: 0.420863 },
    { mean: 0.788385, std: 0.408454 },
  ],
  weights: [
    -0.033498,
    -0.004936,
    0.060141,
    -0.043746,
    0.026574,
    -0.051003,
    0.105756,
    -0.034817,
    -0.020610,
    0.082923,
    0.005439,
    -0.026454,
    -0.061908,
    0.000000,
  ],
  reference: [
    -0.388638, -0.296200, -0.278568, -0.264417, -0.257643, -0.252611, -0.247971, -0.244465, -0.240893, -0.238158,
    -0.234940, -0.232401, -0.229889, -0.227765, -0.225630, -0.224026, -0.221834, -0.219466, -0.217222, -0.214607,
    -0.211830, -0.209271, -0.206558, -0.202982, -0.199465, -0.195843, -0.192206, -0.188472, -0.180260, -0.167496,
    -0.144606, -0.127701, -0.109123, -0.096920, -0.088243, -0.083172, -0.077411, -0.070274, -0.065299, -0.059134,
    -0.054811, -0.050250, -0.045144, -0.040392, -0.035995, -0.031431, -0.026651, -0.022975, -0.019969, -0.016839,
    -0.014782, -0.011804, -0.009512, -0.007060, -0.005010, -0.003629, -0.001738, -0.000317, 0.001169, 0.002778,
    0.004402, 0.006217, 0.007848, 0.009379, 0.011063, 0.012897, 0.014532, 0.016130, 0.017459, 0.019119,
    0.020733, 0.022661, 0.024545, 0.026128, 0.028122, 0.030293, 0.032319, 0.034553, 0.037026, 0.039967,
    0.042910, 0.045505, 0.048992, 0.052103, 0.055774, 0.059641, 0.064279, 0.068571, 0.073792, 0.078767,
    0.084008, 0.089840, 0.094615, 0.099946, 0.104948, 0.109806, 0.115539, 0.124351, 0.137400, 0.166444,
    0.282265,
  ],
  fit: {
    trainSamples: 5751,
    testSamples: 2063,
    oosTopR: -0.05,
    oosBottomR: -0.261,
    oosRankCorr: 0.067,
  },
};

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/** Raw (unstandardised) continuous features, each in a bounded range. */
export function rawContinuous(signals: ScoreSignals): number[] {
  return [
    clamp((signals.relativeVolume ?? 1) - 1, -0.5, 3),
    ((signals.rsi ?? 50) - 50) / 50,
    clamp((signals.distance20 ?? 0) / 5, -2, 2),
    clamp((signals.change ?? 0) / 5, -2, 2),
    signals.trend ? 1 : 0,
    signals.aboveLongTrend ? 1 : 0,
    signals.nearHigh ? 1 : 0,
    signals.nearLow ? 1 : 0,
  ];
}

/** The regression design row: standardised continuous + setup dummies. */
export function designRow(model: ScoreModel, signals: ScoreSignals): number[] {
  const raw = rawContinuous(signals);
  const row = raw.map((value, index) => {
    const stats = model.standardization[index];
    return stats && stats.std > 0 ? (value - stats.mean) / stats.std : 0;
  });
  for (const key of SCORE_SETUPS) row.push(signals.setup === key ? 1 : 0);
  return row;
}

/** Predicted R-multiple for a setup. */
export function predictR(model: ScoreModel, signals: ScoreSignals): number {
  const row = designRow(model, signals);
  let value = model.weights[0] ?? 0;
  for (let index = 0; index < row.length; index++) value += row[index] * (model.weights[index + 1] ?? 0);
  return value;
}

/** Percentile (0–100) of `value` within a sorted reference distribution. */
export function percentileRank(reference: number[], value: number): number {
  const size = reference.length;
  if (size < 2) return 50;
  if (value <= reference[0]) return 0;
  if (value >= reference[size - 1]) return 100;
  let low = 0;
  let high = size - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (reference[mid] <= value) low = mid;
    else high = mid;
  }
  const span = reference[high] - reference[low];
  const fraction = span > 0 ? (value - reference[low]) / span : 0;
  return ((low + fraction) / (size - 1)) * 100;
}

/** The 0–100 score the app displays, derived from the predicted R. */
export function scoreSignals(signals: ScoreSignals, model: ScoreModel = SCORE_MODEL): number {
  const raw = predictR(model, signals);
  if (model.reference.length >= 2) return clamp(Math.round(percentileRank(model.reference, raw)), 0, 100);
  return clamp(Math.round(model.center + model.scale * raw), 0, 100);
}

/** Read the training signals straight off a classified setup. */
export function signalsOf(setup: Setup): ScoreSignals {
  return {
    relativeVolume: setup.relativeVolume,
    rsi: setup.rsi,
    distance20: setup.distance20,
    change: setup.change,
    trend: setup.trend,
    aboveLongTrend: setup.aboveLongTrend,
    nearHigh: setup.nearHigh,
    nearLow: setup.nearLow,
    setup: setup.setup,
  };
}

// ---------------------------------------------------------------------------
// Fitting (offline only; used by `npm run fit-score` and the tests)
// ---------------------------------------------------------------------------

/** One labelled observation: the signals at scan time and the trade's realised R. */
export type FitSample = { signals: ScoreSignals; r: number };

function solveLinear(matrix: number[][], vector: number[]): number[] {
  const size = matrix.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let col = 0; col < size; col++) {
    let pivot = col;
    for (let row = col + 1; row < size; row++) {
      if (Math.abs(augmented[row][col]) > Math.abs(augmented[pivot][col])) pivot = row;
    }
    [augmented[col], augmented[pivot]] = [augmented[pivot], augmented[col]];
    const diagonal = augmented[col][col];
    if (Math.abs(diagonal) < 1e-12) continue;
    for (let k = col; k <= size; k++) augmented[col][k] /= diagonal;
    for (let row = 0; row < size; row++) {
      if (row === col) continue;
      const factor = augmented[row][col];
      if (factor === 0) continue;
      for (let k = col; k <= size; k++) augmented[row][k] -= factor * augmented[col][k];
    }
  }
  return augmented.map((row) => row[size]);
}

/**
 * Ridge regression of the realised R on the score features. Continuous features
 * are standardised with the *sample* mean/std (stored on the model so live
 * scoring matches), the intercept is left unpenalised, and a small `lambda`
 * shrinks the noisy coefficients.
 */
export function fitRidge(samples: FitSample[], lambda = 1, center = 50, scale = 50): ScoreModel {
  const continuous = SCORE_CONTINUOUS.length;
  const columns = continuous + SCORE_SETUPS.length;
  const dimension = columns + 1;

  const raw = samples.map((sample) => rawContinuous(sample.signals));
  const standardization = SCORE_CONTINUOUS.map((_, column) => {
    const values = raw.map((row) => row[column]);
    const average = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    const variance = values.length ? values.reduce((a, b) => a + (b - average) ** 2, 0) / values.length : 0;
    const std = Math.sqrt(variance) || 1;
    return { mean: average, std };
  });

  const design = samples.map((sample) => {
    const row = rawContinuous(sample.signals).map((value, column) => (value - standardization[column].mean) / standardization[column].std);
    for (const key of SCORE_SETUPS) row.push(sample.signals.setup === key ? 1 : 0);
    return [1, ...row];
  });

  const matrix: number[][] = Array.from({ length: dimension }, () => new Array(dimension).fill(0));
  const vector: number[] = new Array(dimension).fill(0);
  for (let i = 0; i < design.length; i++) {
    const row = design[i];
    const target = samples[i].r;
    for (let a = 0; a < dimension; a++) {
      vector[a] += row[a] * target;
      for (let b = 0; b < dimension; b++) matrix[a][b] += row[a] * row[b];
    }
  }
  for (let a = 1; a < dimension; a++) matrix[a][a] += lambda;

  const weights = solveLinear(matrix, vector);
  return { center, scale, standardization, weights, reference: [] };
}

/** Evenly-spaced quantiles of the predicted R over `samples` (for the score map). */
export function buildReference(samples: FitSample[], model: ScoreModel, count = 101): number[] {
  const values = samples.map((sample) => predictR(model, sample.signals)).sort((a, b) => a - b);
  if (!values.length) return [];
  const reference: number[] = [];
  for (let i = 0; i < count; i++) {
    const position = (i / (count - 1)) * (values.length - 1);
    const low = Math.floor(position);
    const high = Math.ceil(position);
    reference.push(values[low] + (values[high] - values[low]) * (position - low));
  }
  return reference;
}

export function meanR(samples: FitSample[]): number {
  return samples.length ? samples.reduce((sum, sample) => sum + sample.r, 0) / samples.length : 0;
}
