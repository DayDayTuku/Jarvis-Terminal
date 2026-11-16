import test from "node:test";
import assert from "node:assert/strict";
import { ArtharaError, artharaConfigured, artharaPaged, artharaRequest, fetchFundamentalsSnapshot } from "../lib/arthara.ts";

function stubFetch(handler: typeof fetch) {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = ((input, init) => {
    calls.push(String(input));
    return handler(input, init);
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function withKey<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env.ARTHARA_API_KEY;
  process.env.ARTHARA_API_KEY = "ak_live_test_key";
  return run().finally(() => {
    if (previous === undefined) delete process.env.ARTHARA_API_KEY;
    else process.env.ARTHARA_API_KEY = previous;
  });
}

function page<T>(rows: T[], meta: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({
      data: rows,
      meta: { request_id: "req_1", as_of: "2026-11-13", cost: 1, licence: "evaluation", next_cursor: null, ...meta },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

test("artharaConfigured reports the key without exposing it", () => {
  const previous = process.env.ARTHARA_API_KEY;
  delete process.env.ARTHARA_API_KEY;
  assert.equal(artharaConfigured(), false);
  process.env.ARTHARA_API_KEY = "ak_live_secret";
  assert.equal(artharaConfigured(), true);
  if (previous === undefined) delete process.env.ARTHARA_API_KEY;
  else process.env.ARTHARA_API_KEY = previous;
});

test("a missing key fails before any request is made", async () => {
  const previous = process.env.ARTHARA_API_KEY;
  delete process.env.ARTHARA_API_KEY;
  const stub = stubFetch((async () => page([])) as typeof fetch);
  try {
    await assert.rejects(
      () => artharaRequest("/v1/usage"),
      (error: unknown) => error instanceof ArtharaError && error.code === "not_configured",
    );
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
    if (previous === undefined) delete process.env.ARTHARA_API_KEY;
    else process.env.ARTHARA_API_KEY = previous;
  }
});

test("a request sends bearer auth and the query, and returns the page", async () => {
  const stub = stubFetch((async () =>
    page([{ ticker: "BBCA", date: "2026-11-13", close: 9000 }], { adjusted: true })) as typeof fetch);
  try {
    await withKey(async () => {
      const result = await artharaRequest<Array<{ close: number }>>("/v1/prices/daily", { ticker: "BBCA", from: "2026-11-01", limit: 500 });
      assert.equal(result.meta.as_of, "2026-11-13");
      assert.equal(result.meta.adjusted, true);
      assert.equal(result.data[0].close, 9000);
    });
    const url = new URL(stub.calls[0]);
    assert.equal(url.origin + url.pathname, "https://data.arthara.id/v1/prices/daily");
    assert.equal(url.searchParams.get("ticker"), "BBCA");
    assert.equal(url.searchParams.get("limit"), "500");
    assert.equal(url.searchParams.get("cursor"), null);
  } finally {
    stub.restore();
  }
});

test("an API error becomes an ArtharaError with the stable code and request id", async () => {
  const stub = stubFetch((async () =>
    new Response(
      JSON.stringify({
        error: { code: "plan_upgrade_required", message: "This endpoint needs the Analyst plan.", request_id: "req_9", required_plan: "analyst" },
      }),
      { status: 403, headers: { "content-type": "application/json", "x-request-id": "req_9" } },
    )) as typeof fetch);
  try {
    await withKey(async () => {
      await assert.rejects(
        () => artharaRequest("/v1/signals/wyckoff", { ticker: "BBCA" }),
        (error: unknown) =>
          error instanceof ArtharaError &&
          error.code === "plan_upgrade_required" &&
          error.status === 403 &&
          error.requestId === "req_9" &&
          error.requiredPlan === "analyst",
      );
    });
  } finally {
    stub.restore();
  }
});

test("pagination follows the cursor but stops at maxPages and says so", async () => {
  let call = 0;
  const stub = stubFetch((async () => {
    call += 1;
    const cursor = call < 3 ? `cursor_${call}` : null;
    return page([{ date: `2026-11-0${call}` }], { next_cursor: cursor });
  }) as typeof fetch);
  try {
    await withKey(async () => {
      const first = await artharaPaged<{ date: string }>("/v1/foreign-flow", { ticker: "BBCA" });
      assert.equal(first.pages, 1);
      assert.equal(first.rows.length, 1);
      assert.equal(first.truncated, true, "one page with a cursor left is not the full window");
      assert.equal(first.cost, 1);

      call = 0;
      const two = await artharaPaged<{ date: string }>("/v1/foreign-flow", { ticker: "BBCA" }, { maxPages: 2 });
      assert.equal(two.pages, 2);
      assert.equal(two.rows.length, 2);
      assert.equal(two.cost, 2);
      assert.equal(two.truncated, true, "still more rows after two pages");
      assert.match(stub.calls[2], /cursor=cursor_1/);

      call = 0;
      const all = await artharaPaged<{ date: string }>("/v1/foreign-flow", { ticker: "BBCA" }, { maxPages: 5 });
      assert.equal(all.pages, 3);
      assert.equal(all.truncated, false);
      assert.equal(all.cost, 3);
    });
  } finally {
    stub.restore();
  }
});

test("a clamped window is surfaced instead of looking like missing data", async () => {
  const stub = stubFetch((async () =>
    page([], { clamped_from: "2025-11-16", clamped_to: "2026-11-13", as_of: "2026-11-13" })) as typeof fetch);
  try {
    await withKey(async () => {
      const result = await artharaPaged("/v1/prices/daily", { ticker: "BBCA" }, { maxPages: 1 });
      assert.equal(result.clampedFrom, "2025-11-16");
      assert.equal(result.clampedTo, "2026-11-13");
    });
  } finally {
    stub.restore();
  }
});

test("a null figure stays null instead of being zero-filled", async () => {
  const stub = stubFetch((async () =>
    page([
      { ticker: "BBCA", field: "valuation.pe", value: null, unit: "x" },
      { ticker: "BBCA", field: "profitability.roe_pct", value: 21.5, unit: "pct" },
    ])) as typeof fetch);
  try {
    await withKey(async () => {
      const result = await fetchFundamentalsSnapshot("BBCA", { fieldGroup: "valuation" });
      assert.equal(result.rows[0].value, null);
      assert.equal(result.rows[1].value, 21.5);
      assert.match(stub.calls[0], /field_group=valuation/);
    });
  } finally {
    stub.restore();
  }
});

test("a transient 429 is retried only when asked", async () => {
  let calls = 0;
  const stub = stubFetch((async () => {
    calls += 1;
    return calls === 1
      ? new Response(JSON.stringify({ error: { code: "rate_limited", message: "slow down" } }), { status: 429 })
      : page([]);
  }) as typeof fetch);
  try {
    await withKey(async () => {
      await assert.rejects(() => artharaRequest("/v1/usage"), (error: unknown) => error instanceof ArtharaError && error.code === "rate_limited");
      assert.equal(calls, 1, "a single attempt must not silently spend a second request");
      calls = 0;
      const result = await artharaRequest("/v1/usage", {}, { attempts: 2, retryDelayMs: 1 });
      assert.equal(result.meta.cost, 1);
      assert.equal(calls, 2);
    });
  } finally {
    stub.restore();
  }
});
