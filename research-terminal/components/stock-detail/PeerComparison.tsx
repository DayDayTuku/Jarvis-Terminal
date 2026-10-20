"use client";

import { IDX_UNIVERSE, type IDXStock } from "@/lib/idx-universe";
import { fmtBig, fmtNum, relativeValue, type Detail } from "./shared";

export default function PeerComparison({
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
        <span style={{ textAlign: "right" }}>↔ SCROLL TABLE · {availablePeers.length}/{peers.length} PEER FUNDAMENTALS AVAILABLE</span>
      </div>
    </div>
  );
}
