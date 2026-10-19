"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { LayerGroup, Map as LeafletMap, CircleMarker } from "leaflet";
import type { HazardPoint, RiskMapData, StrategicKind, StrategicPoint } from "@/lib/risk-map";

const TILE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}";
const LABEL_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}";
const TILE_ATTR =
  'Tiles &copy; <a href="https://www.esri.com/">Esri</a> &mdash; Esri, DeLorme, NAVTEQ';

const KIND_COLOR: Record<StrategicKind, string> = { CHOKEPOINT: "#ff9840", CONFLICT: "#ff6678" };
const KIND_LABEL: Record<StrategicKind, string> = { CHOKEPOINT: "CHOKEPOINT", CONFLICT: "CONFLICT ZONE" };
const ALERT_COLOR: Record<HazardPoint["alert"], string> = { Green: "#43d4a3", Orange: "#ffb45e", Red: "#ff6678" };
const ALERT_RADIUS: Record<HazardPoint["alert"], number> = { Green: 5, Orange: 7, Red: 9 };

type KindFilter = "ALL" | StrategicKind;
const KIND_FILTERS: KindFilter[] = ["ALL", "CHOKEPOINT", "CONFLICT"];

type HazardMode = "off" | "key" | "all";
const HAZARD_MODES: HazardMode[] = ["off", "key", "all"];

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] ?? char));
}

function strategicPopup(point: StrategicPoint) {
  const color = KIND_COLOR[point.kind];
  const tags = point.exposure.map((tag) => `<i>${escapeHtml(tag)}</i>`).join("");
  return `<div class="risk-popup"><span style="color:${color}">${KIND_LABEL[point.kind]} · ${escapeHtml(point.region)}</span><strong>${escapeHtml(
    point.name,
  )}</strong><p>${escapeHtml(point.note)}</p><div class="risk-popup-tags">${tags}</div></div>`;
}

function hazardPopup(point: HazardPoint) {
  const color = ALERT_COLOR[point.alert];
  const detail = point.severityText || (point.severity != null ? `Severity ${point.severity}` : point.label);
  const when = point.date ? point.date.slice(0, 10) : "";
  const link = point.url ? `<a href="${escapeHtml(point.url)}" target="_blank" rel="noreferrer">GDACS report →</a>` : "";
  const country = point.country ? `<i>${escapeHtml(point.country)}</i>` : "";
  return `<div class="risk-popup"><span style="color:${color}">${escapeHtml(point.label.toUpperCase())} · ${point.alert.toUpperCase()}</span><strong>${escapeHtml(
    point.name,
  )}</strong><p>${escapeHtml(detail)}${when ? ` · ${escapeHtml(when)}` : ""}</p><div class="risk-popup-tags">${country}${link}</div></div>`;
}

export default function RiskMap() {
  const [data, setData] = useState<RiskMapData | null>(null);
  const [failed, setFailed] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const [showStrategic, setShowStrategic] = useState(true);
  const [hazardMode, setHazardMode] = useState<HazardMode>("key");
  const [kind, setKind] = useState<KindFilter>("ALL");
  const [selected, setSelected] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const strategicLayerRef = useRef<LayerGroup | null>(null);
  const hazardLayerRef = useRef<LayerGroup | null>(null);
  const markersRef = useRef<Record<string, CircleMarker>>({});

  useEffect(() => {
    let cancelled = false;
    fetch("/api/risk-map")
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`${response.status}`))))
      .then((payload) => {
        if (!cancelled) setData(payload as RiskMapData);
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
          scrollWheelZoom: false,
          zoomSnap: 0.5,
          minZoom: 2,
          maxZoom: 8,
          worldCopyJump: true,
          attributionControl: true,
        }).setView([24, 40], 2);
        L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 16 }).addTo(map);
        // Country/place labels sit on top of the dark base so the map stays readable.
        L.tileLayer(LABEL_URL, { maxZoom: 16, opacity: 0.9 }).addTo(map);
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
      markersRef.current = {};
    };
  }, []);

  useEffect(() => {
    if (!mapReady || !data) return;
    const map = mapRef.current;
    if (!map) return;
    import("leaflet").then((L) => {
      const strategicLayer = strategicLayerRef.current;
      const hazardLayer = hazardLayerRef.current;
      if (!strategicLayer || !hazardLayer) return;
      strategicLayer.clearLayers();
      hazardLayer.clearLayers();
      markersRef.current = {};

      if (showStrategic) {
        data.strategic
          .filter((point) => kind === "ALL" || point.kind === kind)
          .forEach((point) => {
            const color = KIND_COLOR[point.kind];
            const marker = L.circleMarker([point.lat, point.lng], {
              radius: 7,
              color,
              weight: 2,
              fillColor: color,
              fillOpacity: 0.35,
            }).bindPopup(strategicPopup(point));
            marker.addTo(strategicLayer);
            markersRef.current[point.id] = marker;
          });
      }

      if (hazardMode !== "off") {
        data.hazards
          .filter((point) => hazardMode === "all" || point.alert !== "Green")
          .forEach((point) => {
            const color = ALERT_COLOR[point.alert];
            L.circleMarker([point.lat, point.lng], {
              radius: ALERT_RADIUS[point.alert],
              color,
              weight: 1,
              dashArray: "2 2",
              fillColor: color,
              fillOpacity: 0.2,
            })
              .bindPopup(hazardPopup(point))
              .addTo(hazardLayer);
          });
      }
    });
  }, [mapReady, data, showStrategic, hazardMode, kind]);

  const counts = useMemo(() => {
    const strategic = data?.strategic ?? [];
    return {
      chokepoint: strategic.filter((point) => point.kind === "CHOKEPOINT").length,
      conflict: strategic.filter((point) => point.kind === "CONFLICT").length,
      hazards: data?.hazards.length ?? 0,
      hazardsKey: data?.hazards.filter((point) => point.alert !== "Green").length ?? 0,
    };
  }, [data]);

  const focus = (point: StrategicPoint) => {
    setSelected(point.id);
    const map = mapRef.current;
    if (!map) return;
    map.setView([point.lat, point.lng], 4, { animate: true });
    markersRef.current[point.id]?.openPopup();
  };

  const list = useMemo(() => {
    const strategic = (data?.strategic ?? []).slice();
    const rank: Record<StrategicKind, number> = { CONFLICT: 0, CHOKEPOINT: 1 };
    return strategic.sort((a, b) => rank[a.kind] - rank[b.kind] || a.name.localeCompare(b.name));
  }, [data]);

  const statusNote = failed
    ? "RISK FEED UNAVAILABLE"
    : data
      ? data.status === "live"
        ? `${counts.hazardsKey} KEY HAZARDS · ${counts.chokepoint + counts.conflict} STRATEGIC PINS`
        : "STALE · HAZARD FEED EMPTY"
      : "LOADING RISK LAYERS";

  return (
    <section className="dashboard-grid risk-grid">
      <article className="panel risk-map-panel">
        <header className="panel-head">
          <div>
            <h2>GLOBAL RISK MAP</h2>
          </div>
          <div className="risk-map-tools">
            <button className={showStrategic ? "active" : ""} onClick={() => setShowStrategic((value) => !value)}>
              STRATEGIC
            </button>
            <div className="risk-map-seg">
              <span>HAZARDS</span>
              {HAZARD_MODES.map((mode) => (
                <button key={mode} className={hazardMode === mode ? "active" : ""} onClick={() => setHazardMode(mode)}>
                  {mode === "off" ? "OFF" : mode === "key" ? "KEY" : "ALL"}
                </button>
              ))}
            </div>
          </div>
        </header>
        <div className="risk-map-stage">
          <div ref={containerRef} className="risk-map-canvas" aria-label="Geopolitical risk map with chokepoints, conflict zones and live hazard pins" />
          <div className="risk-map-legend">
            <span>
              <i style={{ background: KIND_COLOR.CHOKEPOINT }} />
              CHOKEPOINT
            </span>
            <span>
              <i style={{ background: KIND_COLOR.CONFLICT }} />
              CONFLICT ZONE
            </span>
            <span>
              <i className="hazard" style={{ background: ALERT_COLOR.Green }} />
              HAZARD · GREEN
            </span>
            <span>
              <i className="hazard" style={{ background: ALERT_COLOR.Orange }} />
              HAZARD · ORANGE
            </span>
            <span>
              <i className="hazard" style={{ background: ALERT_COLOR.Red }} />
              HAZARD · RED
            </span>
          </div>
          <div className="risk-map-filter">
            {KIND_FILTERS.map((option) => (
              <button key={option} className={kind === option ? "active" : ""} onClick={() => setKind(option)}>
                {option === "ALL" ? "ALL PINS" : KIND_LABEL[option]}
              </button>
            ))}
          </div>
          {failed && (
            <div className="risk-map-notice">
              <span>CONNECTION STATUS</span>
              <strong>RISK MAP FEED UNAVAILABLE</strong>
              <p>The map stays empty rather than plotting unverified points. Retry when the risk feed reconnects.</p>
            </div>
          )}
        </div>
        <footer className="panel-foot">
          <span>GDACS LIVE HAZARD FEED · CURATED STRATEGIC LAYER</span>
          <span>{data?.freshness ? `${counts.hazards} HAZARDS · THROUGH ${data.freshness.slice(0, 10)}` : statusNote}</span>
        </footer>
      </article>

      <article className="panel risk-list-panel">
        <header className="panel-head">
          <div>
            <h2>WATCH LIST</h2>
          </div>
          <span className="head-note">
            {counts.conflict} CONFLICT · {counts.chokepoint} CHOKEPOINT
          </span>
        </header>
        <div className="risk-list">
          {list.length === 0 && <p className="risk-list-empty">{failed ? "RISK FEED UNAVAILABLE" : "LOADING RISK LAYERS…"}</p>}
          {list.map((point) => (
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
        <footer className="panel-foot">
          <span>CLICK A LINE TO CENTRE THE MAP</span>
          <span>{mapFailed ? "MAP ENGINE UNAVAILABLE" : statusNote}</span>
        </footer>
      </article>
    </section>
  );
}
