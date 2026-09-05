import { NextRequest, NextResponse } from "next/server";

type YahooQuote = {
  symbol?: string;
  shortname?: string;
  longname?: string;
  quoteType?: string;
};

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q")?.trim() || "";

  if (!query) {
    return NextResponse.json({ results: [] });
  }

  try {
    const url = new URL(
      "https://query1.finance.yahoo.com/v1/finance/search"
    );

    url.searchParams.set("q", query);
    url.searchParams.set("quotesCount", "20");
    url.searchParams.set("newsCount", "0");
    url.searchParams.set("listsCount", "0");
    url.searchParams.set("enableFuzzyQuery", "true");

    const res = await fetch(url.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "application/json",
      },
      next: { revalidate: 300 },
    });

    if (!res.ok) {
      return NextResponse.json({ results: [] }, { status: 502 });
    }

    const data = await res.json();

    const quotes: YahooQuote[] = Array.isArray(data?.quotes)
      ? data.quotes
      : [];

    const results = quotes
      .filter(
        (q) =>
          typeof q.symbol === "string" &&
          q.symbol.toUpperCase().endsWith(".JK") &&
          (q.quoteType === undefined || q.quoteType === "EQUITY")
      )
      .slice(0, 15)
      .map((q) => ({
        ticker: q.symbol!,
        name: q.longname || q.shortname || q.symbol!,
        sector: "IDX",
      }));

    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ results: [] }, { status: 502 });
  }
}
