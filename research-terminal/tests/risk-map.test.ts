import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_HAZARD_POINTS,
  STRATEGIC_POINTS,
  coerceRiskMapData,
  coerceWildfire,
  dedupeHazards,
  fireAlert,
  hazardFamily,
  hazardFreshness,
  hazardLabel,
  normalizeAlert,
  normalizeGdacs,
  quakeAlert,
  quakeToHazard,
  type FireCell,
  type HazardPoint,
} from "../lib/risk-map.ts";

/** Minimal valid hazard pin; tests override only what they assert. */
const hazardPoint = (overrides: Partial<HazardPoint> = {}): HazardPoint => ({
  id: "x",
  type: "EQ",
  label: "Earthquake",
  family: "QUAKE",
  name: "n",
  country: "",
  lat: 0,
  lng: 0,
  alert: "Green",
  severity: null,
  severityText: "",
  date: "2026-10-01T00:00:00",
  url: "",
  source: "GDACS",
  scope: "GLOBAL",
  ...overrides,
});

const fireCell = (overrides: Partial<FireCell> = {}): FireCell => ({
  id: "fire-0:100",
  lat: 0,
  lng: 100,
  count: 1,
  maxFrp: 1,
  totalFrp: 1,
  region: "SOUTHEAST ASIA",
  indonesiaRegion: null,
  date: "2026-10-01",
  ...overrides,
});

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
  assert.equal(hazardFreshness([]), null);
  assert.equal(
    hazardFreshness([
      hazardPoint(),
      hazardPoint({ id: "y", date: "2026-10-09T00:00:00" }),
      hazardPoint({ id: "z", date: "2026-09-20T00:00:00" }),
    ]),
    "2026-10-09T00:00:00",
  );
});

test("dedupeHazards: collapses repeated event features to one pin", () => {
  const base = hazardPoint({ id: "TC-100-7", type: "TC", label: "Tropical cyclone", name: "Cyclone", lat: 10, lng: 100, alert: "Red", date: "2026-10-10T00:00:00" });
  // GDACS returns one feature per track point; same id, different coordinates.
  const repeated = [base, { ...base, lat: 11 }, { ...base, lat: 12 }, hazardPoint({ id: "EQ-9-1" })];
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
  const many: HazardPoint[] = Array.from({ length: MAX_HAZARD_POINTS + 25 }, (_, index) => hazardPoint({ id: `EQ-${index}-1` }));
  assert.equal(dedupeHazards(many).length, MAX_HAZARD_POINTS);
});

test("normalizeGdacs: tags each point with family, source and scope", () => {
  const [point] = normalizeGdacs({ features: [gdacsFeature({ eventtype: "WF" })] });
  assert.equal(point.family, "FIRE");
  assert.equal(point.source, "GDACS");
  assert.equal(point.scope, "GLOBAL");
});

test("hazardFamily: maps GDACS codes and defaults unknown codes to QUAKE", () => {
  assert.equal(hazardFamily("EQ"), "QUAKE");
  assert.equal(hazardFamily("TC"), "STORM");
  assert.equal(hazardFamily("FL"), "FLOOD");
  assert.equal(hazardFamily("VO"), "VOLCANO");
  assert.equal(hazardFamily("DR"), "DROUGHT");
  assert.equal(hazardFamily("WF"), "FIRE");
  assert.equal(hazardFamily("fire"), "FIRE");
  assert.equal(hazardFamily("ZZ"), "QUAKE");
});

test("quakeAlert: buckets BMKG magnitude into alert levels", () => {
  assert.equal(quakeAlert(4.9), "Green");
  assert.equal(quakeAlert(5), "Orange");
  assert.equal(quakeAlert(5.9), "Orange");
  assert.equal(quakeAlert(6), "Red");
});

test("fireAlert: escalates on hotspot count or peak FRP", () => {
  assert.equal(fireAlert(fireCell({ count: 3, maxFrp: 5 })), "Green");
  assert.equal(fireAlert(fireCell({ count: 20, maxFrp: 5 })), "Orange");
  assert.equal(fireAlert(fireCell({ count: 3, maxFrp: 40 })), "Orange");
  assert.equal(fireAlert(fireCell({ count: 100, maxFrp: 5 })), "Red");
  assert.equal(fireAlert(fireCell({ count: 3, maxFrp: 100 })), "Red");
});

test("quakeToHazard: maps a BMKG read onto the shared hazard shape", () => {
  const hazard = quakeToHazard({
    id: "bmkg-1",
    magnitude: 5.4,
    depthKm: 12,
    region: "Laut Banda",
    felt: "III Ambon",
    lat: -4.1,
    lng: 130.2,
    date: "2026-10-18T06:00:00+07:00",
    url: "https://www.bmkg.go.id/gempabumi/gempabumi-dirasakan.bmkg",
  });
  assert.equal(hazard.id, "bmkg-1");
  assert.equal(hazard.type, "EQ");
  assert.equal(hazard.family, "QUAKE");
  assert.equal(hazard.source, "BMKG");
  assert.equal(hazard.scope, "INDONESIA");
  assert.equal(hazard.country, "Indonesia");
  assert.equal(hazard.alert, "Orange");
  assert.equal(hazard.severity, 5.4);
  assert.equal(hazard.severityText, "M 5.4 · 12 km deep · felt III Ambon");
});

test("quakeToHazard: omits missing depth and felt detail", () => {
  const hazard = quakeToHazard({ id: "bmkg-2", magnitude: 6.2, depthKm: null, region: "Laut", felt: "", lat: 0, lng: 120, date: "", url: "" });
  assert.equal(hazard.alert, "Red");
  assert.equal(hazard.severityText, "M 6.2");
});

test("coerceRiskMapData: tolerates a stale payload from before a layer existed", () => {
  // A body cached before the wildfire layer shipped has no wildfire field.
  const legacy = coerceRiskMapData({
    status: "live",
    source: "GDACS",
    freshness: "2026-10-15T00:00:00",
    strategic: [{ id: "a", kind: "CONFLICT", name: "n", region: "r", lat: 1, lng: 2, note: "x", exposure: ["Brent"] }],
    hazards: [hazardPoint()],
    failures: ["BMKG: timeout"],
  });
  assert.equal(legacy.wildfire, null);
  assert.equal(legacy.hazards.length, 1);
  assert.equal(legacy.strategic.length, 1);
  assert.deepEqual(legacy.failures, ["BMKG: timeout"]);
});

test("coerceRiskMapData: keeps fires from a body cached before the global rename", () => {
  // The pre-global shape carried a `karhutla` read and a separate `fires` array.
  const stale = coerceRiskMapData({
    status: "live",
    hazards: [],
    karhutla: { total: 7, cells: [fireCell()], regions: [{ name: "SUMATRA", count: 7, frp: 10 }], latest: "2026-10-18", truncated: false },
  });
  assert.equal(stale.wildfire?.total, 7);
  assert.equal(stale.wildfire?.cells.length, 1);
  assert.equal(stale.wildfire?.indonesiaTotal, 0);
  assert.deepEqual(stale.wildfire?.indonesiaRegions, []);
});

test("coerceWildfire: normalises a partial read and rejects junk", () => {
  for (const input of [null, undefined, "yes", 42, []]) assert.equal(coerceWildfire(input), null);
  const read = coerceWildfire({
    total: 12,
    cells: [fireCell()],
    regions: [{ name: "AFRICA", count: 9, frp: 4 }],
    latest: "2026-10-19",
    truncated: true,
  });
  assert.ok(read);
  assert.equal(read!.total, 12);
  assert.equal(read!.cells.length, 1);
  assert.equal(read!.indonesiaTotal, 0);
  assert.deepEqual(read!.indonesiaRegions, []);
  assert.equal(read!.latest, "2026-10-19");
  assert.equal(read!.truncated, true);
});

test("coerceRiskMapData: survives junk without throwing", () => {
  for (const input of [null, undefined, {}, "nope", 42, { fires: "lots", karhutla: "yes" }]) {
    const data = coerceRiskMapData(input);
    assert.ok(Array.isArray(data.hazards));
    assert.equal(data.wildfire, null);
    assert.equal(data.status, "stale");
  }
  // With no strategic layer in the body, the curated layer is shown instead of nothing.
  assert.ok(coerceRiskMapData({}).strategic.length > 0);
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
