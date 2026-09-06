import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  let ticker = req.nextUrl.searchParams.get("ticker");
  if (!ticker) {
    return NextResponse.json({ error: "ticker is required" }, { status: 400 });
  }

  ticker = ticker.trim().toUpperCase();
  if (!ticker.includes(".") && !ticker.startsWith("^")) {
    ticker = `${ticker}.JK`;
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

    const raw: any = await res.json();
    const result = raw?.quoteSummary?.result?.[0];

    if (!result) {
      return NextResponse.json({ error: "No data found for this ticker" }, { status: 404 });
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
      trailingPE: g(summary, "trailingPE"),
      forwardPE: g(summary, "forwardPE"),
      priceToBook: g(stats, "priceToBook"),
      pegRatio: g(stats, "pegRatio"),
      enterpriseValue: g(stats, "enterpriseValue"),
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
      eps: g(stats, "trailingEps"),
      forwardEps: g(stats, "forwardEps"),
      bookValue: g(stats, "bookValue"),
      dividendYield: g(summary, "dividendYield"),
      dividendRate: g(summary, "dividendRate"),
      payoutRatio: g(summary, "payoutRatio"),
      beta: g(stats, "beta"),
      targetMeanPrice: g(fin, "targetMeanPrice"),
      targetHighPrice: g(fin, "targetHighPrice"),
      targetLowPrice: g(fin, "targetLowPrice"),
      recommendationKey: fin?.recommendationKey ?? null,
      numberOfAnalystOpinions: g(fin, "numberOfAnalystOpinions"),
      strongBuy: rec?.strongBuy ?? null,
      buy: rec?.buy ?? null,
      hold: rec?.hold ?? null,
      sell: rec?.sell ?? null,
      strongSell: rec?.strongSell ?? null,
      latestFinancials: income ? {
        fiscalYear: income.endDate?.fmt ?? null,
        totalRevenue: g(income, "totalRevenue"),
        grossProfit: g(income, "grossProfit"),
        operatingIncome: g(income, "operatingIncome"),
        netIncome: g(income, "netIncome"),
        totalAssets: g(balance, "totalAssets"),
        totalLiabilities: g(balance, "totalLiab"),
        totalStockholderEquity: g(balance, "totalStockholderEquity"),
        operatingCashflowStmt: g(cashflow, "totalCashFromOperatingActivities"),
        capex: g(cashflow, "capitalExpenditures"),
      } : null,
      nextEarningsDate: earnings?.earningsChart?.earningsDate?.[0]?.fmt ?? null,
    };

    const unavailable = Object.entries(detail)
      .filter(([k, v]) => v === null && !["ticker", "name", "latestFinancials"].includes(k))
      .map(([k]) => k);

    return NextResponse.json({ ...detail, unavailable });
  } catch (e) {
    return NextResponse.json({ error: "Failed to fetch stock detail" }, { status: 500 });
  }
}
