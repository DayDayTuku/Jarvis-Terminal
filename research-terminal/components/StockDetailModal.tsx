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

export default function StockDetailModal({
  ticker, onClose, onAddToWatchlist, isInWatchlist,
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
    fetch(`/api/stock-detail?ticker=${encodeURIComponent(ticker)}`)
      .then((r) => r.json())
      .then((d: any) => (d?.error ? setError(d.error) : setData(d)))
      .catch(() => setError("Failed to load stock data"))
      .finally(() => setLoading(false));
  }, [ticker]);

  const na = (field: string) => data?.unavailable?.includes(field);

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-black border border-neutral-800 max-w-2xl w-full font-mono max-h-[85vh] overflow-y-auto">
        <div className="flex justify-between items-start border-b border-neutral-800 px-4 py-3 sticky top-0 bg-black">
          <div>
            <div className="text-white text-lg font-bold">{ticker.replace(".JK", "")}</div>
            {data && (
              <div className="text-neutral-500 text-xs">
                {data.name}{data.sector && ` · ${data.sector}`}{data.industry && ` · ${data.industry}`}
              </div>
            )}
          </div>
          <button onClick={onClose} className="text-neutral-500 hover:text-white text-xl leading-none">×</button>
        </div>

        {loading && <div className="p-6 text-center text-neutral-500 text-sm">Loading...</div>}
        {error && <div className="p-6 text-center text-red-400 text-sm">{error}</div>}

        {data && !loading && !error && (
          <>
            <div className="flex justify-between items-baseline px-4 py-3 border-b border-neutral-800">
              <div className="text-2xl text-white">
                {fmtNum(data.regularMarketPrice, 0)}
                {data.currency && <span className="text-neutral-500 text-sm ml-1">{data.currency}</span>}
              </div>
              <div className={(data.regularMarketChangePercent ?? 0) >= 0 ? "text-green-400" : "text-red-400"}>
                {data.regularMarketChangePercent !== null
                  ? (data.regularMarketChangePercent >= 0 ? "+" : "") + fmtNum(data.regularMarketChangePercent, 2, "%")
                  : "—"}
              </div>
            </div>

            <div className="flex border-b border-neutral-800 text-xs">
              {TABS.map((t) => (
                <button key={t} onClick={() => setTab(t)}
                  className={"px-4 py-2 " + (tab === t ? "text-white border-b-2 border-blue-500" : "text-neutral-500 hover:text-neutral-300")}>
                  {t}
                </button>
              ))}
            </div>

            <div className="p-4">
              {tab === "Overview" && (
                <div className="grid grid-cols-2 gap-y-2 text-xs">
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
                <div className="space-y-4 text-xs">
                  <div>
                    <div className="text-neutral-400 mb-2 uppercase text-[10px] tracking-wide">Profitability</div>
                    <div className="grid grid-cols-2 gap-y-2">
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
                    <div className="text-neutral-400 mb-2 uppercase text-[10px] tracking-wide">Balance Sheet & Cash Flow</div>
                    <div className="grid grid-cols-2 gap-y-2">
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
                      <div className="text-neutral-400 mb-2 uppercase text-[10px] tracking-wide">
                        Latest Annual Statement {data.latestFinancials.fiscalYear ? `(${data.latestFinancials.fiscalYear})` : ""}
                      </div>
                      <div className="grid grid-cols-2 gap-y-2">
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
                <div className="space-y-4 text-xs">
                  <div className="grid grid-cols-2 gap-y-2">
                    <Row label="Recommendation" value={data.recommendationKey ?? "—"} na={na("recommendationKey")} />
                    <Row label="Analysts Covering" value={data.numberOfAnalystOpinions?.toString() ?? "—"} na={na("numberOfAnalystOpinions")} />
                    <Row label="Target Mean Price" value={fmtNum(data.targetMeanPrice, 0)} na={na("targetMeanPrice")} />
                    <Row label="Target Range" value={`${fmtNum(data.targetLowPrice, 0)} – ${fmtNum(data.targetHighPrice, 0)}`} na={na("targetHighPrice")} />
                  </div>
                  {(data.strongBuy !== null || data.buy !== null) && (
                    <div>
                      <div className="text-neutral-400 mb-2 uppercase text-[10px] tracking-wide">Analyst Ratings Breakdown</div>
                      <div className="grid grid-cols-5 gap-2 text-center">
                        <RatingBar label="Strong Buy" value={data.strongBuy} color="bg-green-500" />
                        <RatingBar label="Buy" value={data.buy} color="bg-green-700" />
                        <RatingBar label="Hold" value={data.hold} color="bg-neutral-600" />
                        <RatingBar label="Sell" value={data.sell} color="bg-red-700" />
                        <RatingBar label="Strong Sell" value={data.strongSell} color="bg-red-500" />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {data.unavailable?.length > 0 && (
                <div className="text-neutral-600 text-[10px] border-t border-neutral-800 pt-2 mt-4">
                  Unavailable from free data source: {data.unavailable.slice(0, 8).join(", ")}
                  {data.unavailable.length > 8 && ` +${data.unavailable.length - 8} more`}
                </div>
              )}

              <button
                onClick={() => onAddToWatchlist(ticker)}
                disabled={isInWatchlist}
                className={"w-full py-2 text-sm border mt-4 " + (isInWatchlist ? "border-neutral-800 text-neutral-600 cursor-not-allowed" : "border-blue-500 text-blue-400 hover:bg-blue-500 hover:text-black transition-colors")}
              >
                {isInWatchlist ? "Already in Watchlist" : "+ Add to Watchlist"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, na }: { label: string; value: string; na?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-neutral-500">{label}</span>
      <span className={na ? "text-neutral-700" : "text-white"}>{value}</span>
    </div>
  );
}

function RatingBar({ label, value, color }: { label: string; value: number | null; color: string }) {
  return (
    <div>
      <div className={`h-8 ${color} flex items-end justify-center text-white text-xs`}>{value ?? 0}</div>
      <div className="text-neutral-600 text-[9px] mt-1">{label}</div>
    </div>
  );
}
