import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const port = process.env.SMOKE_PORT || "3100";
const base = `http://127.0.0.1:${port}`;
const root = fileURLToPath(new URL("..", import.meta.url));
const nextBin = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));

const child = spawn(process.execPath, [nextBin, "start", "-p", port], {
  cwd: root,
  env: {
    ...process.env,
    NODE_ENV: "production",
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "smoke-test-anon-key",
    NEXT_PUBLIC_SITE_URL: base,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let logs = "";
child.stdout.on("data", (chunk) => { logs += chunk; });
child.stderr.on("data", (chunk) => { logs += chunk; });

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${base}/access`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Server did not start in time.\n${logs}`);
}

try {
  await waitForServer();

  const access = await fetch(`${base}/access`);
  assert.equal(access.status, 200, "/access should render");
  assert.match(access.headers.get("content-security-policy") || "", /default-src 'self'/);
  assert.equal(access.headers.get("x-content-type-options"), "nosniff");
  assert.equal(access.headers.get("x-frame-options"), "DENY");

  const cron = await fetch(`${base}/api/cron/weekly-picks`);
  assert.equal(cron.status, 401, "cron must reject anonymous requests");

  const api = await fetch(`${base}/api/v1/weekly-picks`);
  assert.equal(api.status, 401, "v1 must reject requests without the read-only key");

  console.log("smoke: access page, security headers, cron auth, and v1 auth passed");
} finally {
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]);
  if (!child.killed) child.kill("SIGKILL");
}
