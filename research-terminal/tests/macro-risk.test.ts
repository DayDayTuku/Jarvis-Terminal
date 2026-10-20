import test from "node:test";
import assert from "node:assert/strict";
import { BASE_EXPOSURE, EXPOSURE_STEPS, indexSessionMove, macroExposure, macroFlags, type MacroBar } from "../lib/macro-risk.ts";

const day = (index: number) => new Date(Date.UTC(2025, 0, 1) + index * 86_400_000).toISOString().slice(0, 10);
const bars = (values: number[]): MacroBar[] => values.map((close, index) => ({ date: day(index), close }));
const at = (values: Array<number | MacroBar>) => day(values.length - 1);
const rising = (n: number, start = 100) => bars(Array.from({ length: n }, (_, i) => start + i));
const falling = (n: number, start = 100) => bars(Array.from({ length: n }, (_, i) => start - i));

test("macroExposure: every read lit stands the week down", () => {
  const series = new Map<string, MacroBar[]>([
    ["IDR=X", rising(60, 15000)], // above its 50-day average -> rupiah weak
    ["^VIX", rising(10, 15)],     // up over 5 sessions
    ["^JKSE", falling(30, 6000)], // down over 20 sessions
    ["CL=F", rising(30, 70)],     // up over 20 sessions
  ]);
  const read = macroExposure(series, at(rising(60, 15000)));
  assert.deepEqual(read.flags, ["IDR weak", "VIX up", "JKSE down", "oil up"]);
  assert.equal(read.exposure, 0);
});

test("macroExposure: a calm backdrop keeps the base size, never full", () => {
  const series = new Map<string, MacroBar[]>([
    ["IDR=X", falling(60, 16000)], // below its average -> rupiah strong
    ["^VIX", falling(10, 25)],     // easing
    ["^JKSE", rising(30, 6000)],   // trending up
    ["CL=F", falling(30, 80)],     // easing
  ]);
  const read = macroExposure(series, at(falling(60, 16000)));
  assert.deepEqual(read.flags, []);
  assert.equal(read.exposure, BASE_EXPOSURE);
  assert.ok(read.exposure < 1); // never full size for no reason
});

test("macroExposure: the cut is graded by how many reads are lit", () => {
  // Only rupiah weak and the local index rolling over.
  const series = new Map<string, MacroBar[]>([
    ["IDR=X", rising(60, 15000)],
    ["^JKSE", falling(30, 6000)],
    ["^VIX", falling(10, 25)],
    ["CL=F", falling(30, 80)],
  ]);
  const read = macroExposure(series, at(rising(60, 15000)));
  assert.equal(read.flags.length, 2);
  assert.equal(read.exposure, BASE_EXPOSURE * EXPOSURE_STEPS[2]);
});

test("macroExposure: an explicit base overrides the default", () => {
  const calm = new Map<string, MacroBar[]>([
    ["IDR=X", falling(60, 16000)],
    ["^VIX", falling(10, 25)],
    ["^JKSE", rising(30, 6000)],
    ["CL=F", falling(30, 80)],
  ]);
  assert.equal(macroExposure(calm, at(falling(60, 16000)), 1).exposure, 1);
  assert.equal(macroExposure(calm, at(falling(60, 16000)), 0.5).exposure, 0.5);
});

test("macroExposure: missing data fails open rather than standing down", () => {
  const read = macroExposure(new Map(), "2026-01-01");
  assert.deepEqual(macroFlags(new Map(), "2026-01-01"), []);
  assert.equal(read.exposure, BASE_EXPOSURE);
  // A series too short to measure its window is likewise left unlit.
  const short = new Map<string, MacroBar[]>([["IDR=X", rising(10, 15000)]]);
  assert.deepEqual(macroFlags(short, "2026-01-01"), []);
});

test("macroExposure: reports the index's own move for the session it is read on", () => {
  // The real 2026-10-16 tape: ^JKSE 5863.78 -> 5185.10 in one session.
  const crash = new Map<string, MacroBar[]>([["^JKSE", bars([6000, 5864, 5185])]]);
  const read = macroExposure(crash, day(2), 1);
  assert.equal(Math.round((read.indexChangePct ?? 0) * 10) / 10, -11.6);
  // Missing or single-point series leave the session move unknown, not zero.
  assert.equal(macroExposure(new Map(), "2026-01-01", 1).indexChangePct, null);
  assert.equal(indexSessionMove(bars([6000]), day(0)), null);
});
