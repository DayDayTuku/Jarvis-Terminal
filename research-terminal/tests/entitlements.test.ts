import test from "node:test";
import assert from "node:assert/strict";
import { hasPlan, normalizePlan, planFromMetadata } from "../lib/entitlements.ts";

test("plans normalize to known tiers", () => {
  assert.equal(normalizePlan("PRO"), "pro");
  assert.equal(normalizePlan(" desk "), "desk");
  assert.equal(normalizePlan("enterprise"), "free");
  assert.equal(normalizePlan(null), "free");
  assert.equal(planFromMetadata({ plan: "pro" }), "pro");
  assert.equal(planFromMetadata({ plan: "invalid" }), "free");
  assert.equal(planFromMetadata(null), "free");
});

test("plan ordering supports feature checks", () => {
  assert.equal(hasPlan("free", "free"), true);
  assert.equal(hasPlan("free", "pro"), false);
  assert.equal(hasPlan("pro", "free"), true);
  assert.equal(hasPlan("desk", "pro"), true);
  assert.equal(hasPlan("pro", "desk"), false);
});
