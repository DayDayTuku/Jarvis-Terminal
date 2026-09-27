import { NextResponse } from "next/server";
import { IDX_UNIVERSE } from "@/lib/idx-universe";

export const dynamic = "force-dynamic";

const COLUMNS = [
  "name", "description", "close", "change", "volume", "average_volume_10d_calc",
  "relative_volume_10d_calc", "market_cap_basic", "RSI", "EMA20", "EMA50",
  "SMA200", "High.1M", "Low.1M", "Recommend.All",
] as const;

type SetupKey = "breakout" | "pullback" | "momentum" | "reversal" | "short_breakdown";
const SHORT_ELIGIBLE = new Set((process.env.JARVIS_SHORT_ELIGIBLE || "").split(",").map((ticker) => ticker.trim().toUpperCase().replace(".JK", "")).filter(Boolean));
type RawRow = Record<(typeof COLUMNS)[number], number | string | null>;

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function clamp(value: number) {
  return Math.round(Math.max(0, Math.min(100, value)));
}
function riskPlan(close: number, ema20: number | null, low1m: number | null, setup: SetupKey) {
  const invalidation = setup === "breakout"
    ? close * 0.94
    : Math.min(ema20 ?? close * 0.95, close * 0.96);
  const risk = Math.max(close - invalidation, close * 0.025);
  const target = close + risk * (setup === "reversal" ? 1.7 : 2);
  return {
    entryLow: Math.round(close * 0.99),
    entryHigh: Math.round(close * 1.01),
    invalidation: Math.round(Math.max(low1m ?? 0, invalidation)),
    target: Math.round(target),
    riskReward: setup === "reversal" ? 1.7 : 2,
  };
}

function shortRiskPlan(close: number, ema20: number | null, high1m: number | null) {
  const invalidation = Math.min(high1m ?? close * 1.08, Math.max(ema20 ?? close * 1.05, close * 1.04));
  const risk = Math.max(invalidation - close, close * 0.025);
  return { entryLow: Math.round(close * 0.99), entryHigh: Math.round(close * 1.01), invalidation: Math.round(invalidation), target: Math.round(Math.max(1, close - risk * 2)), riskReward: 2 };
}

function classify(row: RawRow) {
  const close = num(row.close);
  const change = num(row.change);
  const volume = num(row.volume);
  const avgVolume = num(row.average_volume_10d_calc);
  const relativeVolume = num(row.relative_volume_10d_calc) ?? (volume && avgVolume ? volume / avgVolume : null);
  const rsi = num(row.RSI);
  const ema20 = num(row.EMA20);
  const ema50 = num(row.EMA50);
  const sma200 = num(row.SMA200);
  const high1m = num(row["High.1M"]);
  const low1m = num(row["Low.1M"]);
  const recommendation = num(row["Recommend.All"]);
  const marketCap = num(row.market_cap_basic);
  if (!close || !volume || close < 50 || volume < 100_000) return null;

  const liquid = avgVolume === null || avgVolume >= 250_000;
  if (!liquid) return null;

  const distance20 = ema20 ? ((close / ema20) - 1) * 100 : null;
  const trend = ema20 !== null && ema50 !== null && close >= ema20 && ema20 >= ema50;
  const aboveLongTrend = sma200 === null || close >= sma200;
  const nearHigh = high1m ? close >= high1m * 0.965 : false;
  const nearLow = low1m ? close <= low1m * 1.12 : false;

  const ticker = String(row.name ?? "").replace("IDX:", "");
  const shortTrend = ema20 !== null && ema50 !== null && close < ema20 && ema20 <= ema50;
  const belowLongTrend = sma200 !== null && close < sma200;
  const shortBreakdown = SHORT_ELIGIBLE.has(ticker) && nearLow && shortTrend && belowLongTrend && (relativeVolume ?? 0) >= 1.1 && (rsi ?? 50) >= 28 && (rsi ?? 50) <= 48 && (recommendation ?? 0) <= -0.1;
  if (shortBreakdown) {
    const shortScore = 58 + Math.min(14, ((relativeVolume ?? 1) - 1) * 18) + 10 + 8 + Math.min(10, Math.abs(recommendation ?? 0) * 20);
    return { ticker, name: typeof row.description === "string" ? row.description : String(row.name ?? ""), setup: "short_breakdown" as SetupKey, score: clamp(shortScore), close, change, volume, relativeVolume, rsi, marketCap, distance20, trend: false, reasons: ["Price is breaking toward its 1-month low", "The 20-day trend is below the 50-day trend", "Volume and broader technical readings confirm weakness"], caution: "Short only when the ticker is on the official BEI list and borrow is available. A move above resistance invalidates the trade.", ...shortRiskPlan(close, ema20, high1m) };
  }

  let setup: SetupKey;
  let score: number;
  let reasons: string[];
  let caution: string;

  if (nearHigh && (relativeVolume ?? 0) >= 1.15 && (rsi ?? 50) >= 52 && (rsi ?? 50) <= 76) {
    setup = "breakout";
    score = 58 + Math.min(18, ((relativeVolume ?? 1) - 1) * 18) + (trend ? 12 : 0) + (aboveLongTrend ? 8 : 0);
    reasons = ["Price is testing its 1-month high", "Volume is above its 10-day average", trend ? "Short-term trend is rising" : "Momentum is strengthening"];
    caution = (rsi ?? 0) > 70 ? "Momentum is already stretched; avoid chasing a large gap." : "A close back below the breakout area weakens this setup.";
  } else if (ema20 && ema50 && close >= ema50 && distance20 !== null && distance20 >= -3.5 && distance20 <= 2.5 && (rsi ?? 50) >= 40 && (rsi ?? 50) <= 62) {
    setup = "pullback";
    score = 62 + Math.max(0, 12 - Math.abs(distance20) * 3) + (ema20 >= ema50 ? 12 : 0) + (aboveLongTrend ? 7 : 0);
    reasons = ["Price is close to its 20-day trend", "The medium-term trend remains intact", (relativeVolume ?? 1) < 1 ? "Selling volume is relatively controlled" : "Trading activity remains healthy"];
    caution = "The setup is invalid if price closes decisively below support.";
  } else if (trend && aboveLongTrend && (rsi ?? 0) >= 54 && (rsi ?? 100) <= 72 && (recommendation ?? 0) >= 0.1) {
    setup = "momentum";
    score = 60 + Math.min(14, ((rsi ?? 54) - 54) * 1.2) + Math.min(12, Math.max(0, (relativeVolume ?? 1) - 1) * 12) + 10;
    reasons = ["Price is above its 20- and 50-day trends", "Momentum is positive without being extremely overbought", "Broader technical readings are constructive"];
    caution = "Momentum setups can reverse quickly when market breadth deteriorates.";
  } else if (nearLow && (rsi ?? 50) >= 30 && (rsi ?? 50) <= 49 && (change ?? 0) > -2) {
    setup = "reversal";
    score = 52 + Math.max(0, 15 - Math.abs((rsi ?? 40) - 40)) + ((change ?? 0) > 0 ? 10 : 3) + Math.min(10, (relativeVolume ?? 0) * 5);
    reasons = ["Price is near its 1-month low", "Selling pressure is no longer accelerating", (change ?? 0) > 0 ? "The latest close shows an initial rebound" : "Price is attempting to stabilise"];
    caution = "This is counter-trend and needs confirmation; use smaller size.";
  } else {
    return null;
  }

  return {
    ticker,
    name: typeof row.description === "string" ? row.description : String(row.name ?? ""),
    setup,
    score: clamp(score),
    close,
    change,
    volume,
    relativeVolume,
    rsi,
    marketCap,
    distance20,
    trend,
    reasons,
    caution,
    ...riskPlan(close, ema20, low1m, setup),
  };
}

export async function GET() {
  try {
    const tickers = IDX_UNIVERSE.map((stock) => `IDX:${stock.ticker.replace(".JK", "")}`);
    const response = await fetch("https://scanner.tradingview.com/indonesia/scan", {
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
    const setups = (Array.isArray(payload?.data) ? payload.data : [])
      .map((item: { d?: unknown[] }) => Object.fromEntries(COLUMNS.map((key, index) => [key, item.d?.[index] ?? null])) as RawRow)
      .map(classify)
      .filter(Boolean)
      .map((item: any) => ({ ...item, sector: sectors.get(item.ticker) ?? "Other" }))
      .sort((a: any, b: any) => b.score - a.score);

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
