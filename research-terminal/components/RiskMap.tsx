"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import type { CircleMarker, LayerGroup, Map as LeafletMap, Marker } from "leaflet";
import {
  HAZARD_FAMILIES,
  coerceRiskMapData,
  type FireRegion,
  type HazardFamily,
  type HazardPoint,
  type RiskMapData,
} from "@/lib/risk-map";
import {
  coerceNewsArticles,
  mergeMonitorEvents,
  type EventConfidence,
  type MonitorEvent,
  type MonitorLayer,
  type NewsArticle,
} from "@/lib/world-monitor";

const TILE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}";
const LABEL_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}";
const TILE_ATTR = 'Tiles &copy; <a href="https://www.esri.com/">Esri</a> &mdash; Esri, DeLorme, NAVTEQ';

const KIND_COLOR = { CHOKEPOINT: "#ff9840", CONFLICT: "#ff6678" } as const;

const FAMILY_COLOR: Record<HazardFamily, string> = {
  QUAKE: "#b07cff",
  FIRE: "#ff5a2c",
  STORM: "#4aa8ff",
  FLOOD: "#35c9d6",
  VOLCANO: "#e0559b",
  DROUGHT: "#c9a227",
};
const FAMILY_LABEL: Record<HazardFamily, string> = {
  QUAKE: "EARTHQUAKES",
  FIRE: "WILDFIRES",
  STORM: "STORMS",
  FLOOD: "FLOODS",
  VOLCANO: "VOLCANOES",
  DROUGHT: "DROUGHTS",
};

const LAYERS: Array<{ id: MonitorLayer; label: string; note: string; color: string }> = [
  { id: "NATURAL", label: "NATURAL DISASTERS", note: "GDACS + BMKG · confirmed", color: "#b07cff" },
  { id: "WILDFIRE", label: "WILDFIRES", note: "NASA FIRMS · confirmed", color: FAMILY_COLOR.FIRE },
  { id: "CONFLICT", label: "GEOPOLITICAL", note: "Static reference + news reports", color: KIND_COLOR.CONFLICT },
  { id: "CHOKEPOINT", label: "MARITIME CHOKEPOINTS", note: "Static reference · no live status", color: KIND_COLOR.CHOKEPOINT },
  { id: "INFRASTRUCTURE", label: "INFRASTRUCTURE", note: "News-derived · unverified", color: "#4aa8ff" },
  { id: "COMMODITY", label: "COMMODITY SUPPLY", note: "News-derived · unverified", color: "#c9a227" },
];

const PROVENANCE: Array<{ id: EventConfidence | "ALL"; label: string }> = [
  { id: "ALL", label: "ALL EVENTS" },
  { id: "CONFIRMED", label: "CONFIRMED" },
  { id: "NEWS-DERIVED", label: "NEWS REPORTS" },
  { id: "STATIC-REFERENCE", label: "REFERENCE" },
];

const CONFIDENCE_LABEL: Record<EventConfidence, string> = {
  CONFIRMED: "CONFIRMED FEED",
  "NEWS-DERIVED": "NEWS-DERIVED",
  "STATIC-REFERENCE": "STATIC REFERENCE",
};

const ALERT_RADIUS: Record<HazardPoint["alert"], number> = { Green: 4, Orange: 6, Red: 8 };
const ALERT_FILL: Record<HazardPoint["alert"], number> = { Green: 0.16, Orange: 0.32, Red: 0.48 };

const HOME: { center: [number, number]; zoom: number } = { center: [20, 30], zoom: 2 };

type FamilyFilter = "ALL" | HazardFamily;
type ProvenanceFilter = EventConfidence | "ALL";
type NewsPayload = { status: string; source: string; generatedAt: string; articles: NewsArticle[]; failures?: string[] };

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] ?? char));
}
function alertOf(event: MonitorEvent): HazardPoint["alert"] {
  const value = event.severity.toUpperCase();
  if (value.startsWith("RED")) return "Red";
  if (value.startsWith("ORANGE")) return "Orange";
  return "Green";
}
function when(value: string | null) {
  if (!value) return "SOURCE DID NOT PROVIDE";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 16).replace("T", " ");
  return parsed.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
}

function eventPopup(event: MonitorEvent) {
  const tags = event.industries.map((tag) => `<i>${escapeHtml(tag)}</i>`).join("");
  const link = event.url ? `<a href="${escapeHtml(event.url)}" target="_blank" rel="noreferrer">SOURCE REPORT →</a>` : "";
  const color = event.layer === "CONFLICT" ? KIND_COLOR.CONFLICT : event.layer === "CHOKEPOINT" ? KIND_COLOR.CHOKEPOINT : event.hazardFamily ? FAMILY_COLOR[event.hazardFamily] : "#4aa8ff";
  return `<div class="risk-popup"><span style="color:${color}">${escapeHtml(CONFIDENCE_LABEL[event.confidence])} · ${escapeHtml(event.category)}</span><strong>${escapeHtml(event.title)}</strong><p>${escapeHtml(event.description)}</p><div class="risk-popup-tags"><i>${escapeHtml(event.source)}</i><i>${escapeHtml(event.severity)}</i>${tags}${link}</div></div>`;
}

function eventInLayer(event: MonitorEvent, layer: MonitorLayer) {
  if (layer === "NATURAL") return event.layer === "NATURAL";
  if (layer === "WILDFIRE") return event.layer === "WILDFIRE" || (event.layer === "NATURAL" && event.hazardFamily === "FIRE");
  return event.layer === layer;
}
function eventInFamily(event: MonitorEvent, family: FamilyFilter) {
  if (family === "ALL") return true;
  if (event.layer === "NATURAL" || event.layer === "WILDFIRE") return event.hazardFamily === family;
  return true;
}
function layerCount(event: MonitorEvent, layer: MonitorLayer) {
  return eventInLayer(event, layer) ? 1 : 0;
}

/** Region bars, shared by the world and Indonesia wildfire blocks. */
function RegionBars({ regions, onSelect }: { regions: FireRegion[]; onSelect: (name: string) => void }) {
  const peak = regions[0]?.count || 1;
  return (
    <>
      {regions.map((region) => (
        <button key={region.name} type="button" className="risk-region" onClick={() => onSelect(region.name)}>
          <strong>{region.name}</strong>
          <span className="risk-region-bar">
            <i style={{ width: `${Math.max(4, Math.round((region.count / peak) * 100))}%`, background: FAMILY_COLOR.FIRE }} />
          </span>
          <b>{region.count.toLocaleString("en-US")}</b>
        </button>
      ))}
    </>
  );
}

export default function WorldMonitor() {
  const [data, setData] = useState<RiskMapData | null>(null);
  const [failed, setFailed] = useState(false);
  const [news, setNews] = useState<NewsPayload | null>(null);
  const [newsFailed, setNewsFailed] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const [layers, setLayers] = useState<MonitorLayer[]>(LAYERS.map((layer) => layer.id));
  const [family, setFamily] = useState<FamilyFilter>("ALL");
  const [provenance, setProvenance] = useState<ProvenanceFilter>("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerLayerRef = useRef<LayerGroup | null>(null);
  const markersRef = useRef<Record<string, Marker | CircleMarker>>({});

  useEffect(() => {
    let cancelled = false;
    fetch("/api/risk-map", { credentials: "same-origin" })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`${response.status}`))))
      .then((payload) => { if (!cancelled) setData(coerceRiskMapData(payload)); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/news", { credentials: "same-origin" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        const articles = coerceNewsArticles(payload);
        if (!response.ok && !articles.length) throw new Error("News feed unavailable");
        return {
          status: String(payload?.status ?? (articles.length ? "partial" : "unavailable")),
          source: String(payload?.source ?? "News feed"),
          generatedAt: String(payload?.generatedAt ?? new Date().toISOString()),
          articles,
          failures: Array.isArray(payload?.failures) ? payload.failures.map((item: unknown) => String(item)) : [],
        } satisfies NewsPayload;
      })
      .then((payload) => { if (!cancelled) setNews(payload); })
      .catch(() => { if (!cancelled) setNewsFailed(true); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let disposed = false;
    import("leaflet")
      .then((L) => {
        if (disposed || !containerRef.current || mapRef.current) return;
        const map = L.map(containerRef.current, {
          zoomControl: true,
          dragging: true,
          scrollWheelZoom: true,
          doubleClickZoom: true,
          touchZoom: true,
          boxZoom: true,
          keyboard: true,
          zoomSnap: 0.5,
          minZoom: 1,
          maxZoom: 8,
          worldCopyJump: true,
        }).setView(HOME.center, HOME.zoom);
        L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 16 }).addTo(map);
        L.tileLayer(LABEL_URL, { maxZoom: 16, opacity: 0.9 }).addTo(map);
        markerLayerRef.current = L.layerGroup().addTo(map);
        mapRef.current = map;
        setMapReady(true);
      })
      .catch(() => { if (!disposed) setMapFailed(true); });
    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markerLayerRef.current = null;
      markersRef.current = {};
    };
  }, []);

  const events = useMemo(() => {
    if (!data) return [];
    return mergeMonitorEvents({
      hazards: data.hazards,
      strategic: data.strategic,
      news: news?.articles ?? [],
      fireCells: data.wildfire?.cells ?? [],
      lastUpdated: data.freshness,
      newsUpdated: news?.generatedAt ?? null,
    });
  }, [data, news]);

  const counts = useMemo(() => {
    const result = Object.fromEntries(LAYERS.map((layer) => [layer.id, 0])) as Record<MonitorLayer, number>;
    for (const event of events) {
      for (const layer of LAYERS) result[layer.id] += layerCount(event, layer.id);
    }
    return result;
  }, [events]);

  const confidenceCounts = useMemo(() => {
    const result: Record<EventConfidence, number> = { CONFIRMED: 0, "NEWS-DERIVED": 0, "STATIC-REFERENCE": 0 };
    for (const event of events) result[event.confidence] += 1;
    return result;
  }, [events]);

  const visibleEvents = useMemo(() => {
    const rank: Record<EventConfidence, number> = { CONFIRMED: 0, "NEWS-DERIVED": 1, "STATIC-REFERENCE": 2 };
    return events
      .filter((event) => layers.some((layer) => eventInLayer(event, layer)))
      .filter((event) => eventInFamily(event, family))
      .filter((event) => provenance === "ALL" || event.confidence === provenance)
      .sort((a, b) => rank[a.confidence] - rank[b.confidence] || String(b.timestamp ?? "").localeCompare(String(a.timestamp ?? "")) || a.title.localeCompare(b.title));
  }, [events, layers, family, provenance]);

  const mapEvents = useMemo(
    () => visibleEvents.filter((event) => event.lat !== null && event.lng !== null),
    [visibleEvents],
  );

  const selected = useMemo(() => events.find((event) => event.id === selectedId) ?? null, [events, selectedId]);

  useEffect(() => {
    if (!mapReady) return;
    import("leaflet").then((L) => {
      const layer = markerLayerRef.current;
      if (!layer) return;
      layer.clearLayers();
      markersRef.current = {};
      mapEvents.forEach((event) => {
        if (event.lat === null || event.lng === null) return;
        const strategic = event.layer === "CONFLICT" || event.layer === "CHOKEPOINT";
        if (strategic) {
          const color = event.layer === "CONFLICT" ? KIND_COLOR.CONFLICT : KIND_COLOR.CHOKEPOINT;
          const marker = L.marker([event.lat, event.lng], {
            icon: L.divIcon({
              className: "risk-diamond",
              html: `<span style="background:${color}"></span>`,
              iconSize: [16, 16],
              iconAnchor: [8, 8],
              popupAnchor: [0, -8],
            }),
          }).bindPopup(eventPopup(event));
          marker.on("click", () => setSelectedId(event.id));
          marker.addTo(layer);
          markersRef.current[event.id] = marker;
          return;
        }
        const alert = alertOf(event);
        const color = event.layer === "WILDFIRE" ? FAMILY_COLOR.FIRE : event.hazardFamily ? FAMILY_COLOR[event.hazardFamily] : "#4aa8ff";
        const marker = L.circleMarker([event.lat, event.lng], {
          radius: event.layer === "WILDFIRE" ? 6 : ALERT_RADIUS[alert],
          color,
          weight: 1,
          dashArray: event.layer === "WILDFIRE" ? undefined : "2 2",
          fillColor: color,
          fillOpacity: event.layer === "WILDFIRE" ? 0.3 : ALERT_FILL[alert],
        }).bindPopup(eventPopup(event));
        marker.on("click", () => setSelectedId(event.id));
        marker.addTo(layer);
        markersRef.current[event.id] = marker;
      });
    });
  }, [mapReady, mapEvents]);

  const toggleLayer = (layer: MonitorLayer) => {
    setLayers((current) => current.includes(layer) ? current.filter((item) => item !== layer) : [...current, layer]);
  };

  const focus = (event: MonitorEvent) => {
    setSelectedId(event.id);
    if (event.lat === null || event.lng === null) return;
    const map = mapRef.current;
    if (!map) return;
    map.setView([event.lat, event.lng], event.layer === "CONFLICT" || event.layer === "CHOKEPOINT" ? 4 : 5, { animate: true });
    markersRef.current[event.id]?.openPopup();
  };

  const focusRegion = (name: string, scope: "WORLD" | "INDONESIA") => {
    const cells = (data?.wildfire?.cells ?? []).filter((cell) => (scope === "INDONESIA" ? cell.indonesiaRegion : cell.region) === name);
    if (!cells.length) return;
    const total = cells.reduce((sum, cell) => sum + cell.count, 0) || 1;
    const lat = cells.reduce((sum, cell) => sum + cell.lat * cell.count, 0) / total;
    const lng = cells.reduce((sum, cell) => sum + cell.lng * cell.count, 0) / total;
    mapRef.current?.setView([lat, lng], 6, { animate: true });
  };

  const resetView = () => mapRef.current?.setView(HOME.center, HOME.zoom, { animate: true });

  const riskStatus = failed ? "UNAVAILABLE" : data ? data.status.toUpperCase() : "LOADING";
  const newsStatus = newsFailed ? "UNAVAILABLE" : news ? news.status.toUpperCase() : "LOADING";
  const statusNote = failed
    ? "CONFIRMED HAZARD FEED UNAVAILABLE"
    : data
      ? data.status === "live"
        ? `${counts.NATURAL} HAZARD EVENTS · ${counts.WILDFIRE} WILDFIRE CELLS`
        : "STALE · CONFIRMED FEED DID NOT REFRESH"
      : "LOADING WORLD MONITOR LAYERS";
  const failures = [...(data?.failures ?? []), ...(news?.failures ?? [])];
  const quakeCount = (data?.hazards ?? []).filter((point) => point.source === "BMKG").length;

  return (
    <section className="dashboard-grid risk-grid monitor-grid">
      <article className="panel risk-map-panel monitor-map-panel">
        <header className="panel-head">
          <div>
            <h2>WORLD MONITOR</h2>
            <span className="head-note">{statusNote}</span>
          </div>
          <div className="monitor-sources">
            <span className={`monitor-source ${failed ? "unavailable" : data?.status === "live" ? "live" : "stale"}`}><i />GDACS · BMKG · FIRMS<b>{riskStatus}</b></span>
            <span className={`monitor-source ${newsFailed ? "unavailable" : news?.status === "live" ? "live" : "partial"}`}><i />GDELT / NEWS<b>{newsStatus}</b></span>
          </div>
        </header>

        <div className="monitor-controls">
          <div className="monitor-layer-chips" role="group" aria-label="World monitor layers">
            {LAYERS.map((layer) => {
              const active = layers.includes(layer.id);
              return (
                <button key={layer.id} type="button" className={active ? "active" : ""} aria-pressed={active} title={layer.note} onClick={() => toggleLayer(layer.id)}>
                  <i style={{ background: active ? layer.color : "var(--line-strong)" }} />
                  {layer.label}
                  <b>{counts[layer.id]}</b>
                </button>
              );
            })}
          </div>
          <div className="monitor-controls-foot">
            {layers.includes("NATURAL") || layers.includes("WILDFIRE") ? (
              <div className="monitor-family-chips" role="group" aria-label="Natural hazard family">
                <button type="button" className={family === "ALL" ? "active" : ""} onClick={() => setFamily("ALL")}>ALL NATURAL</button>
                {HAZARD_FAMILIES.map((item) => (
                  <button key={item} type="button" className={family === item ? "active" : ""} onClick={() => setFamily(item)}>{FAMILY_LABEL[item]}</button>
                ))}
              </div>
            ) : <span className="monitor-hint">Natural family filters are available when a natural layer is on.</span>}
            <button type="button" className="monitor-reset" onClick={resetView} title="Reset the map view. Drag to pan, scroll or pinch to zoom.">⌖ RESET VIEW</button>
          </div>
        </div>

        <div className="risk-map-stage">
          <div
            ref={containerRef}
            className="risk-map-canvas monitor-map-canvas"
            aria-label="World Monitor map: confirmed natural hazards and wildfires, static chokepoints and conflict descriptors, plus map events filtered by layer"
          />
          <div className="risk-map-legend">
            <span className="risk-legend-head">PROVENANCE</span>
            <span><i className="risk-sw diamond" style={{ background: KIND_COLOR.CHOKEPOINT }} />STATIC REFERENCE</span>
            <span><i className="risk-sw" style={{ background: FAMILY_COLOR.QUAKE }} />CONFIRMED HAZARD</span>
            <span><i className="risk-sw" style={{ background: FAMILY_COLOR.FIRE }} />CONFIRMED FIRE CELL</span>
            <span className="monitor-legend-note">NEWS REPORTS ARE LIST-ONLY · NO VERIFIED COORDINATES</span>
          </div>
          {failed && (
            <div className="risk-map-notice">
              <span>CONNECTION STATUS</span>
              <strong>CONFIRMED HAZARD FEED UNAVAILABLE</strong>
              <p>The map stays empty rather than plotting unverified points. Static references and news reports remain visible in the event list.</p>
            </div>
          )}
        </div>

        <footer className="panel-foot">
          <span>DRAG TO PAN · SCROLL OR PINCH TO ZOOM · NO LIVE CHOKEPOINT STATUS IS CLAIMED</span>
          <span>
            {data?.freshness
              ? `${(data.wildfire?.total ?? 0).toLocaleString("en-US")} WILDFIRE HOTSPOTS${data.wildfire?.truncated ? " · TOP CELLS SHOWN" : ""} · THROUGH ${data.freshness.slice(0, 10)}`
              : statusNote}
          </span>
        </footer>
      </article>

      <article className="panel monitor-panel">
        <header className="panel-head">
          <div><h2>EVENT DETAIL</h2></div>
          <span className="head-note">{selected ? CONFIDENCE_LABEL[selected.confidence] : "SELECT AN EVENT"}</span>
        </header>

        {selected ? (
          <section className="monitor-detail" aria-live="polite">
            <span className={`monitor-badge ${selected.confidence.toLowerCase()}`}>{CONFIDENCE_LABEL[selected.confidence]}</span>
            <h3>{selected.title}</h3>
            <p className="monitor-detail-location">{selected.location}</p>
            <dl className="monitor-facts">
              <div><dt>CATEGORY</dt><dd>{selected.category}</dd></div>
              <div><dt>SEVERITY</dt><dd>{selected.severity}</dd></div>
              <div><dt>SOURCE</dt><dd>{selected.source}</dd></div>
              <div><dt>TIMESTAMP</dt><dd>{when(selected.timestamp)}</dd></div>
              <div><dt>LAST UPDATED</dt><dd>{when(selected.lastUpdated)}</dd></div>
              <div><dt>CONFIDENCE</dt><dd>{CONFIDENCE_LABEL[selected.confidence]}</dd></div>
            </dl>
            <p className="monitor-detail-description">{selected.description}</p>
            <div className="monitor-industries">
              <span>AFFECTED INDUSTRIES</span>
              {selected.industries.length
                ? <div>{selected.industries.map((industry) => <i key={industry}>{industry}</i>)}</div>
                : <p>{selected.industryNote}</p>}
              {selected.industries.length > 0 && <small>{selected.industryNote}</small>}
            </div>
            <p className="monitor-provenance-note">{selected.provenanceNote}</p>
            {selected.url && <a className="monitor-source-link" href={selected.url} target="_blank" rel="noreferrer">OPEN SOURCE REPORT →</a>}
            {selected.lat === null && <p className="monitor-unplotted">NOT PLOTTED · SOURCE DID NOT PROVIDE VERIFIED COORDINATES</p>}
          </section>
        ) : (
          <section className="monitor-detail monitor-detail-empty">
            <span className="monitor-badge static-reference">THREE PROVENANCE CLASSES</span>
            <h3>Confirmed, reported, or reference — never mixed.</h3>
            <ul>
              <li><b>CONFIRMED</b> Official GDACS, BMKG and NASA FIRMS feeds with coordinates.</li>
              <li><b>NEWS-DERIVED</b> GDELT/Google News headlines. No verified coordinates, so list-only.</li>
              <li><b>STATIC REFERENCE</b> Curated chokepoints and conflict descriptors. Not live event status.</li>
            </ul>
            <p>Select a map marker or list event to inspect its source, timestamps, confidence and modelled industry exposure.</p>
          </section>
        )}

        <div className="monitor-list-head">
          <div className="monitor-provenance-tabs" role="group" aria-label="Event provenance filter">
            {PROVENANCE.map((item) => (
              <button key={item.id} type="button" className={provenance === item.id ? "active" : ""} onClick={() => setProvenance(item.id)}>{item.label}</button>
            ))}
          </div>
          <span>{visibleEvents.length} EVENTS</span>
        </div>

        <div className="monitor-list">
          {failures.length > 0 && (
            <div className="monitor-warning">
              <strong>PARTIAL SOURCE COVERAGE</strong>
              <span>{failures.slice(0, 6).join(" · ")}</span>
            </div>
          )}
          {layers.includes("WILDFIRE") && (data?.wildfire?.regions.length ?? 0) > 0 && (
            <details className="monitor-regions">
              <summary>WILDFIRE REGIONS · NASA FIRMS</summary>
              <span className="monitor-region-head">WORLD · {data?.wildfire?.total.toLocaleString("en-US")} HOTSPOTS</span>
              <RegionBars regions={data?.wildfire?.regions ?? []} onSelect={(name) => focusRegion(name, "WORLD")} />
              <span className="monitor-region-head">KARHUTLA · INDONESIA · {data?.wildfire?.indonesiaTotal.toLocaleString("en-US")}</span>
              <RegionBars regions={data?.wildfire?.indonesiaRegions ?? []} onSelect={(name) => focusRegion(name, "INDONESIA")} />
              <small>{quakeCount} felt BMKG earthquakes are also in the event list on the CONFIRMED tab.</small>
            </details>
          )}

          {visibleEvents.length === 0 && (
            <p className="monitor-list-empty">
              {layers.length === 0
                ? "All layers are hidden. Turn on a layer to see events."
                : failed && provenance !== "STATIC-REFERENCE"
                  ? "Confirmed feed unavailable. Reference and news layers may still be available."
                  : "No events match this layer and provenance filter."}
            </p>
          )}

          {visibleEvents.slice(0, 80).map((event) => (
            <button
              key={event.id}
              type="button"
              className={`monitor-event ${selectedId === event.id ? "selected" : ""}`}
              onClick={() => focus(event)}
            >
              <span className={`monitor-evidence ${event.confidence.toLowerCase()}`}>{CONFIDENCE_LABEL[event.confidence]}</span>
              <strong>{event.title}</strong>
              <small>{event.location}</small>
              <div className="monitor-event-meta">
                <span>{event.category}</span>
                <span>{event.severity}</span>
                <span>{event.source}</span>
              </div>
            </button>
          ))}
          {visibleEvents.length > 80 && <p className="monitor-list-empty">SHOWING FIRST 80 OF {visibleEvents.length} EVENTS · NARROW THE LAYER OR PROVENANCE FILTER</p>}
        </div>

        <footer className="panel-foot">
          <span>{mapFailed ? "MAP ENGINE UNAVAILABLE · LIST STILL ACTIVE" : `${confidenceCounts.CONFIRMED} CONFIRMED · ${confidenceCounts["NEWS-DERIVED"]} REPORTS · ${confidenceCounts["STATIC-REFERENCE"]} REFERENCE`}</span>
          <span>{news ? news.source.toUpperCase() : newsFailed ? "NEWS FEED OFFLINE" : "LOADING NEWS FEED"}</span>
        </footer>
      </article>
    </section>
  );
}
