// components/StockDetailModal.tsx (v2 — Bloomberg Terminal Grade)
"use client";

import { useEffect, useState } from "react";

type Detail = Record<string, any>;

function fmtNum(v: number | null, decimals = 2, suffix = "") {
  if (v === null || v === undefined) return "—";
  return v.toFixed(decimals) + suffix;
}

function fmtPct(v: number | null) {
  if (v === null || v === undefined) return "—";
  return (v * 100).toFixed(2) + "%";
}

function fmtBig(v: number | null) {
  if (v === null || v === undefined) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e12) return (v / 1e12).toFixed(2) + "T";
  if (abs >= 1e9) return (v / 1e9).toFixed(2) + "B";
  if (abs >= 1e6) return (v / 1e6).toFixed(2) + "M";
  return v.toLocaleString();
}

const TABS = ["Overview", "Financials", "Analyst"] as const;
type Tab = (typeof TABS)[number];

const COLOR_MAP: Record<string, string> = {
  "bg-green-500": "#22c55e",
  "bg-green-700": "#15803d",
  "bg-neutral-600": "#525252",
  "bg-red-700": "#b91c1c",
  "bg-red-500": "#ef4444",
};

export default function StockDetailModal({
  ticker,
  onClose,
  onAddToWatchlist,
  isInWatchlist,
}: {
  ticker: string;
  onClose: () => void;
  onAddToWatchlist: (ticker: string) => void;
  isInWatchlist: boolean;
}) {
  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("Overview");

  useEffect(() => {
    setLoading(true);
    setError(null);
    setTab("Overview");

    const controller = new AbortController();
    fetch(`/api/stock-detail?ticker=${encodeURIComponent(ticker)}`, {
      signal: controller.signal,
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: any) => (d?.error ? setError(d.error) : setData(d)))
      .catch((err: any) => {
        if (err?.name !== "AbortError") {
          setError("Failed to load stock data from Yahoo Finance");
        }
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [ticker]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const na = (field: string) => data?.unavailable?.includes(field);

  return (
    <div
      className="stock-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(3, 5, 7, 0.85)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: "16px",
      }}
    >
      <div
        className="stock-modal-content"
        style={{
          backgroundColor: "#07090d",
          border: "1px solid #283548",
          boxShadow: "0 24px 64px rgba(0,0,0,0.9), 0 0 30px rgba(72,166,255,0.15)",
          maxWidth: "680px",
          width: "100%",
          maxHeight: "88vh",
          display: "flex",
          flexDirection: "column",
          borderRadius: "4px",
          fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
          color: "#e8edf3",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            borderBottom: "1px solid #1c2635",
            padding: "14px 18px",
            backgroundColor: "#0a0f16",
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span
                style={{
                  color: "#48a6ff",
                  fontWeight: 700,
                  fontSize: "18px",
                  letterSpacing: "0.06em",
                }}
              >
                {ticker.replace(".JK", "")}
              </span>
              <span
                style={{
                  fontSize: "9px",
                  color: "#05101b",
                  backgroundColor: "#48a6ff",
                  padding: "2px 6px",
                  borderRadius: "2px",
                  fontWeight: 700,
                }}
              >
                IDX TERMINAL
              </span>
            </div>
            {data ? (
              <div
                style={{
                  color: "#8393a6",
                  fontSize: "11px",
                  marginTop: "3px",
                  fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
                }}
              >
                {data.name}
                {data.sector && ` · ${data.sector}`}
                {data.industry && ` · ${data.industry}`}
              </div>
            ) : (
              <div style={{ color: "#546577", fontSize: "11px", marginTop: "3px" }}>
                Loading security fundamentals...
              </div>
            )}
          </div>

          <button
            onClick={onClose}
            aria-label="Close modal"
            style={{
              background: "transparent",
              border: "1px solid #233041",
              color: "#8393a6",
              cursor: "pointer",
              fontSize: "18px",
              width: "28px",
              height: "28px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "3px",
              lineHeight: 1,
              transition: "all 0.15s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "#fff";
              e.currentTarget.style.borderColor = "#48a6ff";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "#8393a6";
              e.currentTarget.style.borderColor = "#233041";
            }}
          >
            ×
          </button>
        </div>

        {/* Scrollable Body */}
        <div style={{ overflowY: "auto", flex: 1, padding: "0 0 16px" }}>
          {loading && (
            <div
              style={{
                padding: "48px 20px",
                textAlign: "center",
                color: "#8393a6",
                fontSize: "12px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "12px",
              }}
            >
              <div
                style={{
                  width: "20px",
                  height: "20px",
                  border: "2px solid #233041",
                  borderTopColor: "#48a6ff",
                  borderRadius: "50%",
                  animation: "spin 0.8s linear infinite",
                }}
              />
              <span>QUERYING YAHOO FINANCE MODULES FOR {ticker}...</span>
            </div>
          )}

          {error && (
            <div
              style={{
                padding: "36px 20px",
                textAlign: "center",
                color: "#ff6678",
                fontSize: "12px",
              }}
            >
              <div style={{ marginBottom: "8px", fontSize: "18px" }}>⚠</div>
              <div>{error}</div>
              <button
                onClick={onClose}
                style={{
                  marginTop: "16px",
                  background: "#181f2a",
                  border: "1px solid #303d4f",
                  color: "#e8edf3",
                  padding: "6px 14px",
                  fontSize: "11px",
                  cursor: "pointer",
                }}
              >
                Close
              </button>
            </div>
          )}

          {data && !loading && !error && (
            <>
              {/* Price strip */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  padding: "12px 18px",
                  borderBottom: "1px solid #1c2635",
                  backgroundColor: "#080c11",
                }}
              >
                <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
                  <span
                    style={{
                      fontSize: "24px",
                      fontWeight: 700,
                      color: "#fff",
                      letterSpacing: "0.02em",
                    }}
                  >
                    {fmtNum(data.regularMarketPrice, 0)}
                  </span>
                  <span style={{ fontSize: "11px", color: "#607286" }}>
                    {data.currency || "IDR"}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: "14px",
                    fontWeight: 600,
                    color:
                      (data.regularMarketChangePercent ?? 0) >= 0
                        ? "#43d4a3"
                        : "#ff6678",
                  }}
                >
                  {data.regularMarketChangePercent !== null
                    ? ((data.regularMarketChangePercent >= 0 ? "+" : "") +
                      fmtNum(data.regularMarketChangePercent, 2, "%"))
                    : "—"}
                </div>
              </div>

              {/* Tabs */}
              <div
                style={{
                  display: "flex",
                  borderBottom: "1px solid #1c2635",
                  backgroundColor: "#07090d",
                  padding: "0 10px",
                }}
              >
                {TABS.map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    style={{
                      padding: "10px 16px",
                      fontSize: "11px",
                      fontWeight: tab === t ? 600 : 400,
                      color: tab === t ? "#48a6ff" : "#728396",
                      background: "transparent",
                      border: "none",
                      borderBottom: tab === t ? "2px solid #48a6ff" : "2px solid transparent",
                      cursor: "pointer",
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      transition: "all 0.15s ease",
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>

              <div style={{ padding: "16px 18px" }}>
                {tab === "Overview" && (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      columnGap: "24px",
                      rowGap: "8px",
                      fontSize: "11px",
                    }}
                  >
                    <Row label="Market Cap" value={fmtBig(data.marketCap)} na={na("marketCap")} />
                    <Row label="Volume / Avg" value={`${fmtBig(data.volume)} / ${fmtBig(data.avgVolume)}`} na={na("volume")} />
                    <Row label="Day Range" value={`${fmtNum(data.dayLow, 0)} – ${fmtNum(data.dayHigh, 0)}`} na={na("dayLow")} />
                    <Row label="52W Range" value={`${fmtNum(data.fiftyTwoWeekLow, 0)} – ${fmtNum(data.fiftyTwoWeekHigh, 0)}`} na={na("fiftyTwoWeekLow")} />
                    <Row label="Trailing P/E" value={fmtNum(data.trailingPE)} na={na("trailingPE")} />
                    <Row label="Forward P/E" value={fmtNum(data.forwardPE)} na={na("forwardPE")} />
                    <Row label="P/B Ratio" value={fmtNum(data.priceToBook)} na={na("priceToBook")} />
                    <Row label="PEG Ratio" value={fmtNum(data.pegRatio)} na={na("pegRatio")} />
                    <Row label="EPS (TTM)" value={fmtNum(data.eps)} na={na("eps")} />
                    <Row label="Book Value" value={fmtNum(data.bookValue)} na={na("bookValue")} />
                    <Row label="Dividend Yield" value={data.dividendYield !== null ? fmtPct(data.dividendYield) : "—"} na={na("dividendYield")} />
                    <Row label="Payout Ratio" value={data.payoutRatio !== null ? fmtPct(data.payoutRatio) : "—"} na={na("payoutRatio")} />
                    <Row label="Beta" value={fmtNum(data.beta)} na={na("beta")} />
                    <Row label="Employees" value={data.employees ? data.employees.toLocaleString() : "—"} na={na("employees")} />
                    <Row label="Next Earnings" value={data.nextEarningsDate ?? "—"} na={na("nextEarningsDate")} />
                  </div>
                )}

                {tab === "Financials" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "16px", fontSize: "11px" }}>
                    <div>
                      <div
                        style={{
                          color: "#48a6ff",
                          marginBottom: "8px",
                          fontSize: "10px",
                          letterSpacing: "0.08em",
                          fontWeight: 600,
                          textTransform: "uppercase",
                        }}
                      >
                        Profitability & Margins
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr",
                          columnGap: "24px",
                          rowGap: "8px",
                        }}
                      >
                        <Row label="Revenue (TTM)" value={fmtBig(data.revenue)} na={na("revenue")} />
                        <Row label="Revenue Growth" value={data.revenueGrowth !== null ? fmtPct(data.revenueGrowth) : "—"} na={na("revenueGrowth")} />
                        <Row label="Gross Profit" value={fmtBig(data.grossProfit)} na={na("grossProfit")} />
                        <Row label="EBITDA" value={fmtBig(data.ebitda)} na={na("ebitda")} />
                        <Row label="Profit Margin" value={data.profitMargin !== null ? fmtPct(data.profitMargin) : "—"} na={na("profitMargin")} />
                        <Row label="Operating Margin" value={data.operatingMargin !== null ? fmtPct(data.operatingMargin) : "—"} na={na("operatingMargin")} />
                        <Row label="ROA" value={data.returnOnAssets !== null ? fmtPct(data.returnOnAssets) : "—"} na={na("returnOnAssets")} />
                        <Row label="ROE" value={data.returnOnEquity !== null ? fmtPct(data.returnOnEquity) : "—"} na={na("returnOnEquity")} />
                      </div>
                    </div>

                    <div>
                      <div
                        style={{
                          color: "#48a6ff",
                          marginBottom: "8px",
                          fontSize: "10px",
                          letterSpacing: "0.08em",
                          fontWeight: 600,
                          textTransform: "uppercase",
                        }}
                      >
                        Balance Sheet & Cash Flow
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr",
                          columnGap: "24px",
                          rowGap: "8px",
                        }}
                      >
                        <Row label="Total Debt" value={fmtBig(data.totalDebt)} na={na("totalDebt")} />
                        <Row label="Total Cash" value={fmtBig(data.totalCash)} na={na("totalCash")} />
                        <Row label="Debt / Equity" value={fmtNum(data.debtToEquity)} na={na("debtToEquity")} />
                        <Row label="Current Ratio" value={fmtNum(data.currentRatio)} na={na("currentRatio")} />
                        <Row label="Quick Ratio" value={fmtNum(data.quickRatio)} na={na("quickRatio")} />
                        <Row label="Free Cash Flow" value={fmtBig(data.freeCashflow)} na={na("freeCashflow")} />
                        <Row label="Operating Cash Flow" value={fmtBig(data.operatingCashflow)} na={na("operatingCashflow")} />
                        <Row label="Enterprise Value" value={fmtBig(data.enterpriseValue)} na={na("enterpriseValue")} />
                      </div>
                    </div>

                    {data.latestFinancials && (
                      <div>
                        <div
                          style={{
                            color: "#48a6ff",
                            marginBottom: "8px",
                            fontSize: "10px",
                            letterSpacing: "0.08em",
                            fontWeight: 600,
                            textTransform: "uppercase",
                          }}
                        >
                          Latest Financial Statement {data.latestFinancials.fiscalYear ? `(${data.latestFinancials.fiscalYear})` : ""}
                        </div>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "1fr 1fr",
                            columnGap: "24px",
                            rowGap: "8px",
                          }}
                        >
                          <Row label="Total Revenue" value={fmtBig(data.latestFinancials.totalRevenue)} />
                          <Row label="Net Income" value={fmtBig(data.latestFinancials.netIncome)} />
                          <Row label="Operating Income" value={fmtBig(data.latestFinancials.operatingIncome)} />
                          <Row label="Total Assets" value={fmtBig(data.latestFinancials.totalAssets)} />
                          <Row label="Total Liabilities" value={fmtBig(data.latestFinancials.totalLiabilities)} />
                          <Row label="Shareholder Equity" value={fmtBig(data.latestFinancials.totalStockholderEquity)} />
                          <Row label="CapEx" value={fmtBig(data.latestFinancials.capex)} />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {tab === "Analyst" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "16px", fontSize: "11px" }}>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        columnGap: "24px",
                        rowGap: "8px",
                      }}
                    >
                      <Row label="Recommendation" value={data.recommendationKey ? data.recommendationKey.toUpperCase() : "—"} na={na("recommendationKey")} />
                      <Row label="Analysts Covering" value={data.numberOfAnalystOpinions?.toString() ?? "—"} na={na("numberOfAnalystOpinions")} />
                      <Row label="Target Mean Price" value={fmtNum(data.targetMeanPrice, 0)} na={na("targetMeanPrice")} />
                      <Row label="Target Range" value={`${fmtNum(data.targetLowPrice, 0)} – ${fmtNum(data.targetHighPrice, 0)}`} na={na("targetLowPrice")} />
                    </div>

                    {(data.strongBuy !== null || data.buy !== null) && (
                      <div style={{ marginTop: "8px" }}>
                        <div
                          style={{
                            color: "#48a6ff",
                            marginBottom: "10px",
                            fontSize: "10px",
                            letterSpacing: "0.08em",
                            fontWeight: 600,
                            textTransform: "uppercase",
                          }}
                        >
                          Analyst Consensus Ratings Breakdown
                        </div>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(5, 1fr)",
                            gap: "8px",
                            textAlign: "center",
                          }}
                        >
                          <RatingBar label="Strong Buy" value={data.strongBuy} colorKey="bg-green-500" />
                          <RatingBar label="Buy" value={data.buy} colorKey="bg-green-700" />
                          <RatingBar label="Hold" value={data.hold} colorKey="bg-neutral-600" />
                          <RatingBar label="Sell" value={data.sell} colorKey="bg-red-700" />
                          <RatingBar label="Strong Sell" value={data.strongSell} colorKey="bg-red-500" />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {data.unavailable?.length > 0 && (
                  <div
                    style={{
                      color: "#546577",
                      fontSize: "9px",
                      borderTop: "1px solid #1c2635",
                      paddingTop: "10px",
                      marginTop: "16px",
                      lineHeight: 1.4,
                    }}
                  >
                    Unavailable from Yahoo Finance public feed: {data.unavailable.slice(0, 8).join(", ")}
                    {data.unavailable.length > 8 && ` +${data.unavailable.length - 8} more`}
                  </div>
                )}

                {/* Add to Watchlist Button */}
                <button
                  onClick={() => onAddToWatchlist(ticker)}
                  disabled={isInWatchlist}
                  style={{
                    width: "100%",
                    padding: "10px",
                    marginTop: "18px",
                    fontSize: "11px",
                    fontWeight: 700,
                    letterSpacing: "0.06em",
                    cursor: isInWatchlist ? "not-allowed" : "pointer",
                    border: isInWatchlist ? "1px solid #233041" : "1px solid #48a6ff",
                    backgroundColor: isInWatchlist ? "#0d131a" : "#12263d",
                    color: isInWatchlist ? "#58697b" : "#48a6ff",
                    transition: "all 0.15s ease",
                  }}
                  onMouseEnter={(e) => {
                    if (!isInWatchlist) {
                      e.currentTarget.style.backgroundColor = "#48a6ff";
                      e.currentTarget.style.color = "#04101b";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isInWatchlist) {
                      e.currentTarget.style.backgroundColor = "#12263d";
                      e.currentTarget.style.color = "#48a6ff";
                    }
                  }}
                >
                  {isInWatchlist ? "✓ INCLUDED IN WATCHLIST" : "+ ADD SECURITY TO WATCHLIST"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, na }: { label: string; value: string; na?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        borderBottom: "1px dashed #141c26",
        paddingBottom: "4px",
      }}
    >
      <span style={{ color: "#74869a" }}>{label}</span>
      <span style={{ color: na ? "#455364" : "#e8edf3", fontWeight: 500 }}>{value}</span>
    </div>
  );
}

function RatingBar({
  label,
  value,
  colorKey,
}: {
  label: string;
  value: number | null;
  colorKey: string;
}) {
  const bg = COLOR_MAP[colorKey] || "#48a6ff";
  return (
    <div>
      <div
        style={{
          height: "36px",
          backgroundColor: bg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          fontSize: "12px",
          fontWeight: 700,
          borderRadius: "2px",
        }}
      >
        {value ?? 0}
      </div>
      <div style={{ color: "#6c7d91", fontSize: "9px", marginTop: "4px" }}>{label}</div>
    </div>
  );
}
