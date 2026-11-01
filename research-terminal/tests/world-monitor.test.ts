import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyNewsTitle,
  coerceNewsArticles,
  deriveIndustries,
  hazardEvent,
  mergeMonitorEvents,
  newsEvent,
  strategicEvent,
} from "../lib/world-monitor.ts";
import type { HazardPoint, StrategicPoint } from "../lib/risk-map.ts";

const hazard: HazardPoint = {
  id: "gdacs-flood-1",
  type: "FL",
  label: "Flood",
  family: "FLOOD",
  name: "Flood in Central Java",
  country: "Indonesia",
  lat: -7.1,
  lng: 110.4,
  alert: "Orange",
  severity: 1200,
  severityText: "1,200 people affected",
  date: "2026-10-31T06:00:00",
  url: "https://example.com/flood",
  source: "GDACS",
  scope: "GLOBAL",
};

const chokepoint: StrategicPoint = {
  id: "hormuz",
  kind: "CHOKEPOINT",
  name: "Strait of Hormuz",
  region: "Persian Gulf",
  lat: 26.57,
  lng: 56.25,
  note: "Reference note",
  exposure: ["Brent", "LNG"],
};

const article = {
  id: "news-1",
  topic: "COMMODITIES",
  title: "Coal export ban disrupts supply from Kalimantan port",
  url: "https://example.com/news",
  source: "Example News",
  country: "Indonesia",
  publishedAt: "2026-10-31T08:00:00Z",
  impact: "HIGH",
  tone: "RISK",
};

test("headlines are classified into one monitor layer", () => {
  assert.equal(classifyNewsTitle("Missile attack escalates military conflict"), "CONFLICT");
  assert.equal(classifyNewsTitle("Port outage halts container terminal"), "INFRASTRUCTURE");
  assert.equal(classifyNewsTitle("Coal export ban disrupts supply"), "COMMODITY");
  assert.equal(classifyNewsTitle("Bank launches new savings product"), null);
});

test("industry tags are keyword-derived and bounded", () => {
  const tags = deriveIndustries("Coal and nickel supply disrupted at the port");
  assert.ok(tags.includes("Energy · Coal"));
  assert.ok(tags.includes("Basic Materials · Nickel"));
  assert.ok(tags.includes("Transportation & Logistics"));
  assert.equal(deriveIndustries("Bank launches new savings product").length, 0);
});

test("confirmed hazards keep coordinates and never invent industry exposure", () => {
  const event = hazardEvent(hazard, "2026-10-31T09:00:00Z");
  assert.equal(event.confidence, "CONFIRMED");
  assert.equal(event.layer, "NATURAL");
  assert.equal(event.lat, -7.1);
  assert.equal(event.location.includes("Indonesia"), true);
  assert.equal(event.industries.length, 0);
  assert.match(event.industryNote, /NOT MODELLED/);
  assert.equal(event.timestamp, hazard.date);
  assert.match(event.severity, /ORANGE/);
});

test("strategic points stay static references, not live events", () => {
  const event = strategicEvent(chokepoint, null);
  assert.equal(event.confidence, "STATIC-REFERENCE");
  assert.equal(event.layer, "CHOKEPOINT");
  assert.equal(event.severity, "REFERENCE");
  assert.equal(event.timestamp, null);
  assert.match(event.provenanceNote, /live transit status unavailable/i);
  assert.deepEqual(event.industries, ["Brent", "LNG"]);
});

test("news reports keep coordinates empty and are marked unverified", () => {
  const event = newsEvent(article, "COMMODITY", "2026-10-31T09:30:00Z");
  assert.equal(event.confidence, "NEWS-DERIVED");
  assert.equal(event.lat, null);
  assert.equal(event.lng, null);
  assert.equal(event.timestamp, article.publishedAt);
  assert.equal(event.lastUpdated, "2026-10-31T09:30:00Z");
  assert.match(event.industryNote, /KEYWORD-DERIVED/);
  assert.ok(event.industries.includes("Energy · Coal"));
});

test("news payloads are coerced defensively", () => {
  assert.deepEqual(coerceNewsArticles(null), []);
  const rows = coerceNewsArticles({ articles: [
    article,
    { ...article, id: "bad", url: "javascript:alert(1)" },
    { ...article, id: "empty", title: "" },
  ] });
  assert.deepEqual(rows.map((row) => row.id), ["news-1"]);
});

test("merged events keep all provenances and de-duplicate titles", () => {
  const events = mergeMonitorEvents({
    hazards: [hazard],
    strategic: [chokepoint],
    news: [article],
    lastUpdated: "2026-10-31T09:00:00Z",
    newsUpdated: "2026-10-31T09:30:00Z",
  });
  assert.deepEqual(events.map((event) => event.confidence).sort(), ["CONFIRMED", "NEWS-DERIVED", "STATIC-REFERENCE"]);
  const deduped = mergeMonitorEvents({
    hazards: [hazard],
    strategic: [],
    news: [],
    lastUpdated: null,
    newsUpdated: null,
  });
  assert.equal(deduped.length, 1);
});
