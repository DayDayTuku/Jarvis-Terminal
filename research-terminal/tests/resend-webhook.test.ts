import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyResendSignature } from "../lib/resend-webhook.ts";

const rawSecret = Buffer.from("test-webhook-secret").toString("base64");
const secret = `whsec_${rawSecret}`;

function headersFor(id: string, timestamp: number, payload: string, signingSecret = secret) {
  const key = Buffer.from(signingSecret.replace(/^whsec_/, ""), "base64");
  const signature = createHmac("sha256", key).update(`${id}.${timestamp}.${payload}`).digest("base64");
  return new Headers({
    "svix-id": id,
    "svix-timestamp": String(timestamp),
    "svix-signature": `v1,${signature}`,
  });
}

test("valid Svix signatures are accepted", () => {
  const payload = JSON.stringify({ type: "email.bounced", data: { to: ["owner@example.com"] } });
  const now = 1_700_000_000_000;
  assert.equal(
    verifyResendSignature({ headers: headersFor("msg_1", now / 1000, payload), payload, secret, now }),
    true,
  );
});

test("tampered payloads, wrong secrets, and stale timestamps are rejected", () => {
  const payload = JSON.stringify({ type: "email.complained" });
  const now = 1_700_000_000_000;
  const headers = headersFor("msg_2", now / 1000, payload);

  assert.equal(verifyResendSignature({ headers, payload: `${payload} `, secret, now }), false);
  assert.equal(
    verifyResendSignature({ headers: headersFor("msg_2", now / 1000, payload, `whsec_${Buffer.from("other").toString("base64")}`), payload, secret, now }),
    false,
  );
  assert.equal(
    verifyResendSignature({ headers: headersFor("msg_2", now / 1000 - 600, payload), payload, secret, now }),
    false,
  );
});

test("missing signature headers are rejected", () => {
  assert.equal(
    verifyResendSignature({ headers: new Headers(), payload: "{}", secret, now: Date.now() }),
    false,
  );
});
