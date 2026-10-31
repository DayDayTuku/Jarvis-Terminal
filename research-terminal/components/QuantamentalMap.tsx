"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  BASIS_META,
  QUADRANT_META,
  QUANTAMENTAL_MOMENTUM_MAX,
  QUANTAMENTAL_MOMENTUM_MIN,
  median,
  symlogFraction,
  type QuantamentalBasis,
  type QuantamentalMap,
  type QuantamentalStock,
} from "../lib/quantamental";

type Props = { onSelectStock?: (ticker: string) => void };

type Rect = { x1: number; y1: number; x2: number; y2: number };

const W = 1060;
const H = 580;
const M = { top: 58, right: 252, bottom: 58, left: 66 };
const PLOT_W = W - M.left - M.right;
const PLOT_H = H - M.top - M.bottom;
const PLOT_BOTTOM = M.top + PLOT_H;
const STRIP_X = W - M.right + 20;
const STRIP_W = W - STRIP_X - 12;

const X_TICKS = [-50, -20, -10, -5, -2, 0, 2, 5, 10, 20, 50];
const Y_TICKS = [-50, -25, 0, 25, 50, 100, 150, 200];

const TONE_COLOR = {
  positive: "var(--positive)",
  negative: "var(--negative)",
  blue: "var(--blue)",
  muted: "var(--qm-muted)",
} as const;

const QUADRANT_FILL = {
  "re-rating": "#43d4a312",
  "value-trap": "#ff667810",
  "priced-in": "#48a6ff0d",
  "de-rating": "#ff66780d",
  improving: "#43d4a30a",
  drifting: "#77859608",
} as const;

function gapX(gap: number) {
  // Positive gap means cheaper than peers, so it sits on the left.
  return M.left + ((1 - symlogFraction(gap)) / 2) * PLOT_W;
}

function momentumY(momentum: number) {
  const clamped = Math.max(
    QUANTAMENTAL_MOMENTUM_MIN,
    Math.min(QUANTAMENTAL_MOMENTUM_MAX, momentum),
  );
  const fraction = (clamped - QUANTAMENTAL_MOMENTUM_MIN)
    / (QUANTAMENTAL_MOMENTUM_MAX - QUANTAMENTAL_MOMENTUM_MIN);
  return PLOT_BOTTOM - fraction * PLOT_H;
}

function bubbleRadius(marketCap: number | null, min: number, max: number) {
  if (marketCap === null || marketCap <= 0) return 5;
  if (!(max > min)) return 8;
  const t = (Math.log10(marketCap) - Math.log10(min)) / (Math.log10(max) - Math.log10(min));
  return 4 + Math.max(0, Math.min(1, t)) * 10;
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
  if (value === null || !Number.isFinite(value)) return "—";
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

function BubbleShape({ shape, cx, cy, r, fill }: {
  shape: "circle" | "diamond" | "triangle" | "square" | "none";
  cx: number;
  cy: number;
  r: number;
  fill: string;
}) {
  if (shape === "diamond") {
    return <polygon points={`${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`} fill={fill} fillOpacity={0.62} stroke={fill} strokeWidth={1.2} />;
  }
  if (shape === "triangle") {
    return <polygon points={`${cx},${cy - r * 1.15} ${cx + r},${cy + r * 0.8} ${cx - r},${cy + r * 0.8}`} fill={fill} fillOpacity={0.62} stroke={fill} strokeWidth={1.2} />;
  }
  if (shape === "square") {
    return <rect x={cx - r} y={cy - r} width={r * 2} height={r * 2} fill={fill} fillOpacity={0.62} stroke={fill} strokeWidth={1.2} />;
  }
  return <circle cx={cx} cy={cy} r={r} fill={fill} fillOpacity={0.62} stroke={fill} strokeWidth={1.2} />;
}

export default function QuantamentalMap({ onSelectStock }: Props) {
  const [data, setData] = useState<QuantamentalMap | null>(null);
  const [loading, setLoading] = useState(true);
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
  const svgRef = useRef<SVGSVGElement | null>(null);
  const clipId = `qm-clip-${useId().replace(/[:]/g, "")}`;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/quantamental", { credentials: "same-origin" });
      const payload = await response.json().catch(() => null) as (QuantamentalMap & { error?: string }) | null;
      if (!response.ok || !payload || !Array.isArray(payload.stocks)) {
        setError(payload?.error ?? "The quantamental map is unavailable right now.");
        return;
      }
      setData(payload);
    } catch {
      setError("The quantamental map could not be reached. No estimated values are shown.");
    } finally {
      setLoading(false);
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

  const plottedStocks = useMemo(
    () => (data?.stocks ?? []).filter((stock) => stock.gap !== null && stock.momentum !== null),
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
        .slice(0, 6)
        .map((stock) => stock.ticker),
    );
  }, [plottedStocks]);

  const noMomentumStocks = useMemo(
    () => (data?.stocks ?? []).filter((stock) => stock.gap !== null && stock.momentum === null),
    [data],
  );

  const noValuationStocks = useMemo(
    () => (data?.stocks ?? []).filter((stock) => stock.gap === null),
    [data],
  );

  const activeStock = useMemo(() => {
    const ticker = hovered ?? selected;
    if (!ticker || !data) return null;
    return data.stocks.find((stock) => stock.ticker === ticker) ?? null;
  }, [data, hovered, selected]);

  const regionStocks = useMemo(() => {
    if (!region) return [];
    const left = Math.min(region.x1, region.x2);
    const right = Math.max(region.x1, region.x2);
    const top = Math.min(region.y1, region.y2);
    const bottom = Math.max(region.y1, region.y2);
    return plottedStocks.filter((stock) => {
      const x = gapX(stock.gap as number);
      const y = momentumY(stock.momentum as number);
      return x >= left && x <= right && y >= top && y <= bottom;
    });
  }, [plottedStocks, region]);

  const regionMedianGap = useMemo(
    () => median(regionStocks.map((stock) => stock.gap as number)),
    [regionStocks],
  );
  const regionMedianMomentum = useMemo(
    () => median(regionStocks.map((stock) => stock.momentum as number)),
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
        "--qm-canvas",
        "--qm-grid",
        "--qm-grid-strong",
        "--qm-axis",
        "--qm-label",
        "--qm-muted",
        "--qm-point",
        "--qm-ink",
        "--qm-strip",
        "--qm-strip-line",
        "--positive",
        "--negative",
        "--blue",
        "--orange",
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

  const statusLabel = data
    ? data.status === "live"
      ? "LIVE"
      : data.status === "partial"
        ? "PARTIAL"
        : "STALE"
    : "UNAVAILABLE";

  if (loading) {
    return (
      <section className="panel qm-panel" aria-busy="true">
        <header className="panel-head qm-head">
          <div><h2>QUANTAMENTAL STOCK MAP</h2></div>
          <span className="head-note">LOADING SCANNER</span>
        </header>
        <div className="qm-state">
          <strong>BUILDING THE MAP</strong>
          <p>Fetching valuation and momentum for the IDX universe in one scanner request.</p>
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
          <button type="button" className="quiet-button" onClick={() => void load()}>RETRY</button>
        </div>
      </section>
    );
  }

  const zeroY = momentumY(0);
  const cheapEdge = gapX(5);
  const richEdge = gapX(-5);

  const quadrants = [
    { key: "re-rating" as const, x: M.left, y: M.top, width: cheapEdge - M.left, height: zeroY - M.top, labelX: M.left + 12, labelY: M.top + 20, anchor: "start" as const },
    { key: "value-trap" as const, x: M.left, y: zeroY, width: cheapEdge - M.left, height: PLOT_BOTTOM - zeroY, labelX: M.left + 12, labelY: PLOT_BOTTOM - 30, anchor: "start" as const },
    { key: "improving" as const, x: cheapEdge, y: M.top, width: richEdge - cheapEdge, height: zeroY - M.top, labelX: (cheapEdge + richEdge) / 2, labelY: M.top + 20, anchor: "middle" as const },
    { key: "drifting" as const, x: cheapEdge, y: zeroY, width: richEdge - cheapEdge, height: PLOT_BOTTOM - zeroY, labelX: (cheapEdge + richEdge) / 2, labelY: PLOT_BOTTOM - 30, anchor: "middle" as const },
    { key: "priced-in" as const, x: richEdge, y: M.top, width: M.left + PLOT_W - richEdge, height: zeroY - M.top, labelX: M.left + PLOT_W - 12, labelY: M.top + 20, anchor: "end" as const },
    { key: "de-rating" as const, x: richEdge, y: zeroY, width: M.left + PLOT_W - richEdge, height: PLOT_BOTTOM - zeroY, labelX: M.left + PLOT_W - 12, labelY: PLOT_BOTTOM - 30, anchor: "end" as const },
  ];

  return (
    <section className={`panel qm-panel${fullscreen ? " qm-fullscreen" : ""}`}>
      <header className="panel-head qm-head">
        <div>
          <h2>QUANTAMENTAL STOCK MAP</h2>
          <p className="qm-subtitle">
            {data.plotted} stocks on the map · peer-relative valuation vs price momentum
          </p>
        </div>
        <div className="qm-actions">
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
              ? "The scanner omitted one or more universe names. Missing names are not filled or estimated."
              : data.status === "stale"
                ? "The last successful scan is shown because the refresh failed. Values are not mixed with new data."
                : "The scanner returned the full requested universe."
          }
        >
          {statusLabel}
        </span>
        <span>{data.universeSize} names in universe</span>
        <span>{data.coverage.fundamentals} with a peer gap</span>
        <span>{data.coverage.momentum} with momentum</span>
        <span>{data.noMomentum} in the no-momentum strip</span>
        <span>{data.noValuation} without a comparable gap</span>
        <span className="qm-meta-right">{new Date(data.asOf).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" })} WIB</span>
      </div>

      {notice && <div className="qm-notice" role="status" aria-live="polite">{notice}</div>}

      <div className="qm-body">
        <div className="qm-chart-col">
          <div className="qm-chart-scroll">
            <div className="qm-chart-hint">
              {selectMode
                ? "DRAG A BOX ON THE MAP TO SUMMARISE A REGION · ESC TO CANCEL"
                : "POINT AT A STOCK TO READ IT · CLICK TO PIN THE READOUT · TAB TO MOVE BETWEEN NAMES"}
            </div>
            <svg
              ref={svgRef}
              viewBox={`0 0 ${W} ${H}`}
              className="qm-svg"
              style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
              role="group"
              aria-label={`Quantamental stock map. ${data.plotted} stocks plotted by peer-relative valuation and price momentum. ${data.noMomentum} have no momentum signal and ${data.noValuation} have no comparable valuation gap.`}
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
                      <rect
                        x={quadrant.x}
                        y={quadrant.y}
                        width={Math.max(0, quadrant.width)}
                        height={Math.max(0, quadrant.height)}
                        fill={QUADRANT_FILL[quadrant.key]}
                      />
                      <text x={quadrant.labelX} y={quadrant.labelY} textAnchor={quadrant.anchor} fontSize={9} letterSpacing={1.1} fill={TONE_COLOR[meta.tone]} opacity={0.92}>
                        {meta.label}
                      </text>
                      <text x={quadrant.labelX} y={quadrant.labelY + 13} textAnchor={quadrant.anchor} fontSize={8} fill="var(--qm-label, #6f7d8d)">
                        {data.quadrantCounts[quadrant.key]} STOCKS
                      </text>
                    </g>
                  );
                })}
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
                      y1={momentumY(tick)}
                      y2={momentumY(tick)}
                      x1={M.left}
                      x2={M.left + PLOT_W}
                      stroke={tick === 0 ? "var(--qm-grid-strong, #33404f)" : "var(--qm-grid, #19212a)"}
                      strokeDasharray={tick === 0 ? "4 4" : undefined}
                    />
                    <text x={M.left - 9} y={momentumY(tick) + 3} textAnchor="end" fontSize={8} fill="var(--qm-axis, #778596)">
                      {tick > 0 ? `+${tick}%` : `${tick}%`}
                    </text>
                  </g>
                ))}
              </g>

              <g pointerEvents="none">
                <line x1={cheapEdge} x2={cheapEdge} y1={M.top} y2={PLOT_BOTTOM} stroke="var(--qm-grid-strong, #2b3745)" strokeDasharray="2 4" />
                <line x1={richEdge} x2={richEdge} y1={M.top} y2={PLOT_BOTTOM} stroke="var(--qm-grid-strong, #2b3745)" strokeDasharray="2 4" />
                <line x1={M.left} x2={M.left + PLOT_W} y1={zeroY} y2={zeroY} stroke="var(--qm-grid-strong, #3a4654)" strokeDasharray="4 4" />
                <text x={M.left + PLOT_W / 2} y={M.top - 15} textAnchor="middle" fontSize={8} letterSpacing={1} fill="var(--qm-muted, #5f6d7d)">
                  BUBBLE SIZE ≈ MARKET CAP · SHAPE = VALUATION BASIS · FADED = THINLY TRADED
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
                  6M PRICE MOMENTUM
                </text>
              </g>

              <g clipPath={`url(#${clipId})`}>
                {plottedStocks.map((stock) => {
                  const gx = gapX(stock.gap as number);
                  const gy = momentumY(stock.momentum as number);
                  const radius = bubbleRadius(stock.marketCap, capRange.min, capRange.max);
                  const meta = QUADRANT_META[stock.quadrant];
                  const color = TONE_COLOR[meta.tone];
                  const isActive = activeStock?.ticker === stock.ticker;
                  const shape = BASIS_META[stock.basis].shape;
                  return (
                    <g
                      key={stock.ticker}
                      className={`qm-point${isActive ? " qm-point-active" : ""}`}
                      tabIndex={0}
                      role="button"
                      aria-label={`${stock.ticker}, ${meta.label}, valuation gap ${stock.gap} percent, momentum ${stock.momentum} percent`}
                      style={{ cursor: "pointer", opacity: stock.thin ? 0.5 : 1 }}
                      onPointerEnter={() => setHovered(stock.ticker)}
                      onPointerLeave={() => setHovered(null)}
                      onFocus={() => setHovered(stock.ticker)}
                      onBlur={() => setHovered(null)}
                      onClick={() => setSelected(stock.ticker)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelected(stock.ticker);
                        }
                      }}
                    >
                      <circle cx={gx} cy={gy} r={Math.max(12, radius + 4)} fill="transparent" />
                      <BubbleShape shape={shape} cx={gx} cy={gy} r={radius} fill={color} />
                      {isActive && <circle cx={gx} cy={gy} r={radius + 4} fill="none" stroke="var(--qm-ink, #e8edf3)" strokeWidth={1.2} />}
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
                    const gy = momentumY(stock.momentum as number);
                    const radius = bubbleRadius(stock.marketCap, capRange.min, capRange.max);
                    const rightSide = gx < M.left + PLOT_W * 0.68;
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

              <g>
                <rect x={STRIP_X} y={M.top} width={STRIP_W} height={PLOT_H} fill="var(--qm-strip, #0a0f14)" stroke="var(--qm-strip-line, #242424)" strokeDasharray="4 4" />
                <text x={STRIP_X + STRIP_W / 2} y={M.top + 20} textAnchor="middle" fontSize={8.5} letterSpacing={0.9} fill="var(--qm-muted, #8b98a8)">
                  NO MOMENTUM SIGNAL
                </text>
                <text x={STRIP_X + STRIP_W / 2} y={M.top + 34} textAnchor="middle" fontSize={8} fill="var(--qm-muted, #5c6878)">
                  {noMomentumStocks.length} NAMES
                </text>
                {noMomentumStocks.map((stock, index) => {
                  const column = Math.floor(index / 11);
                  const row = index % 11;
                  const x = STRIP_X + 24 + column * 34;
                  const y = M.top + 56 + row * 34;
                  if (column > 4 || y > PLOT_BOTTOM - 12) return null;
                  const radius = Math.max(4, bubbleRadius(stock.marketCap, capRange.min, capRange.max) * 0.7);
                  const isActive = activeStock?.ticker === stock.ticker;
                  return (
                    <g
                      key={`nomom-${stock.ticker}`}
                      tabIndex={0}
                      role="button"
                      aria-label={`${stock.ticker}, no momentum signal, valuation gap ${stock.gap} percent`}
                      style={{ cursor: "pointer", opacity: stock.thin ? 0.5 : 1 }}
                      onPointerEnter={() => setHovered(stock.ticker)}
                      onPointerLeave={() => setHovered(null)}
                      onFocus={() => setHovered(stock.ticker)}
                      onBlur={() => setHovered(null)}
                      onClick={() => setSelected(stock.ticker)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelected(stock.ticker);
                        }
                      }}
                    >
                      <circle cx={x} cy={y} r={Math.max(9, radius + 4)} fill="transparent" />
                      <BubbleShape shape={BASIS_META[stock.basis].shape} cx={x} cy={y} r={radius} fill={isActive ? "var(--qm-ink, #e8edf3)" : "var(--qm-muted, #8b98a8)"} />
                      <text x={x + radius + 5} y={y + 3} fontSize={7} fill={isActive ? "var(--qm-ink, #e8edf3)" : "var(--qm-point, #8492a3)"} pointerEvents="none">
                        {stock.ticker}
                      </text>
                    </g>
                  );
                })}
              </g>

              {selectMode && (
                <rect
                  x={M.left}
                  y={M.top}
                  width={PLOT_W}
                  height={PLOT_H}
                  fill="transparent"
                  style={{ cursor: "crosshair" }}
                />
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
                  MEDIAN MOMENTUM {regionMedianMomentum === null ? "—" : `${signed(regionMedianMomentum)}%`}
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
                <small className="qm-sector">{activeStock.sector}{activeStock.tvSector ? ` · ${activeStock.tvSector}` : ""}</small>
                <dl>
                  <div><dt>VALUATION BASIS</dt><dd><BasisMark basis={activeStock.basis} color={TONE_COLOR[QUADRANT_META[activeStock.quadrant].tone]} /> {BASIS_META[activeStock.basis].short}</dd></div>
                  <div><dt>METRIC</dt><dd>{metricText(activeStock)}</dd></div>
                  <div><dt>PEER MEDIAN</dt><dd>{activeStock.peerMedian === null ? "—" : metricText({ ...activeStock, metric: activeStock.peerMedian })}</dd></div>
                  <div><dt>VALUATION GAP</dt><dd className={activeStock.gap === null ? "" : activeStock.gap >= 0 ? "positive" : "negative"}>{activeStock.gap === null ? "—" : `${signed(activeStock.gap)}%`}</dd></div>
                  <div><dt>MOMENTUM {activeStock.momentumBasis ? `(${activeStock.momentumBasis})` : ""}</dt><dd className={activeStock.momentum === null ? "" : activeStock.momentum >= 0 ? "positive" : "negative"}>{activeStock.momentum === null ? "NO SIGNAL" : `${signed(activeStock.momentum)}%`}</dd></div>
                  <div><dt>MARKET CAP</dt><dd>{formatCap(activeStock.marketCap)}</dd></div>
                  <div><dt>10D TURNOVER</dt><dd>{formatTurnover(activeStock.turnover)}</dd></div>
                </dl>
                {activeStock.thin && <p className="qm-warning">Thinly traded · 10-day turnover below IDR 5bn. Treat the position with extra caution.</p>}
                {(activeStock.offScaleX || activeStock.offScaleY) && <p className="qm-warning">One axis value is off-scale and has been clamped to the edge.</p>}
                <button type="button" className="primary-button qm-open" onClick={() => onSelectStock?.(activeStock.ticker)}>OPEN STOCK DETAIL</button>
              </>
            ) : (
              <div className="qm-readout-empty">
                <strong>POINT AT A STOCK TO READ IT</strong>
                <p>Select a bubble to keep the readout open. Shapes show the valuation basis and lighter bubbles are thinly traded.</p>
              </div>
            )}
          </div>

          {showKey && (
            <div className="qm-key">
              <span>KEY</span>
              {(Object.keys(BASIS_META) as QuantamentalBasis[]).filter((basis) => basis !== "none").map((basis) => (
                <div key={basis}><BasisMark basis={basis} /><span>{BASIS_META[basis].short}</span><small>{BASIS_META[basis].label}</small></div>
              ))}
              <div><BasisMark basis="pe" color="var(--qm-muted, #5c6878)" /><span>FADED</span><small>Thinly traded · turnover under IDR 5bn</small></div>
              <div className="qm-key-quads">
                {(Object.keys(QUADRANT_META) as Array<keyof typeof QUADRANT_META>).filter((key) => key !== "no-momentum" && key !== "no-valuation").map((key) => (
                  <p key={key}><i style={{ background: TONE_COLOR[QUADRANT_META[key].tone] }} />{QUADRANT_META[key].label}<b>{data.quadrantCounts[key as keyof typeof data.quadrantCounts]}</b></p>
                ))}
              </div>
            </div>
          )}

          {showMethod && (
            <div className="qm-method">
              <span>ABOUT THIS MAP</span>
              <p>{data.methodology}</p>
            </div>
          )}

          {noValuationStocks.length > 0 && (
            <div className="qm-unplotted">
              <span>NO COMPARABLE GAP · {noValuationStocks.length}</span>
              <p>{noValuationStocks.map((stock) => `${stock.ticker}${stock.basis === "none" ? "" : ` (${BASIS_META[stock.basis].short})`}`).join(" · ")}</p>
              <small>These names are not plotted because no peer-relative gap could be computed: either the scanner had no P/E, P/S or P/B input, or fewer than three names shared that basis. They are not assigned a zero.</small>
            </div>
          )}
        </aside>
      </div>

      <footer className="panel-foot qm-foot">
        <span>X = PEER-RELATIVE VALUATION GAP · POSITIVE MEANS CHEAPER · Y = PRICE MOMENTUM</span>
        <span>{data.coverage.both} PLOTTED · {data.noMomentum} NO MOMENTUM · {data.noValuation} NO GAP</span>
      </footer>
    </section>
  );
}
