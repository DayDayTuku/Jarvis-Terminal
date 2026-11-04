import { NextRequest, NextResponse } from "next/server";
import { buildLiveQuantamentalMap, jakartaDate } from "@/lib/quantamental-server";

/**
 * Post-close Quantamental snapshot.
 *
 * Scheduled in vercel.json for 10:30 UTC (17:30 WIB), Monday to Friday, after
 * the IDX close. This exists so history accumulates even on days nobody opens
 * the map, which is what makes percentile, revision direction and WHAT CHANGED
 * possible. It is not allowed to invent a snapshot when the scan fails.
 */

export const maxDuration = 30;

export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";

  try {
    if (dryRun) {
      const { map } = await buildLiveQuantamentalMap({ persist: false });
      return NextResponse.json({
        ok: true,
        dryRun: true,
        tradeDate: jakartaDate(),
        plotted: map.plotted,
        coverage: map.coverage,
        status: map.status,
      });
    }

    const { map, snapshotSaved, snapshotError } = await buildLiveQuantamentalMap({ persist: true });
    if (!snapshotSaved) {
      return NextResponse.json(
        {
          ok: false,
          error: "The map was built but the snapshot was not stored.",
          detail: snapshotError,
          tradeDate: jakartaDate(),
          plotted: map.plotted,
        },
        { status: 503 },
      );
    }

    return NextResponse.json({
      ok: true,
      tradeDate: jakartaDate(),
      asOf: map.asOf,
      status: map.status,
      plotted: map.plotted,
      noMomentum: map.noMomentum,
      noValuation: map.noValuation,
      coverage: map.coverage,
    });
  } catch (error) {
    console.error("Quantamental snapshot failed:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Snapshot failed." },
      { status: 503 },
    );
  }
}
