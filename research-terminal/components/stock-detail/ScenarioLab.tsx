"use client";

import { useEffect, useState } from "react";
import type { IDXStock } from "@/lib/idx-universe";
import { fmtNum, median, type Detail } from "./shared";

type ScenarioCase = {
  label: "BEAR" | "BASE" | "BULL";
  growth: number;
  multiple: number;
  probability: number;
};

export default function ScenarioLab({
  ticker,
  data,
  peers,
  peersLoading,
}: {
  ticker: string;
  data: Detail;
  peers: Array<{ stock: IDXStock; detail: Detail | null }>;
  peersLoading: boolean;
}) {
  const peerMultiples = peers
    .map(({ detail }) => detail?.trailingPE)
    .filter((value): value is number => typeof value === "number" && value > 0 && value <= 300);
  const peerMedian = median(peerMultiples);
  const fallbackMultiple =
    typeof data.trailingPE === "number" && data.trailingPE > 0
      ? data.trailingPE
      : 10;
  const anchorMultiple = peerMedian ?? fallbackMultiple;
  const [edited, setEdited] = useState(false);
  const [cases, setCases] = useState<ScenarioCase[]>([
    { label: "BEAR", growth: -10, multiple: anchorMultiple * 0.75, probability: 25 },
    { label: "BASE", growth: 5, multiple: anchorMultiple, probability: 50 },
    { label: "BULL", growth: 18, multiple: anchorMultiple * 1.25, probability: 25 },
  ]);

  useEffect(() => {
    setEdited(false);
    setCases([
      { label: "BEAR", growth: -10, multiple: anchorMultiple * 0.75, probability: 25 },
      { label: "BASE", growth: 5, multiple: anchorMultiple, probability: 50 },
      { label: "BULL", growth: 18, multiple: anchorMultiple * 1.25, probability: 25 },
    ]);
  }, [ticker, anchorMultiple]);

  useEffect(() => {
    if (edited) return;
    setCases((current) =>
      current.map((item) => ({
        ...item,
        multiple:
          item.label === "BEAR"
            ? anchorMultiple * 0.75
            : item.label === "BULL"
              ? anchorMultiple * 1.25
              : anchorMultiple,
      }))
    );
  }, [anchorMultiple, edited]);

  const eps = typeof data.eps === "number" && data.eps > 0 ? data.eps : null;
  const price =
    typeof data.regularMarketPrice === "number" && data.regularMarketPrice > 0
      ? data.regularMarketPrice
      : null;
  const results = cases.map((item) => {
    const forwardEps = eps === null ? null : eps * (1 + item.growth / 100);
    const target = forwardEps === null ? null : Math.max(0, forwardEps * item.multiple);
    const upside = target !== null && price ? ((target / price) - 1) * 100 : null;
    return { ...item, forwardEps, target, upside };
  });
  const weightedTarget = results.every((item) => item.target !== null)
    ? results.reduce((sum, item) => sum + (item.target ?? 0) * item.probability / 100, 0)
    : null;
  const weightedUpside =
    weightedTarget !== null && price ? ((weightedTarget / price) - 1) * 100 : null;
  const signal =
    weightedUpside === null
      ? "INSUFFICIENT DATA"
      : weightedUpside >= 25
        ? "WIDE MARGIN OF SAFETY"
        : weightedUpside >= 10
          ? "POSITIVE ASYMMETRY"
          : weightedUpside > -10
            ? "LIMITED EDGE"
            : "DOWNSIDE DOMINATES";
  const signalColor =
    weightedUpside === null
      ? "#778596"
      : weightedUpside >= 10
        ? "#43d4a3"
        : weightedUpside > -10
          ? "#ffb45e"
          : "#ff6678";

  const updateCase = (
    index: number,
    field: "growth" | "multiple",
    value: number
  ) => {
    setEdited(true);
    setCases((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item
      )
    );
  };

  if (!eps || !price) {
    return (
      <div style={{ minHeight: 260, display: "grid", placeContent: "center", textAlign: "center", gap: 10 }}>
        <strong style={{ color: "#ff9840", fontSize: 11, letterSpacing: ".08em" }}>SCENARIO MODEL NEEDS LIVE EPS + PRICE</strong>
        <span style={{ maxWidth: 430, color: "#778596", fontSize: 10, lineHeight: 1.6 }}>
          The model will not invent targets while Yahoo fundamentals are degraded. Retry the data connection, then reopen this tab.
        </span>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <div style={{ color: "#48a6ff", fontSize: 9, fontWeight: 700, letterSpacing: ".08em" }}>
          12-MONTH VALUATION SCENARIO LAB
        </div>
        <div style={{ marginTop: 5, color: "#778596", fontSize: 9, lineHeight: 1.55 }}>
          Target price = EPS TTM × (1 + growth assumption) × target P/E.
          {peerMedian
            ? ` Base P/E is anchored to the ${peerMedian.toFixed(2)}× same-sector peer median.`
            : " Peer median is unavailable; current P/E is used as the temporary anchor."}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
        {results.map((item, index) => {
          const color =
            item.label === "BEAR" ? "#ff6678" : item.label === "BULL" ? "#43d4a3" : "#48a6ff";
          return (
            <section key={item.label} style={{ border: `1px solid ${color}55`, background: "#080d14", minWidth: 0 }}>
              <header style={{ padding: "8px 10px", borderBottom: "1px solid #182332", color, fontSize: 9, fontWeight: 800, letterSpacing: ".1em" }}>
                {item.label} · {item.probability}%
              </header>
              <div style={{ padding: 10, display: "grid", gap: 9 }}>
                <label style={{ display: "grid", gap: 4, color: "#778596", fontSize: 7 }}>
                  EPS GROWTH
                  <div style={{ display: "flex", alignItems: "center", border: "1px solid #233041", background: "#05080c" }}>
                    <input
                      type="number"
                      value={Number(item.growth.toFixed(1))}
                      step="1"
                      min="-90"
                      max="200"
                      onChange={(event) => updateCase(index, "growth", Number(event.target.value))}
                      style={{ width: "100%", minWidth: 0, border: 0, outline: 0, background: "transparent", color: "#fff", padding: "7px 8px", font: "600 11px var(--font-geist-mono)" }}
                    />
                    <span style={{ paddingRight: 7 }}>%</span>
                  </div>
                </label>
                <label style={{ display: "grid", gap: 4, color: "#778596", fontSize: 7 }}>
                  TARGET P/E
                  <div style={{ display: "flex", alignItems: "center", border: "1px solid #233041", background: "#05080c" }}>
                    <input
                      type="number"
                      value={Number(item.multiple.toFixed(2))}
                      step="0.5"
                      min="0"
                      max="300"
                      onChange={(event) => updateCase(index, "multiple", Number(event.target.value))}
                      style={{ width: "100%", minWidth: 0, border: 0, outline: 0, background: "transparent", color: "#fff", padding: "7px 8px", font: "600 11px var(--font-geist-mono)" }}
                    />
                    <span style={{ paddingRight: 7 }}>×</span>
                  </div>
                </label>
                <div style={{ paddingTop: 8, borderTop: "1px solid #182332" }}>
                  <span style={{ display: "block", color: "#536171", fontSize: 7 }}>TARGET PRICE</span>
                  <strong style={{ display: "block", marginTop: 4, color: "#fff", fontSize: 17 }}>{fmtNum(item.target, 0)}</strong>
                  <span style={{ display: "block", marginTop: 3, color: (item.upside ?? 0) >= 0 ? "#43d4a3" : "#ff6678", fontSize: 9, fontWeight: 700 }}>
                    {item.upside === null ? "—" : `${item.upside >= 0 ? "+" : ""}${item.upside.toFixed(1)}%`}
                  </span>
                </div>
              </div>
            </section>
          );
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.1fr .9fr", border: "1px solid #235886", background: "linear-gradient(90deg, #091522, #071019)" }}>
        <div style={{ padding: "13px 14px", borderRight: "1px solid #1d344a" }}>
          <span style={{ display: "block", color: "#778596", fontSize: 7, letterSpacing: ".08em" }}>PROBABILITY-WEIGHTED VALUE</span>
          <strong style={{ display: "block", marginTop: 5, color: "#fff", fontSize: 20 }}>{fmtNum(weightedTarget, 0)} <small style={{ color: "#778596", fontSize: 8 }}>IDR</small></strong>
        </div>
        <div style={{ padding: "13px 14px" }}>
          <span style={{ display: "block", color: "#778596", fontSize: 7, letterSpacing: ".08em" }}>DECISION SIGNAL</span>
          <strong style={{ display: "block", marginTop: 5, color: signalColor, fontSize: 10 }}>{signal}</strong>
          <span style={{ display: "block", marginTop: 4, color: signalColor, fontSize: 9 }}>
            {weightedUpside === null ? "—" : `${weightedUpside >= 0 ? "+" : ""}${weightedUpside.toFixed(1)}% VS SPOT`}
          </span>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, color: "#536171", fontSize: 7, lineHeight: 1.5 }}>
        <span>ASSUMPTION MODEL · NOT AN INVESTMENT RECOMMENDATION</span>
        <span style={{ textAlign: "right" }}>
          {peersLoading ? "LOADING PEER ANCHOR…" : peerMedian ? `${peerMultiples.length} PEERS IN MEDIAN` : "CURRENT MULTIPLE ANCHOR"}
        </span>
      </div>
    </div>
  );
}
