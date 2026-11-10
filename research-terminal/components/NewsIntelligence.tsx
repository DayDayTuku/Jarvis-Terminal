"use client";

import { useEffect, useMemo, useState } from "react";
import { trackEvent } from "../lib/analytics-client";

type Topic = "ALL" | "IDX" | "MACRO" | "COMMODITIES";
type Article = {
  id: string;
  topic: Exclude<Topic, "ALL">;
  title: string;
  url: string;
  source: string;
  country: string | null;
  publishedAt: string | null;
  impact: "HIGH" | "MEDIUM" | "LOW";
  tone: "POSITIVE" | "RISK" | "MIXED";
};
type NewsPayload = {
  status: string;
  source: string;
  generatedAt: string;
  articles: Article[];
  failures?: string[];
  methodology: string;
};

const topics: Topic[] = ["ALL", "IDX", "MACRO", "COMMODITIES"];
const colors = { HIGH: "var(--negative)", MEDIUM: "var(--orange)", LOW: "var(--muted)" };
const toneColors = { POSITIVE: "var(--positive)", RISK: "var(--negative)", MIXED: "var(--blue)" };
const SAVED_KEY = "jarvis_saved_news";

function relativeTime(value: string | null) {
  if (!value) return "TIME UNAVAILABLE";
  const age = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(age)) return "TIME UNAVAILABLE";
  const hours = Math.max(0, Math.floor(age / 3600000));
  if (hours < 1) return "< 1H AGO";
  if (hours < 24) return `${hours}H AGO`;
  return `${Math.floor(hours / 24)}D AGO`;
}

export default function NewsIntelligence() {
  const [data, setData] = useState<NewsPayload | null>(null);
  const [topic, setTopic] = useState<Topic>("ALL");
  const [query, setQuery] = useState("");
  const [savedOnly, setSavedOnly] = useState(false);
  const [saved, setSaved] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(SAVED_KEY) || "[]");
      if (Array.isArray(stored)) setSaved(stored.filter((item): item is string => typeof item === "string").slice(0, 200));
    } catch {}
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetch("/api/news", { signal: controller.signal })
      .then(async (response) => {
        const payload = (await response.json()) as NewsPayload;
        if (!response.ok && !payload?.articles?.length) throw new Error("News feed unavailable");
        return payload;
      })
      .then((payload) => setData(payload))
      .catch((reason) => {
        if (reason?.name !== "AbortError") setError("News feed is temporarily unavailable.");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [refreshKey]);

  const articles = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return (data?.articles ?? []).filter((article) => {
      if (topic !== "ALL" && article.topic !== topic) return false;
      if (savedOnly && !saved.includes(article.id)) return false;
      if (!normalized) return true;
      return `${article.title} ${article.source} ${article.country ?? ""}`.toLowerCase().includes(normalized);
    });
  }, [data, topic, query, savedOnly, saved]);
  const highImpactCount = articles.filter((article) => article.impact === "HIGH").length;
  const riskCount = articles.filter((article) => article.tone === "RISK").length;

  const toggleSaved = (article: Article) => {
    const isSaved = saved.includes(article.id);
    const next = isSaved ? saved.filter((id) => id !== article.id) : [...saved, article.id].slice(-200);
    setSaved(next);
    try { localStorage.setItem(SAVED_KEY, JSON.stringify(next)); } catch {}
    if (!isSaved) trackEvent("news_save", { topic: article.topic, impact: article.impact });
  };

  return (
    <section style={{ display: "grid", gap: 12 }}>
      <div className="news-stats" style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", border: "1px solid var(--line-strong)", background: "var(--panel)" }}>
        {[
          ["MATCHED STORIES", articles.length, "var(--text)"],
          ["HIGH IMPACT", highImpactCount, "var(--negative)"],
          ["RISK-TONED", riskCount, "var(--orange)"],
        ].map(([label, value, color]) => (
          <div key={String(label)} style={{ padding: "13px 15px", borderRight: "1px solid var(--line)", minWidth: 0 }}>
            <span style={{ color: "var(--muted)", fontSize: 8, letterSpacing: ".08em" }}>{label}</span>
            <strong style={{ display: "block", marginTop: 5, color: String(color), fontSize: 21 }}>{value}</strong>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "11px 13px", border: "1px solid var(--line-strong)", borderRadius: 3, background: "var(--panel-raised)", flexWrap: "wrap" }}>
        <div>
          <strong style={{ display: "block", color: "var(--blue)", fontSize: 9, letterSpacing: ".08em" }}>INDONESIA MARKET NEWS</strong>
          <span style={{ display: "block", marginTop: 4, color: "var(--muted)", fontSize: 8 }}>Fresh IDX, macro, and commodity coverage from multiple Indonesian publishers.</span>
        </div>
        <div style={{ display: "flex", gap: 7, alignItems: "center", color: "var(--muted)", fontSize: 7 }}>
          <span>{saved.length} SAVED</span><span>·</span><span>72H WINDOW</span>
        </div>
      </div>

      <article className="panel">
        <div className="news-toolbar">
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {topics.map((item) => (
              <button key={item} type="button" onClick={() => setTopic(item)} className={topic === item ? "active" : ""} style={{ border: topic === item ? "1px solid var(--blue)" : "1px solid var(--line-strong)", background: topic === item ? "var(--panel-raised)" : "var(--panel)", color: topic === item ? "var(--blue)" : "var(--muted)", padding: "7px 9px", cursor: "pointer", fontSize: 8, letterSpacing: ".06em" }}>
                {item}
              </button>
            ))}
          </div>
          <input
            className="news-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter headlines, sources..."
            aria-label="Search news headlines"
          />
          <button type="button" onClick={() => setSavedOnly((value) => !value)} className={savedOnly ? "active" : ""} style={{ border: savedOnly ? "1px solid var(--orange)" : "1px solid var(--line-strong)", background: savedOnly ? "var(--panel-raised)" : "var(--panel)", color: savedOnly ? "var(--orange)" : "var(--muted)", padding: "7px 9px", cursor: "pointer", fontSize: 8 }}>
            ★ SAVED {saved.length}
          </button>
          <button type="button" onClick={() => setRefreshKey((value) => value + 1)} style={{ border: 0, background: "transparent", color: "var(--muted)", cursor: "pointer", fontSize: 8 }}>
            ↻ REFRESH
          </button>
        </div>

        {loading ? (
          <div style={{ minHeight: 300, display: "grid", placeContent: "center", color: "var(--muted)", fontSize: 10 }}>FETCHING INDONESIAN MARKET COVERAGE…</div>
        ) : error ? (
          <div style={{ minHeight: 300, display: "grid", placeContent: "center", textAlign: "center", color: "var(--negative)", fontSize: 10 }}>{error}</div>
        ) : articles.length ? (
          <div>
            {articles.map((article) => (
              <div className="news-item" key={article.id}>
                <a href={article.url} target="_blank" rel="noopener noreferrer" className="news-row">
                  <div>
                    <strong style={{ display: "block", color: colors[article.impact], fontSize: 8 }}>{article.impact} IMPACT</strong>
                    <span style={{ display: "block", marginTop: 5, color: toneColors[article.tone], fontSize: 7 }}>{article.tone}</span>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ display: "block", color: "var(--text)", font: "600 12px/1.45 var(--font-geist-sans)", overflowWrap: "anywhere" }}>{article.title}</strong>
                    <span style={{ display: "block", marginTop: 6, color: "var(--muted)", fontSize: 8 }}>{article.source.toUpperCase()}{article.country ? ` · ${article.country.toUpperCase()}` : ""} · {relativeTime(article.publishedAt)}</span>
                  </div>
                  <span style={{ color: "var(--blue)", fontSize: 13 }}>↗</span>
                </a>
                <button
                  type="button"
                  className={`news-save ${saved.includes(article.id) ? "saved" : ""}`}
                  onClick={() => toggleSaved(article)}
                  aria-label={saved.includes(article.id) ? `Unsave ${article.title}` : `Save ${article.title}`}
                  aria-pressed={saved.includes(article.id)}
                >
                  {saved.includes(article.id) ? "★" : "☆"}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ minHeight: 300, display: "grid", placeContent: "center", color: "var(--muted)", fontSize: 10 }}>
            {savedOnly ? "NO SAVED STORIES MATCH THESE FILTERS" : "NO MATCHING STORIES IN THE LAST 72 HOURS"}
          </div>
        )}

        <footer style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "9px 12px", color: "var(--muted)", fontSize: 7, lineHeight: 1.5 }}>
          <span>{data?.source ?? "MULTI-PUBLISHER RSS"} · 72H WINDOW</span>
          <span style={{ textAlign: "right" }}>LABELS USE TITLE KEYWORDS · OPEN SOURCE TO VERIFY</span>
        </footer>
      </article>
    </section>
  );
}
