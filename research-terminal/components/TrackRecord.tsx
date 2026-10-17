"use client";
import { useEffect, useState } from "react";

type Trade = {
  weekOf: string; ticker: string; setup: string; score: number; weight: number;
  direction: "LONG" | "SHORT";
  status: "CLOSED" | "OPEN" | "NO_ENTRY";
  entryDate: string | null; entryPrice: number | null;
  exitDate: string | null; exitPrice: number | null;
  exitReason: "STOP" | "TARGET" | "DROPPED" | "OPEN" | "NO_ENTRY";
  returnPct: number | null; rMultiple: number | null;
};
type Summary = {
  trades: number; open: number; noEntry: number; wins: number; losses: number;
  winRate: number | null; avgReturn: number | null; avgR: number | null;
  profitFactor: number | null; best: number | null; worst: number | null;
};
type Payload = {
  trades: Trade[]; weeks: Array<{ weekOf: string; closed: number; winRate: number | null }>;
  summary: Summary | null;
  benchmark: { symbol: string; from: string; to: string; returnPct: number } | null;
  equity: Array<{ date: string | null; weekOf: string; value: number }>;
  methodology: string;
};

const GREEN = "#43d4a3";
const RED = "#ff6678";
const accent = (value: number | null | undefined) => value === null || value === undefined ? "#8793a3" : value >= 0 ? GREEN : RED;
const pct = (value: number | null | undefined, digits = 1) => value === null || value === undefined ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
const price = (value: number | null | undefined) => value === null || value === undefined ? "—" : new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(value);
const r = (value: number | null | undefined) => value === null || value === undefined ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}R`;
const shortDate = (value: string | null) => value ? new Date(`${value}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" }).toUpperCase() : "—";

const reasonTone: Record<Trade["exitReason"], string> = {
  TARGET: GREEN, STOP: RED, DROPPED: "#8793a3", OPEN: "#48a6ff", NO_ENTRY: "#778596",
};

function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return <div style={{ height: 90, display: "grid", placeContent: "center", color: "#657284", fontSize: 8 }}>NOT ENOUGH CLOSED TRADES YET</div>;
  const min = Math.min(...points, 100);
  const max = Math.max(...points, 100);
  const span = max - min || 1;
  const width = 320, height = 90, pad = 6;
  const path = points.map((value, index) => {
    const x = pad + (index / (points.length - 1)) * (width - pad * 2);
    const y = pad + (1 - (value - min) / span) * (height - pad * 2);
    return `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const base = pad + (1 - (100 - min) / span) * (height - pad * 2);
  const up = points[points.length - 1] >= 100;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: 90 }} preserveAspectRatio="none" aria-label="Equity curve">
      <line x1={pad} x2={width - pad} y1={base} y2={base} stroke="#243040" strokeWidth="1" strokeDasharray="3 3" />
      <path d={path} fill="none" stroke={up ? GREEN : RED} strokeWidth="1.6" />
    </svg>
  );
}

export default function TrackRecord() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    fetch("/api/performance", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("http"))))
      .then((payload) => { if (active) setData(payload as Payload); })
      .catch(() => { if (active) setData(null); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reloadKey]);

  const reload = () => { setLoading(true); setReloadKey((key) => key + 1); };

  const summary = data?.summary ?? null;
  const cumulative = data?.equity?.length ? data.equity[data.equity.length - 1].value - 100 : null;
  const edge = cumulative !== null && data?.benchmark ? cumulative - data.benchmark.returnPct : null;

  return (
    <article className="panel" style={{ overflow: "hidden" }}>
      <header className="panel-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "13px 15px", borderBottom: "1px solid var(--line)" }}>
        <div>
          <span style={{ color: "#48a6ff", fontSize: 8, letterSpacing: ".12em" }}>TRACK RECORD · V5</span>
          <h2 style={{ margin: "6px 0 3px", fontSize: 15 }}>How the weekly picks have actually resolved</h2>
          <p style={{ margin: 0, color: "#778596", font: "400 10px/1.5 var(--font-geist-sans)" }}>Every pick scored from its published plan — {data?.methodology ?? "entry, stop, target, exit"}. Rules-based, not advice.</p>
        </div>
        <button onClick={reload} disabled={loading} style={{ minHeight: 32, padding: "0 12px", border: "1px solid #263547", background: "#0a111a", color: "#c8d2de", fontSize: 8, cursor: "pointer" }}>{loading ? "LOADING…" : "↻ REFRESH"}</button>
      </header>

      {loading && !data && <div style={{ minHeight: 180, display: "grid", placeContent: "center", color: "#778596", fontSize: 9 }}>SCORING EVERY PUBLISHED PICK…</div>}

      {!loading && !data && <div style={{ minHeight: 160, display: "grid", placeContent: "center", gap: 6, textAlign: "center", padding: 24 }}><strong style={{ fontSize: 12 }}>Track record unavailable</strong><span style={{ color: "#778596", font: "400 10px var(--font-geist-sans)" }}>The record is withheld rather than shown with stale or partial data.</span></div>}

      {data && summary && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", borderBottom: "1px solid var(--line)" }}>
            {[
              ["CUMULATIVE RETURN", pct(cumulative), accent(cumulative)],
              ["WIN RATE", summary.winRate === null ? "—" : `${summary.winRate.toFixed(0)}%`, "#e8edf3"],
              ["AVG RETURN / TRADE", pct(summary.avgReturn), accent(summary.avgReturn)],
              ["AVG R MULTIPLE", r(summary.avgR), accent(summary.avgR)],
              ["PROFIT FACTOR", summary.profitFactor === null ? "—" : summary.profitFactor.toFixed(2), summary.profitFactor !== null && summary.profitFactor >= 1 ? GREEN : RED],
              ["CLOSED TRADES", `${summary.trades}`, "#e8edf3"],
            ].map(([label, value, color]) => (
              <div key={label as string} style={{ padding: 13, borderRight: "1px solid var(--line)" }}>
                <span style={{ color: "#657284", fontSize: 7 }}>{label}</span>
                <strong style={{ display: "block", marginTop: 6, fontSize: 15, color: color as string }}>{value}</strong>
              </div>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "minmax(280px,1.4fr) minmax(220px,1fr)", gap: 0 }}>
            <div style={{ padding: 15, borderRight: "1px solid var(--line)" }}>
              <span style={{ color: "#657284", fontSize: 7 }}>EQUITY CURVE · TRADE-SEQUENCED · EQUAL WEIGHT</span>
              <Sparkline points={(data.equity ?? []).map((point) => point.value)} />
              <div style={{ display: "flex", justifyContent: "space-between", color: "#778596", fontSize: 8, marginTop: 4 }}>
                <span>START 100</span><span>NOW {cumulative === null ? "—" : (100 + cumulative).toFixed(1)}</span>
              </div>
            </div>
            <div style={{ padding: 15, display: "grid", gap: 10, alignContent: "start" }}>
              <div>
                <span style={{ color: "#657284", fontSize: 7 }}>VS BENCHMARK</span>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                  <span style={{ fontSize: 10 }}>STRATEGY</span><strong style={{ color: accent(cumulative), fontSize: 11 }}>{pct(cumulative)}</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                  <span style={{ fontSize: 10 }}>JAKARTA COMPOSITE</span><strong style={{ color: accent(data.benchmark?.returnPct), fontSize: 11 }}>{pct(data.benchmark?.returnPct)}</strong>
                </div>
                {edge !== null && <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--line)" }}>
                  <span style={{ fontSize: 10, color: "#8793a3" }}>EDGE</span><strong style={{ color: accent(edge), fontSize: 11 }}>{pct(edge)}</strong>
                </div>}
              </div>
              <div style={{ color: "#657284", fontSize: 8, lineHeight: 1.5 }}>
                {summary.open} OPEN · {summary.noEntry} NO ENTRY · {summary.wins}W / {summary.losses}L
                <br />BEST {pct(summary.best)} · WORST {pct(summary.worst)}
              </div>
            </div>
          </div>

          <div style={{ maxHeight: 360, overflowY: "auto" }}>
            <div style={{ display: "grid", gridTemplateColumns: "78px 1fr 84px 84px 92px 84px", gap: 8, padding: "9px 14px", borderBottom: "1px solid var(--line)", color: "#657284", fontSize: 7, position: "sticky", top: 0, background: "#0b0f16" }}>
              <span>WEEK</span><span>PICK</span><span>ENTRY</span><span>EXIT</span><span>RESULT</span><span style={{ textAlign: "right" }}>RETURN</span>
            </div>
            {data.trades.length === 0 && <div style={{ padding: 20, color: "#778596", fontSize: 9, textAlign: "center" }}>No picks recorded yet.</div>}
            {data.trades.map((trade, index) => (
              <div key={`${trade.weekOf}-${trade.ticker}-${index}`} style={{ display: "grid", gridTemplateColumns: "78px 1fr 84px 84px 92px 84px", gap: 8, padding: "10px 14px", borderBottom: "1px solid #151d27", alignItems: "center", fontSize: 10 }}>
                <span style={{ color: "#778596" }}>{shortDate(trade.weekOf)}</span>
                <span style={{ minWidth: 0 }}>
                  <b>{trade.ticker}</b>{trade.direction === "SHORT" && <small style={{ color: "#ff6678", marginLeft: 5, fontSize: 7 }}>SHORT</small>}
                  <small style={{ display: "block", marginTop: 2, color: "#657284", fontSize: 7 }}>{trade.setup.toUpperCase().replace("SHORT_", "")}</small>
                </span>
                <span style={{ color: "#8793a3" }}>{price(trade.entryPrice)}<small style={{ display: "block", fontSize: 7 }}>{shortDate(trade.entryDate)}</small></span>
                <span style={{ color: "#8793a3" }}>{price(trade.exitPrice)}<small style={{ display: "block", fontSize: 7 }}>{shortDate(trade.exitDate)}</small></span>
                <span style={{ color: reasonTone[trade.exitReason], fontSize: 8 }}>{trade.exitReason}</span>
                <span style={{ textAlign: "right" }}>
                  <b style={{ color: accent(trade.returnPct) }}>{pct(trade.returnPct)}</b>
                  <small style={{ display: "block", color: "#657284", fontSize: 7 }}>{r(trade.rMultiple)}</small>
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <footer className="panel-foot" style={{ display: "flex", justifyContent: "space-between", padding: "10px 15px", borderTop: "1px solid var(--line)", color: "#657284", fontSize: 8 }}>
        <span>ENTRY = FILL OF THE PUBLISHED RANGE · EXIT = STOP, FIRST TARGET, OR ROLLOVER</span>
        <span>CLOSE-TO-CLOSE · DAILY BARS</span>
      </footer>
    </article>
  );
}
