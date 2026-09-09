import { NextResponse } from "next/server";

type Topic = "IDX" | "MACRO" | "COMMODITIES";
type Article = {
  id: string; topic: Topic; title: string; url: string; source: string;
  country: string | null; publishedAt: string | null; impact: "HIGH" | "MEDIUM" | "LOW";
  tone: "POSITIVE" | "RISK" | "MIXED";
};

const GOOGLE_TOPICS: Array<{ topic: Topic; query: string }> = [
  { topic: "IDX", query: '(IHSG OR BEI OR saham OR emiten OR "Bursa Efek Indonesia") when:3d' },
  { topic: "MACRO", query: '("Bank Indonesia" OR rupiah OR "inflasi Indonesia" OR "suku bunga" OR APBN) when:3d' },
  { topic: "COMMODITIES", query: '(batubara OR nikel OR CPO OR tembaga OR emas OR minyak) Indonesia when:3d' },
];
const GDELT_FALLBACK: Array<{ topic: Topic; query: string }> = [
  { topic: "IDX", query: '(Indonesia OR Jakarta) (IHSG OR IDX OR BEI OR saham OR emiten)' },
  { topic: "MACRO", query: '("Bank Indonesia" OR rupiah OR Indonesia inflation OR interest rates)' },
  { topic: "COMMODITIES", query: '(coal OR nickel OR copper OR gold OR "palm oil" OR crude oil) (Indonesia OR Asia)' },
];

const highImpact = ["bank indonesia","federal reserve","rate cut","rate hike","suku bunga","inflasi","export ban","larangan ekspor","tariff","sanction","production cut","earnings","laba","dividend","dividen","acquisition","akuisisi","merger","default","guidance","rights issue"];
const positiveWords = ["rises","gains","growth","surplus","upgrade","record","beats","expands","naik","menguat","tumbuh","melonjak","untung","laba","dividen"];
const negativeWords = ["falls","drops","loss","deficit","downgrade","misses","sanction","default","slump","turun","melemah","rugi","anjlok","tekanan"];

function labelImpact(title: string): Article["impact"] {
  const hits = highImpact.filter((word) => title.toLowerCase().includes(word)).length;
  return hits >= 2 ? "HIGH" : hits === 1 ? "MEDIUM" : "LOW";
}
function labelTone(title: string): Article["tone"] {
  const lower = title.toLowerCase();
  const positive = positiveWords.filter((word) => lower.includes(word)).length;
  const negative = negativeWords.filter((word) => lower.includes(word)).length;
  return positive > negative ? "POSITIVE" : negative > positive ? "RISK" : "MIXED";
}
function decodeXml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
}
function tag(item: string, name: string) {
  const match = item.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"));
  return match ? decodeXml(match[1]) : "";
}
function safeDate(value?: string) {
  if (!value) return null;
  if (/^\d{14}$/.test(value)) return `${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}T${value.slice(8,10)}:${value.slice(10,12)}:${value.slice(12,14)}Z`;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
function cleanGoogleTitle(title: string, source: string) {
  const suffix = source ? new RegExp(`\\s+-\\s+${source.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\s*$`, "i") : null;
  return suffix ? title.replace(suffix, "").trim() : title.trim();
}

async function fetchGoogleNews(topic: Topic, query: string): Promise<Article[]> {
  const params = new URLSearchParams({ q: query, hl: "id", gl: "ID", ceid: "ID:id" });
  const response = await fetch(`https://news.google.com/rss/search?${params}`, {
    headers: { accept: "application/rss+xml, application/xml, text/xml", "user-agent": "Jarvis Research Terminal/1.0" },
    next: { revalidate: 600 },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`Google News ${topic} returned ${response.status}`);
  const xml = await response.text();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].flatMap((match, index) => {
    const block = match[1];
    const source = tag(block, "source") || "Google News";
    const rawTitle = tag(block, "title");
    const title = cleanGoogleTitle(rawTitle, source);
    const url = tag(block, "link");
    if (!title || !/^https?:\/\//.test(url)) return [];
    return [{
      id: `google-${topic}-${index}-${tag(block, "guid") || url}`,
      topic, title, url, source, country: source.toLowerCase().includes("indonesia") ? "Indonesia" : null,
      publishedAt: safeDate(tag(block, "pubDate")),
      impact: labelImpact(title), tone: labelTone(title),
    }];
  });
}

async function fetchGdelt(topic: Topic, query: string): Promise<Article[]> {
  const params = new URLSearchParams({ query, mode: "artlist", format: "json", maxrecords: "20", timespan: "72h", sort: "datedesc" });
  const response = await fetch(`https://api.gdeltproject.org/api/v2/doc/doc?${params}`, {
    headers: { accept: "application/json", "user-agent": "Jarvis Research Terminal/1.0" },
    next: { revalidate: 900 }, signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`GDELT ${topic} returned ${response.status}`);
  const payload: any = await response.json();
  return (payload?.articles ?? []).flatMap((item: any, index: number) => {
    if (!item?.title || !/^https?:\/\//.test(item?.url ?? "")) return [];
    return [{ id: `gdelt-${topic}-${index}-${item.url}`, topic, title: String(item.title).trim(), url: item.url,
      source: item.domain ?? new URL(item.url).hostname.replace(/^www\./, ""), country: item.sourcecountry ?? null,
      publishedAt: safeDate(item.seendate), impact: labelImpact(item.title), tone: labelTone(item.title) }];
  });
}

export async function GET() {
  const primary = await Promise.allSettled(GOOGLE_TOPICS.map(({ topic, query }) => fetchGoogleNews(topic, query)));
  const primaryArticles = primary.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  const fallback = primaryArticles.length < 12
    ? await Promise.allSettled(GDELT_FALLBACK.map(({ topic, query }) => fetchGdelt(topic, query)))
    : [];
  const failures = [
    ...primary.flatMap((result, index) => result.status === "rejected" ? [`Google News ${GOOGLE_TOPICS[index].topic}`] : []),
    ...fallback.flatMap((result, index) => result.status === "rejected" ? [`GDELT ${GDELT_FALLBACK[index].topic}`] : []),
  ];

  const seen = new Set<string>();
  const articles = [...primaryArticles, ...fallback.flatMap((result) => result.status === "fulfilled" ? result.value : [])]
    .filter((article) => {
      const key = article.title.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 90);
      if (!key || seen.has(key)) return false;
      seen.add(key); return true;
    })
    .sort((a, b) => String(b.publishedAt ?? "").localeCompare(String(a.publishedAt ?? "")))
    .slice(0, 80);

  return NextResponse.json({
    status: articles.length ? (failures.length ? "partial" : "live") : "unavailable",
    source: fallback.length ? "Google News RSS + GDELT fallback" : "Google News RSS",
    generatedAt: new Date().toISOString(), articles, failures,
    methodology: "Freshness-first Indonesian market coverage. Impact and tone are transparent title-keyword labels, not predictions.",
  }, {
    status: articles.length ? 200 : 503,
    headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=1800" },
  });
}
