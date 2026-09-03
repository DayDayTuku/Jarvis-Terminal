import { NextResponse } from 'next/server';

type Chart = { meta: { symbol: string; regularMarketPrice?: number }; timestamp?: number[]; indicators: { quote: Array<{ close: Array<number | null> }> } };
type SectorConfig = { label: string; members: Array<{ ticker: string; symbol: string }> };

const watchSymbols = ['BUMI.JK', 'AMMN.JK', 'ADRO.JK'];
const sectors: SectorConfig[] = [
  { label: 'ENERGY', members: [{ ticker: 'ADRO', symbol: 'ADRO.JK' }, { ticker: 'BUMI', symbol: 'BUMI.JK' }, { ticker: 'PTBA', symbol: 'PTBA.JK' }, { ticker: 'MEDC', symbol: 'MEDC.JK' }] },
  { label: 'BASIC MATERIALS', members: [{ ticker: 'AMMN', symbol: 'AMMN.JK' }, { ticker: 'ANTM', symbol: 'ANTM.JK' }, { ticker: 'INCO', symbol: 'INCO.JK' }, { ticker: 'MDKA', symbol: 'MDKA.JK' }] },
  { label: 'INDUSTRIALS', members: [{ ticker: 'ASII', symbol: 'ASII.JK' }, { ticker: 'UNTR', symbol: 'UNTR.JK' }, { ticker: 'IMPC', symbol: 'IMPC.JK' }, { ticker: 'ARNA', symbol: 'ARNA.JK' }] },
  { label: 'CONSUMER CYCLICALS', members: [{ ticker: 'MAPI', symbol: 'MAPI.JK' }, { ticker: 'ACES', symbol: 'ACES.JK' }, { ticker: 'SCMA', symbol: 'SCMA.JK' }, { ticker: 'ERAA', symbol: 'ERAA.JK' }] },
  { label: 'CONSUMER NON-CYCLICALS', members: [{ ticker: 'ICBP', symbol: 'ICBP.JK' }, { ticker: 'INDF', symbol: 'INDF.JK' }, { ticker: 'AMRT', symbol: 'AMRT.JK' }, { ticker: 'MYOR', symbol: 'MYOR.JK' }] },
  { label: 'HEALTHCARE', members: [{ ticker: 'KLBF', symbol: 'KLBF.JK' }, { ticker: 'MIKA', symbol: 'MIKA.JK' }, { ticker: 'HEAL', symbol: 'HEAL.JK' }, { ticker: 'SILO', symbol: 'SILO.JK' }] },
  { label: 'FINANCIALS', members: [{ ticker: 'BBCA', symbol: 'BBCA.JK' }, { ticker: 'BMRI', symbol: 'BMRI.JK' }, { ticker: 'BBRI', symbol: 'BBRI.JK' }, { ticker: 'BBNI', symbol: 'BBNI.JK' }] },
  { label: 'PROPERTIES & REAL ESTATE', members: [{ ticker: 'BSDE', symbol: 'BSDE.JK' }, { ticker: 'CTRA', symbol: 'CTRA.JK' }, { ticker: 'PWON', symbol: 'PWON.JK' }, { ticker: 'SMRA', symbol: 'SMRA.JK' }] },
  { label: 'TECHNOLOGY', members: [{ ticker: 'GOTO', symbol: 'GOTO.JK' }, { ticker: 'EMTK', symbol: 'EMTK.JK' }, { ticker: 'DCII', symbol: 'DCII.JK' }, { ticker: 'MTDL', symbol: 'MTDL.JK' }] },
  { label: 'INFRASTRUCTURES', members: [{ ticker: 'TLKM', symbol: 'TLKM.JK' }, { ticker: 'JSMR', symbol: 'JSMR.JK' }, { ticker: 'ISAT', symbol: 'ISAT.JK' }, { ticker: 'TOWR', symbol: 'TOWR.JK' }] },
  { label: 'TRANSPORTATION & LOGISTICS', members: [{ ticker: 'BIRD', symbol: 'BIRD.JK' }, { ticker: 'ASSA', symbol: 'ASSA.JK' }, { ticker: 'SMDR', symbol: 'SMDR.JK' }, { ticker: 'TMAS', symbol: 'TMAS.JK' }] },
];
const assetConfig = [
  { name: 'COAL', symbol: 'COAL' }, { name: 'NICKEL', symbol: 'VALE' }, { name: 'OIL', symbol: 'CL=F' },
  { name: 'DXY', symbol: 'DX-Y.NYB' }, { name: 'JKSE', symbol: '^JKSE' },
];

async function chart(symbol: string, range = '1mo') {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`;
  const response = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0', accept: 'application/json' }, cache: 'no-store' });
  if (!response.ok) throw new Error(`${symbol} returned ${response.status}`);
  const payload = await response.json() as { chart: { result: Chart[] | null } };
  const result = payload.chart.result?.[0]; if (!result) throw new Error(`${symbol} returned no data`); return result;
}

function prices(result?: Chart) { return result?.indicators.quote[0]?.close.filter((value): value is number => value !== null) ?? []; }
function change(values: number[], sessions = 1) { const last = values.at(-1) ?? 0; const prior = values.at(-(sessions + 1)) ?? last; return prior ? ((last / prior) - 1) * 100 : 0; }
function validChange(values: number[], sessions: number) { return values.length > sessions && values.at(-(sessions + 1)) ? change(values, sessions) : null; }
function average(values: number[]) { return values.reduce((sum, value) => sum + value, 0) / values.length; }

export async function GET() {
  const memberSymbols = [...new Set(sectors.flatMap((sector) => sector.members.map((member) => member.symbol)))];
  const symbols = [...new Set([...watchSymbols, ...memberSymbols, ...assetConfig.map((asset) => asset.symbol)])];
  const results = await Promise.allSettled(symbols.map((symbol) => chart(symbol, assetConfig.some((asset) => asset.symbol === symbol) ? '6mo' : '1mo')));
  const bySymbol = new Map<string, Chart>(); const failures: string[] = [];
  results.forEach((result, index) => result.status === 'fulfilled' ? bySymbol.set(symbols[index], result.value) : failures.push(symbols[index]));

  const watchlist = watchSymbols.flatMap((symbol) => { const result = bySymbol.get(symbol); if (!result) return []; const values = prices(result); return [{ ticker: symbol.replace('.JK', ''), price: result.meta.regularMarketPrice ?? values.at(-1) ?? 0, change: change(values) }]; });
  const heatmap = sectors.map((sector) => {
    const constituents = sector.members.flatMap((member) => { const memberResult = bySymbol.get(member.symbol); if (!memberResult) return []; const memberPrices = prices(memberResult); const daily = validChange(memberPrices, 1); const weekly = validChange(memberPrices, 5); if (daily === null && weekly === null) return []; return [{ ticker: member.ticker, price: memberResult.meta.regularMarketPrice ?? memberPrices.at(-1) ?? 0, daily, weekly }]; });
    const dailyValues = constituents.flatMap((member) => member.daily === null ? [] : [member.daily]); const weeklyValues = constituents.flatMap((member) => member.weekly === null ? [] : [member.weekly]);
    const validCount = Math.min(dailyValues.length, weeklyValues.length); return { label: sector.label, symbol: 'IDX-IC CONSTITUENT BASKET', daily: dailyValues.length ? average(dailyValues) : null, weekly: weeklyValues.length ? average(weeklyValues) : null, constituents, method: 'simple_average', validCount, memberCount: sector.members.length, confidence: validCount >= 3 ? 'standard' : 'low' };
  });
  const assets = assetConfig.flatMap((asset) => {
    const result = bySymbol.get(asset.symbol); if (!result) return [];
    const timestamps = result.timestamp ?? []; const closes = result.indicators.quote[0]?.close ?? [];
    const validObservations = closes.filter((value) => value !== null && Number.isFinite(value)).length;
    if (timestamps.length < 61 || validObservations < 61) { failures.push(`${asset.symbol}:insufficient_history`); return []; }
    return [{ name: asset.name, symbol: asset.symbol, timestamps, closes }];
  });

  if (!watchlist.length && !heatmap.length && !assets.length) return NextResponse.json({ status: 'stale', source: 'Yahoo Finance upstream', failures }, { status: 503 });
  const lowConfidenceSectors = heatmap.filter((sector) => sector.confidence === 'low').map((sector) => sector.label);
  return NextResponse.json({ status: failures.length || lowConfidenceSectors.length ? 'partial' : 'live', source: 'Yahoo Finance upstream', watchlist, heatmap, assets, failures, lowConfidenceSectors, sectorMethod: 'simple_average', freshness: new Date().toISOString() }, { headers: { 'cache-control': 'public, max-age=900' } });
}
