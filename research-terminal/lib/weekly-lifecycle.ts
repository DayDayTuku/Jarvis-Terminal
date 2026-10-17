// Shared, deterministic lifecycle engine for the V5 Weekly Picks.
//
// Every path that decides a position's status MUST use these helpers:
//   - the Friday rollover in the cron job (app/api/cron/weekly-picks)
//   - the admin manual lock (app/api/weekly-shortlist)
//   - the intraday monitor in the cron job
// and the read paths that display status (/api/weekly-shortlist, /api/v1).
//
// Before this module the rollover and the monitor implemented the same idea with
// slightly different maths, so a single trade could be reported two different
// ways. Keep all of the level maths and the action priority in one place so a
// "cut" can never be relabelled as a "hit" again.

export type PriceBar = { date?: string; open: number; high: number; low: number; close: number };

export type LifecycleActionName =
  | "BUY"
  | "HOLD"
  | "REDUCE"
  | "EXIT"
  | "REPLACE"
  | "NO_ENTRY"
  | "EXPIRED";

/** A pick from the previous week, as stored in jarvis_weekly_candidates. */
export type PriorPosition = {
  ticker: string;
  setup: string;
  score: number;
  planned_entry_low: number;
  planned_entry_high: number;
  invalidation: number;
  hard_stop?: number | null;
  target_one?: number | null;
  position_weight?: number | null;
};

/** A pick in the current week, used to decide whether a prior pick carries on. */
export type NextPosition = {
  ticker: string;
  score: number;
  position_weight?: number | null;
};

export type LifecycleOutcome = {
  action: LifecycleActionName;
  targetWeight: number;
  reason: string;
  /** null only for a fresh re-entry, so the UI labels it NEW instead of ADD. */
  previousScore: number | null;
  theoreticalFill: number | null;
  entryFilled: boolean;
  /** First target was touched at some point after entry (a milestone, sticky). */
  targetReached: boolean;
  /** The active stop was breached after entry (a milestone, sticky, terminal). */
  invalidated: boolean;
};

export function isShortSetup(item: { setup?: string } | null | undefined): boolean {
  return String(item?.setup || "").toLowerCase().startsWith("short_");
}

/** IDX tick size for a given price. */
export function priceStep(value: number): number {
  return value < 200 ? 1 : value < 500 ? 2 : value < 2000 ? 5 : value < 5000 ? 10 : 25;
}

export function alignPrice(value: number, direction: "up" | "down" | "nearest" = "nearest"): number {
  const step = priceStep(value);
  const round = direction === "up" ? Math.ceil : direction === "down" ? Math.floor : Math.round;
  return round(value / step) * step;
}

/** One valid tick strictly below the nearest tick of `value`. */
export function previousPriceTick(value: number): number {
  const level = alignPrice(value, "nearest");
  return level - priceStep(Math.max(0, level - 0.001));
}

/** One valid tick strictly above the nearest tick of `value`. */
export function nextPriceTick(value: number): number {
  const level = alignPrice(value, "nearest");
  return level + priceStep(level + 0.001);
}

/**
 * The price that ends the trade: the tighter of the stated invalidation and the
 * mechanical hard stop, rounded away from the trade direction, then moved one
 * valid tick past it so a mere touch does not close the position.
 */
export function stopTrigger(item: PriorPosition): number {
  const short = isShortSetup(item);
  const hardStop = Number.isFinite(Number(item.hard_stop))
    ? Number(item.hard_stop)
    : short
      ? Infinity
      : -Infinity;
  const level = short
    ? Math.min(hardStop, alignPrice(Number(item.invalidation), "up"))
    : Math.max(hardStop, alignPrice(Number(item.invalidation), "up"));
  return short ? nextPriceTick(level) : previousPriceTick(level);
}

/** First target level, rounded toward the trade direction. */
export function targetTrigger(item: PriorPosition): number {
  return alignPrice(Number(item.target_one), isShortSetup(item) ? "up" : "down");
}

/** Where (and at what price) the planned entry range was first traded. */
export function entryTouch(bars: PriceBar[], item: PriorPosition): { index: number; fill: number | null } {
  const index = bars.findIndex(
    (bar) => bar.high >= Number(item.planned_entry_low) && bar.low <= Number(item.planned_entry_high),
  );
  if (index < 0) return { index: -1, fill: null };
  const open = bars[index].open;
  const fill = alignPrice(
    Math.min(Number(item.planned_entry_high), Math.max(Number(item.planned_entry_low), open)),
    "nearest",
  );
  return { index, fill };
}

/**
 * Decide what to do with a prior week's position given that week's bars and the
 * current week's selection. `invalidated` and `targetReached` are independent,
 * sticky milestones; the returned action gives a fixed priority to a stop-out so
 * a stopped trade is always reported as EXIT.
 */
export function evaluatePosition(
  prior: PriorPosition,
  bars: PriceBar[],
  next?: NextPosition,
  state: { entryFilled?: boolean; targetReached?: boolean } = {},
): LifecycleOutcome {
  const short = isShortSetup(prior);
  const { index, fill } = entryTouch(bars, prior);
  // A carried position was filled in an earlier week, so its entry is not in this
  // window: `state` carries the live flags forward instead of re-deriving them
  // from bars that start after the entry. (Re-deriving would read a genuinely
  // held position as AWAITING_ENTRY and then wrongly expire it.)
  const entryFilled = state.entryFilled ?? index >= 0;
  const active = entryFilled ? (index >= 0 ? bars.slice(index) : bars) : [];
  const stop = stopTrigger(prior);
  const target = targetTrigger(prior);
  const hasTarget = Number.isFinite(target);
  const invalidated = entryFilled && active.some((bar) => (short ? bar.high >= stop : bar.low <= stop));
  const targetReached = (state.targetReached ?? false) || (entryFilled && hasTarget && active.some((bar) => (short ? bar.low <= target : bar.high >= target)));
  const baseWeight = Number(prior.position_weight) || 12.5;
  const previousScore = Number(prior.score);

  if (!entryFilled && !next) {
    return {
      action: "EXPIRED", targetWeight: 0, previousScore, theoreticalFill: null,
      entryFilled, targetReached, invalidated,
      reason: "Entry was not filled and the stock left this week's picks.",
    };
  }
  if (invalidated && next) {
    // The old position was closed. A fresh weekly selection is a new entry, not
    // a continuation, so it must read as NEW rather than as a lingering EXIT.
    return {
      action: "BUY", targetWeight: Number(next.position_weight) || 12.5, previousScore: null,
      theoreticalFill: fill, entryFilled, targetReached, invalidated,
      reason: "The prior position was stopped out; this is a fresh entry from the new weekly selection.",
    };
  }
  if (invalidated) {
    return {
      action: "EXIT", targetWeight: 0, previousScore, theoreticalFill: fill,
      entryFilled, targetReached, invalidated,
      reason: "Price traded through the active stop level.",
    };
  }
  if (targetReached && next) {
    return {
      action: "REDUCE", targetWeight: baseWeight / 2, previousScore, theoreticalFill: fill,
      entryFilled, targetReached, invalidated,
      reason: "First target was reached; take profit and trail the remainder.",
    };
  }
  if (targetReached) {
    return {
      action: "EXIT", targetWeight: 0, previousScore, theoreticalFill: fill,
      entryFilled, targetReached, invalidated,
      reason: "First target was reached and the stock left this week's picks.",
    };
  }
  if (!next) {
    // The stock fell out of the weekly list, but the trade plan (stop and first
    // target) is still live, so hold it until one of them is actually reached
    // rather than closing on the rollover. The backtest shows holding roughly
    // doubles the per-trade edge and is the difference between a negative and a
    // positive result once costs are charged.
    return {
      action: "HOLD", targetWeight: baseWeight, previousScore, theoreticalFill: fill,
      entryFilled, targetReached, invalidated,
      reason: "Off this week's list, but the stop and first target are still active; holding.",
    };
  }
  if (Number(next.score) < previousScore - 5) {
    return {
      action: "REDUCE", targetWeight: baseWeight / 2, previousScore, theoreticalFill: fill,
      entryFilled, targetReached, invalidated,
      reason: "Score deteriorated by more than five points.",
    };
  }
  if (!entryFilled) {
    return {
      action: "NO_ENTRY", targetWeight: 0, previousScore, theoreticalFill: null,
      entryFilled, targetReached, invalidated,
      reason: "Entry range was not traded; do not chase.",
    };
  }
  return {
    action: "HOLD", targetWeight: baseWeight, previousScore, theoreticalFill: fill,
    entryFilled, targetReached, invalidated,
    reason: "Setup remains selected and its score is stable.",
  };
}

/**
 * Intraday trigger state for the monitor. Uses the same cumulative window as
 * evaluatePosition so the monitor and the Friday rollover always agree.
 */
export function positionTriggers(item: PriorPosition, bars: PriceBar[], state: { entered?: boolean; targetReached?: boolean } = {}) {
  const short = isShortSetup(item);
  const { index } = entryTouch(bars, item);
  // Same carried-position rule as evaluatePosition: when a position was filled
  // in an earlier week, treat the whole window as active rather than looking for
  // an entry that is no longer in it.
  const entered = state.entered ?? index >= 0;
  const active = entered ? (index >= 0 ? bars.slice(index) : bars) : [];
  const stop = stopTrigger(item);
  const target = targetTrigger(item);
  const hasTarget = Number.isFinite(target);
  return {
    entered,
    stopTrigger: stop,
    targetTrigger: target,
    sessionLow: active.length ? Math.min(...active.map((bar) => bar.low)) : null,
    sessionHigh: active.length ? Math.max(...active.map((bar) => bar.high)) : null,
    stopped: entered && active.some((bar) => (short ? bar.high >= stop : bar.low <= stop)),
    targetHit: entered && !state.targetReached && hasTarget && active.some((bar) => (short ? bar.low <= target : bar.high >= target)),
  };
}

/** Canonical, user-facing status for a position, derived from one source of truth. */
export type PositionStatus =
  | "AWAITING_ENTRY"
  | "OPEN"
  | "TARGET_HIT"
  | "STOPPED"
  | "CLOSED"
  | "NO_ENTRY"
  | "EXPIRED";

export function deriveStatus(outcome: {
  action: LifecycleActionName;
  entryFilled: boolean;
  targetReached: boolean;
  invalidated: boolean;
}): PositionStatus {
  if (outcome.invalidated) return "STOPPED";
  if (outcome.targetReached) return "TARGET_HIT";
  if (outcome.action === "NO_ENTRY") return "NO_ENTRY";
  if (outcome.action === "EXPIRED") return "EXPIRED";
  if (outcome.action === "EXIT" || outcome.action === "REPLACE") return "CLOSED";
  if (!outcome.entryFilled) return "AWAITING_ENTRY";
  return "OPEN";
}

/**
 * A single realized (or still-open) trade for the track record.
 *
 * The plan is taken from the week a name was first selected; the trade runs
 * until the stop, the first target, or the week the name leaves the picks.
 * That keeps the record auditable: entry, exit, return and R-multiple all come
 * from the same deterministic maths used everywhere else.
 */
export type TradeOutcome = {
  ticker: string;
  direction: "LONG" | "SHORT";
  status: "NO_ENTRY" | "OPEN" | "CLOSED";
  entered: boolean;
  entryDate: string | null;
  entryPrice: number | null;
  stop: number;
  target: number | null;
  exitDate: string | null;
  exitPrice: number | null;
  exitReason: "STOP" | "TARGET" | "TIME" | "WEEK_END" | "NO_ENTRY";
  returnPct: number | null;
  rMultiple: number | null;
};

/**
 * Resolve the realized outcome of one position given its plan and the daily bars
 * spanning its holding window. Pure and deterministic: given the same bars it
 * always returns the same trade, so a recorded result never silently changes.
 *
 * `maxHoldingDays` caps the open-ended "hold to stop/target" policy: a position
 * that hits neither is marked out at the cap so it cannot sit open forever.
 */
export function tradeOutcome(item: PriorPosition, bars: PriceBar[], options: { maxHoldingDays?: number | null } = {}): TradeOutcome {
  const maxHoldingDays = options.maxHoldingDays ?? null;
  const short = isShortSetup(item);
  const stop = stopTrigger(item);
  const target = targetTrigger(item);
  const hasTarget = Number.isFinite(target);
  const base = {
    ticker: item.ticker,
    direction: (short ? "SHORT" : "LONG") as "LONG" | "SHORT",
    stop,
    target: hasTarget ? target : null,
  };
  const { index, fill } = entryTouch(bars, item);
  if (index < 0 || fill === null) {
    return { ...base, status: "NO_ENTRY", entered: false, entryDate: null, entryPrice: null, exitDate: null, exitPrice: null, exitReason: "NO_ENTRY", returnPct: null, rMultiple: null };
  }
  const entry = fill;
  const entryDate = bars[index].date ?? null;
  const settle = (exitDate: string | null, exitPrice: number, exitReason: TradeOutcome["exitReason"], status: TradeOutcome["status"]): TradeOutcome => {
    const returnPct = short ? ((entry - exitPrice) / entry) * 100 : ((exitPrice - entry) / entry) * 100;
    const risk = short ? stop - entry : entry - stop;
    const reward = short ? entry - exitPrice : exitPrice - entry;
    return {
      ...base, status, entered: true, entryDate, entryPrice: entry,
      exitDate, exitPrice, exitReason, returnPct,
      rMultiple: Number.isFinite(risk) && risk > 0 ? reward / risk : null,
    };
  };
  for (let i = index; i < bars.length; i++) {
    const bar = bars[i];
    const stopHit = short ? bar.high >= stop : bar.low <= stop;
    // A bar that touches both is booked as a stop so the record never flatters itself.
    if (stopHit) return settle(bar.date ?? null, stop, "STOP", "CLOSED");
    if (hasTarget && (short ? bar.low <= target : bar.high >= target)) {
      return settle(bar.date ?? null, target, "TARGET", "CLOSED");
    }
    if (maxHoldingDays !== null && i - index >= maxHoldingDays) {
      return settle(bar.date ?? null, bar.close, "TIME", "CLOSED");
    }
  }
  const last = bars[bars.length - 1];
  return settle(last?.date ?? null, last?.close ?? entry, "WEEK_END", "OPEN");
}

/**
 * Collapse the weeks a ticker was selected into contiguous holding streaks.
 *
 * A name that is picked, then picked again the next week, is one continuous
 * position; a week where it is absent closes the trade. `closeIndex` is the run
 * that ended the streak (exclusive), or null when the name is still selected in
 * the latest run, i.e. the trade is still open.
 */
export function collapseStreaks(appearances: number[], runCount: number): Array<{ openIndex: number; closeIndex: number | null }> {
  const sorted = [...appearances].sort((a, b) => a - b);
  const streaks: Array<{ openIndex: number; closeIndex: number | null }> = [];
  if (!sorted.length) return streaks;
  let openIndex = sorted[0];
  let last = sorted[0];
  for (let i = 1; i <= sorted.length; i++) {
    const current = sorted[i];
    if (current !== undefined && current === last + 1) { last = current; continue; }
    streaks.push({ openIndex, closeIndex: last + 1 < runCount ? last + 1 : null });
    if (current !== undefined) { openIndex = current; last = current; }
  }
  return streaks;
}

