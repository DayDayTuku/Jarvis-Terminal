"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  BASIS_META,
  QUADRANT_META,
  QUANTAMENTAL_FAIR_BAND,
  SECTOR_PROFILE_META,
  median,
  symlogFraction,
  type QuantamentalBasis,
  type QuantamentalLiquidity,
  type QuantamentalMap,
  type QuantamentalQuadrant,
  type QuantamentalStock,
  type QuantamentalChange,
  type ValuationMetric,
} from "../lib/quantamental";

type Props = { onSelectStock?: (ticker: string) => void };

type Rect = { x1: number; y1: number; x2: number; y2: number };

type Payload = QuantamentalMap & {
  error?: string;
  cached?: boolean;
  snapshotSaved?: boolean | null;
  snapshotError?: string | null;
  historyAvailable?: boolean;
  selectedDate?: string;
  refreshError?: string;
};

const W = 1060;
const H = 560;
const M = { top: 56, right: 54, bottom: 58, left: 70 };
const PLOT_W = W - M.left - M.right;
const PLOT_H = H - M.top - M.bottom;
const PLOT_BOTTOM = M.top + PLOT_H;

const X_TICKS = [-50, -20, -10, -5, 0, 5, 10, 20, 50];
const Y_TICKS = [0, 20, 40, 60, 80, 100];

const TONE_COLOR = {
  positive: "var(--positive)",
  negative: "var(--negative)",
  blue: "var(--blue)",
  muted: "var(--qm-muted)",
} as const;

const QUADRANT_FILL = {
  "re-rating": "#43d4a314",
  "priced-in": "#48a6ff12",
  "value-trap": "#ff667812",
  "de-rating": "#ff66780e",
  improving: "#43d4a30a",
  drifting: "#77859608",
} as const;

const CORE_QUADRANTS: Array<Exclude<QuantamentalQuadrant, "no-momentum" | "no-valuation" | "improving" | "drifting">> = [
  "re-rating",
  "priced-in",
  "value-trap",
  "de-rating",
];

type FilterState = {
  sector: string;
  basis: string;
  liquidity: "all" | QuantamentalLiquidity;
};

function gapX(gap: number) {
  // Positive gap means cheaper than peers, so it sits on the left.
  return M.left + ((1 - symlogFraction(gap)) / 2) * PLOT_W;
}

function scoreY(score: number) {
  const clamped = Math.max(0, Math.min(100, score));
  return PLOT_BOTTOM - (clamped / 100) * PLOT_H;
}

function bubbleRadius(marketCap: number | null, min: number, max: number) {
  if (marketCap === null || marketCap <= 0) return 5;
  if (!(max > min)) return 8;
  const t = (Math.log10(marketCap) - Math.log10(min)) / (Math.log10(max) - Math.log10(min));
  return 4 + Math.max(0, Math.min(1, t)) * 11;
}

function signed(value: number, places = 2) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(places)}`;
}

function formatCap(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  if (value >= 1e12) return `IDR ${(value / 1e12).toFixed(1)}T`;
  if (value >= 1e9) return `IDR ${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `IDR ${(value / 1e6).toFixed(0)}M`;
  return `IDR ${Math.round(value)}`;
}

function formatTurnover(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "UNKNOWN";
  if (value >= 1e12) return `IDR ${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `IDR ${(value / 1e9).toFixed(1)}B`;
  return `IDR ${(value / 1e6).toFixed(0)}M`;
}

function metricText(stock: QuantamentalStock) {
  if (stock.metric === null) return "—";
  if (stock.basis === "pb_roe") return `${stock.metric.toFixed(2)} per ROE pt`;
  if (stock.basis === "pb") return `${stock.metric.toFixed(2)}×`;
  return `${stock.metric.toFixed(1)}×`;
}

function valueText(metric: ValuationMetric) {
  if (metric.value === null) return metric.providerReady ? "NO FEED" : "—";
  if (metric.unit === "%") return `${metric.value.toFixed(2)}%`;
  return `${metric.value.toFixed(2)}×`;
}

function timestamp(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  })} WIB`;
}

function shortDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  });
}

function BasisMark({ basis, color = "var(--qm-muted, #8b98a8)", size = 11 }: {
  basis: QuantamentalBasis;
  color?: string;
  size?: number;
}) {
  const h = size / 2;
  const shape = BASIS_META[basis].shape;
  if (shape === "circle") {
    return <svg width={size} height={size} aria-hidden="true"><circle cx={h} cy={h} r={h - 1} fill={color} /></svg>;
  }
  if (shape === "diamond") {
    return <svg width={size} height={size} aria-hidden="true"><polygon points={`${h},1 ${size - 1},${h} ${h},${size - 1} 1,${h}`} fill={color} /></svg>;
  }
  if (shape === "triangle") {
    return <svg width={size} height={size} aria-hidden="true"><polygon points={`${h},1 ${size - 1},${size - 1} 1,${size - 1}`} fill={color} /></svg>;
  }
  if (shape === "square") {
    return <svg width={size} height={size} aria-hidden="true"><rect x={1} y={1} width={size - 2} height={size - 2} fill={color} /></svg>;
  }
  return <span aria-hidden="true">—</span>;
}

function BubbleShape({ shape, cx, cy, r, fill, outline }: {
  shape: "circle" | "diamond" | "triangle" | "square" | "none";
  cx: number;
  cy: number;
  r: number;
  fill: string;
  outline?: string | null;
}) {
  const stroke = outline ?? fill;
  const strokeWidth = outline ? 2 : 1.2;
  if (shape === "diamond") {
    return <polygon points={`${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`} fill={fill} fillOpacity={0.62} stroke={stroke} strokeWidth={strokeWidth} />;
  }
  if (shape === "triangle") {
    return <polygon points={`${cx},${cy - r * 1.15} ${cx + r},${cy + r * 0.8} ${cx - r},${cy + r * 0.8}`} fill={fill} fillOpacity={0.62} stroke={stroke} strokeWidth={strokeWidth} />;
  }
  if (shape === "square") {
    return <rect x={cx - r} y={cy - r} width={r * 2} height={r * 2} fill={fill} fillOpacity={0.62} stroke={stroke} strokeWidth={strokeWidth} />;
  }
  return <circle cx={cx} cy={cy} r={r} fill={fill} fillOpacity={0.62} stroke={stroke} strokeWidth={strokeWidth} />;
}

function revisionColor(stock: QuantamentalStock): string | null {
  if (stock.revisionDirection === "up") return "var(--positive)";
  if (stock.revisionDirection === "down") return "var(--negative)";
  if (stock.revisionDirection === "flat") return "var(--qm-muted, #8b98a8)";
  return null;
}

function changeText(change: QuantamentalChange) {
  if (change.delta === null) return "NO PRIOR";
  const value = change.unit === "x" ? change.delta.toFixed(2) : change.delta.toFixed(2);
  return `${change.delta >= 0 ? "+" : ""}${value}${change.unit === "pp" ? "pp" : change.unit === "x" ? "×" : ""}`;
}

function ScoreBlock({ stock }: { stock: QuantamentalStock }) {
  const score = stock.momentumScore;
  return (
    <div className="qm-score">
      <div className="qm-score-head">
        <div>
          <span>FUNDAMENTAL MOMENTUM</span>
          <strong className={score.score === null ? "muted" : score.score >= 50 ? "positive" : "negative"}>
            {score.score === null ? "—" : Math.round(score.score)}
          </strong>
          <small>/100</small>
        </div>
        <div className="qm-score-meta">
          <span>{score.confidence.toUpperCase()} CONFIDENCE</span>
          <span>{Math.round(score.coverage * 100)}% WEIGHT</span>
          <span>{SECTOR_PROFILE_META[score.sectorProfile].label} MODEL</span>
        </div>
      </div>
      <div className="qm-score-track" aria-hidden="true">
        <i style={{ width: `${score.score ?? 0}%` }} className={score.score === null ? "" : score.score >= 50 ? "positive" : "negative"} />
        <b style={{ left: "50%" }} />
      </div>
      <div className="qm-components">
        {score.components.map((component) => (
          <div className={`qm-component${component.status === "unavailable" ? " unavailable" : ""}`} key={component.key}>
            <div className="qm-component-head">
              <span>{component.label}</span>
              <b>{component.value === null ? "N/A" : `${component.value >= 0 ? "+" : ""}${component.value}${component.unit === "pp" ? "pp" : component.unit === "ratio" ? "%" : "%"}`}</b>
              <small>{component.weight}%</small>
            </div>
            <div className="qm-component-track">
              <i style={{ width: `${component.score ?? 0}%` }} />
            </div>
            <div className="qm-component-foot">
              <span>SCORE {component.score === null ? "—" : Math.round(component.score)}</span>
              <span>CONTRIB {component.contribution === null ? "—" : component.contribution.toFixed(1)}</span>
            </div>
            <p>{component.detail}</p>
          </div>
        ))}
      </div>
      <p className="qm-score-note">{score.notes[0]}</p>
    </div>
  );
}

function ValuationBlock({ stock }: { stock: QuantamentalStock }) {
  return (
    <div className="qm-valuation">
      <div className="qm-block-head"><span>VALUATION ENGINE</span><b>{BASIS_META[stock.basis].short}</b></div>
      <dl className="qm-primary">
        <div><dt>METRIC</dt><dd>{metricText(stock)}</dd></div>
        <div><dt>PEER MEDIAN</dt><dd>{stock.peerMedian === null ? "—" : metricText({ ...stock, metric: stock.peerMedian })}</dd></div>
        <div><dt>PEER COUNT</dt><dd>{stock.peerCount || "—"}</dd></div>
        <div><dt>VALUATION GAP</dt><dd className={stock.gap === null ? "" : stock.gap >= 0 ? "positive" : "negative"}>{stock.gap === null ? "—" : `${signed(stock.gap)}%`}</dd></div>
        <div><dt>OWN-HISTORY PCTL</dt><dd>{stock.valuationPercentile === null ? "INSUFFICIENT" : `${stock.valuationPercentile.toFixed(0)}th`}</dd></div>
        <div><dt>OBSERVATIONS</dt><dd>{stock.historyObservations || "—"}</dd></div>
      </dl>
      <div className="qm-metrics">
        {stock.valuation.map((metric) => (
          <div key={metric.key} className={metric.value === null ? "unavailable" : ""}>
            <span>{metric.label}</span>
            <b>{valueText(metric)}</b>
            <small>{metric.value === null ? metric.period : `${metric.period}${metric.peerMedian === null ? "" : ` · peer ${metric.peerMedian}×`}`}</small>
          </div>
        ))}
      </div>
      <p className="qm-fine">P/E trailing and forward, P/BV, EV/EBITDA and EV/EBIT are shown only when their inputs exist. NAV discount is provider-ready: no holdings feed is connected, so it is not estimated.</p>
    </div>
  );
}

function PriceBlock({ stock }: { stock: QuantamentalStock }) {
  const liquidityLabel = stock.liquidity === "thin"
    ? "THIN"
    : stock.liquidity === "unknown"
      ? "UNKNOWN"
      : "LIQUID";
  return (
    <div className="qm-price-block">
      <div className="qm-block-head"><span>PRICE &amp; LIQUIDITY</span><b className={`qm-liq-${stock.liquidity}`}>{liquidityLabel}</b></div>
      <dl>
        <div><dt>PRICE MOMENTUM 6M</dt><dd className={stock.priceMomentum === null ? "" : stock.priceMomentum >= 0 ? "positive" : "negative"}>{stock.priceMomentum === null ? "NO SIGNAL" : `${signed(stock.priceMomentum)}%`}</dd></div>
        <div><dt>MOMENTUM BASIS</dt><dd>{stock.momentumBasis ?? "—"}</dd></div>
        <div><dt>DAY CHANGE</dt><dd className={stock.change === null ? "" : stock.change >= 0 ? "positive" : "negative"}>{stock.change === null ? "—" : `${signed(stock.change)}%`}</dd></div>
        <div><dt>MARKET CAP</dt><dd>{formatCap(stock.marketCap)}</dd></div>
        <div><dt>10D TURNOVER</dt><dd>{formatTurnover(stock.turnover)}</dd></div>
        <div><dt>REVISION</dt><dd>{stock.revisionDirection ? stock.revisionDirection.toUpperCase() : "NO HISTORY"}</dd></div>
      </dl>
      <p className="qm-fine">Price momentum is deliberately outside the score. Revision direction needs at least two stored estimate snapshots; until then it is not inferred.</p>
    </div>
  );
}

export default function QuantamentalMap({ onSelectStock }: Props) {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [showMethod, setShowMethod] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [drag, setDrag] = useState<Rect | null>(null);
  const [region, setRegion] = useState<Rect | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [filters, setFilters] = useState<FilterState>({ sector: "all", basis: "all", liquidity: "all" });
  const [tab, setTab] = useState<"score" | "valuation" | "peers" | "changes">("score");
  const svgRef = useRef<SVGSVGElement | null>(null);
  const clipId = `qm-clip-${useId().replace(/[:]/g, "")}`;

  const load = useCallback(async (options: { date?: string; refresh?: boolean } = {}) => {
    const isRefresh = options.refresh === true;
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (options.date) params.set("date", options.date);
      if (isRefresh) params.set("refresh", "1");
      const response = await fetch(`/api/quantamental${params.size ? `?${params.toString()}` : ""}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null) as Payload | null;
      if (!response.ok || !payload || !Array.isArray(payload.stocks)) {
        setError(payload?.error ?? "The quantamental map is unavailable right now.");
        return;
      }
      setData(payload);
      setSelectedDate(payload.selectedDate ?? options.date ?? "");
      if (isRefresh) setNotice("REFRESHED FROM THE SCANNER");
    } catch {
      setError("The quantamental map could not be reached. No estimated values are shown.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!fullscreen) return;
    const prior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prior; };
  }, [fullscreen]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (fullscreen) setFullscreen(false);
      else if (showMethod) setShowMethod(false);
      else if (region) setRegion(null);
      else if (selectMode) setSelectMode(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen, showMethod, region, selectMode]);

  const filteredStocks = useMemo(() => {
    const stocks = data?.stocks ?? [];
    return stocks.filter((stock) => {
      if (filters.sector !== "all" && stock.sector !== filters.sector) return false;
      if (filters.basis !== "all" && stock.basis !== filters.basis) return false;
      if (filters.liquidity !== "all" && stock.liquidity !== filters.liquidity) return false;
      return true;
    });
  }, [data, filters]);

  const plottedStocks = useMemo(
    () => filteredStocks.filter((stock) => stock.gap !== null && stock.fundamentalScore !== null),
    [filteredStocks],
  );

  const noScoreStocks = useMemo(
    () => filteredStocks.filter((stock) => stock.gap !== null && stock.fundamentalScore === null),
    [filteredStocks],
  );

  const noValuationStocks = useMemo(
    () => filteredStocks.filter((stock) => stock.gap === null),
    [filteredStocks],
  );

  const sectors = useMemo(
    () => [...new Set((data?.stocks ?? []).map((stock) => stock.sector))].sort(),
    [data],
  );

  const capRange = useMemo(() => {
    const caps = plottedStocks
      .map((stock) => stock.marketCap)
      .filter((value): value is number => value !== null && value > 0);
    return {
      min: caps.length ? Math.min(...caps) : 1,
      max: caps.length ? Math.max(...caps) : 1,
    };
  }, [plottedStocks]);

  const labelled = useMemo(() => {
    return new Set(
      [...plottedStocks]
        .sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0))
        .slice(0, 10)
        .map((stock) => stock.ticker),
    );
  }, [plottedStocks]);

  const activeStock = useMemo(() => {
    const ticker = hovered ?? selected;
    if (!ticker || !data) return null;
    return data.stocks.find((stock) => stock.ticker === ticker) ?? null;
  }, [data, hovered, selected]);

  const visibleQuadrantCounts = useMemo(() => {
    const counts: Record<string, number> = {
      "re-rating": 0,
      "priced-in": 0,
      "value-trap": 0,
      "de-rating": 0,
      improving: 0,
      drifting: 0,
    };
    for (const stock of plottedStocks) counts[stock.quadrant] = (counts[stock.quadrant] ?? 0) + 1;
    return counts;
  }, [plottedStocks]);

  const regionStocks = useMemo(() => {
    if (!region) return [];
    const left = Math.min(region.x1, region.x2);
    const right = Math.max(region.x1, region.x2);
    const top = Math.min(region.y1, region.y2);
    const bottom = Math.max(region.y1, region.y2);
    return plottedStocks.filter((stock) => {
      const x = gapX(stock.gap as number);
      const y = scoreY(stock.fundamentalScore as number);
      return x >= left && x <= right && y >= top && y <= bottom;
    });
  }, [plottedStocks, region]);

  const regionMedianGap = useMemo(
    () => median(regionStocks.map((stock) => stock.gap as number)),
    [regionStocks],
  );
  const regionMedianScore = useMemo(
    () => median(regionStocks.map((stock) => stock.fundamentalScore as number)),
    [regionStocks],
  );

  const chartPoint = (event: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const box = svg.getBoundingClientRect();
    if (!box.width || !box.height) return null;
    return {
      x: ((event.clientX - box.left) / box.width) * W,
      y: ((event.clientY - box.top) / box.height) * H,
    };
  };

  const startRegion = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!selectMode) return;
    const point = chartPoint(event);
    if (!point) return;
    if (point.x < M.left || point.x > M.left + PLOT_W || point.y < M.top || point.y > PLOT_BOTTOM) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ x1: point.x, y1: point.y, x2: point.x, y2: point.y });
  };

  const moveRegion = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    const point = chartPoint(event);
    if (!point) return;
    setDrag({
      ...drag,
      x2: Math.max(M.left, Math.min(M.left + PLOT_W, point.x)),
      y2: Math.max(M.top, Math.min(PLOT_BOTTOM, point.y)),
    });
  };

  const endRegion = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const left = Math.min(drag.x1, drag.x2);
    const right = Math.max(drag.x1, drag.x2);
    const top = Math.min(drag.y1, drag.y2);
    const bottom = Math.max(drag.y1, drag.y2);
    setRegion(right - left < 8 || bottom - top < 8 ? null : drag);
    setDrag(null);
  };

  const capture = async () => {
    const svg = svgRef.current;
    if (!svg) return;
    try {
      const computed = getComputedStyle(svg);
      const clone = svg.cloneNode(true) as SVGSVGElement;
      for (const token of [
        "--qm-canvas", "--qm-grid", "--qm-grid-strong", "--qm-axis", "--qm-label",
        "--qm-muted", "--qm-point", "--qm-ink", "--positive", "--negative", "--blue", "--orange",
      ]) {
        const value = computed.getPropertyValue(token).trim();
        if (value) clone.style.setProperty(token, value);
      }
      const source = new XMLSerializer().serializeToString(clone);
      const url = URL.createObjectURL(new Blob([source], { type: "image/svg+xml;charset=utf-8" }));
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("SVG failed to load"));
        image.src = url;
      });
      const scale = 2;
      const canvas = document.createElement("canvas");
      canvas.width = W * scale;
      canvas.height = H * scale;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas unavailable");
      context.fillStyle = computed.getPropertyValue("--qm-canvas").trim() || "#050505";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      const link = document.createElement("a");
      link.href = canvas.toDataURL("image/png");
      link.download = `jarvis-quantamental-${new Date().toISOString().slice(0, 10)}.png`;
      link.click();
      setNotice("MAP CAPTURED");
    } catch {
      setNotice("CAPTURE FAILED");
    }
  };

  if (loading && !data) {
    return (
      <section className="panel qm-panel" aria-busy="true">
        <header className="panel-head qm-head">
          <div><h2>QUANTAMENTAL STOCK MAP</h2></div>
          <span className="head-note">LOADING SCANNER</span>
        </header>
        <div className="qm-state">
          <strong>BUILDING THE MAP</strong>
          <p>Fetching valuation, statements and estimates for the IDX universe in one scanner request.</p>
        </div>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="panel qm-panel">
        <header className="panel-head qm-head">
          <div><h2>QUANTAMENTAL STOCK MAP</h2></div>
          <span className="head-note">FEED OFFLINE</span>
        </header>
        <div className="qm-state">
          <strong>MAP UNAVAILABLE</strong>
          <p>{error ?? "No scanner data was returned, so no estimated points are shown."}</p>
          <button type="button" className="quiet-button" onClick={() => void load({ refresh: true })}>RETRY</button>
        </div>
      </section>
    );
  }

  const centreX = gapX(0);
  const cheapEdge = gapX(QUANTAMENTAL_FAIR_BAND);
  const richEdge = gapX(-QUANTAMENTAL_FAIR_BAND);
  const midY = scoreY(50);
  const statusLabel = data.status === "live" ? "LIVE" : data.status === "partial" ? "PARTIAL" : "STALE";
  const historyDates = data.historyDates ?? [];

  const quadrants = [
    { key: "re-rating" as const, x: M.left, y: M.top, width: centreX - M.left, height: midY - M.top, labelX: M.left + 12, labelY: M.top + 19, anchor: "start" as const },
    { key: "priced-in" as const, x: centreX, y: M.top, width: M.left + PLOT_W - centreX, height: midY - M.top, labelX: M.left + PLOT_W - 12, labelY: M.top + 19, anchor: "end" as const },
    { key: "value-trap" as const, x: M.left, y: midY, width: centreX - M.left, height: PLOT_BOTTOM - midY, labelX: M.left + 12, labelY: PLOT_BOTTOM - 30, anchor: "start" as const },
    { key: "de-rating" as const, x: centreX, y: midY, width: M.left + PLOT_W - centreX, height: PLOT_BOTTOM - midY, labelX: M.left + PLOT_W - 12, labelY: PLOT_BOTTOM - 30, anchor: "end" as const },
  ];

  return (
    <section className={`panel qm-panel${fullscreen ? " qm-fullscreen" : ""}`}>
      <header className="panel-head qm-head">
        <div>
          <h2>QUANTAMENTAL STOCK MAP</h2>
          <p className="qm-subtitle">
            {data.plotted} stocks · peer-relative valuation vs fundamental momentum
          </p>
        </div>
        <div className="qm-actions">
          <button type="button" onClick={() => void load({ refresh: true })} disabled={refreshing}>
            {refreshing ? "REFRESHING" : "REFRESH"}
          </button>
          <button type="button" className={showKey ? "active" : ""} aria-pressed={showKey} onClick={() => setShowKey((value) => !value)}>KEY</button>
          <button type="button" className={showMethod ? "active" : ""} aria-pressed={showMethod} onClick={() => setShowMethod((value) => !value)}>ABOUT</button>
          <button type="button" className={selectMode ? "active" : ""} aria-pressed={selectMode} onClick={() => { setSelectMode((value) => !value); setRegion(null); }}>SELECT REGION</button>
          <button type="button" className={fullscreen ? "active" : ""} aria-pressed={fullscreen} onClick={() => setFullscreen((value) => !value)}>{fullscreen ? "EXIT FULL" : "FULL SCREEN"}</button>
          <button type="button" onClick={() => void capture()}>CAPTURE</button>
        </div>
      </header>

      <div className="qm-meta">
        <span
          className={`qm-status qm-status-${data.status}`}
          title={
            data.status === "partial"
              ? "The scanner omitted or failed to populate one or more universe names. Missing names are not filled or estimated."
              : data.status === "stale"
                ? data.selectedDate
                  ? "A stored snapshot is shown. It is not live and is labelled as such."
                  : "The last successful scan is shown because the refresh failed. Values are not mixed with new data."
                : "The scanner returned the full requested universe."
          }
        >
          {data.selectedDate ? `SNAPSHOT ${data.selectedDate}` : statusLabel}
        </span>
        <span>{data.universeSize} names in universe</span>
        <span>{data.coverage.fundamentalScore} with a score</span>
        <span>{data.coverage.fundamentals} with a peer gap</span>
        <span>{data.coverage.forwardEstimates} with forward EPS</span>
        <span>{data.coverage.statements} with statements</span>
        <span className={data.status === "stale" ? "qm-warn-text" : "qm-meta-right"}>
          RETRIEVED {timestamp(data.asOf)}
        </span>
        <span className="qm-meta-right">LATEST DISCLOSURE {shortDate(data.dataAsOf)}</span>
      </div>

      {error && data && (
        <div className="qm-banner" role="alert">
          <strong>REQUEST FAILED</strong>
          <span>{error}</span>
          <span>The previously loaded map is still shown; it has not been relabelled as live.</span>
        </div>
      )}

      {(data.status === "stale" || data.snapshotError || data.refreshError) && (
        <div className="qm-banner" role="status">
          <strong>{data.selectedDate ? "HISTORICAL SNAPSHOT" : "STALE DATA"}</strong>
          <span>
            {data.selectedDate
              ? "This map is reconstructed from a stored point-in-time snapshot. It is not the current screen."
              : data.refreshError
                ? `Refresh failed: ${data.refreshError}. The last successful map is shown.`
                : "The last successful map is shown because the latest refresh failed."}
          </span>
          {data.snapshotError && <span>Snapshot store: {data.snapshotError}</span>}
        </div>
      )}

      {notice && <div className="qm-notice" role="status" aria-live="polite">{notice}</div>}

      <div className="qm-filters">
        <label>
          <span>SECTOR</span>
          <select value={filters.sector} onChange={(event) => setFilters({ ...filters, sector: event.target.value })}>
            <option value="all">All sectors</option>
            {sectors.map((sector) => <option key={sector} value={sector}>{sector}</option>)}
          </select>
        </label>
        <label>
          <span>VALUATION BASIS</span>
          <select value={filters.basis} onChange={(event) => setFilters({ ...filters, basis: event.target.value })}>
            <option value="all">All bases</option>
            {(Object.keys(BASIS_META) as QuantamentalBasis[]).filter((basis) => basis !== "none").map((basis) => (
              <option key={basis} value={basis}>{BASIS_META[basis].short}</option>
            ))}
          </select>
        </label>
        <label>
          <span>LIQUIDITY</span>
          <select value={filters.liquidity} onChange={(event) => setFilters({ ...filters, liquidity: event.target.value as FilterState["liquidity"] })}>
            <option value="all">All liquidity</option>
            <option value="liquid">Liquid only</option>
            <option value="thin">Thin only</option>
            <option value="unknown">Unknown only</option>
          </select>
        </label>
        <label>
          <span>AS OF</span>
          <select
            value={selectedDate}
            onChange={(event) => {
              const date = event.target.value;
              setSelectedDate(date);
              void load(date ? { date } : { refresh: true });
            }}
          >
            <option value="">Live scan</option>
            {historyDates.map((date) => <option key={date} value={date}>Snapshot {date}</option>)}
          </select>
        </label>
        <div className="qm-filter-note">
          {plottedStocks.length} of {data.plotted} plotted · {filters.sector === "all" && filters.basis === "all" && filters.liquidity === "all" ? "unfiltered" : "filtered"}
        </div>
      </div>

      <div className="qm-body">
        <div className="qm-chart-col">
          <div className="qm-chart-scroll">
            <div className="qm-chart-hint">
              {selectMode
                ? "DRAG A BOX ON THE MAP TO SUMMARISE A REGION · ESC TO CANCEL"
                : "POINT AT A STOCK TO READ IT · CLICK TO PIN · TAB TO MOVE BETWEEN NAMES"}
            </div>
            <svg
              ref={svgRef}
              viewBox={`0 0 ${W} ${H}`}
              className="qm-svg"
              style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
              role="group"
              aria-label={`Quantamental stock map. ${data.plotted} stocks plotted by peer-relative valuation and fundamental momentum score. ${data.noMomentum} have no fundamental score and ${data.noValuation} have no comparable valuation gap.`}
              onPointerDown={startRegion}
              onPointerMove={moveRegion}
              onPointerUp={endRegion}
              onPointerCancel={endRegion}
            >
              <defs>
                <clipPath id={clipId}>
                  <rect x={M.left} y={M.top} width={PLOT_W} height={PLOT_H} />
                </clipPath>
              </defs>

              <rect x={0} y={0} width={W} height={H} fill="var(--qm-canvas, #050505)" />

              <g pointerEvents="none">
                {quadrants.map((quadrant) => {
                  const meta = QUADRANT_META[quadrant.key];
                  return (
                    <g key={quadrant.key}>
                      <rect x={quadrant.x} y={quadrant.y} width={Math.max(0, quadrant.width)} height={Math.max(0, quadrant.height)} fill={QUADRANT_FILL[quadrant.key]} />
                      <text x={quadrant.labelX} y={quadrant.labelY} textAnchor={quadrant.anchor} fontSize={9} letterSpacing={1.05} fill={TONE_COLOR[meta.tone]} opacity={0.95}>
                        {meta.label}
                      </text>
                      <text x={quadrant.labelX} y={quadrant.labelY + 13} textAnchor={quadrant.anchor} fontSize={8} fill="var(--qm-label, #6f7d8d)">
                        {visibleQuadrantCounts[quadrant.key] ?? 0} STOCKS
                      </text>
                    </g>
                  );
                })}
                <rect x={richEdge} y={M.top} width={Math.max(0, cheapEdge - richEdge)} height={PLOT_H} fill="var(--qm-muted, #5f6d7d)" fillOpacity={0.05} />
              </g>

              <g pointerEvents="none">
                {X_TICKS.map((tick) => (
                  <g key={`x-${tick}`}>
                    <line
                      x1={gapX(tick)}
                      x2={gapX(tick)}
                      y1={M.top}
                      y2={PLOT_BOTTOM}
                      stroke={tick === 0 ? "var(--qm-grid-strong, #33404f)" : "var(--qm-grid, #19212a)"}
                      strokeDasharray={tick === 0 ? "4 4" : undefined}
                    />
                    <text x={gapX(tick)} y={PLOT_BOTTOM + 18} textAnchor="middle" fontSize={8} fill="var(--qm-axis, #778596)">
                      {tick === 0 ? "0" : `${tick > 0 ? "+" : ""}${tick}%`}
                    </text>
                  </g>
                ))}
                {Y_TICKS.map((tick) => (
                  <g key={`y-${tick}`}>
                    <line
                      y1={scoreY(tick)}
                      y2={scoreY(tick)}
                      x1={M.left}
                      x2={M.left + PLOT_W}
                      stroke={tick === 50 ? "var(--qm-grid-strong, #33404f)" : "var(--qm-grid, #19212a)"}
                      strokeDasharray={tick === 50 ? "4 4" : undefined}
                    />
                    <text x={M.left - 9} y={scoreY(tick) + 3} textAnchor="end" fontSize={8} fill="var(--qm-axis, #778596)">
                      {tick}
                    </text>
                  </g>
                ))}
              </g>

              <g pointerEvents="none">
                {[-QUANTAMENTAL_FAIR_BAND, QUANTAMENTAL_FAIR_BAND].map((tick) => (
                  <line key={tick} x1={gapX(-tick)} x2={gapX(-tick)} y1={M.top} y2={PLOT_BOTTOM} stroke="var(--qm-grid-strong, #2b3745)" strokeDasharray="2 4" />
                ))}
                <line x1={M.left} x2={M.left + PLOT_W} y1={midY} y2={midY} stroke="var(--qm-grid-strong, #3a4654)" strokeDasharray="4 4" />
                <text x={M.left + PLOT_W / 2} y={M.top - 16} textAnchor="middle" fontSize={8} letterSpacing={1} fill="var(--qm-muted, #5f6d7d)">
                  SIZE = MARKET CAP · SHAPE = VALUATION BASIS · FADE = LIQUIDITY · OUTLINE = REVISION
                </text>
                <text x={M.left + PLOT_W / 2} y={H - 17} textAnchor="middle" fontSize={8} letterSpacing={1} fill="var(--qm-axis, #778596)">
                  PEER-RELATIVE VALUATION GAP · CHEAPER ← → RICHER
                </text>
                <text
                  x={17}
                  y={M.top + PLOT_H / 2}
                  transform={`rotate(-90 17 ${M.top + PLOT_H / 2})`}
                  textAnchor="middle"
                  fontSize={8}
                  letterSpacing={1}
                  fill="var(--qm-axis, #778596)"
                >
                  FUNDAMENTAL MOMENTUM SCORE
                </text>
                <text x={M.left - 12} y={M.top + 3} textAnchor="end" fontSize={7} fill="var(--qm-muted, #5c6878)">100</text>
                <text x={M.left - 12} y={midY - 3} textAnchor="end" fontSize={7} fill="var(--qm-muted, #5c6878)">50</text>
                <text x={M.left - 12} y={PLOT_BOTTOM + 3} textAnchor="end" fontSize={7} fill="var(--qm-muted, #5c6878)">0</text>
              </g>

              <g clipPath={`url(#${clipId})`}>
                {plottedStocks.map((stock) => {
                  const gx = gapX(stock.gap as number);
                  const gy = scoreY(stock.fundamentalScore as number);
                  const radius = bubbleRadius(stock.marketCap, capRange.min, capRange.max);
                  const meta = QUADRANT_META[stock.quadrant];
                  const color = TONE_COLOR[meta.tone];
                  const isActive = activeStock?.ticker === stock.ticker;
                  const shape = BASIS_META[stock.basis].shape;
                  const opacity = stock.liquidity === "thin" ? 0.42 : stock.liquidity === "unknown" ? 0.72 : 1;
                  return (
                    <g
                      key={stock.ticker}
                      className={`qm-point${isActive ? " qm-point-active" : ""}`}
                      tabIndex={0}
                      role="button"
                      aria-label={`${stock.ticker}, ${meta.label}, valuation gap ${stock.gap} percent, fundamental score ${stock.fundamentalScore} out of 100`}
                      style={{ cursor: "pointer", opacity }}
                      onPointerEnter={() => setHovered(stock.ticker)}
                      onPointerLeave={() => setHovered(null)}
                      onFocus={() => setHovered(stock.ticker)}
                      onBlur={() => setHovered(null)}
                      onClick={() => { setSelected(stock.ticker); setTab("score"); }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelected(stock.ticker);
                          setTab("score");
                        }
                      }}
                    >
                      <circle cx={gx} cy={gy} r={Math.max(12, radius + 4)} fill="transparent" />
                      <BubbleShape shape={shape} cx={gx} cy={gy} r={radius} fill={color} outline={revisionColor(stock)} />
                      {isActive && <circle cx={gx} cy={gy} r={radius + 4} fill="none" stroke="var(--qm-ink, #e8edf3)" strokeWidth={1.1} />}
                      {(stock.offScaleX || stock.offScaleY) && (
                        <text x={gx} y={gy - radius - 3} textAnchor="middle" fontSize={8} fill="var(--orange, #ff9840)" pointerEvents="none">▲</text>
                      )}
                    </g>
                  );
                })}
              </g>

              <g pointerEvents="none">
                {plottedStocks
                  .filter((stock) => labelled.has(stock.ticker) || activeStock?.ticker === stock.ticker)
                  .map((stock) => {
                    const gx = gapX(stock.gap as number);
                    const gy = scoreY(stock.fundamentalScore as number);
                    const radius = bubbleRadius(stock.marketCap, capRange.min, capRange.max);
                    const rightSide = gx < M.left + PLOT_W * 0.7;
                    const isActive = activeStock?.ticker === stock.ticker;
                    return (
                      <text
                        key={`label-${stock.ticker}`}
                        x={rightSide ? gx + radius + 5 : gx - radius - 5}
                        y={gy + 3}
                        textAnchor={rightSide ? "start" : "end"}
                        fontSize={8.5}
                        fill={isActive ? "var(--qm-ink, #e8edf3)" : "var(--qm-point, #aab6c4)"}
                      >
                        {stock.ticker}
                      </text>
                    );
                  })}
              </g>

              {selectMode && (
                <rect x={M.left} y={M.top} width={PLOT_W} height={PLOT_H} fill="transparent" style={{ cursor: "crosshair" }} />
              )}

              {(drag ?? region) && (() => {
                const box = drag ?? region;
                if (!box) return null;
                return (
                  <rect
                    x={Math.min(box.x1, box.x2)}
                    y={Math.min(box.y1, box.y2)}
                    width={Math.abs(box.x2 - box.x1)}
                    height={Math.abs(box.y2 - box.y1)}
                    fill="var(--blue, #48a6ff)"
                    fillOpacity={0.08}
                    stroke="var(--blue, #48a6ff)"
                    strokeDasharray="4 3"
                    pointerEvents="none"
                  />
                );
              })()}
            </svg>
          </div>
          {region && (
            <div className="qm-region-card">
              <div><span>SELECTED REGION</span><strong>{regionStocks.length} STOCKS</strong></div>
              <p>{regionStocks.length ? regionStocks.map((stock) => stock.ticker).join(" · ") : "No plotted stocks in this box."}</p>
              {regionStocks.length > 0 && (
                <small>
                  MEDIAN VALUATION GAP {regionMedianGap === null ? "—" : `${signed(regionMedianGap)}%`}
                  {" · "}
                  MEDIAN FUNDAMENTAL SCORE {regionMedianScore === null ? "—" : regionMedianScore.toFixed(0)}
                </small>
              )}
              <button type="button" onClick={() => setRegion(null)}>CLEAR</button>
            </div>
          )}
        </div>

        <aside className="qm-rail">
          <div className="qm-readout" aria-live="polite">
            {activeStock ? (
              <>
                <div className="qm-readout-head">
                  <div><strong>{activeStock.ticker}</strong><span>{activeStock.name}</span></div>
                  <b className={`qm-tone-${QUADRANT_META[activeStock.quadrant].tone}`}>{QUADRANT_META[activeStock.quadrant].label}</b>
                </div>
                <small className="qm-sector">
                  {activeStock.sector}
                  {activeStock.industry ? ` · ${activeStock.industry}` : activeStock.tvSector ? ` · ${activeStock.tvSector}` : ""}
                  {activeStock.nearMedian ? " · NEAR PEER MEDIAN" : ""}
                </small>

                <div className="qm-tabs" role="tablist" aria-label="Stock detail sections">
                  {(["score", "valuation", "peers", "changes"] as const).map((key) => (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={tab === key}
                      className={tab === key ? "active" : ""}
                      onClick={() => setTab(key)}
                    >
                      {key === "score" ? "SCORE" : key === "valuation" ? "VALUATION" : key === "peers" ? "PEERS" : "CHANGES"}
                    </button>
                  ))}
                </div>

                {tab === "score" && (
                  <>
                    <ScoreBlock stock={activeStock} />
                    <PriceBlock stock={activeStock} />
                  </>
                )}

                {tab === "valuation" && <ValuationBlock stock={activeStock} />}

                {tab === "peers" && (
                  <div className="qm-peers">
                    <div className="qm-block-head"><span>PEER COMPARISON</span><b>{BASIS_META[activeStock.basis].short}</b></div>
                    {activeStock.peers.length ? (
                      <div className="qm-peer-list">
                        {activeStock.peers.map((ticker) => {
                          const peer = data.stocks.find((stock) => stock.ticker === ticker);
                          if (!peer) return null;
                          return (
                            <button
                              key={ticker}
                              type="button"
                              className={ticker === activeStock.ticker ? "active" : ""}
                              onClick={() => setSelected(ticker)}
                            >
                              <strong>{ticker}</strong>
                              <span>{peer.metric === null ? "—" : metricText(peer)}</span>
                              <span className={peer.gap === null ? "" : peer.gap >= 0 ? "positive" : "negative"}>{peer.gap === null ? "—" : `${signed(peer.gap)}%`}</span>
                              <span>{peer.fundamentalScore === null ? "—" : Math.round(peer.fundamentalScore)}</span>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="qm-fine">No same-sector peers share this valuation basis. The median falls back to the cross-sector sample and is labelled as such.</p>
                    )}
                    <p className="qm-fine">
                      Columns: ticker · metric · valuation gap · fundamental score. Peer count for this basis: {activeStock.peerCount || "—"}.
                    </p>
                  </div>
                )}

                {tab === "changes" && (
                  <div className="qm-changes">
                    <div className="qm-block-head"><span>WHAT CHANGED?</span><b>{activeStock.whatChanged.length ? "VS PRIOR SNAPSHOT" : "NO PRIOR SNAPSHOT"}</b></div>
                    {activeStock.whatChanged.length ? (
                      <div className="qm-change-list">
                        {activeStock.whatChanged.map((change) => (
                          <div key={change.label}>
                            <span>{change.label}</span>
                            <b>{change.current === null ? "—" : change.unit === "x" ? `${change.current.toFixed(2)}×` : change.unit === "percent" ? `${change.current.toFixed(2)}%` : change.current.toFixed(1)}</b>
                            <i className={change.delta === null ? "" : change.delta >= 0 ? "positive" : "negative"}>{changeText(change)}</i>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="qm-fine">No stored prior snapshot for this ticker. Changes appear after the first two stored scans; nothing is inferred.</p>
                    )}
                    <div className="qm-reasons">
                      <span>WHY THIS CLASSIFICATION</span>
                      <ul>{activeStock.classificationReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
                    </div>
                  </div>
                )}

                <button type="button" className="primary-button qm-open" onClick={() => onSelectStock?.(activeStock.ticker)}>OPEN STOCK DETAIL</button>
              </>
            ) : (
              <div className="qm-readout-empty">
                <strong>POINT AT A STOCK TO READ IT</strong>
                <p>Click a bubble to pin the analyst readout: score breakdown, valuation, peers and changes. Shape is the valuation basis; faded bubbles are thin; the outline is the estimate-revision direction.</p>
              </div>
            )}
          </div>

          {showKey && (
            <div className="qm-key">
              <span>KEY</span>
              {(Object.keys(BASIS_META) as QuantamentalBasis[]).filter((basis) => basis !== "none").map((basis) => (
                <div key={basis}><BasisMark basis={basis} /><span>{BASIS_META[basis].short}</span><small>{BASIS_META[basis].label}</small></div>
              ))}
              <div className="qm-key-quads">
                {CORE_QUADRANTS.map((key) => (
                  <p key={key}><i style={{ background: TONE_COLOR[QUADRANT_META[key].tone] }} />{QUADRANT_META[key].label}<b>{visibleQuadrantCounts[key] ?? 0}</b></p>
                ))}
              </div>
              <div className="qm-key-notes">
                <span><i className="ring up" />OUTLINE UP · estimate revision positive</span>
                <span><i className="ring down" />OUTLINE DOWN · estimate revision negative</span>
                <span><i className="dot thin" />FADED · thin turnover under IDR 5bn</span>
                <span><i className="dot unknown" />LIGHTER · liquidity unknown</span>
              </div>
            </div>
          )}

          {showMethod && (
            <div className="qm-method">
              <span>ABOUT THIS MAP</span>
              <p>{data.methodology}</p>
              <p>Snapshot store: {data.historyAvailable ? `${historyDates.length} stored dates` : "not configured or empty"}. Percentiles and revisions need history and show as unavailable until it exists.</p>
            </div>
          )}

          {noScoreStocks.length > 0 && (
            <div className="qm-unplotted">
              <span>NO FUNDAMENTAL SCORE · {noScoreStocks.length}</span>
              <p>{noScoreStocks.map((stock) => stock.ticker).join(" · ")}</p>
              <small>These names have a valuation gap but fewer than two statement components or under 50% weight coverage. They are not assigned a zero and are not plotted on the score axis.</small>
            </div>
          )}

          {noValuationStocks.length > 0 && (
            <div className="qm-unplotted">
              <span>NO COMPARABLE GAP · {noValuationStocks.length}</span>
              <p>{noValuationStocks.map((stock) => `${stock.ticker}${stock.basis === "none" ? "" : ` (${BASIS_META[stock.basis].short})`}`).join(" · ")}</p>
              <small>These names are not plotted because no peer-relative gap could be computed: either the scanner had no P/E, P/S or P/B input, or fewer than three names shared that basis. They are not assigned a zero.</small>
            </div>
          )}

          {data.changeSummary && (data.changeSummary.improved + data.changeSummary.deteriorated) > 0 && (
            <div className="qm-whatchanged">
              <span>WHAT CHANGED ACROSS THE MAP</span>
              <p>
                {data.changeSummary.improved} improved · {data.changeSummary.deteriorated} deteriorated · {data.changeSummary.unchanged} unchanged · {data.changeSummary.unavailable} without a prior snapshot.
              </p>
            </div>
          )}
        </aside>
      </div>

      <footer className="panel-foot qm-foot">
        <span>X = PEER-RELATIVE VALUATION GAP · POSITIVE MEANS CHEAPER · Y = FUNDAMENTAL MOMENTUM SCORE 0–100</span>
        <span>{data.coverage.both} PLOTTED · {data.noMomentum} NO SCORE · {data.noValuation} NO GAP</span>
      </footer>
    </section>
  );
}
