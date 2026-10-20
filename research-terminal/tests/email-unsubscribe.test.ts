import test from "node:test";
import assert from "node:assert/strict";
import {
  createUnsubscribeToken,
  unsubscribeUrl,
  verifyUnsubscribeToken,
} from "../lib/email-unsubscribe.ts";

const secret = "test-unsubscribe-secret";

test("unsubscribe tokens round-trip and normalize the address", () => {
  const token = createUnsubscribeToken(" Owner@Example.com ", secret);
  assert.equal(verifyUnsubscribeToken(token, secret), "owner@example.com");
});

test("tampered or incorrectly signed tokens are rejected", () => {
  const token = createUnsubscribeToken("owner@example.com", secret);
  assert.equal(verifyUnsubscribeToken(`${token}x`, secret), null);
  assert.equal(verifyUnsubscribeToken(token, "wrong-secret"), null);
  assert.equal(verifyUnsubscribeToken("not-a-token", secret), null);
  assert.equal(verifyUnsubscribeToken(token, ""), null);
});

test("unsubscribe URLs include the encoded token", () => {
  const previous = process.env.EMAIL_UNSUBSCRIBE_SECRET;
  const previousCron = process.env.CRON_SECRET;
  process.env.EMAIL_UNSUBSCRIBE_SECRET = secret;
  try {
    const url = unsubscribeUrl("owner@example.com", "https://jarvis.test/");
    assert.ok(url);
    assert.match(url, /^https:\/\/jarvis\.test\/api\/email\/unsubscribe\?token=/);
    const token = decodeURIComponent(url!.split("token=")[1]);
    assert.equal(verifyUnsubscribeToken(token, secret), "owner@example.com");
  } finally {
    if (previous === undefined) delete process.env.EMAIL_UNSUBSCRIBE_SECRET;
    else process.env.EMAIL_UNSUBSCRIBE_SECRET = previous;
    if (previousCron === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previousCron;
  }
});
