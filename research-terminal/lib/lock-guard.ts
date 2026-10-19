// Lock-time guard: never stamp a week from a scan that did not see its session.
//
// The lock reads the setup scan and persists the week's regime. On 2026-10-16 the
// whole IDX board went limit-down (~-15% on every large cap, the auto-rejection
// floor), yet the week was stamped "RISK ON" with five long candidates: the scan
// was still serving pre-halt prices. Nothing caught it, and the label reached the
// digest, /api/v1 and the admin board.
//
// A fresh read of such a session cannot be RISK ON. A crash drives names to their
// 1-month lows, which the model classifies as `reversal`, and reversals are
// excluded from breadth -- so breadth collapses to nothing. A healthy long book on
// a stress session therefore means the scan did not describe that session, and its
// entry, stop and target levels cannot be trusted either.
//
// The guard is deliberately inert in normal markets: a genuine stress session
// already reads as a defensive regime from fresh prices, so it only bites when the
// scan contradicts the tape. Missing index data leaves it off entirely -- absent
// evidence never invents a reason to stand the week down.

import type { Regime } from "./setup-model.ts";

/** A one-session index fall this deep counts as a stress / halt session. */
export const STRESS_SESSION_PCT = -5;

/** Regimes that assert a healthy long book worth entering. */
const OFFENSIVE: ReadonlySet<Regime> = new Set<Regime>(["RISK ON", "EMERGING"]);

/**
 * True when the local index had a stress session on the week-of date but the scan
 * still reports an offensive breadth read, i.e. the scan is not describing the
 * session it is about to be locked against.
 */
export function scanMissedSession(regime: Regime, indexChangePct: number | null): boolean {
  if (indexChangePct === null || indexChangePct > STRESS_SESSION_PCT) return false;
  return OFFENSIVE.has(regime);
}

/** The regime token carried by a stored/digest label, or null when unreadable. */
export function regimeFromLabel(label: unknown): Regime | null {
  const match = String(label ?? "").match(/RISK OFF|RISK ON|EMERGING|NEUTRAL/);
  return (match?.[0] as Regime | undefined) ?? null;
}

/** How the week's regime is recorded once the guard has held it back. */
export function staleScanSuffix(indexChangePct: number | null): string {
  if (indexChangePct === null) return " · SCAN STALE";
  return ` · SCAN STALE (index ${indexChangePct.toFixed(1)}% session)`;
}

/** The macro / deployment part of a week's stamp. One definition, every lock path. */
export function formatMacroLabel(exposure: number, flags: string[]): string {
  if (exposure >= 1) return "";
  return ` · MACRO ${Math.round(exposure * 100)}%${flags.length ? ` (${flags.join(", ")})` : ""}`;
}

export type LockGuard = {
  /** True when the scan contradicts the session and the week must not deploy. */
  stale: boolean;
  /** The regime the week is recorded under. */
  regime: Regime;
  /** Size multiplier for the week's NEW picks. 0 when the guard holds it back. */
  exposure: number;
  /** Suffix appended to the stored stamp and the digest. */
  suffix: string;
  /** Replacement note for the run, or null to keep the caller's own wording. */
  note: string | null;
};

/**
 * Apply the guard to a week's regime and macro exposure. Both lock paths (the cron
 * and the Friday POST) and the republish tool go through here, so a week can never
 * be stamped RISK ON from a scan that did not see its session.
 */
export function guardLock(regime: Regime, exposure: number, indexChangePct: number | null): LockGuard {
  const stale = scanMissedSession(regime, indexChangePct);
  if (!stale) return { stale: false, regime, exposure, suffix: "", note: null };
  const move = indexChangePct === null ? "a stress session" : `an index session of ${indexChangePct.toFixed(1)}%`;
  return {
    stale: true,
    regime: "RISK OFF",
    exposure: 0,
    suffix: staleScanSuffix(indexChangePct),
    note: `Scan did not reflect the session (${move}), so the breadth reading was not usable and the week stood aside at 0% deployed. Qualified setups are recorded but are not entered.`,
  };
}
