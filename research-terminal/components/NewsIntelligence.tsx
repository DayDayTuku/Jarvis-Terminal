"use client";

import { useEffect, useMemo, useState } from "react";

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
const colors = { HIGH: "#ff6678", MEDIUM: "#ffb45e", LOW: "#778596" };
const toneColors = { POSITIVE: "#43d4a3", RISK: "#ff6678", MIXED: "#48a6ff" };

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetch("/api/news", { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
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

  const articles = useMemo(
    () => data?.articles.filter((article) => topic === "ALL" || article.topic === topic) ?? [],
    [data, topic]
  );
  const highImpactCount = articles.filter((article) => article.impact === "HIGH").length;
  const riskCount = articles.filter((article) => article.tone === "RISK").length;

  return (
    <section style={{ display: "grid", gap: 12 }}>
      <div className="news-stats" style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", border: "1px solid var(--line-strong)", background: "#070a0f" }}>
        {[
          ["MATCHED STORIES", articles.length, "#e8edf3"],
          ["HIGH IMPACT", highImpactCount, "#ff6678"],
          ["RISK-TONED", riskCount, "#ffb45e"],
        ].map(([label, value, color]) => (
          <div key={String(label)} style={{ padding: "13px 15px", borderRight: "1px solid var(--line)", minWidth: 0 }}>
            <span style={{ color: "#657284", fontSize: 8, letterSpacing: ".08em" }}>{label}</span>
            <strong style={{ display: "block", marginTop: 5, color: String(color), fontSize: 21 }}>{value}</strong>
          </div>
        ))}
      </div>

      <article className="panel">
        <div style={{ minHeight: 48, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "8px 12px", borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {topics.map((item) => (
              <button key={item} type="button" onClick={() => setTopic(item)} className={topic === item ? "active" : ""} style={{ border: topic === item ? "1px solid #48a6ff" : "1px solid #253040", background: topic === item ? "#0b1926" : "#080b10", color: topic === item ? "#48a6ff" : "#778596", padding: "7px 9px", cursor: "pointer", fontSize: 8, letterSpacing: ".06em" }}>
                {item}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setRefreshKey((value) => value + 1)} style={{ border: 0, background: "transparent", color: "#778596", cursor: "pointer", fontSize: 8 }}>
            ↻ REFRESH
          </button>
        </div>

        {loading ? (
          <div style={{ minHeight: 300, display: "grid", placeContent: "center", color: "#778596", fontSize: 10 }}>SCANNING GLOBAL COVERAGE…</div>
        ) : error ? (
          <div style={{ minHeight: 300, display: "grid", placeContent: "center", textAlign: "center", color: "#ff6678", fontSize: 10 }}>{error}</div>
        ) : articles.length ? (
          <div>
            {articles.map((article) => (
              <a key={article.id} href={article.url} target="_blank" rel="noopener noreferrer" className="news-row" style={{ display: "grid", gridTemplateColumns: "86px minmax(0,1fr) auto", gap: 12, padding: "13px 14px", borderBottom: "1px solid #151d27", color: "inherit", textDecoration: "none", alignItems: "start" }}>
                <div>
                  <strong style={{ display: "block", color: colors[article.impact], fontSize: 8 }}>{article.impact} IMPACT</strong>
                  <span style={{ display: "block", marginTop: 5, color: toneColors[article.tone], fontSize: 7 }}>{article.tone}</span>
                </div>
                <div style={{ minWidth: 0 }}>
                  <strong style={{ display: "block", color: "#e8edf3", font: "600 12px/1.45 var(--font-geist-sans)", overflowWrap: "anywhere" }}>{article.title}</strong>
                  <span style={{ display: "block", marginTop: 6, color: "#657284", fontSize: 8 }}>{article.source.toUpperCase()}{article.country ? ` · ${article.country.toUpperCase()}` : ""} · {relativeTime(article.publishedAt)}</span>
                </div>
                <span style={{ color: "#48a6ff", fontSize: 13 }}>↗</span>
              </a>
            ))}
          </div>
        ) : (
          <div style={{ minHeight: 300, display: "grid", placeContent: "center", color: "#778596", fontSize: 10 }}>NO MATCHING STORIES IN THE LAST 48 HOURS</div>
        )}

        <footer style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "9px 12px", color: "#536171", fontSize: 7, lineHeight: 1.5 }}>
          <span>{data?.source ?? "GDELT DOC 2.0"} · 48H WINDOW</span>
          <span style={{ textAlign: "right" }}>LABELS USE TITLE KEYWORDS · OPEN SOURCE TO VERIFY</span>
        </footer>
      </article>
    </section>
  );
}
