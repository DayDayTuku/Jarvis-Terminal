import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { GET as fred } from "../app/api/fred/route.ts";
import { GET as markets } from "../app/api/markets/route.ts";
import { GET as seasonality } from "../app/api/seasonality/route.ts";
import { GET as cot } from "../app/api/cot/route.ts";

function stubFetch(handler: typeof fetch) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return () => {
    globalThis.fetch = original;
  };
}

const csv = [
  "observation_date,VALUE",
  ...Array.from({ length: 14 }, (_, index) => {
    const month = String((index % 12) + 1).padStart(2, "0");
    const year = 2023 + Math.floor(index / 12);
    return `${year}-${month}-01,${100 + index}`;
  }),
].join("\n");

test("GET /api/fred parses the keyless CSV fallback into a live payload", async () => {
  const priorKey = process.env.FRED_API_KEY;
  delete process.env.FRED_API_KEY;
  const restore = stubFetch((async () =>
    new Response(csv, { status: 200, headers: { "content-type": "text/csv" } })) as typeof fetch);

  try {
    const response = await fred();
    assert.equal(response.status, 200);
    const body = await response.json() as { status: string; indicators: unknown[]; yields: unknown[]; regime: unknown[] };
    assert.equal(body.status, "live");
    assert.equal(body.indicators.length, 6);
    assert.equal(body.yields.length, 7);
    assert.equal(body.regime.length, 2);
    assert.match(response.headers.get("cache-control") ?? "", /max-age=900/);
  } finally {
    restore();
    if (priorKey === undefined) delete process.env.FRED_API_KEY;
    else process.env.FRED_API_KEY = priorKey;
  }
});

test("GET /api/fred reports an outage as stale instead of inventing values", async () => {
  const restore = stubFetch((async () => {
    throw new Error("FRED is down");
  }) as typeof fetch);

  try {
    const response = await fred();
    assert.equal(response.status, 503);
    const body = await response.json() as { status: string; error: string };
    assert.equal(body.status, "stale");
    assert.match(body.error, /FRED is down/);
  } finally {
    restore();
  }
});

test("GET /api/markets returns a 503 when every Yahoo symbol fails", async () => {
  const restore = stubFetch((async () =>
    new Response("unavailable", { status: 502 })) as typeof fetch);

  try {
    const response = await markets();
    assert.equal(response.status, 503);
    const body = await response.json() as { status: string; failures: unknown[] };
    assert.equal(body.status, "stale");
    assert.ok(body.failures.length > 0);
  } finally {
    restore();
  }
});

test("GET /api/seasonality reports a 503 when the chart feed fails", async () => {
  const restore = stubFetch((async () => {
    throw new Error("Yahoo unavailable");
  }) as typeof fetch);

  try {
    const request = new NextRequest("https://jarvis.test/api/seasonality?ticker=BUMI");
    const response = await seasonality(request);
    assert.equal(response.status, 503);
    const body = await response.json() as { status: string; ticker: string };
    assert.equal(body.status, "stale");
    assert.equal(body.ticker, "BUMI");
  } finally {
    restore();
  }
});

test("GET /api/cot returns a 503 with the failed datasets listed", async () => {
  const restore = stubFetch((async () => {
    throw new Error("CFTC unavailable");
  }) as typeof fetch);

  try {
    const response = await cot();
    assert.equal(response.status, 503);
    const body = await response.json() as { status: string; failures: unknown[] };
    assert.equal(body.status, "stale");
    assert.ok(body.failures.length > 0);
  } finally {
    restore();
  }
});
