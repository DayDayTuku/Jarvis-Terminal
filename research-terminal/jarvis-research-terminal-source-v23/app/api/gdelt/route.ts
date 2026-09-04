import { NextResponse } from "next/server";

type RawPoint = { date: string; value: number };
type TimelinePoint = RawPoint & { zScore: number | null };
const BASELINE_DAYS = 90;
const BROAD_TERMS = "(war OR sanctions OR invasion OR embargo OR tensions OR conflict)";
const NARROW_TERMS = "(sanctions OR invasion OR embargo OR tensions)";
const SEA_COUNTRIES = ["Indonesia", "Malaysia", "Singapore", "Thailand", "Vietnam", "Philippines"];

function normalizeDate(value: unknown) {
  const raw = String(value ?? "");
  if (/^\d{8}/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  return raw.slice(0, 10);
}

function dailyTimeline(payload: unknown): RawPoint[] {
  if (!payload || typeof payload !== "object") return [];
  const root = payload as { timeline?: Array<{ data?: Array<{ date?: unknown; value?: unknown }> }> };
  const buckets = new Map<string, number[]>();
  for (const point of root.timeline?.flatMap((series) => series.data ?? []) ?? []) {
    const date = normalizeDate(point.date); const value = Number(point.value);
    if (date.length !== 10 || !Number.isFinite(value)) continue;
    buckets.set(date, [...(buckets.get(date) ?? []), value]);
  }
  return [...buckets].sort(([a], [b]) => a.localeCompare(b)).map(([date, values]) => ({ date, value: values.reduce((a, b) => a + b, 0) / values.length }));
}

function withRollingZ(points: RawPoint[]): TimelinePoint[] {
  return points.map((point, index) => {
    const baseline = points.slice(Math.max(0, index - BASELINE_DAYS), index).map((item) => item.value);
    if (baseline.length < 30) return { ...point, zScore: null };
    const mean = baseline.reduce((sum, value) => sum + value, 0) / baseline.length;
    const variance = baseline.reduce((sum, value) => sum + (value - mean) ** 2, 0) / baseline.length;
    const deviation = Math.sqrt(variance);
    return { ...point, zScore: deviation ? Math.round(((point.value - mean) / deviation) * 100) / 100 : 0 };
  });
}

const pause = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function requestTimeline(query: string, start: string, end: string, timeout = 12000) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const params = new URLSearchParams({ query, mode: "timelinevol", format: "json", startdatetime: `${start.replaceAll("-", "")}000000`, enddatetime: `${end.replaceAll("-", "")}235959`, timelinesmooth: "0" });
    const response = await fetch(`https://api.gdeltproject.org/api/v2/doc/doc?${params}`, { headers: { accept: "application/json", "user-agent": "Jarvis Research Terminal" }, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const timeline = dailyTimeline(await response.json());
    if (timeline.length < 60) throw new Error(`insufficient history (${timeline.length} days)`);
    return timeline;
  } finally { clearTimeout(timer); }
}

async function queryWithFallback(primary: string, fallback: string, start: string, end: string) {
  try { return { timeline: await requestTimeline(primary, start, end), scope: "broad" as const }; }
  catch (primaryError) {
    await pause(400);
    try { return { timeline: await requestTimeline(fallback, start, end, 12000), scope: "narrow_fallback" as const }; }
    catch (fallbackError) { throw new Error(`broad: ${primaryError instanceof Error ? primaryError.message : "failed"}; fallback: ${fallbackError instanceof Error ? fallbackError.message : "failed"}`); }
  }
}

function averageTimelines(series: RawPoint[][]) {
  const dates = new Map<string, number[]>();
  for (const timeline of series) for (const point of timeline) dates.set(point.date, [...(dates.get(point.date) ?? []), point.value]);
  return [...dates].sort(([a], [b]) => a.localeCompare(b)).flatMap(([date, values]) => values.length < Math.max(2, Math.ceil(series.length / 2)) ? [] : [{ date, value: values.reduce((a, b) => a + b, 0) / values.length }]);
}

function finalize(region: string, raw: RawPoint[], scope: string, detail: string) {
  const timeline = withRollingZ(raw); const latest = [...timeline].reverse().find((point) => point.zScore !== null);
  if (!latest) throw new Error(`${region}: no normalized observations`);
  return { region, score: latest.zScore, currentFrequency: latest.value, baselineDays: BASELINE_DAYS, scope, detail, timeline };
}

async function fetchSea(start: string, end: string) {
  const settled = await Promise.allSettled(SEA_COUNTRIES.map((country) => queryWithFallback(`${BROAD_TERMS} ${country}`, `${NARROW_TERMS} ${country}`, start, end)));
  const valid = settled.flatMap((result, index) => result.status === "fulfilled" ? [{ country: SEA_COUNTRIES[index], ...result.value }] : []);
  if (valid.length < 3) throw new Error(`SEA: only ${valid.length}/6 country queries returned valid history`);
  const scope = valid.some((item) => item.scope === "narrow_fallback") ? "mixed_fallback" : "broad";
  return finalize("SEA", averageTimelines(valid.map((item) => item.timeline)), scope, `Equal-weight aggregation of ${valid.map((item) => item.country).join(", ")}`);
}

async function fetchSingle(region: "CHINA" | "US", country: string, start: string, end: string) {
  const result = await queryWithFallback(`${BROAD_TERMS} ${country}`, `${NARROW_TERMS} ${country}`, start, end);
  return finalize(region, result.timeline, result.scope, result.scope === "broad" ? "Full keyword basket" : "Narrow representative keyword basket after broad-query timeout");
}

export async function GET() {
  const end = new Date(); const start = new Date(end.getTime() - 125 * 86400000); const from = start.toISOString().slice(0, 10); const through = end.toISOString().slice(0, 10);
  const jobs = [fetchSea(from, through), fetchSingle("CHINA", "China", from, through), fetchSingle("US", '"United States"', from, through)];
  const settled = await Promise.allSettled(jobs);
  const names = ["SEA", "CHINA", "US"];
  const series = settled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  const failures = settled.flatMap((result, index) => result.status === "rejected" ? [{ region: names[index], error: result.reason instanceof Error ? result.reason.message : "request failed" }] : []);
  if (!series.length) return NextResponse.json({ status: "stale", model: "100% keyword frequency (simplified)", source: "GDELT DOC 2.0", error: failures.map((item) => `${item.region}: ${item.error}`).join("; "), failures }, { status: 503 });
  const complete = series.length === 3;
  const frequencyScore = complete ? Math.round(series.reduce((sum, item) => sum + (item.score ?? 0), 0) / series.length * 100) / 100 : null;
  const freshness = series.map((item) => item.timeline.at(-1)?.date ?? "").sort()[0] || null;
  const approximate = series.some((item) => item.scope !== "broad");
  return NextResponse.json({ status: complete ? "live" : "partial", model: "100% keyword frequency (simplified)", source: "GDELT DOC 2.0", freshness, frequencyScore, baselineDays: BASELINE_DAYS, approximate, regions: series, failures }, { headers: { "cache-control": "public, s-maxage=21600, stale-while-revalidate=86400" } });
}
