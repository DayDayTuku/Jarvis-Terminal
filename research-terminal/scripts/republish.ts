// Regenerate a week's Weekly Picks under the CURRENT model, exactly the way the
// live cron does it: same TradingView screener columns, same lib/setup-model
// selection, same lib/macro-risk sizing. Used to republish a week after a
// sizing/methodology change.
//
//   node --experimental-strip-types scripts/republish.ts [--week=YYYY-MM-DD] [--json]
//
// Defaults to the most recent Friday (the cron's week_of).

import { IDX_UNIVERSE } from "../lib/idx-universe.ts";
import {
  classifyAll,
  pickLongs,
  pickShort,
  positionWeight,
  regimeFor,
  shortWeight,
  isShortSetup,
  type SetupFeatures,
  type Setup,
  type Regime,
} from "../lib/setup-model.ts";
import { loadMacroExposure } from "../lib/macro-risk.ts";
import { guardLock } from "../lib/lock-guard.ts";

const COLUMNS = [
  "name", "description", "close", "change", "volume", "average_volume_10d_calc",
  "relative_volume_10d_calc", "market_cap_basic", "RSI", "EMA20", "EMA50",
  "SMA200", "High.1M", "Low.1M", "Recommend.All",
] as const;
type RawRow = Record<(typeof COLUMNS)[number], number | string | null>;

const SHORT_ELIGIBLE = new Set(
  (process.env.JARVIS_SHORT_ELIGIBLE || "")
    .split(",")
    .map((ticker) => ticker.trim().toUpperCase().replace(".JK", ""))
    .filter(Boolean),
);

const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const text = (value: unknown): string => (typeof value === "string" ? value : String(value ?? ""));

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
    atr: null,
  };
}

function mostRecentFriday(): string {
  const wib = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" }));
  const day = wib.getDay();
  wib.setDate(wib.getDate() - (day >= 5 ? day - 5 : day + 2));
  return `${wib.getFullYear()}-${String(wib.getMonth() + 1).padStart(2, "0")}-${String(wib.getDate()).padStart(2, "0")}`;
}

async function scan(): Promise<Setup[]> {
  const tickers = IDX_UNIVERSE.map((stock) => `IDX:${stock.ticker.replace(".JK", "")}`);
  const response = await fetch("https://scanner.tradingview.com/indonesia/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": "Mozilla/5.0" },
    body: JSON.stringify({ symbols: { tickers, query: { types: [] } }, columns: COLUMNS }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`TradingView scanner returned ${response.status}`);
  const payload: any = await response.json();
  const sectors = new Map(IDX_UNIVERSE.map((stock) => [stock.ticker.replace(".JK", ""), stock.sector]));
  const features = (Array.isArray(payload?.data) ? payload.data : [])
    .map((item: { d?: unknown[] }) => Object.fromEntries(COLUMNS.map((key, index) => [key, item.d?.[index] ?? null])) as RawRow)
    .map((row: RawRow) => toFeatures(row, sectors.get(text(row.name).replace("IDX:", "")) ?? "Other"));
  return classifyAll(features, { shortEligible: SHORT_ELIGIBLE });
}

const args = process.argv.slice(2);
const week = args.find((arg) => arg.startsWith("--week="))?.split("=")[1] ?? mostRecentFriday();
const asJson = args.includes("--json");

const setups = await scan();
const regime: Regime = regimeFor(setups);
const longs = pickLongs(setups, regime);
const shorts = pickShort(setups).filter((item) => shortWeight(item, longs, regime) >= 3);
const selected = [...longs, ...shorts];
const macro = await loadMacroExposure(week);
// A scan that did not see the session cannot be republished either: hold the week.
const lock = guardLock(regime, macro.exposure, macro.indexChangePct);

const rows = selected.map((item: Setup, index: number) => {
  const modelWeight = isShortSetup(item) ? shortWeight(item, longs, regime) : positionWeight(item, regime);
  const weight = modelWeight * lock.exposure;
  const sizeIdr = Math.min(1_250_000, 75_000 / Math.max(0.01, Math.abs(item.close - item.invalidation) / item.close)) * lock.exposure;
  return {
    rank: index + 1,
    ticker: item.ticker,
    setup: item.setup,
    side: isShortSetup(item) ? "SHORT" : "LONG",
    score: Math.round(item.score * 10) / 10,
    entryLow: item.entryLow,
    entryHigh: item.entryHigh,
    invalidation: item.invalidation,
    target: item.target,
    riskReward: Math.round(item.riskReward * 100) / 100,
    modelWeightPct: Math.round(modelWeight * 10) / 10,
    weightPct: Math.round(weight * 10) / 10,
    sizeIdr: Math.round(sizeIdr),
  };
});

const exposurePct = Math.round(lock.exposure * 100);
const label = `V5 ${lock.regime} · MACRO ${exposurePct}%${macro.flags.length ? ` (${macro.flags.join(", ")})` : ""}${lock.suffix}`;

if (asJson) {
  console.log(JSON.stringify({ week, regime: lock.regime, scannedRegime: regime, macro, exposurePct, label, picks: rows }, null, 2));
} else {
  console.log(`\nWeekly Picks republish · week of ${week}`);
  console.log(`Regime: ${lock.regime}${lock.stale ? ` (scan read ${regime}, stale)` : ""}   Macro exposure: ${exposurePct}%   Reads lit: ${macro.flags.length ? macro.flags.join(", ") : "none"}`);
  if (lock.stale) console.log(`Guard: the scan does not describe this session, so the week is held at 0% deployed.`);
  console.log(`Universe scanned: ${IDX_UNIVERSE.length}   Qualified setups: ${setups.length}`);
  console.log("");
  console.log("RANK  TICKER   SIDE   SETUP          SCORE  ENTRY RANGE          STOP       TARGET     R:R   WEIGHT(raw→now)   SIZE(IDR)");
  console.log("-".repeat(120));
  for (const row of rows) {
    console.log([
      String(row.rank).padStart(4),
      row.ticker.padEnd(8),
      row.side.padEnd(6),
      row.setup.padEnd(14),
      String(row.score).padStart(5),
      `${row.entryLow}–${row.entryHigh}`.padEnd(18),
      String(row.invalidation).padStart(9),
      String(row.target).padStart(10),
      String(row.riskReward).padStart(5),
      `${row.modelWeightPct}%→${row.weightPct}%`.padStart(16),
      row.sizeIdr.toLocaleString("id-ID").padStart(12),
    ].join(" "));
  }
  const totalWeight = rows.reduce((sum, row) => sum + row.weightPct, 0);
  console.log("-".repeat(120));
  console.log(`Total deployed: ${Math.round(totalWeight * 10) / 10}% of model capital  ·  cash: ${Math.round((100 - totalWeight) * 10) / 10}%`);
  console.log(`\nDigest header: ${label}`);
}
