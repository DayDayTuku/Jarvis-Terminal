import test from "node:test";
import assert from "node:assert/strict";
import {
  checkLocalRateLimit,
  rateLimitBucket,
  rateLimitHeaders,
} from "../lib/rate-limit.ts";

test("local limiter allows the budget and then rejects with a retry hint", () => {
  const scope = `test-${Math.random()}`;
  for (let index = 0; index < 3; index += 1) {
    const result = checkLocalRateLimit(scope, 3, 60, 1_000);
    assert.equal(result.allowed, true, `request ${index + 1}`);
  }
  const denied = checkLocalRateLimit(scope, 3, 60, 1_000);
  assert.equal(denied.allowed, false);
  assert.equal(denied.remaining, 0);
  assert.equal(denied.backend, "local");
  assert.ok(Number(rateLimitHeaders(denied)["Retry-After"]) > 0);
});

test("local limiter resets after the window", () => {
  const scope = `reset-${Math.random()}`;
  assert.equal(checkLocalRateLimit(scope, 1, 60, 1_000).allowed, true);
  assert.equal(checkLocalRateLimit(scope, 1, 60, 2_000).allowed, false);
  assert.equal(checkLocalRateLimit(scope, 1, 60, 61_000).allowed, true);
});

test("rate-limit buckets are deterministic and do not contain the identifier", () => {
  const first = rateLimitBucket("stock-detail", "203.0.113.9");
  const second = rateLimitBucket("stock-detail", "203.0.113.9");
  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{40}$/);
  assert.equal(first.includes("203.0.113.9"), false);
});
