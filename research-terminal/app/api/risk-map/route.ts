import { NextResponse } from "next/server";
import { loadRiskMap } from "@/lib/risk-map";

export async function GET() {
  const data = await loadRiskMap();
  return NextResponse.json(data, {
    headers: { "cache-control": "public, max-age=900, stale-while-revalidate=3600" },
  });
}
