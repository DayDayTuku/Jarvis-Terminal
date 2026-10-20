import { createHmac, timingSafeEqual } from "node:crypto";

type HeaderBag = { get(name: string): string | null };

function decodeSecret(secret: string) {
  return Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64");
}

/**
 * Resend signs webhooks with Svix. Verify manually so the app does not need an
 * extra SDK just for this endpoint.
 * https://docs.svix.com/receiving/verifying-payloads/how-manual
 */
export function verifyResendSignature(options: {
  headers: HeaderBag;
  payload: string;
  secret: string;
  now?: number;
  toleranceSeconds?: number;
}) {
  const { headers, payload, secret, now = Date.now(), toleranceSeconds = 300 } = options;
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signatures = headers.get("svix-signature");
  if (!id || !timestamp || !signatures || !secret) return false;

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) return false;
  if (Math.abs(now / 1000 - timestampSeconds) > toleranceSeconds) return false;

  const expected = createHmac("sha256", decodeSecret(secret))
    .update(`${id}.${timestamp}.${payload}`)
    .digest("base64");

  return signatures.split(" ").some((entry) => {
    const [version, supplied] = entry.split(",");
    if (version !== "v1" || !supplied) return false;
    const a = Buffer.from(supplied);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}
