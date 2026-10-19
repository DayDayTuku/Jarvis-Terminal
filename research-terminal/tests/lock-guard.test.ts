import test from "node:test";
import assert from "node:assert/strict";
import { macroExposure, type MacroBar } from "../lib/macro-risk.ts";
import {
  STRESS_SESSION_PCT,
  formatMacroLabel,
  guardLock,
  regimeFromLabel,
  scanMissedSession,
} from "../lib/lock-guard.ts";

const day = (index: number) => new Date(Date.UTC(2025, 0, 1) + index * 86_400_000).toISOString().slice(0, 10);
const bars = (values: number[]): MacroBar[] => values.map((close, index) => ({ date: day(index), close }));

test("scanMissedSession: a halt-day move cannot carry an offensive breadth read", () => {
  assert.equal(scanMissedSession("RISK ON", -11.6), true);
  assert.equal(scanMissedSession("EMERGING", -6), true);
  // The threshold itself trips; anything milder does not.
  assert.equal(scanMissedSession("RISK ON", STRESS_SESSION_PCT), true);
  assert.equal(scanMissedSession("RISK ON", STRESS_SESSION_PCT + 0.01), false);
  // A defensive read on a stress session is the coherent case, not a conflict.
  assert.equal(scanMissedSession("RISK OFF", -11.6), false);
  assert.equal(scanMissedSession("NEUTRAL", -11.6), false);
  // Ordinary down days are not stress sessions.
  assert.equal(scanMissedSession("RISK ON", -1.2), false);
  assert.equal(scanMissedSession("RISK ON", 0.4), false);
});

test("scanMissedSession: missing index data never invents a stand-down", () => {
  assert.equal(scanMissedSession("RISK ON", null), false);
});

test("regimeFromLabel: reads the token back out of a stored or client stamp", () => {
  assert.equal(regimeFromLabel("V5 RISK OFF · MACRO 0% (IDR weak, VIX up, JKSE down, oil up)"), "RISK OFF");
  assert.equal(regimeFromLabel("V5 RISK ON · OPTIONAL SHORT"), "RISK ON");
  assert.equal(regimeFromLabel("V5 EMERGING · MACRO 60%"), "EMERGING");
  assert.equal(regimeFromLabel("V5 NEUTRAL"), "NEUTRAL");
  assert.equal(regimeFromLabel("UNKNOWN"), null);
  assert.equal(regimeFromLabel(null), null);
});

test("guardLock: a scan that matches its session changes nothing", () => {
  const lock = guardLock("RISK ON", 0.45, 0.4);
  assert.equal(lock.stale, false);
  assert.equal(lock.regime, "RISK ON");
  assert.equal(lock.exposure, 0.45);
  assert.equal(lock.suffix, "");
  assert.equal(lock.note, null);
  // A stress session the model already read as defensive is left alone.
  assert.equal(guardLock("RISK OFF", 0, -11.6).stale, false);
  assert.equal(guardLock("RISK OFF", 0, -11.6).regime, "RISK OFF");
});

test("guardLock: a stale scan holds the week at 0% and relabels it", () => {
  const lock = guardLock("RISK ON", 0.45, -11.6);
  assert.equal(lock.stale, true);
  assert.equal(lock.regime, "RISK OFF");
  assert.equal(lock.exposure, 0);
  assert.match(lock.suffix, /SCAN STALE/);
  assert.match(lock.suffix, /-11\.6%/);
  assert.match(String(lock.note), /0% deployed/);
  // Missing index data keeps the guard off, so nothing is held back.
  assert.equal(guardLock("RISK ON", 0.45, null).stale, false);
  assert.equal(guardLock("RISK ON", 0.45, null).exposure, 0.45);
  assert.equal(guardLock("RISK ON", 0.45, null).suffix, "");
});

test("formatMacroLabel: one definition, used by both lock paths", () => {
  assert.equal(formatMacroLabel(1, []), "");
  assert.equal(formatMacroLabel(0, ["IDR weak"]), " · MACRO 0% (IDR weak)");
  assert.equal(formatMacroLabel(0.45, []), " · MACRO 45%");
  assert.equal(formatMacroLabel(0.45, ["IDR weak", "VIX up"]), " · MACRO 45% (IDR weak, VIX up)");
});

test("regression: the 2026-10-16 lock cannot be stamped RISK ON", () => {
  // The tape fell 11.6% on the week-of session while the scan still reported five
  // longs; the week was stored as "V5 RISK ON · MACRO 0%". The guard must hold it.
  const series = new Map<string, MacroBar[]>([["^JKSE", bars([6000, 5864, 5185])]]);
  const macro = macroExposure(series, day(2));
  assert.equal(Math.round((macro.indexChangePct ?? 0) * 10) / 10, -11.6);
  const lock = guardLock("RISK ON", macro.exposure, macro.indexChangePct);
  assert.equal(lock.stale, true);
  assert.equal(lock.exposure, 0);
  assert.equal(
    `V5 ${lock.regime}${formatMacroLabel(lock.exposure, macro.flags)}${lock.suffix}`,
    "V5 RISK OFF · MACRO 0% · SCAN STALE (index -11.6% session)",
  );
});
