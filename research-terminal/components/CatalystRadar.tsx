"use client";

import { useEffect, useMemo, useState } from "react";
import { IDX_UNIVERSE } from "@/lib/idx-universe";

type Article = {
  id: string;
  topic?: "IDX" | "MACRO" | "COMMODITIES";
  catalyst?: string;
  title: string;
  url: string;
  source: string;
  country: string | null;
  publishedAt: string | null;
  impact: "HIGH" | "MEDIUM" | "LOW";
  tone: "POSITIVE" | "RISK" | "MIXED";
};
type NewsPayload = { status: string; articles: Article[]; generatedAt: string; methodology: string };

const catalystTypes = [
  { label: "EARNINGS", words: ["earnings", "profit", "revenue", "laba", "pendapatan", "rugi", "guidance"] },
  { label: "DIVIDEND", words: ["dividend", "dividen", "cum date", "ex date", "payout"] },
  { label: "CAPITAL ACTION", words: ["rights issue", "private placement", "buyback", "stock split", "dilution", "dilusi"] },
  { label: "M&A", words: ["acquisition", "akuisisi", "merger", "divestment"] },
  { label: "GOVERNANCE", words: ["rups", "director", "commissioner", "direktur", "komisaris"] },
  { label: "OPERATIONS", words: ["contract", "project", "expansion", "ekspansi", "production", "produksi", "capex"] },
] as const;

function catalystType(title: string) {
  const lower = title.toLowerCase();
  return catalystTypes.find((group) => group.words.some((word) => lower.includes(word)))?.label ?? "OTHER";
}
function relative(value: string | null) {
  if (!value) return "TIME N/A";
  const age = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(age)) return "TIME N/A";
  const hours = Math.max(0, Math.floor(age / 3600000));
  return hours < 1 ? "<1H" : hours < 24 ? `${hours}H` : `${Math.floor(hours / 24)}D`;
}

export default function CatalystRadar() {
  const [data, setData] = useState<NewsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tickers, setTickers] = useState<string[]>(["BUMI", "AMMN", "ADRO"]);
  const [input, setInput] = useState("");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("jarvis_watchlist") ?? "[]") as Array<{ ticker?: string }>;
      const saved = stored.map((item) => String(item.ticker ?? "").replace(".JK", "").toUpperCase()).filter(Boolean);
      if (saved.length) setTickers([...new Set(saved)].slice(0, 8));
    } catch {}
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetch("/api/catalysts", { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as NewsPayload;
        if (!response.ok && !payload?.articles?.length) throw new Error("Catalyst feed unavailable.");
        return payload;
      })
      .then(setData)
      .catch((reason) => { if (reason?.name !== "AbortError") setError("Catalyst feed is temporarily unavailable."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refresh]);

  const tracked = useMemo(() => tickers.flatMap((ticker) => {
    const stock = IDX_UNIVERSE.find((item) => item.ticker === `${ticker}.JK`);
    return stock ? [{ ...stock, shortTicker: ticker }] : [];
  }), [tickers]);

  const catalysts = useMemo(() => {
    const idxArticles = data?.articles.filter((article) => catalystType(article.title) !== "OTHER") ?? [];
    return idxArticles.map((article) => {
      const lower = article.title.toLowerCase();
      const matches = tracked.filter((stock) => {
        const tokens = stock.name.toLowerCase().split(/\s+/).filter((token) => token.length >= 5);
        return new RegExp(`\\b${stock.shortTicker.toLowerCase()}\\b`).test(lower) || tokens.some((token) => lower.includes(token));
      }).map((stock) => stock.shortTicker);
      return { ...article, catalyst: article.catalyst ?? catalystType(article.title), matches };
    }).sort((a, b) => Number(Boolean(b.matches.length)) - Number(Boolean(a.matches.length)) || String(b.publishedAt ?? "").localeCompare(String(a.publishedAt ?? ""))).slice(0, 30);
  }, [data, tracked]);

  const matched = catalysts.filter((article) => article.matches.length);
  const visible = matched.length ? catalysts.filter((article) => article.matches.length) : catalysts.slice(0, 12);
  const addTicker = () => {
    const clean = input.replace(".JK", "").trim().toUpperCase();
    if (!IDX_UNIVERSE.some((stock) => stock.ticker === `${clean}.JK`)) { setError("Ticker belum ada di IDX universe."); return; }
    setTickers((current) => [...new Set([...current, clean])].slice(0, 8));
    setInput("");
    setError("");
  };

  return (
    <section className="catalyst-radar">
      <div className="suite-head catalyst-title">
        <div><span>CATALYST RADAR · BETA</span><h3>Turn headlines into a watchlist trigger map.</h3><p>Issuer matching happens locally—your tracked tickers are never sent to the news provider.</p></div>
        <button onClick={() => setRefresh((value) => value + 1)}>↻ REFRESH</button>
      </div>

      <div className="catalyst-controls">
        <div className="tracked-tickers">
          <span>TRACKED</span>
          {tickers.map((ticker) => <button key={ticker} onClick={() => setTickers((current) => current.filter((item) => item !== ticker))}>{ticker} ×</button>)}
        </div>
        <div className="ticker-adder">
          <input list="catalyst-idx-tickers" value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") addTicker(); }} placeholder="ADD TICKER" />
          <button onClick={addTicker}>ADD</button>
          <datalist id="catalyst-idx-tickers">{IDX_UNIVERSE.map((stock) => <option key={stock.ticker} value={stock.ticker.replace(".JK", "")}>{stock.name}</option>)}</datalist>
        </div>
      </div>

      <div className="catalyst-stats">
        <div><span>WATCHLIST MATCHES</span><strong>{matched.length}</strong></div>
        <div><span>HIGH IMPACT</span><strong>{visible.filter((item) => item.impact === "HIGH").length}</strong></div>
        <div><span>COVERAGE</span><strong>{tracked.length} ISSUERS</strong></div>
        <div><span>WINDOW</span><strong>7 DAYS</strong></div>
      </div>

      {loading ? <div className="replay-state">SCANNING IDX CORPORATE CATALYSTS…</div>
        : error && !data ? <div className="replay-state error">{error}</div>
        : visible.length ? <article className="panel catalyst-feed">
          {!matched.length && <div className="catalyst-notice">NO DIRECT WATCHLIST MATCHES · SHOWING MARKET-WIDE IDX CATALYSTS</div>}
          {visible.map((article) => <a key={article.id} href={article.url} target="_blank" rel="noopener noreferrer" className="catalyst-row">
            <div><strong className={article.impact.toLowerCase()}>{article.impact}</strong><span>{article.catalyst}</span></div>
            <div><h4>{article.title}</h4><p>{article.matches.length ? article.matches.join(" · ") : "IDX MARKET"} · {article.source.toUpperCase()} · {relative(article.publishedAt)} AGO</p></div>
            <b>↗</b>
          </a>)}
          <div className="suite-method">Evidence radar from a broad GDELT Indonesian corporate query; official IDX sources are linked below. Classification uses transparent title keywords. This is not a complete forward corporate-action calendar; verify dates and terms at the primary source.</div>
        </article> : <div className="replay-state">NO CORPORATE CATALYST STORIES MATCHED IN THE CURRENT WINDOW</div>}

      <div className="official-catalyst-links">
        <span>PRIMARY SOURCES</span>
        <a href="https://www.idx.co.id/id/berita/pengumuman/" target="_blank" rel="noopener noreferrer">IDX ANNOUNCEMENTS ↗</a>
        <a href="https://www.idx.co.id/id/perusahaan-tercatat/keterbukaan-informasi/" target="_blank" rel="noopener noreferrer">DISCLOSURES ↗</a>
      </div>
    </section>
  );
}
