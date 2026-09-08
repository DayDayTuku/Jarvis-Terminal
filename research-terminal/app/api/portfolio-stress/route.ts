import { NextRequest, NextResponse } from "next/server";
import { IDX_UNIVERSE } from "@/lib/idx-universe";

type InputPosition = { ticker?: string; value?: number };
type Point = { date: string; value: number };
type Series = { symbol: string; points: Point[]; price: number };
type ReturnPoint = { date: string; value: number };

const FACTORS = [
  { key: "JKSE", label: "IDX Composite", symbol: "^JKSE" },
  { key: "USDIDR", label: "USD/IDR", symbol: "USDIDR=X" },
  { key: "OIL", label: "WTI Crude", symbol: "CL=F" },
] as const;

const SCENARIOS = [
  { key: "market_shock", label: "IDX SELL-OFF", detail: "Broad risk-off with a weaker rupiah", shocks: { JKSE: -0.05, USDIDR: 0.03, OIL: -0.08 } },
  { key: "rupiah_shock", label: "RUPIAH SHOCK", detail: "Sharp USD/IDR rise with local de-rating", shocks: { JKSE: -0.03, USDIDR: 0.07, OIL: 0 } },
  { key: "commodity_unwind", label: "COMMODITY UNWIND", detail: "Oil-led commodity correction", shocks: { JKSE: -0.04, USDIDR: 0.02, OIL: -0.15 } },
  { key: "risk_on", label: "RISK-ON RALLY", detail: "IDX rally, firmer rupiah, stronger oil", shocks: { JKSE: 0.05, USDIDR: -0.02, OIL: 0.08 } },
] as const;

async function fetchSeries(symbol: string): Promise<Series> {
  const encoded = encodeURIComponent(symbol);
  const path = `/v8/finance/chart/${encoded}?range=2y&interval=1d&events=div%2Csplits`;
  let reason = `${symbol} unavailable`;
  for (const host of ["https://query2.finance.yahoo.com", "https://query1.finance.yahoo.com"]) {
    try {
      const response = await fetch(host + path, {
        headers: { accept: "application/json", "user-agent": "Mozilla/5.0 Jarvis-Research-Terminal" },
        signal: AbortSignal.timeout(9000),
        next: { revalidate: 900 },
      });
      if (!response.ok) { reason = `${symbol} returned ${response.status}`; continue; }
      const payload = await response.json() as any;
      const result = payload?.chart?.result?.[0];
      if (!result) { reason = `${symbol} returned no data`; continue; }
      const timestamps: number[] = result.timestamp ?? [];
      const adjusted: Array<number | null> | undefined = result.indicators?.adjclose?.[0]?.adjclose;
      const closes: Array<number | null> = adjusted?.length === timestamps.length ? adjusted : result.indicators?.quote?.[0]?.close ?? [];
      const points = timestamps.flatMap((timestamp, index) => {
        const value = closes[index];
        return typeof value === "number" && Number.isFinite(value)
          ? [{ date: new Date(timestamp * 1000).toISOString().slice(0, 10), value }]
          : [];
      });
      if (points.length >= 120) return { symbol, points, price: points.at(-1)!.value };
      reason = `${symbol} returned insufficient history`;
    } catch (error) {
      reason = error instanceof Error ? error.message : reason;
    }
  }
  throw new Error(reason);
}

function returns(points: Point[]): ReturnPoint[] {
  return points.slice(1).flatMap((point, index) => {
    const prior = points[index].value;
    return prior ? [{ date: point.date, value: point.value / prior - 1 }] : [];
  });
}
function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}
function stdev(values: number[]) {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1));
}
function beta(asset: ReturnPoint[], factor: ReturnPoint[]) {
  const factorMap = new Map(factor.map((point) => [point.date, point.value]));
  const pairs = asset.flatMap((point) => {
    const matched = factorMap.get(point.date);
    return typeof matched === "number" ? [[point.value, matched] as [number, number]] : [];
  }).slice(-252);
  if (pairs.length < 60) return null;
  const xs = pairs.map((pair) => pair[0]);
  const ys = pairs.map((pair) => pair[1]);
  const mx = mean(xs), my = mean(ys);
  const covariance = pairs.reduce((sum, pair) => sum + (pair[0] - mx) * (pair[1] - my), 0);
  const variance = ys.reduce((sum, value) => sum + (value - my) ** 2, 0);
  return variance ? covariance / variance : null;
}
function maxDrawdown(dailyReturns: number[]) {
  let value = 1, peak = 1, worst = 0;
  for (const daily of dailyReturns) {
    value *= 1 + daily;
    peak = Math.max(peak, value);
    worst = Math.min(worst, value / peak - 1);
  }
  return worst;
}

export async function POST(request: NextRequest) {
  let body: { positions?: InputPosition[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ status: "error", error: "Invalid portfolio payload." }, { status: 400 });
  }

  const positions = (body.positions ?? []).flatMap((position) => {
    const clean = String(position.ticker ?? "").replace(/\.JK$/i, "").trim().toUpperCase();
    const ticker = `${clean}.JK`;
    const value = Number(position.value);
    const stock = IDX_UNIVERSE.find((item) => item.ticker === ticker);
    return stock && Number.isFinite(value) && value > 0 ? [{ ticker, shortTicker: clean, value, name: stock.name, sector: stock.sector }] : [];
  }).slice(0, 8);

  if (!positions.length) {
    return NextResponse.json({ status: "error", error: "Add at least one valid IDX position with a positive market value." }, { status: 400 });
  }

  const merged = new Map<string, typeof positions[number]>();
  for (const position of positions) {
    const existing = merged.get(position.ticker);
    merged.set(position.ticker, existing ? { ...existing, value: existing.value + position.value } : position);
  }
  const uniquePositions = [...merged.values()];
  const totalValue = uniquePositions.reduce((sum, position) => sum + position.value, 0);
  const symbols = [...uniquePositions.map((position) => position.ticker), ...FACTORS.map((factor) => factor.symbol)];

  try {
    const settled = await Promise.allSettled(symbols.map(fetchSeries));
    const bySymbol = new Map<string, Series>();
    const failures: string[] = [];
    settled.forEach((result, index) => result.status === "fulfilled" ? bySymbol.set(symbols[index], result.value) : failures.push(symbols[index]));

    const factorReturns = new Map(FACTORS.flatMap((factor) => {
      const series = bySymbol.get(factor.symbol);
      return series ? [[factor.key, returns(series.points)] as const] : [];
    }));
    if (!factorReturns.has("JKSE")) throw new Error("IDX benchmark history is unavailable.");

    const analyzed = uniquePositions.flatMap((position) => {
      const series = bySymbol.get(position.ticker);
      if (!series) return [];
      const assetReturns = returns(series.points);
      const betas = Object.fromEntries(FACTORS.map((factor) => [factor.key, factorReturns.has(factor.key) ? beta(assetReturns, factorReturns.get(factor.key)!) : null]));
      const annualVolatility = stdev(assetReturns.slice(-252).map((point) => point.value)) * Math.sqrt(252);
      const weight = position.value / totalValue;
      return [{ ...position, weight, price: series.price, annualVolatility, betas, assetReturns }];
    });
    if (!analyzed.length) throw new Error("No position returned enough historical prices.");

    const analyzedWeight = analyzed.reduce((sum, position) => sum + position.weight, 0);
    analyzed.forEach((position) => { position.weight /= analyzedWeight; });
    const riskBase = analyzed.reduce((sum, position) => sum + position.weight * position.annualVolatility, 0);
    const riskContributions = analyzed.map((position) => ({
      ticker: position.shortTicker,
      contribution: riskBase ? position.weight * position.annualVolatility / riskBase : position.weight,
    })).sort((a, b) => b.contribution - a.contribution);

    const returnMaps = analyzed.map((position) => new Map(position.assetReturns.map((point) => [point.date, point.value])));
    const allDates = [...new Set(analyzed.flatMap((position) => position.assetReturns.map((point) => point.date)))].sort();
    const portfolioReturns = allDates.flatMap((date) => {
      let weighted = 0, availableWeight = 0;
      analyzed.forEach((position, index) => {
        const value = returnMaps[index].get(date);
        if (typeof value === "number") { weighted += position.weight * value; availableWeight += position.weight; }
      });
      return availableWeight >= 0.8 ? [weighted / availableWeight] : [];
    }).slice(-252);
    const annualVolatility = stdev(portfolioReturns) * Math.sqrt(252);
    const drawdown = maxDrawdown(portfolioReturns);
    const hhi = analyzed.reduce((sum, position) => sum + position.weight ** 2, 0);
    const diversificationScore = analyzed.length === 1 ? 0 : Math.max(0, Math.min(100, (1 - hhi) / (1 - 1 / analyzed.length) * 100));

    const scenarios = SCENARIOS.map((scenario) => {
      const positionImpacts = analyzed.map((position) => {
        const estimatedReturn = Math.max(-0.5, Math.min(0.5, FACTORS.reduce((sum, factor) => {
          const factorBeta = position.betas[factor.key];
          return sum + (typeof factorBeta === "number" ? factorBeta * scenario.shocks[factor.key] : 0);
        }, 0)));
        return { ticker: position.shortTicker, estimatedReturn, pnl: position.value * estimatedReturn };
      });
      const estimatedReturn = positionImpacts.reduce((sum, item, index) => sum + analyzed[index].weight * item.estimatedReturn, 0);
      return { ...scenario, estimatedReturn, estimatedPnl: totalValue * estimatedReturn, positionImpacts: positionImpacts.sort((a, b) => a.estimatedReturn - b.estimatedReturn) };
    });

    const sectorWeights = Object.entries(analyzed.reduce<Record<string, number>>((result, position) => {
      result[position.sector] = (result[position.sector] ?? 0) + position.weight;
      return result;
    }, {})).map(([sector, weight]) => ({ sector, weight })).sort((a, b) => b.weight - a.weight);

    return NextResponse.json({
      status: failures.length ? "partial" : "live",
      source: "Yahoo Finance adjusted daily history",
      totalValue,
      coverage: { requested: uniquePositions.length, analyzed: analyzed.length, failures },
      summary: {
        annualVolatility,
        maxDrawdown1Y: drawdown,
        diversificationScore,
        largestPosition: [...analyzed].sort((a, b) => b.weight - a.weight)[0].shortTicker,
        largestPositionWeight: Math.max(...analyzed.map((position) => position.weight)),
        topRiskContributor: riskContributions[0]?.ticker ?? null,
        topRiskContribution: riskContributions[0]?.contribution ?? null,
      },
      positions: analyzed.map(({ assetReturns: _assetReturns, ...position }) => position),
      sectorWeights,
      riskContributions,
      scenarios,
      methodology: "One-year risk statistics use adjusted daily returns. Scenario estimates apply trailing 252-session pairwise factor betas linearly; they are sensitivity estimates, not forecasts. Position value is used as the portfolio weight.",
      generatedAt: new Date().toISOString(),
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ status: "unavailable", error: error instanceof Error ? error.message : "Portfolio analysis failed." }, { status: 502 });
  }
}
