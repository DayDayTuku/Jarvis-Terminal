import { fetchUpstream } from "./upstream.ts";
/**
 * Worldwide natural-hazard reads.
 *
 * Two keyless feeds, chosen because they answer the question this desk asks:
 * where on earth is a live natural hazard right now?
 *
 *  - BMKG  : felt earthquakes inside Indonesia (magnitude, depth, region). The
 *            official Indonesian source, updated continuously.
 *  - FIRMS : NASA near-real-time satellite fire/hotspot detections, worldwide.
 *            This is the world wildfire read. The Indonesian karhutla (land and
 *            forest fire) picture is derived from the same global file, so the
 *            archipelago detail costs no extra request.
 *
 * Both feeds fail open: an unreachable source returns an empty read rather than
 * throwing, so the map degrades instead of blanking.
 */

export type QuakeRead = {
  id: string;
  magnitude: number;
  depthKm: number | null;
  region: string;
  felt: string;
  lat: number;
  lng: number;
  date: string;
  url: string;
};

export type FireCell = {
  id: string;
  /** Cell centre. */
  lat: number;
  lng: number;
  /** Hotspots detected inside this cell in the window. */
  count: number;
  /** Strongest single detection in the cell (MW). */
  maxFrp: number;
  /** Total fire radiative power in the cell (MW). */
  totalFrp: number;
  /** Coarse world region the cell centre falls in, e.g. "AFRICA". */
  region: string;
  /** Archipelago bucket when the cell centre is inside the Indonesia box. */
  indonesiaRegion: string | null;
  /** Most recent acquisition date in the cell. */
  date: string;
};

export type FireRegion = { name: string; count: number; frp: number };

export type WildfireRead = {
  /** Hotspots detected worldwide, before the display cap. */
  total: number;
  /** Worldwide clusters, ranked by density and capped for display. */
  cells: FireCell[];
  /** Worldwide region buckets, ranked. */
  regions: FireRegion[];
  /** Hotspots inside the Indonesia box. */
  indonesiaTotal: number;
  /** Indonesian archipelago buckets, ranked. */
  indonesiaRegions: FireRegion[];
  latest: string | null;
  /** True when more cells existed than the display cap allows. */
  truncated: boolean;
};

/** Indonesia plus the immediate neighbours that share its haze footprint. */
export const INDONESIA_BOX = { minLat: -11.5, maxLat: 8.5, minLng: 94, maxLng: 142 };

/** Grid size for clustering hotspots into display cells, in degrees. */
export const FIRE_CELL_DEGREES = 1;
/** Display cap for fire cells (the raw feed can carry 60k+ hotspots). */
export const MAX_FIRE_CELLS = 500;

const FIRMS_URLS = [
  "https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_24h.csv",
  "https://firms.modaps.eosdis.nasa.gov/data/active_fire/modis-c6.1/csv/MODIS_C6_1_Global_24h.csv",
];

export function inIndonesiaBox(lat: number, lng: number) {
  return lat >= INDONESIA_BOX.minLat && lat <= INDONESIA_BOX.maxLat && lng >= INDONESIA_BOX.minLng && lng <= INDONESIA_BOX.maxLng;
}

/**
 * Coarse archipelago bucketing. The boxes are deliberately generous and
 * non-overlapping in practice; anything outside them lands in OTHER.
 */
export function regionFor(lat: number, lng: number): string {
  if (lng >= 130) return "PAPUA";
  if (lng >= 118 && lng <= 126 && lat >= -6 && lat <= 2) return "SULAWESI";
  if (lng >= 115 && lng <= 127 && lat >= -11 && lat < -8) return "NUSA TENGGARA";
  if (lng >= 108.5 && lng <= 119.5 && lat >= -4.5 && lat <= 7.5) return "KALIMANTAN";
  if (lng >= 105 && lng <= 115 && lat >= -9 && lat < -5.5) return "JAVA";
  if (lng >= 94 && lng <= 107 && lat >= -6 && lat <= 6) return "SUMATRA";
  return "OTHER";
}

/**
 * Coarse world-region bucketing for the global fire layer. Ordered checks, so
 * earlier rules win on the few boxes that overlap. This labels a dot on a map;
 * it is not a border and it is deliberately generous about the edges.
 */
export function worldRegionFor(lat: number, lng: number): string {
  if (inIndonesiaBox(lat, lng)) return "SOUTHEAST ASIA";
  if (lat >= 5 && lat <= 30 && lng >= 92 && lng <= 110) return "SOUTHEAST ASIA"; // Indochina
  if (lat < 0 && lng >= 110 && lng <= 180) return "OCEANIA"; // Australia / New Zealand
  if (lat >= 5 && lat <= 38 && lng >= 60 && lng <= 92) return "SOUTH ASIA";
  if (lat >= 12 && lat <= 45 && lng >= 34 && lng <= 63) return "MIDDLE EAST";
  if (lat >= 36 && lat <= 72 && lng >= -25 && lng <= 40) return "EUROPE";
  if (lat >= 45 && lng >= 40) return "RUSSIA & CENTRAL ASIA";
  if (lat >= -36 && lat < 37 && lng >= -20 && lng < 52) return "AFRICA";
  if (lat >= 15 && lng <= -45) return "NORTH AMERICA";
  if (lat >= 7 && lat < 15 && lng >= -120 && lng <= -60) return "CENTRAL AMERICA & CARIBBEAN";
  if (lat < 13 && lng >= -82 && lng <= -34) return "SOUTH AMERICA";
  if (lat >= 35 && lng >= 74 && lng < 150) return "EAST ASIA"; // northern China / Korea / Japan
  if (lat >= 18 && lng >= 100 && lng < 150) return "EAST ASIA";
  if (lat >= -11 && lat < 23 && lng >= 92 && lng < 141) return "SOUTHEAST ASIA";
  return "OTHER";
}

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Split one FIRMS CSV line. The feed has no quoted fields. */
function splitCsvLine(line: string) {
  return line.split(",").map((cell) => cell.trim());
}

function bump(map: Map<string, { count: number; frp: number }>, name: string, frp: number) {
  const entry = map.get(name);
  if (entry) {
    entry.count += 1;
    entry.frp += frp;
  } else {
    map.set(name, { count: 1, frp });
  }
}

function rankRegions(map: Map<string, { count: number; frp: number }>): FireRegion[] {
  return [...map.entries()]
    .map(([name, value]) => ({ name, count: value.count, frp: Number(value.frp.toFixed(1)) }))
    .sort((a, b) => b.count - a.count);
}

function emptyWildfire(): WildfireRead {
  return { total: 0, cells: [], regions: [], indonesiaTotal: 0, indonesiaRegions: [], latest: null, truncated: false };
}

/**
 * Parse a FIRMS active-fire CSV into clustered cells.
 *
 * The global 24h VIIRS file carries ~65k rows. Plotting each detection is not
 * viable, so hotspots are stacked into 1-degree cells and ranked, which is how
 * a wildfire picture is normally read: where are the fires dense and how hard
 * are they burning. The Indonesian subset is bucketed into archipelago regions
 * from the same pass, so karhutla costs no second request.
 */
export function parseFirmsCsv(text: string): WildfireRead {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return emptyWildfire();
  const header = splitCsvLine(lines[0]);
  const at = (name: string) => header.indexOf(name);
  const latAt = at("latitude");
  const lngAt = at("longitude");
  const frpAt = at("frp");
  const dateAt = at("acq_date");
  if (latAt < 0 || lngAt < 0) return emptyWildfire();

  type Accum = { count: number; maxFrp: number; totalFrp: number; date: string; latSum: number; lngSum: number };
  const cells = new Map<string, Accum>();
  const regions = new Map<string, { count: number; frp: number }>();
  const indonesiaRegions = new Map<string, { count: number; frp: number }>();
  let total = 0;
  let indonesiaTotal = 0;
  let latest: string | null = null;

  for (let index = 1; index < lines.length; index += 1) {
    const row = splitCsvLine(lines[index]);
    const lat = finite(row[latAt]);
    const lng = finite(row[lngAt]);
    if (lat === null || lng === null) continue;
    const frp = (frpAt >= 0 ? finite(row[frpAt]) : null) ?? 0;
    const date = dateAt >= 0 ? String(row[dateAt] ?? "") : "";
    total += 1;
    if (date && (!latest || date > latest)) latest = date;

    bump(regions, worldRegionFor(lat, lng), frp);
    if (inIndonesiaBox(lat, lng)) {
      indonesiaTotal += 1;
      bump(indonesiaRegions, regionFor(lat, lng), frp);
    }

    const key = `${Math.floor(lat / FIRE_CELL_DEGREES)}:${Math.floor(lng / FIRE_CELL_DEGREES)}`;
    const cell = cells.get(key);
    if (cell) {
      cell.count += 1;
      cell.maxFrp = Math.max(cell.maxFrp, frp);
      cell.totalFrp += frp;
      cell.latSum += lat;
      cell.lngSum += lng;
      if (date > cell.date) cell.date = date;
    } else {
      cells.set(key, { count: 1, maxFrp: frp, totalFrp: frp, date, latSum: lat, lngSum: lng });
    }
  }

  const ranked: FireCell[] = [...cells.entries()]
    .map(([key, cell]) => {
      // Region labels come from the plotted centre, so the pin's colour, label
      // and filter bucket always agree with where the dot actually sits.
      const lat = cell.latSum / cell.count;
      const lng = cell.lngSum / cell.count;
      return {
        id: `fire-${key}`,
        lat,
        lng,
        count: cell.count,
        maxFrp: Number(cell.maxFrp.toFixed(1)),
        totalFrp: Number(cell.totalFrp.toFixed(1)),
        region: worldRegionFor(lat, lng),
        indonesiaRegion: inIndonesiaBox(lat, lng) ? regionFor(lat, lng) : null,
        date: cell.date,
      };
    })
    .sort((a, b) => b.count - a.count || b.maxFrp - a.maxFrp);

  return {
    total,
    cells: ranked.slice(0, MAX_FIRE_CELLS),
    regions: rankRegions(regions),
    indonesiaTotal,
    indonesiaRegions: rankRegions(indonesiaRegions),
    latest,
    truncated: ranked.length > MAX_FIRE_CELLS,
  };
}

async function fetchText(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchUpstream(url, {
      headers: { accept: "text/csv,text/plain", "user-agent": "Jarvis Research Terminal" },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

/** NASA FIRMS active fires, worldwide and clustered. Tries VIIRS first, then MODIS. */
export async function fetchWildfire(): Promise<WildfireRead> {
  let lastError: unknown = null;
  for (const url of FIRMS_URLS) {
    try {
      const read = parseFirmsCsv(await fetchText(url, 20000));
      if (read.total > 0) return read;
      lastError = new Error("feed carried no detections");
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return emptyWildfire();
}

/** BMKG felt-earthquake feed. */
export async function fetchIndonesiaQuakes(): Promise<QuakeRead[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetchUpstream("https://data.bmkg.go.id/DataMKG/TEWS/gempadirasakan.json", {
      headers: { accept: "application/json", "user-agent": "Jarvis Research Terminal" },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`BMKG returned ${response.status}`);
    return parseBmkg(await response.json());
  } finally {
    clearTimeout(timer);
  }
}

/** Turn a BMKG payload into validated quake reads. */
export function parseBmkg(payload: unknown): QuakeRead[] {
  const list = (payload as { Infogempa?: { gempa?: unknown } } | null)?.Infogempa?.gempa;
  const rows = Array.isArray(list) ? list : list ? [list] : [];
  const reads: QuakeRead[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const coordinates = String(record.Coordinates ?? "").split(",");
    const lat = finite(coordinates[0]);
    const lng = finite(coordinates[1]);
    const magnitude = finite(record.Magnitude);
    if (lat === null || lng === null || magnitude === null) continue;
    const date = String(record.DateTime ?? "");
    const region = String(record.Wilayah ?? "").replace(/^Pusat gempa berada di\s*/i, "") || "Indonesia";
    reads.push({
      id: `bmkg-${date}-${lat}-${lng}`,
      magnitude,
      depthKm: finite(String(record.Kedalaman ?? "").replace(/[^\d.]/g, "")),
      region,
      felt: String(record.Dirasakan ?? ""),
      lat,
      lng,
      date,
      url: "https://www.bmkg.go.id/gempabumi/gempabumi-dirasakan.bmkg",
    });
  }
  return reads.sort((a, b) => (b.date || "").localeCompare(a.date || "") || b.magnitude - a.magnitude);
}
