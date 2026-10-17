import { NextResponse } from "next/server";
import { createClient } from "../../../utils/supabase/server";
import { tradeOutcome, collapseStreaks, type PriceBar, type PriorPosition } from "@/lib/weekly-lifecycle";

export const maxDuration = 60;

type RunRow = { id: string; week_of: string };
type CandidateRow = {
  run_id: string; ticker: string; setup: string; score: number;
  planned_entry_low: number; planned_entry_high: number; invalidation: number;
  hard_stop: number | null; target_one: number | null; position_weight: number | null;
};
type Trade = {
  weekOf: string; ticker: string; setup: string; score: number; weight: number;
  direction: "LONG" | "SHORT";
  status: "CLOSED" | "OPEN" | "NO_ENTRY";
  entryDate: string | null; entryPrice: number | null;
  exitDate: string | null; exitPrice: number | null;
  exitReason: "STOP" | "TARGET" | "TIME" | "OPEN" | "NO_ENTRY";
  returnPct: number | null; rMultiple: number | null;
};

/** Sessions a held position may stay open before it is marked out at the close. */
const HOLD_CAP_SESSIONS = 60;

const BENCHMARK_SYMBOL = "^JKSE";

type YahooQuote = { open?: Array<number | null>; high?: Array<number | null>; low?: Array<number | null>; close?: Array<number | null> };
type YahooChart = { chart?: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: YahooQuote[] } }> } };

async function getBars(symbol: string, since: string): Promise<PriceBar[]> {
  try {
    const period1 = Math.floor(new Date(`${since}T00:00:00+07:00`).getTime() / 1000);
    const period2 = Math.floor(Date.now() / 1000) + 86400;
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d`;
    const response = await fetch(url, { next: { revalidate: 900 } });
    if (!response.ok) return [];
    const json = (await response.json()) as YahooChart;
    const result = json?.chart?.result?.[0];
    const quote = result?.indicators?.quote?.[0];
    const timestamps: number[] = Array.isArray(result?.timestamp) ? result.timestamp : [];
    if (!quote || !timestamps.length) return [];
    return timestamps
      .map((stamp, index) => ({
        date: new Date(stamp * 1000).toISOString().slice(0, 10),
        open: Number(quote.open?.[index]),
        high: Number(quote.high?.[index]),
        low: Number(quote.low?.[index]),
        close: Number(quote.close?.[index]),
      }))
      .filter((bar) => bar.date && [bar.open, bar.high, bar.low, bar.close].every(Number.isFinite));
  } catch {
    return [];
  }
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: runData } = await supabase.from("jarvis_weekly_runs").select("id,week_of").order("week_of", { ascending: true });
  const runs = (runData ?? []) as RunRow[];
  if (!runs.length) return NextResponse.json({ trades: [], weeks: [], summary: null, benchmark: null, methodology: "per-pick, one-week plan" });

  const indexOfRun = new Map(runs.map((run, index) => [run.id, index]));
  const { data: candidateData } = await supabase
    .from("jarvis_weekly_candidates")
    .select("run_id,ticker,setup,score,planned_entry_low,planned_entry_high,invalidation,hard_stop,target_one,position_weight")
    .in("run_id", runs.map((run) => run.id));
  const candidates = (candidateData ?? []) as CandidateRow[];

  // Group each ticker's appearances across weeks, then collapse them into
  // contiguous holding streaks (a name that leaves the picks closes the trade).
  const byTicker = new Map<string, Array<{ index: number; row: CandidateRow }>>();
  for (const row of candidates) {
    const index = indexOfRun.get(row.run_id);
    if (index === undefined) continue;
    const list = byTicker.get(row.ticker) ?? [];
    list.push({ index, row });
    byTicker.set(row.ticker, list);
  }

  type Streak = { ticker: string; openIndex: number; closeIndex: number | null; plan: CandidateRow };
  const streaks: Streak[] = [];
  for (const [ticker, appearances] of byTicker) {
    appearances.sort((a, b) => a.index - b.index);
    const rowByIndex = new Map(appearances.map((appearance) => [appearance.index, appearance.row]));
    for (const streak of collapseStreaks(appearances.map((appearance) => appearance.index), runs.length)) {
      const plan = rowByIndex.get(streak.openIndex);
      if (plan) streaks.push({ ticker, openIndex: streak.openIndex, closeIndex: streak.closeIndex, plan });
    }
  }

  const earliest = new Map<string, string>();
  for (const streak of streaks) {
    const week = runs[streak.openIndex].week_of;
    const prior = earliest.get(streak.ticker);
    if (!prior || week < prior) earliest.set(streak.ticker, week);
  }
  // Small batches: enough to be quick, few enough that Yahoo never rate-limits us.
  const barsByTicker = new Map<string, PriceBar[]>();
  const tickers = [...earliest.entries()];
  for (let i = 0; i < tickers.length; i += 5) {
    await Promise.all(tickers.slice(i, i + 5).map(async ([ticker, since]) => {
      barsByTicker.set(ticker, await getBars(`${ticker}.JK`, since));
    }));
  }

  const trades: Trade[] = [];
  for (const streak of streaks) {
    const openWeek = runs[streak.openIndex].week_of;
    // Hold to the stop or the first target: leaving the weekly list no longer
    // closes a position early, it just stops adding to it. The plan stays live
    // until a level is reached or the holding cap is hit.
    const bars = (barsByTicker.get(streak.ticker) ?? []).filter((bar) => bar.date && bar.date > openWeek);
    const outcome = tradeOutcome(streak.plan as PriorPosition, bars, { maxHoldingDays: HOLD_CAP_SESSIONS });
    const status = outcome.status;
    const exitReason: Trade["exitReason"] =
      outcome.exitReason === "WEEK_END" ? "OPEN" : outcome.exitReason;
    trades.push({
      weekOf: openWeek,
      ticker: streak.ticker,
      setup: streak.plan.setup,
      score: streak.plan.score,
      weight: Number(streak.plan.position_weight) || 12.5,
      direction: outcome.direction,
      status,
      entryDate: outcome.entryDate,
      entryPrice: outcome.entryPrice,
      exitDate: outcome.exitDate,
      exitPrice: outcome.exitPrice,
      exitReason,
      returnPct: outcome.returnPct,
      rMultiple: outcome.rMultiple,
    });
  }
  trades.sort((a, b) => (a.weekOf < b.weekOf ? 1 : a.weekOf > b.weekOf ? -1 : a.ticker.localeCompare(b.ticker)));

  const settled = trades.filter((trade) => trade.status === "CLOSED" && trade.returnPct !== null);
  const open = trades.filter((trade) => trade.status === "OPEN");
  const noEntry = trades.filter((trade) => trade.status === "NO_ENTRY");
  const wins = settled.filter((trade) => (trade.returnPct ?? 0) > 0);
  const losses = settled.filter((trade) => (trade.returnPct ?? 0) <= 0);
  const grossGain = wins.reduce((sum, trade) => sum + (trade.returnPct ?? 0), 0);
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + (trade.returnPct ?? 0), 0));
  const rValues = settled.map((trade) => trade.rMultiple).filter((value): value is number => value !== null);
  const summary = {
    trades: settled.length,
    open: open.length,
    noEntry: noEntry.length,
    wins: wins.length,
    losses: losses.length,
    winRate: settled.length ? (wins.length / settled.length) * 100 : null,
    avgReturn: mean(settled.map((trade) => trade.returnPct as number)),
    avgR: mean(rValues),
    profitFactor: grossLoss > 0 ? grossGain / grossLoss : null,
    best: settled.length ? Math.max(...settled.map((trade) => trade.returnPct as number)) : null,
    worst: settled.length ? Math.min(...settled.map((trade) => trade.returnPct as number)) : null,
  };

  // Trade-sequenced, equal-weight equity curve (illustrative, one trade at a time).
  const ordered = [...settled].sort((a, b) => String(a.exitDate).localeCompare(String(b.exitDate)));
  let equity = 100;
  const curve = ordered.map((trade) => {
    equity *= 1 + (trade.returnPct ?? 0) / 100;
    return { date: trade.exitDate, weekOf: trade.weekOf, value: equity };
  });

  const entryDates = trades.map((trade) => trade.entryDate).filter((value): value is string => Boolean(value)).sort();
  const since = entryDates[0] ?? runs[0].week_of;
  const benchBars = await getBars(BENCHMARK_SYMBOL, since);
  const benchFirst = benchBars[0]?.close ?? null;
  const benchLast = benchBars[benchBars.length - 1]?.close ?? null;
  const benchmark = benchFirst && benchLast
    ? { symbol: "JKSE", from: benchBars[0].date, to: benchBars[benchBars.length - 1].date, returnPct: ((benchLast / benchFirst) - 1) * 100 }
    : null;

  const weekMap = new Map<string, Trade[]>();
  for (const trade of trades) {
    const list = weekMap.get(trade.weekOf) ?? [];
    list.push(trade);
    weekMap.set(trade.weekOf, list);
  }
  const weeks = [...weekMap.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([weekOf, list]) => {
      const closed = list.filter((trade) => trade.status === "CLOSED" && trade.returnPct !== null);
      return { weekOf, trades: list, closed: closed.length, winRate: closed.length ? (closed.filter((trade) => (trade.returnPct ?? 0) > 0).length / closed.length) * 100 : null };
    });

  return NextResponse.json({ trades, weeks, summary, benchmark, equity: curve, methodology: "entry on the published range · hold to the stop, the first target, or a 60-session cap" });
}
