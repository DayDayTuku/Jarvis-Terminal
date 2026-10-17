import test from "node:test";
import assert from "node:assert/strict";
import { EXPOSURE_BY_FLAGS, macroExposure, macroFlags, type MacroBar } from "../lib/macro-risk.ts";

const day = (index: number) => new Date(Date.UTC(2025, 0, 1) + index * 86_400_000).toISOString().slice(0, 10);
const bars = (values: number[]): MacroBar[] => values.map((close, index) => ({ date: day(index), close }));
const at = (values: number[]) => day(values.length - 1);
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

test("macroExposure: a calm backdrop keeps full size", () => {
  const series = new Map<string, MacroBar[]>([
    ["IDR=X", falling(60, 16000)], // below its average -> rupiah strong
    ["^VIX", falling(10, 25)],     // easing
    ["^JKSE", rising(30, 6000)],   // trending up
    ["CL=F", falling(30, 80)],     // easing
  ]);
  const read = macroExposure(series, at(falling(60, 16000)));
  assert.deepEqual(read.flags, []);
  assert.equal(read.exposure, 1);
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
  assert.equal(read.exposure, EXPOSURE_BY_FLAGS[2]);
  assert.equal(read.exposure, 0.5);
});

test("macroExposure: missing data fails open rather than standing down", () => {
  const read = macroExposure(new Map(), "2026-01-01");
  assert.deepEqual(macroFlags(new Map(), "2026-01-01"), []);
  assert.equal(read.exposure, 1);
  // A series too short to measure its window is likewise left unlit.
  const short = new Map<string, MacroBar[]>([["IDR=X", rising(10, 15000)]]);
  assert.deepEqual(macroFlags(short, "2026-01-01"), []);
});
