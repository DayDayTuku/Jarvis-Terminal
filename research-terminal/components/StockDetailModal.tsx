"use client";
import { useEffect, useState } from "react";
import { IDX_UNIVERSE, type IDXStock } from "@/lib/idx-universe";

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

const TABS = ["Overview", "Financials", "Peers", "Analyst"] as const;
type Tab = (typeof TABS)[number];

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
  const [peerData, setPeerData] = useState<Array<{ stock: IDXStock; detail: Detail | null }>>([]);
  const [peerLoading, setPeerLoading] = useState(false);
  const [peerError, setPeerError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setTab("Overview");
    setPeerData([]);
    setPeerError(null);
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

  useEffect(() => {
    if (tab !== "Peers" || !data || peerData.length || peerLoading) return;

    const normalizedTicker = ticker.includes(".") ? ticker.toUpperCase() : `${ticker.toUpperCase()}.JK`;
    const selectedStock = IDX_UNIVERSE.find((stock) => stock.ticker === normalizedTicker);
    if (!selectedStock) {
      setPeerError("This ticker is not mapped in the IDX universe yet.");
      return;
    }

    const peers = IDX_UNIVERSE
      .filter((stock) => stock.sector === selectedStock.sector && stock.ticker !== selectedStock.ticker)
      .slice(0, 5);

    if (!peers.length) {
      setPeerError("No same-sector peers are available in the IDX universe.");
      return;
    }

    const controller = new AbortController();
    setPeerLoading(true);
    setPeerError(null);

    Promise.all(
      peers.map(async (stock) => {
        try {
          const response = await fetch(
            `/api/stock-detail?ticker=${encodeURIComponent(stock.ticker)}`,
            { signal: controller.signal }
          );
          if (!response.ok) return { stock, detail: null };
          const detail = (await response.json()) as Detail;
          return { stock, detail: detail?.error ? null : detail };
        } catch {
          return { stock, detail: null };
        }
      })
    )
      .then((rows) => {
        if (!controller.signal.aborted) setPeerData(rows);
      })
      .finally(() => {
        if (!controller.signal.aborted) setPeerLoading(false);
      });

    return () => controller.abort();
  }, [tab, ticker, data, peerData.length, peerLoading]);

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
        backgroundColor: "rgba(3, 5, 8, 0.85)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 99999,
        padding: "16px",
      }}
    >
      <div
        className="stock-modal-content"
        style={{
          backgroundColor: "#070a0f",
          border: "1px solid #1f2d3d",
          maxWidth: "680px",
          width: "100%",
          maxHeight: "86vh",
          display: "flex",
          flexDirection: "column",
          borderRadius: "3px",
          fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
          color: "#e8edf3",
          overflow: "hidden",
          boxShadow: "0 24px 64px rgba(0,0,0,0.9), 0 0 30px rgba(72,166,255,0.15)",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            borderBottom: "1px solid #182332",
            padding: "14px 18px",
            backgroundColor: "#0a0f16",
            position: "sticky",
            top: 0,
            zIndex: 10,
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span
                style={{
                  color: "#48a6ff",
                  fontSize: "18px",
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                }}
              >
                {ticker.replace(".JK", "")}
              </span>
              <span
                style={{
                  fontSize: "8px",
                  color: "#05101b",
                  backgroundColor: "#48a6ff",
                  padding: "1px 5px",
                  borderRadius: "2px",
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                }}
              >
                IDX FUNDAMENTALS
              </span>
            </div>
            {data && (
              <div
                style={{
                  color: "#778596",
                  fontSize: "11px",
                  marginTop: "3px",
                  fontFamily: "var(--font-geist-sans), sans-serif",
                }}
              >
                {data.name}
                {data.sector && ` · ${data.sector}`}
                {data.industry && ` · ${data.industry}`}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "#778596",
              fontSize: "22px",
              lineHeight: 1,
              cursor: "pointer",
              padding: "0 4px",
            }}
            title="Close (Esc)"
          >
            ×
          </button>
        </div>

        {/* Scrollable Body */}
        <div style={{ overflowY: "auto", flex: 1 }}>
          {loading && (
            <div
              style={{
                padding: "36px",
                textAlign: "center",
                color: "#778596",
                fontSize: "12px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
              }}
            >
              <span
                style={{
                  width: "6px",
                  height: "6px",
                  borderRadius: "50%",
                  background: "#48a6ff",
                  boxShadow: "0 0 8px #48a6ff",
                }}
              />
              FETCHING YAHOO FINANCE DATA...
            </div>
          )}

          {error && (
            <div
              style={{
                padding: "36px",
                textAlign: "center",
                color: "#ff6678",
                fontSize: "12px",
              }}
            >
              {error}
            </div>
          )}

          {data && !loading && !error && (
            <>
              {/* Price Banner */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  padding: "12px 18px",
                  borderBottom: "1px solid #182332",
                  backgroundColor: "#06090e",
                }}
              >
                <div style={{ fontSize: "22px", fontWeight: 700, color: "#ffffff" }}>
                  {fmtNum(data.regularMarketPrice, 0)}
                  {data.currency && (
                    <span
                      style={{
                        fontSize: "10px",
                        color: "#778596",
                        marginLeft: "6px",
                        fontWeight: 400,
                      }}
                    >
                      {data.currency}
                    </span>
                  )}
                </div>
                <div
                  style={{
                    fontSize: "13px",
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

              {/* Tab Navigation */}
              <div
                style={{
                  display: "flex",
                  borderBottom: "1px solid #182332",
                  backgroundColor: "#070b10",
                  padding: "0 8px",
                }}
              >
                {TABS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTab(t)}
                    style={{
                      padding: "8px 14px",
                      fontSize: "11px",
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      background: "transparent",
                      border: "none",
                      borderBottom:
                        tab === t
                          ? "2px solid #48a6ff"
                          : "2px solid transparent",
                      color: tab === t ? "#48a6ff" : "#778596",
                      cursor: "pointer",
                      fontWeight: tab === t ? 700 : 400,
                      transition: "color 0.12s, border-color 0.12s",
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>

              {/* Tab Contents */}
              <div style={{ padding: "16px 18px" }}>
                {tab === "Overview" && (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: "6px 16px",
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
                  <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                    <div>
                      <div
                        style={{
                          color: "#48a6ff",
                          marginBottom: "8px",
                          fontSize: "9px",
                          letterSpacing: "0.08em",
                          textTransform: "uppercase",
                          fontWeight: 700,
                        }}
                      >
                        Profitability
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr",
                          gap: "6px 16px",
                          fontSize: "11px",
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
                          fontSize: "9px",
                          letterSpacing: "0.08em",
                          textTransform: "uppercase",
                          fontWeight: 700,
                        }}
                      >
                        Balance Sheet & Cash Flow
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr",
                          gap: "6px 16px",
                          fontSize: "11px",
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
                            fontSize: "9px",
                            letterSpacing: "0.08em",
                            textTransform: "uppercase",
                            fontWeight: 700,
                          }}
                        >
                          Latest Annual Statement{" "}
                          {data.latestFinancials.fiscalYear
                            ? `(${data.latestFinancials.fiscalYear})`
                            : ""}
                        </div>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "1fr 1fr",
                            gap: "6px 16px",
                            fontSize: "11px",
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

                {tab === "Peers" && (
                  <PeerComparison
                    ticker={ticker}
                    data={data}
                    peers={peerData}
                    loading={peerLoading}
                    error={peerError}
                  />
                )}

                {tab === "Analyst" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: "6px 16px",
                        fontSize: "11px",
                      }}
                    >
                      <Row label="Recommendation" value={data.recommendationKey ?? "—"} na={na("recommendationKey")} />
                      <Row label="Analysts Covering" value={data.numberOfAnalystOpinions?.toString() ?? "—"} na={na("numberOfAnalystOpinions")} />
                      <Row label="Target Mean Price" value={fmtNum(data.targetMeanPrice, 0)} na={na("targetMeanPrice")} />
                      <Row label="Target Range" value={`${fmtNum(data.targetLowPrice, 0)} – ${fmtNum(data.targetHighPrice, 0)}`} na={na("targetHighPrice")} />
                    </div>

                    {(data.strongBuy !== null || data.buy !== null) && (
                      <div>
                        <div
                          style={{
                            color: "#48a6ff",
                            marginBottom: "8px",
                            fontSize: "9px",
                            letterSpacing: "0.08em",
                            textTransform: "uppercase",
                            fontWeight: 700,
                          }}
                        >
                          Analyst Ratings Breakdown
                        </div>
                        <div style={{ display: "flex", gap: "6px" }}>
                          <RatingBar label="Strong Buy" value={data.strongBuy} color="#22c55e" />
                          <RatingBar label="Buy" value={data.buy} color="#15803d" />
                          <RatingBar label="Hold" value={data.hold} color="#525252" />
                          <RatingBar label="Sell" value={data.sell} color="#b91c1c" />
                          <RatingBar label="Strong Sell" value={data.strongSell} color="#ef4444" />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {data.unavailable?.length > 0 && (
                  <div
                    style={{
                      color: "#556272",
                      fontSize: "9px",
                      borderTop: "1px solid #141c26",
                      paddingTop: "10px",
                      marginTop: "14px",
                      fontFamily: "var(--font-geist-mono), monospace",
                    }}
                  >
                    Unavailable from free data source:{" "}
                    {data.unavailable.slice(0, 8).join(", ")}
                    {data.unavailable.length > 8 &&
                      ` +${data.unavailable.length - 8} more`}
                  </div>
                )}

                {/* Add to Watchlist Button */}
                <button
                  type="button"
                  onClick={() => onAddToWatchlist(ticker)}
                  disabled={isInWatchlist}
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    fontSize: "11px",
                    fontWeight: 700,
                    letterSpacing: "0.06em",
                    marginTop: "16px",
                    borderRadius: "2px",
                    cursor: isInWatchlist ? "not-allowed" : "pointer",
                    border: isInWatchlist
                      ? "1px solid #233041"
                      : "1px solid #48a6ff",
                    color: isInWatchlist ? "#5d6d80" : "#05101b",
                    backgroundColor: isInWatchlist ? "#0d141e" : "#48a6ff",
                    transition: "all 0.15s ease",
                    fontFamily:
                      "var(--font-geist-mono), ui-monospace, monospace",
                  }}
                >
                  {isInWatchlist
                    ? "✓ ALREADY IN WATCHLIST"
                    : "+ ADD TO WATCHLIST"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}


function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function relativeValue(value: number | null, peerValues: number[]) {
  const benchmark = median(peerValues.filter((item) => item > 0));
  if (value === null || value === undefined || value <= 0 || !benchmark) return "INSUFFICIENT DATA";
  const difference = ((value / benchmark) - 1) * 100;
  if (Math.abs(difference) < 2) return "IN LINE WITH PEERS";
  return `${Math.abs(difference).toFixed(0)}% ${difference > 0 ? "PREMIUM" : "DISCOUNT"}`;
}

function PeerComparison({
  ticker,
  data,
  peers,
  loading,
  error,
}: {
  ticker: string;
  data: Detail;
  peers: Array<{ stock: IDXStock; detail: Detail | null }>;
  loading: boolean;
  error: string | null;
}) {
  const selectedTicker = ticker.replace(".JK", "").toUpperCase();
  const universeTicker = ticker.includes(".") ? ticker.toUpperCase() : `${ticker.toUpperCase()}.JK`;
  const selectedStock = IDX_UNIVERSE.find((stock) => stock.ticker === universeTicker);
  const rows = [
    {
      ticker: selectedTicker,
      name: data.name ?? selectedTicker,
      detail: data,
      selected: true,
    },
    ...peers.map(({ stock, detail }) => ({
      ticker: stock.ticker.replace(".JK", ""),
      name: stock.name,
      detail,
      selected: false,
    })),
  ];
  const availablePeers = peers.filter(({ detail }) => detail);
  const peerPE = availablePeers
    .map(({ detail }) => detail?.trailingPE)
    .filter((value): value is number => typeof value === "number");
  const peerPB = availablePeers
    .map(({ detail }) => detail?.priceToBook)
    .filter((value): value is number => typeof value === "number");
  const gridColumns = `136px repeat(${rows.length}, minmax(112px, 1fr))`;

  if (loading) {
    return (
      <div style={{ minHeight: 250, display: "grid", placeContent: "center", gap: 9, color: "#778596", textAlign: "center" }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#48a6ff", boxShadow: "0 0 9px #48a6ff", margin: "0 auto" }} />
        <span style={{ fontSize: 10, letterSpacing: ".08em" }}>BUILDING SAME-SECTOR COMPS…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ minHeight: 220, display: "grid", placeContent: "center", textAlign: "center", color: "#778596", fontSize: 10 }}>
        {error}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <div style={{ color: "#48a6ff", fontSize: 9, fontWeight: 700, letterSpacing: ".08em" }}>
          RELATIVE VALUATION · {selectedStock?.sector?.toUpperCase() ?? "SECTOR PEERS"}
        </div>
        <div style={{ color: "#778596", fontSize: 9, lineHeight: 1.5, marginTop: 5 }}>
          {peers.length
            ? `Comparing ${selectedTicker} with ${peers.length} same-sector name${peers.length === 1 ? "" : "s"} from the IDX universe.`
            : "Peer data is unavailable."}
          {peers.length > 0 && peers.length < 3 ? " The current universe contains fewer than three peers for this sector." : ""}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {[
          ["TRAILING P/E VS MEDIAN", relativeValue(data.trailingPE, peerPE)],
          ["P/B VS MEDIAN", relativeValue(data.priceToBook, peerPB)],
        ].map(([label, value]) => (
          <div key={label} style={{ border: "1px solid #182332", background: "#080d14", padding: "10px 11px" }}>
            <div style={{ color: "#778596", fontSize: 7, letterSpacing: ".08em" }}>{label}</div>
            <div style={{ color: value.includes("DISCOUNT") ? "#43d4a3" : value.includes("PREMIUM") ? "#ff9840" : "#e8edf3", fontSize: 11, fontWeight: 700, marginTop: 6 }}>
              {value}
            </div>
          </div>
        ))}
      </div>

      <div style={{ overflowX: "auto", border: "1px solid #182332" }}>
        <div style={{ minWidth: Math.max(620, 136 + rows.length * 112) }}>
          <div style={{ display: "grid", gridTemplateColumns: gridColumns, background: "#0a0f16", borderBottom: "1px solid #1f2d3d" }}>
            <div style={{ padding: "11px 10px", color: "#536171", fontSize: 7, letterSpacing: ".08em" }}>METRIC</div>
            {rows.map((row) => (
              <div key={row.ticker} style={{ padding: "9px 10px", borderLeft: "1px solid #182332", background: row.selected ? "#0c1824" : "transparent" }}>
                <strong style={{ display: "block", color: row.selected ? "#48a6ff" : "#e8edf3", fontSize: 11 }}>{row.ticker}</strong>
                <span title={row.name} style={{ display: "block", marginTop: 3, color: "#778596", fontFamily: "var(--font-geist-sans), sans-serif", fontSize: 8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {row.selected ? "SELECTED · " : ""}{row.name}
                </span>
              </div>
            ))}
          </div>

          {[
            ["TRAILING P/E", (detail: Detail | null) => fmtNum(detail?.trailingPE ?? null)],
            ["PRICE / BOOK", (detail: Detail | null) => fmtNum(detail?.priceToBook ?? null)],
            ["MARKET CAP", (detail: Detail | null) => fmtBig(detail?.marketCap ?? null)],
          ].map(([label, formatter]) => (
            <div key={label as string} style={{ display: "grid", gridTemplateColumns: gridColumns, minHeight: 48, borderBottom: "1px solid #141c26" }}>
              <div style={{ display: "flex", alignItems: "center", padding: "10px", color: "#778596", fontSize: 8, letterSpacing: ".05em" }}>{label as string}</div>
              {rows.map((row) => (
                <div key={row.ticker} style={{ display: "flex", alignItems: "center", padding: "10px", borderLeft: "1px solid #141c26", background: row.selected ? "#09131e" : "transparent", color: row.detail ? "#fff" : "#4a5568", fontSize: 11, fontWeight: 650 }}>
                  {(formatter as (detail: Detail | null) => string)(row.detail)}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, color: "#536171", fontSize: 7, lineHeight: 1.5 }}>
        <span>PEER MEDIAN EXCLUDES THE SELECTED STOCK</span>
        <span style={{ textAlign: "right" }}>{availablePeers.length}/{peers.length} PEER FUNDAMENTALS AVAILABLE</span>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  na,
}: {
  label: string;
  value: string;
  na?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "4px 0",
        borderBottom: "1px solid #101722",
      }}
    >
      <span style={{ color: "#778596", fontSize: "11px" }}>{label}</span>
      <span
        style={{
          color: na ? "#4a5568" : "#ffffff",
          fontWeight: 600,
          fontSize: "11px",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function RatingBar({
  label,
  value,
  color,
}: {
  label: string;
  value: number | null;
  color: string;
}) {
  return (
    <div style={{ flex: 1, textAlign: "center" }}>
      <div
        style={{
          height: "32px",
          backgroundColor: color,
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "center",
          color: "#ffffff",
          fontSize: "11px",
          fontWeight: 700,
          borderRadius: "2px",
          paddingBottom: "3px",
        }}
      >
        {value ?? 0}
      </div>
      <div
        style={{
          color: "#778596",
          fontSize: "8px",
          marginTop: "4px",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {label}
      </div>
    </div>
  );
}
