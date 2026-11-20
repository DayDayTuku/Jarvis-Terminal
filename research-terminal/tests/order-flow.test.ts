import test from "node:test";
import assert from "node:assert/strict";
import {
  anchoredVwap,
  assessOrderFlow,
  closeLocationValue,
  cumulativeDeltaPct,
  readOrderFlow,
  unfilledGaps,
  volumeProfile,
  summarizeOrderFlow,
  ORDER_FLOW_OFF,
  type FlowBar,
} from "../lib/order-flow.ts";

const bar = (date: string, open: number, high: number, low: number, close: number, volume = 1_000): FlowBar => ({
  date,
  open,
  high,
  low,
  close,
  volume,
});

const day = (index: number): string => `2026-01-${String(index + 1).padStart(2, "0")}`;

function rising(count: number): FlowBar[] {
  return Array.from({ length: count }, (_, index) => {
    const low = 100 + index * 10;
    return bar(day(index), low + 2, low + 8, low, low + 7);
  });
}

function falling(count: number): FlowBar[] {
  return Array.from({ length: count }, (_, index) => {
    const high = 1000 - index * 10;
    return bar(day(index), high - 2, high, high - 8, high - 7);
  });
}

test("close location value sits at +1 at the high and -1 at the low", () => {
  assert.equal(closeLocationValue(bar("2026-01-01", 100, 110, 90, 110)), 1);
  assert.equal(closeLocationValue(bar("2026-01-01", 100, 110, 90, 90)), -1);
  assert.equal(closeLocationValue(bar("2026-01-01", 100, 110, 90, 100)), 0);
  // A bar with no range cannot locate the close; it must be null, not zero.
  assert.equal(closeLocationValue(bar("2026-01-01", 100, 100, 100, 100)), null);
});

test("volume profile returns an ordered value area for a trending series", () => {
  const profile = volumeProfile(rising(30), { lookback: 30, bins: 24 });
  assert.ok(profile);
  assert.ok(profile.val < profile.poc);
  assert.ok(profile.poc < profile.vah);
  assert.equal(profile.sessions, 30);
  assert.equal(profile.from, "2026-01-01");
  assert.equal(profile.to, "2026-01-30");
});

test("volume profile refuses an unusable window instead of inventing one", () => {
  assert.equal(volumeProfile([], {}), null);
  assert.equal(volumeProfile([bar("2026-01-01", 1, 1, 1, 1, 0)], {}), null);
  // 19 usable sessions is below the 20-session floor.
  assert.equal(volumeProfile(rising(19).map((item) => ({ ...item, volume: 0 })), {}), null);
});

test("anchored VWAP and cumulative delta have the expected sign", () => {
  const up = anchoredVwap(rising(30), 30);
  assert.ok(up);
  assert.ok(up.vwap > 0 && up.sigma >= 0);
  assert.ok((cumulativeDeltaPct(rising(30), 10) ?? 0) > 50);
  assert.ok((cumulativeDeltaPct(falling(30), 10) ?? 0) < -50);
});

test("positive flow with no price progress reads as supply absorption", () => {
  // Close pinned near the high of a wide range, but the close price is flat:
  // buying is happening and price is not following.
  const flat: FlowBar[] = Array.from({ length: 30 }, (_, index) => bar(day(index), 105, 110, 100, 109.9));
  const read = readOrderFlow(flat, { lookback: 30, deltaWindow: 10 });
  assert.equal(read.absorption, "SUPPLY");
  assert.ok((read.cvdPct ?? 0) > 3);
  assert.ok(Math.abs(read.progressPct ?? 99) < 0.01);
  // The read is advisory unless the policy says otherwise.
  assert.equal(read.blockLong, false);
  assert.equal(read.blockReasons.length, 0);
});

test("negative flow with resilient price reads as demand absorption", () => {
  const flat: FlowBar[] = Array.from({ length: 30 }, (_, index) => bar(day(index), 105, 110, 100, 100.1));
  const read = readOrderFlow(flat, { lookback: 30, deltaWindow: 10 });
  assert.equal(read.absorption, "DEMAND");
  assert.ok((read.cvdPct ?? 0) < -3);
});

test("unfilled gaps are measured from the origin edge and ignored once filled", () => {
  const bullish = [
    bar("2026-01-01", 97, 100, 95, 98),
    bar("2026-01-02", 101, 104, 99, 103),
    bar("2026-01-03", 108, 112, 106, 110), // low 106 > high[0] 100 → unfilled
    bar("2026-01-04", 112, 116, 111, 115),
  ];
  const gap = unfilledGaps(bullish, 10);
  assert.equal(gap.belowCount, 1);
  assert.equal(gap.aboveCount, 0);
  assert.ok(gap.belowPct !== null && Math.abs(gap.belowPct - ((115 - 100) / 115) * 100) < 1e-9);

  const filled = [...bullish, bar("2026-01-05", 110, 112, 99, 105)];
  assert.equal(unfilledGaps(filled, 10).belowCount, 0);

  const bearish = [
    bar("2026-01-01", 100, 105, 99, 101),
    bar("2026-01-02", 101, 106, 102, 104),
    bar("2026-01-03", 96, 98, 90, 92), // high 98 < low[0] 99 → gap above
    bar("2026-01-04", 92, 94, 88, 90),
  ];
  const above = unfilledGaps(bearish, 10);
  assert.equal(above.aboveCount, 1);
  assert.ok(above.abovePct !== null && above.abovePct > 0);
});

test("a short history yields an UNKNOWN read and never a veto", () => {
  const read = readOrderFlow(rising(10), { policy: { requireAboveValue: true, vetoSupplyAbsorption: true, maxExtensionSigma: 1, minCvdPct: 0 } });
  assert.equal(read.sessions, 10);
  assert.equal(read.location, "UNKNOWN");
  assert.equal(read.profile, null);
  assert.equal(read.blockLong, false);
});

test("the policy decides whether evidence blocks a long, and says why", () => {
  const declining = falling(30);
  const read = readOrderFlow(declining, { lookback: 30, deltaWindow: 10 });
  // A falling series ends at or below the value-area low; both readings mean
  // "not accepted above value".
  assert.ok(["BELOW_VALUE", "AT_VALUE_LOW"].includes(read.location));

  const off = assessOrderFlow(read, ORDER_FLOW_OFF);
  assert.equal(off.blockLong, false);

  const strict = assessOrderFlow(read, { requireAboveValue: true, vetoSupplyAbsorption: false, maxExtensionSigma: null, minCvdPct: null });
  assert.equal(strict.blockLong, true);
  assert.match(strict.blockReasons[0], /value area/);

  // A missing band cannot trigger the extension rule: null is unknown, not zero.
  const unknownBand = { ...read, vwapSigma: null };
  assert.equal(assessOrderFlow(unknownBand, { requireAboveValue: false, vetoSupplyAbsorption: false, maxExtensionSigma: 2, minCvdPct: null }).blockLong, false);

  const extended = { ...read, location: "ABOVE_VALUE" as const, vwapSigma: 3.4 };
  const extension = assessOrderFlow(extended, { requireAboveValue: true, vetoSupplyAbsorption: false, maxExtensionSigma: 2.5, minCvdPct: null });
  assert.equal(extension.blockLong, true);
  assert.match(extension.blockReasons[0], /3\.4σ/);
});

test("reasons are readable evidence lines, not hidden numbers", () => {
  const read = readOrderFlow(rising(30), { lookback: 30, deltaWindow: 10 });
  assert.ok(read.reasons.some((line) => line.startsWith("Auction location:")));
  assert.ok(read.reasons.some((line) => line.startsWith("Flow proxy:")));
  assert.ok(read.reasons.some((line) => line.startsWith("Anchored VWAP")));
});

test("the one-line summary names the proxy and stays null without a read", () => {
  const read = readOrderFlow(rising(30), { lookback: 30, deltaWindow: 10 });
  const line = summarizeOrderFlow(read);
  assert.ok(line);
  assert.match(line, /Order flow \(daily bars\)/);
  assert.match(line, /delta proxy/);
  assert.match(line, /VWAP/);

  const empty = readOrderFlow([], {});
  assert.equal(summarizeOrderFlow(empty), null);
});
