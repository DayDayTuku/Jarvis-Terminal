export type Detail = Record<string, any>;

export const TABS = ["Overview", "Financials", "Quality Scan", "Risk Scan", "Peers", "Scenarios", "Analyst"] as const;
export type Tab = (typeof TABS)[number];

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
export function fmtNum(value: unknown, decimals = 2, suffix = "") {
  const v = numeric(value);
  return v === null ? "—" : v.toFixed(decimals) + suffix;
}
export function fmtPct(value: unknown) {
  const v = numeric(value);
  return v === null ? "—" : (v * 100).toFixed(2) + "%";
}
export function fmtBig(value: unknown) {
  const v = numeric(value);
  if (v === null) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e12) return (v / 1e12).toFixed(2) + "T";
  if (abs >= 1e9) return (v / 1e9).toFixed(2) + "B";
  if (abs >= 1e6) return (v / 1e6).toFixed(2) + "M";
  return v.toLocaleString();
}


export function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function relativeValue(value: number | null, peerValues: number[]) {
  const benchmark = median(peerValues.filter((item) => item > 0));
  if (value === null || value === undefined || value <= 0 || !benchmark) return "INSUFFICIENT DATA";
  const difference = ((value / benchmark) - 1) * 100;
  if (Math.abs(difference) < 2) return "IN LINE WITH PEERS";
  return `${Math.abs(difference).toFixed(0)}% ${difference > 0 ? "PREMIUM" : "DISCOUNT"}`;
}
