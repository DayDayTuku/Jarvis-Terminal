import test from "node:test";
import assert from "node:assert/strict";
import { fetchWatchQuotes, parseChartQuote } from "../lib/watch-quotes.ts";

function payload(closes: Array<number | null>, marketPrice?: number) {
  return {
    chart: {
      result: [
        {
          meta: marketPrice === undefined ? {} : { regularMarketPrice: marketPrice },
          indicators: { quote: [{ close: closes }] },
        },
      ],
    },
  };
}

test("chart quotes prefer the live market price and derive the 1D change", () => {
  assert.deepEqual(parseChartQuote("BBCA", payload([100, 110], 121)), {
    ticker: "BBCA",
    price: 121,
    change: 10,
  });
});

test("chart quotes fall back to the latest valid close", () => {
  assert.deepEqual(parseChartQuote("ADRO", payload([100, 105])), {
    ticker: "ADRO",
    price: 105,
    change: 5,
  });
});

test("chart quotes ignore invalid closes and missing payloads", () => {
  assert.deepEqual(parseChartQuote("BUMI", payload([100, null, -5, 110])), {
    ticker: "BUMI",
    price: 110,
    change: 10,
  });
  assert.equal(parseChartQuote("BUMI", payload([])), null);
  assert.deepEqual(parseChartQuote("BUMI", payload([100, 0])), {
    ticker: "BUMI",
    price: 100,
    change: 0,
  });
  assert.deepEqual(parseChartQuote("BUMI", payload([100], 0)), {
    ticker: "BUMI",
    price: 100,
    change: 0,
  });
  assert.equal(parseChartQuote("BUMI", { chart: { result: null } }), null);
  assert.equal(parseChartQuote("", payload([100, 110])), null);
  assert.equal(parseChartQuote("BUMI", null), null);
});

test("quote batches keep successes and report failed tickers", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("QUOTEOK")) {
      return new Response(JSON.stringify(payload([100, 110], 121)), { status: 200 });
    }
    return new Response("unavailable", { status: 502 });
  }) as typeof fetch;

  try {
    const result = await fetchWatchQuotes(["QUOTEOK", "QUOTEBAD"]);
    assert.deepEqual(result.quotes, [{ ticker: "QUOTEOK", price: 121, change: 10 }]);
    assert.deepEqual(result.failed, ["QUOTEBAD"]);
  } finally {
    globalThis.fetch = original;
  }
});
