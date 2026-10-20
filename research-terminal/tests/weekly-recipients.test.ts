import test from "node:test";
import assert from "node:assert/strict";
import { weeklyRecipients } from "../app/api/cron/weekly-picks/route.ts";
import type { DigestUser } from "../lib/email-recipients.ts";

function optedIn(email: string): DigestUser {
  return {
    email,
    email_confirmed_at: "2026-01-01T00:00:00.000Z",
    user_metadata: { weekly_picks_opt_in: true },
  };
}

function client(pages: DigestUser[][], suppressed: string[] = [], failAtPage?: number) {
  const calls: number[] = [];
  return {
    calls,
    from() {
      return {
        select: async () => ({
          data: suppressed.map((email) => ({ email })),
          error: null,
        }),
      };
    },
    auth: {
      admin: {
        listUsers: async ({ page }: { page: number }) => {
          calls.push(page);
          if (page === failAtPage) return { data: null, error: new Error("auth unavailable") };
          return { data: { users: pages[page - 1] || [] }, error: null };
        },
      },
    },
  };
}

async function withOwner<T>(owner: string, run: () => Promise<T>) {
  const previous = process.env.JARVIS_EMAIL_TO;
  process.env.JARVIS_EMAIL_TO = owner;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.JARVIS_EMAIL_TO;
    else process.env.JARVIS_EMAIL_TO = previous;
  }
}

test("recipients paginate past the first 1,000 users", async () => {
  const firstPage = Array.from({ length: 1000 }, (_, index) => optedIn(`user${index}@example.com`));
  const secondPage = [optedIn("late@example.com")];
  const supabase = client([firstPage, secondPage]);

  const recipients = await withOwner("owner@example.com", () => weeklyRecipients(supabase));

  assert.deepEqual(supabase.calls, [1, 2]);
  assert.equal(recipients[0], "owner@example.com");
  assert.equal(recipients.includes("late@example.com"), true);
  assert.equal(recipients.length, 1002);
});

test("suppressed owners and users are removed", async () => {
  const secondPage = [optedIn("late@example.com"), optedIn("blocked@example.com")];
  const supabase = client([secondPage], ["blocked@example.com", "owner@example.com"]);

  const recipients = await withOwner("owner@example.com", () => weeklyRecipients(supabase));

  assert.deepEqual(recipients, ["late@example.com"]);
});

test("an auth failure falls back to the configured owners only", async () => {
  const supabase = client([[optedIn("user@example.com")]], ["owner@example.com"], 1);

  const recipients = await withOwner("owner@example.com", () => weeklyRecipients(supabase));

  assert.deepEqual(recipients, []);
});
