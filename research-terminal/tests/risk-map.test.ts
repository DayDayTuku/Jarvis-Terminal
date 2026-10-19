import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_HAZARD_POINTS,
  STRATEGIC_POINTS,
  dedupeHazards,
  hazardFreshness,
  hazardLabel,
  normalizeAlert,
  normalizeGdacs,
  type HazardPoint,
} from "../lib/risk-map.ts";

const gdacsFeature = (overrides: Record<string, unknown> = {}) => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [56.25, 26.57] },
  properties: {
    eventtype: "EQ",
    eventid: 111,
    episodeid: 222,
    name: "Earthquake in Testland",
    description: "Earthquake in Testland",
    country: "Testland",
    alertlevel: "Orange",
    alertscore: 2,
    fromdate: "2026-10-15T11:07:01",
    datemodified: "2026-10-15T11:28:23",
    severitydata: { severity: 6.1, severitytext: "Magnitude 6.1M" },
    url: { report: "https://www.gdacs.org/report.aspx?eventid=111" },
    ...overrides,
  },
});

test("normalizeGdacs: maps a valid point feature", () => {
  const [point] = normalizeGdacs({ features: [gdacsFeature()] });
  assert.equal(point.id, "EQ-111-222");
  assert.equal(point.type, "EQ");
  assert.equal(point.label, "Earthquake");
  assert.equal(point.lat, 26.57);
  assert.equal(point.lng, 56.25);
  assert.equal(point.alert, "Orange");
  assert.equal(point.severity, 6.1);
  assert.equal(point.severityText, "Magnitude 6.1M");
  assert.equal(point.country, "Testland");
  assert.equal(point.url, "https://www.gdacs.org/report.aspx?eventid=111");
});

test("normalizeGdacs: drops non-point, coordinate-less and untyped features", () => {
  const payload = {
    features: [
      { type: "Feature", geometry: { type: "Polygon", coordinates: [] }, properties: { eventtype: "FL", eventid: 1 } },
      { type: "Feature", geometry: { type: "Point", coordinates: [null, null] }, properties: { eventtype: "FL", eventid: 2 } },
      { type: "Feature", geometry: { type: "Point", coordinates: [10, 10] }, properties: { eventid: 3 } },
      null,
      gdacsFeature({ eventid: 4 }),
    ],
  };
  const points = normalizeGdacs(payload);
  assert.equal(points.length, 1);
  assert.equal(points[0].id, "EQ-4-222");
});

test("normalizeGdacs: tolerates a malformed payload", () => {
  assert.deepEqual(normalizeGdacs(null), []);
  assert.deepEqual(normalizeGdacs({}), []);
  assert.deepEqual(normalizeGdacs({ features: "nope" }), []);
});

test("normalizeGdacs: skips superseded events (iscurrent=false)", () => {
  const points = normalizeGdacs({
    features: [gdacsFeature({ eventid: 1, iscurrent: "false" }), gdacsFeature({ eventid: 2, iscurrent: "true" })],
  });
  assert.equal(points.length, 1);
  assert.equal(points[0].id, "EQ-2-222");
});

test("normalizeGdacs: sorts by alert severity, reds first", () => {
  const points = normalizeGdacs({
    features: [
      gdacsFeature({ eventid: 1, alertlevel: "Green" }),
      gdacsFeature({ eventid: 2, alertlevel: "Red" }),
      gdacsFeature({ eventid: 3, alertlevel: "Orange" }),
    ],
  });
  assert.deepEqual(
    points.map((point) => point.alert),
    ["Red", "Orange", "Green"],
  );
});

test("normalizeAlert: unknown values fall back to Green", () => {
  assert.equal(normalizeAlert("Red"), "Red");
  assert.equal(normalizeAlert("orange"), "Orange");
  assert.equal(normalizeAlert("GREEN"), "Green");
  assert.equal(normalizeAlert(undefined), "Green");
  assert.equal(normalizeAlert("purple"), "Green");
});

test("hazardLabel: known codes get names, unknown codes pass through", () => {
  assert.equal(hazardLabel("TC"), "Tropical cyclone");
  assert.equal(hazardLabel("ZZ"), "ZZ");
});

test("hazardFreshness: returns the latest date or null", () => {
  const base: HazardPoint = {
    id: "x",
    type: "EQ",
    label: "Earthquake",
    name: "n",
    country: "",
    lat: 0,
    lng: 0,
    alert: "Green",
    severity: null,
    severityText: "",
    date: "2026-10-01T00:00:00",
    url: "",
  };
  assert.equal(hazardFreshness([]), null);
  assert.equal(
    hazardFreshness([base, { ...base, id: "y", date: "2026-10-09T00:00:00" }, { ...base, id: "z", date: "2026-09-20T00:00:00" }]),
    "2026-10-09T00:00:00",
  );
});

test("dedupeHazards: collapses repeated event features to one pin", () => {
  const base: HazardPoint = {
    id: "TC-100-7",
    type: "TC",
    label: "Tropical cyclone",
    name: "Cyclone",
    country: "",
    lat: 10,
    lng: 100,
    alert: "Red",
    severity: null,
    severityText: "",
    date: "2026-10-10T00:00:00",
    url: "",
  };
  // GDACS returns one feature per track point; same id, different coordinates.
  const repeated = [base, { ...base, lat: 11 }, { ...base, lat: 12 }, { ...base, id: "EQ-9-1", type: "EQ", alert: "Green" }];
  const deduped = dedupeHazards(repeated);
  assert.equal(deduped.length, 2);
  assert.deepEqual(
    deduped.map((point) => point.id),
    ["TC-100-7", "EQ-9-1"],
  );
  // Red sorts ahead of Green.
  assert.equal(deduped[0].alert, "Red");
});

test("dedupeHazards: caps the layer", () => {
  const many: HazardPoint[] = Array.from({ length: MAX_HAZARD_POINTS + 25 }, (_, index) => ({
    id: `EQ-${index}-1`,
    type: "EQ",
    label: "Earthquake",
    name: "q",
    country: "",
    lat: 0,
    lng: 0,
    alert: "Green",
    severity: null,
    severityText: "",
    date: "2026-01-01T00:00:00",
    url: "",
  }));
  assert.equal(dedupeHazards(many).length, MAX_HAZARD_POINTS);
});

test("STRATEGIC_POINTS: ids unique, coordinates valid, exposure present", () => {
  const ids = new Set<string>();
  for (const point of STRATEGIC_POINTS) {
    assert.ok(!ids.has(point.id), `duplicate id ${point.id}`);
    ids.add(point.id);
    assert.ok(point.kind === "CHOKEPOINT" || point.kind === "CONFLICT", `bad kind ${point.kind}`);
    assert.ok(point.lat >= -90 && point.lat <= 90, `bad lat ${point.id}`);
    assert.ok(point.lng >= -180 && point.lng <= 180, `bad lng ${point.id}`);
    assert.ok(point.name.length > 0 && point.note.length > 0, `missing text ${point.id}`);
    assert.ok(point.exposure.length > 0, `missing exposure ${point.id}`);
  }
  assert.ok(STRATEGIC_POINTS.some((point) => point.kind === "CHOKEPOINT"));
  assert.ok(STRATEGIC_POINTS.some((point) => point.kind === "CONFLICT"));
});
