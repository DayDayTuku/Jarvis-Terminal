import { NextRequest, NextResponse } from "next/server";
import { searchIDXStocks } from "@/lib/idx-universe";

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q") || "";
  const results = searchIDXStocks(query);
  return NextResponse.json({ results });
}
