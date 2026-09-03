import { NextResponse } from 'next/server';

type TeEvent = { Date?: string; Country?: string; Event?: string; Forecast?: string | number; Previous?: string | number; Importance?: number };
export async function GET() {
  const key = process.env.TRADING_ECONOMICS_API_KEY;
  if (!key) return NextResponse.json({ status: 'not_configured', source: 'TradingEconomics', error: 'TRADING_ECONOMICS_API_KEY is missing' }, { status: 503 });
  try {
    const start = new Date().toISOString().slice(0,10); const finish = new Date(Date.now() + 7 * 86400000).toISOString().slice(0,10);
    const url = `https://api.tradingeconomics.com/calendar/country/indonesia,china,united%20states/${start}/${finish}?c=${encodeURIComponent(key)}&importance=2,3`;
    const response = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'Jarvis Research Terminal' }, cache: 'no-store' });
    if (!response.ok) throw new Error(`TradingEconomics returned ${response.status}`);
    const payload = await response.json() as TeEvent[];
    const events = payload.slice(0, 12).map((event) => ({ date: event.Date ?? '', country: event.Country ?? '', event: event.Event ?? 'Economic release', forecast: String(event.Forecast ?? '—'), prior: String(event.Previous ?? '—'), importance: event.Importance ?? 1 }));
    return NextResponse.json({ status: 'live', source: 'TradingEconomics', freshness: new Date().toISOString(), events }, { headers: { 'cache-control': 'public, max-age=900' } });
  } catch (error) {
    return NextResponse.json({ status: 'stale', source: 'TradingEconomics', error: error instanceof Error ? error.message : 'Calendar unavailable' }, { status: 503 });
  }
}
