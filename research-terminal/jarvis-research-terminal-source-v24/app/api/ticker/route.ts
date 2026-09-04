import { NextRequest, NextResponse } from 'next/server';

type Range = '1mo' | '6mo' | '1y';
type Chart = {
  meta: {
    symbol: string; currency?: string; regularMarketPrice?: number; regularMarketVolume?: number;
    regularMarketChangePercent?: number; fiftyTwoWeekHigh?: number; fiftyTwoWeekLow?: number;
    longName?: string; shortName?: string;
  };
  timestamp?: number[];
  indicators: { quote: Array<{ close: Array<number | null>; open?: Array<number | null>; high?: Array<number | null>; low?: Array<number | null>; volume?: Array<number | null> }> };
  events?: { dividends?: Record<string, { amount: number; date: number }> };
};
type SearchNews = { uuid?: string; title?: string; publisher?: string; link?: string; providerPublishTime?: number; relatedTickers?: string[] };

const validRanges = new Set<Range>(['1mo', '6mo', '1y']);
function symbolFor(ticker: string) { return ticker === 'JKSE' ? '^JKSE' : `${ticker}.JK`; }
async function yahooChart(symbol: string, range: string, events = '') {
  const params = new URLSearchParams({ range, interval: '1d' }); if (events) params.set('events', events);
  const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${params}`, { headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0' }, cache: 'no-store' });
  if (!response.ok) throw new Error(`Yahoo chart returned ${response.status}`);
  const payload = await response.json() as { chart?: { result?: Chart[] | null } }; const chart = payload.chart?.result?.[0];
  if (!chart) throw new Error('No price history returned'); return chart;
}
function sessionChange(values: Array<number | null>, sessions: number) {
  const clean = values.filter((value): value is number => value !== null && Number.isFinite(value));
  const last = clean.at(-1), prior = clean.at(-(sessions + 1)); return last && prior ? (last / prior - 1) * 100 : null;
}

export async function GET(request: NextRequest) {
  const ticker = (request.nextUrl.searchParams.get('ticker') ?? '').trim().toUpperCase();
  const requestedRange = request.nextUrl.searchParams.get('range') as Range | null; const range = validRanges.has(requestedRange as Range) ? requestedRange as Range : '6mo';
  if (!/^[A-Z0-9]{2,10}$/.test(ticker)) return NextResponse.json({ status: 'error', error: 'Enter a valid IDX ticker.' }, { status: 400 });
  const symbol = symbolFor(ticker);
  try {
    const [chart, actionChart, searchResult] = await Promise.all([
      yahooChart(symbol, range), yahooChart(symbol, '10y', 'div'),
      fetch(`https://query2.finance.yahoo.com/v1/finance/search?${new URLSearchParams({ q: symbol, quotesCount: '1', newsCount: '8', enableFuzzyQuery: 'false' })}`, { headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0' }, cache: 'no-store' }).then(async (response) => response.ok ? response.json() as Promise<{ news?: SearchNews[] }> : { news: [] }).catch(() => ({ news: [] })),
    ]);
    const quote = chart.indicators.quote[0]; const timestamps = chart.timestamp ?? []; const closes = quote?.close ?? [];
    const points = timestamps.flatMap((stamp, index) => closes[index] === null ? [] : [{ date: new Date(stamp * 1000).toISOString().slice(0, 10), close: closes[index] as number }]);
    const dividends = Object.values(actionChart.events?.dividends ?? {}).sort((a, b) => b.date - a.date).slice(0, 12).map((item) => ({ date: new Date(item.date * 1000).toISOString().slice(0, 10), amount: item.amount }));
    const news = (searchResult.news ?? []).filter((item) => item.title && item.link && (item.relatedTickers ?? []).some((related) => related === symbol || related === ticker)).slice(0, 6).map((item) => ({ id: item.uuid ?? item.link!, title: item.title!, publisher: item.publisher ?? 'Yahoo Finance', link: item.link!, publishedAt: item.providerPublishTime ? new Date(item.providerPublishTime * 1000).toISOString() : null }));
    return NextResponse.json({
      status: 'live', source: 'Yahoo Finance upstream', ticker, symbol, range,
      info: { name: chart.meta.longName ?? chart.meta.shortName ?? ticker, currency: chart.meta.currency ?? 'IDR', price: chart.meta.regularMarketPrice ?? closes.filter((value): value is number => value !== null).at(-1) ?? null, volume: chart.meta.regularMarketVolume ?? quote?.volume?.filter((value): value is number => value !== null).at(-1) ?? null, marketCap: null, peRatio: null, high52: chart.meta.fiftyTwoWeekHigh ?? null, low52: chart.meta.fiftyTwoWeekLow ?? null, dailyChange: sessionChange(closes, 1), weeklyChange: sessionChange(closes, 5) },
      points, news, newsCoverage: 'Free Yahoo coverage can be limited for IDX tickers and may skew toward global sources.', dividends, earningsDate: null,
      unavailable: { marketCap: 'Not available from the free Yahoo endpoint', peRatio: 'Not available from the free Yahoo endpoint', earningsDate: 'Not available from the free Yahoo endpoint' },
    }, { headers: { 'cache-control': 'public, max-age=300' } });
  } catch (error) {
    return NextResponse.json({ status: 'stale', source: 'Yahoo Finance upstream', ticker, error: error instanceof Error ? error.message : 'Ticker detail unavailable' }, { status: 503 });
  }
}
