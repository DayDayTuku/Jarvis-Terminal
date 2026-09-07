// app/api/stock-detail/route.ts (v3 — with crumb/cookie auth + fallback)
import { NextRequest, NextResponse } from "next/server";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Simple in-memory cache for crumb/cookie (resets on cold start, that's fine — cheap to refetch)
let cachedCrumb: string | null = null;
let cachedCookie: string | null = null;
let cacheExpiresAt = 0;

async function getCrumbAndCookie(): Promise<{ crumb: string; cookie: string } | null> {
  const now = Date.now();
  if (cachedCrumb && cachedCookie && now < cacheExpiresAt) {
    return { crumb: cachedCrumb, cookie: cachedCookie };
  }

  try {
    // Step 1: get session cookie
    const cookieRes = await fetch("https://fc.yahoo.com", {
      headers: { "User-Agent": UA },
      redirect: "manual",
    });
    const setCookie = cookieRes.headers.get("set-cookie");
    if (!setCookie) return null;
    const cookie = setCookie.split(";")[0];

    // Step 2: get crumb using that cookie
    const crumbRes = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
      headers: { "User-Agent": UA, Cookie: cookie },
    });
    const crumb = await crumbRes.text();
    if (!crumb || crumb.includes("<html")) return null;

    cachedCrumb = crumb;
    cachedCookie = cookie;
    cacheExpiresAt = now + 30 * 60 * 1000; // 30 min cache

    return { crumb, cookie };
  } catch {
    return null;
  }
}

// Fallback: basic price/volume from the endpoint already proven stable elsewhere in this project
async function getBasicQuote(ticker: string) {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=5d&interval=1d`,
      { headers: { "User-Agent": UA }, next: { revalidate: 300 } }
    );
    const data: any = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return null;

    const closes: number[] = result.indicators?.quote?.[0]?.close?.filter((c: number | null) => c !== null);
    const volumes: number[] = result.indicators?.quote?.[0]?.volume?.filter((v: number | null) => v !== null);
    const meta = result.meta;

    if (!closes || closes.length < 1) return null;

    const last = closes[closes.length - 1];
    const prev = closes.length > 1 ? closes[closes.length - 2] : last;

    return {
      regularMarketPrice: last,
      regularMarketChangePercent: prev ? ((last - prev) / prev) * 100 : null,
      previousClose: prev,
      volume: volumes?.[volumes.length - 1] ?? null,
      fiftyTwoWeekHigh: meta?.fiftyTwoWeekHigh ?? null,
      fiftyTwoWeekLow: meta?.fiftyTwoWeekLow ?? null,
      currency: meta?.currency ?? null,
    };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const ticker = req.nextUrl.searchParams.get("ticker");
  if (!ticker) {
    return NextResponse.json({ error: "ticker is required" }, { status: 400 });
  }

  const auth = await getCrumbAndCookie();

  if (auth) {
    try {
      const modules = [
        "price", "summaryDetail", "defaultKeyStatistics", "financialData",
        "incomeStatementHistory", "balanceSheetHistory", "cashflowStatementHistory",
        "recommendationTrend", "earnings", "assetProfile",
      ].join(",");

      const res = await fetch(
        `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=${modules}&crumb=${encodeURIComponent(auth.crumb)}`,
        {
          headers: { "User-Agent": UA, Cookie: auth.cookie, Accept: "application/json" },
          next: { revalidate: 300 },
        }
      );

      if (res.ok) {
        const raw = await res.json();
        const result = raw?.quoteSummary?.result?.[0];

        if (result) {
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

          const detail: Record<string, any> = {
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
            dataSource: "full",
          };

          const unavailable = Object.entries(detail)
            .filter(([k, v]) => v === null && !["ticker", "name", "latestFinancials"].includes(k))
            .map(([k]) => k);

          return NextResponse.json({ ...detail, unavailable });
        }
      }
    } catch {
      // fall through to basic fallback below
    }
  }

  // Fallback: crumb/cookie auth failed OR quoteSummary request failed even with auth
  const basic = await getBasicQuote(ticker);
  if (basic) {
    return NextResponse.json({
      ticker,
      name: ticker,
      dataSource: "basic",
      fundamentalsUnavailable: true,
      fundamentalsMessage: "Fundamental data unavailable from free source. Showing basic price data only.",
      ...basic,
      unavailable: [
        "marketCap", "trailingPE", "forwardPE", "priceToBook", "eps", "dividendYield",
        "revenue", "profitMargin", "returnOnEquity", "recommendationKey",
      ],
    });
  }

  return NextResponse.json(
    { error: "Failed to load stock data from Yahoo Finance" },
    { status: 502 }
  );
}
