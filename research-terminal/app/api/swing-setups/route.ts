import { fetchUpstream } from "@/lib/upstream";
import { NextResponse } from "next/server";
import { IDX_UNIVERSE } from "@/lib/idx-universe";
import { classifyAll, type SetupFeatures } from "@/lib/setup-model";

export const dynamic = "force-dynamic";

const COLUMNS = [
  "name", "description", "close", "change", "volume", "average_volume_10d_calc",
  "relative_volume_10d_calc", "market_cap_basic", "RSI", "EMA20", "EMA50",
  "SMA200", "High.1M", "Low.1M", "Recommend.All",
] as const;

const SHORT_ELIGIBLE = new Set(
  (process.env.JARVIS_SHORT_ELIGIBLE || "")
    .split(",")
    .map((ticker) => ticker.trim().toUpperCase().replace(".JK", ""))
    .filter(Boolean),
);
type RawRow = Record<(typeof COLUMNS)[number], number | string | null>;

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function text(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

/** Map one TradingView scan row onto the model's normalised feature shape. */
function toFeatures(row: RawRow, sector: string): SetupFeatures {
  return {
    ticker: text(row.name),
    name: text(row.description) || text(row.name),
    sector,
    close: Number(row.close),
    change: num(row.change),
    volume: num(row.volume),
    averageVolume: num(row.average_volume_10d_calc),
    relativeVolume: num(row.relative_volume_10d_calc),
    rsi: num(row.RSI),
    ema20: num(row.EMA20),
    ema50: num(row.EMA50),
    sma200: num(row.SMA200),
    high1m: num(row["High.1M"]),
    low1m: num(row["Low.1M"]),
    recommendation: num(row["Recommend.All"]),
    marketCap: num(row.market_cap_basic),
    // The live policy is a percentage stop, so ATR is not requested from the
    // scanner; the offline backtest derives it from bars instead.
    atr: null,
  };
}

export async function GET() {
  try {
    const tickers = IDX_UNIVERSE.map((stock) => `IDX:${stock.ticker.replace(".JK", "")}`);
    const response = await fetchUpstream("https://scanner.tradingview.com/indonesia/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        symbols: { tickers, query: { types: [] } },
        columns: COLUMNS,
      }),
      signal: AbortSignal.timeout(12000),
      next: { revalidate: 900 },
    });
    if (!response.ok) throw new Error(`Scanner upstream returned ${response.status}`);
    const payload: any = await response.json();
    const sectors = new Map(IDX_UNIVERSE.map((stock) => [stock.ticker.replace(".JK", ""), stock.sector]));
    const features = (Array.isArray(payload?.data) ? payload.data : [])
      .map((item: { d?: unknown[] }) => Object.fromEntries(COLUMNS.map((key, index) => [key, item.d?.[index] ?? null])) as RawRow)
      .map((row: RawRow) => toFeatures(row, sectors.get(text(row.name).replace("IDX:", "")) ?? "Other"));

    const setups = classifyAll(features, { shortEligible: SHORT_ELIGIBLE });

    return NextResponse.json({
      status: "live",
      asOf: new Date().toISOString(),
      universe: tickers.length,
      scanned: Array.isArray(payload?.data) ? payload.data.length : 0,
      methodology: "End-of-day swing setups for an estimated 3–20 trading-day horizon.",
      setups,
    });
  } catch (error) {
    return NextResponse.json({
      status: "unavailable",
      asOf: new Date().toISOString(),
      universe: IDX_UNIVERSE.length,
      scanned: 0,
      methodology: "End-of-day swing setups for an estimated 3–20 trading-day horizon.",
      setups: [],
      message: error instanceof Error ? error.message : "Scanner unavailable",
    }, { status: 503 });
  }
}
