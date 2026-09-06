import { NextRequest, NextResponse } from "next/server";

type YahooQuote = {
  symbol?: string;
  shortname?: string;
  longname?: string;
  quoteType?: string;
};

type YahooSearchResponse = {
  quotes?: YahooQuote[];
};

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q")?.trim() || "";

  // Kalau search kosong, jangan request ke Yahoo
  if (!query) {
    return NextResponse.json({
      results: [],
    });
  }

  try {
    // Yahoo Finance Search API
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

      // Cache hasil search selama 5 menit
      next: {
        revalidate: 300,
      },
    });

    // Yahoo gagal
    if (!res.ok) {
      return NextResponse.json(
        {
          results: [],
        },
        {
          status: 502,
        }
      );
    }

    // PENTING:
    // Kita kasih tahu TypeScript bentuk response dari Yahoo
    const data = (await res.json()) as YahooSearchResponse;

    const quotes = Array.isArray(data.quotes)
      ? data.quotes
      : [];

    // Ambil hanya saham Indonesia (.JK)
    const results = quotes
      .filter(
        (q) =>
          typeof q.symbol === "string" &&
          q.symbol.toUpperCase().endsWith(".JK") &&
          (q.quoteType === undefined ||
            q.quoteType === "EQUITY")
      )

      // Maksimal 15 hasil
      .slice(0, 15)

      // Format supaya cocok dengan StockSearch.tsx
      .map((q) => ({
        ticker: q.symbol!,
        name:
          q.longname ||
          q.shortname ||
          q.symbol!,
        sector: "IDX",
      }));

    return NextResponse.json({
      results,
    });
  } catch (error) {
    console.error("Stock search error:", error);

    return NextResponse.json(
      {
        results: [],
      },
      {
        status: 502,
      }
    );
  }
}
