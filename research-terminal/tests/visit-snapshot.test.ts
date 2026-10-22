import test from "node:test";
import assert from "node:assert/strict";
import {
  buildVisitSnapshot,
  describeVisitDelta,
  parseVisitSnapshot,
  visitAgeLabel,
} from "../lib/visit-snapshot.ts";

const base = {
  takenAt: "2026-10-20T08:00:00.000Z",
  regime: "REFLATION",
  breadthPositive: 6,
  breadthTotal: 11,
  liveFeeds: 4,
};

test("visit snapshots are parsed defensively", () => {
  assert.deepEqual(parseVisitSnapshot(JSON.stringify(base)), base);
  assert.equal(parseVisitSnapshot(null), null);
  assert.equal(parseVisitSnapshot("not-json"), null);
  assert.equal(parseVisitSnapshot(JSON.stringify({ ...base, takenAt: "nope" })), null);
  assert.equal(parseVisitSnapshot(JSON.stringify({ ...base, liveFeeds: "5" }))?.liveFeeds, 0);
});

test("new visitors get a baseline message instead of fake deltas", () => {
  const current = buildVisitSnapshot({ regime: "REFLATION", breadthPositive: 6, breadthTotal: 11, liveFeeds: 5 });
  const deltas = describeVisitDelta(null, current);
  assert.equal(deltas[0].label, "FIRST SESSION");
  assert.equal(deltas[1].value, "5/5 live");
});

test("returning visitors see regime, breadth, and feed changes", () => {
  const previous = parseVisitSnapshot(JSON.stringify(base))!;
  const current = buildVisitSnapshot({
    regime: "STAGFLATION",
    breadthPositive: 3,
    breadthTotal: 11,
    liveFeeds: 5,
  });
  const deltas = describeVisitDelta(previous, current);
  assert.equal(deltas[0].value, "REFLATION → STAGFLATION");
  assert.equal(deltas[0].tone, "neutral");
  assert.equal(deltas[1].value, "-3 sectors vs last visit");
  assert.equal(deltas[1].tone, "negative");
  assert.equal(deltas[2].value, "5/5 live (+1)");
  assert.equal(deltas[2].tone, "positive");
});

test("visit age labels are stable", () => {
  const now = Date.parse("2026-10-22T08:00:00.000Z");
  assert.equal(visitAgeLabel("2026-10-22T07:59:40.000Z", now), "JUST NOW");
  assert.equal(visitAgeLabel("2026-10-22T07:20:00.000Z", now), "40M AGO");
  assert.equal(visitAgeLabel("2026-10-22T05:00:00.000Z", now), "3H AGO");
  assert.equal(visitAgeLabel("2026-10-21T08:00:00.000Z", now), "YESTERDAY");
  assert.equal(visitAgeLabel("2026-10-18T08:00:00.000Z", now), "4D AGO");
  assert.equal(visitAgeLabel("invalid", now), "UNKNOWN");
});
