import { NextResponse } from "next/server";

type GdeltArticle = { url?: string; title?: string; seendate?: string; domain?: string; sourcecountry?: string };

const TYPES = [
  { type: "EARNINGS", words: ["earnings", "profit", "revenue", "laba", "pendapatan", "rugi", "guidance"] },
  { type: "DIVIDEND", words: ["dividend", "dividen", "cum date", "ex date", "payout"] },
  { type: "CAPITAL ACTION", words: ["rights issue", "private placement", "buyback", "stock split", "dilution", "dilusi"] },
  { type: "M&A", words: ["acquisition", "akuisisi", "merger", "divestment"] },
  { type: "GOVERNANCE", words: ["rups", "director", "commissioner", "direktur", "komisaris"] },
  { type: "OPERATIONS", words: ["contract", "project", "expansion", "ekspansi", "production", "produksi", "capex"] },
] as const;

function parsedDate(value?: string) {
  if (!value) return null;
  if (/^\d{14}$/.test(value)) return `${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}T${value.slice(8,10)}:${value.slice(10,12)}:${value.slice(12,14)}Z`;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
function catalystType(title: string) {
  const lower = title.toLowerCase();
  return TYPES.find((item) => item.words.some((word) => lower.includes(word)))?.type ?? "OTHER";
}
function tone(title: string) {
  const lower = title.toLowerCase();
  const risks = ["loss", "rugi", "default", "lawsuit", "investigation", "downgrade", "dilution", "decline", "turun"].filter((word) => lower.includes(word)).length;
  const positives = ["record", "growth", "profit", "laba", "upgrade", "expansion", "buyback", "dividend", "dividen"].filter((word) => lower.includes(word)).length;
  return risks > positives ? "RISK" : positives > risks ? "POSITIVE" : "MIXED";
}
function impact(type: string, title: string) {
  const lower = title.toLowerCase();
  return ["EARNINGS", "DIVIDEND", "CAPITAL ACTION", "M&A"].includes(type) || ["default", "investigation", "suspension"].some((word) => lower.includes(word)) ? "HIGH" : type === "OTHER" ? "LOW" : "MEDIUM";
}
async function fetchQuery(query: string) {
  const params = new URLSearchParams({ query, mode: "artlist", format: "json", maxrecords: "75", timespan: "7d", sort: "datedesc" });
  const response = await fetch(`https://api.gdeltproject.org/api/v2/doc/doc?${params}`, {
    headers: { accept: "application/json", "user-agent": "Jarvis Research Terminal" },
    signal: AbortSignal.timeout(12000),
    next: { revalidate: 600 },
  });
  if (!response.ok) throw new Error(`GDELT returned ${response.status}`);
  const payload = await response.json() as { articles?: GdeltArticle[] };
  return payload.articles ?? [];
}

export async function GET() {
  const corporateTerms = '(earnings OR "net profit" OR laba OR pendapatan OR dividend OR dividen OR "rights issue" OR buyback OR acquisition OR akuisisi OR merger OR RUPS OR "stock split" OR contract OR ekspansi)';
  let rawArticles: GdeltArticle[] = [];
  try {
    rawArticles = await fetchQuery(`(Indonesia OR Jakarta OR IDX OR BEI) ${corporateTerms}`);
  } catch (error) {
    return NextResponse.json({
      status: "unavailable",
      source: "GDELT DOC 2.0",
      window: "7d",
      articles: [],
      failures: 1,
      error: error instanceof Error ? error.message : "Catalyst provider unavailable",
      methodology: "The server retrieves a broad Indonesian corporate-news feed without receiving or transmitting the user's watchlist.",
      generatedAt: new Date().toISOString(),
    }, { status: 503, headers: { "cache-control": "no-store" } });
  }

  const seen = new Set<string>();
  const articles = rawArticles.flatMap((article) => {
    if (!article.url || !article.title || !/^https?:\/\//.test(article.url)) return [];
    const id = article.url.toLowerCase();
    if (seen.has(id)) return [];
    seen.add(id);
    const type = catalystType(article.title);
    if (type === "OTHER") return [];
    return [{
      id,
      title: article.title.trim(),
      url: article.url,
      source: article.domain ?? new URL(article.url).hostname.replace(/^www\./, ""),
      country: article.sourcecountry ?? null,
      publishedAt: parsedDate(article.seendate),
      catalyst: type,
      impact: impact(type, article.title),
      tone: tone(article.title),
      official: (article.domain ?? "").toLowerCase().endsWith("idx.co.id"),
    }];
  }).sort((a, b) => {
    const rank: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    return rank[a.impact] - rank[b.impact] || String(b.publishedAt ?? "").localeCompare(String(a.publishedAt ?? ""));
  }).slice(0, 60);

  const failures = 0;
  return NextResponse.json({
    status: articles.length ? (failures ? "partial" : "live") : "quiet",
    source: "GDELT DOC 2.0 corporate query",
    window: "7d",
    articles,
    failures,
    methodology: "The server retrieves a broad Indonesian corporate-news feed without receiving or transmitting the user's watchlist. Issuer matching happens locally in the browser.",
    generatedAt: new Date().toISOString(),
  }, { headers: { "cache-control": "public, s-maxage=600, stale-while-revalidate=1800" } });
}
