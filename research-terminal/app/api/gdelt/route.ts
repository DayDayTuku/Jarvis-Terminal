import { fetchUpstream } from "../../../lib/upstream.ts";
import { NextResponse } from 'next/server';

type TimelinePoint = { date: string; value: number };
const regions = [
  { key: 'SEA', query: '("geopolitical risk" OR sanctions OR military) (Indonesia OR Malaysia OR Singapore OR Thailand OR Vietnam OR Philippines)' },
  { key: 'CHINA', query: '("geopolitical risk" OR sanctions OR military) China' },
  { key: 'US', query: '("geopolitical risk" OR sanctions) "United States"' },
];

function normalizeDate(value: unknown) {
  const raw = String(value ?? '');
  if (/^\d{8}/.test(raw)) return `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`;
  return raw.slice(0,10);
}

function extractTimeline(payload: unknown): TimelinePoint[] {
  if (!payload || typeof payload !== 'object') return [];
  const root = payload as { timeline?: Array<{ data?: Array<{ date?: unknown; value?: unknown }> }> };
  const data = root.timeline?.flatMap((series) => series.data ?? []) ?? [];
  return data.map((point) => ({ date: normalizeDate(point.date), value: Number(point.value) })).filter((point) => point.date.length === 10 && Number.isFinite(point.value));
}

function score(points: TimelinePoint[]) {
  const recent = points.slice(-90); const values = recent.map((point) => point.value); const low = Math.min(...values); const high = Math.max(...values);
  return high === low ? 50 : Math.round(((values.at(-1)! - low) / (high - low)) * 1000) / 10;
}

export async function GET() {
  try {
    const settled = await Promise.allSettled(regions.map(async (region) => {
      const params = new URLSearchParams({ query: region.query, mode: 'timelinevol', format: 'json', timespan: '3months', timelinesmooth: '3' });
      const response = await fetchUpstream(`https://api.gdeltproject.org/api/v2/doc/doc?${params}`, { headers: { accept: 'application/json', 'user-agent': 'Jarvis Research Terminal' }, cache: 'no-store' });
      if (!response.ok) throw new Error(`${region.key} returned ${response.status}`);
      const timeline = extractTimeline(await response.json()); if (!timeline.length) throw new Error(`${region.key} returned no timeline`);
      return { region: region.key, score: score(timeline), timeline };
    }));
    const series = settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
    const failures = settled.flatMap((result,index) => result.status === 'rejected' ? [regions[index].key] : []);
    if (!series.length) throw new Error('All regional queries failed');
    const frequencyScore = Math.round(series.reduce((sum, item) => sum + item.score, 0) / series.length * 10) / 10;
    return NextResponse.json({ status: 'partial', source: 'GDELT DOC 2.0', freshness: series[0].timeline.at(-1)?.date, frequencyScore, severityStatus: 'Goldstein event feed not configured', regions: series, failures }, { headers: { 'cache-control': 'public, max-age=900' } });
  } catch (error) {
    return NextResponse.json({ status: 'stale', source: 'GDELT DOC 2.0', error: error instanceof Error ? error.message : 'GDELT unavailable' }, { status: 503 });
  }
}
