// Carrying a held position between weekly runs.
//
// The V5 hold rule keeps a trade live until its stop or first target is hit, even
// after the name drops off the weekly list. That means the position must keep
// being evaluated at the next rollover and monitored intraday, which in turn
// means the rollover has to know about positions it can no longer see simply by
// looking at the previous week's candidates.
//
// The plan (entry range, stop, target) lives on jarvis_weekly_candidates and the
// live flags live on jarvis_weekly_actions. This module stitches the two back
// together using only columns that already exist, so no schema change is needed,
// and it builds the action rows for a new run in ONE place so the cron rollover
// and the admin manual lock can never drift apart.

import {
  evaluatePosition,
  isShortSetup,
  type LifecycleActionName,
  type LifecycleOutcome,
  type PriceBar,
  type PriorPosition,
} from "./weekly-lifecycle.ts";

// A structural view of the Supabase client so this module works with both the
// service-role client (cron) and the cookie client (admin lock).
type SupabaseLike = { from: (table: string) => any };

export type OpenCarried = {
  /** The original plan, with the still-live weight and latest score carried in. */
  plan: PriorPosition;
  entryFilled: boolean;
  targetReached: boolean;
};

export type WeeklyActionRow = {
  run_id: string;
  prior_run_id: string | null;
  ticker: string;
  action: LifecycleActionName;
  previous_score: number | null;
  current_score: number | null;
  target_weight: number;
  theoretical_fill: number | null;
  entry_filled: boolean;
  target_reached: boolean;
  invalidated: boolean;
  reason: string;
};

/** How far back to look for a position that is still being held. */
const CARRY_LOOKBACK_RUNS = 40;

export async function recentRunsBefore(
  supabase: SupabaseLike,
  weekOf: string,
): Promise<Array<{ id: string; week_of: string }>> {
  const { data } = await supabase
    .from("jarvis_weekly_runs")
    .select("id,week_of")
    .lt("week_of", weekOf)
    .order("week_of", { ascending: false })
    .limit(CARRY_LOOKBACK_RUNS);
  return (data ?? []) as Array<{ id: string; week_of: string }>;
}

/**
 * Positions that are still open but are not in `exclude` (the tickers already
 * handled as this week's candidates). The most recent action for a ticker decides
 * whether it is open (filled and never stopped) and its plan is the candidate row
 * from the last run it appeared in.
 */
export async function carriedPositions(
  supabase: SupabaseLike,
  runs: Array<{ id: string; week_of: string }>,
  exclude: Set<string>,
): Promise<OpenCarried[]> {
  if (!runs.length) return [];
  const weekOf = new Map(runs.map((run) => [run.id, run.week_of]));
  const ids = runs.map((run) => run.id);

  const { data: actions } = await supabase
    .from("jarvis_weekly_actions")
    .select("ticker,action,target_weight,entry_filled,target_reached,invalidated,current_score,run_id")
    .in("run_id", ids);
  const latest = new Map<string, { week: string; row: any }>();
  for (const row of (actions ?? []) as any[]) {
    const week = weekOf.get(row.run_id);
    if (!week) continue;
    const seen = latest.get(row.ticker);
    if (!seen || week > seen.week) latest.set(row.ticker, { week, row });
  }

  const open = [...latest.entries()].filter(([ticker, { row }]) =>
    !exclude.has(ticker) &&
    Boolean(row.entry_filled) &&
    !row.invalidated &&
    ["BUY", "HOLD", "REDUCE"].includes(String(row.action))
  );
  if (!open.length) return [];

  const { data: candidates } = await supabase
    .from("jarvis_weekly_candidates")
    .select("*")
    .in("run_id", ids)
    .in("ticker", open.map(([ticker]) => ticker));
  const origin = new Map<string, { week: string; row: any }>();
  for (const row of (candidates ?? []) as any[]) {
    const week = weekOf.get(row.run_id) ?? "";
    const seen = origin.get(row.ticker);
    if (!seen || week > seen.week) origin.set(row.ticker, { week, row });
  }

  return open
    .map(([ticker, { row }]) => {
      const plan = origin.get(ticker)?.row;
      if (!plan) return null;
      return {
        // Preserve the weight the position currently holds (a REDUCE halves it)
        // rather than resetting to the original full weight.
        plan: { ...plan, position_weight: Number(row.target_weight) || Number(plan.position_weight), score: row.current_score ?? plan.score } as PriorPosition,
        entryFilled: true,
        targetReached: Boolean(row.target_reached),
      };
    })
    .filter((item): item is OpenCarried => item !== null);
}

/**
 * Build the lifecycle action rows for a new run: every prior pick is reviewed
 * against the latest bars, every still-held off-list position is reviewed the
 * same way, and every genuinely new pick gets a BUY.
 */
export async function buildLifecycle(args: {
  runId: string;
  priorRun: { id: string; week_of: string } | null;
  prior: any[];
  current: any[];
  carried: OpenCarried[];
  getBars: (ticker: string, since: string) => Promise<PriceBar[]>;
}): Promise<WeeklyActionRow[]> {
  const { runId, priorRun, prior, current, carried, getBars } = args;
  const currentByTicker = new Map(current.map((item) => [item.ticker, item]));
  const actions: WeeklyActionRow[] = [];

  if (priorRun) {
    for (const old of prior) {
      const bars = await getBars(old.ticker, priorRun.week_of);
      const next = currentByTicker.get(old.ticker);
      const outcome = evaluatePosition(old, bars, next);
      actions.push(toRow(runId, priorRun.id, old.ticker, outcome, next ? Number(next.score) : null));
    }
    for (const item of carried) {
      const bars = await getBars(item.plan.ticker, priorRun.week_of);
      const outcome = evaluatePosition(item.plan, bars, undefined, { entryFilled: item.entryFilled, targetReached: item.targetReached });
      actions.push(toRow(runId, priorRun.id, item.plan.ticker, outcome, null));
    }
  }

  const handled = new Set([...prior.map((item) => item.ticker), ...carried.map((item) => item.plan.ticker)]);
  for (const item of current) {
    if (handled.has(item.ticker)) continue;
    actions.push({
      run_id: runId,
      prior_run_id: priorRun?.id ?? null,
      ticker: item.ticker,
      action: "BUY",
      previous_score: null,
      current_score: Number(item.score),
      target_weight: Number(item.position_weight) || 12.5,
      theoretical_fill: null,
      entry_filled: false,
      target_reached: false,
      invalidated: false,
      reason: isShortSetup(item)
        ? "Optional V5 short qualifier; confirm official BEI eligibility and borrow availability before using the entry range."
        : priorRun
          ? "New V5 qualifier; use the stated entry range."
          : "Initial V5 weekly pick; use the stated entry range and do not chase.",
    });
  }
  return actions;
}

function toRow(
  runId: string,
  priorRunId: string | null,
  ticker: string,
  outcome: LifecycleOutcome,
  currentScore: number | null,
): WeeklyActionRow {
  return {
    run_id: runId,
    prior_run_id: priorRunId,
    ticker,
    action: outcome.action,
    previous_score: outcome.previousScore,
    current_score: currentScore,
    target_weight: outcome.targetWeight,
    theoretical_fill: outcome.theoreticalFill,
    entry_filled: outcome.entryFilled,
    target_reached: outcome.targetReached,
    invalidated: outcome.invalidated,
    reason: outcome.reason,
  };
}
