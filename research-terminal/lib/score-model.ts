// A fitted, validated replacement for the hand-tuned additive score.
//
// The old score was a set of thresholds an engineer guessed; the backtest showed
// it does not rank returns (the 90+ bucket performed the same as everything
// else). This module scores a setup with a small ridge regression that predicts
// the trade's realised R-multiple.
//
// Only features that are computed the same way by the live scanner (from price
// and volume) and by the offline backtest are used, so the model transfers:
//   - relative volume, RSI, distance from the EMA25 base, day change
//   - ribbon flags (EMA25 >= EMA50, price above SMA200, near 1-month high/low)
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
    { mean: -0.025846, std: 0.578268 },
    { mean: 0.014985, std: 0.201794 },
    { mean: 0.092072, std: 0.897539 },
    { mean: 0.023487, std: 0.429829 },
    { mean: 0.446728, std: 0.497154 },
    { mean: 0.759849, std: 0.427175 },
    { mean: 0.224734, std: 0.417407 },
    { mean: 0.742035, std: 0.437515 },
  ],
  weights: [
    -0.006499,
    -0.033871,
    -0.006493,
    0.002794,
    0.032261,
    -0.011061,
    0.074279,
    -0.030971,
    -0.016141,
    0.097874,
    -0.033294,
    -0.026000,
    -0.038580,
    0.000000,
  ],
  reference: [
    -0.346730, -0.230956, -0.209106, -0.196988, -0.184966, -0.179140, -0.172936, -0.167847, -0.164037, -0.160071,
    -0.157173, -0.154006, -0.151765, -0.148892, -0.145733, -0.143051, -0.140745, -0.137971, -0.135186, -0.131973,
    -0.128300, -0.124094, -0.119967, -0.114611, -0.107899, -0.097013, -0.085823, -0.078699, -0.073849, -0.068579,
    -0.064350, -0.060691, -0.056594, -0.053368, -0.049742, -0.046559, -0.042488, -0.038682, -0.034941, -0.031949,
    -0.028682, -0.025700, -0.023022, -0.019773, -0.016101, -0.012710, -0.009889, -0.007591, -0.005455, -0.003337,
    -0.000864, 0.001380, 0.002969, 0.004516, 0.005822, 0.007813, 0.008952, 0.010618, 0.012447, 0.013811,
    0.015650, 0.016897, 0.018530, 0.019912, 0.021370, 0.022670, 0.023564, 0.025188, 0.026749, 0.027763,
    0.029196, 0.031000, 0.032472, 0.034357, 0.036449, 0.038001, 0.039248, 0.040364, 0.041734, 0.043408,
    0.044717, 0.046427, 0.047779, 0.049560, 0.050607, 0.052224, 0.053963, 0.056615, 0.058760, 0.060846,
    0.063925, 0.065582, 0.069514, 0.073849, 0.078981, 0.083629, 0.090717, 0.098308, 0.107142, 0.125556,
    0.209790,
  ],
  fit: {
    trainSamples: 2919,
    testSamples: 802,
    oosTopR: -0.001,
    oosBottomR: -0.426,
    oosRankCorr: 0.050,
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
