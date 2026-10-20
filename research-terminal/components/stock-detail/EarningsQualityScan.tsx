"use client";

import type { Detail } from "./shared";

type QualityTone = "strong" | "watch" | "risk";
type QualityEvidence = { label: string; value: string; detail: string; tone: QualityTone };

export default function EarningsQualityScan({ data }: { data: Detail }) {
  const history = Array.isArray(data.financialHistory) ? data.financialHistory.filter((row: any) => row && row.fiscalYear) : [];
  const latest = history[0];
  const prior = history[1];
  const checks: QualityEvidence[] = [];
  const number = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
  const growth = (current: unknown, previous: unknown) => number(current) && number(previous) && previous !== 0 ? current / previous - 1 : null;
  const push = (label: string, value: string, detail: string, tone: QualityTone) => checks.push({ label, value, detail, tone });

  if (latest && number(latest.operatingCashflow) && number(latest.netIncome)) {
    const conversion = latest.netIncome > 0 ? latest.operatingCashflow / latest.netIncome : null;
    if (conversion === null) push("Cash conversion", "NEGATIVE EARNINGS", "Positive accounting earnings are required before cash conversion is meaningful.", "risk");
    else if (conversion >= 1) push("Cash conversion", `${conversion.toFixed(2)}×`, "Operating cash flow fully covers reported net income.", "strong");
    else if (conversion >= 0.7) push("Cash conversion", `${conversion.toFixed(2)}×`, "Cash conversion is acceptable but leaves limited margin.", "watch");
    else push("Cash conversion", `${conversion.toFixed(2)}×`, "Reported earnings materially exceed operating cash generation.", "risk");
  }
  if (latest && number(latest.netIncome) && number(latest.operatingCashflow) && number(latest.totalAssets) && latest.totalAssets) {
    const accrual = (latest.netIncome - latest.operatingCashflow) / latest.totalAssets;
    if (accrual <= 0) push("Accrual load", pctQuality(accrual), "Cash generation exceeds accounting earnings relative to assets.", "strong");
    else if (accrual <= 0.05) push("Accrual load", pctQuality(accrual), "Positive accruals remain within a moderate range.", "watch");
    else push("Accrual load", pctQuality(accrual), "Large positive accruals increase earnings-quality risk.", "risk");
  }
  if (latest && prior) {
    const revenueGrowth = growth(latest.totalRevenue, prior.totalRevenue);
    const receivableGrowth = growth(latest.receivables, prior.receivables);
    if (revenueGrowth !== null && receivableGrowth !== null) {
      const gap = receivableGrowth - revenueGrowth;
      if (gap <= 0.05) push("Receivables vs sales", `${pctQuality(receivableGrowth)} vs ${pctQuality(revenueGrowth)}`, "Receivables are not materially outrunning revenue.", "strong");
      else if (gap <= 0.15) push("Receivables vs sales", `${pctQuality(receivableGrowth)} vs ${pctQuality(revenueGrowth)}`, "Receivables are growing faster than sales; monitor collection.", "watch");
      else push("Receivables vs sales", `${pctQuality(receivableGrowth)} vs ${pctQuality(revenueGrowth)}`, "Receivables growth materially exceeds revenue growth.", "risk");
    }
    const inventoryGrowth = growth(latest.inventory, prior.inventory);
    if (revenueGrowth !== null && inventoryGrowth !== null) {
      const gap = inventoryGrowth - revenueGrowth;
      if (gap <= 0.05) push("Inventory vs sales", `${pctQuality(inventoryGrowth)} vs ${pctQuality(revenueGrowth)}`, "Inventory growth is aligned with or below revenue.", "strong");
      else if (gap <= 0.15) push("Inventory vs sales", `${pctQuality(inventoryGrowth)} vs ${pctQuality(revenueGrowth)}`, "Inventory is building moderately faster than sales.", "watch");
      else push("Inventory vs sales", `${pctQuality(inventoryGrowth)} vs ${pctQuality(revenueGrowth)}`, "Inventory build materially exceeds sales growth.", "risk");
    }
    if (number(latest.grossProfit) && number(latest.totalRevenue) && latest.totalRevenue && number(prior.grossProfit) && number(prior.totalRevenue) && prior.totalRevenue) {
      const latestMargin = latest.grossProfit / latest.totalRevenue;
      const priorMargin = prior.grossProfit / prior.totalRevenue;
      const change = latestMargin - priorMargin;
      if (change >= 0) push("Gross margin trend", `${pctQuality(latestMargin)} · ${pctQuality(change)} YoY`, "Gross margin is stable or expanding.", "strong");
      else if (change >= -0.02) push("Gross margin trend", `${pctQuality(latestMargin)} · ${pctQuality(change)} YoY`, "Gross margin compression remains moderate.", "watch");
      else push("Gross margin trend", `${pctQuality(latestMargin)} · ${pctQuality(change)} YoY`, "Material gross-margin compression weakens earnings quality.", "risk");
    }
  }
  if (latest && number(latest.operatingCashflow) && number(latest.capex)) {
    const freeCash = latest.operatingCashflow - Math.abs(latest.capex);
    if (freeCash > 0) push("Free cash after capex", qualityBig(freeCash), "Operating cash flow covers reported capital expenditure.", "strong");
    else push("Free cash after capex", qualityBig(freeCash), "Capital expenditure exceeds operating cash generation.", "risk");
  }

  const points = checks.reduce((sum, check) => sum + (check.tone === "strong" ? 2 : check.tone === "watch" ? 1 : 0), 0);
  const score = checks.length ? Math.round(points / (checks.length * 2) * 100) : null;
  const verdict = score === null ? "INSUFFICIENT DATA" : score >= 75 ? "STRONG CASH EVIDENCE" : score >= 50 ? "MIXED QUALITY" : "QUALITY RISK";
  const verdictTone = score === null ? "watch" : score >= 75 ? "strong" : score >= 50 ? "watch" : "risk";

  if (!latest || checks.length < 2) {
    return <div className="quality-empty"><strong>EARNINGS QUALITY UNAVAILABLE</strong><p>The free source did not return enough multi-year statements. Jarvis will not manufacture a quality score from missing data.</p></div>;
  }

  return <div className="quality-scan">
    <div className="quality-hero">
      <div><span>EARNINGS QUALITY · BETA</span><strong className={verdictTone}>{verdict}</strong><p>Evidence score {score ?? "—"}/100 · {checks.length} checks · latest FY {latest.fiscalYear}</p></div>
      <div><span>WHAT THIS TESTS</span><p>Whether reported profit is supported by cash, working capital, and margins—not whether the stock is cheap.</p></div>
    </div>
    <div className="quality-checks">
      {checks.map((check) => <div className="quality-check" key={check.label}><i className={check.tone} /><div><span>{check.label}</span><strong>{check.value}</strong><p>{check.detail}</p></div></div>)}
    </div>
    <div className="quality-history">
      <div className="quality-history-row head"><span>FY</span><span>REVENUE</span><span>NET INCOME</span><span>OPERATING CF</span><span>CF / NI</span></div>
      {history.map((row: any) => {
        const conversion = number(row.operatingCashflow) && number(row.netIncome) && row.netIncome > 0 ? row.operatingCashflow / row.netIncome : null;
        return <div className="quality-history-row" key={row.fiscalYear}><strong>{row.fiscalYear}</strong><span>{qualityBig(row.totalRevenue)}</span><span>{qualityBig(row.netIncome)}</span><span>{qualityBig(row.operatingCashflow)}</span><span>{conversion === null ? "—" : `${conversion.toFixed(2)}×`}</span></div>;
      })}
    </div>
    <div className="quality-note">Score uses only returned annual statements and transparent rules. Missing checks are excluded, not treated as good. Financial institutions require sector-specific interpretation; always verify against audited filings.</div>
  </div>;
}
function pctQuality(value: number) { return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`; }
function qualityBig(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const absolute = Math.abs(value), sign = value < 0 ? "−" : "";
  return absolute >= 1e12 ? `${sign}${(absolute / 1e12).toFixed(2)}T` : absolute >= 1e9 ? `${sign}${(absolute / 1e9).toFixed(1)}B` : absolute >= 1e6 ? `${sign}${(absolute / 1e6).toFixed(1)}M` : `${sign}${absolute.toFixed(0)}`;
}
