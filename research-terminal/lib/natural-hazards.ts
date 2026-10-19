/**
 * Indonesia-focused natural-hazard reads.
 *
 * Two keyless feeds, chosen because they answer the question this desk actually
 * asks: is there a live natural hazard inside Indonesia right now?
 *
 *  - BMKG  : felt earthquakes (magnitude, depth, region). The official
 *            Indonesian source, updated continuously.
 *  - FIRMS : NASA near-real-time satellite fire/hotspot detections. This is the
 *            karhutla (land and forest fire) read, and the haze, palm, rubber
 *            and timber footprint behind it.
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
  /** Coarse region label (Sumatra, Kalimantan, ...). */
  region: string;
  /** Most recent acquisition date in the cell. */
  date: string;
};

export type KarhutlaRead = {
  /** Hotspots inside the box, before the display cap. */
  total: number;
  cells: FireCell[];
  regions: Array<{ name: string; count: number; frp: number }>;
  latest: string | null;
  /** True when more cells existed than the display cap allows. */
  truncated: boolean;
};

/** Indonesia plus the immediate neighbours that share its haze footprint. */
export const INDONESIA_BOX = { minLat: -11.5, maxLat: 8.5, minLng: 94, maxLng: 142 };

/** Grid size for clustering hotspots into display cells, in degrees. */
export const FIRE_CELL_DEGREES = 1;
/** Display cap for fire cells (the raw feed can carry 10k+ hotspots). */
export const MAX_FIRE_CELLS = 400;

const FIRMS_URLS = [
  "https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_SouthEast_Asia_24h.csv",
  "https://firms.modaps.eosdis.nasa.gov/data/active_fire/modis-c6.1/csv/MODIS_C6_1_SouthEast_Asia_24h.csv",
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

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Split one FIRMS CSV line. The feed has no quoted fields. */
function splitCsvLine(line: string) {
  return line.split(",").map((cell) => cell.trim());
}

/**
 * Parse a FIRMS active-fire CSV into clustered cells.
 *
 * The raw 24h South-East Asia file carries ~19k rows, most of them inside
 * Indonesia, so plotting each detection is not viable. Hotspots are stacked
 * into 1-degree cells and ranked, which is how a karhutla picture is normally
 * read: where are the fires dense and how hard are they burning.
 */
export function parseFirmsCsv(text: string): KarhutlaRead {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return { total: 0, cells: [], regions: [], latest: null, truncated: false };
  const header = splitCsvLine(lines[0]);
  const at = (name: string) => header.indexOf(name);
  const latAt = at("latitude");
  const lngAt = at("longitude");
  const frpAt = at("frp");
  const dateAt = at("acq_date");
  if (latAt < 0 || lngAt < 0) return { total: 0, cells: [], regions: [], latest: null, truncated: false };

  type Accum = { count: number; maxFrp: number; totalFrp: number; region: string; date: string; latSum: number; lngSum: number };
  const cells = new Map<string, Accum>();
  const regions = new Map<string, { count: number; frp: number }>();
  let total = 0;
  let latest: string | null = null;

  for (let index = 1; index < lines.length; index += 1) {
    const row = splitCsvLine(lines[index]);
    const lat = finite(row[latAt]);
    const lng = finite(row[lngAt]);
    if (lat === null || lng === null || !inIndonesiaBox(lat, lng)) continue;
    const frp = (frpAt >= 0 ? finite(row[frpAt]) : null) ?? 0;
    const date = dateAt >= 0 ? String(row[dateAt] ?? "") : "";
    total += 1;
    if (date && (!latest || date > latest)) latest = date;

    const key = `${Math.floor(lat / FIRE_CELL_DEGREES)}:${Math.floor(lng / FIRE_CELL_DEGREES)}`;
    const region = regionFor(lat, lng);
    const cell = cells.get(key);
    if (cell) {
      cell.count += 1;
      cell.maxFrp = Math.max(cell.maxFrp, frp);
      cell.totalFrp += frp;
      cell.latSum += lat;
      cell.lngSum += lng;
      if (date > cell.date) cell.date = date;
    } else {
      cells.set(key, { count: 1, maxFrp: frp, totalFrp: frp, region, date, latSum: lat, lngSum: lng });
    }
    const regionAcc = regions.get(region);
    if (regionAcc) {
      regionAcc.count += 1;
      regionAcc.frp += frp;
    } else {
      regions.set(region, { count: 1, frp });
    }
  }

  const ranked: FireCell[] = [...cells.entries()]
    .map(([key, cell]) => ({
      id: `fire-${key}`,
      lat: cell.latSum / cell.count,
      lng: cell.lngSum / cell.count,
      count: cell.count,
      maxFrp: Number(cell.maxFrp.toFixed(1)),
      totalFrp: Number(cell.totalFrp.toFixed(1)),
      region: cell.region,
      date: cell.date,
    }))
    .sort((a, b) => b.count - a.count || b.maxFrp - a.maxFrp);

  return {
    total,
    cells: ranked.slice(0, MAX_FIRE_CELLS),
    regions: [...regions.entries()]
      .map(([name, value]) => ({ name, count: value.count, frp: Number(value.frp.toFixed(1)) }))
      .sort((a, b) => b.count - a.count),
    latest,
    truncated: ranked.length > MAX_FIRE_CELLS,
  };
}

const EMPTY_KARHUTLA: KarhutlaRead = { total: 0, cells: [], regions: [], latest: null, truncated: false };

async function fetchText(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
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

/** NASA FIRMS active fires, clustered. Tries VIIRS first, then MODIS. */
export async function fetchKarhutla(): Promise<KarhutlaRead> {
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
  return EMPTY_KARHUTLA;
}

/** BMKG felt-earthquake feed. */
export async function fetchIndonesiaQuakes(): Promise<QuakeRead[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch("https://data.bmkg.go.id/DataMKG/TEWS/gempadirasakan.json", {
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
