import { NextResponse } from 'next/server';

type FredReleaseDate = { release_id?: number; release_name?: string; date?: string };
type BpsPublication = { pub_id?: string; title?: string; sch_date?: string | null; rl_date?: string | null };

const macroRelease = /(consumer price|producer price|personal income|gross domestic product|employment situation|retail sales|industrial production|job openings|international trade)/i;
const highImpact = /(consumer price|producer price|personal income|gross domestic product|employment situation)/i;

async function fetchBpsSchedule(key: string, start: string, finish: string) {
  const startDate = new Date(`${start}T00:00:00Z`); const finishDate = new Date(`${finish}T00:00:00Z`);
  const periods = new Set([`${startDate.getUTCFullYear()}-${startDate.getUTCMonth() + 1}`, `${finishDate.getUTCFullYear()}-${finishDate.getUTCMonth() + 1}`]);
  const responses = await Promise.all([...periods].map(async (period) => {
    const [year, month] = period.split('-');
    const params = new URLSearchParams({ model: 'publication', lang: 'eng', domain: '0000', year, month, key });
    const response = await fetch(`https://webapi.bps.go.id/v1/api/list?${params}`, { headers: { accept: 'application/json', 'user-agent': 'Jarvis Research Terminal' } });
    if (!response.ok) throw new Error(`BPS returned ${response.status}`);
    const payload = await response.json() as { status?: string; 'data-availability'?: string; data?: [unknown, BpsPublication[]] | null };
    if (payload.status !== 'OK' || payload['data-availability'] === 'list-not-available' || !Array.isArray(payload.data)) throw new Error('publication calendar list is not available from BPS WebAPI');
    return Array.isArray(payload.data?.[1]) ? payload.data![1] : [];
  }));
  const seen = new Set<string>();
  return responses.flat().flatMap((item) => {
    const date = item.sch_date || item.rl_date; const title = item.title?.trim();
    if (!date || !title || date < start || date > finish) return [];
    const id = `${date}:${title}`; if (seen.has(id)) return []; seen.add(id);
    return [{ date, dateOnly: true, country: 'Indonesia', event: title, forecast: '—', prior: '—', importance: 2 }];
  });
}

export async function GET() {
  const key = process.env.FRED_API_KEY;
  if (!key) return NextResponse.json({ status: 'not_configured', source: 'FRED Release Calendar', error: 'FRED_API_KEY is missing' }, { status: 503 });
  try {
    const start = new Date().toISOString().slice(0,10); const finish = new Date(Date.now() + 30 * 86400000).toISOString().slice(0,10);
    const params = new URLSearchParams({ api_key: key, file_type: 'json', realtime_start: start, realtime_end: finish, include_release_dates_with_no_data: 'true', order_by: 'release_date', sort_order: 'asc', limit: '1000' });
    const url = `https://api.stlouisfed.org/fred/releases/dates?${params}`;
    const response = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'Jarvis Research Terminal' }, cache: 'no-store' });
    if (!response.ok) throw new Error(`FRED calendar returned ${response.status}`);
    const payload = await response.json() as { release_dates?: FredReleaseDate[] };
    const seen = new Set<string>();
    const usEvents = (payload.release_dates ?? []).filter((item) => item.date && item.date >= start && item.date <= finish && macroRelease.test(item.release_name ?? '')).flatMap((item) => {
      const name = item.release_name ?? 'US economic release'; const id = `${item.date}:${name}`; if (seen.has(id)) return []; seen.add(id);
      return [{ date: item.date!, dateOnly: true, country: 'United States', event: name, forecast: '—', prior: '—', importance: highImpact.test(name) ? 3 : 2 }];
    });
    const bpsKey = process.env.BPS_API_KEY; let bpsEvents: Awaited<ReturnType<typeof fetchBpsSchedule>> = []; let bpsStatus = 'BPS API key not configured';
    if (bpsKey) try { bpsEvents = await fetchBpsSchedule(bpsKey, start, finish); bpsStatus = `BPS official publication schedule connected (${bpsEvents.length} upcoming)`; } catch (error) { bpsStatus = `BPS official API unavailable: ${error instanceof Error ? error.message : 'request failed'}`; }
    const events = [...usEvents, ...bpsEvents].sort((a,b) => a.date.localeCompare(b.date)).slice(0, 12);
    return NextResponse.json({ status: 'live', source: bpsEvents.length ? 'FRED + BPS WebAPI' : 'FRED Release Calendar', freshness: new Date().toISOString(), coverage: `US official release dates; ${bpsStatus}`, bpsStatus, events }, { headers: { 'cache-control': 'public, max-age=3600' } });
  } catch (error) {
    return NextResponse.json({ status: 'stale', source: 'FRED Release Calendar', error: error instanceof Error ? error.message : 'Calendar unavailable' }, { status: 503 });
  }
}
