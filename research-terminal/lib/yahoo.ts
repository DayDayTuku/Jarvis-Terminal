/**
 * Shared Yahoo Finance request headers.
 *
 * Yahoo answers a bare `fetch` with HTTP 429 and serves the same request once a
 * browser-shaped `user-agent` is present. Every Yahoo call in the app sends
 * these so the daily bars behind the model, the lifecycle reviews and the track
 * record keep loading.
 */
export const YAHOO_HEADERS: Record<string, string> = {
  accept: "application/json",
  "user-agent": "Mozilla/5.0 Jarvis-Research-Terminal",
};
