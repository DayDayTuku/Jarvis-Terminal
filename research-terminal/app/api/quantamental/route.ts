import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../utils/supabase/server";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import {
  buildLiveQuantamentalMap,
  jakartaDate,
  loadQuantamentalHistory,
  type QuantamentalHistory,
} from "@/lib/quantamental-server";
import type { QuantamentalMap } from "@/lib/quantamental";

/**
 * One batch request to the TradingView Indonesia scanner covers the whole map.
 * The route is authenticated and rate limited so it cannot be used as a free
 * scanner proxy.
 *
 * Freshness contract:
 * - `asOf` is when this response was built.
 * - `dataAsOf` is the newest fundamental disclosure date in the payload.
 * - `historyDates` lists stored snapshots so the UI can select a prior map.
 * - `?refresh=1` bypasses the in-memory cache.
 * - `?date=YYYY-MM-DD` returns that stored snapshot, never a recomputation.
 * - A failed refresh returns the last successful map with `status: "stale"`.
 */

export const maxDuration = 30;

const CACHE_TTL_MS = 15 * 60 * 1000;

let cache: { at: number; map: QuantamentalMap } | null = null;

function privateHeaders(maxAge: number) {
  return { "cache-control": `private, max-age=${maxAge}` };
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const limit = await checkRateLimit({
      scope: "quantamental",
      identifier: user.id,
      limit: 30,
      windowSeconds: 60,
    });
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Too many map requests. Try again shortly." },
        { status: 429, headers: rateLimitHeaders(limit) },
      );
    }

    const search = request.nextUrl.searchParams;
    const targetDate = search.get("date");
    const forceRefresh = search.get("refresh") === "1";

    if (targetDate) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
        return NextResponse.json({ error: "Date must be YYYY-MM-DD." }, { status: 400 });
      }
      const history = await loadQuantamentalHistory({ targetDate });
      if (!history.snapshot) {
        return NextResponse.json(
          {
            error: history.available
              ? `No stored Quantamental snapshot exists for ${targetDate}.`
              : "Snapshot storage is not configured, so historical maps are unavailable.",
            historyAvailable: history.available,
          },
          { status: 404, headers: privateHeaders(0) },
        );
      }
      return NextResponse.json(
        {
          ...history.snapshot,
          status: "stale" as const,
          selectedDate: targetDate,
          historyAvailable: true,
        },
        { headers: privateHeaders(60) },
      );
    }

    const now = Date.now();
    if (!forceRefresh && cache && now - cache.at < CACHE_TTL_MS) {
      return NextResponse.json(
        { ...cache.map, cached: true, snapshotSaved: null },
        { headers: privateHeaders(300) },
      );
    }

    let history: QuantamentalHistory | null = null;
    try {
      history = await loadQuantamentalHistory({ before: jakartaDate() });
      const { map, snapshotSaved, snapshotError } = await buildLiveQuantamentalMap({
        asOf: new Date().toISOString(),
        history,
      });

      cache = { at: now, map };
      return NextResponse.json(
        {
          ...map,
          cached: false,
          snapshotSaved,
          snapshotError,
          historyAvailable: history.available,
        },
        { headers: privateHeaders(300) },
      );
    } catch (error) {
      if (cache) {
        console.error("Quantamental refresh failed; serving stale map:", error);
        return NextResponse.json(
          {
            ...cache.map,
            status: "stale" as const,
            cached: true,
            refreshError: error instanceof Error ? error.message : "Refresh failed.",
            snapshotSaved: false,
            historyAvailable: history?.available ?? false,
          },
          { headers: privateHeaders(0) },
        );
      }
      console.error("Quantamental feed unavailable:", error);
      return NextResponse.json(
        {
          status: "unavailable",
          error: "The Indonesian scanner did not return valuation or fundamental data.",
        },
        { status: 503, headers: privateHeaders(0) },
      );
    }
  } catch (error) {
    console.error("Quantamental route failed:", error);
    return NextResponse.json(
      { status: "unavailable", error: "Unable to build the quantamental map." },
      { status: 500, headers: privateHeaders(0) },
    );
  }
}
