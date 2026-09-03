import { NextResponse } from 'next/server';

const MACRO = ['CPIAUCSL', 'PPIACO', 'PCEPILFE', 'RSXFS', 'UMCSENT', 'MANEMP', 'INDPRO'];
const CURVE = ['DGS3MO', 'DGS1', 'DGS2', 'DGS5', 'DGS10', 'DGS20', 'DGS30'];
type Series = Array<{ date: string; value: number | null }>;

function mean(values: number[]) { return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1); }
function stdev(values: number[]) { const avg = mean(values); return Math.sqrt(mean(values.map((value) => (value - avg) ** 2))) || 1; }
function clean(values: Array<number | null>) { return values.filter((value): value is number => value !== null && Number.isFinite(value)); }
function yoy(series: Array<number | null>) { const result = series.map(() => null as number | null); for (let index = 12; index < series.length; index += 1) { const current = series[index]; const prior = series[index - 12]; if (current !== null && prior !== null && prior !== 0) result[index] = ((current / prior) - 1) * 100; } return result; }

async function fetchSeries(id: string, start: string): Promise<Series> {
  const apiKey = process.env.FRED_API_KEY;
  if (apiKey) {
    const response = await fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=${id}&api_key=${apiKey}&file_type=json&observation_start=${start}`, { headers: { accept: 'application/json', 'user-agent': 'Jarvis Research Terminal' }, cache: 'no-store' });
    if (!response.ok) throw new Error(`${id} returned ${response.status}`);
    const payload = await response.json() as { observations: Array<{ date: string; value: string }> };
    return payload.observations.map((row) => { const parsed = Number(row.value); return { date: row.date, value: row.value !== '.' && Number.isFinite(parsed) ? parsed : null }; });
  }
  const response = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${start}`, { headers: { accept: 'text/csv', 'user-agent': 'Jarvis Research Terminal' }, cache: 'no-store' });
  if (!response.ok) throw new Error(`${id} returned ${response.status}`);
  const lines = (await response.text()).trim().split(/\r?\n/).slice(1);
  return lines.map((line) => { const [date, raw] = line.split(','); const parsed = Number(raw); return { date, value: raw && raw !== '.' && Number.isFinite(parsed) ? parsed : null }; });
}

function indicator(series: Series, name: string, useYoy: boolean) {
  const transformed = useYoy ? yoy(series.map((row) => row.value)) : series.map((row) => row.value);
  const values = clean(transformed); const actual = values.at(-1) ?? 0; const avg = mean(values); const z = (actual - avg) / stdev(values);
  return { name, actual, mean: avg, z, unit: useYoy ? '%' : '' };
}

export async function GET() {
  try {
    const macroStart = new Date(); macroStart.setUTCFullYear(macroStart.getUTCFullYear() - 11);
    const curveStart = new Date(); curveStart.setUTCDate(curveStart.getUTCDate() - 45);
    const [macroSeries, curveSeries] = await Promise.all([
      Promise.all(MACRO.map((id) => fetchSeries(id, macroStart.toISOString().slice(0, 10)))),
      Promise.all(CURVE.map((id) => fetchSeries(id, curveStart.toISOString().slice(0, 10)))),
    ]);
    const byId = new Map(MACRO.map((id, index) => [id, macroSeries[index]]));
    const inflationSeries = byId.get('CPIAUCSL')!; const growthSeries = byId.get('INDPRO')!;
    const growthByDate = new Map(growthSeries.map((row) => [row.date, row.value]));
    const dates = inflationSeries.map((row) => row.date); const inflation = yoy(inflationSeries.map((row) => row.value)); const growth = yoy(dates.map((date) => growthByDate.get(date) ?? null));
    const inflationValues = clean(inflation); const growthValues = clean(growth); const infMean = mean(inflationValues); const groMean = mean(growthValues); const infSd = stdev(inflationValues); const groSd = stdev(growthValues);
    const regime = dates.map((date, index) => ({ date, inflation: inflation[index] === null ? null : (inflation[index]! - infMean) / infSd, growth: growth[index] === null ? null : (growth[index]! - groMean) / groSd })).filter((point): point is { date: string; inflation: number; growth: number } => point.inflation !== null && point.growth !== null).slice(-36);
    const yields = curveSeries.map((series, index) => ({ maturity: ['3M','1Y','2Y','5Y','10Y','20Y','30Y'][index], value: clean(series.map((row) => row.value)).at(-1) ?? 0 }));
    const freshness = [...inflationSeries].reverse().find((row) => row.value !== null)?.date ?? null;
    return NextResponse.json({ status: 'live', source: process.env.FRED_API_KEY ? 'FRED API' : 'FRED CSV', freshness, indicators: [indicator(byId.get('CPIAUCSL')!,'CPI',true),indicator(byId.get('PCEPILFE')!,'Core PCE',true),indicator(byId.get('PPIACO')!,'PPI',true),indicator(byId.get('RSXFS')!,'Retail Sales',true),indicator(byId.get('UMCSENT')!,'Consumer Sentiment',false),indicator(byId.get('MANEMP')!,'Manufacturing Jobs',false)], yields, regime }, { headers: { 'cache-control': 'public, max-age=900' } });
  } catch (error) {
    return NextResponse.json({ status: 'stale', source: 'FRED', error: error instanceof Error ? error.message : 'FRED unavailable' }, { status: 503 });
  }
}
