"use client";

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
      <header className="view-heading">
        <div><span>MODELS / BETA</span><h2>Quant Lab</h2></div>
        <p>Transparent cross-asset and IDX breadth signals. No black-box prediction.</p>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "1.15fr repeat(3,minmax(0,1fr))", border: "1px solid var(--line-strong)", background: "#070a0f" }}>
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

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.2fr) minmax(0,.8fr)", gap: 12 }}>
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

      <div style={{ padding: "10px 12px", border: "1px solid #1b2a3a", background: "#071019", color: "#657284", fontSize: 8, lineHeight: 1.6 }}>
        MODEL: equal-weighted IDX breadth, JKSE 1M momentum, inverse DXY 1M momentum, growth z-score, and inverse inflation z-score. Score is descriptive—not a forecast or trading recommendation. {markets ? `Markets updated ${markets.freshness}.` : "Market feed unavailable."} {fred ? `Macro updated ${fred.freshness}.` : "Macro feed unavailable."}
      </div>
    </section>
  );
}
