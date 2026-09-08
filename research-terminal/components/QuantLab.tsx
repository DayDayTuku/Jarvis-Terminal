"use client";

import { useEffect, useState } from "react";

type MarketData = {
  freshness: string;
  heatmap: Array<{ label: string; daily: number | null; weekly: number | null; confidence?: string; validCount?: number; memberCount?: number }>;
  assets: Array<{ name: string; closes: Array<number | null> }>;
};
type FredData = {
  freshness: string;
  regime: Array<{ date: string; growth: number; inflation: number }>;
};

function clean(values: Array<number | null>) {
  return values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}
function change(values: number[], sessions: number) {
  const last = values.at(-1);
  const prior = values.at(-(sessions + 1));
  return last && prior ? ((last / prior) - 1) * 100 : null;
}
function volatility(values: number[]) {
  const returns = values.slice(-21).flatMap((value, index, list) =>
    index && list[index - 1] ? [(value / list[index - 1]) - 1] : []
  );
  if (returns.length < 5) return null;
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}
function fmt(value: number | null, suffix = "%") {
  return value === null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}${suffix}`;
}

export default function QuantLab({ markets, fred }: { markets: MarketData | null; fred: FredData | null }) {
  const sectors = (markets?.heatmap ?? [])
    .filter((item) => typeof item.weekly === "number")
    .sort((a, b) => (b.weekly ?? 0) - (a.weekly ?? 0));
  const daily = sectors.flatMap((item) => typeof item.daily === "number" ? [item.daily] : []);
  const breadth = daily.length ? daily.filter((value) => value > 0).length / daily.length * 100 : null;
  const dispersion = daily.length
    ? Math.sqrt(daily.reduce((sum, value) => sum + (value - daily.reduce((a, b) => a + b, 0) / daily.length) ** 2, 0) / daily.length)
    : null;
  const assets = (markets?.assets ?? []).map((asset) => {
    const values = clean(asset.closes);
    return { name: asset.name, oneWeek: change(values, 5), oneMonth: change(values, 20), vol: volatility(values) };
  });
  const dxy = assets.find((asset) => asset.name === "DXY");
  const jkse = assets.find((asset) => asset.name === "JKSE");
  const regime = fred?.regime.at(-1) ?? null;

  const components = [
    breadth === null ? null : (breadth - 50) / 10,
    jkse?.oneMonth === null || jkse?.oneMonth === undefined ? null : jkse.oneMonth / 3,
    dxy?.oneMonth === null || dxy?.oneMonth === undefined ? null : -dxy.oneMonth / 3,
    regime ? regime.growth : null,
    regime ? -regime.inflation : null,
  ].filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const rawScore = components.length ? components.reduce((sum, value) => sum + value, 0) / components.length : null;
  const riskScore = rawScore === null ? null : Math.max(0, Math.min(100, 50 + rawScore * 15));
  const signal = riskScore === null ? "INSUFFICIENT DATA" : riskScore >= 65 ? "RISK-ON" : riskScore <= 35 ? "RISK-OFF" : "NEUTRAL";
  const signalColor = riskScore === null ? "#778596" : riskScore >= 65 ? "#43d4a3" : riskScore <= 35 ? "#ff6678" : "#ffb45e";

  return (
    <section style={{ display: "grid", gap: 12 }}>
      <div className="quant-summary" style={{ display: "grid", gridTemplateColumns: "1.15fr repeat(3,minmax(0,1fr))", border: "1px solid var(--line-strong)", background: "#070a0f" }}>
        <div style={{ padding: 14, borderRight: "1px solid var(--line)" }}>
          <span style={{ color: "#657284", fontSize: 8 }}>COMPOSITE RISK APPETITE</span>
          <strong style={{ display: "block", marginTop: 6, color: signalColor, fontSize: 15 }}>{signal}</strong>
          <small style={{ color: "#778596" }}>{riskScore === null ? "—" : `${riskScore.toFixed(0)}/100`} · {components.length}/5 inputs</small>
        </div>
        {[
          ["IDX BREADTH", breadth === null ? "—" : `${breadth.toFixed(0)}%`],
          ["DISPERSION", dispersion === null ? "—" : `${dispersion.toFixed(2)}%`],
          ["JKSE 1M", fmt(jkse?.oneMonth ?? null)],
        ].map(([label, value]) => (
          <div key={label} style={{ padding: 14, borderRight: "1px solid var(--line)" }}>
            <span style={{ color: "#657284", fontSize: 8 }}>{label}</span>
            <strong style={{ display: "block", marginTop: 6, color: "#e8edf3", fontSize: 17 }}>{value}</strong>
          </div>
        ))}
      </div>

      <div className="quant-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0,1.2fr) minmax(0,.8fr)", gap: 12 }}>
        <article className="panel">
          <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--line)" }}>
            <strong style={{ color: "#48a6ff", fontSize: 9, letterSpacing: ".08em" }}>IDX SECTOR MOMENTUM RANK</strong>
          </div>
          <div style={{ display: "grid" }}>
            {sectors.length ? sectors.map((sector, index) => {
              const width = Math.min(100, Math.max(4, 50 + (sector.weekly ?? 0) * 7));
              return (
                <div key={sector.label} style={{ display: "grid", gridTemplateColumns: "26px minmax(120px,1fr) 74px", gap: 9, alignItems: "center", padding: "10px 12px", borderBottom: "1px solid #151d27" }}>
                  <span style={{ color: "#536171", fontSize: 9 }}>{String(index + 1).padStart(2, "0")}</span>
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ display: "block", color: "#dce3eb", fontSize: 9, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sector.label}</strong>
                    <div style={{ height: 3, marginTop: 6, background: "#111923" }}><i style={{ display: "block", width: `${width}%`, height: "100%", background: (sector.weekly ?? 0) >= 0 ? "#43d4a3" : "#ff6678" }} /></div>
                  </div>
                  <strong style={{ textAlign: "right", color: (sector.weekly ?? 0) >= 0 ? "#43d4a3" : "#ff6678", fontSize: 10 }}>{fmt(sector.weekly)}</strong>
                </div>
              );
            }) : <div style={{ minHeight: 260, display: "grid", placeContent: "center", color: "#778596", fontSize: 10 }}>SECTOR DATA UNAVAILABLE</div>}
          </div>
        </article>

        <article className="panel">
          <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--line)" }}>
            <strong style={{ color: "#48a6ff", fontSize: 9, letterSpacing: ".08em" }}>CROSS-ASSET FACTORS</strong>
          </div>
          {assets.length ? assets.map((asset) => (
            <div key={asset.name} style={{ display: "grid", gridTemplateColumns: "1fr repeat(3,62px)", gap: 6, padding: "11px 12px", borderBottom: "1px solid #151d27", alignItems: "center" }}>
              <strong style={{ color: "#dce3eb", fontSize: 9 }}>{asset.name}</strong>
              <span style={{ color: (asset.oneWeek ?? 0) >= 0 ? "#43d4a3" : "#ff6678", textAlign: "right", fontSize: 8 }}>{fmt(asset.oneWeek)}</span>
              <span style={{ color: (asset.oneMonth ?? 0) >= 0 ? "#43d4a3" : "#ff6678", textAlign: "right", fontSize: 8 }}>{fmt(asset.oneMonth)}</span>
              <span style={{ color: "#a3adba", textAlign: "right", fontSize: 8 }}>{asset.vol === null ? "—" : `${asset.vol.toFixed(1)}%`}</span>
            </div>
          )) : <div style={{ minHeight: 260, display: "grid", placeContent: "center", color: "#778596", fontSize: 10 }}>ASSET DATA UNAVAILABLE</div>}
          {assets.length > 0 && <div style={{ display: "grid", gridTemplateColumns: "1fr repeat(3,62px)", padding: "8px 12px", color: "#536171", fontSize: 7 }}><span>FACTOR</span><span style={{textAlign:"right"}}>1W</span><span style={{textAlign:"right"}}>1M</span><span style={{textAlign:"right"}}>ANN.VOL</span></div>}
        </article>
      </div>

      <SignalReplay />

      <div style={{ padding: "10px 12px", border: "1px solid #1b2a3a", background: "#071019", color: "#657284", fontSize: 8, lineHeight: 1.6 }}>
        MODEL: equal-weighted IDX breadth, JKSE 1M momentum, inverse DXY 1M momentum, growth z-score, and inverse inflation z-score. Score is descriptive—not a forecast or trading recommendation. {markets ? `Markets updated ${markets.freshness}.` : "Market feed unavailable."} {fred ? `Macro updated ${fred.freshness}.` : "Macro feed unavailable."}
      </div>
    </section>
  );
}


type ReplayStats = {
  observations: number;
  mean: number | null;
  median: number | null;
  winRate: number | null;
  p25: number | null;
  p75: number | null;
};
type ReplayData = {
  status: string;
  signal: { key: string; label: string; description: string; source: string };
  target: { key: string; label: string; symbol: string };
  currentActive: boolean;
  latestSignalDate: string | null;
  history: { from: string; through: string; years: number };
  results: Array<{ horizon: number; signal: ReplayStats; baseline: ReplayStats; edgeMedian: number | null }>;
  events: Array<{ date: string; return5: number | null; return20: number | null; return60: number | null; maxDrawdown60: number | null }>;
  worstDrawdown60: number | null;
  integrity: { completedSamples: number; minimumRecommended: number; rating: string; note: string };
  freshness: string;
};

const replaySignals = [
  ["jkse_pullback", "JKSE 1M PULLBACK"],
  ["jkse_trend_reclaim", "JKSE RECLAIMS 200D"],
  ["dxy_surge", "DXY 1M SURGE"],
  ["oil_rally", "WTI 1M RALLY"],
  ["coal_rally", "COAL PROXY RALLY"],
] as const;
const replayTargets = [
  ["JKSE", "JAKARTA COMPOSITE"],
  ["ADRO", "ADRO"],
  ["PTBA", "PTBA"],
  ["ANTM", "ANTM"],
  ["BBCA", "BBCA"],
] as const;

function pct(value: number | null, digits = 1) {
  return value === null ? "—" : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;
}

function SignalReplay() {
  const [signal, setSignal] = useState("jkse_pullback");
  const [target, setTarget] = useState("JKSE");
  const [data, setData] = useState<ReplayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setFailed(false);
    fetch(`/api/signal-replay?signal=${encodeURIComponent(signal)}&target=${encodeURIComponent(target)}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Historical feed unavailable")))
      .then((payload) => setData(payload as ReplayData))
      .catch((error) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setData(null);
        setFailed(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [signal, target]);

  const horizon20 = data?.results.find((result) => result.horizon === 20);
  const edge = horizon20?.edgeMedian ?? null;
  const verdict = edge === null
    ? "INSUFFICIENT EVIDENCE"
    : data!.integrity.completedSamples < 12
      ? "FRAGILE SAMPLE"
      : edge > 0.015
        ? "POSITIVE HISTORICAL EDGE"
        : edge < -0.015
          ? "NEGATIVE HISTORICAL EDGE"
          : "NO MEANINGFUL EDGE";
  const verdictTone = edge !== null && edge > 0.015 ? "positive" : edge !== null && edge < -0.015 ? "negative" : "";

  return (
    <article className="panel replay-panel">
      <div className="replay-head">
        <div>
          <span>SIGNAL REPLAY · BETA</span>
          <h3>What happened after conditions like this?</h3>
          <p>Conditional forward returns—not a buy/sell strategy.</p>
        </div>
        <div className="replay-controls">
          <label>
            HISTORICAL CONDITION
            <select value={signal} onChange={(event) => setSignal(event.target.value)}>
              {replaySignals.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>
            TEST ON
            <select value={target} onChange={(event) => setTarget(event.target.value)}>
              {replayTargets.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div>
      </div>

      {loading && <div className="replay-state">REPLAYING 10 YEARS OF ADJUSTED PRICE HISTORY…</div>}
      {failed && <div className="replay-state error">HISTORICAL FEED UNAVAILABLE · TRY ANOTHER SIGNAL OR RELOAD</div>}
      {!loading && data && (
        <>
          <div className="replay-verdict">
            <div>
              <span>20D READ</span>
              <strong className={verdictTone}>{verdict}</strong>
              <small>Median edge versus the target&apos;s unconditional return: {pct(edge)}</small>
            </div>
            <div>
              <span>CONDITION NOW</span>
              <strong className={data.currentActive ? "active-signal" : ""}>{data.currentActive ? "ACTIVE" : "INACTIVE"}</strong>
              <small>Last completed trigger {data.latestSignalDate ?? "—"}</small>
            </div>
            <div>
              <span>SAMPLE INTEGRITY</span>
              <strong>{data.integrity.rating}</strong>
              <small>{data.integrity.completedSamples} episodes · recommended ≥{data.integrity.minimumRecommended}</small>
            </div>
            <div>
              <span>WORST 60D PATH</span>
              <strong className="negative">{pct(data.worstDrawdown60)}</strong>
              <small>Worst drawdown after any trigger</small>
            </div>
          </div>

          <div className="replay-body">
            <div className="replay-results">
              <div className="replay-row replay-table-head">
                <span>HORIZON</span><span>MEDIAN</span><span>BASELINE</span><span>EDGE</span><span>WIN RATE</span><span>RANGE P25–P75</span><span>N</span>
              </div>
              {data.results.map((result) => (
                <div className="replay-row" key={result.horizon}>
                  <strong>{result.horizon}D</strong>
                  <span className={(result.signal.median ?? 0) >= 0 ? "positive" : "negative"}>{pct(result.signal.median)}</span>
                  <span>{pct(result.baseline.median)}</span>
                  <span className={(result.edgeMedian ?? 0) >= 0 ? "positive" : "negative"}>{pct(result.edgeMedian)}</span>
                  <span>{result.signal.winRate === null ? "—" : `${(result.signal.winRate * 100).toFixed(0)}%`}</span>
                  <span>{pct(result.signal.p25)} → {pct(result.signal.p75)}</span>
                  <span>{result.signal.observations}</span>
                </div>
              ))}
            </div>
            <div className="replay-events">
              <div className="replay-events-head"><span>RECENT TRIGGERS</span><span>20D / 60D</span></div>
              {data.events.length ? data.events.slice(0, 6).map((event) => (
                <div key={event.date}><strong>{event.date}</strong><span className={(event.return20 ?? 0) >= 0 ? "positive" : "negative"}>{pct(event.return20)}</span><span className={(event.return60 ?? 0) >= 0 ? "positive" : "negative"}>{pct(event.return60)}</span></div>
              )) : <p>NO COMPLETED EPISODES IN AVAILABLE HISTORY</p>}
            </div>
          </div>

          <div className="replay-method">
            <strong>{data.signal.label}:</strong> {data.signal.description} Tested on {data.target.label}, {data.history.from}–{data.history.through}. {data.integrity.note} Baseline uses every eligible trading date; no transaction costs are modeled.
          </div>
        </>
      )}
    </article>
  );
}
