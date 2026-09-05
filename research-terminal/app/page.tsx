// app/api/search/route.ts

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

  // Kalau search kosong
  if (!query) {
    return NextResponse.json({
      results: [],
    });
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

    const response = await fetch(url.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "application/json",
      },
      next: {
        revalidate: 300,
      },
    });

    if (!response.ok) {
      console.error(
        "Yahoo search failed:",
        response.status,
        response.statusText
      );

      return NextResponse.json(
        {
          results: [],
          error: "Yahoo Finance search failed",
        },
        {
          status: 502,
        }
      );
    }

    // IMPORTANT:
    // Explicitly cast hasil JSON supaya TypeScript tidak menganggap {}
    const data = (await response.json()) as YahooSearchResponse;

    const quotes = Array.isArray(data.quotes)
      ? data.quotes
      : [];

    const results = quotes
      .filter((quote) => {
        if (!quote.symbol) {
          return false;
        }

        const symbol = quote.symbol.toUpperCase();

        // Hanya saham Indonesia
        if (!symbol.endsWith(".JK")) {
          return false;
        }

        // Kalau Yahoo memberikan quoteType,
        // pastikan hanya EQUITY
        if (
          quote.quoteType !== undefined &&
          quote.quoteType !== "EQUITY"
        ) {
          return false;
        }

        return true;
      })
      .slice(0, 15)
      .map((quote) => {
        const symbol = quote.symbol!;

        return {
          ticker: symbol,
          name:
            quote.longname ||
            quote.shortname ||
            symbol.replace(".JK", ""),
          sector: "IDX",
        };
      });

    return NextResponse.json({
      results,
    });
  } catch (error) {
    console.error("Search API error:", error);

    return NextResponse.json(
      {
        results: [],
        error: "Search failed",
      },
      {
        status: 502,
      }
    );
  }
}
