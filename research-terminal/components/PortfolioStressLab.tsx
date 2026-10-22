"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { IDX_UNIVERSE } from "@/lib/idx-universe";
import { normalizeTicker } from "@/lib/workspace";
import { trackEvent } from "@/lib/analytics-client";

type InputRow = { id: string; ticker: string; value: string };
type StressData = {
  status: string;
  source: string;
  totalValue: number;
  coverage: { requested: number; analyzed: number; failures: string[] };
  summary: {
    annualVolatility: number;
    maxDrawdown1Y: number;
    diversificationScore: number;
    largestPosition: string;
    largestPositionWeight: number;
    topRiskContributor: string | null;
    topRiskContribution: number | null;
  };
  positions: Array<{
    ticker: string;
    shortTicker: string;
    name: string;
    sector: string;
    value: number;
    weight: number;
    price: number;
    annualVolatility: number;
    betas: Record<string, number | null>;
  }>;
  sectorWeights: Array<{ sector: string; weight: number }>;
  riskContributions: Array<{ ticker: string; contribution: number }>;
  scenarios: Array<{
    key: string;
    label: string;
    detail: string;
    shocks: Record<string, number>;
    estimatedReturn: number;
    estimatedPnl: number;
    positionImpacts: Array<{ ticker: string; estimatedReturn: number; pnl: number }>;
  }>;
  methodology: string;
};

const newRow = (): InputRow => ({ id: crypto.randomUUID(), ticker: "", value: "" });
const pct = (value: number | null, digits = 1) => value === null ? "—" : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;
const money = (value: number) => {
  const abs = Math.abs(value);
  const sign = value < 0 ? "−" : value > 0 ? "+" : "";
  if (abs >= 1e12) return `${sign}Rp${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}Rp${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}Rp${(abs / 1e6).toFixed(1)}M`;
  return `${sign}Rp${abs.toLocaleString("id-ID", { maximumFractionDigits: 0 })}`;
};

export default function PortfolioStressLab() {
  const [rows, setRows] = useState<InputRow[]>([newRow()]);
  const [data, setData] = useState<StressData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedScenario, setSelectedScenario] = useState("market_shock");
  const [syncStatus, setSyncStatus] = useState<"loading" | "synced" | "local">("loading");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    const loadLocal = () => {
      try {
        const saved = localStorage.getItem("jarvis_portfolio_positions");
        if (!saved) return [] as InputRow[];
        const parsed = JSON.parse(saved) as Array<{ ticker?: string; value?: string }>;
        if (!Array.isArray(parsed)) return [] as InputRow[];
        return parsed.slice(0, 8).map((row) => ({ id: crypto.randomUUID(), ticker: String(row.ticker ?? ""), value: String(row.value ?? "") }));
      } catch {
        return [] as InputRow[];
      }
    };

    fetch("/api/portfolio", { credentials: "same-origin" })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((payload: { portfolio?: { positions?: Array<{ ticker?: string; value?: number }> } | null }) => {
        if (cancelled) return;
        const positions = payload.portfolio?.positions ?? [];
        if (positions.length) {
          setRows(positions.slice(0, 8).map((row) => ({
            id: crypto.randomUUID(),
            ticker: String(row.ticker ?? ""),
            value: String(row.value ?? ""),
          })));
          setSyncStatus("synced");
        } else {
          const local = loadLocal();
          if (local.length) setRows(local);
          setSyncStatus("local");
        }
      })
      .catch(() => {
        if (cancelled) return;
        const local = loadLocal();
        if (local.length) setRows(local);
        setSyncStatus("local");
      });

    return () => { cancelled = true; };
  }, []);

  const importCsv = async (file: File) => {
    const text = await file.text();
    const imported: InputRow[] = [];
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const [tickerCell, ...rest] = line.split(/[;,\t]/);
      const ticker = normalizeTicker(tickerCell);
      const value = rest.join("").replace(/[^\d]/g, "");
      if (!ticker || !value) continue;
      imported.push({ id: crypto.randomUUID(), ticker, value });
    }
    if (!imported.length) {
      setError("No valid positions found. Use two columns: ticker and current value.");
      return;
    }
    setRows(imported.slice(0, 8));
    setError("");
  };

  const validRows = useMemo(() => rows.filter((row) => row.ticker.trim() && Number(row.value) > 0), [rows]);
  const update = (id: string, patch: Partial<InputRow>) => setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
  const analyze = async () => {
    if (!validRows.length) { setError("Add at least one IDX ticker and its current market value."); return; }
    setLoading(true);
    setError("");
    setData(null);
    try {
      localStorage.setItem("jarvis_portfolio_positions", JSON.stringify(rows.map(({ ticker, value }) => ({ ticker, value }))));
      const positions = validRows.map((row) => ({ ticker: row.ticker, value: Number(row.value) }));
      trackEvent("portfolio_save", { positions: positions.length });
      void fetch("/api/portfolio", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ positions }),
      })
        .then((response) => { if (response.ok) setSyncStatus("synced"); })
        .catch(() => setSyncStatus("local"));
      const response = await fetch("/api/portfolio-stress", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ positions: validRows.map((row) => ({ ticker: row.ticker, value: Number(row.value) })) }),
      });
      const payload = await response.json() as StressData & { error?: string };
      if (!response.ok) throw new Error(payload?.error ?? "Portfolio analysis failed.");
      setData(payload);
      setSelectedScenario("market_shock");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Portfolio analysis failed.");
    } finally {
      setLoading(false);
    }
  };
  const scenario = data?.scenarios.find((item) => item.key === selectedScenario) ?? data?.scenarios[0];

  const exportPortfolio = () => {
    const lines = ["ticker,current_value_idr", ...validRows.map((row) => `${row.ticker},${Number(row.value)}`)];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "jarvis-portfolio.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="portfolio-lab">
      <article className="panel portfolio-builder">
        <div className="suite-head">
          <div><span>PORTFOLIO STRESS LAB · BETA</span><h3>Find what can break the portfolio.</h3><p>Enter current market value—not cost basis. Saved to your account with a browser fallback.</p></div>
          <strong>{validRows.length}/8 POSITIONS · {syncStatus === "synced" ? "SYNCED" : syncStatus === "loading" ? "CHECKING" : "LOCAL"}</strong>
        </div>
        <div className="portfolio-input-head"><span>TICKER</span><span>CURRENT VALUE (IDR)</span><span /></div>
        {rows.map((row) => (
          <div className="portfolio-input-row" key={row.id}>
            <div>
              <input list="idx-tickers" value={row.ticker} onChange={(event) => update(row.id, { ticker: event.target.value.replace(".JK", "").toUpperCase() })} placeholder="BBCA" maxLength={8} />
            </div>
            <input inputMode="numeric" value={row.value} onChange={(event) => update(row.id, { value: event.target.value.replace(/[^0-9]/g, "") })} placeholder="50000000" />
            <button type="button" onClick={() => setRows((current) => current.length === 1 ? [newRow()] : current.filter((item) => item.id !== row.id))}>×</button>
          </div>
        ))}
        <datalist id="idx-tickers">{IDX_UNIVERSE.map((stock) => <option key={stock.ticker} value={stock.ticker.replace(".JK", "")}>{stock.name}</option>)}</datalist>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importCsv(file);
            event.target.value = "";
          }}
        />
        <div className="portfolio-actions">
          <button type="button" disabled={rows.length >= 8} onClick={() => setRows((current) => [...current, newRow()])}>+ ADD POSITION</button>
          <button type="button" onClick={() => fileRef.current?.click()}>IMPORT CSV</button>
          <button type="button" onClick={exportPortfolio} disabled={!validRows.length}>EXPORT CSV</button>
          <button type="button" className="primary" disabled={loading || !validRows.length} onClick={analyze}>{loading ? "ANALYZING…" : "RUN STRESS TEST"}</button>
        </div>
        {error && <div className="suite-error">{error}</div>}
      </article>

      {data && (
        <>
          <div className="portfolio-summary">
            {[
              ["PORTFOLIO VALUE", money(data.totalValue), "Analyzed current value"],
              ["ANNUALIZED VOL", pct(data.summary.annualVolatility), "Trailing 252 sessions"],
              ["MAX DRAWDOWN", pct(data.summary.maxDrawdown1Y), "Reconstructed trailing year"],
              ["DIVERSIFICATION", `${data.summary.diversificationScore.toFixed(0)}/100`, `Largest: ${data.summary.largestPosition} ${pct(data.summary.largestPositionWeight, 0)}`],
              ["TOP RISK DRIVER", data.summary.topRiskContributor ?? "—", pct(data.summary.topRiskContribution, 0) + " of standalone risk"],
            ].map(([label, value, note]) => <div key={label}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>)}
          </div>

          <article className="panel">
            <div className="scenario-switcher">
              <div><span>HISTORICAL-BETA SENSITIVITY</span><strong>Choose a shock</strong></div>
              <div>{data.scenarios.map((item) => <button key={item.key} className={selectedScenario === item.key ? "active" : ""} onClick={() => setSelectedScenario(item.key)}>{item.label}</button>)}</div>
            </div>
            {scenario && <div className="scenario-result">
              <div className="scenario-hero">
                <span>ESTIMATED PORTFOLIO IMPACT</span>
                <strong className={scenario.estimatedReturn >= 0 ? "positive" : "negative"}>{pct(scenario.estimatedReturn)}</strong>
                <b className={scenario.estimatedPnl >= 0 ? "positive" : "negative"}>{money(scenario.estimatedPnl)}</b>
                <p>{scenario.detail}</p>
                <small>{Object.entries(scenario.shocks).map(([key, value]) => `${key} ${pct(value, 0)}`).join(" · ")}</small>
              </div>
              <div className="scenario-positions">
                <div><span>POSITION</span><span>EST. RETURN</span><span>EST. P/L</span></div>
                {scenario.positionImpacts.map((position) => <div key={position.ticker}><strong>{position.ticker}</strong><span className={position.estimatedReturn >= 0 ? "positive" : "negative"}>{pct(position.estimatedReturn)}</span><span>{money(position.pnl)}</span></div>)}
              </div>
            </div>}
          </article>

          <div className="portfolio-detail-grid">
            <article className="panel">
              <div className="mini-head">POSITION RISK MAP</div>
              <div className="risk-map-row risk-map-labels"><span>TICKER</span><span>WEIGHT</span><span>VOL</span><span>β IDX</span><span>β FX</span><span>β OIL</span></div>
              {data.positions.map((position) => <div className="risk-map-row" key={position.ticker}><strong>{position.shortTicker}</strong><span>{pct(position.weight, 0)}</span><span>{pct(position.annualVolatility)}</span><span>{position.betas.JKSE?.toFixed(2) ?? "—"}</span><span>{position.betas.USDIDR?.toFixed(2) ?? "—"}</span><span>{position.betas.OIL?.toFixed(2) ?? "—"}</span></div>)}
            </article>
            <article className="panel">
              <div className="mini-head">CONCENTRATION</div>
              {[...data.sectorWeights.map((item) => ({ label: item.sector, value: item.weight, type: "SECTOR" })), ...data.riskContributions.slice(0, 3).map((item) => ({ label: item.ticker, value: item.contribution, type: "RISK" }))].map((item, index) => <div className="concentration-row" key={item.type + item.label + index}><div><span>{item.type}</span><strong>{item.label}</strong></div><div><i style={{ width: `${Math.min(100, item.value * 100)}%` }} /></div><b>{pct(item.value, 0)}</b></div>)}
            </article>
          </div>
          <div className="suite-method">{data.methodology} Coverage {data.coverage.analyzed}/{data.coverage.requested}; failed symbols are excluded rather than imputed.</div>
        </>
      )}
    </section>
  );
}
