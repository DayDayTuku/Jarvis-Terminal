import { NextResponse } from "next/server";

type Topic = "IDX" | "MACRO" | "COMMODITIES";
type GdeltArticle = {
  url?: string;
  title?: string;
  seendate?: string;
  domain?: string;
  sourcecountry?: string;
  language?: string;
  socialimage?: string;
};

const TOPICS: Array<{ topic: Topic; query: string }> = [
  {
    topic: "IDX",
    query: 'domainis:idx.co.id',
  },
  {
    topic: "IDX",
    query: '(Indonesia OR Jakarta) (IHSG OR IDX OR BEI OR "Indonesia Stock Exchange" OR rupiah OR saham OR emiten)',
  },
  {
    topic: "MACRO",
    query: '("Bank Indonesia" OR rupiah OR Indonesia inflation OR "Federal Reserve" OR interest rates)',
  },
  {
    topic: "COMMODITIES",
    query: '(coal OR nickel OR copper OR gold OR "palm oil" OR crude oil) (Indonesia OR Asia)',
  },
];

const highImpact = [
  "bank indonesia", "federal reserve", "rate cut", "rate hike", "inflation",
  "export ban", "tariff", "sanction", "production cut", "earnings", "dividend",
  "acquisition", "merger", "default", "guidance",
];
const positiveWords = ["rises", "gains", "growth", "surplus", "upgrade", "record", "beats", "expands", "cut rates"];
const negativeWords = ["falls", "drops", "loss", "deficit", "downgrade", "misses", "sanction", "default", "slump", "hike rates"];

function impact(title: string) {
  const lower = title.toLowerCase();
  const hits = highImpact.filter((word) => lower.includes(word)).length;
  return hits >= 2 ? "HIGH" : hits === 1 ? "MEDIUM" : "LOW";
}

function tone(title: string) {
  const lower = title.toLowerCase();
  const positive = positiveWords.filter((word) => lower.includes(word)).length;
  const negative = negativeWords.filter((word) => lower.includes(word)).length;
  if (positive > negative) return "POSITIVE";
  if (negative > positive) return "RISK";
  return "MIXED";
}

function safeDate(value?: string) {
  if (!value) return null;
  if (/^\d{14}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12, 14)}Z`;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

async function fetchTopic(topic: Topic, query: string) {
  const params = new URLSearchParams({
    query,
    mode: "artlist",
    format: "json",
    maxrecords: "30",
    timespan: "48h",
    sort: "datedesc",
  });
  const response = await fetch(`https://api.gdeltproject.org/api/v2/doc/doc?${params}`, {
    headers: { accept: "application/json", "user-agent": "Jarvis Research Terminal" },
    next: { revalidate: 600 },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`${topic} returned ${response.status}`);
  const payload = (await response.json()) as { articles?: GdeltArticle[] };
  return (payload.articles ?? []).flatMap((article) => {
    if (!article.url || !article.title || !/^https?:\/\//.test(article.url)) return [];
    return [{
      id: `${topic}-${article.url}`,
      topic,
      title: article.title.trim(),
      url: article.url,
      source: article.domain ?? new URL(article.url).hostname.replace(/^www\./, ""),
      country: article.sourcecountry ?? null,
      publishedAt: safeDate(article.seendate),
      image: article.socialimage && /^https?:\/\//.test(article.socialimage) ? article.socialimage : null,
      impact: impact(article.title),
      tone: tone(article.title),
    }];
  });
}

export async function GET() {
  const settled = await Promise.allSettled(
    TOPICS.map(({ topic, query }) => fetchTopic(topic, query))
  );
  const failures = settled.flatMap((result, index) =>
    result.status === "rejected" ? [TOPICS[index].topic] : []
  );
  const seen = new Set<string>();
  const articles = settled
    .flatMap((result) => result.status === "fulfilled" ? result.value : [])
    .filter((article) => {
      const key = article.url.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const impactRank: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
      const impactDiff = impactRank[a.impact] - impactRank[b.impact];
      if (impactDiff) return impactDiff;
      return String(b.publishedAt ?? "").localeCompare(String(a.publishedAt ?? ""));
    })
    .slice(0, 60);

  return NextResponse.json(
    {
      status: articles.length ? (failures.length ? "partial" : "live") : "unavailable",
      source: "GDELT DOC 2.0",
      generatedAt: new Date().toISOString(),
      articles,
      failures,
      methodology: "Impact and tone labels are transparent title-keyword heuristics, not sentiment predictions.",
    },
    {
      status: articles.length ? 200 : 503,
      headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=1800" },
    }
  );
}
