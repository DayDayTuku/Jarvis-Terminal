import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyResendSignature } from "@/lib/resend-webhook";

export const dynamic = "force-dynamic";

function recipients(value: unknown) {
  const list = Array.isArray(value) ? value : [value];
  return [...new Set(
    list
      .filter((item): item is string => typeof item === "string")
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email.includes("@")),
  )];
}

export async function POST(request: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Webhook secret is not configured." }, { status: 503 });

  const payload = await request.text();
  if (!verifyResendSignature({ headers: request.headers, payload, secret })) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  let event: { type?: unknown; data?: { to?: unknown } };
  try {
    event = JSON.parse(payload) as typeof event;
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const type = typeof event.type === "string" ? event.type : "";
  if (type !== "email.bounced" && type !== "email.complained") {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const emails = recipients(event.data?.to);
  if (!emails.length) return NextResponse.json({ ok: true, ignored: true });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "Database credentials are missing." }, { status: 503 });

  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await supabase
    .from("jarvis_email_suppressions")
    .upsert(emails.map((email) => ({ email, reason: type })), { onConflict: "email" });

  if (error) return NextResponse.json({ error: "Unable to record suppression." }, { status: 500 });
  return NextResponse.json({ ok: true, suppressed: emails.length });
}
