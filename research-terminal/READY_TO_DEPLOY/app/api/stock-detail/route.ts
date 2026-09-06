// app/api/stock-detail/route.ts (v2 — Rich Yahoo Finance Fundamentals for Terminal)
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  let ticker = req.nextUrl.searchParams.get("ticker")?.trim();
  if (!ticker) {
    return NextResponse.json({ error: "ticker is required" }, { status: 400 });
  }

  // Auto-append .JK if ticker is IDX (4 letters without dot)
  if (!ticker.includes(".")) {
    ticker = `${ticker.toUpperCase()}.JK`;
  } else {
    ticker = ticker.toUpperCase();
  }

  try {
    const modules = [
      "price",
      "summaryDetail",
      "defaultKeyStatistics",
      "financialData",
      "incomeStatementHistory",
      "balanceSheetHistory",
      "cashflowStatementHistory",
      "recommendationTrend",
      "earnings",
      "assetProfile",
    ].join(",");

    const res = await fetch(
      `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${modules}`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "application/json",
        },
        next: { revalidate: 300 },
      }
    );

    if (!res.ok) {
      return NextResponse.json(
        { error: `Yahoo Finance returned status ${res.status}` },
        { status: res.status }
      );
    }

    const raw = await res.json();
    const result = raw?.quoteSummary?.result?.[0];

    if (!result) {
      return NextResponse.json(
        { error: "No fundamental data found for this ticker" },
        { status: 404 }
      );
    }

    const price = result.price;
    const summary = result.summaryDetail;
    const stats = result.defaultKeyStatistics;
    const fin = result.financialData;
    const profile = result.assetProfile;
    const rec = result.recommendationTrend?.trend?.[0];
    const earnings = result.earnings;

    const income = result.incomeStatementHistory?.incomeStatementHistory?.[0];
    const balance = result.balanceSheetHistory?.balanceSheetStatements?.[0];
    const cashflow = result.cashflowStatementHistory?.cashflowStatements?.[0];

    const g = (obj: any, path: string) =>
      path.split(".").reduce((o, k) => (o ? o[k]?.raw ?? o[k] : null), obj) ?? null;

    const detail = {
      ticker,
      name: price?.longName || price?.shortName || ticker,
      sector: profile?.sector ?? null,
      industry: profile?.industry ?? null,
      employees: profile?.fullTimeEmployees ?? null,
      currency: price?.currency ?? null,

      // Price block
      regularMarketPrice: g(price, "regularMarketPrice"),
      regularMarketChangePercent: g(price, "regularMarketChangePercent"),
      previousClose: g(price, "regularMarketPreviousClose"),
      dayLow: g(price, "regularMarketDayLow"),
      dayHigh: g(price, "regularMarketDayHigh"),
      volume: g(price, "regularMarketVolume"),
      avgVolume: g(summary, "averageVolume"),
      marketCap: g(price, "marketCap"),
      fiftyTwoWeekLow: g(summary, "fiftyTwoWeekLow"),
      fiftyTwoWeekHigh: g(summary, "fiftyTwoWeekHigh"),

      // Valuation
      trailingPE: g(summary, "trailingPE"),
      forwardPE: g(summary, "forwardPE"),
      priceToBook: g(stats, "priceToBook"),
      pegRatio: g(stats, "pegRatio"),
      enterpriseValue: g(stats, "enterpriseValue"),

      // Profitability & health
      profitMargin: g(fin, "profitMargins"),
      operatingMargin: g(fin, "operatingMargins"),
      returnOnAssets: g(fin, "returnOnAssets"),
      returnOnEquity: g(fin, "returnOnEquity"),
      revenue: g(fin, "totalRevenue"),
      revenueGrowth: g(fin, "revenueGrowth"),
      grossProfit: g(fin, "grossProfits"),
      ebitda: g(fin, "ebitda"),
      totalDebt: g(fin, "totalDebt"),
      totalCash: g(fin, "totalCash"),
      currentRatio: g(fin, "currentRatio"),
      quickRatio: g(fin, "quickRatio"),
      debtToEquity: g(fin, "debtToEquity"),
      freeCashflow: g(fin, "freeCashflow"),
      operatingCashflow: g(fin, "operatingCashflow"),

      // Per-share
      eps: g(stats, "trailingEps"),
      forwardEps: g(stats, "forwardEps"),
      bookValue: g(stats, "bookValue"),
      dividendYield: g(summary, "dividendYield"),
      dividendRate: g(summary, "dividendRate"),
      payoutRatio: g(summary, "payoutRatio"),
      beta: g(stats, "beta"),

      // Analyst
      recommendationKey: g(fin, "recommendationKey"),
      numberOfAnalystOpinions: g(fin, "numberOfAnalystOpinions"),
      targetMeanPrice: g(fin, "targetMeanPrice"),
      targetLowPrice: g(fin, "targetLowPrice"),
      targetHighPrice: g(fin, "targetHighPrice"),
      strongBuy: rec?.strongBuy ?? null,
      buy: rec?.buy ?? null,
      hold: rec?.hold ?? null,
      sell: rec?.sell ?? null,
      strongSell: rec?.strongSell ?? null,

      // Earnings & statements
      nextEarningsDate: earnings?.earningsChart?.nextEarningsDate ?? null,
      latestFinancials: income
        ? {
            fiscalYear: income?.endDate?.fmt?.slice(0, 4) ?? null,
            totalRevenue: g(income, "totalRevenue"),
            netIncome: g(income, "netIncome"),
            operatingIncome: g(income, "operatingIncome"),
            totalAssets: g(balance, "totalAssets"),
            totalLiabilities: g(balance, "totalLiab"),
            totalStockholderEquity: g(balance, "totalStockholderEquity"),
            capex: g(cashflow, "capitalExpenditures"),
          }
        : null,

      unavailable: [] as string[],
    };

    // Track unavailable fields
    const checkedFields: [string, any][] = [
      ["marketCap", detail.marketCap],
      ["trailingPE", detail.trailingPE],
      ["forwardPE", detail.forwardPE],
      ["priceToBook", detail.priceToBook],
      ["eps", detail.eps],
      ["revenue", detail.revenue],
      ["totalDebt", detail.totalDebt],
      ["freeCashflow", detail.freeCashflow],
      ["recommendationKey", detail.recommendationKey],
      ["targetMeanPrice", detail.targetMeanPrice],
    ];

    detail.unavailable = checkedFields
      .filter(([, v]) => v === null || v === undefined)
      .map(([k]) => k);

    return NextResponse.json(detail);
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Internal server error fetching stock detail" },
      { status: 500 }
    );
  }
}
