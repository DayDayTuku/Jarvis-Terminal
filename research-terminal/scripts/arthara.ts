// CLI: probe the arthara API without draining a metered quota.
//
//   pnpm arthara -- usage                 # 0 requests
//   pnpm arthara -- status                # 0 requests
//   pnpm arthara -- catalogue             # 0 requests (local OpenAPI snapshot? no — see below)
//   pnpm arthara -- probe --ticker=BBCA --yes
//
// `/v1/usage`, `/v1/status` and `/v1/plans` are free. Everything else costs at
// least one request per page, and a sandbox key has 100 requests for its entire
// lifetime. So a read only happens when you say `--yes`; without it the script
// prints exactly what it would spend and exits 0. It also refuses to start a
// read that the remaining quota cannot cover, and prints the before/after
// balance so the real cost is measured rather than assumed.
//
// The key is read from the environment or `.env.local`. It is never printed.

import { readFileSync } from "node:fs";
import {
  ArtharaError,
  artharaConfigured,
  fetchDailyPrices,
  fetchForeignFlow,
  fetchMarketForeignFlow,
  fetchStatus,
  fetchUsage,
  type PagedResult,
  type PriceBar,
  type ForeignFlowMarketDay,
} from "../lib/arthara.ts";

type Args = {
  command: string;
  ticker: string;
  from: string | null;
  to: string | null;
  yes: boolean;
  pages: number;
};

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | undefined => argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
  const command = argv.find((arg) => !arg.startsWith("--")) ?? "usage";
  return {
    command,
    ticker: (get("ticker") ?? "BBCA").toUpperCase(),
    from: get("from") ?? null,
    to: get("to") ?? null,
    yes: argv.includes("--yes"),
    pages: Number(get("pages") ?? 1),
  };
}

/** `.env.local` is not loaded by a bare node process; Next.js does it for the app. */
function loadLocalEnv(): void {
  if (process.env.ARTHARA_API_KEY) return;
  for (const file of [".env.local", ".env"]) {
    try {
      const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      for (const line of text.split("\n")) {
        const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
        if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
      }
    } catch {
      // Missing file is fine: the caller may have exported the key.
    }
  }
}

function idr(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}Rp ${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}Rp ${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}Rp ${(abs / 1e6).toFixed(1)}M`;
  return `${sign}Rp ${abs.toFixed(0)}`;
}

function describe<T>(label: string, page: PagedResult<T>): void {
  const dates = page.rows
    .map((row) => (row as { date?: string }).date)
    .filter((date): date is string => Boolean(date))
    .sort();
  console.log(`\n${label}`);
  console.log(`  rows ${page.rows.length} · pages ${page.pages} · cost ${page.cost} request(s)`);
  console.log(`  as_of ${page.asOf ?? "—"} · licence ${page.licence ?? "—"}`);
  if (dates.length) console.log(`  window ${dates[0]} → ${dates[dates.length - 1]}`);
  if (page.clampedFrom) console.log(`  ! from clamped to ${page.clampedFrom} by the plan's history depth`);
  if (page.clampedTo) console.log(`  ! to clamped to ${page.clampedTo} (latest settled session)`);
  if (page.truncated) console.log(`  ! TRUNCATED at ${page.pages} page(s): more rows remain on the server, so this is not the full window`);
}

function printPrices(page: PagedResult<PriceBar>): void {
  const head = ["DATE".padEnd(12), "OPEN".padStart(9), "HIGH".padStart(9), "LOW".padStart(9), "CLOSE".padStart(9), "VOLUME".padStart(14), "VALUE".padStart(12)].join(" ");
  console.log("");
  console.log(head);
  console.log("-".repeat(head.length));
  for (const bar of page.rows.slice(-5)) {
    console.log(
      [
        bar.date.padEnd(12),
        bar.open.toFixed(0).padStart(9),
        bar.high.toFixed(0).padStart(9),
        bar.low.toFixed(0).padStart(9),
        bar.close.toFixed(0).padStart(9),
        bar.volume.toLocaleString("en-US").padStart(14),
        idr(bar.value).padStart(12),
      ].join(" "),
    );
  }
}

function printFlow(page: PagedResult<ForeignFlowMarketDay>): void {
  const head = ["DATE".padEnd(12), "BUY".padStart(12), "SELL".padStart(12), "NET".padStart(12)].join(" ");
  console.log("");
  console.log(head);
  console.log("-".repeat(head.length));
  for (const row of page.rows.slice(-5)) {
    console.log(
      [
        row.date.padEnd(12),
        idr(row.foreign_buy_value).padStart(12),
        idr(row.foreign_sell_value).padStart(12),
        idr(row.foreign_net_value).padStart(12),
      ].join(" "),
    );
  }
}

async function main(): Promise<void> {
  loadLocalEnv();
  const args = parseArgs(process.argv.slice(2));

  if (!artharaConfigured()) {
    console.error("ARTHARA_API_KEY is not set. Put it in research-terminal/.env.local (gitignored) or export it.");
    process.exitCode = 2;
    return;
  }

  if (args.command === "usage") {
    const usage = await fetchUsage();
    console.log(`plan ${usage.plan.name} (${usage.plan.code}) · licence ${usage.plan.licence} · status ${usage.status}`);
    console.log(`quota ${usage.quota.used}/${usage.quota.limit ?? "—"} used · ${usage.quota.remaining} remaining${usage.quota.lifetime ? " (lifetime)" : ""}`);
    console.log(`period ${usage.period.start.slice(0, 10)} → ${usage.period.end.slice(0, 10)}`);
    console.log(
      `limits history ${usage.limits.history_years}y · rows/page ${usage.limits.rows_per_page} · batch ${usage.limits.batch_max} · ${usage.limits.rate_per_min} req/min`,
    );
    return;
  }

  if (args.command === "status") {
    const rows = await fetchStatus();
    console.log("dataset as-of dates (stale feeds are visible here, not inferred):");
    for (const row of rows) console.log(`  ${row.dataset.padEnd(24)} ${row.as_of}`);
    return;
  }

  const isProbe = args.command === "probe";
  const isMarket = args.command === "market-flow";
  if (!isProbe && !isMarket) {
    console.error(`unknown command "${args.command}". Use usage | status | market-flow | probe.`);
    process.exitCode = 2;
    return;
  }

  const usage = await fetchUsage();
  const pages = Math.max(1, Math.min(args.pages, 10));
  // Each page is a separate billed request.
  const cost = (isMarket ? 1 : 2) * pages;
  const plan = isMarket
    ? "call /v1/foreign-flow/market (whole exchange), one page"
    : `call /v1/prices/daily and /v1/foreign-flow for ${args.ticker}, one page each`;
  console.log(
    `quota before: ${usage.quota.remaining} of ${usage.quota.limit ?? "—"} remaining · this ${args.command} would spend ${cost} request(s)`,
  );
  if (!args.yes) {
    console.log("dry run — nothing was read and nothing was spent. Re-run with --yes to spend it.");
    console.log(`it would ${plan}.`);
    return;
  }
  if (usage.quota.remaining < cost) {
    console.error(`refusing: ${usage.quota.remaining} request(s) left, this ${args.command} needs ${cost}.`);
    process.exitCode = 1;
    return;
  }

  const common = { ticker: args.ticker, from: args.from ?? undefined, to: args.to ?? undefined, maxPages: pages, pauseMs: 12_500 };
  const reads: Array<PagedResult<unknown>> = [];

  if (isMarket) {
    const market = await fetchMarketForeignFlow({ from: args.from ?? undefined, to: args.to ?? undefined, maxPages: pages, pauseMs: 12_500 });
    describe("/v1/foreign-flow/market · whole exchange", market);
    printFlow(market);
    reads.push(market);
  } else {
    const prices = await fetchDailyPrices(common);
    describe(`/v1/prices/daily · ${args.ticker}`, prices);
    printPrices(prices);
    reads.push(prices);

    // Stay under the sandbox's 5 requests/minute between calls.
    await new Promise((resolve) => setTimeout(resolve, 12_500));

    const flow = await fetchForeignFlow(common);
    describe(`/v1/foreign-flow · ${args.ticker}`, flow);
    printFlow(flow);
    reads.push(flow);
  }

  const reported = reads.reduce((sum, read) => sum + read.cost, 0);

  // The usage call is free but still rate-limited, so pace it like any other.
  await new Promise((resolve) => setTimeout(resolve, 12_500));

  try {
    const after = await fetchUsage();
    const spent = usage.quota.remaining - after.quota.remaining;
    console.log(`\nquota after: ${after.quota.remaining} remaining · spent ${spent} (reported cost ${reported})`);
    if (spent !== reported) {
      console.log("  note: the balance moved by a different amount than meta.cost reported; trust the balance.");
    }
  } catch (error) {
    // The reads already succeeded; a throttled balance check must not look like
    // a failed probe. Say what is unknown instead of guessing the new balance.
    console.log(`\nthe reads succeeded and cost ${reported} request(s) by meta.cost.`);
    console.log(
      `the balance check was rate-limited (${error instanceof ArtharaError ? error.code : "error"}), so the new balance is unknown; re-run "usage" in a minute.`,
    );
  }
}

main().catch((error: unknown) => {
  if (error instanceof ArtharaError) {
    console.error(`arthara ${error.code} (HTTP ${error.status}${error.requestId ? `, request ${error.requestId}` : ""}): ${error.message}`);
    if (error.requiredPlan) console.error(`  this endpoint needs the ${error.requiredPlan} plan.`);
  } else {
    console.error(error instanceof Error ? error.message : error);
  }
  process.exitCode = 1;
});
