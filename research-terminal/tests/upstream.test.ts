import test from "node:test";
import assert from "node:assert/strict";
import { fetchUpstream } from "../lib/upstream.ts";

function stubFetch(handler: typeof fetch) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return () => {
    globalThis.fetch = original;
  };
}

test("fetchUpstream aborts a hung request instead of waiting forever", async () => {
  const restore = stubFetch(((_, init) =>
    new Promise((_, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(new DOMException("The operation was aborted.", "AbortError")),
      );
    })) as typeof fetch);

  try {
    // AbortSignal.timeout() uses an unref'd timer. In a server there is always
    // other work holding the loop open; in a bare test process there isn't, so
    // keep one ref'd timer alive for the duration of the assertion.
    const keepAlive = setTimeout(() => undefined, 200);
    try {
      await assert.rejects(
        () => fetchUpstream("https://example.test/hung", { timeoutMs: 20 }),
        /abort/i,
      );
    } finally {
      clearTimeout(keepAlive);
    }
  } finally {
    restore();
  }
});

test("fetchUpstream retries a transient 5xx on GET", async () => {
  let calls = 0;
  const restore = stubFetch((async () => {
    calls += 1;
    return calls === 1
      ? new Response("busy", { status: 503 })
      : new Response("ok", { status: 200 });
  }) as typeof fetch);

  try {
    const response = await fetchUpstream("https://example.test/retry", {
      attempts: 2,
      retryDelayMs: 1,
    });
    assert.equal(response.status, 200);
    assert.equal(calls, 2);
  } finally {
    restore();
  }
});

test("fetchUpstream never retries a POST", async () => {
  let calls = 0;
  const restore = stubFetch((async () => {
    calls += 1;
    return new Response("down", { status: 503 });
  }) as typeof fetch);

  try {
    const response = await fetchUpstream("https://example.test/send", {
      method: "POST",
      attempts: 3,
      retryDelayMs: 1,
    });
    assert.equal(response.status, 503);
    assert.equal(calls, 1);
  } finally {
    restore();
  }
});

test("fetchUpstream does not retry a 4xx", async () => {
  let calls = 0;
  const restore = stubFetch((async () => {
    calls += 1;
    return new Response("nope", { status: 404 });
  }) as typeof fetch);

  try {
    const response = await fetchUpstream("https://example.test/missing", {
      attempts: 3,
      retryDelayMs: 1,
    });
    assert.equal(response.status, 404);
    assert.equal(calls, 1);
  } finally {
    restore();
  }
});
