import test from "node:test";
import assert from "node:assert/strict";
import {
  filterSuppressed,
  hasConfirmedEmail,
  isWeeklyDigestOptedIn,
  selectDigestRecipients,
  type DigestUser,
} from "../lib/email-recipients.ts";

const confirmed = { email_confirmed_at: "2026-01-01T00:00:00Z" };

test("configured owner addresses always receive the digest", () => {
  assert.deepEqual(selectDigestRecipients([], ["Owner@Example.com"]), ["owner@example.com"]);
});

test("a plain account is not enrolled by signing up", () => {
  const users: DigestUser[] = [{ email: "stranger@example.com", ...confirmed }];
  assert.deepEqual(selectDigestRecipients(users, ["owner@example.com"]), ["owner@example.com"]);
});

test("only explicit opt-in users are added", () => {
  const users: DigestUser[] = [
    { email: "in@example.com", ...confirmed, user_metadata: { weekly_picks_opt_in: true } },
    { email: "out@example.com", ...confirmed, user_metadata: { weekly_picks_opt_in: false } },
    { email: "absent@example.com", ...confirmed },
  ];
  assert.deepEqual(selectDigestRecipients(users, ["owner@example.com"]), [
    "owner@example.com",
    "in@example.com",
  ]);
});

test("unconfirmed emails cannot opt in", () => {
  const users: DigestUser[] = [
    { email: "unconfirmed@example.com", user_metadata: { weekly_picks_opt_in: true } },
  ];
  assert.deepEqual(selectDigestRecipients(users, []), []);
  assert.equal(hasConfirmedEmail(users[0]), false);
});

test("missing or malformed email addresses are ignored", () => {
  const users: DigestUser[] = [
    { email: null, ...confirmed, user_metadata: { weekly_picks_opt_in: true } },
    { email: "   ", ...confirmed, user_metadata: { weekly_picks_opt_in: true } },
  ];
  assert.deepEqual(selectDigestRecipients(users, ["  ", ""]), []);
});

test("opt-in is a strict boolean, not a truthy string", () => {
  assert.equal(isWeeklyDigestOptedIn({ user_metadata: { weekly_picks_opt_in: "true" } }), false);
  assert.equal(isWeeklyDigestOptedIn({ user_metadata: { weekly_picks_opt_in: 1 } }), false);
  assert.equal(isWeeklyDigestOptedIn({ user_metadata: { weekly_picks_opt_in: true } }), true);
});

test("addresses are deduplicated case-insensitively", () => {
  const users: DigestUser[] = [
    { email: "OWNER@example.com", ...confirmed, user_metadata: { weekly_picks_opt_in: true } },
    { email: "second@example.com", ...confirmed, user_metadata: { weekly_picks_opt_in: true } },
  ];
  assert.deepEqual(selectDigestRecipients(users, ["owner@example.com"]), [
    "owner@example.com",
    "second@example.com",
  ]);
});

test("suppressed addresses are removed case-insensitively", () => {
  assert.deepEqual(
    filterSuppressed(
      ["Owner@Example.com", "second@example.com", "third@example.com"],
      ["owner@example.com", { email: "THIRD@example.com" }],
    ),
    ["second@example.com"],
  );
});

test("suppression accepts rows with missing email values", () => {
  assert.deepEqual(
    filterSuppressed(["owner@example.com"], [{ email: null }, { email: "   " }, "owner@example.com"]),
    [],
  );
});
