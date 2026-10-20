import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import {
  collectServiceKeys,
  isPublicPath,
  isTrustedServiceRequest,
  proxy,
} from "../proxy.ts";
import { GET as weeklyPicks } from "../app/api/cron/weekly-picks/route.ts";
import { isAdmin } from "../lib/auth.ts";

test("missing service keys do not create a 'Bearer undefined' bypass", () => {
  const keys = collectServiceKeys(undefined, null, "   ");
  assert.deepEqual(keys, []);
  assert.equal(isTrustedServiceRequest("/api/swing-setups", "Bearer undefined", keys), false);
  assert.equal(isTrustedServiceRequest("/api/swing-setups", "Bearer ", keys), false);
});

test("configured service keys are trimmed and only unlock the scanner endpoint", () => {
  const keys = collectServiceKeys("  readonly-key  ", "", undefined);
  assert.deepEqual(keys, ["readonly-key"]);
  assert.equal(isTrustedServiceRequest("/api/swing-setups", "Bearer readonly-key", keys), true);
  assert.equal(isTrustedServiceRequest("/api/news", "Bearer readonly-key", keys), false);
  assert.equal(isTrustedServiceRequest("/api/swing-setups", "Bearer wrong", keys), false);
});

test("public paths bypass auth while application routes do not", () => {
  assert.equal(isPublicPath("/access"), true);
  assert.equal(isPublicPath("/_next/static/chunk.js"), true);
  assert.equal(isPublicPath("/api/cron/weekly-picks"), true);
  assert.equal(isPublicPath("/api/v1/markets"), true);
  assert.equal(isPublicPath("/api/email/unsubscribe"), true);
  assert.equal(isPublicPath("/api/webhooks/resend"), true);
  assert.equal(isPublicPath("/manifest.webmanifest"), true);
  assert.equal(isPublicPath("/"), false);
  assert.equal(isPublicPath("/api/news"), false);
  assert.equal(isPublicPath("/api/swing-setups"), false);
});

test("admin checks require the app_metadata admin role", () => {
  assert.equal(isAdmin({ app_metadata: { role: "admin" } }), true);
  assert.equal(isAdmin({ app_metadata: { role: "user" } }), false);
  assert.equal(isAdmin({ app_metadata: {} }), false);
  assert.equal(isAdmin(null), false);
});

test("proxy lets the access page and PWA assets through without Supabase env", async () => {
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  try {
    for (const path of ["/access", "/jarvis-logo-128.png", "/api/cron/weekly-picks"]) {
      const response = await proxy(new NextRequest(`https://jarvis.test${path}`));
      assert.equal(response.status, 200, path);
      assert.equal(response.headers.get("x-middleware-next"), "1", path);
    }
  } finally {
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousKey;
  }
});

test("weekly-picks refuses requests when CRON_SECRET is missing", async () => {
  const previous = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;

  try {
    // The old bypass compared against the literal "Bearer undefined".
    const response = await weeklyPicks(
      new NextRequest("https://jarvis.test/api/cron/weekly-picks", {
        headers: { authorization: "Bearer undefined" },
      }),
    );
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Unauthorized" });
  } finally {
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  }
});

test("weekly-picks rejects wrong or empty bearer tokens", async () => {
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "cron-secret";

  try {
    for (const authorization of [undefined, "", "Bearer ", "Bearer undefined", "Bearer nope"]) {
      const response = await weeklyPicks(
        new NextRequest("https://jarvis.test/api/cron/weekly-picks", {
          headers: authorization === undefined ? undefined : { authorization },
        }),
      );
      assert.equal(response.status, 401, String(authorization));
    }
  } finally {
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  }
});

test("weekly-picks reports missing database credentials after authenticating", async () => {
  const previousSecret = process.env.CRON_SECRET;
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.CRON_SECRET = "cron-secret";
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    const response = await weeklyPicks(
      new NextRequest("https://jarvis.test/api/cron/weekly-picks", {
        headers: { authorization: "Bearer cron-secret" },
      }),
    );
    assert.equal(response.status, 503);
    assert.match(((await response.json()) as { error: string }).error, /credentials are missing/i);
  } finally {
    if (previousSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previousSecret;
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});
