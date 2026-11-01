/**
 * World Monitor event model.
 *
 * Three provenance classes are kept deliberately separate:
 *  - CONFIRMED        official feeds with coordinates (GDACS, BMKG, NASA FIRMS)
 *  - NEWS-DERIVED     headline reports without verified coordinates (GDELT/Google News)
 *  - STATIC-REFERENCE curated chokepoints and conflict descriptors, never "live"
 *
 * Nothing here creates coordinates, severity or industry exposure that the
 * source did not provide. Keyword-derived industry tags are labelled as such.
 */

import type { FireCell, HazardFamily, HazardPoint, StrategicPoint } from "./risk-map.ts";

export type MonitorLayer = "NATURAL" | "WILDFIRE" | "CONFLICT" | "CHOKEPOINT" | "INFRASTRUCTURE" | "COMMODITY";
export type EventConfidence = "CONFIRMED" | "NEWS-DERIVED" | "STATIC-REFERENCE";
export type NewsCategory = "CONFLICT" | "INFRASTRUCTURE" | "COMMODITY";

export type MonitorEvent = {
  id: string;
  layer: MonitorLayer;
  title: string;
  location: string;
  category: string;
  severity: string;
  source: string;
  timestamp: string | null;
  lastUpdated: string | null;
  confidence: EventConfidence;
  description: string;
  industries: string[];
  industryNote: string;
  lat: number | null;
  lng: number | null;
  url: string | null;
  /** Optional operator note shown next to the provenance badge. */
  provenanceNote: string;
  /** Present on natural-hazard events so the monitor can filter by family. */
  hazardFamily?: HazardFamily;
};

export type NewsArticle = {
  id: string;
  topic: string;
  title: string;
  url: string;
  source: string;
  country: string | null;
  publishedAt: string | null;
  impact: string;
  tone: string;
};

const CONFLICT_TERMS = [
  "war", "missile", "airstrike", "air strike", "drone attack", "invasion", "military",
  "sanction", "ceasefire", "rebel", "insurgency", "coup", "blockade", "naval", "troops",
  "perang", "rudal", "serangan", "militer", "sanksi", "gencatan senjata", "pemberontak",
];
const INFRASTRUCTURE_TERMS = [
  "port", "terminal", "refinery", "pipeline", "power plant", "power grid", "grid",
  "blackout", "outage", "cyberattack", "cyber attack", "subsea cable", "cable cut",
  "railway", "rail", "toll road", "bridge", "airport", "smelter", "factory", "plant",
  "warehouse", "logistics", "shipping", "freight", "pelabuhan", "kilang", "pipa",
  "pembangkit", "listrik", "gangguan", "kabel", "rel", "jembatan", "bandara", "pabrik",
  "gudang", "logistik", "pelayaran",
];
const COMMODITY_TERMS = [
  "coal", "nickel", "cpo", "palm oil", "copper", "gold", "tin", "bauxite", "lng",
  "crude", "oil", "gas", "wheat", "rice", "rubber", "cocoa", "coffee", "supply",
  "export ban", "production cut", "output cut", "mining", "mine", "smelting",
  "batubara", "batu bara", "nikel", "sawit", "tembaga", "emas", "timah", "bauksit",
  "minyak", "gas alam", "gandum", "beras", "karet", "kakao", "kopi", "pasokan",
  "larangan ekspor", "pemangkasan produksi", "tambang", "smelter",
];

const SUPPLY_TERMS = [
  "supply", "shortage", "disruption", "halt", "suspend", "cut", "ban", "embargo",
  "strike", "force majeure", "delay", "pasokan", "kelangkaan", "gangguan",
  "henti", "suspensi", "larangan", "embargo", "mogok", "keterlambatan",
];

const INDUSTRY_RULES: Array<{ terms: string[]; industries: string[] }> = [
  { terms: ["coal", "batubara", "batu bara"], industries: ["Energy · Coal"] },
  { terms: ["nickel", "nikel"], industries: ["Basic Materials · Nickel"] },
  { terms: ["cpo", "palm oil", "sawit"], industries: ["Consumer Non-Cyclicals · Edible oils"] },
  { terms: ["copper", "tembaga"], industries: ["Basic Materials · Copper"] },
  { terms: ["gold", "emas"], industries: ["Basic Materials · Gold"] },
  { terms: ["tin", "timah"], industries: ["Basic Materials · Tin"] },
  { terms: ["bauxite", "bauksit"], industries: ["Basic Materials · Bauxite"] },
  { terms: ["lng", "gas", "gas alam"], industries: ["Energy · Gas / LNG"] },
  { terms: ["crude", "oil", "minyak"], industries: ["Energy · Crude oil"] },
  { terms: ["wheat", "gandum", "rice", "beras"], industries: ["Consumer Non-Cyclicals · Staples"] },
  { terms: ["rubber", "karet"], industries: ["Basic Materials · Rubber"] },
  { terms: ["port", "pelabuhan", "shipping", "pelayaran", "freight", "logistics", "logistik"], industries: ["Transportation & Logistics"] },
  { terms: ["refinery", "kilang"], industries: ["Energy · Refining"] },
  { terms: ["power", "listrik", "grid", "pembangkit"], industries: ["Utilities · Power"] },
  { terms: ["smelter", "smelting", "pabrik", "factory", "plant"], industries: ["Industrials · Processing"] },
];

function containsAny(haystack: string, terms: readonly string[]): string[] {
  const lower = haystack.toLowerCase();
  return terms.filter((term) => lower.includes(term));
}

/** Classify a headline into one monitor layer, or null when it is not relevant. */
export function classifyNewsTitle(title: string): NewsCategory | null {
  const conflict = containsAny(title, CONFLICT_TERMS);
  if (conflict.length) return "CONFLICT";
  const commodity = containsAny(title, COMMODITY_TERMS);
  // An explicit commodity + supply disruption outranks a transport keyword, so
  // "coal export ban at the port" is filed as a commodity event, not logistics.
  if (commodity.length && containsAny(title, SUPPLY_TERMS).length) return "COMMODITY";
  const infrastructure = containsAny(title, INFRASTRUCTURE_TERMS);
  if (infrastructure.length) return "INFRASTRUCTURE";
  if (commodity.length >= 2) return "COMMODITY";
  return null;
}

/** Conservative industry tags; the UI marks these as keyword-derived. */
export function deriveIndustries(title: string): string[] {
  const tags = INDUSTRY_RULES.flatMap((rule) => (containsAny(title, rule.terms).length ? rule.industries : []));
  return [...new Set(tags)].slice(0, 4);
}

export function coerceNewsArticles(payload: unknown): NewsArticle[] {
  if (!payload || typeof payload !== "object") return [];
  const raw = (payload as { articles?: unknown }).articles;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const title = typeof row.title === "string" ? row.title.trim() : "";
    const url = typeof row.url === "string" ? row.url : "";
    if (!title || !/^https?:\/\//.test(url)) return [];
    return [{
      id: String(row.id ?? url),
      topic: String(row.topic ?? ""),
      title,
      url,
      source: String(row.source ?? "News source"),
      country: typeof row.country === "string" ? row.country : null,
      publishedAt: typeof row.publishedAt === "string" ? row.publishedAt : null,
      impact: String(row.impact ?? "LOW"),
      tone: String(row.tone ?? "MIXED"),
    }];
  });
}

export function newsEvent(article: NewsArticle, category: NewsCategory, lastUpdated: string | null): MonitorEvent {
  const industries = deriveIndustries(article.title);
  const layer: MonitorLayer = category === "CONFLICT" ? "CONFLICT" : category === "INFRASTRUCTURE" ? "INFRASTRUCTURE" : "COMMODITY";
  const categoryLabel = category === "CONFLICT" ? "Geopolitical report" : category === "INFRASTRUCTURE" ? "Infrastructure disruption report" : "Commodity supply report";
  return {
    id: `news-${article.id}`,
    layer,
    title: article.title,
    location: article.country || "Location not provided by source",
    category: categoryLabel,
    severity: article.impact,
    source: article.source,
    timestamp: article.publishedAt,
    lastUpdated,
    confidence: "NEWS-DERIVED",
    description: `Headline report classified by keywords. Tone label: ${article.tone}. The source did not provide verified coordinates, so this event is listed but not plotted on the map.`,
    industries,
    industryNote: industries.length ? "KEYWORD-DERIVED · UNVERIFIED" : "NOT CLASSIFIED BY SOURCE",
    lat: null,
    lng: null,
    url: article.url,
    provenanceNote: "News-derived report · not a confirmed incident feed",
  };
}

export function hazardEvent(point: HazardPoint, lastUpdated: string | null): MonitorEvent {  return {
    id: point.id,
    layer: "NATURAL",
    title: point.name,
    location: [point.country, `${point.lat.toFixed(2)}, ${point.lng.toFixed(2)}`].filter(Boolean).join(" · ") || "Location reported by source",
    category: point.label,
    severity: `${point.alert.toUpperCase()}${point.severity !== null ? ` · ${point.severity}` : ""}`,
    source: point.source,
    timestamp: point.date || null,
    lastUpdated,
    confidence: "CONFIRMED",
    description: `${point.severityText || point.label}. Confirmed by the ${point.source} feed.`,
    industries: [],
    industryNote: "NOT MODELLED BY THIS FEED",
    lat: point.lat,
    lng: point.lng,
    url: point.url || null,
    provenanceNote: `Official feed · ${point.source}`,
    hazardFamily: point.family,
  };
}

export function fireCellEvent(cell: FireCell, lastUpdated: string | null): MonitorEvent {
  const location = cell.indonesiaRegion ? `${cell.indonesiaRegion} · ${cell.region}` : cell.region;
  return {
    id: cell.id,
    layer: "WILDFIRE",
    title: `${cell.count.toLocaleString("en-US")} hotspots · ${location}`,
    location,
    category: "Wildfire hotspot cell",
    severity: `PEAK ${cell.maxFrp} MW · ${cell.totalFrp.toLocaleString("en-US")} MW TOTAL`,
    source: "NASA FIRMS",
    timestamp: cell.date || null,
    lastUpdated,
    confidence: "CONFIRMED",
    description: "Satellite hotspot detections clustered into a 1° cell (24h VIIRS). Detections show thermal anomalies, not a confirmed fire perimeter.",
    industries: [],
    industryNote: "NOT MODELLED BY THIS FEED",
    lat: cell.lat,
    lng: cell.lng,
    url: null,
    provenanceNote: "Official satellite feed · NASA FIRMS",
    hazardFamily: "FIRE",
  };
}

export function strategicEvent(point: StrategicPoint, lastUpdated: string | null): MonitorEvent {  const chokepoint = point.kind === "CHOKEPOINT";
  return {
    id: `strategic-${point.id}`,
    layer: chokepoint ? "CHOKEPOINT" : "CONFLICT",
    title: point.name,
    location: point.region,
    category: chokepoint ? "Maritime chokepoint · static reference" : "Conflict zone · static reference",
    severity: "REFERENCE",
    source: "Jarvis strategic reference",
    timestamp: null,
    lastUpdated,
    confidence: "STATIC-REFERENCE",
    description: point.note,
    industries: point.exposure,
    industryNote: "CURATED EXPOSURE TAGS",
    lat: point.lat,
    lng: point.lng,
    url: null,
    provenanceNote: chokepoint
      ? "Static strategic reference · live transit status unavailable"
      : "Static conflict descriptor · not a live conflict event",
  };
}

/** Merge the three provenance classes into one ranked list. */
export function mergeMonitorEvents(args: {
  hazards: readonly HazardPoint[];
  strategic: readonly StrategicPoint[];
  news: readonly NewsArticle[];
  fireCells?: readonly FireCell[];
  lastUpdated: string | null;
  newsUpdated: string | null;
  newsCategories?: Partial<Record<NewsCategory, boolean>>;
}): MonitorEvent[] {
  const news = args.news.flatMap((article) => {
    const category = classifyNewsTitle(article.title);
    if (!category) return [];
    if (args.newsCategories && args.newsCategories[category] === false) return [];
    return [newsEvent(article, category, args.newsUpdated)];
  });
  const seen = new Set<string>();
  return [
    ...args.hazards.map((point) => hazardEvent(point, args.lastUpdated)),
    ...(args.fireCells ?? []).map((cell) => fireCellEvent(cell, args.lastUpdated)),
    ...args.strategic.map((point) => strategicEvent(point, args.lastUpdated)),
    ...news,
  ].filter((event) => {
    const key = event.title.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 90);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Map a hazard family onto the natural sub-filters used by the monitor. */
export function hazardInFamily(family: string, filter: string): boolean {
  return filter === "ALL" || family === filter;
}
