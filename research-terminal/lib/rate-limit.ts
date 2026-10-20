import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Unix milliseconds. */
  resetAt: number;
  backend: "shared" | "local";
};

type LocalBucket = { count: number; resetAt: number };

const localBuckets = new Map<string, LocalBucket>();
const MAX_LOCAL_BUCKETS = 5_000;

let sharedClient: SupabaseClient | null = null;
let sharedClientKey = "";

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const cacheKey = `${url}:${key}`;
  if (!sharedClient || sharedClientKey !== cacheKey) {
    sharedClient = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    sharedClientKey = cacheKey;
  }
  return sharedClient;
}

/** Hash identifiers so raw IPs and user IDs never land in the database. */
export function rateLimitBucket(scope: string, identifier: string) {
  return createHash("sha256")
    .update(`${scope}:${identifier}`)
    .digest("hex")
    .slice(0, 40);
}

export function clientIdentifier(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

/**
 * Per-instance fallback used when the shared store is unavailable. It is not a
 * substitute for the shared limiter, but it still stops a single hot instance
 * from being hammered during a database outage.
 */
export function checkLocalRateLimit(
  bucket: string,
  limit: number,
  windowSeconds: number,
  now = Date.now(),
): RateLimitResult {
  const resetAt = now + windowSeconds * 1000;
  const prior = localBuckets.get(bucket);
  const state = !prior || prior.resetAt <= now
    ? { count: 0, resetAt }
    : prior;

  state.count += 1;
  localBuckets.set(bucket, state);

  if (localBuckets.size > MAX_LOCAL_BUCKETS) {
    for (const [key, value] of localBuckets) {
      if (value.resetAt <= now) localBuckets.delete(key);
    }
  }

  return {
    allowed: state.count <= limit,
    limit,
    remaining: Math.max(0, limit - state.count),
    resetAt: state.resetAt,
    backend: "local",
  };
}

export async function checkRateLimit(options: {
  scope: string;
  identifier: string;
  limit: number;
  windowSeconds: number;
}): Promise<RateLimitResult> {
  const { scope, identifier, limit, windowSeconds } = options;
  const bucket = rateLimitBucket(scope, identifier);
  const supabase = serviceClient();

  if (supabase) {
    try {
      const { data, error } = await supabase.rpc("jarvis_rate_limit_hit", {
        p_bucket: bucket,
        p_limit: limit,
        p_window_seconds: windowSeconds,
      });
      if (!error) {
        const row = Array.isArray(data) ? data[0] : data;
        if (row && typeof row === "object") {
          const resetAt = Date.parse(String((row as { reset_at?: unknown }).reset_at ?? ""));
          return {
            allowed: Boolean((row as { allowed?: unknown }).allowed),
            limit,
            remaining: Number((row as { remaining?: unknown }).remaining ?? 0),
            resetAt: Number.isFinite(resetAt) ? resetAt : Date.now() + windowSeconds * 1000,
            backend: "shared",
          };
        }
      }
    } catch {
      // Fall through to the per-instance limiter.
    }
  }

  return checkLocalRateLimit(bucket, limit, windowSeconds);
}

export function rateLimitHeaders(result: RateLimitResult) {
  const headers: Record<string, string> = {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
  };
  if (!result.allowed) {
    headers["Retry-After"] = String(Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000)));
  }
  return headers;
}
