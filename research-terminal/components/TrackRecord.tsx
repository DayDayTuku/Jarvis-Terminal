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

// Tone classes are defined under .track-record in app/globals.css and read the
// theme tokens, so every value flips with light/dark exactly like the rest of
// the terminal. Nothing here hard-codes a colour.
const tone = (value: number | null | undefined) => value === null || value === undefined ? "flat" : value >= 0 ? "pos" : "neg";
const pct = (value: number | null | undefined, digits = 1) => value === null || value === undefined ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
const price = (value: number | null | undefined) => value === null || value === undefined ? "—" : new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(value);
const rMultiple = (value: number | null | undefined) => value === null || value === undefined ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}R`;
const shortDate = (value: string | null) => value ? new Date(`${value}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" }).toUpperCase() : "—";
const reasonTone: Record<Trade["exitReason"], string> = { TARGET: "pos", STOP: "neg", DROPPED: "flat", OPEN: "", NO_ENTRY: "flat" };

function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return <div className="track-loading" style={{ minHeight: 90 }}>NOT ENOUGH CLOSED TRADES YET</div>;
  const min = Math.min(...points, 100);
  const max = Math.max(...points, 100);
  const span = max - min || 1;
  const width = 320, height = 90, pad = 6;
  const line = points.map((value, index) => {
    const x = pad + (index / (points.length - 1)) * (width - pad * 2);
    const y = pad + (1 - (value - min) / span) * (height - pad * 2);
    return `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const bepY = pad + (1 - (100 - min) / span) * (height - pad * 2);
  const up = points[points.length - 1] >= 100;
  return (
    <svg className="track-spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Equity curve against break-even">
      {/* Break-even line: white on the dark theme, black on the light theme. */}
      <line className="track-bep" x1={pad} x2={width - pad} y1={bepY} y2={bepY} />
      <path className={`track-line ${up ? "up" : "down"}`} d={line} />
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

  const stats: Array<[string, string, string]> = summary ? [
    ["CUMULATIVE RETURN", pct(cumulative), tone(cumulative)],
    ["WIN RATE", summary.winRate === null ? "—" : `${summary.winRate.toFixed(0)}%`, ""],
    ["AVG RETURN / TRADE", pct(summary.avgReturn), tone(summary.avgReturn)],
    ["AVG R MULTIPLE", rMultiple(summary.avgR), tone(summary.avgR)],
    ["PROFIT FACTOR", summary.profitFactor === null ? "—" : summary.profitFactor.toFixed(2), summary.profitFactor !== null && summary.profitFactor >= 1 ? "pos" : "neg"],
    ["CLOSED TRADES", `${summary.trades}`, ""],
  ] : [];

  return (
    <article className="panel track-record">
      <header className="track-head">
        <div>
          <span>TRACK RECORD · V5</span>
          <h3>How the weekly picks have actually resolved</h3>
          <p>Every pick scored from its published plan — {data?.methodology ?? "entry, stop, target, exit"}. Rules-based, not advice.</p>
        </div>
        <button className="track-refresh" type="button" onClick={reload} disabled={loading}>{loading ? "LOADING…" : "↻ REFRESH"}</button>
      </header>

      {loading && !data && <div className="track-loading">SCORING EVERY PUBLISHED PICK…</div>}

      {!loading && !data && (
        <div className="track-error">
          <strong>Track record unavailable</strong>
          <span>The record is withheld rather than shown with stale or partial data.</span>
        </div>
      )}

      {data && summary && (
        <>
          <div className="track-stats">
            {stats.map(([label, value, className]) => (
              <div key={label}>
                <span>{label}</span>
                <strong className={className}>{value}</strong>
              </div>
            ))}
          </div>

          <div className="track-charts">
            <div className="track-curve">
              <span className="track-cap">EQUITY CURVE · TRADE-SEQUENCED · EQUAL WEIGHT</span>
              <Sparkline points={(data.equity ?? []).map((point) => point.value)} />
              <div className="track-axis"><span>BREAK-EVEN 100</span><span>NOW {cumulative === null ? "—" : (100 + cumulative).toFixed(1)}</span></div>
            </div>
            <div className="track-bench">
              <span className="track-cap">VS BENCHMARK</span>
              <div className="track-bench-row"><span>STRATEGY</span><strong className={tone(cumulative)}>{pct(cumulative)}</strong></div>
              <div className="track-bench-row"><span>JAKARTA COMPOSITE</span><strong className={tone(data.benchmark?.returnPct)}>{pct(data.benchmark?.returnPct)}</strong></div>
              {edge !== null && <div className="track-bench-row edge"><span>EDGE</span><strong className={tone(edge)}>{pct(edge)}</strong></div>}
              <div className="meta">
                {summary.open} OPEN · {summary.noEntry} NO ENTRY · {summary.wins}W / {summary.losses}L<br />
                BEST {pct(summary.best)} · WORST {pct(summary.worst)}
              </div>
            </div>
          </div>

          <div className="track-table">
            <div className="track-grid track-thead">
              <span>WEEK</span><span>PICK</span><span>ENTRY</span><span>EXIT</span><span>RESULT</span><span style={{ textAlign: "right" }}>RETURN</span>
            </div>
            {data.trades.length === 0 && <div className="track-loading" style={{ minHeight: 120 }}>No picks recorded yet.</div>}
            {data.trades.map((trade, index) => (
              <div className="track-grid track-trow" key={`${trade.weekOf}-${trade.ticker}-${index}`}>
                <span className="track-week">{shortDate(trade.weekOf)}</span>
                <span className="track-pick">
                  <b>{trade.ticker}</b>{trade.direction === "SHORT" && <small className="track-short">SHORT</small>}
                  <small>{trade.setup.toUpperCase().replace("SHORT_", "")}</small>
                </span>
                <span className="track-price">{price(trade.entryPrice)}<small>{shortDate(trade.entryDate)}</small></span>
                <span className="track-price">{price(trade.exitPrice)}<small>{shortDate(trade.exitDate)}</small></span>
                <span className={`track-reason ${reasonTone[trade.exitReason]}`}>{trade.exitReason}</span>
                <span className="track-num">
                  <b className={tone(trade.returnPct)}>{pct(trade.returnPct)}</b>
                  <small>{rMultiple(trade.rMultiple)}</small>
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <footer>
        <span>ENTRY = FILL OF THE PUBLISHED RANGE · EXIT = STOP, FIRST TARGET, OR ROLLOVER</span>
        <span>CLOSE-TO-CLOSE · DAILY BARS</span>
      </footer>
    </article>
  );
}
