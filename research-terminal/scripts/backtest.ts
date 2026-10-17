// CLI: replay the V5 weekly model over real history and compare policy variants.
//
//   npm run backtest -- --years=2 --limit=60
//   npm run backtest -- --tickers=BBCA,BBRI,TLKM --years=3
//   npm run backtest -- --limit=0 --scale-out   # every name in the universe
//
// It downloads daily bars from Yahoo, recomputes the indicators offline, and
// prints how each candidate rule change would have performed. Read it as a way
// to choose between variants, not as a promise of future returns.

import { runBacktest, macroReadFor, type BacktestPolicy, type BacktestResult, type BacktestBar, type MacroRead } from "../lib/backtest.ts";
import { MACRO_SYMBOLS, macroExposure, type MacroBar } from "../lib/macro-risk.ts";
import { DEFAULT_POLICY, type Setup } from "../lib/setup-model.ts";
import { loadUniverse, fetchBars, pool } from "./yahoo.ts";

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

// Macro / regional series that feed the exposure overlay. USD/IDR leads local
// risk appetite; ^VIX and the regional indices carry the global read.
// Broader set fetched only for the diagnostic screen; the shipped overlay uses
// the narrower MACRO_SYMBOLS from lib/macro-risk.
const SCAN_SYMBOLS = ["IDR=X", "^VIX", "^JKSE", "^HSI", "^KS11", "^N225", "^STI", "^GSPC", "DX-Y.NYB", "^TNX", "CL=F", "GC=F", "EEM"];
const IDR = "IDR=X";
const VIX = "^VIX";
const REGION = ["^HSI", "^KS11", "^N225", "^STI"];

async function loadMacro(from: string): Promise<Map<string, BacktestBar[]>> {
  const out = new Map<string, BacktestBar[]>();
  await pool(SCAN_SYMBOLS, 4, async (symbol) => {
    out.set(symbol, await fetchBars(symbol, from));
  });
  console.error(`Macro series: ${[...out].filter(([, bars]) => bars.length).length}/${SCAN_SYMBOLS.length} loaded.`);
  return out;
}

// Individual risk-off reads. Each returns a half-size multiplier, or 1 when calm.
const idrWeak = (read: MacroRead): number => {
  const move = read.change(IDR, 20); // USD/IDR up = rupiah weaker = risk-off
  return move !== null && move > 0 ? 0.5 : 1;
};
/** Exposure scale on rupiah weakness over `sessions` days (1 = full size). */
const idrScale = (sessions: number, defensive = 0.5) => (read: MacroRead): number => {
  const move = read.change(IDR, sessions);
  return move !== null && move > 0 ? defensive : 1;
};
const vixHigh = (read: MacroRead): number => {
  const level = read.value(VIX);
  return level !== null && level >= 22 ? 0.5 : 1;
};
const regionSoft = (read: MacroRead): number => {
  const distances = REGION.map((symbol) => read.distFromSma(symbol, 200)).filter((value): value is number => value !== null);
  if (!distances.length) return 1;
  return distances.reduce((sum, value) => sum + value, 0) / distances.length < 0 ? 0.5 : 1;
};
const indexSoft = (read: MacroRead): number => {
  const distance = read.distFromSma("^JKSE", 200);
  return distance !== null && distance < 0 ? 0.5 : 1;
};
const riskFlags = (read: MacroRead): number =>
  [idrWeak(read), vixHigh(read), regionSoft(read), indexSoft(read)].filter((value) => value < 1).length;

function row(label: string, result: BacktestResult): string {
  const s = result.summary;
  return [
    label.padEnd(26),
    String(s.trades).padStart(6),
    money(s.winRate, 0).padStart(6),
    signed(s.avgReturn).padStart(10),
    money(s.profitFactor).padStart(6),
    signed(s.tail).padStart(9),
    signed(s.portfolioReturn, 1).padStart(9),
    signed(s.maxDrawdown).padStart(9),
    signed(s.worst).padStart(9),
  ].join(" ");
}

function header(): string {
  return ["VARIANT".padEnd(26), "TRADES".padStart(6), "WIN%".padStart(6), "AVG RET".padStart(10), "PF".padStart(6), "TAIL 5%".padStart(9), "PORT RET".padStart(9), "MAX DD".padStart(9), "WORST".padStart(9)].join(" ");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const loaded = await loadUniverse(args);
  const barsByTicker = loaded.barsByTicker;
  const sectors = loaded.sectors;
  const calendar = loaded.calendar;
  const scanDates = loaded.scanDates.filter((date) => (!args.from || date >= args.from) && (!args.to || date <= args.to));
  console.error(`Window: ${scanDates[0] ?? "—"} → ${scanDates[scanDates.length - 1] ?? "—"} (${scanDates.length} scans).`);

  const macroFrom = new Date(Date.now() - args.years * 365 * 86_400_000).toISOString().slice(0, 10);
  const macroBars = await loadMacro(macroFrom);
  // The shipped overlay (lib/macro-risk) reads the same series; run it through
  // the same function so the backtest cannot drift from the live model.
  const macroSeries = new Map<string, MacroBar[]>(MACRO_SYMBOLS.map((symbol) => [symbol, (macroBars.get(symbol) ?? []).map((bar) => ({ date: bar.date, close: bar.close }))]));
  const shippedExposure = (read: MacroRead): number => macroExposure(macroSeries, read.date).exposure;

  // A modest short list; flip this on with the BEI-eligible list to include shorts.
  const shortEligible = new Set<string>();

  const variants: Array<{ label: string; policy: Partial<BacktestPolicy>; scoreWith?: (setup: Setup) => number }> = [
    { label: "baseline (live)", policy: {} },
    { label: "with reversals", policy: { excludeSetups: [] } },
    { label: "costs 0.4%", policy: { costPct: 0.4 } },
    { label: "hold + costs", policy: { holdThroughDrops: true, costPct: 0.4 } },
    { label: "hold + index>200d + costs", policy: { holdThroughDrops: true, marketSma: 200, costPct: 0.4 } },
    { label: "atr stops + hold + costs", policy: { holdThroughDrops: true, plan: { ...DEFAULT_POLICY, stopMode: "atr" }, costPct: 0.4 } },
    // --- Macro / regional overlay study, layered on the shipped policy ---
    // Judged on portfolio return AND drawdown in BOTH halves of the sample. The
    // "always 50%" row is the null: if a signal cannot beat plain deleveraging it
    // is not a timing signal at all.
    { label: "macro: base 70% (shipped)", policy: { holdThroughDrops: true, costPct: 0.4, macro: shippedExposure } },
    { label: "macro: base 60%", policy: { holdThroughDrops: true, costPct: 0.4, macro: (read) => macroExposure(macroSeries, read.date, 0.6).exposure } },
    { label: "macro: base 50%", policy: { holdThroughDrops: true, costPct: 0.4, macro: (read) => macroExposure(macroSeries, read.date, 0.5).exposure } },
    { label: "macro: base 80%", policy: { holdThroughDrops: true, costPct: 0.4, macro: (read) => macroExposure(macroSeries, read.date, 0.8).exposure } },
    { label: "macro: base 100% (prev)", policy: { holdThroughDrops: true, costPct: 0.4, macro: (read) => macroExposure(macroSeries, read.date, 1).exposure } },
    { label: "control: always 50%", policy: { holdThroughDrops: true, costPct: 0.4, macro: () => 0.5 } },
  ];

  // The live model now uses the fitted score, so the baseline is the fitted
  // variant. The legacy row keeps the old hand-tuned score visible for contrast.
  variants.push({ label: "legacy score", policy: {}, scoreWith: (setup) => setup.legacyScore });

  const runs = variants.map((variant) => ({ label: variant.label, result: runBacktest({ scanDates, barsByTicker, marketBars: calendar, macroBars, sectors, shortEligible, policy: variant.policy, scoreWith: variant.scoreWith }) }));

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

  // Does a macro read actually separate good weeks from bad ones? For each read,
  // compare the settled trades whose scan week it flagged against the rest.
  if (macroBars.size) {
    console.log("\nMacro signal diagnostic (baseline trades grouped by scan week):");
    const up = (symbol: string, days: number) => (read: MacroRead) => { const v = read.change(symbol, days); return v !== null && v > 0; };
    const down = (symbol: string, days: number) => (read: MacroRead) => { const v = read.change(symbol, days); return v !== null && v < 0; };
    const aboveSma = (symbol: string, days: number) => (read: MacroRead) => { const v = read.distFromSma(symbol, days); return v !== null && v > 0; };
    const belowSma = (symbol: string, days: number) => (read: MacroRead) => { const v = read.distFromSma(symbol, days); return v !== null && v < 0; };
    const signals: Array<[string, (read: MacroRead) => boolean]> = [
      ["idr up 20d", up(IDR, 20)],
      ["idr up 5d", up(IDR, 5)],
      ["idr > sma50", aboveSma(IDR, 50)],
      ["dxy up 20d", up("DX-Y.NYB", 20)],
      ["us10y up 20d", up("^TNX", 20)],
      ["vix up 5d", up(VIX, 5)],
      ["vix ≥22", (read) => vixHigh(read) < 1],
      ["spx dn 20d", down("^GSPC", 20)],
      ["hsi dn 20d", down("^HSI", 20)],
      ["oil up 20d", up("CL=F", 20)],
      ["gold up 20d", up("GC=F", 20)],
      ["eem dn 20d", down("EEM", 20)],
      ["jkse dn 20d", down("^JKSE", 20)],
      ["jkse < 200d", belowSma("^JKSE", 200)],
      ["region < 200d", (read) => regionSoft(read) < 1],
    ];
    for (const [name, flag] of signals) {
      let on = 0, onSum = 0, onWins = 0, off = 0, offSum = 0, offWins = 0;
      for (const trade of baseline.trades) {
        if (trade.returnPct === null) continue;
        if (flag(macroReadFor(macroBars, trade.weekOf))) {
          on += 1; onSum += trade.returnPct; if (trade.returnPct > 0) onWins += 1;
        } else {
          off += 1; offSum += trade.returnPct; if (trade.returnPct > 0) offWins += 1;
        }
      }
      const onAvg = on ? onSum / on : 0;
      const offAvg = off ? offSum / off : 0;
      console.log(`  ${name.padEnd(12)} flagged n=${String(on).padStart(3)}  avg=${signed(onAvg).padStart(7)}  win=${on ? money((onWins / on) * 100, 0) : "—"}%   |  clear n=${String(off).padStart(3)}  avg=${signed(offAvg).padStart(7)}  win=${off ? money((offWins / off) * 100, 0) : "—"}%`);
    }
  }

  console.log("\nReversal trades by score bucket:");
  const reversals = runs.find((run) => run.label === "with reversals")?.result ?? baseline;
  const revBuckets = new Map<string, any[]>();
  for (const trade of reversals.trades as any[]) {
    if (trade.setup !== "reversal") continue;
    const bucket = trade.score >= 90 ? "90+" : trade.score >= 85 ? "85-89" : trade.score >= 80 ? "80-84" : "<80";
    revBuckets.set(bucket, [...(revBuckets.get(bucket) ?? []), trade]);
  }
  for (const bucket of ["90+", "85-89", "80-84", "<80"]) {
    const list = revBuckets.get(bucket);
    if (!list?.length) continue;
    const wins = list.filter((t) => (t.returnPct ?? 0) > 0).length;
    const avg = list.reduce((sum, t) => sum + (t.returnPct ?? 0), 0) / list.length;
    console.log(`  ${bucket.padEnd(8)} n=${String(list.length).padStart(3)}  win=${money((wins / list.length) * 100, 0).padStart(3)}%  avg=${signed(avg).padStart(8)}`);
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
