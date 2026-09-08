// app/api/stock-detail/route.ts (v4 — all res.json() typed as any to fix build)
import { NextRequest, NextResponse } from "next/server";
import { IDX_UNIVERSE } from "@/lib/idx-universe";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const TRANSIENT_STATUS = new Set([500, 502, 503, 504]);
const DETAIL_TTL_MS = 6 * 60 * 60 * 1000;
const FALLBACK_TTL_MS = 60 * 1000;
const STALE_TTL_SECONDS = 7 * 24 * 60 * 60;
const YAHOO_COOLDOWN_MS = 2 * 60 * 1000;
const detailCache = new Map<string, { expiresAt: number; data: Record<string, any> }>();
let yahooCooldownUntil = 0;

async function fetchWithRetry(url: string, options: any, attempts = 3) {
  let lastResponse: Response | null = null;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, options);
      if (response.status === 429) {
        yahooCooldownUntil = Date.now() + YAHOO_COOLDOWN_MS;
        return response;
      }
      if (!TRANSIENT_STATUS.has(response.status) || attempt === attempts - 1) {
        return response;
      }
      lastResponse = response;
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 180 * (attempt + 1)));
  }

  if (lastResponse) return lastResponse;
  throw lastError ?? new Error("Yahoo request failed");
}

let cachedCrumb: string | null = null;
let cachedCookie: string | null = null;
let cacheExpiresAt = 0;

async function getCrumbAndCookie(forceRefresh = false): Promise<{ crumb: string; cookie: string } | null> {
  if (Date.now() < yahooCooldownUntil) return null;
  if (forceRefresh) {
    cachedCrumb = null;
    cachedCookie = null;
    cacheExpiresAt = 0;
  }
  const now = Date.now();
  if (cachedCrumb && cachedCookie && now < cacheExpiresAt) {
    return { crumb: cachedCrumb, cookie: cachedCookie };
  }

  try {
    const cookieRes = await fetch("https://fc.yahoo.com", {
      headers: { "User-Agent": UA },
      redirect: "manual",
    });
    const setCookie = cookieRes.headers.get("set-cookie");
    if (!setCookie) return null;
    const cookie = setCookie.split(";")[0];

    const crumbRes = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
      headers: { "User-Agent": UA, Cookie: cookie },
    });
    const crumb = await crumbRes.text();
    if (!crumb || crumb.includes("<html")) return null;

    cachedCrumb = crumb;
    cachedCookie = cookie;
    cacheExpiresAt = now + 30 * 60 * 1000;

    return { crumb, cookie };
  } catch {
    return null;
  }
}

async function getBasicQuote(ticker: string) {
  try {
    const res = await fetchWithRetry(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=5d&interval=1d`,
      { headers: { "User-Agent": UA }, next: { revalidate: 300 } }
    );
    const data: any = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return null;

    const closes: number[] = (result.indicators?.quote?.[0]?.close ?? []).filter(
      (c: number | null) => c !== null
    );
    const volumes: number[] = (result.indicators?.quote?.[0]?.volume ?? []).filter(
      (v: number | null) => v !== null
    );
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



function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function yearlyRows(block: any): any[] {
  const yearly = block?.yearly;
  if (!yearly || typeof yearly !== "object") return [];
  return Object.values(yearly)
    .filter((row: any) => row && typeof row === "object")
    .sort((a: any, b: any) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
}

function deriveValuations(detail: Record<string, any>) {
  const derivedFields: string[] = Array.isArray(detail.derivedFields) ? detail.derivedFields : [];
  const price = finiteNumber(detail.regularMarketPrice);
  const shares = finiteNumber(detail.sharesOutstanding);
  const history = Array.isArray(detail.financialHistory) ? detail.financialHistory : [];
  const latest = history[0] ?? null;
  const netIncome = finiteNumber(latest?.netIncome);
  const totalEquity = finiteNumber(latest?.totalEquity ?? latest?.totalStockholderEquity);

  if (!finiteNumber(detail.marketCap) && price && shares && shares > 0) {
    detail.marketCap = price * shares;
    derivedFields.push("marketCap");
  }
  if (!finiteNumber(detail.eps) && netIncome !== null && shares && shares > 0) {
    detail.eps = netIncome / shares;
    derivedFields.push("eps");
  }
  if (!finiteNumber(detail.bookValue) && totalEquity !== null && shares && shares > 0) {
    detail.bookValue = totalEquity / shares;
    derivedFields.push("bookValue");
  }

  const eps = finiteNumber(detail.eps);
  const bookValue = finiteNumber(detail.bookValue);
  if (!finiteNumber(detail.trailingPE) && price && eps && eps > 0) {
    const value = price / eps;
    if (value > 0 && value <= 300) {
      detail.trailingPE = value;
      derivedFields.push("trailingPE");
    }
  }
  if (!finiteNumber(detail.priceToBook) && price && bookValue && bookValue > 0) {
    const value = price / bookValue;
    if (value > 0 && value <= 100) {
      detail.priceToBook = value;
      derivedFields.push("priceToBook");
    }
  }

  detail.derivedFields = [...new Set(derivedFields)];
  return detail;
}

async function getEodhdDetail(ticker: string, basic: Record<string, any> | null) {
  const token = process.env.EODHD_API_TOKEN;
  if (!token) return null;

  try {
    const response = await fetch(
      `https://eodhd.com/api/v1.1/fundamentals/${encodeURIComponent(ticker)}?api_token=${encodeURIComponent(token)}&fmt=json`,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(12000),
        next: { revalidate: 21600 },
      }
    );
    if (!response.ok) return null;
    const raw: any = await response.json();
    if (!raw?.General || raw?.error || raw?.code === 404) return null;

    const incomeRows = yearlyRows(raw?.Financials?.Income_Statement);
    const balanceRows = yearlyRows(raw?.Financials?.Balance_Sheet);
    const cashRows = yearlyRows(raw?.Financials?.Cash_Flow);
    const financialHistory = incomeRows.slice(0, 4).map((income: any, index: number) => {
      const date = income?.date ?? null;
      const balance = balanceRows.find((row: any) => row?.date === date) ?? balanceRows[index] ?? {};
      const cash = cashRows.find((row: any) => row?.date === date) ?? cashRows[index] ?? {};
      return {
        fiscalYear: date,
        totalRevenue: finiteNumber(income?.totalRevenue),
        grossProfit: finiteNumber(income?.grossProfit),
        operatingIncome: finiteNumber(income?.operatingIncome),
        netIncome: finiteNumber(income?.netIncome),
        totalAssets: finiteNumber(balance?.totalAssets),
        totalLiabilities: finiteNumber(balance?.totalLiab ?? balance?.totalLiabilities),
        totalEquity: finiteNumber(balance?.totalStockholderEquity ?? balance?.totalEquity),
        receivables: finiteNumber(balance?.netReceivables),
        inventory: finiteNumber(balance?.inventory),
        operatingCashflow: finiteNumber(cash?.totalCashFromOperatingActivities),
        capex: finiteNumber(cash?.capitalExpenditures),
      };
    });

    const highlights = raw?.Highlights ?? {};
    const valuation = raw?.Valuation ?? {};
    const technicals = raw?.Technicals ?? {};
    const shares = raw?.SharesStats ?? {};
    const universeStock = IDX_UNIVERSE.find((stock) => stock.ticker === ticker);
    const latest = financialHistory[0] ?? null;

    return deriveValuations({
      ticker,
      name: raw.General.Name ?? universeStock?.name ?? ticker,
      sector: raw.General.Sector ?? universeStock?.sector ?? null,
      industry: raw.General.Industry ?? null,
      employees: finiteNumber(raw.General.FullTimeEmployees),
      currency: raw.General.CurrencyCode ?? basic?.currency ?? "IDR",
      regularMarketPrice: finiteNumber(basic?.regularMarketPrice),
      regularMarketChangePercent: finiteNumber(basic?.regularMarketChangePercent),
      previousClose: finiteNumber(basic?.previousClose),
      volume: finiteNumber(basic?.volume),
      fiftyTwoWeekLow: finiteNumber(technicals["52WeekLow"] ?? basic?.fiftyTwoWeekLow),
      fiftyTwoWeekHigh: finiteNumber(technicals["52WeekHigh"] ?? basic?.fiftyTwoWeekHigh),
      marketCap: finiteNumber(highlights.MarketCapitalization),
      sharesOutstanding: finiteNumber(shares.SharesOutstanding),
      trailingPE: finiteNumber(highlights.PERatio),
      forwardPE: finiteNumber(valuation.ForwardPE),
      priceToBook: finiteNumber(valuation.PriceBookMRQ),
      pegRatio: finiteNumber(highlights.PEGRatio),
      enterpriseValue: finiteNumber(valuation.EnterpriseValue),
      profitMargin: finiteNumber(highlights.ProfitMargin),
      operatingMargin: finiteNumber(highlights.OperatingMarginTTM),
      returnOnAssets: finiteNumber(highlights.ReturnOnAssetsTTM),
      returnOnEquity: finiteNumber(highlights.ReturnOnEquityTTM),
      revenue: finiteNumber(highlights.RevenueTTM ?? latest?.totalRevenue),
      revenueGrowth: finiteNumber(highlights.QuarterlyRevenueGrowthYOY),
      grossProfit: finiteNumber(highlights.GrossProfitTTM ?? latest?.grossProfit),
      ebitda: finiteNumber(highlights.EBITDA),
      eps: finiteNumber(highlights.DilutedEpsTTM),
      bookValue: finiteNumber(highlights.BookValue),
      dividendYield: finiteNumber(highlights.DividendYield),
      beta: finiteNumber(technicals.Beta),
      targetMeanPrice: finiteNumber(highlights.WallStreetTargetPrice),
      latestFinancials: latest ? { ...latest, totalStockholderEquity: latest.totalEquity } : null,
      financialHistory,
      dataSource: "eodhd",
      sourceChain: ["EODHD", basic ? "Yahoo chart" : null].filter(Boolean),
      sourceAsOf: new Date().toISOString(),
    });
  } catch {
    return null;
  }
}

async function getAnnualFinancialHistory(ticker: string) {
  const metricFields: Record<string, string> = {
    annualTotalRevenue: "totalRevenue",
    annualGrossProfit: "grossProfit",
    annualOperatingIncome: "operatingIncome",
    annualNetIncome: "netIncome",
    annualTotalAssets: "totalAssets",
    annualTotalLiabilitiesNetMinorityInterest: "totalLiabilities",
    annualStockholdersEquity: "totalEquity",
    annualAccountsReceivable: "receivables",
    annualInventory: "inventory",
    annualOperatingCashFlow: "operatingCashflow",
    annualCapitalExpenditure: "capex",
  };
  const types = Object.keys(metricFields).join(",");
  const period2 = Math.floor(Date.now() / 1000);
  const period1 = period2 - 7 * 365 * 24 * 60 * 60;
  const url = `https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(ticker)}?symbol=${encodeURIComponent(ticker)}&type=${types}&period1=${period1}&period2=${period2}`;
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
      next: { revalidate: 3600 },
    });
    if (!response.ok) return [];
    const payload: any = await response.json();
    const series: any[] = payload?.timeseries?.result ?? [];
    const byYear = new Map<string, Record<string, any>>();
    for (const metric of series) {
      const type = metric?.meta?.type?.[0];
      const field = metricFields[type];
      if (!field) continue;
      for (const observation of metric?.[type] ?? []) {
        const fiscalYear = observation?.asOfDate;
        const raw = observation?.reportedValue?.raw;
        if (!fiscalYear || typeof raw !== "number" || !Number.isFinite(raw)) continue;
        const row = byYear.get(fiscalYear) ?? { fiscalYear };
        row[field] = raw;
        byYear.set(fiscalYear, row);
      }
    }
    return [...byYear.values()].sort((a, b) => String(b.fiscalYear).localeCompare(String(a.fiscalYear))).slice(0, 4);
  } catch {
    return [];
  }
}

function fallbackDetail(ticker: string) {
  const universeStock = IDX_UNIVERSE.find((stock) => stock.ticker === ticker);
  const coolingDown = Date.now() < yahooCooldownUntil;
  return {
    ticker,
    name: universeStock?.name ?? ticker.replace(".JK", ""),
    sector: universeStock?.sector ?? null,
    industry: null,
    currency: "IDR",
    regularMarketPrice: null,
    regularMarketChangePercent: null,
    dataSource: "universe-fallback",
    fundamentalsUnavailable: true,
    retryAfterSeconds: coolingDown
      ? Math.max(1, Math.ceil((yahooCooldownUntil - Date.now()) / 1000))
      : null,
    fundamentalsMessage: coolingDown
      ? "Yahoo Finance rate limit reached. Requests are paused briefly to protect recovery; IDX universe context remains available."
      : "Yahoo Finance is temporarily unavailable. Showing IDX universe context.",
    unavailable: [
      "regularMarketPrice", "marketCap", "trailingPE", "forwardPE", "priceToBook",
      "eps", "dividendYield", "revenue", "profitMargin", "returnOnEquity",
      "recommendationKey",
    ],
  };
}

function cacheDetail(ticker: string, data: Record<string, any>, ttl = DETAIL_TTL_MS) {
  detailCache.set(ticker, { data, expiresAt: Date.now() + ttl });
  return NextResponse.json(data, {
    headers: {
      "Cache-Control": `public, max-age=0, s-maxage=${Math.floor(ttl / 1000)}, stale-while-revalidate=${STALE_TTL_SECONDS}`,
      "Vercel-CDN-Cache-Control": `s-maxage=${Math.floor(ttl / 1000)}, stale-while-revalidate=${STALE_TTL_SECONDS}`,
    },
  });
}

export async function GET(req: NextRequest) {
  const rawTicker = req.nextUrl.searchParams.get("ticker");
  if (!rawTicker) {
    return NextResponse.json({ error: "ticker is required" }, { status: 400 });
  }
  const ticker = rawTicker.includes(".")
    ? rawTicker.toUpperCase()
    : `${rawTicker.toUpperCase()}.JK`;

  const cached = detailCache.get(ticker);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json({ ...cached.data, cacheHit: true });
  }
  // The chart endpoint is materially more reliable for newer IDX listings.
  // Capture a basic quote before quoteSummary can open the fundamentals circuit.
  const [basic, annualHistory] = await Promise.all([getBasicQuote(ticker), getAnnualFinancialHistory(ticker)]);
  const eodhd = await getEodhdDetail(ticker, basic);
  if (eodhd) {
    if (!eodhd.financialHistory?.length && annualHistory.length) {
      eodhd.financialHistory = annualHistory;
      deriveValuations(eodhd);
    }
    const unavailable = Object.entries(eodhd)
      .filter(([key, value]) => value === null && !["ticker", "name", "latestFinancials"].includes(key))
      .map(([key]) => key);
    return cacheDetail(ticker, { ...eodhd, unavailable });
  }

  if (Date.now() < yahooCooldownUntil && !basic) {
    return cacheDetail(ticker, fallbackDetail(ticker), FALLBACK_TTL_MS);
  }

  let auth = await getCrumbAndCookie();

  if (auth) {
    try {
      const modules = [
        "price", "summaryDetail", "defaultKeyStatistics", "financialData",
        "incomeStatementHistory", "balanceSheetHistory", "cashflowStatementHistory",
        "recommendationTrend", "earnings", "assetProfile",
      ].join(",");

      const quoteUrl = (credentials: { crumb: string; cookie: string }) =>
        `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=${modules}&crumb=${encodeURIComponent(credentials.crumb)}`;
      const quoteOptions = (credentials: { crumb: string; cookie: string }) => ({
        headers: { "User-Agent": UA, Cookie: credentials.cookie, Accept: "application/json" },
        next: { revalidate: 300 },
      });

      let res = await fetchWithRetry(quoteUrl(auth), quoteOptions(auth));
      if (res.status === 401 || res.status === 403) {
        auth = await getCrumbAndCookie(true);
        if (auth) {
          res = await fetchWithRetry(quoteUrl(auth), quoteOptions(auth));
        }
      }

      if (res.ok) {
        const raw: any = await res.json();
        const result = raw?.quoteSummary?.result?.[0];

        if (result) {
          const price = result.price;
          const summary = result.summaryDetail;
          const stats = result.defaultKeyStatistics;
          const fin = result.financialData;
          const profile = result.assetProfile;
          const rec = result.recommendationTrend?.trend?.[0];
          const earnings = result.earnings;
          const incomeHistory = result.incomeStatementHistory?.incomeStatementHistory ?? [];
          const balanceHistory = result.balanceSheetHistory?.balanceSheetStatements ?? [];
          const cashflowHistory = result.cashflowStatementHistory?.cashflowStatements ?? [];
          const income = incomeHistory[0];
          const balance = balanceHistory[0];
          const cashflow = cashflowHistory[0];

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
            financialHistory: annualHistory.length ? annualHistory : incomeHistory.slice(0, 4).map((statement: any, index: number) => {
              const statementDate = statement.endDate?.fmt ?? null;
              const matchedBalance = balanceHistory.find((item: any) => item.endDate?.fmt === statementDate) ?? balanceHistory[index];
              const matchedCashflow = cashflowHistory.find((item: any) => item.endDate?.fmt === statementDate) ?? cashflowHistory[index];
              return {
                fiscalYear: statementDate,
                totalRevenue: g(statement, "totalRevenue"),
                grossProfit: g(statement, "grossProfit"),
                operatingIncome: g(statement, "operatingIncome"),
                netIncome: g(statement, "netIncome"),
                totalAssets: g(matchedBalance, "totalAssets"),
                totalLiabilities: g(matchedBalance, "totalLiab"),
                totalEquity: g(matchedBalance, "totalStockholderEquity"),
                receivables: g(matchedBalance, "netReceivables"),
                inventory: g(matchedBalance, "inventory"),
                operatingCashflow: g(matchedCashflow, "totalCashFromOperatingActivities"),
                capex: g(matchedCashflow, "capitalExpenditures"),
              };
            }),
            nextEarningsDate: earnings?.earningsChart?.earningsDate?.[0]?.fmt ?? null,
            dataSource: "full",
          };

          // Yahoo occasionally mixes currencies/units for IDX valuation multiples.
          // Reject impossible values rather than presenting them as investable signals.
          if (typeof detail.trailingPE !== "number" || detail.trailingPE <= 0 || detail.trailingPE > 300) {
            detail.trailingPE = null;
          }
          if (typeof detail.forwardPE !== "number" || detail.forwardPE <= 0 || detail.forwardPE > 300) {
            detail.forwardPE = null;
          }
          if (typeof detail.priceToBook !== "number" || detail.priceToBook <= 0 || detail.priceToBook > 100) {
            detail.priceToBook = null;
          }

          deriveValuations(detail);

          const unavailable = Object.entries(detail)
            .filter(([k, v]) => v === null && !["ticker", "name", "latestFinancials"].includes(k))
            .map(([k]) => k);

          return cacheDetail(ticker, { ...detail, unavailable });
        }
      }
    } catch {
      // fall through to basic fallback below
    }
  }

  if (basic || annualHistory.length) {
    return cacheDetail(ticker, {
      ticker,
      name: IDX_UNIVERSE.find((stock) => stock.ticker === ticker)?.name ?? ticker,
      sector: IDX_UNIVERSE.find((stock) => stock.ticker === ticker)?.sector ?? null,
      dataSource: "basic",
      fundamentalsUnavailable: true,
      fundamentalsMessage: "Full fundamentals are unavailable for this issuer. Showing verified market-price data instead.",
      ...(basic ?? {}),
      financialHistory: annualHistory,
      unavailable: [
        "marketCap", "trailingPE", "forwardPE", "priceToBook", "eps", "dividendYield",
        "revenue", "profitMargin", "returnOnEquity", "recommendationKey",
      ],
    });
  }

  return cacheDetail(ticker, fallbackDetail(ticker), FALLBACK_TTL_MS);
}
