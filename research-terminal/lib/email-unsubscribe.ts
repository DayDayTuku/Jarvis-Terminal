import { createHmac, timingSafeEqual } from "node:crypto";

function signature(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function unsubscribeSecret() {
  return process.env.EMAIL_UNSUBSCRIBE_SECRET || process.env.CRON_SECRET || "";
}

export function createUnsubscribeToken(email: string, secret: string) {
  const normalized = email.trim().toLowerCase();
  const payload = Buffer.from(normalized, "utf8").toString("base64url");
  return `${payload}.${signature(payload, secret)}`;
}

export function verifyUnsubscribeToken(token: string, secret: string) {
  if (!token || !secret) return null;
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return null;

  const payload = token.slice(0, separator);
  const supplied = token.slice(separator + 1);
  const expected = signature(payload, secret);
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const email = Buffer.from(payload, "base64url").toString("utf8").trim().toLowerCase();
    return email.includes("@") ? email : null;
  } catch {
    return null;
  }
}

export function unsubscribeUrl(email: string, siteUrl?: string) {
  const secret = unsubscribeSecret();
  if (!secret) return null;
  const base = (siteUrl || process.env.NEXT_PUBLIC_SITE_URL || "https://jarvisfinance.my.id").replace(/\/$/, "");
  return `${base}/api/email/unsubscribe?token=${encodeURIComponent(createUnsubscribeToken(email, secret))}`;
}
