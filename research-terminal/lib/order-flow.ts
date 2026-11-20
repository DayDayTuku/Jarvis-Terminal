/**
 * Order-flow read for IDX cash equities, built from daily OHLCV.
 *
 * Why this file exists: the session notes describe order flow the way a futures
 * trader reads it — maker/taker aggression, delta, cumulative delta, open
 * interest, footprint, and auction location (POC / VAH / VAL). Most of that
 * cannot be observed here. The Indonesian exchange is a cash-equity market with
 * no consolidated tape of aggressor flags, and **there is no open interest for a
 * stock** — OI counts outstanding contracts, not shares. So the OI-CVD heuristic
 * in the notes is deliberately NOT implemented: faking an OI series from volume
 * would be a fabricated input, not a proxy.
 *
 * What is implemented is the part the daily data can actually support:
 *
 * - **Auction location** from a rolling volume profile (POC, VAH, VAL). The
 *   profile is an approximation: a daily bar does not say where inside its range
 *   the volume traded, so each session's volume is spread evenly across the bins
 *   its high-low range covers. It is a location estimate, not a TPO chart.
 * - **Delta proxy** = volume × close location value, `(2c − h − l) / (h − l)`.
 *   This is the standard daily-bar stand-in for ask-side minus bid-side volume.
 *   It is bounded to [-1, 1] per session and says nothing about who was on the
 *   other side.
 * - **CVD proxy** = cumulative delta over a window, expressed as a percentage of
 *   the window's volume so it is comparable across names.
 * - **Absorption**: positive flow with weak price progress (supply absorbing
 *   demand) or negative flow with resilient price (demand absorbing supply).
 * - **Anchored VWAP and its dispersion bands** over the same window.
 * - **Unfilled 3-bar gaps**: the nearest imbalance above and below price.
 *
 * House rule: every field is nullable and stays null when the bars cannot
 * support it. A read of "unknown" never becomes a veto, and a missing feed can
 * never be mistaken for a bearish signal.
 *
 * The read is evidence, not a prediction. `assessOrderFlow` therefore returns a
 * veto with its reasons, and the backtest decides whether that veto earns its
 * place — see `OrderFlowPolicy`.
 */

export type FlowBar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type ValueArea = {
  /** Price at the middle of the highest-volume bin. */
  poc: number;
  /** Upper edge of the 70% value area. */
  vah: number;
  /** Lower edge of the 70% value area. */
  val: number;
  binWidth: number;
  sessions: number;
  from: string;
  to: string;
};

export type FlowLocation = "ABOVE_VALUE" | "AT_VALUE_HIGH" | "INSIDE_VALUE" | "AT_VALUE_LOW" | "BELOW_VALUE" | "UNKNOWN";

export type Absorption = "NONE" | "SUPPLY" | "DEMAND" | "UNKNOWN";

export type OrderFlowRead = {
  asOf: string | null;
  sessions: number;
  profile: ValueArea | null;
  location: FlowLocation;
  /** Close versus POC, in percent. */
  pocDistancePct: number | null;
  /** Volume-weighted mean price over the window. */
  vwap: number | null;
  /** Close minus VWAP in units of the volume-weighted standard deviation. */
  vwapSigma: number | null;
  /** Net delta over the window as a percent of traded volume, in [-100, 100]. */
  cvdPct: number | null;
  /** Price change over the same window, in percent. */
  progressPct: number | null;
  absorption: Absorption;
  /** Nearest unfilled gap below the close, in percent (support). */
  gapBelowPct: number | null;
  /** Nearest unfilled gap above the close, in percent (resistance). */
  gapAbovePct: number | null;
  /** Plain-language evidence lines, suitable for a pick rationale. */
  reasons: string[];
  /** True when the read refuses a LONG under the policy that produced it. */
  blockLong: boolean;
  /** Why it refuses. Empty when `blockLong` is false. */
  blockReasons: string[];
};

export type OrderFlowPolicy = {
  /** Refuse a long while price is below the value area (auction rejected). */
  requireAboveValue: boolean;
  /** Refuse a long when buying is being absorbed by supply. */
  vetoSupplyAbsorption: boolean;
  /** Refuse a long when price is this many VWAP standard deviations above VWAP. */
  maxExtensionSigma: number | null;
  /** Refuse a long when cumulative delta is below this percentage of volume. */
  minCvdPct: number | null;
};

/** Everything off: the read is computed and shown but changes no decision. */
export const ORDER_FLOW_OFF: OrderFlowPolicy = {
  requireAboveValue: false,
  vetoSupplyAbsorption: false,
  maxExtensionSigma: null,
  minCvdPct: null,
};

/**
 * The shipped policy is selected by the backtest, not asserted. See
 * `--order-flow` variants in `scripts/backtest.ts`: a rule is only enabled here
 * after it improves the paired comparison in BOTH the 2-year and out-of-sample
 * slices.
 *
 * Measured (60 names, 2y, 2,000 paired bootstrap draws):
 *   - "not extended 2.5σ" 2y: 128 trades, +1.36% avg, PF 1.73 (base 131/+1.28%/1.67);
 *     OOS: 38 trades, +2.54% avg, PF 2.86 (base 37/+2.32%/2.67). Paired median
 *     advantage +0.3% (2y) and +0.5% (OOS), consistent in sign but not decisive.
 *   - "above value", "no absorption" and "cvd >= 0" did NOT hold in both slices,
 *     so they stay off. CVD is the clearest example: it helps 2y but loses OOS.
 *
 * A reader should treat 2.5σ as a modest, evidence-backed cap — not a proven
 * edge. It is a veto, so a missing VWAP band can never trigger it.
 */
export const DEFAULT_ORDER_FLOW_POLICY: OrderFlowPolicy = {
  ...ORDER_FLOW_OFF,
  maxExtensionSigma: 2.5,
};

const VALUE_AREA_SHARE = 0.7;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function usable(bar: FlowBar): boolean {
  return finite(bar.high) && finite(bar.low) && finite(bar.close) && finite(bar.volume) && bar.volume > 0 && bar.high >= bar.low;
}

/**
 * Rolling volume profile. Volume is spread evenly across the price bins a bar
 * spans; that is the only intrabar assumption, and it is stated rather than
 * implied.
 */
export function volumeProfile(bars: FlowBar[], options: { lookback?: number; bins?: number } = {}): ValueArea | null {
  const lookback = options.lookback ?? 60;
  const bins = Math.max(8, Math.min(60, options.bins ?? 24));
  const window = bars.slice(-lookback).filter(usable);
  if (window.length < Math.min(20, lookback)) return null;

  const low = Math.min(...window.map((bar) => bar.low));
  const high = Math.max(...window.map((bar) => bar.high));
  if (!(high > low)) return null;

  const binWidth = (high - low) / bins;
  const volume = new Array<number>(bins).fill(0);
  for (const bar of window) {
    const first = Math.max(0, Math.min(bins - 1, Math.floor((bar.low - low) / binWidth)));
    const last = Math.max(0, Math.min(bins - 1, Math.floor((bar.high - low) / binWidth)));
    const share = bar.volume / (last - first + 1);
    for (let index = first; index <= last; index += 1) volume[index] += share;
  }

  const total = volume.reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) return null;

  let pocIndex = 0;
  for (let index = 1; index < bins; index += 1) if (volume[index] > volume[pocIndex]) pocIndex = index;

  let lower = pocIndex;
  let upper = pocIndex;
  let inside = volume[pocIndex];
  const target = total * VALUE_AREA_SHARE;
  while (inside < target && (lower > 0 || upper < bins - 1)) {
    const below = lower > 0 ? volume[lower - 1] : -1;
    const above = upper < bins - 1 ? volume[upper + 1] : -1;
    if (above >= below) {
      upper += 1;
      inside += volume[upper];
    } else {
      lower -= 1;
      inside += volume[lower];
    }
  }

  return {
    poc: low + (pocIndex + 0.5) * binWidth,
    val: low + lower * binWidth,
    vah: low + (upper + 1) * binWidth,
    binWidth,
    sessions: window.length,
    from: window[0].date,
    to: window[window.length - 1].date,
  };
}

/** Close location value in [-1, 1]: where the close sits inside the bar's range. */
export function closeLocationValue(bar: FlowBar): number | null {
  if (!finite(bar.high) || !finite(bar.low) || !finite(bar.close)) return null;
  const range = bar.high - bar.low;
  if (!(range > 0)) return null;
  return Math.max(-1, Math.min(1, (2 * bar.close - bar.high - bar.low) / range));
}

/** Anchored VWAP and its volume-weighted dispersion over the window. */
export function anchoredVwap(bars: FlowBar[], lookback = 60): { vwap: number; sigma: number; sessions: number } | null {
  const window = bars.slice(-lookback).filter(usable);
  if (window.length < 10) return null;
  let volume = 0;
  let weighted = 0;
  for (const bar of window) {
    const typical = (bar.high + bar.low + bar.close) / 3;
    volume += bar.volume;
    weighted += typical * bar.volume;
  }
  if (!(volume > 0)) return null;
  const vwap = weighted / volume;
  let variance = 0;
  for (const bar of window) {
    const typical = (bar.high + bar.low + bar.close) / 3;
    variance += bar.volume * (typical - vwap) ** 2;
  }
  return { vwap, sigma: Math.sqrt(variance / volume), sessions: window.length };
}

/**
 * Cumulative delta as a percent of traded volume. Positive means closes tended
 * to finish near the high of their range on heavier volume; it does NOT mean
 * "foreigners bought" or "retail bought".
 */
export function cumulativeDeltaPct(bars: FlowBar[], window = 10): number | null {
  const slice = bars.slice(-window).filter(usable);
  if (slice.length < Math.min(5, window)) return null;
  let delta = 0;
  let volume = 0;
  for (const bar of slice) {
    const clv = closeLocationValue(bar);
    if (clv === null) continue;
    delta += clv * bar.volume;
    volume += bar.volume;
  }
  if (!(volume > 0)) return null;
  return (delta / volume) * 100;
}

/** Price change over the same window the delta covers. */
export function progressPct(bars: FlowBar[], window = 10): number | null {
  if (bars.length < window + 1) return null;
  const start = bars[bars.length - window - 1].close;
  const end = bars[bars.length - 1].close;
  if (!finite(start) || start <= 0 || !finite(end)) return null;
  return (end / start - 1) * 100;
}

export type GapScan = {
  /** Nearest unfilled gap below the last close, in percent. */
  belowPct: number | null;
  /** Nearest unfilled gap above the last close, in percent. */
  abovePct: number | null;
  belowCount: number;
  aboveCount: number;
};

/**
 * Unfilled 3-bar imbalances: a bullish gap is `low[i] > high[i-2]`, a bearish
 * gap is `high[i] < low[i-2]`. A gap counts as filled once price later trades
 * back through its origin edge. Gaps are targets and risk levels, not promises.
 */
export function unfilledGaps(bars: FlowBar[], lookback = 60): GapScan {
  const window = bars.slice(-lookback).filter((bar) => finite(bar.high) && finite(bar.low) && finite(bar.close));
  const close = window.at(-1)?.close ?? null;
  if (close === null || window.length < 4) return { belowPct: null, abovePct: null, belowCount: 0, aboveCount: 0 };

  let belowPct: number | null = null;
  let abovePct: number | null = null;
  let belowCount = 0;
  let aboveCount = 0;

  for (let index = 2; index < window.length - 1; index += 1) {
    const bar = window[index];
    const prior = window[index - 2];
    const later = window.slice(index + 1);

    if (bar.low > prior.high) {
      // Bullish gap; the origin edge is `prior.high`.
      const filled = later.some((next) => next.low <= prior.high);
      if (!filled && prior.high < close) {
        belowCount += 1;
        const distance = ((close - prior.high) / close) * 100;
        if (belowPct === null || distance < belowPct) belowPct = distance;
      }
    } else if (bar.high < prior.low) {
      // Bearish gap; the origin edge is `prior.low`.
      const filled = later.some((next) => next.high >= prior.low);
      if (!filled && prior.low > close) {
        aboveCount += 1;
        const distance = ((prior.low - close) / close) * 100;
        if (abovePct === null || distance < abovePct) abovePct = distance;
      }
    }
  }

  return { belowPct, abovePct, belowCount, aboveCount };
}

function locationOf(close: number, profile: ValueArea | null): FlowLocation {
  if (!profile) return "UNKNOWN";
  const tolerance = 0.005;
  if (close > profile.vah * (1 + tolerance)) return "ABOVE_VALUE";
  if (close >= profile.vah * (1 - tolerance)) return "AT_VALUE_HIGH";
  if (close < profile.val * (1 - tolerance)) return "BELOW_VALUE";
  if (close <= profile.val * (1 + tolerance)) return "AT_VALUE_LOW";
  return "INSIDE_VALUE";
}

export type OrderFlowOptions = {
  /** Sessions for the volume profile and anchored VWAP. */
  lookback?: number;
  /** Sessions for the delta/CVD read. */
  deltaWindow?: number;
  /** Bins in the volume profile. */
  bins?: number;
};

/**
 * One read per ticker as of the last bar. Everything is derived from the bars
 * handed in; nothing is fetched, so a caller that has no history gets an
 * `UNKNOWN` read rather than a fabricated one.
 */
export function readOrderFlow(
  bars: FlowBar[],
  options: OrderFlowOptions & { policy?: OrderFlowPolicy } = {},
): OrderFlowRead {
  const lookback = options.lookback ?? 60;
  const deltaWindow = options.deltaWindow ?? 10;
  const policy = options.policy ?? ORDER_FLOW_OFF;
  const clean = bars.filter((bar) => finite(bar.close));
  const last = clean.at(-1) ?? null;

  if (!last || clean.length < 20) {
    return {
      asOf: last?.date ?? null,
      sessions: clean.length,
      profile: null,
      location: "UNKNOWN",
      pocDistancePct: null,
      vwap: null,
      vwapSigma: null,
      cvdPct: null,
      progressPct: null,
      absorption: "UNKNOWN",
      gapBelowPct: null,
      gapAbovePct: null,
      reasons: [],
      blockLong: false,
      blockReasons: [],
    };
  }

  const profile = volumeProfile(clean, { lookback, bins: options.bins });
  const vwapRead = anchoredVwap(clean, lookback);
  const cvdPct = cumulativeDeltaPct(clean, deltaWindow);
  const progress = progressPct(clean, deltaWindow);
  const location = locationOf(last.close, profile);
  const gaps = unfilledGaps(clean, lookback);
  const pocDistancePct = profile ? ((last.close - profile.poc) / profile.poc) * 100 : null;
  const vwapSigma = vwapRead && vwapRead.sigma > 0 ? (last.close - vwapRead.vwap) / vwapRead.sigma : null;

  // Absorption: flow and price disagree. The notes' wording is "positive CVD
  // with weak price progress may suggest absorption"; the thresholds below make
  // "positive" and "weak" explicit instead of leaving them to taste.
  let absorption: Absorption = "UNKNOWN";
  if (cvdPct !== null && progress !== null) {
    if (cvdPct >= 3 && progress <= 1) absorption = "SUPPLY";
    else if (cvdPct <= -3 && progress >= -1) absorption = "DEMAND";
    else absorption = "NONE";
  }

  const reasons: string[] = [];
  if (profile) {
    const where: Record<FlowLocation, string> = {
      ABOVE_VALUE: "above the value area",
      AT_VALUE_HIGH: "at the value-area high",
      INSIDE_VALUE: "inside the value area",
      AT_VALUE_LOW: "at the value-area low",
      BELOW_VALUE: "below the value area",
      UNKNOWN: "unlocated",
    };
    reasons.push(
      `Auction location: price is ${where[location]} (VAL ${Math.round(profile.val).toLocaleString("en-US")} · POC ${Math.round(profile.poc).toLocaleString("en-US")} · VAH ${Math.round(profile.vah).toLocaleString("en-US")}) over ${profile.sessions} sessions.`,
    );
  }
  if (cvdPct !== null && progress !== null) {
    reasons.push(
      `Flow proxy: cumulative delta ${cvdPct >= 0 ? "+" : ""}${cvdPct.toFixed(1)}% of volume over ${deltaWindow} sessions while price moved ${progress >= 0 ? "+" : ""}${progress.toFixed(1)}%.`,
    );
  }
  if (absorption === "SUPPLY") reasons.push("Buying is being absorbed: flow is positive but price is not making progress.");
  if (absorption === "DEMAND") reasons.push("Selling is being absorbed: flow is negative but price is holding.");
  if (vwapRead && vwapSigma !== null) {
    reasons.push(`Anchored VWAP ${Math.round(vwapRead.vwap).toLocaleString("en-US")} · close ${vwapSigma >= 0 ? "+" : ""}${vwapSigma.toFixed(1)}σ.`);
  }
  if (gaps.belowPct !== null) reasons.push(`Nearest unfilled gap below: ${gaps.belowPct.toFixed(1)}% (support).`);
  if (gaps.abovePct !== null) reasons.push(`Nearest unfilled gap above: ${gaps.abovePct.toFixed(1)}% (resistance).`);

  const blockReasons: string[] = [];

  const base: OrderFlowRead = {
    asOf: last.date,
    sessions: clean.length,
    profile,
    location,
    pocDistancePct,
    vwap: vwapRead?.vwap ?? null,
    vwapSigma,
    cvdPct,
    progressPct: progress,
    absorption,
    gapBelowPct: gaps.belowPct,
    gapAbovePct: gaps.abovePct,
    reasons,
    blockLong: false,
    blockReasons,
  };

  return { ...base, ...assessOrderFlow(base, policy) };
}

/** Re-apply a different policy to an existing read without recomputing it. */export function assessOrderFlow(read: OrderFlowRead, policy: OrderFlowPolicy): { blockLong: boolean; blockReasons: string[] } {
  const blockReasons: string[] = [];
  if (policy.requireAboveValue && (read.location === "BELOW_VALUE" || read.location === "AT_VALUE_LOW")) {
    blockReasons.push("price has not been accepted above the value area");
  }
  if (policy.vetoSupplyAbsorption && read.absorption === "SUPPLY") {
    blockReasons.push("positive flow is being absorbed by supply");
  }
  if (policy.maxExtensionSigma !== null && read.vwapSigma !== null && read.vwapSigma > policy.maxExtensionSigma) {
    blockReasons.push(`price is ${read.vwapSigma.toFixed(1)}σ above anchored VWAP (limit ${policy.maxExtensionSigma}σ)`);
  }
  if (policy.minCvdPct !== null && read.cvdPct !== null && read.cvdPct < policy.minCvdPct) {
    blockReasons.push(`cumulative delta ${read.cvdPct.toFixed(1)}% is below the ${policy.minCvdPct}% floor`);
  }
  return { blockLong: blockReasons.length > 0, blockReasons };
}

const LOCATION_WORD: Record<FlowLocation, string> = {
  ABOVE_VALUE: "above value",
  AT_VALUE_HIGH: "at value-area high",
  INSIDE_VALUE: "inside value",
  AT_VALUE_LOW: "at value-area low",
  BELOW_VALUE: "below value",
  UNKNOWN: "location unknown",
};

/**
 * One compact line for a pick rationale. Explicitly names the proxy, because a
 * reader must not mistake it for exchange-reported aggressor data.
 */
export function summarizeOrderFlow(read: OrderFlowRead): string | null {
  if (read.location === "UNKNOWN" && read.cvdPct === null) return null;
  const parts = [`Auction ${LOCATION_WORD[read.location]}`];
  if (read.profile) parts.push(`VAH ${Math.round(read.profile.vah).toLocaleString("en-US")}/VAL ${Math.round(read.profile.val).toLocaleString("en-US")}`);
  if (read.cvdPct !== null) parts.push(`delta proxy ${read.cvdPct >= 0 ? "+" : ""}${read.cvdPct.toFixed(1)}%`);
  if (read.vwapSigma !== null) parts.push(`${read.vwapSigma >= 0 ? "+" : ""}${read.vwapSigma.toFixed(1)}σ vs VWAP`);
  if (read.absorption === "SUPPLY") parts.push("buying absorbed");
  if (read.absorption === "DEMAND") parts.push("selling absorbed");
  if (read.gapBelowPct !== null) parts.push(`gap support ${read.gapBelowPct.toFixed(1)}% below`);
  return `Order flow (daily bars): ${parts.join(" · ")}.`;
}
