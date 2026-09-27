"use client";

import { useEffect, useMemo, useState } from "react";
import WeeklyShortlist from "./WeeklyShortlist";

type MarketData = {
  freshness: string;
  heatmap: Array<{ label: string; daily: number | null; weekly: number | null }>;
};
type FredData = { freshness: string; regime: Array<{ date: string; growth: number; inflation: number }> };
type SetupKey = "all" | "breakout" | "pullback" | "momentum" | "reversal" | "short_breakdown";
type Setup = {
  ticker: string; name: string; setup: Exclude<SetupKey, "all">; score: number;
  close: number; change: number | null; volume: number; relativeVolume: number | null;
  rsi: number | null; marketCap: number | null; distance20: number | null;
  reasons: string[]; caution: string; entryLow: number; entryHigh: number;
  invalidation: number; target: number; riskReward: number;
};
type ScannerData = {
  status: string; asOf: string; universe: number; scanned: number;
  methodology: string; setups: Setup[]; message?: string;
};

const setupMeta = {
  breakout: { label: "BREAKOUT", subtitle: "Breaking resistance with stronger volume", color: "#48a6ff" },
  pullback: { label: "HEALTHY PULLBACK", subtitle: "Uptrend returning to support", color: "#43d4a3" },
  momentum: { label: "MOMENTUM", subtitle: "Trend remains strong, but not extreme", color: "#b889ff" },
  reversal: { label: "REVERSAL", subtitle: "Early rebound near a recent low", color: "#ffb45e" },
  short_breakdown: { label: "OPTIONAL SHORT", subtitle: "BEI-eligible bearish breakdown with borrow required", color: "#ff6678" },
} as const;

function price(value: number | null) {
  return value === null ? "—" : new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(value);
}
function compact(value: number | null) {
  if (value === null) return "—";
  if (value >= 1e12) return `${(value / 1e12).toFixed(1)}T`;
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  return price(value);
}
function pct(value: number | null, digits = 1) {
  return value === null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

export default function QuantLab({
  markets,
  fred,
  onSelectStock,
}: {
  markets: MarketData | null;
  fred: FredData | null;
  onSelectStock?: (ticker: string) => void;
}) {
  const [data, setData] = useState<ScannerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<SetupKey>("all");
  const [selected, setSelected] = useState<Setup | null>(null);
  const [showMethod, setShowMethod] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"score" | "volume" | "change">("score");

  const load = () => {
    setLoading(true);
    fetch("/api/swing-setups")
      .then((response) => response.ok ? response.json() : response.json().then((body: any) => Promise.reject(new Error(body?.message ?? "Scanner unavailable"))))
      .then((payload) => setData(payload as ScannerData))
      .catch((error) => setData({ status: "unavailable", asOf: new Date().toISOString(), universe: 0, scanned: 0, methodology: "", setups: [], message: error instanceof Error ? error.message : "Scanner unavailable" }))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const visible = useMemo(() => {
    const normalizedQuery = query.trim().toUpperCase();
    const rows = (data?.setups ?? [])
      .filter((row) => filter === "all" || row.setup === filter)
      .filter((row) => !normalizedQuery || row.ticker.includes(normalizedQuery) || row.name.toUpperCase().includes(normalizedQuery))
      .sort((a, b) => sort === "volume"
        ? (b.relativeVolume ?? 0) - (a.relativeVolume ?? 0)
        : sort === "change"
          ? (b.change ?? -Infinity) - (a.change ?? -Infinity)
          : b.score - a.score);
    return rows.slice(0, 30);
  }, [data, filter, query, sort]);
  useEffect(() => {
    if (!selected || !visible.some((item) => item.ticker === selected.ticker)) setSelected(visible[0] ?? null);
  }, [filter, data]); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = (data?.setups ?? []).reduce<Record<string, number>>((acc, row) => {
    acc[row.setup] = (acc[row.setup] ?? 0) + 1;
    return acc;
  }, {});
  const breadth = (markets?.heatmap ?? []).filter((item) => typeof item.daily === "number");
  const positive = breadth.filter((item) => (item.daily ?? 0) > 0).length;
  const marketTone = !breadth.length ? "Market context unavailable" : positive / breadth.length >= .65 ? "Broad market support is constructive" : positive / breadth.length <= .35 ? "Market breadth is weak—reduce position size" : "Market breadth is mixed—stay selective";
  const regime = fred?.regime.at(-1);
  const macroTone = !regime ? "Macro filter unavailable" : regime.inflation > .75 ? "Inflation pressure is elevated" : regime.growth < -.75 ? "Growth backdrop is soft" : "Macro backdrop is not at an extreme";

  return (
    <section style={{ display: "grid", gap: 12 }}>
      <article className="panel setup-finder" style={{ overflow: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "18px 18px 16px", borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
          <div style={{ maxWidth: 680 }}>
            <span style={{ color: "#48a6ff", fontSize: 8, letterSpacing: ".12em" }}>SETUP FINDER · BETA</span>
            <h2 style={{ margin: "7px 0 5px", fontSize: 21 }}>What may be setting up for the next 3–20 sessions?</h2>
            <p style={{ margin: 0, color: "#8793a3", font: "400 11px/1.55 var(--font-geist-sans)" }}>End-of-day long shortlist plus an optional risk-capped short. Shorts are limited to one, must be on the official BEI list, and still require confirmed borrow availability.</p>
          </div>
          <button onClick={load} disabled={loading} style={{ alignSelf: "center", minHeight: 34, padding: "0 14px", border: "1px solid #263547", background: "#0a111a", color: "#c8d2de", fontSize: 8, cursor: "pointer" }}>{loading ? "SCANNING…" : "↻ REFRESH SCAN"}</button>
        </div>

        <div className="quant-summary" style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", borderBottom: "1px solid var(--line)" }}>
          <div style={{ padding: 13 }}><span style={{ color: "#657284", fontSize: 7 }}>MARKET CHECK</span><strong style={{ display: "block", marginTop: 5, fontSize: 10 }}>{marketTone}</strong></div>
          <div style={{ padding: 13, borderLeft: "1px solid var(--line)" }}><span style={{ color: "#657284", fontSize: 7 }}>MACRO GUARDRAIL</span><strong style={{ display: "block", marginTop: 5, fontSize: 10 }}>{macroTone}</strong></div>
          <div style={{ padding: 13, borderLeft: "1px solid var(--line)" }}><span style={{ color: "#657284", fontSize: 7 }}>DATA COVERAGE</span><strong style={{ display: "block", marginTop: 5, fontSize: 10 }}>{data ? `${data.scanned}/${data.universe} stocks · closing data` : "Checking universe…"}</strong></div>
        </div>

        <div className="setup-steps">
          <div><b>1</b><span><strong>Choose independently</strong><small>Long and short candidates compete on their own rules; cash remains valid.</small></span></div>
          <div><b>2</b><span><strong>Review the plan</strong><small>Check entry, invalidation, target, liquidity, and borrow.</small></span></div>
          <div><b>3</b><span><strong>Verify eligibility</strong><small>Short only when the official BEI list and broker borrow both confirm availability.</small></span></div>
        </div>

        <div style={{ display: "flex", gap: 7, padding: 12, overflowX: "auto", borderBottom: "1px solid var(--line)" }}>
          {(["all", "breakout", "pullback", "momentum", "reversal", "short_breakdown"] as SetupKey[]).map((key) => {
            const active = filter === key;
            const count = key === "all" ? data?.setups.length ?? 0 : counts[key] ?? 0;
            return <button key={key} onClick={() => setFilter(key)} style={{ flex: "0 0 auto", minHeight: 34, padding: "0 12px", border: `1px solid ${active ? "#48a6ff" : "#202b38"}`, background: active ? "#0a1b2d" : "#090d13", color: active ? "#eef6ff" : "#8390a0", fontSize: 8, cursor: "pointer" }}>{key === "all" ? "BEST SETUPS" : setupMeta[key].label} · {count}</button>;
          })}
        </div>

        <div className="setup-toolbar">
          <label><span>FIND A STOCK</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ticker or company…" aria-label="Filter setup results" /></label>
          <label><span>SORT BY</span><select value={sort} onChange={(event) => setSort(event.target.value as "score" | "volume" | "change")}><option value="score">Best score</option><option value="volume">Relative volume</option><option value="change">Daily move</option></select></label>
          <small>{loading ? "Scanning…" : `${visible.length} shown · updated ${data ? new Date(data.asOf).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" }) + " WIB" : "—"}`}</small>
        </div>

        {loading && <div style={{ minHeight: 330, display: "grid", placeContent: "center", color: "#778596", fontSize: 9 }}>SCANNING CLOSING PRICE, TREND, MOMENTUM, AND VOLUME…</div>}
        {!loading && !visible.length && <div style={{ minHeight: 330, display: "grid", placeContent: "center", justifyItems: "center", gap: 9, padding: 30, textAlign: "center" }}><strong style={{ fontSize: 12 }}>No qualified setups right now</strong><span style={{ color: "#778596", font: "400 10px var(--font-geist-sans)" }}>{data?.message ?? "That is a valid result—do not force a trade."}</span></div>}
        {!loading && visible.length > 0 && (
          <div className="quant-grid" style={{ display: "grid", gridTemplateColumns: "minmax(330px,.9fr) minmax(360px,1.1fr)" }}>
            <div style={{ maxHeight: 610, overflowY: "auto", borderRight: "1px solid var(--line)" }}>
              {visible.map((item) => {
                const meta = setupMeta[item.setup];
                const active = selected?.ticker === item.ticker;
                return (
                  <button key={item.ticker} onClick={() => setSelected(item)} style={{ width: "100%", display: "grid", gridTemplateColumns: "50px minmax(0,1fr) 70px", gap: 10, alignItems: "center", padding: "13px 14px", border: 0, borderBottom: "1px solid #151d27", borderLeft: `2px solid ${active ? meta.color : "transparent"}`, background: active ? "#0c131d" : "transparent", color: "inherit", textAlign: "left", cursor: "pointer" }}>
                    <strong style={{ color: meta.color, fontSize: 15 }}>{item.score}<small style={{ display: "block", marginTop: 3, color: "#657284", fontSize: 6 }}>{item.score >= 80 ? "STRONG" : item.score >= 65 ? "GOOD" : "EARLY"}</small></strong>
                    <span style={{ minWidth: 0 }}><b style={{ display: "block", fontSize: 11 }}>{item.ticker}</b><small style={{ display: "block", marginTop: 3, color: "#778596", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{meta.label} · {meta.subtitle}</small></span>
                    <span style={{ textAlign: "right" }}><b style={{ display: "block", fontSize: 10 }}>{price(item.close)}</b><small style={{ color: (item.change ?? 0) >= 0 ? "#43d4a3" : "#ff6678" }}>{pct(item.change)}</small></span>
                  </button>
                );
              })}
            </div>

            {selected && <div style={{ padding: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                <div><span style={{ color: setupMeta[selected.setup].color, fontSize: 8 }}>{setupMeta[selected.setup].label} · SCORE {selected.score}/100</span><h3 style={{ margin: "7px 0 3px", fontSize: 20 }}>{selected.ticker}</h3><small style={{ color: "#778596" }}>{selected.name}</small></div>
                <button onClick={() => onSelectStock?.(`${selected.ticker}.JK`)} style={{ minHeight: 32, padding: "0 11px", border: "1px solid #263547", background: "#0a111a", color: "#dce6f0", fontSize: 8, cursor: "pointer" }}>OPEN STOCK DETAIL →</button>
              </div>

              <div style={{ marginTop: 18, padding: 14, border: "1px solid #203248", background: "#08121d" }}>
                <span style={{ color: "#6f7f91", fontSize: 7 }}>POSSIBLE PLAN · NOT AN ORDER</span>
                <div className="setup-plan-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginTop: 11 }}>
                  {[["ENTRY AREA", `${price(selected.entryLow)}–${price(selected.entryHigh)}`], [selected.setup === "short_breakdown" ? "INVALID ABOVE" : "INVALID BELOW", price(selected.invalidation)], ["FIRST TARGET", price(selected.target)], ["RISK / REWARD", `1 : ${selected.riskReward.toFixed(1)}`]].map(([label, value]) => <div key={label}><span style={{ color: "#657284", fontSize: 7 }}>{label}</span><strong style={{ display: "block", marginTop: 5, fontSize: 11 }}>{value}</strong></div>)}
                </div>
              </div>

              <div className="setup-reason-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
                <div style={{ padding: 13, border: "1px solid var(--line)" }}><span style={{ color: "#657284", fontSize: 7 }}>WHY IT APPEARED</span>{selected.reasons.map((reason) => <p key={reason} style={{ margin: "8px 0 0", color: "#c2ccd7", font: "400 10px/1.45 var(--font-geist-sans)" }}>✓ {reason}</p>)}</div>
                <div style={{ padding: 13, border: "1px solid #3a2920", background: "#130e0a" }}><span style={{ color: "#ffb45e", fontSize: 7 }}>WHAT INVALIDATES THE IDEA</span><p style={{ margin: "8px 0 0", color: "#c7b6a1", font: "400 10px/1.5 var(--font-geist-sans)" }}>{selected.caution}</p></div>
              </div>

              <div className="setup-metrics" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 1, marginTop: 12, background: "var(--line)" }}>
                {[["CLOSE", price(selected.close)], ["RSI", selected.rsi?.toFixed(0) ?? "—"], ["REL. VOLUME", selected.relativeVolume === null ? "—" : `${selected.relativeVolume.toFixed(1)}×`], ["MARKET CAP", compact(selected.marketCap)]].map(([label, value]) => <div key={label} style={{ padding: 11, background: "#090d13" }}><span style={{ color: "#657284", fontSize: 7 }}>{label}</span><strong style={{ display: "block", marginTop: 5, fontSize: 10 }}>{value}</strong></div>)}
              </div>
            </div>}
          </div>
        )}
      </article>

      <WeeklyShortlist setups={data?.setups ?? []} />

      <article className="panel">
        <button onClick={() => setShowMethod((value) => !value)} style={{ width: "100%", display: "flex", justifyContent: "space-between", padding: "13px 15px", border: 0, background: "transparent", color: "#9ba8b7", fontSize: 8, cursor: "pointer" }}><span>HOW THE SCORE WORKS</span><span>{showMethod ? "HIDE ↑" : "SEE CALCULATION ↓"}</span></button>
        {showMethod && <div style={{ padding: "0 15px 15px", color: "#778596", font: "400 10px/1.6 var(--font-geist-sans)" }}>The shortlist uses closing-price structure, 20/50/200-day trends, RSI, relative volume, and recent highs/lows. Illiquid shares are filtered out. Optional shorts are capped at one, sized below longs, and require both official BEI eligibility and real borrow availability. The plan levels are mechanical research guides, not predictions. Always verify corporate actions, news, liquidity, and the live chart before entering.</div>}
      </article>

      <SimpleReplay />
    </section>
  );
}

type ReplayData = {
  status: string; currentActive: boolean; latestSignalDate: string | null;
  results: Array<{ horizon: number; signal: { observations: number; median: number | null; winRate: number | null }; baseline: { median: number | null }; edgeMedian: number | null }>;
  integrity: { completedSamples: number; minimumVisible: number; rating: string; note: string };
};
const replaySignals = [["jkse_pullback", "Market pullback"], ["jkse_trend_reclaim", "Market reclaims long-term trend"], ["dxy_surge", "US dollar surge"], ["oil_rally", "Oil rally"]] as const;
const replayTargets = [["JKSE", "Jakarta Composite"], ["ADRO", "ADRO"], ["PTBA", "PTBA"], ["ANTM", "ANTM"], ["BBCA", "BBCA"]] as const;
function returnPct(value: number | null) { return value === null ? "—" : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`; }

function SimpleReplay() {
  const [signal, setSignal] = useState("jkse_pullback");
  const [target, setTarget] = useState("JKSE");
  const [data, setData] = useState<ReplayData | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch(`/api/signal-replay?signal=${signal}&target=${target}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((value) => setData(value as ReplayData)).catch(() => setData(null)).finally(() => setLoading(false));
    return () => controller.abort();
  }, [signal, target]);
  const result = data?.results.find((row) => row.horizon === 20);
  return <article className="panel" style={{ overflow: "hidden" }}>
    <div style={{ padding: 15, borderBottom: "1px solid var(--line)" }}><span style={{ color: "#48a6ff", fontSize: 8 }}>HISTORICAL CHECK · BETA</span><h3 style={{ margin: "7px 0 4px", fontSize: 15 }}>What happened after similar market conditions?</h3><p style={{ margin: 0, color: "#778596", font: "400 10px var(--font-geist-sans)" }}>Use history to challenge an idea—not to guarantee the next return.</p></div>
    <div style={{ display: "flex", gap: 10, padding: 12, flexWrap: "wrap", borderBottom: "1px solid var(--line)" }}>
      <label style={{ display: "grid", gap: 5, color: "#657284", fontSize: 7 }}>WHEN THIS HAPPENED<select value={signal} onChange={(e) => setSignal(e.target.value)}>{replaySignals.map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <label style={{ display: "grid", gap: 5, color: "#657284", fontSize: 7 }}>CHECK THE NEXT RETURN OF<select value={target} onChange={(e) => setTarget(e.target.value)}>{replayTargets.map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label>
    </div>
    <div style={{ minHeight: 118, padding: 16 }}>
      {loading ? <span style={{ color: "#778596", fontSize: 9 }}>CHECKING HISTORY…</span> : result && data && data.integrity.rating !== "HIDDEN" ? <div>
        <strong style={{ display: "block", font: "600 16px/1.4 var(--font-geist-sans)" }}>Across {result.signal.observations} similar episodes, {Math.round((result.signal.winRate ?? 0) * 100)}% produced a positive 20-session return.</strong>
        <p style={{ color: "#8793a3", font: "400 11px/1.55 var(--font-geist-sans)" }}>Median return was {returnPct(result.signal.median)}, versus a normal baseline of {returnPct(result.baseline.median)}. Historical edge: {returnPct(result.edgeMedian)}. Sample quality: {data.integrity.rating.toLowerCase()}.</p>
      </div> : <span style={{ color: "#778596", fontSize: 9 }}>Not enough reliable historical episodes for this combination.</span>}
    </div>
  </article>;
}
