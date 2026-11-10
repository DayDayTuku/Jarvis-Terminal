// CLI: audit the curated IDX universe against a live TradingView snapshot.
//
//   npm run audit-universe
//   npm run audit-universe -- --offline      # static checks only
//   npm run audit-universe -- --min-turnover=2e9
//
// The universe is a curated list, so it drifts: names get delisted, new listings
// turn liquid, and a name can quietly fall out of the exchange screener. This
// script does not edit anything. It reports what the snapshot says so the list
// can be fixed deliberately instead of by memory.
//
// Static checks always run. The snapshot section is best-effort: if TradingView
// is unreachable the script says so and still exits with the static result.

import { IDX_UNIVERSE } from "../lib/idx-universe.ts";

const SCAN_URL = "https://scanner.tradingview.com/indonesia/scan";
const COLUMNS = [
  "name", "description", "close", "market_cap_basic",
  "average_volume_10d_calc", "sector", "industry", "type",
] as const;
const SECTORS = [
  "Basic Materials", "Consumer Cyclicals", "Consumer Non-Cyclicals", "Energy",
  "Financials", "Healthcare", "Industrials", "Infrastructures",
  "Properties & Real Estate", "Technology", "Transportation & Logistics",
] as const;
/** Below this average daily turnover a name is hard to enter or exit cleanly. */
const THIN_TURNOVER_IDR = 1e9;
/** Names clearing this bar are worth considering as additions. */
const DEFAULT_MIN_TURNOVER = 5e9;
const DEFAULT_MIN_MCAP = 2e12;

type SnapshotRow = {
  ticker: string;
  description: string;
  close: number | null;
  marketCap: number | null;
  averageVolume: number | null;
  tvSector: string;
  industry: string | null;
  type: string;
};

function arg(name: string): string | undefined {
  return process.argv.find((item) => item.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
}
const offline = process.argv.includes("--offline");
const minTurnover = Number(arg("min-turnover") ?? DEFAULT_MIN_TURNOVER);
const minMarketCap = Number(arg("min-mcap") ?? DEFAULT_MIN_MCAP);

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function scan(body: unknown): Promise<SnapshotRow[]> {
  const response = await fetch(SCAN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`TradingView scan failed (${response.status})`);
  const payload = (await response.json()) as { data?: Array<{ d: unknown[] }> };
  return (payload.data ?? []).map((row) => {
    const value = row.d as Array<unknown>;
    return {
      ticker: String(value[0]),
      description: String(value[1] ?? ""),
      close: num(value[2]),
      marketCap: num(value[3]),
      averageVolume: num(value[4]),
      tvSector: String(value[5] ?? ""),
      industry: typeof value[6] === "string" && value[6] ? value[6] : null,
      type: String(value[7] ?? ""),
    };
  });
}

function publicTicker(ticker: string): string {
  return ticker.replace(/\.JK$/i, "");
}

function staticChecks(): string[] {
  const errors: string[] = [];
  const seen = new Map<string, string>();
  const sectors = new Set<string>(SECTORS);
  const tickers = new Set<string>();
  for (const stock of IDX_UNIVERSE) {
    const ticker = publicTicker(stock.ticker);
    tickers.add(ticker);
    if (!/^[A-Z0-9]{4}\.JK$/.test(stock.ticker)) {
      errors.push(`malformed ticker: ${stock.ticker} (expected ABCD.JK)`);
    }
    if (seen.has(stock.ticker)) {
      errors.push(`duplicate ticker: ${stock.ticker} (${seen.get(stock.ticker)} / ${stock.name})`);
    } else {
      seen.set(stock.ticker, stock.name);
    }
    if (!sectors.has(stock.sector)) {
      errors.push(`unknown sector: ${stock.ticker} -> "${stock.sector}"`);
    }
    if (!stock.name.trim()) {
      errors.push(`empty name: ${stock.ticker}`);
    }
  }
  return errors;
}

function printStatic(): number {
  const errors = staticChecks();
  const bySector = new Map<string, number>();
  for (const stock of IDX_UNIVERSE) bySector.set(stock.sector, (bySector.get(stock.sector) ?? 0) + 1);

  console.log(`Universe: ${IDX_UNIVERSE.length} names, ${bySector.size} sectors`);
  for (const [sector, count] of [...bySector].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${sector.padEnd(28)} ${count}`);
  }
  const missingIndustry = IDX_UNIVERSE.filter((stock) => !stock.industry);
  console.log(`Industry metadata: ${IDX_UNIVERSE.length - missingIndustry.length}/${IDX_UNIVERSE.length} populated`);
  if (missingIndustry.length) {
    console.log(`  no industry: ${missingIndustry.map((stock) => publicTicker(stock.ticker)).join(", ")}`);
  }

  if (errors.length) {
    console.log(`\nSTATIC ERRORS (${errors.length}):`);
    for (const error of errors) console.log(`  ✗ ${error}`);
  } else {
    console.log("\nStatic checks: OK (unique tickers, valid suffix, known sectors)");
  }
  return errors.length;
}

async function main() {
  const staticErrors = printStatic();
  if (offline) {
    console.log("\n--offline: skipped the live snapshot.");
    process.exitCode = staticErrors ? 1 : 0;
    return;
  }

  let rows: SnapshotRow[];
  let filteredTickers = new Set<string>();
  try {
    // The exchange filter is what the scanner itself uses. It omits a handful of
    // still-trading names, so those are looked up by exact symbol afterwards.
    const filtered = await scan({
      filter: [{ left: "exchange", operation: "equal", right: "IDX" }],
      options: { lang: "en" },
      markets: ["indonesia"],
      columns: [...COLUMNS],
      sort: { sortBy: "market_cap_basic", sortOrder: "desc" },
      range: [0, 1000],
    });
    filteredTickers = new Set(filtered.map((row) => row.ticker));
    const exact = IDX_UNIVERSE
      .map((stock) => publicTicker(stock.ticker))
      .filter((ticker) => !filteredTickers.has(ticker));
    const lookedUp = exact.length
      ? await scan({
        symbols: { tickers: exact.map((ticker) => `IDX:${ticker}`) },
        markets: ["indonesia"],
        columns: [...COLUMNS],
      })
      : [];
    rows = [...filtered, ...lookedUp];
  } catch (error) {
    console.log(`\nLive snapshot unavailable: ${error instanceof Error ? error.message : String(error)}`);
    console.log("Universe coverage was not re-checked this run.");
    process.exitCode = staticErrors ? 1 : 0;
    return;
  }

  const stocks = new Map(rows.filter((row) => row.type === "stock").map((row) => [row.ticker, row]));
  const missing = IDX_UNIVERSE.filter((stock) => !stocks.has(publicTicker(stock.ticker)));
  const hidden = IDX_UNIVERSE.filter((stock) => stocks.has(publicTicker(stock.ticker)) && !filteredTickers.has(publicTicker(stock.ticker)));
  const traded = IDX_UNIVERSE.flatMap((stock) => {
    const row = stocks.get(publicTicker(stock.ticker));
    if (!row || row.close === null || row.averageVolume === null) return [];
    return [{ stock, row, turnover: row.close * row.averageVolume }];
  }).sort((a, b) => a.turnover - b.turnover);

  console.log(`\nSnapshot coverage: ${IDX_UNIVERSE.length - missing.length}/${IDX_UNIVERSE.length} names priced`);
  if (missing.length) {
    console.log(`  not priced by the snapshot (delisted, suspended, or not on the board):`);
    for (const stock of missing) console.log(`    · ${publicTicker(stock.ticker)} ${stock.name}`);
  }
  if (hidden.length) {
    console.log(`  absent from the exchange-filtered scan, but priced by exact symbol: ${hidden.length}`);
    console.log(`  (the app asks for its whole universe by symbol, so these still get scanned)`);
    for (const stock of hidden) console.log(`    · ${publicTicker(stock.ticker)} ${stock.name}`);
  }

  const thin = traded.filter((item) => item.turnover < THIN_TURNOVER_IDR);
  console.log(`\nLiquidity: ${traded.length} names with a price and volume`);
  console.log(`  below ${(THIN_TURNOVER_IDR / 1e9).toFixed(0)}B IDR/day: ${thin.length}`);
  for (const item of thin.slice(0, 10)) {
    console.log(`    · ${publicTicker(item.stock.ticker).padEnd(5)} ${(item.turnover / 1e9).toFixed(2)}B/day  ${item.stock.name}`);
  }

  const universe = new Set(IDX_UNIVERSE.map((stock) => publicTicker(stock.ticker)));
  const additions = rows
    .filter((row) => row.type === "stock" && !universe.has(row.ticker))
    .flatMap((row) => {
      if (row.close === null || row.averageVolume === null) return [];
      const turnover = row.close * row.averageVolume;
      if (turnover < minTurnover || (row.marketCap ?? 0) < minMarketCap) return [];
      return [{ row, turnover }];
    })
    .sort((a, b) => b.turnover - a.turnover);
  console.log(`\nLiquid names missing from the universe (>= Rp ${(minTurnover / 1e9).toFixed(0)}B/day, >= Rp ${(minMarketCap / 1e12).toFixed(0)}T cap): ${additions.length}`);
  for (const { row, turnover } of additions.slice(0, 30)) {
    console.log(`  · ${row.ticker.padEnd(5)} ${(turnover / 1e9).toFixed(1).padStart(7)}B/day  ${(row.description || "").slice(0, 44).padEnd(44)} ${row.industry ?? "—"}`);
  }

  // A source industry label should describe one kind of business. When the same
  // label lands in several app sectors, the label is usually stale or the copy
  // was taken from the wrong row, so these are worth a manual look.
  const sectorPeer = new Map<string, Set<string>>();
  for (const item of traded) {
    if (!item.row.industry) continue;
    const set = sectorPeer.get(item.row.industry) ?? new Set<string>();
    set.add(item.stock.sector);
    sectorPeer.set(item.row.industry, set);
  }
  const split = [...sectorPeer].filter(([, sectors]) => sectors.size > 1);
  if (split.length) {
    console.log(`\nIndustry labels that span app sectors (check the source row): ${split.length}`);
    for (const [industry, sectors] of split.slice(0, 10)) {
      console.log(`  · ${industry}: ${[...sectors].join(" / ")}`);
    }
  }

  process.exitCode = staticErrors ? 1 : 0;
}

void main();
