/**
 * Risk map: one source of truth for the "where is the world fragile" layer.
 *
 * Two layers, deliberately separated:
 *  1. STRATEGIC  - curated, hand-maintained. The chokepoints and conflict zones
 *                  that reliably move markets. Always available, never depends
 *                  on an upstream feed.
 *  2. HAZARDS    - live, free and keyless (GDACS: earthquakes, cyclones,
 *                  floods, volcanoes, droughts, wildfires) with real lat/long.
 *
 * Live geocoded *armed-conflict* event data (UCDP / ACLED) is intentionally not
 * wired here: UCDP is unreachable from our egress and ACLED needs a registered
 * key. When a key exists this module is the single place to add it.
 */

export type StrategicKind = "CHOKEPOINT" | "CONFLICT";

export type StrategicPoint = {
  id: string;
  kind: StrategicKind;
  name: string;
  region: string;
  lat: number;
  lng: number;
  note: string;
  exposure: string[];
};

export type HazardAlert = "Green" | "Orange" | "Red";

export type HazardPoint = {
  id: string;
  type: string;
  label: string;
  name: string;
  country: string;
  lat: number;
  lng: number;
  alert: HazardAlert;
  severity: number | null;
  severityText: string;
  date: string;
  url: string;
};

export type RiskMapData = {
  status: "live" | "stale";
  source: string;
  freshness: string | null;
  strategic: StrategicPoint[];
  hazards: HazardPoint[];
  failures: string[];
};

export const HAZARD_TYPES = ["EQ", "TC", "FL", "VO", "DR", "WF"] as const;

const HAZARD_LABELS: Record<string, string> = {
  EQ: "Earthquake",
  TC: "Tropical cyclone",
  FL: "Flood",
  VO: "Volcano",
  DR: "Drought",
  WF: "Wildfire",
};

export function hazardLabel(type: string) {
  return HAZARD_LABELS[type] ?? type;
}

export function normalizeAlert(value: unknown): HazardAlert {
  const raw = String(value ?? "").toLowerCase();
  if (raw.startsWith("red")) return "Red";
  if (raw.startsWith("orange")) return "Orange";
  return "Green";
}

const ALERT_RANK: Record<HazardAlert, number> = { Red: 3, Orange: 2, Green: 1 };

/**
 * Curated strategic layer. Coordinates are approximate anchors, not event
 * locations. Notes stay qualitative on purpose - nothing here is a forecast,
 * it is context for how a headline would transmit into the book.
 */
export const STRATEGIC_POINTS: StrategicPoint[] = [
  // ---- Trade / energy transit chokepoints -------------------------------
  {
    id: "hormuz",
    kind: "CHOKEPOINT",
    name: "Strait of Hormuz",
    region: "Persian Gulf",
    lat: 26.57,
    lng: 56.25,
    note: "The Gulf's only sea exit. A mining, seizure or closure shock transmits almost instantly to crude and tanker rates.",
    exposure: ["Brent", "LNG", "Tanker freight"],
  },
  {
    id: "bab-el-mandeb",
    kind: "CHOKEPOINT",
    name: "Bab-el-Mandeb / Red Sea",
    region: "Red Sea",
    lat: 12.58,
    lng: 43.33,
    note: "Suez-bound gateway. Missile/drone risk on shipping pushes vessels around the Cape, adding days and lifting freight plus war-risk insurance.",
    exposure: ["Container freight", "Brent", "EU-Asia trade"],
  },
  {
    id: "suez",
    kind: "CHOKEPOINT",
    name: "Suez Canal",
    region: "Egypt",
    lat: 30.52,
    lng: 32.35,
    note: "A large share of Asia-Europe trade. Red Sea spillover cuts transits and widens freight spreads.",
    exposure: ["Freight", "Asia-Europe trade"],
  },
  {
    id: "taiwan-strait",
    kind: "CHOKEPOINT",
    name: "Taiwan Strait",
    region: "East Asia",
    lat: 24.5,
    lng: 119.5,
    note: "A dense share of the world's container fleet and the semiconductor chain pass through. The largest single concentration of geopolitical risk for tech.",
    exposure: ["Semiconductors", "Asia FX", "Freight"],
  },
  {
    id: "malacca",
    kind: "CHOKEPOINT",
    name: "Strait of Malacca",
    region: "Southeast Asia",
    lat: 2.5,
    lng: 101.5,
    note: "The narrowest point on the Asia-Europe oil route. Piracy, blockage or a shift to alternative routes is an immediate crude and freight event.",
    exposure: ["Brent", "IDR", "Freight"],
  },
  {
    id: "turkish-straits",
    kind: "CHOKEPOINT",
    name: "Black Sea / Turkish Straits",
    region: "Eurasia",
    lat: 41.12,
    lng: 29.05,
    note: "Grain and Russian crude exports route here. War-risk premia and strikes on shipping move wheat and crude.",
    exposure: ["Wheat", "Brent", "RUB"],
  },
  {
    id: "panama",
    kind: "CHOKEPOINT",
    name: "Panama Canal",
    region: "Central America",
    lat: 9.08,
    lng: -79.68,
    note: "Drought-driven draft limits cut daily transits and reroute US-Asia flows through Suez or the Cape.",
    exposure: ["LNG", "Grain", "US-Asia freight"],
  },
  {
    id: "baltic",
    kind: "CHOKEPOINT",
    name: "Baltic Sea",
    region: "Northern Europe",
    lat: 57.0,
    lng: 20.0,
    note: "Shadow-fleet shipping and subsea-cable sabotage risk near the Russian Baltic fleet. A cable or pipeline cut is an energy and insurance event.",
    exposure: ["Energy", "Insurance"],
  },
  // ---- Active / latent conflict zones -----------------------------------
  {
    id: "ukraine-front",
    kind: "CONFLICT",
    name: "Ukraine - Russia front",
    region: "Eastern Europe",
    lat: 48.0,
    lng: 37.5,
    note: "Active interstate war. Sanctions, strikes on energy infrastructure and Black Sea shipping risk are the transmission channels.",
    exposure: ["Brent", "Gas", "Wheat", "EUR"],
  },
  {
    id: "levant",
    kind: "CONFLICT",
    name: "Levant (Israel / Lebanon / Gaza)",
    region: "Middle East",
    lat: 31.8,
    lng: 34.9,
    note: "Multi-front escalation risk that propagates directly to Red Sea shipping and crude.",
    exposure: ["Brent", "LNG", "Freight"],
  },
  {
    id: "sudan",
    kind: "CONFLICT",
    name: "Sudan",
    region: "Northeast Africa",
    lat: 15.5,
    lng: 32.5,
    note: "Civil war spanning the Red Sea coastline. Gold flows and regional security are the read-throughs.",
    exposure: ["Gold", "Regional FX"],
  },
  {
    id: "sahel",
    kind: "CONFLICT",
    name: "Sahel",
    region: "West Africa",
    lat: 14.5,
    lng: -1.0,
    note: "Coups and insurgency across Mali, Burkina Faso and Niger. Uranium and gold supply sit inside the zone.",
    exposure: ["Uranium", "Gold"],
  },
  {
    id: "myanmar",
    kind: "CONFLICT",
    name: "Myanmar",
    region: "Southeast Asia",
    lat: 21.5,
    lng: 96.0,
    note: "Civil war since the 2021 coup. Heavy rare-earth supply chains run through the China border.",
    exposure: ["Rare earths"],
  },
  {
    id: "south-china-sea",
    kind: "CONFLICT",
    name: "South China Sea",
    region: "Southeast Asia",
    lat: 10.5,
    lng: 114.5,
    note: "Overlapping sovereignty claims over the main east-west shipping lane and untapped offshore energy.",
    exposure: ["Shipping", "Energy", "Asia FX"],
  },
  {
    id: "korean-peninsula",
    kind: "CONFLICT",
    name: "Korean Peninsula (DMZ)",
    region: "East Asia",
    lat: 38.0,
    lng: 127.0,
    note: "Latent escalation risk. Semis and autos sit nearby; a flare-up pushes safe-haven demand into USD and KRW.",
    exposure: ["KRW", "Semiconductors"],
  },
  {
    id: "caucasus",
    kind: "CONFLICT",
    name: "Caucasus corridor",
    region: "Eurasia",
    lat: 39.8,
    lng: 46.8,
    note: "Post-conflict displacement and the Zangezur corridor debate over Central Asia-Europe trade and Caspian energy.",
    exposure: ["Caspian energy"],
  },
  {
    id: "horn-of-africa",
    kind: "CONFLICT",
    name: "Horn of Africa",
    region: "East Africa",
    lat: 10.5,
    lng: 39.5,
    note: "Post-war tension in Ethiopia and the Nile-dam dispute with Egypt and Sudan. Red Sea access is the strategic stake.",
    exposure: ["Regional FX", "Nile water"],
  },
  {
    id: "essequibo",
    kind: "CONFLICT",
    name: "Venezuela - Guyana (Essequibo)",
    region: "South America",
    lat: 6.5,
    lng: -58.5,
    note: "Territorial claim over oil-rich Essequibo. A flare-up touches new offshore crude capacity.",
    exposure: ["Brent", "Offshore crude"],
  },
];

function alertRank(alert: HazardAlert) {
  return ALERT_RANK[alert];
}

function hazardSort(a: HazardPoint, b: HazardPoint) {
  const byAlert = alertRank(b.alert) - alertRank(a.alert);
  if (byAlert !== 0) return byAlert;
  return (b.date || "").localeCompare(a.date || "");
}

/**
 * Coerce a coordinate-ish value, treating null/undefined/"" as absent.
 * `Number(null) === 0`, which would otherwise let empty coordinates through.
 */
function finiteCoordinate(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Turn a raw GDACS MAP (GeoJSON) payload into validated hazard points. */
export function normalizeGdacs(payload: unknown): HazardPoint[] {
  const features = (payload as { features?: unknown } | null)?.features;
  if (!Array.isArray(features)) return [];
  const points: HazardPoint[] = [];
  for (const feature of features) {
    if (!feature || typeof feature !== "object") continue;
    const geometry = (feature as { geometry?: { type?: string; coordinates?: unknown } }).geometry;
    const props = (feature as { properties?: Record<string, unknown> }).properties;
    if (!geometry || geometry.type !== "Point" || !Array.isArray(geometry.coordinates) || !props) continue;
    const [lng, lat] = geometry.coordinates as [unknown, unknown];
    const pointLat = finiteCoordinate(lat);
    const pointLng = finiteCoordinate(lng);
    if (pointLat === null || pointLng === null) continue;
    const type = String(props.eventtype ?? "").toUpperCase();
    if (!type) continue;
    // GDACS marks superseded events with iscurrent=false; skip those.
    if (String(props.iscurrent ?? "").toLowerCase() === "false") continue;
    const severityData = props.severitydata as { severity?: unknown; severitytext?: unknown } | undefined;
    const report = (props.url as { report?: unknown } | undefined)?.report;
    points.push({
      id: `${type}-${String(props.eventid ?? "")}-${String(props.episodeid ?? "")}`,
      type,
      label: hazardLabel(type),
      name: String(props.name || props.description || hazardLabel(type)),
      country: String(props.country ?? ""),
      lat: pointLat,
      lng: pointLng,
      alert: normalizeAlert(props.alertlevel),
      severity: finiteCoordinate(severityData?.severity),
      severityText: String(severityData?.severitytext ?? ""),
      date: String(props.fromdate ?? props.datemodified ?? ""),
      url: typeof report === "string" ? report : "",
    });
  }
  return points.sort(hazardSort).slice(0, 400);
}

/** Latest ISO timestamp across the hazard layer, or null when empty. */
export function hazardFreshness(hazards: HazardPoint[]): string | null {
  return hazards.reduce<string | null>((latest, point) => {
    if (!point.date) return latest;
    return !latest || point.date > latest ? point.date : latest;
  }, null);
}

/**
 * Fetch one hazard type. GDACS's MAP endpoint does NOT union repeated
 * `eventtype` params (only the first is honoured), so each type is fetched as
 * its own request. This also gives per-type partial-failure tolerance.
 */
async function fetchHazardType(type: string): Promise<HazardPoint[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(`https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP?eventtype=${type}`, {
      headers: { accept: "application/json", "user-agent": "Jarvis Research Terminal" },
      cache: "no-store",
      signal: controller.signal,
    });
    if (response.status === 404) return []; // GDACS 404s a type with no current events (e.g. VO)
    if (!response.ok) throw new Error(`GDACS returned ${response.status}`);
    return normalizeGdacs(await response.json());
  } finally {
    clearTimeout(timer);
  }
}

export const MAX_HAZARD_POINTS = 500;

/**
 * Collapse the hazard layer to one pin per event.
 *
 * GDACS repeats the same event across many features (one per storm track point
 * or wind-buffer polygon), so 200+ features can be a handful of events. The
 * item id is `TYPE-eventid-episodeid`, so this is a true de-duplication.
 */
export function dedupeHazards(points: HazardPoint[]): HazardPoint[] {
  const unique = new Map(points.map((point) => [point.id, point]));
  return [...unique.values()].sort(hazardSort).slice(0, MAX_HAZARD_POINTS);
}

/**
 * Build the full map payload. The strategic layer always returns; the hazard
 * layer fails open with an explicit failure note so the map is never blank.
 */
export async function loadRiskMap(): Promise<RiskMapData> {
  const failures: string[] = [];
  const collected: HazardPoint[] = [];
  const settled = await Promise.allSettled(HAZARD_TYPES.map((type) => fetchHazardType(type)));
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") collected.push(...result.value);
    else failures.push(`${HAZARD_TYPES[index]}: ${result.reason instanceof Error ? result.reason.message : "unavailable"}`);
  });
  const hazards = dedupeHazards(collected);
  return {
    status: hazards.length ? "live" : "stale",
    source: "GDACS HAZARD FEED · CURATED STRATEGIC LAYER",
    freshness: hazardFreshness(hazards),
    strategic: STRATEGIC_POINTS,
    hazards,
    failures,
  };
}
