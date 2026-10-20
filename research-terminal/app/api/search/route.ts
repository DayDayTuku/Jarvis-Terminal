import { NextRequest, NextResponse } from "next/server";
import { searchIDXStocks } from "@/lib/idx-universe";
import { checkRateLimit, clientIdentifier, rateLimitHeaders } from "@/lib/rate-limit";

export async function GET(req: NextRequest) {
  const limit = await checkRateLimit({
    scope: "search",
    identifier: clientIdentifier(req),
    limit: 60,
    windowSeconds: 60,
  });
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many searches. Try again shortly." }, { status: 429, headers: rateLimitHeaders(limit) });
  }
  const query = req.nextUrl.searchParams.get("q") || "";
  const results = searchIDXStocks(query);
  return NextResponse.json({ results }, { headers: rateLimitHeaders(limit) });
}
