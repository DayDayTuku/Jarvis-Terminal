"use client";

/**
 * Fire-and-forget analytics. Never let telemetry failures interrupt research
 * workflows, and never send note bodies or portfolio values as metadata.
 */
export function trackEvent(
  eventName: string,
  metadata: Record<string, string | number | boolean> = {},
) {
  if (typeof window === "undefined") return;
  void fetch("/api/analytics/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    keepalive: true,
    body: JSON.stringify({
      eventName,
      pagePath: window.location.pathname,
      metadata,
    }),
  }).catch(() => undefined);
}
