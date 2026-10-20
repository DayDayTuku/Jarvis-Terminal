import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyUnsubscribeToken } from "@/lib/email-unsubscribe";

export const dynamic = "force-dynamic";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char] || char);
}

function page(title: string, body: string, status = 200) {
  return new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Jarvis</title><style>body{margin:0;background:#05070a;color:#e8edf3;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;display:grid;min-height:100vh;place-items:center;padding:24px}main{max-width:520px;border:1px solid #1f2d3d;background:#080c11;padding:28px}h1{font-size:18px;margin:0 0 14px;letter-spacing:.06em}p{color:#93a0af;font-size:13px;line-height:1.7}button{background:#48a6ff;border:0;color:#03111f;font-weight:700;padding:11px 18px;font:inherit;cursor:pointer}a{color:#48a6ff}small{display:block;margin-top:18px;color:#5c6875;font-size:10px}</style></head><body><main>${body}</main></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );
}

async function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function findUserByEmail(supabase: NonNullable<Awaited<ReturnType<typeof serviceClient>>>, email: string) {
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const user = data.users.find((item) => item.email?.trim().toLowerCase() === email);
    if (user) return user;
    if (data.users.length < 1000) return null;
  }
  return null;
}

async function unsubscribe(token: string) {
  const secret = process.env.EMAIL_UNSUBSCRIBE_SECRET || process.env.CRON_SECRET || "";
  const email = verifyUnsubscribeToken(token, secret);
  if (!email) return page("Invalid link", "<h1>This unsubscribe link is invalid.</h1><p>Ask the sender to remove your address, or turn the digest off in Jarvis → Settings.</p>", 400);

  const supabase = await serviceClient();
  if (!supabase) return page("Unavailable", "<h1>Email settings are unavailable.</h1><p>Try again later, or turn the digest off in Jarvis → Settings.</p>", 503);

  const { error: suppressionError } = await supabase
    .from("jarvis_email_suppressions")
    .upsert({ email, reason: "unsubscribe" }, { onConflict: "email" });

  let user = null;
  try {
    user = await findUserByEmail(supabase, email);
    if (user) {
      await supabase.auth.admin.updateUserById(user.id, {
        user_metadata: {
          ...(user.user_metadata || {}),
          weekly_picks_opt_in: false,
          weekly_picks_opt_out_at: new Date().toISOString(),
        },
      });
    }
  } catch {
    // The suppression list is the source of truth for sending even if the
    // account lookup fails.
  }

  if (suppressionError && !user) {
    return page("Try again", "<h1>We could not update your email preferences.</h1><p>Please try again in a moment.</p>", 503);
  }

  return page(
    "Unsubscribed",
    `<h1>You are unsubscribed.</h1><p><strong>${escapeHtml(email)}</strong> will no longer receive Weekly Picks or market-alert emails.</p><p>You can opt back in at any time in Jarvis → Settings.</p><small>JARVIS RESEARCH</small>`,
  );
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") || "";
  const email = verifyUnsubscribeToken(token, process.env.EMAIL_UNSUBSCRIBE_SECRET || process.env.CRON_SECRET || "");
  if (!email) return page("Invalid link", "<h1>This unsubscribe link is invalid.</h1><p>Ask the sender to remove your address, or turn the digest off in Jarvis → Settings.</p>", 400);

  return page(
    "Unsubscribe",
    `<h1>Stop email updates?</h1><p><strong>${escapeHtml(email)}</strong> will stop receiving Weekly Picks and market-alert emails.</p><form method="post"><input type="hidden" name="token" value="${escapeHtml(token)}"><button type="submit">Unsubscribe</button></form><p><a href="/">Return to Jarvis</a></p><small>JARVIS RESEARCH</small>`,
  );
}

export async function POST(request: NextRequest) {
  let token = request.nextUrl.searchParams.get("token") || "";
  if (!token) {
    const form = await request.formData().catch(() => null);
    token = String(form?.get("token") || "");
  }
  return unsubscribe(token);
}
