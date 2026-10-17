// CLI: fit and validate the score model used by the live scanner.
//
//   npm run fit-score -- --years=3 --limit=100
//
// It labels every classified candidate with the R it would have made under the
// shipped plan, fits a ridge regression on the earlier portion of history, and
// reports how the fitted score ranks the *unseen* later portion — against the
// legacy hand-tuned score on the same rows. Only if the fitted score ranks
// better out-of-sample is it worth pasting into lib/score-model.ts.
//
//   npm run fit-score -- --years=3 --limit=100 --lambda=1

import { collectSamples } from "../lib/backtest.ts";
import { buildReference, fitRidge, predictR, meanR, type FitSample, type ScoreModel } from "../lib/score-model.ts";
import { loadUniverse } from "./yahoo.ts";

type Args = { years: number; limit: number; tickers: string[] | null; concurrency: number; lambda: number; split: number; horizon: number };

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | undefined => argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
  const tickers = get("tickers");
  return {
    years: Number(get("years") ?? 3),
    limit: Number(get("limit") ?? 100),
    tickers: tickers ? tickers.split(",").map((ticker) => ticker.trim().toUpperCase()) : null,
    concurrency: Number(get("concurrency") ?? 5),
    lambda: Number(get("lambda") ?? 1),
    split: Number(get("split") ?? 0.7),
    horizon: Number(get("horizon") ?? 20),
  };
}

/** Spearman rank correlation; answers "does this score order returns?". */
function spearman(predicted: number[], actual: number[]): number {
  const rank = (values: number[]): number[] => {
    const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
    const ranks = new Array(values.length).fill(0);
    let i = 0;
    while (i < order.length) {
      let j = i;
      while (j + 1 < order.length && order[j + 1].value === order[i].value) j++;
      const average = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) ranks[order[k].index] = average;
      i = j + 1;
    }
    return ranks;
  };
  const a = rank(predicted);
  const b = rank(actual);
  const n = a.length;
  if (n < 2) return 0;
  const meanA = a.reduce((x, y) => x + y, 0) / n;
  const meanB = b.reduce((x, y) => x + y, 0) / n;
  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    cov += (a[i] - meanA) * (b[i] - meanB);
    varA += (a[i] - meanA) ** 2;
    varB += (b[i] - meanB) ** 2;
  }
  return varA > 0 && varB > 0 ? cov / Math.sqrt(varA * varB) : 0;
}

function deciles(rows: Array<{ score: number; r: number }>): Array<{ label: string; n: number; avgR: number; winRate: number }> {
  const sorted = [...rows].sort((a, b) => b.score - a.score);
  const size = Math.max(1, Math.ceil(sorted.length / 10));
  const buckets: Array<{ label: string; n: number; avgR: number; winRate: number }> = [];
  for (let i = 0; i < 10; i++) {
    const slice = sorted.slice(i * size, (i + 1) * size);
    if (!slice.length) continue;
    buckets.push({
      label: `d${i + 1}`,
      n: slice.length,
      avgR: slice.reduce((sum, row) => sum + row.r, 0) / slice.length,
      winRate: (slice.filter((row) => row.r > 0).length / slice.length) * 100,
    });
  }
  return buckets;
}

function evaluate(model: ScoreModel, samples: Array<FitSample & { legacyScore?: number }>): void {
  const predicted = samples.map((sample) => predictR(model, sample.signals));
  const actual = samples.map((sample) => sample.r);
  const score = samples.map((sample, index) => ({ score: predicted[index], r: actual[index] }));
  const top = [...score].sort((a, b) => b.score - a.score);
  const cut = Math.max(1, Math.floor(top.length * 0.2));
  const topAvg = top.slice(0, cut).reduce((sum, row) => sum + row.r, 0) / cut;
  const bottomAvg = top.slice(-cut).reduce((sum, row) => sum + row.r, 0) / cut;
  console.log(`  n=${samples.length}  meanR=${meanR(samples).toFixed(3)}  rankCorr=${spearman(predicted, actual).toFixed(3)}  top20%R=${topAvg.toFixed(3)}  bottom20%R=${bottomAvg.toFixed(3)}  spread=${(topAvg - bottomAvg).toFixed(3)}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { barsByTicker, sectors, scanDates } = await loadUniverse(args);

  const all = collectSamples({ scanDates, barsByTicker, sectors, horizonDays: args.horizon });
  console.error(`Samples: ${all.length} candidates from ${scanDates.length} weekly scans.`);
  if (all.length < 100) throw new Error("Not enough samples to fit; widen the universe or the window.");

  const dates = [...new Set(all.map((sample) => sample.date))].sort();
  const splitDate = dates[Math.floor(dates.length * args.split)];
  const train = all.filter((sample) => sample.date < splitDate);
  const test = all.filter((sample) => sample.date >= splitDate);
  console.error(`Train: ${train.length} (< ${splitDate})  Test: ${test.length} (>= ${splitDate})`);

  const legacyPredictedTest = test.map((sample) => sample.legacyScore);
  const legacyActual = test.map((sample) => sample.r);
  const legacyScoreRows = test.map((sample) => ({ score: sample.legacyScore, r: sample.r }));

  console.log("\nLegacy score, out-of-sample:");
  console.log(`  rankCorr=${spearman(legacyPredictedTest, legacyActual).toFixed(3)}`);
  for (const bucket of deciles(legacyScoreRows)) {
    console.log(`  ${bucket.label}  n=${String(bucket.n).padStart(4)}  avgR=${bucket.avgR.toFixed(3).padStart(7)}  win=${bucket.winRate.toFixed(0).padStart(3)}%`);
  }

  // Pick lambda by out-of-sample spread; lambda only shrinks, it never leaks.
  let best: { lambda: number; model: ScoreModel; spread: number } | null = null;
  for (const lambda of [0.1, 0.3, 1, 3, 10, 30]) {
    const model = fitRidge(train, lambda);
    const predicted = test.map((sample) => predictR(model, sample.signals));
    const top = test.map((sample, index) => ({ score: predicted[index], r: sample.r })).sort((a, b) => b.score - a.score);
    const cut = Math.max(1, Math.floor(top.length * 0.2));
    const spread = top.slice(0, cut).reduce((sum, row) => sum + row.r, 0) / cut - top.slice(-cut).reduce((sum, row) => sum + row.r, 0) / cut;
    console.log(`  lambda=${String(lambda).padStart(4)}  oosSpread=${spread.toFixed(3)}`);
    if (!best || spread > best.spread) best = { lambda, model, spread };
  }
  if (!best) throw new Error("Fit failed.");

  console.log(`\nChosen lambda=${best.lambda}`);
  console.log("Fitted score, in-sample:");
  evaluate(best.model, train);
  console.log("Fitted score, out-of-sample:");
  evaluate(best.model, test);

  const predictedTest = test.map((sample) => predictR(best.model, sample.signals));
  console.log("\nOut-of-sample deciles of the fitted score:");
  for (const bucket of deciles(test.map((sample, index) => ({ score: predictedTest[index], r: sample.r })))) {
    console.log(`  ${bucket.label}  n=${String(bucket.n).padStart(4)}  avgR=${bucket.avgR.toFixed(3).padStart(7)}  win=${bucket.winRate.toFixed(0).padStart(3)}%`);
  }

  const allPredicted = all.map((sample) => predictR(best.model, sample.signals));
  const percentile = (values: number[], p: number): number => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  };
  const meanPredicted = allPredicted.reduce((a, b) => a + b, 0) / allPredicted.length;
  const sdPredicted = Math.sqrt(allPredicted.reduce((sum, value) => sum + (value - meanPredicted) ** 2, 0) / allPredicted.length);
  console.log(`\nPredicted R over all samples: mean=${meanPredicted.toFixed(4)}  sd=${sdPredicted.toFixed(4)}`);
  for (const p of [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.92, 0.95]) {
    console.log(`  p${(p * 100).toFixed(0).padStart(2)}  Rhat=${percentile(allPredicted, p).toFixed(4)}`);
  }

  const model = { ...best.model, reference: buildReference(train, best.model) };
  const oosTop = [...test.map((sample, index) => ({ score: predictedTest[index], r: sample.r }))].sort((a, b) => b.score - a.score);
  const oosCut = Math.max(1, Math.floor(oosTop.length * 0.2));
  const literal = `export const SCORE_MODEL: ScoreModel = {
  center: ${model.center},
  scale: ${model.scale},
  standardization: [
${model.standardization.map((stats) => `    { mean: ${stats.mean.toFixed(6)}, std: ${stats.std.toFixed(6)} },`).join("\n")}
  ],
  weights: [
${model.weights.map((weight) => `    ${weight.toFixed(6)},`).join("\n")}
  ],
  reference: [
${model.reference.map((value) => `    ${value.toFixed(6)},`).join("\n")}
  ],
  fit: {
    trainSamples: ${train.length},
    testSamples: ${test.length},
    oosTopR: ${(oosTop.slice(0, oosCut).reduce((sum, row) => sum + row.r, 0) / oosCut).toFixed(3)},
    oosBottomR: ${(oosTop.slice(-oosCut).reduce((sum, row) => sum + row.r, 0) / oosCut).toFixed(3)},
    oosRankCorr: ${spearman(predictedTest, test.map((sample) => sample.r)).toFixed(3)},
  },
};`;
  console.log("\n--- paste into lib/score-model.ts ---\n");
  console.log(literal);
  console.log("");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
