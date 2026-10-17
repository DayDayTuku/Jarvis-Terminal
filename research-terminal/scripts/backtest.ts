// CLI: replay the V5 weekly model over real history and compare policy variants.
//
//   npm run backtest -- --years=2 --limit=60
//   npm run backtest -- --tickers=BBCA,BBRI,TLKM --years=3
//   npm run backtest -- --limit=0 --scale-out   # every name in the universe
//
// It downloads daily bars from Yahoo, recomputes the indicators offline, and
// prints how each candidate rule change would have performed. Read it as a way
// to choose between variants, not as a promise of future returns.

import { IDX_UNIVERSE } from "../lib/idx-universe.ts";
import { runBacktest, type BacktestBar, type BacktestPolicy, type BacktestResult } from "../lib/backtest.ts";
import { DEFAULT_POLICY } from "../lib/setup-model.ts";

type Args = { years: number; limit: number; tickers: string[] | null; scaleOut: boolean; concurrency: number };

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | undefined => argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
  const tickers = get("tickers");
  return {
    years: Number(get("years") ?? 2),
    limit: Number(get("limit") ?? 60),
    tickers: tickers ? tickers.split(",").map((ticker) => ticker.trim().toUpperCase()) : null,
    scaleOut: argv.includes("--scale-out"),
    concurrency: Number(get("concurrency") ?? 5),
  };
}

async function fetchBars(symbol: string, from: string): Promise<BacktestBar[]> {
  const period1 = Math.floor(Date.parse(`${from}T00:00:00Z`) / 1000);
  const period2 = Math.floor(Date.now() / 1000) + 86_400;
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d`;
  try {
    const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!response.ok) return [];
    const json: any = await response.json();
    const result = json?.chart?.result?.[0];
    const quote = result?.indicators?.quote?.[0];
    const stamps: number[] = Array.isArray(result?.timestamp) ? result.timestamp : [];
    if (!quote || !stamps.length) return [];
    return stamps
      .map((stamp, index) => ({
        date: new Date(stamp * 1000).toISOString().slice(0, 10),
        open: Number(quote.open?.[index]),
        high: Number(quote.high?.[index]),
        low: Number(quote.low?.[index]),
        close: Number(quote.close?.[index]),
        volume: Number(quote.volume?.[index]),
      }))
      .filter((bar) => bar.date && [bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite));
  } catch {
    return [];
  }
}

async function pool<T, R>(items: T[], size: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;
  const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
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
  const universe = args.tickers
    ? args.tickers.map((ticker) => ({ ticker, sector: "Other" }))
    : IDX_UNIVERSE.map((stock) => ({ ticker: stock.ticker.replace(".JK", ""), sector: stock.sector })).slice(0, args.limit || undefined);

  const from = new Date(Date.now() - args.years * 365 * 86_400_000).toISOString().slice(0, 10);
  console.error(`Fetching ${universe.length} tickers from ${from} …`);

  const calendar = await fetchBars("^JKSE", from);
  if (!calendar.length) throw new Error("Could not load the Jakarta Composite for the scan calendar.");
  const scanDates = calendar.filter((bar, index) => new Date(`${bar.date}T00:00:00Z`).getUTCDay() === 5 && index > 60).map((bar) => bar.date);
  console.error(`Calendar: ${calendar.length} bars, ${scanDates.length} weekly scans.`);

  const bars = await pool(universe, args.concurrency, async (entry) => ({ entry, bars: await fetchBars(`${entry.ticker}.JK`, from) }));
  const barsByTicker = new Map<string, BacktestBar[]>();
  const sectors = new Map<string, string>();
  for (const { entry, bars: series } of bars) {
    if (series.length > 60) {
      barsByTicker.set(entry.ticker, series);
      sectors.set(entry.ticker, entry.sector);
    }
  }
  console.error(`Replaying ${barsByTicker.size} tickers with data.`);

  // A modest short list; flip this on with the BEI-eligible list to include shorts.
  const shortEligible = new Set<string>();

  const variants: Array<{ label: string; policy: Partial<BacktestPolicy> }> = [
    { label: "baseline (live)", policy: {} },
    { label: "atr stops", policy: { plan: { ...DEFAULT_POLICY, stopMode: "atr" } } },
    { label: "room targets", policy: { plan: { ...DEFAULT_POLICY, targetMode: "room" } } },
    { label: "minRR 2.0", policy: { minRiskReward: 2.0 } },
    { label: "scale-out", policy: { scaleOut: true } },
    { label: "time stop 20d", policy: { maxHoldingDays: 20 } },
    { label: "atr+room+scale+time", policy: { plan: { ...DEFAULT_POLICY, stopMode: "atr", targetMode: "room" }, scaleOut: true, maxHoldingDays: 20 } },
  ];

  const runs = variants.map((variant) => ({ label: variant.label, result: runBacktest({ scanDates, barsByTicker, sectors, shortEligible, policy: variant.policy }) }));

  console.log("");
  console.log(header());
  console.log("-".repeat(header().length));
  for (const run of runs) console.log(row(run.label, run.result));

  const baseline = runs[0].result;
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
  console.log("");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
