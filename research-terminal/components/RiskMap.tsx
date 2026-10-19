"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CircleMarker, LayerGroup, Map as LeafletMap, Marker } from "leaflet";
import {
  HAZARD_FAMILIES,
  coerceRiskMapData,
  fireAlert,
  type FireCell,
  type HazardFamily,
  type HazardPoint,
  type RiskMapData,
  type StrategicKind,
  type StrategicPoint,
} from "@/lib/risk-map";

const TILE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}";
const LABEL_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}";
const TILE_ATTR = 'Tiles &copy; <a href="https://www.esri.com/">Esri</a> &mdash; Esri, DeLorme, NAVTEQ';

/* Geopolitical layer: diamonds, deliberately a different shape to the hazards. */
const KIND_COLOR: Record<StrategicKind, string> = { CHOKEPOINT: "#ff9840", CONFLICT: "#ff6678" };
const KIND_LABEL: Record<StrategicKind, string> = { CHOKEPOINT: "CHOKEPOINT", CONFLICT: "CONFLICT ZONE" };

/* Natural layer: circles, coloured by family so the filter row doubles as legend. */
const FAMILY_COLOR: Record<HazardFamily, string> = {
  QUAKE: "#b07cff",
  FIRE: "#ff5a2c",
  STORM: "#4aa8ff",
  FLOOD: "#35c9d6",
  VOLCANO: "#e0559b",
  DROUGHT: "#c9a227",
};

const ALERT_RADIUS: Record<HazardPoint["alert"], number> = { Green: 4, Orange: 6, Red: 8 };
const ALERT_FILL: Record<HazardPoint["alert"], number> = { Green: 0.16, Orange: 0.32, Red: 0.48 };

type FamilyFilter = "ALL" | HazardFamily;
const FAMILY_FILTERS: FamilyFilter[] = ["ALL", ...HAZARD_FAMILIES];
type PanelTab = "GEOPOLITICAL" | "INDONESIA";

/** Default view: Asia-Pacific, so the archipelago and the Gulf are both in frame. */
const HOME: { center: [number, number]; zoom: number } = { center: [10, 80], zoom: 2.5 };

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] ?? char));
}

function fireRadius(cell: FireCell) {
  return Math.min(20, 3 + Math.sqrt(cell.count) * 0.75);
}

function strategicPopup(point: StrategicPoint) {
  const color = KIND_COLOR[point.kind];
  const tags = point.exposure.map((tag) => `<i>${escapeHtml(tag)}</i>`).join("");
  return `<div class="risk-popup"><span style="color:${color}">${KIND_LABEL[point.kind]} · ${escapeHtml(point.region)}</span><strong>${escapeHtml(
    point.name,
  )}</strong><p>${escapeHtml(point.note)}</p><div class="risk-popup-tags">${tags}</div></div>`;
}

function hazardPopup(point: HazardPoint) {
  const color = FAMILY_COLOR[point.family];
  const detail = point.severityText || point.label;
  const when = point.date ? point.date.slice(0, 10) : "";
  const link = point.url ? `<a href="${escapeHtml(point.url)}" target="_blank" rel="noreferrer">${escapeHtml(point.source)} report →</a>` : "";
  const country = point.country ? `<i>${escapeHtml(point.country)}</i>` : "";
  return `<div class="risk-popup"><span style="color:${color}">${escapeHtml(point.label.toUpperCase())} · ${escapeHtml(
    point.source,
  )} · ${point.alert.toUpperCase()}</span><strong>${escapeHtml(point.name)}</strong><p>${escapeHtml(detail)}${when ? ` · ${escapeHtml(when)}` : ""}</p><div class="risk-popup-tags">${country}${link}</div></div>`;
}

function firePopup(cell: FireCell) {
  const color = FAMILY_COLOR.FIRE;
  return `<div class="risk-popup"><span style="color:${color}">KARHUTLA · NASA FIRMS</span><strong>${cell.count.toLocaleString('en-US')} hotspots · ${escapeHtml(
    cell.region,
  )}</strong><p>Peak ${cell.maxFrp} MW · ${cell.totalFrp.toLocaleString('en-US')} MW total${cell.date ? ` · ${escapeHtml(cell.date)}` : ""}</p><div class="risk-popup-tags"><i>1° cell</i><i>24h VIIRS</i></div></div>`;
}

export default function RiskMap() {
  const [data, setData] = useState<RiskMapData | null>(null);
  const [failed, setFailed] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const [showGeopol, setShowGeopol] = useState(true);
  const [showNatural, setShowNatural] = useState(true);
  const [family, setFamily] = useState<FamilyFilter>("ALL");
  const [tab, setTab] = useState<PanelTab>("GEOPOLITICAL");
  const [selected, setSelected] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const strategicLayerRef = useRef<LayerGroup | null>(null);
  const hazardLayerRef = useRef<LayerGroup | null>(null);
  const fireLayerRef = useRef<LayerGroup | null>(null);
  const markersRef = useRef<Record<string, Marker | CircleMarker>>({});

  useEffect(() => {
    let cancelled = false;
    fetch("/api/risk-map")
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`${response.status}`))))
      .then((payload) => {
        if (!cancelled) setData(coerceRiskMapData(payload));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    import("leaflet")
      .then((L) => {
        if (disposed || !containerRef.current || mapRef.current) return;
        const map = L.map(containerRef.current, {
          zoomControl: true,
          // Fully moveable: drag to pan; wheel, pinch, double-click and box to zoom.
          dragging: true,
          scrollWheelZoom: true,
          doubleClickZoom: true,
          touchZoom: true,
          boxZoom: true,
          keyboard: true,
          zoomSnap: 0.5,
          minZoom: 2,
          maxZoom: 8,
          worldCopyJump: true,
        }).setView(HOME.center, HOME.zoom);
        L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 16 }).addTo(map);
        // Country/place labels sit on top of the dark base so the map stays readable.
        L.tileLayer(LABEL_URL, { maxZoom: 16, opacity: 0.9 }).addTo(map);
        fireLayerRef.current = L.layerGroup().addTo(map);
        strategicLayerRef.current = L.layerGroup().addTo(map);
        hazardLayerRef.current = L.layerGroup().addTo(map);
        mapRef.current = map;
        setMapReady(true);
      })
      .catch(() => {
        if (!disposed) setMapFailed(true);
      });
    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
      strategicLayerRef.current = null;
      hazardLayerRef.current = null;
      fireLayerRef.current = null;
      markersRef.current = {};
    };
  }, []);

  useEffect(() => {
    if (!mapReady || !data) return;
    import("leaflet").then((L) => {
      const strategicLayer = strategicLayerRef.current;
      const hazardLayer = hazardLayerRef.current;
      const fireLayer = fireLayerRef.current;
      if (!strategicLayer || !hazardLayer || !fireLayer) return;
      strategicLayer.clearLayers();
      hazardLayer.clearLayers();
      fireLayer.clearLayers();
      markersRef.current = {};

      if (showGeopol) {
        data.strategic.forEach((point) => {
          const color = KIND_COLOR[point.kind];
          const marker = L.marker([point.lat, point.lng], {
            icon: L.divIcon({
              className: "risk-diamond",
              html: `<span style="background:${color}"></span>`,
              iconSize: [16, 16],
              iconAnchor: [8, 8],
              popupAnchor: [0, -8],
            }),
          }).bindPopup(strategicPopup(point));
          marker.addTo(strategicLayer);
          markersRef.current[point.id] = marker;
        });
      }

      if (showNatural) {
        // Karhutla cells first so hazard pins sit on top of the fire footprint.
        data.fires
          .filter(() => family === "ALL" || family === "FIRE")
          .forEach((cell) => {
            const color = FAMILY_COLOR.FIRE;
            const marker = L.circleMarker([cell.lat, cell.lng], {
              radius: fireRadius(cell),
              color,
              weight: 1,
              fillColor: color,
              fillOpacity: fireAlert(cell) === "Red" ? 0.4 : fireAlert(cell) === "Orange" ? 0.26 : 0.12,
            }).bindPopup(firePopup(cell));
            marker.addTo(fireLayer);
            markersRef.current[cell.id] = marker;
          });

        data.hazards
          .filter((point) => family === "ALL" || point.family === family)
          .forEach((point) => {
            const color = FAMILY_COLOR[point.family];
            const marker = L.circleMarker([point.lat, point.lng], {
              radius: ALERT_RADIUS[point.alert],
              color,
              weight: 1,
              dashArray: "2 2",
              fillColor: color,
              fillOpacity: ALERT_FILL[point.alert],
            }).bindPopup(hazardPopup(point));
            marker.addTo(hazardLayer);
            markersRef.current[point.id] = marker;
          });
      }
    });
  }, [mapReady, data, showGeopol, showNatural, family]);

  const counts = useMemo(() => {
    const strategic = data?.strategic ?? [];
    const hazards = (data?.hazards ?? []).filter((point) => family === "ALL" || point.family === family);
    const fires = family === "ALL" || family === "FIRE" ? (data?.fires ?? []).length : 0;
    return {
      chokepoint: strategic.filter((point) => point.kind === "CHOKEPOINT").length,
      conflict: strategic.filter((point) => point.kind === "CONFLICT").length,
      hazards: hazards.length,
      fires,
      hotspots: data?.karhutla?.total ?? 0,
    };
  }, [data, family]);

  const focus = (point: { id: string; lat: number; lng: number }, zoom = 4) => {
    setSelected(point.id);
    const map = mapRef.current;
    if (!map) return;
    map.setView([point.lat, point.lng], zoom, { animate: true });
    markersRef.current[point.id]?.openPopup();
  };

  const focusRegion = (name: string) => {
    const cells = (data?.fires ?? []).filter((cell) => cell.region === name);
    if (!cells.length) return;
    const total = cells.reduce((sum, cell) => sum + cell.count, 0) || 1;
    const lat = cells.reduce((sum, cell) => sum + cell.lat * cell.count, 0) / total;
    const lng = cells.reduce((sum, cell) => sum + cell.lng * cell.count, 0) / total;
    const strongest = cells.reduce((best, cell) => (cell.count > best.count ? cell : best), cells[0]);
    setSelected(strongest.id);
    mapRef.current?.setView([lat, lng], 6, { animate: true });
    markersRef.current[strongest.id]?.openPopup();
  };

  const resetView = () => {
    mapRef.current?.setView(HOME.center, HOME.zoom, { animate: true });
  };

  const strategicList = useMemo(() => {
    const rank: Record<StrategicKind, number> = { CONFLICT: 0, CHOKEPOINT: 1 };
    return (data?.strategic ?? []).slice().sort((a, b) => rank[a.kind] - rank[b.kind] || a.name.localeCompare(b.name));
  }, [data]);

  const quakes = useMemo(() => (data?.hazards ?? []).filter((point) => point.source === "BMKG"), [data]);

  const statusNote = failed
    ? "RISK FEED UNAVAILABLE"
    : data
      ? data.status === "live"
        ? `${counts.hazards} HAZARDS · ${counts.fires} FIRE CELLS`
        : "STALE · NO LIVE FEED"
      : "LOADING RISK LAYERS";

  return (
    <section className="dashboard-grid risk-grid">
      <article className="panel risk-map-panel">
        <header className="panel-head">
          <div>
            <h2>GLOBAL RISK MAP</h2>
          </div>
          <div className="risk-map-tools">
            <button className={showGeopol ? "active" : ""} onClick={() => setShowGeopol((value) => !value)}>
              GEOPOLITICAL
            </button>
            <button className={showNatural ? "active" : ""} onClick={() => setShowNatural((value) => !value)}>
              NATURAL
            </button>
          </div>
        </header>
        <div className="risk-map-stage">
          <div
            ref={containerRef}
            className="risk-map-canvas"
            aria-label="Global risk map: geopolitical chokepoints and conflict zones, Indonesian karhutla hotspots, and live natural hazards"
          />
          <div className="risk-map-legend">
            <span className="risk-legend-head">GEOPOLITICAL</span>
            <span>
              <i className="risk-sw diamond" style={{ background: KIND_COLOR.CHOKEPOINT }} />
              CHOKEPOINT
            </span>
            <span>
              <i className="risk-sw diamond" style={{ background: KIND_COLOR.CONFLICT }} />
              CONFLICT ZONE
            </span>
          </div>
          <div className="risk-map-filter">
            {FAMILY_FILTERS.map((option) => (
              <button key={option} className={family === option ? "active" : ""} onClick={() => setFamily(option)}>
                <i className="risk-sw" style={{ background: option === "ALL" ? "#778596" : FAMILY_COLOR[option as HazardFamily] }} />
                {option === "ALL" ? "ALL NATURAL" : option}
              </button>
            ))}
          </div>
          <button className="risk-map-reset" onClick={resetView} title="Reset the map view. Drag to pan, scroll or pinch to zoom.">
            ⌖ RESET VIEW
          </button>
          {failed && (
            <div className="risk-map-notice">
              <span>CONNECTION STATUS</span>
              <strong>RISK MAP FEED UNAVAILABLE</strong>
              <p>The map stays empty rather than plotting unverified points. Retry when the risk feed reconnects.</p>
            </div>
          )}
        </div>
        <footer className="panel-foot">
          <span>DRAG TO PAN · SCROLL OR PINCH TO ZOOM · GDACS · BMKG · NASA FIRMS</span>
          <span>{data?.freshness ? `${counts.hotspots.toLocaleString("en-US")} KARHUTLA HOTSPOTS · THROUGH ${data.freshness.slice(0, 10)}` : statusNote}</span>
        </footer>
      </article>

      <article className="panel risk-list-panel">
        <header className="panel-head">
          <div className="risk-tabs">
            {(["GEOPOLITICAL", "INDONESIA"] as PanelTab[]).map((option) => (
              <button key={option} className={tab === option ? "active" : ""} onClick={() => setTab(option)}>
                {option}
              </button>
            ))}
          </div>
          <span className="head-note">{tab === "GEOPOLITICAL" ? `${counts.conflict} CONFLICT · ${counts.chokepoint} CHOKEPOINT` : "ARCHIPELAGO WATCH"}</span>
        </header>

        {tab === "GEOPOLITICAL" ? (
          <div className="risk-list">
            {strategicList.length === 0 && <p className="risk-list-empty">{failed ? "RISK FEED UNAVAILABLE" : "LOADING RISK LAYERS…"}</p>}
            {strategicList.map((point) => (
              <button key={point.id} className={`risk-item ${selected === point.id ? "selected" : ""}`} onClick={() => focus(point)}>
                <span className="risk-item-kind" style={{ color: KIND_COLOR[point.kind] }}>
                  {KIND_LABEL[point.kind]}
                </span>
                <strong>{point.name}</strong>
                <small>{point.region}</small>
                <div className="risk-item-tags">
                  {point.exposure.map((tag) => (
                    <i key={tag}>{tag}</i>
                  ))}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="risk-list">
            <div className="risk-block">
              <div className="risk-block-head">
                <span>
                  <i className="risk-sw" style={{ background: FAMILY_COLOR.FIRE }} />
                  KARHUTLA · HOTSPOT WATCH
                </span>
                <b>{(data?.karhutla?.total ?? 0).toLocaleString("en-US")}</b>
              </div>
              <p className="risk-block-note">
                NASA FIRMS satellite detections over Indonesia and its haze footprint, clustered into 1° cells. Palm, timber and peat fires, and the haze that
                travels with them.
              </p>
              {(data?.karhutla?.regions ?? []).map((region) => {
                const peak = data?.karhutla?.regions[0]?.count || 1;
                return (
                  <button key={region.name} className="risk-region" onClick={() => focusRegion(region.name)}>
                    <strong>{region.name}</strong>
                    <span className="risk-region-bar">
                      <i style={{ width: `${Math.max(4, Math.round((region.count / peak) * 100))}%`, background: FAMILY_COLOR.FIRE }} />
                    </span>
                    <b>{region.count.toLocaleString("en-US")}</b>
                  </button>
                );
              })}
            </div>

            <div className="risk-block">
              <div className="risk-block-head">
                <span>
                  <i className="risk-sw" style={{ background: FAMILY_COLOR.QUAKE }} />
                  FELT EARTHQUAKES · BMKG
                </span>
                <b>{quakes.length}</b>
              </div>
              {quakes.length === 0 && <p className="risk-block-note">No felt earthquakes reported in the current BMKG window.</p>}
              {quakes.map((quake) => (
                <button key={quake.id} className={`risk-quake ${selected === quake.id ? "selected" : ""}`} onClick={() => focus(quake, 6)}>
                  <b style={{ color: FAMILY_COLOR.QUAKE }}>M {quake.severity ?? "—"}</b>
                  <span>{quake.name}</span>
                  <small>{quake.date.slice(0, 16).replace("T", " ")}</small>
                </button>
              ))}
            </div>
          </div>
        )}

        <footer className="panel-foot">
          <span>{tab === "GEOPOLITICAL" ? "CLICK A LINE TO CENTRE THE MAP" : "CLICK A REGION OR QUAKE TO CENTRE"}</span>
          <span>{mapFailed ? "MAP ENGINE UNAVAILABLE" : statusNote}</span>
        </footer>
      </article>
    </section>
  );
}
