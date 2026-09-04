"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Scheme = "default" | "deuteranopia" | "protanopia" | "tritanopia";
type Section =
  | "OVERVIEW"
  | "MACRO"
  | "MARKETS"
  | "GPR INDEX"
  | "GPR MAP"
  | "CORRELATIONS"
  | "SEASONALITY"
  | "MARKET PARTICIPANT";
type RegimePoint = { date: string; growth: number; inflation: number };
type FredData = {
  status: string;
  freshness: string;
  indicators: Array<{
    name: string;
    actual: number;
    mean: number;
    z: number;
    unit: string;
  }>;
  yields: Array<{ maturity: string; value: number }>;
  curveStatus?: { current: "normal" | "inverted"; previous: "normal" | "inverted"; changed: boolean; asOf: string | null };
  regime: RegimePoint[];
  regimeMethodology?: { frequency: string; normalization: string; growth: string[]; growthPending: string[]; inflation: string[] };
};
type Constituent = {
  ticker: string;
  price: number;
  daily: number | null;
  weekly: number | null;
};
type MarketData = {
  status: string;
  freshness: string;
  failures?: string[];
  watchlist: Array<{ ticker: string; price: number; change: number }>;
  heatmap: Array<{
    label: string;
    symbol: string;
    daily: number | null;
    weekly: number | null;
    constituents: Constituent[];
    method?: string;
    validCount?: number;
    memberCount?: number;
    confidence?: string;
  }>;
  assets: Array<{
    name: string;
    timestamps: number[];
    closes: Array<number | null>;
  }>;
};
type GdeltData = {
  status: string;
  model: string;
  freshness: string;
  frequencyScore: number | null;
  baselineDays: number;
  approximate?: boolean;
  regions: Array<{
    region: string;
    score: number;
    currentFrequency: number;
    baselineDays: number;
    scope?: string;
    detail?: string;
    timeline: Array<{ date: string; value: number; zScore: number | null }>;
  }>;
};
type CalendarData = {
  status: string;
  source: string;
  freshness: string;
  coverage?: string;
  bpsStatus?: string;
  events: Array<{
    date: string;
    dateOnly?: boolean;
    country: string;
    event: string;
    forecast: string;
    prior: string;
    importance: number;
  }>;
};
type SeasonalityData = {
  status: string;
  ticker: string;
  symbol: string;
  years: number;
  from: number;
  through: number;
  months: Array<{
    month: number;
    average: number;
    positiveRate: number;
    observations: number;
  }>;
};
type CotSeries = {
  key: string;
  label: string;
  groups: string[];
  latest: string;
  points: Array<{ date: string; values: Record<string, number> }>;
};
type CotData = {
  status: string;
  source: string;
  freshness: string;
  series: CotSeries[];
  failures: string[];
};
type TickerDetailData = {
  status: string; ticker: string; symbol: string; range: "1mo" | "6mo" | "1y";
  info: { name: string; currency: string; price: number | null; volume: number | null; marketCap: number | null; peRatio: number | null; high52: number | null; low52: number | null; dailyChange: number | null; weeklyChange: number | null };
  points: Array<{ date: string; close: number }>;
  news: Array<{ id: string; title: string; publisher: string; link: string; publishedAt: string | null }>;
  newsCoverage: string;
  dividends: Array<{ date: string; amount: number }>;
  earningsDate: string | null;
  unavailable: Record<string, string>;
};
type NoteEntry = { id: string; text: string; createdAt: string };
type RegimeEvent = { id: string; date: string; label: string };

const defaultNote: NoteEntry = {
  id: "initial",
  text: "Watch the next Core PCE print. A second upside surprise would strengthen the higher-for-longer rates case.",
  createdAt: "2026-09-03T08:15:00+07:00",
};

const releases = [
  {
    time: "08:30",
    country: "US",
    event: "Core PCE Price Index",
    forecast: "0.3%",
    prior: "0.2%",
    status: "HIGH",
  },
  {
    time: "10:00",
    country: "CN",
    event: "NBS Manufacturing PMI",
    forecast: "49.8",
    prior: "49.5",
    status: "HIGH",
  },
  {
    time: "14:00",
    country: "ID",
    event: "Consumer Confidence",
    forecast: "121.2",
    prior: "121.7",
    status: "MED",
  },
  {
    time: "19:30",
    country: "US",
    event: "Initial Jobless Claims",
    forecast: "232K",
    prior: "229K",
    status: "MED",
  },
];

const fallbackIndicators = [
  { name: "CPI", actual: 2.7, mean: 2.9, z: 0.82, unit: "%" },
  { name: "Core PCE", actual: 2.9, mean: 2.5, z: 1.14, unit: "%" },
  { name: "PPI", actual: 3.3, mean: 2.6, z: 0.66, unit: "%" },
  { name: "Retail Sales", actual: 0.5, mean: 0.3, z: 0.31, unit: "%" },
  { name: "Consumer Sentiment", actual: 61.7, mean: 68.4, z: -0.73, unit: "" },
  { name: "ISM Manufacturing", actual: 48.4, mean: 51.2, z: -0.58, unit: "" },
];

const fallbackWatch = [
  { ticker: "BUMI", price: 153, change: 2.68 },
  { ticker: "AMMN", price: 7350, change: -1.34 },
  { ticker: "ADRO", price: 1955, change: 0.77 },
];
const fallbackHeat: MarketData["heatmap"] = [
  {
    label: "ENERGY",
    symbol: "IDXENERGY.JK",
    daily: 1.8,
    weekly: 4.2,
    constituents: [
      { ticker: "ADRO", price: 1955, daily: 0.77, weekly: 2.1 },
      { ticker: "BUMI", price: 153, daily: 2.68, weekly: 5.2 },
    ],
  },
  {
    label: "BASIC MATERIALS",
    symbol: "IDXBASIC.JK",
    daily: 0.9,
    weekly: 2.1,
    constituents: [
      { ticker: "AMMN", price: 7350, daily: -1.34, weekly: 0.8 },
      { ticker: "ANTM", price: 1920, daily: 0.52, weekly: 1.7 },
    ],
  },
  {
    label: "FINANCIALS",
    symbol: "IDXFINANCE.JK",
    daily: 0.4,
    weekly: -0.6,
    constituents: [],
  },
  {
    label: "TECHNOLOGY",
    symbol: "IDXTECHNO.JK",
    daily: -0.7,
    weekly: -2.4,
    constituents: [],
  },
  {
    label: "INDUSTRIALS",
    symbol: "IDXINDUST.JK",
    daily: 0.2,
    weekly: 1.3,
    constituents: [],
  },
  {
    label: "CYCLICALS",
    symbol: "IDXCYCLIC.JK",
    daily: -0.3,
    weekly: -1.2,
    constituents: [],
  },
  {
    label: "HEALTHCARE",
    symbol: "IDXHEALTH.JK",
    daily: -1.1,
    weekly: 0.4,
    constituents: [],
  },
];
const fallbackYield = [4.41, 4.29, 4.12, 4.03, 4.06, 4.18, 4.36];
const fallbackTrail: RegimePoint[] = Array.from({ length: 36 }, (_, index) => {
  const date = new Date(
    Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth() - (35 - index),
      1,
    ),
  );
  return {
    date: date.toISOString().slice(0, 10),
    growth: 1.1 - index * 0.045 + Math.sin(index * 0.7) * 0.3,
    inflation: -0.7 + index * 0.04 + Math.cos(index * 0.5) * 0.34,
  };
});

const gprIllustrativeRows = [
  ["SEA GPR", ".34", ".41", ".29", "-.18", "-.26"],
  ["CHINA GPR", ".47", ".58", ".36", ".33", "-.31"],
  ["US GPR", ".12", ".08", ".44", ".51", "-.22"],
];
const gprBars = [
  25, 29, 27, 34, 31, 38, 41, 37, 46, 43, 52, 49, 55, 61, 57, 64,
];
const navigation: Array<{ label: Section; icon: string }> = [
  { label: "OVERVIEW", icon: "⌂" },
  { label: "MACRO", icon: "∿" },
  { label: "MARKETS", icon: "◇" },
  { label: "GPR INDEX", icon: "◎" },
  { label: "GPR MAP", icon: "⌖" },
  { label: "CORRELATIONS", icon: "⠿" },
  { label: "SEASONALITY", icon: "▦" },
  { label: "MARKET PARTICIPANT", icon: "≋" },
];

export default function Home() {
  const [active, setActive] = useState<Section>("OVERVIEW");
  const [range, setRange] = useState<"6M" | "1Y" | "3Y">("1Y");
  const [heatPeriod, setHeatPeriod] = useState<"1D" | "1W">("1D");
  const [selectedSector, setSelectedSector] = useState("ENERGY");
  const [seasonTicker, setSeasonTicker] = useState("BUMI");
  const [watchTickers, setWatchTickers] = useState<string[]>(["BUMI", "AMMN", "ADRO"]);
  const [tickerInput, setTickerInput] = useState("");
  const [detailTicker, setDetailTicker] = useState<string | null>(null);
  const [detailRange, setDetailRange] = useState<"1mo" | "6mo" | "1y">("6mo");
  const [tickerDetail, setTickerDetail] = useState<TickerDetailData | null>(null);
  const [tickerDetailError, setTickerDetailError] = useState("");
  const [seasonality, setSeasonality] = useState<SeasonalityData | null>(null);
  const [cot, setCot] = useState<CotData | null>(null);
  const [cotAsset, setCotAsset] = useState("USD");
  const [notesOpen, setNotesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scheme, setScheme] = useState<Scheme>("default");
  const [note, setNote] = useState("");
  const [noteHistory, setNoteHistory] = useState<NoteEntry[]>([defaultNote]);
  const [regimeEvents, setRegimeEvents] = useState<RegimeEvent[]>([{ id: "fed-mar-2022", date: "2022-03-01", label: "Fed Rate Hike · Mar 2022" }]);
  const [eventDate, setEventDate] = useState("");
  const [eventLabel, setEventLabel] = useState("");
  const [fred, setFred] = useState<FredData | null>(null);
  const [markets, setMarkets] = useState<MarketData | null>(null);
  const [gdelt, setGdelt] = useState<GdeltData | null>(null);
  const [calendar, setCalendar] = useState<CalendarData | null>(null);

  useEffect(() => {
    try {
      const storedNotes = localStorage.getItem("jarvis-note-history");
      const storedScheme = localStorage.getItem("jarvis-color-scheme") as Scheme | null;
      const storedEvents = localStorage.getItem("jarvis-regime-events");
      const storedWatchlist = localStorage.getItem("jarvis-watchlist");
      if (storedNotes) {
        const parsed = JSON.parse(storedNotes) as NoteEntry[];
        if (Array.isArray(parsed) && parsed.length) setNoteHistory(parsed);
      }
      if (storedScheme && ["default", "deuteranopia", "protanopia", "tritanopia"].includes(storedScheme)) setScheme(storedScheme);
      if (storedEvents) { const parsed = JSON.parse(storedEvents) as RegimeEvent[]; if (Array.isArray(parsed)) setRegimeEvents(parsed); }
      if (storedWatchlist) { const parsed = JSON.parse(storedWatchlist) as string[]; if (Array.isArray(parsed) && parsed.length) setWatchTickers(parsed.slice(0, 12)); }
    } catch { /* Keep safe defaults if browser storage is unavailable. */ }
    Promise.allSettled([
      fetch("/api/fred").then((r) => (r.ok ? r.json() : Promise.reject())),
      fetch("/api/calendar").then((r) => (r.ok ? r.json() : Promise.reject())),
      fetch("/api/cot").then((r) => (r.ok ? r.json() : Promise.reject())),
    ]).then(
      ([fredResult, calendarResult, cotResult]) => {
        if (fredResult.status === "fulfilled")
          setFred(fredResult.value as FredData);
        if (calendarResult.status === "fulfilled")
          setCalendar(calendarResult.value as CalendarData);
        if (cotResult.status === "fulfilled")
          setCot(cotResult.value as CotData);
      },
    );
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).matches("textarea,input")) return;
      if (event.key.toLowerCase() === "n") setNotesOpen(true);
      if (event.key.toLowerCase() === "s") setSettingsOpen(true);
      if (event.key === "Escape") {
        setNotesOpen(false);
        setSettingsOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const query = encodeURIComponent(watchTickers.join(","));
    fetch(`/api/markets?tickers=${query}`)
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data) => setMarkets(data as MarketData))
      .catch(() => setMarkets(null));
  }, [watchTickers]);

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);

  useEffect(() => {
    setSeasonality(null);
    fetch(`/api/seasonality?ticker=${seasonTicker}`)
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data) => setSeasonality(data as SeasonalityData))
      .catch(() => setSeasonality(null));
  }, [seasonTicker]);

  useEffect(() => {
    if (!detailTicker) return;
    setTickerDetail(null); setTickerDetailError("");
    fetch(`/api/ticker?ticker=${encodeURIComponent(detailTicker)}&range=${detailRange}`)
      .then(async (response) => { if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? "Ticker detail unavailable"); return response.json(); })
      .then((data) => setTickerDetail(data as TickerDetailData))
      .catch((error) => setTickerDetailError(error instanceof Error ? error.message : "Ticker detail unavailable"));
  }, [detailTicker, detailRange]);

  const indicators = fred?.indicators ?? fallbackIndicators;
  const yields = fred?.yields.map((item) => item.value) ?? fallbackYield;
  const watchlist = markets?.watchlist ?? [];
  const heatmap = markets?.heatmap ?? fallbackHeat;
  const marketChange = (name: string) => {
    const values =
      markets?.assets
        .find((item) => item.name === name)
        ?.closes.filter((x): x is number => x !== null) ?? [];
    const last = values.at(-1) ?? 0;
    const prior = values.at(-2) ?? last;
    const recent = values.slice(-20);
    const average = recent.length
      ? recent.reduce((sum, value) => sum + value, 0) / recent.length
      : 0;
    return { last, average, change: prior ? (last / prior - 1) * 100 : 0 };
  };
  const dxy = marketChange("DXY");
  const oil = marketChange("OIL");
  const liveCount =
    Number(Boolean(fred)) +
    Number(Boolean(markets)) +
    Number(gdelt?.status === "live") +
    Number(Boolean(calendar));
  const currentRegime = (fred?.regime ?? fallbackTrail).at(-1)!;
  const currentRegimeLabel = regimeLabel(currentRegime);
  const selectedHeat =
    heatmap.find((item) => item.label === selectedSector) ?? heatmap[0];
  const liveCorrelationRows = useMemo(
    () => correlationMatrix(gdelt, markets),
    [gdelt, markets],
  );
  const marketCorrelationRows = useMemo(() => marketCorrelationMatrix(markets), [markets]);
  const selectedCot =
    cot?.series.find((item) => item.key === cotAsset) ?? cot?.series[0] ?? null;
  const savedEntry = noteHistory.at(-1) ?? defaultNote;
  const savedNote = savedEntry.text;

  const saveNote = () => {
    if (note.trim()) {
      const entry = { id: crypto.randomUUID(), text: note.trim(), createdAt: new Date().toISOString() };
      setNoteHistory((current) => {
        const updated = [...current, entry].slice(-50);
        localStorage.setItem("jarvis-note-history", JSON.stringify(updated));
        return updated;
      });
      setNote("");
    }
    setNotesOpen(false);
  };
  const addRegimeEvent = () => {
    if (!eventDate || !eventLabel.trim()) return;
    setRegimeEvents((current) => { const updated = [...current, { id: crypto.randomUUID(), date: eventDate, label: eventLabel.trim() }]; localStorage.setItem("jarvis-regime-events", JSON.stringify(updated)); return updated; });
    setEventDate(""); setEventLabel("");
  };
  const addTicker = () => {
    const ticker = tickerInput.trim().toUpperCase();
    if (!/^[A-Z0-9]{2,10}$/.test(ticker) || watchTickers.includes(ticker) || watchTickers.length >= 12) return;
    const updated = [...watchTickers, ticker]; setWatchTickers(updated); setTickerInput("");
    localStorage.setItem("jarvis-watchlist", JSON.stringify(updated));
  };
  const removeTicker = (ticker: string) => {
    if (watchTickers.length <= 1) return;
    const updated = watchTickers.filter((item) => item !== ticker); setWatchTickers(updated);
    localStorage.setItem("jarvis-watchlist", JSON.stringify(updated));
    if (seasonTicker === ticker) setSeasonTicker(updated[0] ?? "JKSE");
  };
  const openTickerDetail = (ticker: string) => {
    const normalized = ticker.trim().toUpperCase();
    if (!/^[A-Z0-9]{2,10}$/.test(normalized)) return;
    setDetailTicker(normalized); setDetailRange("6mo");
  };

  return (
    <main className="terminal-shell" data-scheme={scheme}>
      <aside className="side-nav">
        <div className="side-brand" aria-label="Jarvis">
          <img src="/jarvis-logo.png" alt="" />
        </div>
        <nav aria-label="Research sections">
          {navigation.map((item) => (
            <button
              key={item.label}
              aria-label={item.label}
              data-label={item.label}
              title={item.label}
              onClick={() => setActive(item.label)}
              className={active === item.label ? "active" : ""}
            >
              <span aria-hidden="true">{item.icon}</span>
            </button>
          ))}
        </nav>
        <div className="side-tools">
          <button
            aria-label="Notes"
            data-label="NOTES"
            title="Notes"
            onClick={() => setNotesOpen(true)}
          >
            <span aria-hidden="true">✎</span>
          </button>
          <button
            aria-label="Settings"
            data-label="SETTINGS"
            title="Settings"
            onClick={() => setSettingsOpen(true)}
          >
            <span aria-hidden="true">⚙</span>
          </button>
        </div>
        <button
          className="sidebar-health"
          aria-label={`${liveCount} of 4 data feeds live`}
          data-label={`${liveCount}/4 FEEDS LIVE`}
          title={`${liveCount}/4 feeds live`}
          onClick={() => setSettingsOpen(true)}
        >
          <i className={liveCount >= 3 ? "good" : liveCount ? "partial" : ""} />
        </button>
      </aside>

      <div className="app-column">
        <header className="topbar global-bar">
          <label className="global-search">
            <span>⌕</span>
            <input
              aria-label="Search terminal"
              placeholder="Search tickers, indicators, notes"
            />
          </label>
          <div className="global-date">
            <span>THU</span>
            <strong>03 SEP 2026</strong>
            <b>WIB</b>
          </div>
          <div className="feed-summary">
            <span className={liveCount ? "live-dot" : "stale-dot"} />
            <strong>{liveCount}/4 FEEDS LIVE</strong>
            <small>DAILY CLOSE</small>
          </div>
        </header>

        <section className="signal-strip" aria-label="Key readings">
          <MetricCard
            label="MACRO REGIME"
            value={currentRegimeLabel}
            tone="orange"
            condition={
              currentRegimeLabel === "TRANSITION"
                ? "NEAR NEUTRAL · LOW-CONFIDENCE QUADRANT"
                : "GROWTH–INFLATION PRESSURE"
            }
            implication={
              currentRegimeLabel === "TRANSITION"
                ? "Signals sit near the centre; avoid a strong regime bet."
                : "Defensive tilt; avoid paying for fragile growth."
            }
            source={fred ? "FRED LIVE" : "ILLUSTRATIVE DATA"}
          />
          <MetricCard
            label="GPR INDEX"
            value={
              gdelt?.frequencyScore !== null &&
              gdelt?.frequencyScore !== undefined
                ? `${signed(gdelt.frequencyScore)} Z`
                : "PENDING"
            }
            condition={
              gdelt?.status === "live"
                ? riskFrequencyLabel(gdelt.frequencyScore!)
                : "DATA SOURCE PAUSED"
            }
            implication={
              gdelt?.status === "live"
                ? "Frequency is measured against each region’s trailing 90-day baseline."
                : "Waiting for a more stable regional news-data source."
            }
            source={
              gdelt?.status === "live"
                ? "GDELT DOC · 100% KEYWORD FREQUENCY"
                : "ILLUSTRATIVE STRUCTURE · NO LIVE GPR DATA"
            }
          />
          <MetricCard
            label="US 10Y–2Y"
            value={`${((yields[4] - yields[2]) * 100).toFixed(0)} BP`}
            condition={spreadLabel((yields[4] - yields[2]) * 100)}
            implication="A flatter curve keeps cyclical conviction constrained."
            source={fred ? "FRED LIVE" : "ILLUSTRATIVE DATA"}
          />
          <MetricCard
            label="DXY"
            value={dxy.last ? dxy.last.toFixed(2) : "103.42"}
            condition={relativeLabel(dxy.last, dxy.average, "DOLLAR")}
            implication="Firm USD is a headwind for EM risk and commodities."
            source={
              markets ? `${signed(dxy.change)}% · LIVE` : "ILLUSTRATIVE DATA"
            }
          />
          <MetricCard
            label="WTI CRUDE"
            value={oil.last ? "$" + oil.last.toFixed(2) : "$84.17"}
            condition={relativeLabel(oil.last, oil.average, "ENERGY")}
            implication="Supports the energy complex; coal equities benefit indirectly."
            source={
              markets ? `${signed(oil.change)}% · LIVE` : "ILLUSTRATIVE DATA"
            }
          />
        </section>

        <div className="view-heading">
          <div>
            <span>RESEARCH / {active}</span>
            <h2>
              {active === "OVERVIEW"
                ? "Daily Research Overview"
                : active === "GPR INDEX"
                  ? "Geopolitical Risk Index"
                  : titleCase(active)}
            </h2>
          </div>
          <p>{sectionDescription(active)}</p>
        </div>

        {active === "OVERVIEW" && (
          <section className="dashboard-grid overview-grid">
            <Watchlist watchlist={watchlist} configuredTickers={watchTickers} live={Boolean(markets)} tickerInput={tickerInput} setTickerInput={setTickerInput} addTicker={addTicker} removeTicker={removeTicker} openTickerDetail={openTickerDetail} />
            <Calendar data={calendar} />
            <article className="panel thesis-panel">
              <PanelHead index="03" title="CURRENT THESIS">
                <button
                  className="quiet-button"
                  onClick={() => setNotesOpen(true)}
                >
                  UPDATE
                </button>
              </PanelHead>
              <div className="thesis-content compact">
                <span className="thesis-date">MANUAL ENTRY · SAVED ON THIS DEVICE · NO SCHEDULED UPDATE</span>
                <h3>Sticky inflation is meeting softer growth.</h3>
                <p>{savedNote}</p>
                <small className="thesis-updated">LAST EDITED {formatDate(savedEntry.createdAt)}</small>
                <div className="thesis-tags">
                  <span>RATES</span>
                  <span>CHINA</span>
                  <span>ENERGY</span>
                </div>
              </div>
            </article>
            <article className="panel implication-panel">
              <PanelHead index="04" title="DAILY IMPLICATIONS">
                <span
                  className="compact-health"
                  title={`${liveCount}/4 feeds live`}
                >
                  <i
                    className={
                      liveCount >= 3 ? "good" : liveCount ? "partial" : ""
                    }
                  />
                  {liveCount}/4
                </span>
              </PanelHead>
              <div className="implication-list">
                <p>
                  <span>01</span>
                  <strong>Stay selective in cyclicals</strong>
                  <small>
                    Weakening growth and sticky inflation lower the margin for
                    error.
                  </small>
                </p>
                <p>
                  <span>02</span>
                  <strong>Keep energy on the screen</strong>
                  <small>
                    Oil strength supports cash flow, but ADRO and BUMI remain
                    coal-led exposures.
                  </small>
                </p>
                <p>
                  <span>03</span>
                  <strong>Keep geopolitical risk unscored</strong>
                  <small>
                    GPR remains pending; do not use its placeholder structure as
                    a live position-sizing signal.
                  </small>
                </p>
              </div>
            </article>
          </section>
        )}

        {active === "MACRO" && (
          <section className="dashboard-grid macro-grid">
            <article className="panel regime-panel">
              <PanelHead index="01" title="MACRO REGIME MAP">
                <div className="range-switcher">
                  {(["6M", "1Y", "3Y"] as const).map((item) => (
                    <button
                      key={item}
                      onClick={() => setRange(item)}
                      className={range === item ? "active" : ""}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </PanelHead>
              <div className="regime-method">
                <div><span>GROWTH COMPOSITE</span><strong>{fred?.regimeMethodology?.growth.join(" · ") ?? "Industrial Production · Retail Sales · Manufacturing Employment"}</strong><small>{fred?.regimeMethodology?.growthPending[0] ?? "ISM Manufacturing awaiting a stable licensed source"}</small></div>
                <div title={fred?.regimeMethodology?.normalization}><span>INFLATION COMPOSITE</span><strong>{fred?.regimeMethodology?.inflation.join(" · ") ?? "CPI · Core PCE · PPI Final Demand"}</strong><small>EQUAL-WEIGHT Z-SCORES · MAX 1M CARRY-FORWARD FOR ISOLATED GAPS</small></div>
                <b>{Math.min(fred?.regime.length ?? fallbackTrail.length, range === "6M" ? 6 : range === "1Y" ? 12 : 36)} MONTHLY POINTS</b>
              </div>
              <RegimeCanvas
                points={fred?.regime ?? fallbackTrail}
                range={range}
                events={regimeEvents}
              />
              <PanelFoot
                left="GROWTH COMPOSITE × INFLATION COMPOSITE · MONTHLY"
                right={
                  fred
                    ? `FRED · THROUGH ${formatDate(fred.freshness)}`
                    : `ILLUSTRATIVE · THROUGH ${formatDate(fallbackTrail.at(-1)!.date)}`
                }
              />
            </article>
            <article className="panel indicator-panel">
              <PanelHead index="02" title="MACRO INDICATOR Z-SCORES">
                <span className="head-note">VS 10Y MEAN</span>
              </PanelHead>
              <div className="indicator-head">
                <span>INDICATOR</span>
                <span>ACTUAL</span>
                <span>MEAN</span>
                <span>DEVIATION</span>
                <span>Z</span>
              </div>
              {indicators.map((item) => (
                <div className="indicator-row" key={item.name}>
                  <strong>{item.name}{Math.abs(item.z) >= 2 && <span className="threshold-badge extreme">EXTREME ±2σ</span>}</strong>
                  <span>{formatNumber(item.actual, item.unit)}</span>
                  <span>{formatNumber(item.mean, item.unit)}</span>
                  <div className="deviation-track">
                    <i
                      className={zTone(item.z)}
                      style={{ width: `${Math.min(96, 50 + item.z * 28)}%` }}
                    />
                  </div>
                  <b className={zTone(item.z)}>{signed(item.z)}</b>
                </div>
              ))}
              <PanelFoot
                left="SEASONALLY ADJUSTED WHERE AVAILABLE"
                right={fred ? "FRED LIVE" : "ILLUSTRATIVE DATA"}
              />
            </article>
            <YieldCurve values={yields} live={Boolean(fred)} status={fred?.curveStatus} />
            <article className="panel regime-event-panel"><PanelHead index="04" title="REGIME EVENT MARKERS"><span className="head-note">MANUAL · SAVED LOCALLY</span></PanelHead><div className="event-form"><input type="date" value={eventDate} onChange={(event) => setEventDate(event.target.value)} aria-label="Event date" /><input value={eventLabel} onChange={(event) => setEventLabel(event.target.value)} placeholder="Event label, e.g. Fed Rate Hike" aria-label="Event label" maxLength={60} /><button onClick={addRegimeEvent}>ADD MARKER</button></div><div className="event-list">{regimeEvents.slice().reverse().map((event) => <p key={event.id}><time>{event.date}</time><span>{event.label}</span><button onClick={() => setRegimeEvents((current) => { const updated = current.filter((item) => item.id !== event.id); localStorage.setItem("jarvis-regime-events", JSON.stringify(updated)); return updated; })}>REMOVE</button></p>)}</div></article>
          </section>
        )}

        {active === "MARKETS" && (
          <section className="dashboard-grid markets-grid">
            <article className="panel heatmap-panel">
              <PanelHead index="01" title="IDX SECTOR HEATMAP">
                <div className="range-switcher">
                  {(["1D", "1W"] as const).map((item) => (
                    <button
                      key={item}
                      onClick={() => setHeatPeriod(item)}
                      className={heatPeriod === item ? "active" : ""}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </PanelHead>
              <div className="heatmap">
                {heatmap.map((item, index) => {
                  const value = heatPeriod === "1D" ? item.daily : item.weekly;
                  return (
                    <button
                      key={item.label}
                      onClick={() => setSelectedSector(item.label)}
                      className={`heat-tile ${["xl", "lg", "md", "lg", "sm", "sm", "md", "sm", "md", "lg", "md"][index]} ${value === null ? "no-data" : heatTone(value)} ${item.confidence === "low" ? "low-confidence" : ""} ${selectedHeat?.label === item.label ? "selected" : ""}`}
                    >
                      <span>{item.label}</span>
                      <strong>
                        {value === null ? "—" : `${signed(value)}%`}
                      </strong>
                      <small>
                        {item.confidence === "low"
                          ? `LOW CONFIDENCE · ${item.validCount ?? 0}/${item.memberCount ?? 0} VALID`
                          : "VIEW MEMBERS →"}
                      </small>
                    </button>
                  );
                })}
              </div>
              {selectedHeat && (
                <div className="heat-drilldown">
                  <div>
                    <span>SELECTED SECTOR</span>
                    <strong>{selectedHeat.label}</strong>
                    <small>
                      SIMPLE AVG ·{" "}
                      {selectedHeat.validCount ??
                        selectedHeat.constituents.length}
                      /
                      {selectedHeat.memberCount ??
                        selectedHeat.constituents.length}{" "}
                      VALID
                    </small>
                  </div>
                  {selectedHeat.constituents.length ? (
                    selectedHeat.constituents.map((stock) => {
                      const value =
                        heatPeriod === "1D" ? stock.daily : stock.weekly;
                      return (
                        <div key={stock.ticker}>
                          <span>{stock.ticker}</span>
                          <strong>
                            {stock.price.toLocaleString("en-US", {
                              maximumFractionDigits: 2,
                            })}
                          </strong>
                          <small
                            className={
                              value === null
                                ? ""
                                : value >= 0
                                  ? "positive"
                                  : "negative"
                            }
                          >
                            {value === null
                              ? "NO VALID RETURN"
                              : `${signed(value)}%`}
                          </small>
                        </div>
                      );
                    })
                  ) : (
                    <p>Constituent feed unavailable for this sector.</p>
                  )}
                </div>
              )}
              <PanelFoot
                left="SIMPLE AVERAGE OF VALID IDX-IC CONSTITUENT BASKETS"
                right={
                  markets
                    ? `${markets.status.toUpperCase()} · YAHOO UPSTREAM`
                    : "ILLUSTRATIVE DATA"
                }
              />
            </article>
            <Watchlist watchlist={watchlist} configuredTickers={watchTickers} live={Boolean(markets)} tickerInput={tickerInput} setTickerInput={setTickerInput} addTicker={addTicker} removeTicker={removeTicker} openTickerDetail={openTickerDetail} />
            <Calendar data={calendar} />
          </section>
        )}

        {active === "GPR INDEX" && (
          <section className="dashboard-grid risk-grid">
            <article className="panel gpr-panel">
              <PanelHead index="01" title="GEOPOLITICAL RISK INDEX">
                <span className="model-badge">SIMPLIFIED MODEL</span>
              </PanelHead>
              <div className="gpr-summary">
                <div className="gpr-score">
                  <span>CURRENT INDEX</span>
                  <strong>
                    {gdelt?.frequencyScore !== null &&
                    gdelt?.frequencyScore !== undefined
                      ? signed(gdelt.frequencyScore)
                      : "—"}
                  </strong>
                  <b>
                    {gdelt?.status === "live"
                      ? `${riskFrequencyLabel(gdelt.frequencyScore!)} · Z-SCORE`
                      : "DATA UNAVAILABLE · SOURCE PAUSED"}
                  </b>
                  {gdelt?.status === "live" && gdelt.frequencyScore !== null && gdelt.frequencyScore >= 1 && <span className="threshold-badge extreme">THRESHOLD ≥ +1σ</span>}
                </div>
                <div className="gpr-formula">
                  <span>INDEX FORMULA</span>
                  <strong>
                    <b>100%</b> KEYWORD FREQUENCY <i>·</i> SIMPLIFIED
                  </strong>
                  <small>
                    Daily GDELT coverage of war, sanctions, invasion, embargo,
                    tensions and conflict; normalized against each region’s
                    trailing 90-day mean and standard deviation.
                  </small>
                </div>
                <div className="gpr-moves">
                  <span>
                    REGIONAL MODEL <b>SEA + CHINA + US</b>
                  </span>
                  <span>
                    NORMALIZATION <b>ROLLING 90D Z-SCORE</b>
                  </span>
                  <span>
                    FRESHNESS{" "}
                    <b>
                      {gdelt?.freshness
                        ? formatDate(gdelt.freshness)
                        : "PENDING"}
                    </b>
                  </span>
                </div>
              </div>
              <div className="gpr-chart pending" aria-label="Illustrative GPR chart structure; no live values">
                <div className="threshold-line">
                  <span>ILLUSTRATIVE SCALE · ELEVATED +1σ</span>
                </div>
                {gprBars.map((height, index) => (
                  <i
                    key={index}
                    className={index > 12 ? "alert" : ""}
                    style={{ height: `${height}%` }}
                  />
                ))}
              </div>
              <div className="regional-risk">
                <span>REGIONAL KEYWORD FREQUENCY · Z-SCORE</span>
                {gdelt?.regions?.length ? (
                  gdelt.regions.map((region) => (
                    <div key={region.region}>
                      <b>{region.region}</b>
                      <i>
                        <em
                          style={{
                            width: `${Math.max(4, Math.min(96, 50 + region.score * 18))}%`,
                          }}
                        />
                      </i>
                      <strong>{signed(region.score)}</strong>
                    </div>
                  ))
                ) : ["SEA", "CHINA", "US"].map((region) => <div key={region} className="pending-region"><b>{region}</b><i><em style={{ width: "0%" }} /></i><strong>—</strong></div>)}
              </div>
              <PanelFoot
                left={
                  gdelt?.status === "live"
                    ? gdelt.approximate
                      ? "GDELT DOC · ALL REGIONS LIVE · NARROW FALLBACK USED"
                      : "GDELT DOC FREQUENCY · ALL THREE REGIONS VALIDATED"
                    : "NO LIVE GPR DATA · WAITING FOR A MORE STABLE SOURCE"
                }
                right="100% KEYWORD FREQUENCY"
              />
            </article>
            <article className="panel methodology-panel">
              <PanelHead index="02" title="METHOD NOTES" />
              <div>
                <h3>Why frequency only?</h3>
                <p>
                  This free version measures news intensity directly. It does
                  not claim to include Goldstein event severity.
                </p>
                <h3>How normalization works</h3>
                <p>
                  Each day is compared with the prior 90 daily observations: z =
                  (current frequency − trailing mean) ÷ trailing standard
                  deviation. The headline index is the equal-weight average of
                  SEA, China and US z-scores.
                </p>
                <h3>What the score is not</h3>
                <p>
                  It is a directional research signal, not an academic GPR
                  benchmark. News density, duplication and query language can
                  affect it.
                </p>
              </div>
            </article>
          </section>
        )}

        {active === "GPR MAP" && (
          <section className="panel gpr-map-panel">
            <PanelHead index="01" title="GEOPOLITICAL RISK MAP"><span className="demo-badge">PLACEHOLDER · NOT LIVE</span></PanelHead>
            <div className="map-intro"><div><h3>SEA · CHINA · UNITED STATES</h3><p>Map structure is ready for validated event-level coordinates. Current pins mark regional anchors only; they do not represent confirmed geopolitical events.</p></div><span>WAITING FOR A MORE STABLE EVENT SOURCE</span></div>
            <div className="map-stage"><GprMap /><div className="map-legend"><span><i className="sea" />BLUE · SEA</span><span><i className="china" />ORANGE · CHINA</span><span><i className="us" />RED · UNITED STATES</span></div></div>
            <PanelFoot left="LEAFLET · OPENSTREETMAP BASE LAYER" right="PLACEHOLDER COORDINATES · NO LIVE EVENTS" />
          </section>
        )}

        {active === "CORRELATIONS" && (
          <section className="panel correlation-panel actual-matrix">
            <PanelHead index="01" title="60-DAY ROLLING CORRELATION">
              <div className="legend">
                <span>NEGATIVE</span>
                <i />
                <span>POSITIVE</span>
              </div>
            </PanelHead>
            <div className="matrix-intro">
              <div>
                <h3>MARKET SERIES × MARKET SERIES</h3>
                <p>
                  Pearson correlation of daily returns across validated market
                  proxies and the current custom watchlist. GPR is not required.
                </p>
              </div>
              <span>{marketCorrelationRows ? "PARTIAL LIVE · MARKET DATA" : "MARKET SERIES UNAVAILABLE"}</span>
            </div>
            <div className="matrix correlation-only dynamic-matrix">
              <div className="matrix-row matrix-labels" style={{ gridTemplateColumns: `120px repeat(${marketCorrelationRows?.names.length ?? 5}, minmax(64px, 1fr))` }}>
                <span />
                {(marketCorrelationRows?.names ?? ["COAL ETF", "NICKEL EQ.", "OIL", "DXY", "JKSE"]).map(
                  (item) => (
                    <b key={item}>{item}</b>
                  ),
                )}
              </div>
              {(marketCorrelationRows?.rows ?? []).map((row) => (
                <div className="matrix-row" key={row[0]} style={{ gridTemplateColumns: `120px repeat(${marketCorrelationRows?.names.length ?? 5}, minmax(64px, 1fr))` }}>
                  <b>{row[0]}</b>
                  {row.slice(1).map((value, index) => {
                    const n = Number(value);
                    return (
                      <span
                        key={index}
                        className={
                          Math.abs(n) >= 0.3
                            ? n > 0
                              ? "corr-pos"
                              : "corr-neg"
                            : ""
                        }
                      >
                        {value}
                      </span>
                    );
                  })}
                </div>
              ))}
            </div>
            {!marketCorrelationRows && <FeedUnavailable title="MARKET CORRELATION UNAVAILABLE" body="The matrix is withheld until the market series have at least 60 aligned daily returns." />}
            <div className="matrix-intro gpr-matrix-status">
              <div><h3>GPR × MARKET SERIES</h3><p>Structure retained for SEA, China and US. Values below are illustrative only and are not used as live signals.</p></div>
              <span>ILLUSTRATIVE · WAITING FOR STABLE GPR SOURCE</span>
            </div>
            <div className="matrix correlation-only illustrative-matrix">
              <div className="matrix-row matrix-labels"><span />{["COAL ETF", "NICKEL EQ.", "OIL", "DXY", "JKSE"].map((item) => <b key={item}>{item}</b>)}</div>
              {gprIllustrativeRows.map((row) => <div className="matrix-row" key={row[0]}><b>{row[0]}</b>{row.slice(1).map((value, index) => <span key={index}>{value}</span>)}</div>)}
            </div>
            <div className="matrix-footnotes">
              <p>
                <strong>COAL ETF</strong> COAL · coal-industry equity ETF proxy
              </p>
              <p>
                <strong>NICKEL EQUITY</strong> VALE · nickel-exposed producer
                equity proxy
              </p>
              <p>
                <strong>OIL</strong> WTI crude futures
              </p>
              <p>
                <strong>DXY</strong> US Dollar Index
              </p>
              <p>
                <strong>JKSE</strong> IDX Composite
              </p>
            </div>
            <PanelFoot
              left={marketCorrelationRows ? "YAHOO MARKET SERIES CONNECTED · GPR PAUSED" : "MARKET SERIES VALIDATION INCOMPLETE"}
              right="60 ALIGNED TRADING DAYS"
            />
          </section>
        )}

        {active === "SEASONALITY" && (
          <section className="panel seasonality-panel">
            <PanelHead index="01" title="MONTHLY RETURN SEASONALITY">
              <div className="ticker-switcher">
                {[...watchTickers, "JKSE"].map((ticker) => (
                  <button
                    key={ticker}
                    onClick={() => setSeasonTicker(ticker)}
                    className={seasonTicker === ticker ? "active" : ""}
                  >
                    {ticker}
                  </button>
                ))}
              </div>
            </PanelHead>
            {seasonality ? (
              <>
                <div className="season-summary">
                  <div>
                    <span>SELECTED SERIES</span>
                    <strong>{seasonality.ticker}</strong>
                    <small>{seasonality.symbol}</small>
                  </div>
                  <p>
                    Average calendar-month return across completed monthly
                    observations. Historical tendency only—not a forecast.
                  </p>
                  <b>
                    BASED ON {seasonality.years} YEARS OF HISTORICAL DATA ·{" "}
                    {seasonality.from}–{seasonality.through}
                  </b>
                </div>
                <div className="season-grid">
                  {seasonality.months.map((month) => (
                    <div
                      key={month.month}
                      className={`season-tile ${heatTone(month.average)}`}
                    >
                      <span>{monthName(month.month)}</span>
                      <strong>{signed(month.average)}%</strong>
                      <small>
                        {month.positiveRate.toFixed(0)}% POSITIVE · N=
                        {month.observations}
                      </small>
                    </div>
                  ))}
                </div>
                <div className="season-legend">
                  <span>WEAKER AVERAGE</span>
                  <i />
                  <span>STRONGER AVERAGE</span>
                </div>
                <PanelFoot
                  left="AVERAGE MONTHLY CLOSE-TO-CLOSE RETURN"
                  right="YAHOO FINANCE UPSTREAM · DAILY HISTORY"
                />
              </>
            ) : (
              <FeedUnavailable
                title="SEASONALITY FEED UNAVAILABLE"
                body="No historical values are shown until Yahoo returns a valid 5–10 year price series."
              />
            )}
          </section>
        )}

        {active === "MARKET PARTICIPANT" && (
          <section className="dashboard-grid cot-grid">
            <article className="panel cot-panel">
              <PanelHead index="01" title="CFTC COT POSITIONING">
                <div className="ticker-switcher">
                  {["USD", "GOLD", "US10Y", "BTC"].map((asset) => (
                    <button
                      key={asset}
                      onClick={() => setCotAsset(asset)}
                      className={cotAsset === asset ? "active" : ""}
                      disabled={!cot?.series.some((item) => item.key === asset)}
                    >
                      {asset}
                    </button>
                  ))}
                </div>
              </PanelHead>
              {selectedCot ? (
                <>
                  <div className="cot-summary">
                    <div>
                      <span>CONTRACT</span>
                      <strong>{selectedCot.label}</strong>
                    </div>
                    <div>
                      <span>LATEST REPORT</span>
                      <strong>{formatDate(selectedCot.latest)}</strong>
                    </div>
                    <div>
                      <span>FREQUENCY</span>
                      <strong>WEEKLY · CFTC</strong>
                    </div>
                  </div>
                  <CotChart series={selectedCot} />
                  <CotTable series={selectedCot} />
                  <PanelFoot
                    left="NET POSITION = LONG CONTRACTS − SHORT CONTRACTS"
                    right={`UPDATED WEEKLY · THROUGH ${formatDate(selectedCot.latest)}`}
                  />
                </>
              ) : (
                <FeedUnavailable
                  title="CFTC CONNECTION FAILED"
                  body="No positioning values are shown because the public COT dataset did not return a valid series."
                />
              )}
            </article>
          </section>
        )}

        <footer className="terminal-footer">
          <span>JARVIS / RESEARCH USE ONLY</span>
          <span>Unavailable feeds retain explicit connection labels.</span>
          <span>v1.2</span>
        </footer>
      </div>

      {detailTicker && (
        <div className="overlay ticker-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetailTicker(null); }}>
          <section className="drawer ticker-drawer" role="dialog" aria-modal="true" aria-label={`${detailTicker} ticker detail`}>
            <div className="drawer-head">
              <div><span>TICKER DETAIL · YAHOO FINANCE</span><h2>{tickerDetail?.info.name ?? detailTicker}</h2></div>
              <button onClick={() => setDetailTicker(null)}>ESC</button>
            </div>
            {tickerDetail ? <>
              <div className="ticker-hero"><div><span>{tickerDetail.symbol} · {tickerDetail.info.currency}</span><strong>{tickerDetail.info.price === null ? "—" : tickerDetail.info.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}</strong></div><div><span>1D</span><b className={(tickerDetail.info.dailyChange ?? 0) >= 0 ? "positive" : "negative"}>{tickerDetail.info.dailyChange === null ? "—" : `${signed(tickerDetail.info.dailyChange)}%`}</b></div><div><span>1W</span><b className={(tickerDetail.info.weeklyChange ?? 0) >= 0 ? "positive" : "negative"}>{tickerDetail.info.weeklyChange === null ? "—" : `${signed(tickerDetail.info.weeklyChange)}%`}</b></div></div>
              <div className="ticker-stat-grid">
                <TickerStat label="VOLUME" value={tickerDetail.info.volume === null ? "Unavailable" : compact(tickerDetail.info.volume)} />
                <TickerStat label="MARKET CAP" value={tickerDetail.info.marketCap === null ? "Unavailable · free feed" : compact(tickerDetail.info.marketCap)} />
                <TickerStat label="P/E RATIO" value={tickerDetail.info.peRatio === null ? "Unavailable · free feed" : tickerDetail.info.peRatio.toFixed(2)} />
                <TickerStat label="52W HIGH" value={tickerDetail.info.high52 === null ? "Unavailable" : tickerDetail.info.high52.toLocaleString("en-US")} />
                <TickerStat label="52W LOW" value={tickerDetail.info.low52 === null ? "Unavailable" : tickerDetail.info.low52.toLocaleString("en-US")} />
                <TickerStat label="EARNINGS DATE" value={tickerDetail.earningsDate ? formatDate(tickerDetail.earningsDate) : "Unavailable · free feed"} />
              </div>
              <div className="ticker-chart-head"><div><span>PRICE HISTORY</span><strong>DAILY CLOSE</strong></div><div className="range-switcher">{(["1mo", "6mo", "1y"] as const).map((item) => <button key={item} className={detailRange === item ? "active" : ""} onClick={() => setDetailRange(item)}>{item === "1mo" ? "1M" : item === "6mo" ? "6M" : "1Y"}</button>)}</div></div>
              <TickerPriceChart points={tickerDetail.points} />
              <div className="ticker-detail-grid">
                <section><div className="ticker-section-head"><span>RECENT HEADLINES</span><small>{tickerDetail.newsCoverage}</small></div>{tickerDetail.news.length ? <div className="ticker-news">{tickerDetail.news.map((item) => <a key={item.id} href={item.link} target="_blank" rel="noreferrer"><strong>{item.title}</strong><small>{item.publisher}{item.publishedAt ? ` · ${formatDate(item.publishedAt)}` : ""}</small></a>)}</div> : <p className="ticker-empty">No recent news available for this ticker. Free IDX coverage may be limited or skew global.</p>}</section>
                <section><div className="ticker-section-head"><span>CORPORATE ACTIONS</span><small>YAHOO EVENTS</small></div>{tickerDetail.dividends.length ? <div className="ticker-actions">{tickerDetail.dividends.slice(0, 6).map((item) => <p key={`${item.date}-${item.amount}`}><time>{formatDate(item.date)}</time><strong>DIVIDEND</strong><b>{item.amount.toLocaleString("en-US")} {tickerDetail.info.currency}</b></p>)}</div> : <p className="ticker-empty">No dividend history available.</p>}<p className="earnings-note">Earnings date: {tickerDetail.earningsDate ? formatDate(tickerDetail.earningsDate) : "Not available from the free Yahoo endpoint."}</p></section>
              </div>
            </> : <FeedUnavailable title={tickerDetailError || "LOADING TICKER DETAIL"} body={tickerDetailError ? "No values are shown because Yahoo did not return a valid record for this ticker." : "Fetching price history, headlines and corporate actions."} />}
          </section>
        </div>
      )}

      {notesOpen && (
        <div
          className="overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setNotesOpen(false);
          }}
        >
          <section
            className="drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Research notes"
          >
            <div className="drawer-head">
              <div>
                <span>RESEARCH LOG</span>
                <h2>UPDATE CURRENT THESIS</h2>
              </div>
              <button onClick={() => setNotesOpen(false)}>ESC</button>
            </div>
            <label htmlFor="note">NEW NOTE</label>
            <textarea
              id="note"
              autoFocus
              value={note}
              maxLength={600}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What changed in the data, and what would disprove your read?"
            />
            <div className="prompt-line">
              <span>Keep the claim testable.</span>
              <span>{note.length} / 600</span>
            </div>
            <div className="drawer-actions">
              <button onClick={() => setNotesOpen(false)}>CANCEL</button>
              <button className="primary-button" onClick={saveNote}>
                SAVE NOTE
              </button>
            </div>
            {noteHistory.slice(-5).reverse().map((entry, index) => <div className="recent-note" key={entry.id}>
              <span>{index === 0 ? "LATEST ENTRY" : "HISTORY"}</span>
              <p>{entry.text}</p>
              <small>{formatNoteTime(entry.createdAt)}</small>
            </div>)}
          </section>
        </div>
      )}
      {settingsOpen && (
        <div
          className="overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSettingsOpen(false);
          }}
        >
          <section
            className="drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Terminal settings"
          >
            <div className="drawer-head">
              <div>
                <span>TERMINAL</span>
                <h2>SETTINGS</h2>
              </div>
              <button onClick={() => setSettingsOpen(false)}>ESC</button>
            </div>
            <div className="setting-block">
              <h3>COLOR ACCESSIBILITY</h3>
              <p>
                Choose a signal palette that keeps gains and losses distinct.
              </p>
              <div className="scheme-list">
                {(
                  [
                    "default",
                    "deuteranopia",
                    "protanopia",
                    "tritanopia",
                  ] as Scheme[]
                ).map((item) => (
                  <button
                    key={item}
                    className={scheme === item ? "selected" : ""}
                    onClick={() => { setScheme(item); localStorage.setItem("jarvis-color-scheme", item); }}
                  >
                    <i />
                    <span>{item.toUpperCase()}</span>
                    <b>{scheme === item ? "ON" : ""}</b>
                  </button>
                ))}
              </div>
            </div>
            <div className="setting-block">
              <h3>DATA CONNECTIONS</h3>
              <p>
                Technical feed detail is kept here so the daily view stays
                focused on decisions.
              </p>
              <div className="settings-health connection-list">
                <p>
                  <i className={fred ? "live" : ""} />
                  <strong>FRED</strong>
                  <span>
                    {fred
                      ? `Updated ${fred.freshness}`
                      : "FRED_API_KEY not configured or upstream unavailable"}
                  </span>
                </p>
                <p>
                  <i className={markets ? "live" : ""} />
                  <strong>IDX + SEASONALITY</strong>
                  <span>
                    {markets
                      ? `${markets.status} · Yahoo upstream`
                      : "Live request failed · illustrative values retained"}
                  </span>
                </p>
                <p>
                  <i className={gdelt?.status === "live" ? "live" : ""} />
                  <strong>GDELT DOC</strong>
                  <span>
                    {gdelt?.status === "live"
                      ? "SEA, China and US keyword-frequency z-scores live"
                      : "Paused · waiting for a more stable regional GPR source"}
                  </span>
                </p>
                <p>
                  <i className={cot ? "live" : ""} />
                  <strong>CFTC COT</strong>
                  <span>
                    {cot
                      ? `${cot.status} · weekly public reports`
                      : "Public dataset request failed"}
                  </span>
                </p>
                <p>
                  <i className={calendar ? "live" : ""} />
                  <strong>RELEASE CALENDAR</strong>
                  <span>
                    {calendar
                      ? (calendar.coverage ?? "FRED calendar connected")
                      : "FRED calendar unavailable"}
                  </span>
                </p>
                <p>
                  <i className={calendar?.bpsStatus?.includes("connected") ? "live" : ""} />
                  <strong>BPS INDONESIA</strong>
                  <span>{calendar?.bpsStatus ?? "BPS_API_KEY required; free registration available"}</span>
                </p>
              </div>
            </div>
            <button
              className="primary-button full"
              onClick={() => setSettingsOpen(false)}
            >
              APPLY SETTINGS
            </button>
          </section>
        </div>
      )}
    </main>
  );
}

function GprMap() {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!container.current) return;
    let map: import("leaflet").Map | null = null;
    import("leaflet").then((L) => {
      if (!container.current) return;
      map = L.map(container.current, { zoomControl: true, scrollWheelZoom: false, zoomSnap: .25, worldCopyJump: true }).setView([22, 175], 2.5);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 6 }).addTo(map);
      const anchors = [
        { label: "SEA regional anchor · placeholder", coordinates: [3, 108] as [number, number], color: "#48a6ff" },
        { label: "China regional anchor · placeholder", coordinates: [35, 104] as [number, number], color: "#ff9840" },
        { label: "United States regional anchor · placeholder", coordinates: [39, 262] as [number, number], color: "#ff6678" },
      ];
      anchors.forEach((anchor) => L.circleMarker(anchor.coordinates, { radius: 9, color: anchor.color, fillColor: anchor.color, fillOpacity: .35, weight: 2 }).addTo(map!).bindPopup(`<strong>${anchor.label}</strong><br/>No validated event data.`));
    });
    return () => { map?.remove(); };
  }, []);
  return <div ref={container} className="gpr-map" aria-label="Placeholder geopolitical risk map for SEA, China and the United States" />;
}

function RegimeCanvas({
  points,
  range,
  events,
}: {
  points: RegimePoint[];
  range: "6M" | "1Y" | "3Y";
  events: RegimeEvent[];
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const visible = useMemo(
    () => points.slice(-(range === "6M" ? 6 : range === "1Y" ? 12 : 36)),
    [points, range],
  );
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const draw = () => {
      const rect = el.getBoundingClientRect();
      const scale = window.devicePixelRatio || 1;
      el.width = rect.width * scale;
      el.height = rect.height * scale;
      const ctx = el.getContext("2d");
      if (!ctx) return;
      ctx.scale(scale, scale);
      const w = rect.width,
        h = rect.height,
        pad = 34;
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = "#202a35";
      ctx.lineWidth = 1;
      for (let i = 0; i <= 8; i++) {
        const x = pad + ((w - pad * 2) * i) / 8;
        const y = pad + ((h - pad * 2) * i) / 8;
        ctx.beginPath();
        ctx.moveTo(x, pad);
        ctx.lineTo(x, h - pad);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(pad, y);
        ctx.lineTo(w - pad, y);
        ctx.stroke();
      }
      ctx.strokeStyle = "#485868";
      ctx.beginPath();
      ctx.moveTo(w / 2, pad);
      ctx.lineTo(w / 2, h - pad);
      ctx.moveTo(pad, h / 2);
      ctx.lineTo(w - pad, h / 2);
      ctx.stroke();
      const xy = (p: RegimePoint) => ({
        x:
          pad + ((Math.max(-2, Math.min(2, p.growth)) + 2) / 4) * (w - pad * 2),
        y:
          pad +
          ((2 - Math.max(-2, Math.min(2, p.inflation))) / 4) * (h - pad * 2),
      });
      ctx.strokeStyle = "#48a6ff";
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      visible.forEach((p, i) => {
        const q = xy(p);
        i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
      });
      ctx.stroke();
      visible.forEach((p, i) => {
        const q = xy(p);
        ctx.fillStyle = i === visible.length - 1 ? "#ff9840" : "#48a6ff";
        ctx.beginPath();
        ctx.arc(q.x, q.y, i === visible.length - 1 ? 6 : 3.6, 0, Math.PI * 2);
        ctx.fill();
        if (
          i === 0 ||
          i === visible.length - 1 ||
          i === Math.floor(visible.length / 2)
        ) {
          ctx.fillStyle = "#93a0af";
          ctx.font = "9px monospace";
          ctx.fillText(formatDate(p.date), q.x + 7, q.y - 7);
        }
        const marker = events.find((event) => event.date.slice(0, 7) === p.date.slice(0, 7));
        if (marker) {
          ctx.strokeStyle = "#ff6678"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(q.x, q.y, 7, 0, Math.PI * 2); ctx.stroke();
          ctx.fillStyle = "#ff6678"; ctx.font = "8px monospace"; ctx.fillText(marker.label, Math.min(q.x + 10, w - 170), Math.max(q.y - 11, 16));
        }
      });
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    return () => ro.disconnect();
  }, [visible, events]);
  const last = visible.at(-1);
  return (
    <div className="regime-canvas-wrap">
      <span className="quadrant q1">STAGFLATION</span>
      <span className="quadrant q2">OVERHEAT</span>
      <span className="quadrant q3">DEFLATION</span>
      <span className="quadrant q4">REFLATION</span>
      <div
        className="regime-sector-overlay"
        aria-label="Typical IDX sector alignment by regime"
      >
        <span className="sector-stag">ENERGY · BASIC MATERIALS</span>
        <span className="sector-heat">FINANCIALS · INDUSTRIALS</span>
        <span className="sector-def">HEALTHCARE · NON-CYCLICALS</span>
        <span className="sector-ref">TECHNOLOGY · CYCLICALS</span>
      </div>
      <canvas
        ref={canvas}
        aria-label={`Historical growth and inflation z-score path for ${range}`}
      />
      <span className="canvas-axis x">GROWTH Z-SCORE</span>
      <span className="canvas-axis y">INFLATION Z-SCORE</span>
      {last && (
        <span className="canvas-current">
          THROUGH {formatDate(last.date)} · G {signed(last.growth)} · I{" "}
          {signed(last.inflation)}
        </span>
      )}
    </div>
  );
}

function CotChart({ series }: { series: CotSeries }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const points = useMemo(() => series.points.slice(-52), [series]);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const draw = () => {
      const rect = el.getBoundingClientRect(),
        scale = window.devicePixelRatio || 1;
      el.width = rect.width * scale;
      el.height = rect.height * scale;
      const ctx = el.getContext("2d");
      if (!ctx) return;
      ctx.scale(scale, scale);
      const w = rect.width,
        h = rect.height,
        pad = 38;
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = "#242424";
      ctx.lineWidth = 1;
      for (let i = 0; i <= 5; i++) {
        const y = pad + ((h - pad * 2) * i) / 5;
        ctx.beginPath();
        ctx.moveTo(pad, y);
        ctx.lineTo(w - pad, y);
        ctx.stroke();
      }
      const all = points.flatMap((point) =>
        series.groups.map((group) => point.values[group] ?? 0),
      );
      const max = Math.max(...all.map(Math.abs), 1);
      const colors = ["#48a6ff", "#ff9840", "#43d4a3"];
      series.groups.forEach((group, groupIndex) => {
        ctx.strokeStyle = colors[groupIndex];
        ctx.lineWidth = 2;
        ctx.beginPath();
        points.forEach((point, index) => {
          const x =
            pad + (w - pad * 2) * (index / Math.max(points.length - 1, 1));
          const y = h / 2 - ((point.values[group] ?? 0) / max) * (h / 2 - pad);
          index ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        });
        ctx.stroke();
      });
      ctx.strokeStyle = "#55606d";
      ctx.beginPath();
      ctx.moveTo(pad, h / 2);
      ctx.lineTo(w - pad, h / 2);
      ctx.stroke();
      ctx.fillStyle = "#778596";
      ctx.font = "8px monospace";
      ctx.fillText(compact(max), 4, pad + 3);
      ctx.fillText("0", 18, h / 2 + 3);
      ctx.fillText(compact(-max), 4, h - pad + 3);
      if (points.length) {
        ctx.fillText(formatDate(points[0].date), pad, h - 10);
        const end = formatDate(points.at(-1)!.date);
        ctx.fillText(end, w - pad - 46, h - 10);
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    return () => ro.disconnect();
  }, [points, series]);
  return (
    <div className="cot-chart">
      <div className="cot-legend">
        {series.groups.map((group, index) => (
          <span key={group}>
            <i className={`line-${index}`} />
            {group}
          </span>
        ))}
      </div>
      <canvas
        ref={canvas}
        aria-label={`${series.label} net positioning by trader type over 52 weeks`}
      />
    </div>
  );
}
function CotTable({ series }: { series: CotSeries }) {
  const rows = series.points.slice(-6).reverse();
  return (
    <div className="cot-table">
      <div className="cot-row cot-head">
        <span>REPORT</span>
        {series.groups.map((group) => (
          <span key={group}>{group}</span>
        ))}
      </div>
      {rows.map((point, index) => {
        const prior = series.points[series.points.length - 2 - index];
        return (
          <div className="cot-row" key={point.date}>
            <strong>{formatDate(point.date)}</strong>
            {series.groups.map((group) => {
              const change = prior
                ? (point.values[group] ?? 0) - (prior.values[group] ?? 0)
                : 0;
              return (
                <span key={group}>
                  <b>{compact(point.values[group] ?? 0)}</b>
                  <small className={change >= 0 ? "positive" : "negative"}>
                    {change >= 0 ? "+" : ""}
                    {compact(change)} WoW
                  </small>
                </span>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
function FeedUnavailable({ title, body }: { title: string; body: string }) {
  return (
    <div className="feed-unavailable">
      <span>CONNECTION STATUS</span>
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}
function TickerStat({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}
function TickerPriceChart({ points }: { points: Array<{ date: string; close: number }> }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current; if (!element || points.length < 2) return;
    const draw = () => {
      const rect = element.getBoundingClientRect(), scale = window.devicePixelRatio || 1;
      element.width = rect.width * scale; element.height = rect.height * scale;
      const context = element.getContext("2d"); if (!context) return; context.scale(scale, scale);
      const width = rect.width, height = rect.height, pad = 28, values = points.map((point) => point.close), low = Math.min(...values), high = Math.max(...values), span = high - low || 1;
      context.clearRect(0, 0, width, height); context.strokeStyle = "#202a35"; context.lineWidth = 1;
      for (let index = 0; index < 5; index++) { const y = pad + ((height - pad * 2) * index) / 4; context.beginPath(); context.moveTo(pad, y); context.lineTo(width - pad, y); context.stroke(); }
      context.strokeStyle = "#48a6ff"; context.lineWidth = 2; context.beginPath();
      points.forEach((point, index) => { const x = pad + ((width - pad * 2) * index) / (points.length - 1), y = pad + ((high - point.close) / span) * (height - pad * 2); index ? context.lineTo(x, y) : context.moveTo(x, y); }); context.stroke();
      context.fillStyle = "#788594"; context.font = "8px monospace"; context.fillText(high.toLocaleString("en-US", { maximumFractionDigits: 2 }), pad, 14); context.fillText(low.toLocaleString("en-US", { maximumFractionDigits: 2 }), pad, height - 8); context.fillText(formatDate(points[0].date), pad, height - pad + 16); const end = formatDate(points.at(-1)!.date); context.fillText(end, width - pad - context.measureText(end).width, height - pad + 16);
    };
    draw(); const observer = new ResizeObserver(draw); observer.observe(element); return () => observer.disconnect();
  }, [points]);
  return points.length > 1 ? <div className="ticker-price-chart"><canvas ref={canvas} /></div> : <p className="ticker-empty">No historical price data available for this range.</p>;
}

function Watchlist({
  watchlist,
  configuredTickers,
  live,
  tickerInput,
  setTickerInput,
  addTicker,
  removeTicker,
  openTickerDetail,
}: {
  watchlist: Array<{ ticker: string; price: number; change: number }>;
  configuredTickers: string[];
  live: boolean;
  tickerInput: string;
  setTickerInput: (value: string) => void;
  addTicker: () => void;
  removeTicker: (ticker: string) => void;
  openTickerDetail: (ticker: string) => void;
}) {
  return (
    <article className="panel watch-panel">
      <PanelHead index="01" title="IDX WATCHLIST"><span className="head-note">SAVED ON THIS DEVICE</span></PanelHead>
      <form className="watch-add" onSubmit={(event) => { event.preventDefault(); addTicker(); }}>
        <input value={tickerInput} onChange={(event) => setTickerInput(event.target.value.toUpperCase())} placeholder="Search IDX ticker, e.g. BBCA" aria-label="Add IDX ticker" maxLength={10} />
        <button type="button" onClick={() => openTickerDetail(tickerInput)}>VIEW DETAIL</button>
        <button type="submit">ADD TICKER</button>
      </form>
      <div className="watch-table table-head">
        <span>TICKER</span>
        <span>LAST</span>
        <span>1D</span>
        <span />
      </div>
      {configuredTickers.map((ticker) => {
        const stock = watchlist.find((item) => item.ticker === ticker);
        return <div className="watch-table" key={ticker}>
          <button className="ticker-link" onClick={() => openTickerDetail(ticker)}>{ticker}</button>
          <span>
            {stock ? stock.price.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—"}
          </span>
          <span className={stock ? (stock.change >= 0 ? "positive" : "negative") : ""}>
            {stock ? `${signed(stock.change)}%` : "NO DATA"}
          </span>
          <button className="watch-remove" onClick={() => removeTicker(ticker)} aria-label={`Remove ${ticker}`}>×</button>
        </div>;
      })}
      <PanelFoot
        left={`${configuredTickers.length} CUSTOM TICKERS · MAX 12`}
        right={live ? "LIVE · DAILY" : "ILLUSTRATIVE DATA"}
      />
    </article>
  );
}
function Calendar({ data }: { data: CalendarData | null }) {
  const rows =
    data?.events.map((event) => {
      const date = new Date(
        `${event.date}${event.date.includes("T") ? "" : "T00:00:00Z"}`,
      );
      return {
        time: event.dateOnly
          ? date
              .toLocaleDateString("en-GB", {
                day: "2-digit",
                month: "short",
                timeZone: "UTC",
              })
              .toUpperCase()
          : Number.isNaN(date.getTime())
            ? "—"
            : date.toLocaleTimeString("en-GB", {
                hour: "2-digit",
                minute: "2-digit",
                timeZone: "Asia/Jakarta",
              }),
        country: countryCode(event.country),
        event: event.event,
        forecast: event.forecast,
        prior: event.prior,
        status: event.importance >= 3 ? "HIGH" : "MED",
      };
    }) ?? releases;
  return (
    <article className="panel calendar-panel">
      <PanelHead index="02" title="ECONOMIC CALENDAR">
        <span className="demo-badge">{data ? "LIVE" : "DEMO"}</span>
      </PanelHead>
      <div className="date-rule">
        <strong>NEXT 7 DAYS</strong>
        <span>{rows.length} RELEASES</span>
      </div>
      {rows.slice(0, 6).map((r, index) => (
        <div className="release-row" key={`${r.event}-${index}`}>
          <time>{r.time}</time>
          <span className="country-tag">{r.country}</span>
          <div>
            <strong>{r.event}</strong>
            <small>
              FCST {r.forecast} · PRIOR {r.prior}
            </small>
          </div>
          <span className={`importance ${r.status.toLowerCase()}`}>
            {r.status}
          </span>
        </div>
      ))}
      <PanelFoot
        left={
          data
            ? data.source.toUpperCase()
            : "CALENDAR CONNECTION UNAVAILABLE"
        }
        right={data ? (data.bpsStatus?.includes("connected") ? "US + INDONESIA OFFICIAL SCHEDULES" : "US OFFICIAL · BPS KEY REQUIRED") : "NO LIVE VALUES"}
      />
    </article>
  );
}
function YieldCurve({ values, live, status }: { values: number[]; live: boolean; status?: FredData["curveStatus"] }) {
  const spread = (values[4] - values[2]) * 100;
  return (
    <article className="panel curve-panel">
      <PanelHead index="03" title="US TREASURY CURVE">
        <span className={`curve-status ${status?.changed ? "changed" : ""}`}>
          <i />
          {spread < 0 ? "INVERTED" : "NORMAL"} {signed(spread)} BP
          {status?.changed && <b className="threshold-badge curve-change">STATUS CHANGED · {status.previous.toUpperCase()} → {status.current.toUpperCase()}</b>}
        </span>
      </PanelHead>
      <div className="curve-chart">
        <div className="curve-bars">
          {values.map((point, index) => (
            <div className="curve-column" key={index}>
              <span>{point.toFixed(2)}%</span>
              <i
                style={{ height: `${Math.max(18, 34 + (point - 3) * 58)}px` }}
              />
              <b>{["3M", "1Y", "2Y", "5Y", "10Y", "20Y", "30Y"][index]}</b>
            </div>
          ))}
        </div>
        <div className="curve-baseline" />
      </div>
      <div className="curve-callouts">
        <div>
          <span>2Y</span>
          <strong>{values[2].toFixed(2)}%</strong>
        </div>
        <div>
          <span>10Y</span>
          <strong>{values[4].toFixed(2)}%</strong>
        </div>
        <div>
          <span>30Y</span>
          <strong>{values[6].toFixed(2)}%</strong>
        </div>
      </div>
      <PanelFoot
        left="TREASURY CONSTANT MATURITY RATES"
        right={live ? "FRED LIVE" : "ILLUSTRATIVE DATA"}
      />
    </article>
  );
}
function MetricCard({
  label,
  value,
  condition,
  implication,
  source,
  tone,
}: {
  label: string;
  value: string;
  condition: string;
  implication: string;
  source: string;
  tone?: string;
}) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <div className="metric-reading">
        <strong className={tone}>{value}</strong>
        <b>{condition}</b>
      </div>
      <p>{implication}</p>
      <small>{source}</small>
    </div>
  );
}
function PanelHead({
  index: _index,
  title,
  children,
}: {
  index: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="panel-head">
      <div>
        <h2>{title}</h2>
      </div>
      {children}
    </header>
  );
}
function PanelFoot({ left, right }: { left: string; right: string }) {
  return (
    <footer className="panel-foot">
      <span>{left}</span>
      <span>{right}</span>
    </footer>
  );
}
function signed(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}
function formatNumber(value: number, unit: string) {
  return `${value.toFixed(unit ? 2 : 1)}${unit}`;
}
function zTone(z: number) {
  return z > 0.75 ? "hot" : z > 0.25 ? "warm" : z < -0.25 ? "cool" : "neutral";
}
function heatTone(value: number) {
  const n = Math.abs(value);
  return value >= 0
    ? n > 1.5
      ? "up3"
      : n > 0.6
        ? "up2"
        : "up1"
    : n > 1.5
      ? "down3"
      : n > 0.6
        ? "down2"
        : "down1";
}
function formatDate(date: string) {
  return new Date(date + "T00:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
}
function formatNoteTime(value: string) {
  return new Date(value).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta", timeZoneName: "short" }).toUpperCase();
}
const REGIME_BORDER = 0.25;
function regimeLabel(point: RegimePoint) {
  if (
    Math.abs(point.growth) < REGIME_BORDER ||
    Math.abs(point.inflation) < REGIME_BORDER
  )
    return "TRANSITION";
  return point.growth < 0 && point.inflation > 0
    ? "STAGFLATION"
    : point.growth > 0 && point.inflation > 0
      ? "OVERHEAT"
      : point.growth < 0
        ? "DEFLATION"
        : "REFLATION";
}
function spreadLabel(spread: number) {
  return spread < -25
    ? "DEEPLY INVERTED"
    : spread < 0
      ? "SLIGHTLY INVERTED"
      : spread < 50
        ? "NORMAL · FLAT"
        : "STEEPENING";
}
function relativeLabel(last: number, average: number, name: string) {
  if (!last || !average) return `${name} CONTEXT PENDING`;
  const gap = (last / average - 1) * 100;
  return gap > 2
    ? `ABOVE 20D AVG · ${signed(gap)}%`
    : gap < -2
      ? `BELOW 20D AVG · ${signed(gap)}%`
      : `NEAR 20D AVG · ${signed(gap)}%`;
}
function countryCode(country: string) {
  const value = country.toLowerCase();
  return value.includes("indonesia")
    ? "ID"
    : value.includes("china")
      ? "CN"
      : value.includes("united states")
        ? "US"
        : country.slice(0, 2).toUpperCase();
}
function monthName(month: number) {
  return [
    "JAN",
    "FEB",
    "MAR",
    "APR",
    "MAY",
    "JUN",
    "JUL",
    "AUG",
    "SEP",
    "OCT",
    "NOV",
    "DEC",
  ][month - 1];
}
function compact(value: number) {
  const absolute = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  return absolute >= 1_000_000
    ? `${sign}${(absolute / 1_000_000).toFixed(1)}M`
    : absolute >= 1_000
      ? `${sign}${(absolute / 1_000).toFixed(1)}K`
      : `${Math.round(value)}`;
}
function pearson(xs: number[], ys: number[]) {
  if (xs.length < 10 || xs.length !== ys.length) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let top = 0,
    xx = 0,
    yy = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - mx,
      dy = ys[i] - my;
    top += dx * dy;
    xx += dx * dx;
    yy += dy * dy;
  }
  const bottom = Math.sqrt(xx * yy);
  return bottom ? top / bottom : null;
}
function marketCorrelationMatrix(markets: MarketData | null) {
  const names = [...new Set(["COAL", "NICKEL", "OIL", "DXY", "JKSE", ...(markets?.watchlist.map((item) => item.ticker) ?? [])])];
  if (!markets || !names.every((name) => markets.assets.some((item) => item.name === name))) return null;
  const returns = new Map<string, Map<string, number>>();
  for (const name of names) {
    const asset = markets.assets.find((item) => item.name === name)!; const byDate = new Map<string, number>();
    asset.timestamps.forEach((stamp, index) => {
      const close = asset.closes[index], prior = asset.closes[index - 1];
      if (close !== null && prior !== null && prior) byDate.set(new Date(stamp * 1000).toISOString().slice(0, 10), (close / prior - 1) * 100);
    });
    returns.set(name, byDate);
  }
  const rows = names.map((rowName) => {
    const row = names.map((columnName) => {
      if (rowName === columnName) return "1.00";
      const left = returns.get(rowName)!, right = returns.get(columnName)!; const xs: number[] = [], ys: number[] = [];
      for (const [date, value] of left) if (right.has(date)) { xs.push(value); ys.push(right.get(date)!); }
      if (xs.length < 60) return null;
      return pearson(xs.slice(-60), ys.slice(-60))?.toFixed(2) ?? null;
    });
    return row.some((value) => value === null) ? null : [rowName === "NICKEL" ? "VALE EQ." : rowName, ...(row as string[])];
  });
  if (rows.some((row) => row === null)) return null;
  const label = (name: string) => name === "NICKEL" ? "VALE EQ." : name === "COAL" ? "COAL ETF" : name;
  return { names: names.map(label), rows: (rows as string[][]).map((row) => [label(row[0]), ...row.slice(1)]) };
}
function correlationMatrix(
  gdelt: GdeltData | null,
  markets: MarketData | null,
) {
  const regionNames = ["SEA", "CHINA", "US"],
    assetNames = ["COAL", "NICKEL", "OIL", "DXY", "JKSE"];
  if (
    !gdelt ||
    gdelt.status !== "live" ||
    !markets ||
    !regionNames.every((name) =>
      gdelt.regions.some((item) => item.region === name),
    ) ||
    !assetNames.every((name) =>
      markets.assets.some((item) => item.name === name),
    )
  )
    return null;
  const rows = regionNames.map((regionName) => {
    const region = gdelt.regions.find((item) => item.region === regionName)!;
    const riskByDate = new Map(
      region.timeline.map((point, index) => {
        const prior = region.timeline[index - 1]?.zScore;
        return [
          point.date,
          point.zScore !== null && prior !== null && prior !== undefined
            ? point.zScore - prior
            : null,
        ];
      }),
    );
    const values = assetNames.map((name) => {
      const asset = markets.assets.find((item) => item.name === name)!;
      const xs: number[] = [],
        ys: number[] = [];
      asset.timestamps.forEach((stamp, index) => {
        const close = asset.closes[index],
          prior = asset.closes[index - 1];
        const date = new Date(stamp * 1000).toISOString().slice(0, 10);
        const risk = riskByDate.get(date);
        if (
          close !== null &&
          prior !== null &&
          prior &&
          risk !== null &&
          risk !== undefined
        ) {
          xs.push(risk);
          ys.push((close / prior - 1) * 100);
        }
      });
      if (xs.length < 60) return null;
      return pearson(xs.slice(-60), ys.slice(-60));
    });
    if (values.some((value) => value === null)) return null;
    return [
      `${region.region} GPR`,
      ...values.map((value) => value!.toFixed(2)),
    ];
  });
  return rows.some((row) => row === null) ? null : (rows as string[][]);
}
function riskFrequencyLabel(z: number) {
  return z >= 2
    ? "EXTREME FREQUENCY"
    : z >= 1
      ? "ELEVATED"
      : z <= -1
        ? "BELOW BASELINE"
        : "NEAR BASELINE";
}
function titleCase(value: string) {
  return value.toLowerCase().replace(/\b\w/g, (x) => x.toUpperCase());
}
function sectionDescription(section: Section) {
  return {
    OVERVIEW:
      "The readings that need attention before the next research session.",
    MACRO: "Live FRED signals for growth, inflation and the Treasury curve.",
    MARKETS: "Daily and weekly market performance with the IDX watchlist.",
    "GPR INDEX":
      "Auditable geopolitical risk inputs, weights and regional scores.",
    "GPR MAP":
      "Geographic event-layer structure, clearly separated from unavailable live GPR data.",
    CORRELATIONS:
      "Rolling relationships between regional risk and selected market series.",
    SEASONALITY:
      "Historical monthly return tendencies across selected IDX names and the benchmark.",
    "MARKET PARTICIPANT":
      "Weekly CFTC positioning by trader category for major futures markets.",
  }[section];
}
