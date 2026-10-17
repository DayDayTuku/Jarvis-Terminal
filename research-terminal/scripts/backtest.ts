// CLI: replay the V5 weekly model over real history and compare policy variants.
//
//   npm run backtest -- --years=2 --limit=60
//   npm run backtest -- --tickers=BBCA,BBRI,TLKM --years=3
//   npm run backtest -- --limit=0 --scale-out   # every name in the universe
//
// It downloads daily bars from Yahoo, recomputes the indicators offline, and
// prints how each candidate rule change would have performed. Read it as a way
// to choose between variants, not as a promise of future returns.

import { runBacktest, type BacktestPolicy, type BacktestResult } from "../lib/backtest.ts";
import { DEFAULT_POLICY, type Setup } from "../lib/setup-model.ts";
import { loadUniverse } from "./yahoo.ts";

type Args = { years: number; limit: number; tickers: string[] | null; scaleOut: boolean; concurrency: number; from: string | null; to: string | null };

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | undefined => argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
  const tickers = get("tickers");
  return {
    years: Number(get("years") ?? 2),
    limit: Number(get("limit") ?? 60),
    tickers: tickers ? tickers.split(",").map((ticker) => ticker.trim().toUpperCase()) : null,
    scaleOut: argv.includes("--scale-out"),
    concurrency: Number(get("concurrency") ?? 5),
    from: get("from") ?? null,
    to: get("to") ?? null,
  };
}

const money = (value: number | null, digits = 2) => (value === null ? "—" : value.toFixed(digits));
const signed = (value: number | null, digits = 2) => (value === null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`);

function row(label: string, result: BacktestResult): string {
  const s = result.summary;
  return [
    label.padEnd(24),
    String(s.trades).padStart(6),
    String(s.noEntry).padStart(7),
    money(s.winRate, 0).padStart(8),
    signed(s.avgReturn).padStart(10),
    money(s.avgR).padStart(8),
    money(s.profitFactor).padStart(8),
    signed(s.worst).padStart(9),
    signed(s.best).padStart(9),
  ].join(" ");
}

function header(): string {
  return ["VARIANT".padEnd(24), "TRADES".padStart(6), "NOENTRY".padStart(7), "WIN%".padStart(8), "AVG RET".padStart(10), "AVG R".padStart(8), "PF".padStart(8), "WORST".padStart(9), "BEST".padStart(9)].join(" ");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const loaded = await loadUniverse(args);
  const barsByTicker = loaded.barsByTicker;
  const sectors = loaded.sectors;
  const calendar = loaded.calendar;
  const scanDates = loaded.scanDates.filter((date) => (!args.from || date >= args.from) && (!args.to || date <= args.to));
  console.error(`Window: ${scanDates[0] ?? "—"} → ${scanDates[scanDates.length - 1] ?? "—"} (${scanDates.length} scans).`);

  // A modest short list; flip this on with the BEI-eligible list to include shorts.
  const shortEligible = new Set<string>();

  const variants: Array<{ label: string; policy: Partial<BacktestPolicy>; scoreWith?: (setup: Setup) => number }> = [
    { label: "baseline (live)", policy: {} },
    { label: "liquid 10bn", policy: { minTurnoverIdr: 10_000_000_000 } },
    { label: "liquid 20bn", policy: { minTurnoverIdr: 20_000_000_000 } },
    { label: "costs 0.4%", policy: { costPct: 0.4 } },
    { label: "hold to stop/target", policy: { holdThroughDrops: true } },
    { label: "hold + costs", policy: { holdThroughDrops: true, costPct: 0.4 } },
    { label: "hold + 10bn + costs", policy: { holdThroughDrops: true, minTurnoverIdr: 10_000_000_000, costPct: 0.4 } },
    { label: "hold + 20bn + costs", policy: { holdThroughDrops: true, minTurnoverIdr: 20_000_000_000, costPct: 0.4 } },
    { label: "hold + index>200d + costs", policy: { holdThroughDrops: true, marketSma: 200, costPct: 0.4 } },
    { label: "room targets", policy: { plan: { ...DEFAULT_POLICY, targetMode: "room" } } },
    { label: "minRR 2.0", policy: { minRiskReward: 2.0, costPct: 0.4 } },
    { label: "minRR 2.0 + hold", policy: { minRiskReward: 2.0, holdThroughDrops: true, costPct: 0.4 } },
    { label: "minRR 2.0 + hold + 20bn", policy: { minRiskReward: 2.0, holdThroughDrops: true, minTurnoverIdr: 20_000_000_000, costPct: 0.4 } },
  ];

  // The live model now uses the fitted score, so the baseline is the fitted
  // variant. The legacy row keeps the old hand-tuned score visible for contrast.
  variants.push({ label: "legacy score", policy: {}, scoreWith: (setup) => setup.legacyScore });

  const runs = variants.map((variant) => ({ label: variant.label, result: runBacktest({ scanDates, barsByTicker, marketBars: calendar, sectors, shortEligible, policy: variant.policy, scoreWith: variant.scoreWith }) }));

  console.log("");
  console.log(header());
  console.log("-".repeat(header().length));
  for (const run of runs) console.log(row(run.label, run.result));

  const baseline = runs[0].result;
  const reasons = new Map<string, number>();
  for (const trade of baseline.trades) reasons.set(trade.exitReason, (reasons.get(trade.exitReason) ?? 0) + 1);
  console.log("\nBaseline exit reasons:");
  for (const [reason, count] of [...reasons].sort((a, b) => b[1] - a[1])) console.log(`  ${reason.padEnd(10)} ${count}`);
  console.log("\nBaseline by setup:");
  for (const entry of baseline.bySetup) {
    const s = entry.stats;
    console.log(`  ${entry.setup.padEnd(16)} n=${String(s.trades).padStart(3)}  win=${money(s.winRate, 0).padStart(3)}%  avg=${signed(s.avgReturn).padStart(8)}  avgR=${money(s.avgR).padStart(6)}  pf=${money(s.profitFactor)}`);
  }
  console.log("\nBaseline by score bucket:");
  for (const entry of baseline.byScore) {
    const s = entry.stats;
    console.log(`  ${entry.bucket.padEnd(8)} n=${String(s.trades).padStart(3)}  win=${money(s.winRate, 0).padStart(3)}%  avg=${signed(s.avgReturn).padStart(8)}  avgR=${money(s.avgR).padStart(6)}`);
  }

  const fitted = runs.find((run) => run.label === "legacy score")?.result;
  if (fitted) {
    console.log("\nLegacy score by score bucket (for contrast — the old score was degenerate):");
    for (const entry of fitted.byScore) {
      const s = entry.stats;
      console.log(`  ${entry.bucket.padEnd(8)} n=${String(s.trades).padStart(3)}  win=${money(s.winRate, 0).padStart(3)}%  avg=${signed(s.avgReturn).padStart(8)}  avgR=${money(s.avgR).padStart(6)}`);
    }
  }
  console.log("");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
