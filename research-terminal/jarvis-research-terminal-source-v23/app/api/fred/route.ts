import { NextResponse } from 'next/server';

const MACRO = ['CPIAUCSL', 'PPIFID', 'PCEPILFE', 'RSXFS', 'UMCSENT', 'MANEMP', 'INDPRO'];
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
  const values = clean(transformed).slice(-120); const actual = values.at(-1) ?? 0; const avg = mean(values); const z = (actual - avg) / stdev(values);
  return { name, actual, mean: avg, z, unit: useYoy ? '%' : '' };
}

function employmentIndicator(series: Series) {
  const values = clean(series.map((row) => row.value)).slice(-120); const actual = values.at(-1) ?? 0; const avg = mean(values);
  return { name: 'Manufacturing Employment', actual: actual / 1000, mean: avg / 1000, z: (actual - avg) / stdev(values), unit: 'M' };
}

function monthlyZ(series: Series, transform: 'yoy' | 'level' = 'yoy') {
  const raw = series.map((row) => row.value); const values = transform === 'yoy' ? yoy(raw) : raw;
  const history = clean(values).slice(-120); const avg = mean(history); const sd = stdev(history);
  return new Map(series.flatMap((row, index) => values[index] === null ? [] : [[row.date.slice(0, 7), (values[index]! - avg) / sd] as const]));
}
function priorMonth(month: string) { const date = new Date(`${month}-01T00:00:00Z`); date.setUTCMonth(date.getUTCMonth() - 1); return date.toISOString().slice(0, 7); }
function monthlyValue(series: Map<string, number>, month: string) { return series.get(month) ?? series.get(priorMonth(month)); }

export async function GET() {
  try {
    const macroStart = new Date(); macroStart.setUTCFullYear(macroStart.getUTCFullYear() - 11);
    const curveStart = new Date(); curveStart.setUTCDate(curveStart.getUTCDate() - 45);
    const [macroSeries, curveSeries] = await Promise.all([
      Promise.all(MACRO.map((id) => fetchSeries(id, macroStart.toISOString().slice(0, 10)))),
      Promise.all(CURVE.map((id) => fetchSeries(id, curveStart.toISOString().slice(0, 10)))),
    ]);
    const byId = new Map(MACRO.map((id, index) => [id, macroSeries[index]]));
    const growthMaps = [monthlyZ(byId.get('INDPRO')!), monthlyZ(byId.get('RSXFS')!), monthlyZ(byId.get('MANEMP')!)];
    const inflationMaps = [monthlyZ(byId.get('CPIAUCSL')!), monthlyZ(byId.get('PCEPILFE')!), monthlyZ(byId.get('PPIFID')!)];
    const candidateMonths = [...new Set(macroSeries.flatMap((series) => series.map((row) => row.date.slice(0, 7))))].sort();
    const regime = candidateMonths.flatMap((month) => {
      const growthParts = growthMaps.map((series) => monthlyValue(series, month)); const inflationParts = inflationMaps.map((series) => monthlyValue(series, month));
      if (growthParts.some((value) => value === undefined) || inflationParts.some((value) => value === undefined)) return [];
      return [{ date: `${month}-01`, growth: mean(growthParts as number[]), inflation: mean(inflationParts as number[]) }];
    }).slice(-36);
    const yields = curveSeries.map((series, index) => ({ maturity: ['3M','1Y','2Y','5Y','10Y','20Y','30Y'][index], value: clean(series.map((row) => row.value)).at(-1) ?? 0 }));
    const twoYear = new Map(curveSeries[2].filter((row) => row.value !== null).map((row) => [row.date, row.value!]));
    const spreadHistory = curveSeries[4].flatMap((row) => row.value !== null && twoYear.has(row.date) ? [{ date: row.date, spread: row.value - twoYear.get(row.date)! }] : []);
    const currentSpread = spreadHistory.at(-1)?.spread ?? 0; const previousSpread = spreadHistory.at(-2)?.spread ?? currentSpread;
    const curveStatus = { current: currentSpread < 0 ? 'inverted' : 'normal', previous: previousSpread < 0 ? 'inverted' : 'normal', changed: (currentSpread < 0) !== (previousSpread < 0), asOf: spreadHistory.at(-1)?.date ?? null };
    const freshness = [...byId.get('CPIAUCSL')!].reverse().find((row) => row.value !== null)?.date ?? null;
    const regimeMethodology = { frequency: 'monthly', normalization: 'component YoY growth standardized over trailing 120 observations, then equal-weighted; isolated release gaps carry forward at most one month', growth: ['Industrial Production (INDPRO)', 'Retail Sales (RSXFS)', 'Manufacturing Employment (MANEMP)'], growthPending: ['ISM Manufacturing PMI — unavailable as a current FRED series; excluded'], inflation: ['CPI (CPIAUCSL)', 'Core PCE (PCEPILFE)', 'PPI Final Demand (PPIFID)'] };
    return NextResponse.json({ status: 'live', source: process.env.FRED_API_KEY ? 'FRED API' : 'FRED CSV', freshness, indicators: [indicator(byId.get('CPIAUCSL')!,'CPI',true),indicator(byId.get('PCEPILFE')!,'Core PCE',true),indicator(byId.get('PPIFID')!,'PPI Final Demand',true),indicator(byId.get('RSXFS')!,'Retail Sales',true),indicator(byId.get('UMCSENT')!,'Consumer Sentiment',false),employmentIndicator(byId.get('MANEMP')!)], yields, curveStatus, regime, regimeMethodology }, { headers: { 'cache-control': 'public, max-age=900' } });
  } catch (error) {
    return NextResponse.json({ status: 'stale', source: 'FRED', error: error instanceof Error ? error.message : 'FRED unavailable' }, { status: 503 });
  }
}
