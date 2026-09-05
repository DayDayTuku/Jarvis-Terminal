import { NextRequest, NextResponse } from 'next/server';

const symbols: Record<string,string> = { BUMI: 'BUMI.JK', AMMN: 'AMMN.JK', ADRO: 'ADRO.JK', JKSE: '^JKSE' };
type Chart = { timestamp?: number[]; indicators: { quote: Array<{ close: Array<number | null> }> } };

export async function GET(request: NextRequest) {
  const ticker = (request.nextUrl.searchParams.get('ticker') ?? 'BUMI').toUpperCase().replace('.JK', '');
  const symbol = symbols[ticker] || (ticker === 'JKSE' ? '^JKSE' : `${ticker}.JK`);
  if (!symbol) return NextResponse.json({ status: 'error', error: 'Unsupported ticker' }, { status: 400 });
  try {
    const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=10y&interval=1d`, { headers: { 'user-agent': 'Mozilla/5.0', accept: 'application/json' }, cache: 'no-store' });
    if (!response.ok) throw new Error(`${symbol} returned ${response.status}`);
    const payload = await response.json() as { chart: { result: Chart[] | null } }; const chart = payload.chart.result?.[0]; if (!chart) throw new Error('No price history returned');
    const closes = chart.indicators.quote[0]?.close ?? []; const timestamps = chart.timestamp ?? []; const buckets = new Map<string, number[]>();
    timestamps.forEach((timestamp,index) => { const close=closes[index]; if(close===null)return; const date=new Date(timestamp*1000); const key=`${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}`; const bucket=buckets.get(key)??[];bucket.push(close);buckets.set(key,bucket); });
    const returns = [...buckets.entries()].flatMap(([key,values]) => values.length>1 ? [{year:Number(key.slice(0,4)),month:Number(key.slice(5,7)),value:(values.at(-1)!/values[0]-1)*100}] : []);
    const months = Array.from({length:12},(_,index)=>{const observations=returns.filter((item)=>item.month===index+1);return {month:index+1,average:observations.length?observations.reduce((sum,item)=>sum+item.value,0)/observations.length:0,positiveRate:observations.length?observations.filter((item)=>item.value>0).length/observations.length*100:0,observations:observations.length};});
    const years=[...new Set(returns.map((item)=>item.year))]; return NextResponse.json({status:'live',source:'Yahoo Finance upstream',ticker,symbol,years:years.length,from:Math.min(...years),through:Math.max(...years),months},{headers:{'cache-control':'public, max-age=3600'}});
  } catch(error){return NextResponse.json({status:'stale',source:'Yahoo Finance upstream',ticker,error:error instanceof Error?error.message:'Seasonality unavailable'},{status:503});}
}
