import { NextRequest, NextResponse } from "next/server";

type ChartResult = {
  timestamp?: number[];
  indicators: {
    quote: Array<{ close: Array<number | null> }>;
    adjclose?: Array<{ adjclose: Array<number | null> }>;
  };
};

type Point = { date: string; value: number };
type SignalDefinition = {
  label: string;
  source: string;
  description: string;
  warmup: number;
  test: (values: number[], index: number) => boolean;
};

const TARGETS: Record<string, { label: string; symbol: string }> = {
  JKSE: { label: "Jakarta Composite", symbol: "^JKSE" },
  ADRO: { label: "Alamtri Resources", symbol: "ADRO.JK" },
  PTBA: { label: "Bukit Asam", symbol: "PTBA.JK" },
  ANTM: { label: "Aneka Tambang", symbol: "ANTM.JK" },
  BBCA: { label: "Bank Central Asia", symbol: "BBCA.JK" },
};

function trailingReturn(values: number[], index: number, sessions: number) {
  const prior = values[index - sessions];
  return prior ? values[index] / prior - 1 : 0;
}

function sma(values: number[], index: number, sessions: number) {
  if (index < sessions - 1) return 0;
  let total = 0;
  for (let cursor = index - sessions + 1; cursor <= index; cursor += 1) total += values[cursor];
  return total / sessions;
}

const SIGNALS: Record<string, SignalDefinition> = {
  jkse_pullback: {
    label: "JKSE 1M pullback",
    source: "^JKSE",
    description: "Triggered when the Jakarta Composite falls at least 5% over 20 sessions.",
    warmup: 20,
    test: (values, index) => trailingReturn(values, index, 20) <= -0.05,
  },
  jkse_trend_reclaim: {
    label: "JKSE reclaims 200D trend",
    source: "^JKSE",
    description: "Triggered when the Jakarta Composite crosses back above its 200-session moving average.",
    warmup: 200,
    test: (values, index) => values[index] > sma(values, index, 200),
  },
  dxy_surge: {
    label: "DXY 1M surge",
    source: "DX-Y.NYB",
    description: "Triggered when the US Dollar Index gains at least 2.5% over 20 sessions.",
    warmup: 20,
    test: (values, index) => trailingReturn(values, index, 20) >= 0.025,
  },
  oil_rally: {
    label: "WTI 1M rally",
    source: "CL=F",
    description: "Triggered when WTI crude gains at least 8% over 20 sessions.",
    warmup: 20,
    test: (values, index) => trailingReturn(values, index, 20) >= 0.08,
  },
  dxy_selloff: {
    label: "DXY 1M selloff",
    source: "DX-Y.NYB",
    description: "Triggered when the US Dollar Index falls at least 2.5% over 20 sessions.",
    warmup: 20,
    test: (values, index) => trailingReturn(values, index, 20) <= -0.025,
  },
  oil_selloff: {
    label: "WTI 1M selloff",
    source: "CL=F",
    description: "Triggered when WTI crude falls at least 8% over 20 sessions.",
    warmup: 20,
    test: (values, index) => trailingReturn(values, index, 20) <= -0.08,
  },
};

async function fetchChart(symbol: string): Promise<Point[]> {
  const encoded = encodeURIComponent(symbol);
  const path = `/v8/finance/chart/${encoded}?range=20y&interval=1d&events=div%2Csplits`;
  let lastError = "Yahoo Finance request failed";

  for (const host of ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"]) {
    try {
      const response = await fetch(host + path, {
        headers: { accept: "application/json", "user-agent": "Mozilla/5.0 Jarvis-Research-Terminal" },
        signal: AbortSignal.timeout(9000),
        next: { revalidate: 3600 },
      });
      if (!response.ok) {
        lastError = `${symbol} returned ${response.status}`;
        continue;
      }
      const payload = await response.json() as { chart?: { result?: ChartResult[] | null; error?: { description?: string } | null } };
      const result = payload.chart?.result?.[0];
      if (!result) {
        lastError = payload.chart?.error?.description ?? `${symbol} returned no history`;
        continue;
      }
      const timestamps = result.timestamp ?? [];
      const adjusted = result.indicators.adjclose?.[0]?.adjclose;
      const closes = adjusted?.length === timestamps.length ? adjusted : result.indicators.quote[0]?.close ?? [];
      const points = timestamps.flatMap((timestamp, index) => {
        const value = closes[index];
        return typeof value === "number" && Number.isFinite(value)
          ? [{ date: new Date(timestamp * 1000).toISOString().slice(0, 10), value }]
          : [];
      });
      if (points.length >= 260) return points;
      lastError = `${symbol} returned insufficient history`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
    }
  }
  throw new Error(lastError);
}

function percentile(values: number[], fraction: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function stats(values: number[]) {
  if (!values.length) return { observations: 0, mean: null, median: null, winRate: null, p25: null, p75: null };
  return {
    observations: values.length,
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    median: percentile(values, 0.5),
    winRate: values.filter((value) => value > 0).length / values.length,
    p25: percentile(values, 0.25),
    p75: percentile(values, 0.75),
  };
}

export async function GET(request: NextRequest) {
  const signalKey = request.nextUrl.searchParams.get("signal") ?? "jkse_pullback";
  const targetKey = request.nextUrl.searchParams.get("target") ?? "JKSE";
  const signal = SIGNALS[signalKey];
  const target = TARGETS[targetKey];

  if (!signal || !target) {
    return NextResponse.json({ status: "error", error: "Unknown signal or target." }, { status: 400 });
  }

  try {
    const symbols = [...new Set([signal.source, target.symbol])];
    const histories = await Promise.all(symbols.map(fetchChart));
    const bySymbol = new Map(symbols.map((symbol, index) => [symbol, histories[index]]));
    const source = bySymbol.get(signal.source)!;
    const targetHistory = bySymbol.get(target.symbol)!;
    const targetDates = targetHistory.map((point) => point.date);
    const sourceValues = source.map((point) => point.value);
    const eventIndexes: number[] = [];
    let previousActive = false;
    let lastTargetIndex = -100;

    for (let index = signal.warmup; index < source.length; index += 1) {
      const active = signal.test(sourceValues, index);
      if (active && !previousActive) {
        const date = source[index].date;
        const targetIndex = targetDates.findIndex((targetDate) => targetDate >= date);
        if (targetIndex >= 0 && targetIndex - lastTargetIndex >= 20 && targetIndex + 60 < targetHistory.length) {
          eventIndexes.push(targetIndex);
          lastTargetIndex = targetIndex;
        }
      }
      previousActive = active;
    }

    const horizons = [5, 20, 60];
    const results = horizons.map((horizon) => {
      const eventReturns = eventIndexes
        .filter((index) => index + horizon < targetHistory.length)
        .map((index) => targetHistory[index + horizon].value / targetHistory[index].value - 1);
      const baselineReturns = targetHistory.flatMap((point, index) =>
        index >= 200 && index + horizon < targetHistory.length
          ? [targetHistory[index + horizon].value / point.value - 1]
          : []
      );
      return {
        horizon,
        signal: stats(eventReturns),
        baseline: stats(baselineReturns),
        edgeMedian: eventReturns.length ? (percentile(eventReturns, 0.5) ?? 0) - (percentile(baselineReturns, 0.5) ?? 0) : null,
      };
    });

    const events = eventIndexes.slice(-8).reverse().map((index) => {
      const start = targetHistory[index].value;
      const path = targetHistory.slice(index + 1, index + 61).map((point) => point.value / start - 1);
      return {
        date: targetHistory[index].date,
        return5: path[4] ?? null,
        return20: path[19] ?? null,
        return60: path[59] ?? null,
        maxDrawdown60: path.length ? Math.min(...path) : null,
      };
    });
    const allDrawdowns = eventIndexes.flatMap((index) => {
      const start = targetHistory[index].value;
      const path = targetHistory.slice(index + 1, index + 61).map((point) => point.value / start - 1);
      return path.length ? [Math.min(...path)] : [];
    });
    const historyFrom = source[0].date > targetHistory[0].date ? source[0].date : targetHistory[0].date;
    const historyThrough = source.at(-1)!.date < targetHistory.at(-1)!.date ? source.at(-1)!.date : targetHistory.at(-1)!.date;
    const historyYears = Math.max(0.1, Math.round(((Date.parse(historyThrough) - Date.parse(historyFrom)) / 31_557_600_000) * 10) / 10);
    const currentActive = signal.test(sourceValues, sourceValues.length - 1);
    const latestSignalDate = eventIndexes.length ? targetHistory[eventIndexes.at(-1)!].date : null;
    const completedSamples = results.find((result) => result.horizon === 60)?.signal.observations ?? 0;

    return NextResponse.json({
      status: "live",
      signal: { key: signalKey, label: signal.label, description: signal.description, source: signal.source },
      target: { key: targetKey, ...target },
      currentActive,
      latestSignalDate,
      history: { from: historyFrom, through: historyThrough, years: historyYears },
      results,
      events,
      worstDrawdown60: allDrawdowns.length ? Math.min(...allDrawdowns) : null,
      integrity: {
        completedSamples,
        minimumVisible: 15,
        minimumRecommended: 30,
        rating: completedSamples >= 30 ? "STANDARD" : completedSamples >= 15 ? "LIMITED" : "HIDDEN",
        note: "Signals are evaluated at the close, episodes are separated by at least 20 sessions, and forward returns use adjusted prices. Results exclude incomplete 60-session windows.",
      },
      freshness: new Date().toISOString(),
    }, { headers: { "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400" } });
  } catch (error) {
    return NextResponse.json({
      status: "unavailable",
      error: error instanceof Error ? error.message : "Historical market data unavailable",
    }, { status: 502, headers: { "cache-control": "no-store" } });
  }
}
