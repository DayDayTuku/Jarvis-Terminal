/**
 * One upstream fetch wrapper for every external feed.
 *
 * The public data sources (Yahoo, FRED, CFTC, GDELT, GDACS, Resend…) all fail
 * in the same ways: a request that never resolves, a transient 5xx, or a
 * connection reset. Without a timeout a single hung socket can hold a route
 * until the platform kills it, which surfaces to the user as a blank panel.
 *
 * Defaults are deliberately conservative: a 12s ceiling and a single attempt.
 * Pass `attempts: 2` for idempotent reads that are worth one retry; unsafe
 * methods never retry, even if asked.
 */

export const DEFAULT_UPSTREAM_TIMEOUT_MS = 12_000;

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export type UpstreamOptions = RequestInit & {
  /** Per-attempt ceiling. Defaults to 12s. */
  timeoutMs?: number;
  /** Total attempts for GET/HEAD. Defaults to 1 (no retry). */
  attempts?: number;
  /** Base backoff between attempts; grows linearly. Defaults to 250ms. */
  retryDelayMs?: number;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchUpstream(input: string | URL, options: UpstreamOptions = {}) {
  const {
    timeoutMs = DEFAULT_UPSTREAM_TIMEOUT_MS,
    attempts = 1,
    retryDelayMs = 250,
    signal,
    ...init
  } = options;

  const method = (init.method ?? 'GET').toUpperCase();
  const retryable = attempts > 1 && (method === 'GET' || method === 'HEAD');
  const maxAttempts = retryable ? attempts : 1;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

    try {
      const response = await fetch(input, { ...init, signal: combined });
      if (retryable && attempt < maxAttempts && RETRYABLE_STATUS.has(response.status)) {
        if (response.body) await response.body.cancel().catch(() => undefined);
        await sleep(retryDelayMs * attempt);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) throw error;
      await sleep(retryDelayMs * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Upstream request failed');
}
