'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import dynamic from 'next/dynamic';
import StockSearch from '../components/StockSearch';
import PanelBoundary from '../components/PanelBoundary';
import NewsIntelligence from '../components/NewsIntelligence';
import QuantLab from '../components/QuantLab';
import QuantamentalMap from '../components/QuantamentalMap';
import PortfolioStressLab from '../components/PortfolioStressLab';
import FeedbackModal from '../components/FeedbackModal';
import FeedbackInbox from '../components/FeedbackInbox';
import ResearchPapers from '../components/ResearchPapers';
import SettingsLogout from '../components/SettingsLogout';
import WeeklyDigestOptIn from '../components/WeeklyDigestOptIn';
import RiskMap from '../components/RiskMap';
import DataStatusBar from '../components/DataStatusBar';
import OnboardingModal from '../components/OnboardingModal';
import CommandPalette from '../components/CommandPalette';
import PlanCard from '../components/PlanCard';
import { SCHEMES, formatNoteTimestamp, isScheme, parseSavedNote, type Scheme } from '../lib/preferences';
import { useDialogFocus } from '../lib/use-dialog-focus';
import { normalizeTicker } from '../lib/workspace';
import { buildVisitSnapshot, describeVisitDelta, parseVisitSnapshot, visitAgeLabel, type VisitSnapshot } from '../lib/visit-snapshot';
import { trackEvent } from '../lib/analytics-client';

const StockDetailModal = dynamic(() => import('../components/StockDetailModal'), { ssr: false });


type Section = 'OVERVIEW' | 'MACRO' | 'MARKETS' | 'NEWS' | 'QUANT LAB' | 'QUANTAMENTAL' | 'PORTFOLIO' | 'RISK MAP' | 'RESEARCH PAPERS' | 'SEASONALITY' | 'MARKET PARTICIPANT';
type RegimePoint = { date: string; growth: number; inflation: number };
type FredData = { status: string; freshness: string; indicators: Array<{ name: string; actual: number; mean: number; z: number; unit: string }>; yields: Array<{ maturity: string; value: number }>; regime: RegimePoint[] };
type Constituent = { ticker: string; price: number; daily: number | null; weekly: number | null };
type MarketData = { status: string; freshness: string; failures?: string[]; watchlist: Array<{ ticker: string; price: number; change: number }>; heatmap: Array<{ label: string; symbol: string; daily: number | null; weekly: number | null; constituents: Constituent[]; method?: string; validCount?: number; memberCount?: number; confidence?: string }>; assets: Array<{ name: string; timestamps: number[]; closes: Array<number | null> }> };
type GdeltData = { status: string; freshness: string; frequencyScore: number; severityStatus: string; regions: Array<{ region: string; score: number; timeline: Array<{ date: string; value: number }> }> };
type CalendarData = { status: string; freshness: string; events: Array<{ date: string; country: string; event: string; forecast: string; prior: string; importance: number }> };
type SeasonalityData = { status: string; ticker: string; symbol: string; years: number; from: number; through: number; months: Array<{ month: number; average: number; positiveRate: number; observations: number }> };
type CotSeries = { key: string; label: string; groups: string[]; latest: string; points: Array<{ date: string; values: Record<string,number> }> };
type CotData = { status: string; source: string; freshness: string; series: CotSeries[]; failures: string[] };

type NavGroup = 'MONITOR' | 'DECIDE' | 'RESEARCH';
const navigation = [
  { label: 'OVERVIEW', icon: '⌂', group: 'MONITOR' },
  { label: 'MACRO', icon: '∿', group: 'MONITOR' },
  { label: 'MARKETS', icon: '◇', group: 'MONITOR' },
  { label: 'NEWS', icon: '◫', group: 'MONITOR' },
  { label: 'QUANT LAB', icon: 'Σ', group: 'DECIDE' },
  { label: 'QUANTAMENTAL', icon: '◉', group: 'DECIDE' },
  { label: 'PORTFOLIO', icon: '◈', group: 'DECIDE' },
  { label: 'RISK MAP', icon: '⌖', group: 'DECIDE' },
  { label: 'RESEARCH PAPERS', icon: '▤', group: 'RESEARCH' },
  { label: 'SEASONALITY', icon: '▦', group: 'RESEARCH' },
  { label: 'MARKET PARTICIPANT', icon: '≋', group: 'RESEARCH' },
] as const satisfies ReadonlyArray<{ label: Section; icon: string; group: NavGroup }>;
const navDesc: Record<(typeof navigation)[number]['label'], string> = {
  OVERVIEW: 'What needs attention now',
  MACRO: 'Growth, inflation, curve',
  MARKETS: 'Daily & weekly performance',
  NEWS: 'Ranked by decision impact',
  'QUANT LAB': 'Cross-asset & IDX signals',
  QUANTAMENTAL: 'Valuation vs momentum map',
  PORTFOLIO: 'Exposure and stress',
  'RISK MAP': 'Chokepoints, conflict, hazards',
  'RESEARCH PAPERS': 'Institutional library',
  SEASONALITY: 'Monthly return tendencies',
  'MARKET PARTICIPANT': 'CFTC positioning',
};
const navBadge = (label: Section) => (label === 'QUANT LAB' ? 'SETUPS · BETA' : label === 'QUANTAMENTAL' ? 'QUANTAMENTAL · BETA' : label === 'NEWS' || label === 'PORTFOLIO' ? `${label} · BETA` : label);
/** Number-key shortcut for a nav slot: 1..9, then 0 for the tenth. */
const navShortcut = (index: number) => (index === 9 ? '0' : index < 9 ? String(index + 1) : '—');

function sectionSlug(section: Section) {
  return section.toLowerCase().replace(/\s+/g, "-");
}
function sectionFromHash(): Section {
  if (typeof window === "undefined") return "OVERVIEW";
  const slug = window.location.hash.replace(/^#/, "").toLowerCase();
  return navigation.find((item) => sectionSlug(item.label) === slug)?.label ?? "OVERVIEW";
}

export default function Home() {
  const [active, setActive] = useState<Section>('OVERVIEW');
  const navRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [now, setNow] = useState<Date | null>(null);
  const [range, setRange] = useState<'6M' | '1Y' | '3Y'>('1Y');
  const [heatPeriod, setHeatPeriod] = useState<'1D' | '1W'>('1D');
  const [selectedSector, setSelectedSector] = useState('ENERGY');
  const [seasonTicker, setSeasonTicker] = useState('BUMI'); const [seasonality, setSeasonality] = useState<SeasonalityData|null>(null);
  const [cot, setCot] = useState<CotData|null>(null); const [cotAsset, setCotAsset] = useState('USD');
  const [notesOpen, setNotesOpen] = useState(false); const [settingsOpen, setSettingsOpen] = useState(false); const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const [previousVisit, setPreviousVisit] = useState<VisitSnapshot | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);
  const [visitSaved, setVisitSaved] = useState(false);
  const [watchlistManaged, setWatchlistManaged] = useState(false);
  const [noteHistory, setNoteHistory] = useState<Array<{ id: number | string; body: string; created_at: string }>>([]);
  const modalOpenRef = useRef(false);
  // Keep the global shortcut handler aware of overlays without re-binding it every render.
  useEffect(() => { modalOpenRef.current = notesOpen || settingsOpen || feedbackOpen || onboardingOpen || commandOpen; }, [notesOpen, settingsOpen, feedbackOpen, onboardingOpen, commandOpen]);
  // On the mobile bottom bar, keep the active section scrolled into view.
  useEffect(() => {
    if (!window.matchMedia('(max-width: 720px)').matches) return;
    navRefs.current[active]?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [active]);
  const [scheme, setScheme] = useState<Scheme>('default'); const [note, setNote] = useState('');
  const [savedNote, setSavedNote] = useState('');
  const [savedNoteAt, setSavedNoteAt] = useState<string | null>(null);
  const notesDialogRef = useDialogFocus<HTMLElement>(notesOpen, () => setNotesOpen(false));
  const settingsDialogRef = useDialogFocus<HTMLElement>(settingsOpen, () => setSettingsOpen(false));

  useEffect(() => {
    try {
      const storedScheme = localStorage.getItem('jarvis_scheme');
      if (isScheme(storedScheme)) setScheme(storedScheme);
      const parsedNote = parseSavedNote(localStorage.getItem('jarvis_note'));
      if (parsedNote) {
        setSavedNote(parsedNote.text);
        setSavedNoteAt(parsedNote.savedAt);
      }
      const storedVisit = parseVisitSnapshot(localStorage.getItem('jarvis_visit_snapshot'));
      if (storedVisit) setPreviousVisit(storedVisit);
      setOnboardingComplete(localStorage.getItem('jarvis_onboarding_complete_v1') === '1');
      if (localStorage.getItem('jarvis_watchlist_managed') === '1') setWatchlistManaged(true);
    } catch {}
  }, []);

  const savePreferences = (payload: Record<string, unknown>) => {
    void fetch('/api/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(payload),
    }).catch(() => undefined);
  };

  // Load account-scoped workspace state. Each request is allowed to fail
  // independently so a missing migration never blocks the research terminal.
  useEffect(() => {
    let cancelled = false;
    const preferencesRequest = fetch('/api/preferences', { credentials: 'same-origin' })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data: { preferences?: Record<string, unknown> }) => data.preferences ?? null);
    const notesRequest = fetch('/api/notes?limit=20', { credentials: 'same-origin' })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data: { notes?: Array<{ id: number | string; body: string; created_at: string }> }) => data.notes ?? []);

    Promise.allSettled([preferencesRequest, notesRequest]).then(([preferencesResult, notesResult]) => {
      if (cancelled) return;

      let remoteOnboarding = false;
      if (preferencesResult.status === 'fulfilled' && preferencesResult.value) {
        const preferences = preferencesResult.value;
        if (isScheme(preferences.color_scheme)) {
          setScheme(preferences.color_scheme);
          try { localStorage.setItem('jarvis_scheme', preferences.color_scheme); } catch {}
        }
        remoteOnboarding = preferences.onboarding_complete === true;
        if (remoteOnboarding) {
          setOnboardingComplete(true);
          try { localStorage.setItem('jarvis_onboarding_complete_v1', '1'); } catch {}
        }
        if (preferences.last_snapshot && typeof preferences.last_snapshot === 'object') {
          const remoteVisit = parseVisitSnapshot(JSON.stringify(preferences.last_snapshot));
          if (remoteVisit) setPreviousVisit((current) => current ?? remoteVisit);
        }
      }

      let localOnboarding = false;
      try { localOnboarding = localStorage.getItem('jarvis_onboarding_complete_v1') === '1'; } catch {}
      if (!remoteOnboarding && !localOnboarding) setOnboardingOpen(true);

      if (notesResult.status === 'fulfilled' && notesResult.value.length) {
        const history = notesResult.value;
        setNoteHistory(history);
        const latest = history[0];
        if (latest) {
          setSavedNote(latest.body);
          setSavedNoteAt(latest.created_at);
          try {
            localStorage.setItem('jarvis_note', JSON.stringify({ text: latest.body, savedAt: latest.created_at }));
          } catch {}
        }
      }
      setPreferencesReady(true);
    });

    return () => { cancelled = true; };
  }, []);

  const changeScheme = (next: Scheme) => {
    setScheme(next);
    try { localStorage.setItem('jarvis_scheme', next); } catch {}
    savePreferences({ colorScheme: next });
    trackEvent('preferences_save', { preference: 'color_scheme', value: next });
  };

  const [fred, setFred] = useState<FredData | null>(null); const [markets, setMarkets] = useState<MarketData | null>(null); const [gdelt, setGdelt] = useState<GdeltData | null>(null); const [calendar, setCalendar] = useState<CalendarData | null>(null);

  useEffect(() => {
    let cancelled = false;
    let lastLoaded = 0;
    const load = () => {
      if (cancelled || Date.now() - lastLoaded < 5 * 60 * 1000) return;
      lastLoaded = Date.now();
      Promise.allSettled([fetch('/api/fred').then((r) => r.ok ? r.json() : Promise.reject()), fetch('/api/markets').then((r) => r.ok ? r.json() : Promise.reject()), fetch('/api/gdelt').then((r) => r.ok ? r.json() : Promise.reject()), fetch('/api/calendar').then((r) => r.ok ? r.json() : Promise.reject()), fetch('/api/cot').then((r) => r.ok ? r.json() : Promise.reject())]).then(([fredResult, marketResult, gdeltResult, calendarResult, cotResult]) => {
        if (cancelled) return;
        if (fredResult.status === 'fulfilled') setFred(fredResult.value as FredData);
        if (marketResult.status === 'fulfilled') setMarkets(marketResult.value as MarketData);
        if (gdeltResult.status === 'fulfilled') setGdelt(gdeltResult.value as GdeltData);
        if (calendarResult.status === 'fulfilled') setCalendar(calendarResult.value as CalendarData);
        if (cotResult.status === 'fulfilled') setCot(cotResult.value as CotData);
        setLastLoadedAt(new Date().toISOString());
      });
    };
    load();

    // Refresh stale feeds when the tab returns to the foreground, but never
    // more than once every five minutes.
    const onVisibility = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisibility);

    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('textarea, input, select, [contenteditable="true"]')) return;
      if (event.key === 'Escape') { setNotesOpen(false); setSettingsOpen(false); setFeedbackOpen(false); return; }
      if (modalOpenRef.current) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === 'n') { setNotesOpen(true); return; }
      if (key === 's') { setSettingsOpen(true); return; }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => { setSeasonality(null); fetch(`/api/seasonality?ticker=${seasonTicker}`).then((response)=>response.ok?response.json():Promise.reject()).then((data)=>setSeasonality(data as SeasonalityData)).catch(()=>setSeasonality(null)); }, [seasonTicker]);


  useEffect(() => {
    const updateClock = () => setNow(new Date());
    const syncSection = () => setActive(sectionFromHash());
    updateClock();
    syncSection();
    const clock = window.setInterval(updateClock, 30000);
    window.addEventListener("popstate", syncSection);
    window.addEventListener("hashchange", syncSection);
    return () => {
      window.clearInterval(clock);
      window.removeEventListener("popstate", syncSection);
      window.removeEventListener("hashchange", syncSection);
    };
  }, []);

  const changeSection = (section: Section) => {
    const nextHash = `#${sectionSlug(section)}`;
    if (window.location.hash !== nextHash) {
      window.history.pushState({ ...window.history.state, jarvisSection: section }, "", nextHash);
    }
    setActive(section);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Number keys jump between sections: 1..9 for the first nine slots, 0 for the tenth.
  // Declared after changeSection so the closure is past its initialiser.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (modalOpenRef.current) return;
      if (!/^[0-9]$/.test(event.key) || event.metaKey || event.ctrlKey || event.altKey) return;
      if ((event.target as HTMLElement | null)?.closest('textarea, input, select, [contenteditable="true"]')) return;
      const item = navigation[event.key === '0' ? 9 : Number(event.key) - 1];
      if (item) changeSection(item.label);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const wibDay = now?.toLocaleDateString("en-US", { weekday: "short", timeZone: "Asia/Jakarta" }).toUpperCase() ?? "—";
  const wibDate = now?.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Jakarta" }).toUpperCase() ?? "LOADING";
  const wibTime = now?.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Jakarta" }) ?? "—";

  const [notification, setNotification] = useState<string | null>(null);
  const [modalTicker, setModalTicker] = useState<string | null>(null);
  const [customWatchlist, setCustomWatchlist] = useState<Array<{ ticker: string; price: number; change: number }>>([]);
  const [watchlistSync, setWatchlistSync] = useState<'idle' | 'syncing' | 'synced' | 'local'>('idle');

  // Saved tickers outside the fixed starter list have no price until this
  // endpoint answers. Failures are left as "unavailable", never as zero.
  const refreshWatchQuotes = useCallback(async () => {
    try {
      const response = await fetch('/api/watchlist/quotes', { credentials: 'same-origin' });
      if (!response.ok) return;
      const data = await response.json() as { quotes?: Array<{ ticker: string; price: number; change: number }> };
      const quotes = Array.isArray(data.quotes) ? data.quotes : [];
      if (!quotes.length) return;
      const byTicker = new Map<string, { ticker: string; price: number; change: number }>();
      for (const quote of quotes) {
        const ticker = normalizeTicker(quote.ticker);
        if (ticker) byTicker.set(ticker, quote);
      }
      setCustomWatchlist((current) => current.map((item) => byTicker.get(item.ticker) ?? item));
    } catch {
      // Quotes are optional; each row shows an explicit unavailable state.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let localTickers: string[] = [];
    try {
      const saved = localStorage.getItem('jarvis_watchlist');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          localTickers = parsed
            .map((item) => normalizeTicker(item && typeof item === 'object' ? (item as { ticker?: unknown }).ticker : item))
            .filter((item): item is string => Boolean(item));
        }
      }
    } catch {}

    fetch('/api/watchlist', { credentials: 'same-origin' })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then(async (data: { tickers?: string[] }) => {
        let tickers = Array.isArray(data.tickers) ? data.tickers : [];
        let sync: 'synced' | 'local' = 'synced';
        if (!tickers.length && localTickers.length) {
          // One-time migration from the browser-only watchlist. Keep the local
          // copy if any write fails so a partial migration cannot lose data.
          const writes = await Promise.allSettled(localTickers.map((ticker) => fetch('/api/watchlist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ ticker }),
          })));
          tickers = localTickers;
          if (writes.every((write) => write.status === 'fulfilled' && write.value.ok)) {
            try { localStorage.removeItem('jarvis_watchlist'); } catch {}
          } else {
            sync = 'local';
          }
        }
        if (!cancelled) {
          setCustomWatchlist(tickers.map((ticker) => ({ ticker, price: 0, change: 0 })));
          if (tickers.length) {
            setWatchlistManaged(true);
            try { localStorage.setItem('jarvis_watchlist_managed', '1'); } catch {}
          }
          setWatchlistSync(sync);
          if (tickers.length && sync === 'synced') void refreshWatchQuotes();
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCustomWatchlist(localTickers.map((ticker) => ({ ticker, price: 0, change: 0 })));
          if (localTickers.length) {
            setWatchlistManaged(true);
            try { localStorage.setItem('jarvis_watchlist_managed', '1'); } catch {}
          }
          setWatchlistSync('local');
        }
      });

    return () => { cancelled = true; };
  }, [refreshWatchQuotes]);

  const openStockDetail = (ticker: string) => {
    if (!modalTicker) {
      window.history.pushState(
        { ...window.history.state, jarvisStockModal: true },
        "",
        window.location.href
      );
    }
    setModalTicker(ticker);
  };

  const handleStockSelect = (stock: { ticker: string; name: string; sector: string }) => {
    openStockDetail(stock.ticker);
  };

  const closeStockDetail = () => {
    if (window.history.state?.jarvisStockModal) {
      window.history.back();
    } else {
      setModalTicker(null);
    }
  };

  useEffect(() => {
    const closeModalOnBack = () => setModalTicker(null);
    window.addEventListener("popstate", closeModalOnBack);
    return () => window.removeEventListener("popstate", closeModalOnBack);
  }, []);

  const announce = (message: string) => {
    setNotification(message);
    window.setTimeout(() => setNotification(null), 4000);
  };

  const mirrorWatchlist = (items: Array<{ ticker: string; price: number; change: number }>) => {
    try { localStorage.setItem('jarvis_watchlist', JSON.stringify(items)); } catch {}
  };

  const addWatchlistTicker = (rawTicker: string) => {
    const ticker = normalizeTicker(rawTicker);
    if (!ticker) {
      announce('INVALID TICKER');
      return;
    }
    if (customWatchlist.some((item) => item.ticker === ticker)) {
      announce(`${ticker} IS ALREADY IN YOUR WATCHLIST`);
      return;
    }
    setWatchlistManaged(true);
    try { localStorage.setItem('jarvis_watchlist_managed', '1'); } catch {}
    setCustomWatchlist((prev) => {
      if (prev.some((item) => item.ticker === ticker)) return prev;
      const updated = [...prev, { ticker, price: 0, change: 0 }];
      mirrorWatchlist(updated);
      return updated;
    });
    setWatchlistSync('syncing');
    announce(`ADDED ${ticker} TO WATCHLIST`);
    trackEvent('watchlist_add', { ticker });
    void fetch('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ ticker }),
    })
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => null) as { error?: string } | null;
          throw new Error(payload?.error ?? 'Watchlist add rejected');
        }
        setWatchlistSync('synced');
        void refreshWatchQuotes();
      })
      .catch((reason: unknown) => {
        // Do not leave a ticker that only exists on this device looking saved.
        setCustomWatchlist((prev) => {
          const updated = prev.filter((item) => item.ticker !== ticker);
          mirrorWatchlist(updated);
          return updated;
        });
        setWatchlistSync('local');
        announce(reason instanceof Error ? reason.message.toUpperCase() : `COULD NOT SAVE ${ticker}`);
      });
  };

  const removeWatchlistTicker = (rawTicker: string) => {
    const ticker = normalizeTicker(rawTicker);
    if (!ticker) return;
    const removed = customWatchlist.find((item) => item.ticker === ticker);
    setWatchlistManaged(true);
    try { localStorage.setItem('jarvis_watchlist_managed', '1'); } catch {}
    setCustomWatchlist((prev) => {
      const updated = prev.filter((item) => item.ticker !== ticker);
      mirrorWatchlist(updated);
      return updated;
    });
    setWatchlistSync('syncing');
    announce(`REMOVED ${ticker} FROM WATCHLIST`);
    trackEvent('watchlist_remove', { ticker });
    void fetch(`/api/watchlist?ticker=${encodeURIComponent(ticker)}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    })
      .then((response) => {
        if (!response.ok) throw new Error('Watchlist remove rejected');
        setWatchlistSync('synced');
      })
      .catch(() => {
        if (removed) {
          setCustomWatchlist((prev) => {
            if (prev.some((item) => item.ticker === ticker)) return prev;
            const updated = [...prev, removed];
            mirrorWatchlist(updated);
            return updated;
          });
        }
        setWatchlistSync('local');
        announce(`COULD NOT REMOVE ${ticker} · CHANGE REVERTED`);
      });
  };

  const handleAddToWatchlist = (rawTicker: string) => {
    const ticker = normalizeTicker(rawTicker);
    if (!ticker) return;
    if (customWatchlist.some((item) => item.ticker === ticker)) removeWatchlistTicker(ticker);
    else addWatchlistTicker(ticker);
  };

  const indicators = fred?.indicators ?? []; const yields = fred?.yields.map((item) => item.value) ?? [];
  const baseWatchlist = useMemo(() => markets?.watchlist ?? [], [markets]);
  const watchlist = useMemo(() => {
    if (!watchlistManaged && !customWatchlist.length) return baseWatchlist;
    const map = new Map<string, { ticker: string; price: number; change: number }>();
    baseWatchlist.forEach((item) => map.set(item.ticker, item));
    return customWatchlist.map((item) => map.get(item.ticker) ?? item);
  }, [baseWatchlist, customWatchlist, watchlistManaged]);
  const heatmap = markets?.heatmap ?? [];
  const marketChange = (name: string) => { const values = markets?.assets.find((item) => item.name === name)?.closes.filter((x): x is number => x !== null) ?? []; const last = values.at(-1) ?? 0; const prior = values.at(-2) ?? last; const recent = values.slice(-20); const average = recent.length ? recent.reduce((sum, value) => sum + value, 0) / recent.length : 0; return { last, average, change: prior ? ((last / prior) - 1) * 100 : 0 }; };
  const dxy = marketChange('DXY'); const oil = marketChange('OIL');
  const liveCount = [fred, markets, gdelt, calendar, cot].filter((payload) => Boolean(payload) && (payload?.status === 'live' || payload?.status === 'partial')).length;
  const currentRegime = (fred?.regime ?? []).at(-1) ?? { date: '', growth: 0, inflation: 0 };
  const selectedHeat = heatmap.find((item) => item.label === selectedSector) ?? heatmap[0];
  const selectedCot = cot?.series.find((item) => item.key === cotAsset) ?? cot?.series[0] ?? null;

  const validSectorMoves = (markets?.heatmap ?? [])
    .map((item) => item.daily)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const positiveSectors = validSectorMoves.filter((value) => value > 0).length;
  const breadthAverage = validSectorMoves.length
    ? validSectorMoves.reduce((sum, value) => sum + value, 0) / validSectorMoves.length
    : null;
  const curveSpread = fred && yields.length > 1 ? yields[yields.length - 1] - yields[0] : null;
  const thesisEvidence: string[] = [];

  let thesisHeadline = "Waiting for enough live data to form a defensible thesis.";
  if (fred) {
    if (currentRegime.growth < 0 && currentRegime.inflation > 0) {
      thesisHeadline = "Stagflation pressure favors resilience over broad risk-taking.";
    } else if (currentRegime.growth >= 0 && currentRegime.inflation > 0) {
      thesisHeadline = "Growth is holding, but inflation keeps duration risk elevated.";
    } else if (currentRegime.growth < 0) {
      thesisHeadline = "Growth is weakening as inflation cools; quality and duration gain appeal.";
    } else {
      thesisHeadline = "Disinflation with resilient growth supports selective risk-taking.";
    }
    thesisEvidence.push(
      `Macro regime: growth z-score ${signed(currentRegime.growth)}, inflation z-score ${signed(currentRegime.inflation)}.`
    );
    if (curveSpread !== null) {
      thesisEvidence.push(
        `Curve proxy is ${curveSpread >= 0 ? "positively sloped" : "inverted"} by ${Math.abs(curveSpread).toFixed(2)} percentage points.`
      );
    }
  } else {
    thesisEvidence.push("Macro regime feed is unavailable, so this read remains provisional.");
  }

  if (markets && breadthAverage !== null) {
    thesisEvidence.push(
      `IDX breadth: ${positiveSectors}/${validSectorMoves.length} sectors positive, averaging ${signed(breadthAverage)}% today.`
    );
    thesisEvidence.push(
      `DXY ${signed(dxy.change)}%; oil ${signed(oil.change)}% versus the prior observation.`
    );
    if (!fred) {
      thesisHeadline =
        breadthAverage >= 0
          ? "Positive IDX breadth supports selective exposure, pending macro confirmation."
          : "Weak IDX breadth argues for patience until macro confirmation improves.";
    }
  } else {
    thesisEvidence.push("Live market breadth is unavailable.");
  }

  if (gdelt) {
    thesisEvidence.push(
      `Geopolitical risk is ${gdelt.severityStatus.toLowerCase()} with a ${gdelt.frequencyScore.toFixed(0)} frequency score.`
    );
  } else {
    thesisEvidence.push("Geopolitical-risk feed is unavailable.");
  }

  const thesisConfidence = liveCount >= 4 ? "HIGH" : liveCount >= 2 ? "MEDIUM" : "LOW";
  const currentVisit = buildVisitSnapshot({
    regime: regimeLabel(currentRegime),
    breadthPositive: positiveSectors,
    breadthTotal: validSectorMoves.length,
    liveFeeds: liveCount,
  });
  const visitDeltas = describeVisitDelta(previousVisit, currentVisit);
  const feedReadings: Array<{ label: string; status: 'live' | 'partial' | 'stale' | 'unavailable'; detail: string }> = [
    { label: 'FRED', status: feedStatus(fred), detail: fred ? `Through ${fred.freshness} · ${fred.status}` : 'Macro feed did not return data' },
    { label: 'IDX', status: feedStatus(markets), detail: markets ? `${markets.status} · Yahoo upstream` : 'Market feed did not return data' },
    { label: 'GDELT', status: gdelt ? 'partial' : 'unavailable', detail: gdelt ? 'Keyword frequency only; severity pending' : 'Geopolitical feed did not return data' },
    { label: 'CALENDAR', status: feedStatus(calendar), detail: calendar ? `TradingEconomics · ${calendar.status}` : 'Calendar feed did not return data' },
    { label: 'COT', status: feedStatus(cot), detail: cot ? `Weekly CFTC reports · ${cot.status}` : 'Positioning feed did not return data' },
  ];

  // Persist one snapshot per session, after the feed requests have settled.
  // It powers "since last visit" without storing raw market payloads.
  useEffect(() => {
    if (!preferencesReady || !lastLoadedAt || visitSaved) return;
    const snapshot = buildVisitSnapshot({
      regime: regimeLabel(currentRegime),
      breadthPositive: positiveSectors,
      breadthTotal: validSectorMoves.length,
      liveFeeds: liveCount,
    });
    try { localStorage.setItem('jarvis_visit_snapshot', JSON.stringify(snapshot)); } catch {}
    void fetch('/api/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ lastVisitAt: snapshot.takenAt, lastSnapshot: snapshot }),
    }).catch(() => undefined);
    setVisitSaved(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferencesReady, lastLoadedAt, visitSaved]);

  const saveNote = () => {
    const text = note.trim();
    if (!text) {
      setNotesOpen(false);
      return;
    }
    const savedAt = new Date().toISOString();
    const optimistic = { id: `local-${Date.now()}`, body: text, created_at: savedAt };
    setSavedNote(text);
    setSavedNoteAt(savedAt);
    setNoteHistory((history) => [optimistic, ...history].slice(0, 20));
    setNote('');
    setNotesOpen(false);
    try { localStorage.setItem('jarvis_note', JSON.stringify({ text, savedAt })); } catch {}
    trackEvent('note_save');
    void fetch('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ body: text }),
    })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data: { note?: { id: number | string; body: string; created_at: string } }) => {
        if (!data.note) return;
        setNoteHistory((history) => history.map((item) => item.id === optimistic.id ? data.note! : item));
      })
      .catch(() => announce('NOTE SAVED LOCALLY · CLOUD SYNC UNAVAILABLE'));
  };
  const savedNoteLabel = formatNoteTimestamp(savedNoteAt);

  const completeOnboarding = () => {
    setOnboardingOpen(false);
    setOnboardingComplete(true);
    try { localStorage.setItem('jarvis_onboarding_complete_v1', '1'); } catch {}
    savePreferences({ onboardingComplete: true });
    trackEvent('onboarding_complete');
  };

  const exportSeasonality = () => {
    if (!seasonality) return;
    const lines = [
      'ticker,month,average_return_pct,positive_rate_pct,observations',
      ...seasonality.months.map((month) => [
        seasonality.ticker,
        month.month,
        month.average.toFixed(4),
        month.positiveRate.toFixed(2),
        month.observations,
      ].join(',')),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${seasonality.ticker}-seasonality.csv`;
    link.click();
    URL.revokeObjectURL(url);
    trackEvent('seasonality_export', { ticker: seasonality.ticker });
  };

  return (
    <main className="terminal-shell" data-scheme={scheme}>
      <aside className="side-nav">
        <div className="side-brand" aria-label="Jarvis"><Image src="/jarvis-logo-128.png" alt="" width={128} height={128} /></div>
        <nav aria-label="Research sections">
          {navigation.map((item, index) => {
            const badge = navBadge(item.label);
            const startsGroup = index === 0 || navigation[index - 1].group !== item.group;
            return (
              <Fragment key={item.label}>
                {index > 0 && startsGroup && <span className="side-sep" aria-hidden="true" />}
                <button
                  ref={(node) => { navRefs.current[item.label] = node; }}
                  aria-label={item.label}
                  data-label={badge}
                  data-desc={navDesc[item.label]}
                  data-key={navShortcut(index)}
                  title={badge}
                  onClick={() => changeSection(item.label)}
                  aria-current={active === item.label ? 'page' : undefined}
                  className={active === item.label ? 'active' : ''}
                ><span aria-hidden="true">{item.icon}</span><span className="nav-label">{badge}</span></button>
              </Fragment>
            );
          })}
        </nav>
        <div className="side-tools"><button aria-label="Notes" data-label="NOTES" title="Notes" onClick={() => setNotesOpen(true)}><span aria-hidden="true">✎</span><span className="nav-label">NOTES</span></button><button aria-label="Settings" data-label="SETTINGS" title="Settings" onClick={() => setSettingsOpen(true)}><span aria-hidden="true">⚙</span><span className="nav-label">SETTINGS</span></button></div>
        <button className="sidebar-feedback" aria-label="Send feedback" data-label="FEEDBACK" title="Send feedback" onClick={() => setFeedbackOpen(true)}><span aria-hidden="true">?</span><span className="nav-label">FEEDBACK</span></button>
      </aside>

      <div className="app-column">
        <header className="topbar global-bar">
          <StockSearch
            placeholder="Search IDX tickers, companies (e.g. ABMM, BBCA)..."
            onSelect={handleStockSelect}
          />
          <button className="command-trigger" type="button" onClick={() => setCommandOpen(true)} aria-label="Open command palette">
            <span aria-hidden="true">⌘K</span>
            <strong>COMMANDS</strong>
          </button>
          <div className="global-date" aria-label={`Current time ${wibDate} ${wibTime} WIB`}><span>{wibDay}</span><strong>{wibDate}</strong><b>{wibTime} WIB</b></div>
          <button className="feedback-trigger" type="button" onClick={() => setFeedbackOpen(true)}><span aria-hidden="true">✦</span><strong>SEND FEEDBACK</strong><small>HELP IMPROVE JARVIS</small></button>
        </header>

        <DataStatusBar feeds={feedReadings} checkedAt={lastLoadedAt ? new Date(lastLoadedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }) + ' WIB' : null} />

        <section className="signal-strip" aria-label="Key readings">
          <MetricCard label="MACRO REGIME" value={regimeLabel(currentRegime)} tone="orange" condition={currentRegime.date ? 'GROWTH–INFLATION PRESSURE' : 'NO VALID READING'} implication={fred ? 'Defensive tilt; avoid paying for fragile growth.' : 'No synthetic regime is shown while FRED is unavailable.'} source={fred ? (fred.status === 'live' ? 'FRED LIVE' : 'FRED STALE') : 'FEED OFFLINE'} />
          <MetricCard label="GPR COMPOSITE" value={gdelt ? 'PARTIAL' : '—'} condition={gdelt ? `FREQUENCY ${gdelt.frequencyScore.toFixed(1)} · LIVE` : 'FEED OFFLINE'} implication={gdelt ? 'Goldstein severity is still required for a valid composite.' : 'The composite is withheld rather than estimated.'} source={gdelt ? 'GDELT KEYWORD FEED LIVE' : 'FEED OFFLINE'} />
          <MetricCard label="US 10Y–2Y" value={fred && yields.length > 4 ? `${((yields[4] - yields[2]) * 100).toFixed(0)} BP` : '—'} condition={fred && yields.length > 4 ? spreadLabel((yields[4] - yields[2]) * 100) : 'FEED OFFLINE'} implication="A flatter curve keeps cyclical conviction constrained." source={fred && yields.length > 4 ? (fred.status === 'live' ? 'FRED LIVE' : 'FRED STALE') : 'FEED OFFLINE'} />
          <MetricCard label="DXY" value={markets && dxy.last ? dxy.last.toFixed(2) : '—'} condition={markets ? relativeLabel(dxy.last, dxy.average, 'DOLLAR') : 'FEED OFFLINE'} implication="Firm USD is a headwind for EM risk and commodities." source={markets && dxy.last ? `${signed(dxy.change)}% · ${markets.status.toUpperCase()}` : 'FEED OFFLINE'} />
          <MetricCard label="WTI CRUDE" value={markets && oil.last ? '$' + oil.last.toFixed(2) : '—'} condition={markets ? relativeLabel(oil.last, oil.average, 'ENERGY') : 'FEED OFFLINE'} implication="Supports the energy complex; coal equities benefit indirectly." source={markets && oil.last ? `${signed(oil.change)}% · ${markets.status.toUpperCase()}` : 'FEED OFFLINE'} />
        </section>

        <div className="view-heading"><div><span>RESEARCH / {active}</span><h2>{active === 'OVERVIEW' ? 'Daily Research Overview' : titleCase(active)}</h2></div><p>{sectionDescription(active)}</p></div>

        <PanelBoundary label={active} resetKey={active}>
        {active === 'OVERVIEW' && <section className="decision-home">
          <header className="decision-intro">
            <span className="decision-kicker">JARVIS / DECISION BRIEF</span>
            <h3>Start with what changed.</h3>
            <p>A quiet research briefing before you move into charts, screeners, and individual stocks.</p>
          </header>

          <section className="visit-strip" aria-label="Changes since your last visit">
            <div className="visit-stamp">
              <span>SINCE LAST VISIT</span>
              <strong>{previousVisit ? visitAgeLabel(previousVisit.takenAt) : 'FIRST SESSION'}</strong>
            </div>
            {visitDeltas.map((delta) => (
              <div className={`visit-delta ${delta.tone}`} key={delta.label}>
                <span>{delta.label}</span>
                <strong>{delta.value}</strong>
              </div>
            ))}
          </section>

          <section className="decision-posture" aria-label="Current market posture">
            <div><span>MARKET REGIME</span><strong className="posture-name">{regimeLabel(currentRegime)}</strong></div>
            <div><span>RESEARCH BIAS</span><strong>{thesisHeadline}</strong></div>
            <div><span>IDX BREADTH</span><strong>{validSectorMoves.length ? `${positiveSectors}/${validSectorMoves.length} POSITIVE` : 'PENDING'}</strong></div>
            <div><span>DATA CONFIDENCE</span><strong>{thesisConfidence} · {liveCount}/5 FEEDS</strong></div>
          </section>

          <div className="decision-body">
            <section className="decision-brief" aria-labelledby="brief-title">
              <header className="brief-section-head"><h3 id="brief-title">WHAT DESERVES ATTENTION</h3><span>LATEST AVAILABLE DATA</span></header>
              <article className="brief-row"><span className="brief-index">01</span><div><strong>Macro regime sets the risk budget.</strong><p>{thesisEvidence[0] ?? 'Macro confirmation is still incomplete; avoid forcing a strong regime call.'}</p></div></article>
              <article className="brief-row"><span className="brief-index">02</span><div><strong>{breadthAverage === null ? 'IDX participation is waiting for a valid read.' : breadthAverage >= 0 ? 'IDX participation is improving, but selection still matters.' : 'IDX participation remains weak; patience has value.'}</strong><p>{breadthAverage === null ? 'Market breadth data is unavailable.' : `${positiveSectors} of ${validSectorMoves.length} sectors are positive, averaging ${signed(breadthAverage)}% today.`}</p></div></article>
              <article className="brief-row"><span className="brief-index">03</span><div><strong>External pressure stays visible.</strong><p>{markets ? `DXY ${signed(dxy.change)}% and oil ${signed(oil.change)}% versus the prior observation.` : 'Cross-market data is pending; this signal is withheld rather than estimated.'}</p></div></article>
            </section>

            <aside className="decision-actions" aria-labelledby="actions-title">
              <header className="brief-section-head"><h3 id="actions-title">NEXT RESEARCH MOVE</h3><span>CHOOSE A SURFACE</span></header>
              <div className="decision-current-thesis"><span>CURRENT THESIS</span><h4>{thesisHeadline}</h4><p>{savedNote || 'No thesis saved yet. Open Research Notes and write down what would disprove your current read.'}</p><button type="button" className="inline-link" onClick={() => setNotesOpen(true)}>OPEN RESEARCH NOTES →</button></div>
              <button className="decision-link" onClick={() => changeSection('QUANT LAB')}><span><strong>OPEN WEEKLY PICKS</strong><small>Review V5 selections and portfolio actions</small></span><span aria-hidden="true">→</span></button>
              <button className="decision-link" onClick={() => changeSection('MARKETS')}><span><strong>CHECK MARKET STRUCTURE</strong><small>Breadth, sectors, and watchlist detail</small></span><span aria-hidden="true">→</span></button>
              <button className="decision-link" onClick={() => changeSection('PORTFOLIO')}><span><strong>STRESS THE PORTFOLIO</strong><small>Check concentration before adding risk</small></span><span aria-hidden="true">→</span></button>
            </aside>
          </div>
        </section>}

        {active === 'MACRO' && (fred ? <section className="dashboard-grid macro-grid">
          <article className="panel regime-panel"><PanelHead index="01" title="MACRO REGIME MAP"><div className="range-switcher">{(['6M','1Y','3Y'] as const).map((item) => <button key={item} onClick={() => setRange(item)} className={range === item ? 'active' : ''}>{item}</button>)}</div></PanelHead><RegimeCanvas points={fred.regime} range={range} /><PanelFoot left="INDUSTRIAL PRODUCTION GROWTH × CPI INFLATION" right={`FRED · THROUGH ${formatDate(fred.freshness)}`} /></article>
          <article className="panel indicator-panel"><PanelHead index="02" title="MACRO INDICATOR Z-SCORES"><span className="head-note">VS 10Y MEAN</span></PanelHead><div className="indicator-head"><span>INDICATOR</span><span>ACTUAL</span><span>MEAN</span><span>DEVIATION</span><span>Z</span></div>{indicators.map((item) => <div className="indicator-row" key={item.name}><strong>{item.name}</strong><span>{formatNumber(item.actual, item.unit)}</span><span>{formatNumber(item.mean, item.unit)}</span><div className="deviation-track"><i className={zTone(item.z)} style={{width:`${Math.min(96, 50 + item.z * 28)}%`}} /></div><b className={zTone(item.z)}>{signed(item.z)}</b></div>)}<PanelFoot left="SEASONALLY ADJUSTED WHERE AVAILABLE" right="FRED LIVE" /></article>
          <YieldCurve values={yields} />
        </section> : <section className="dashboard-grid macro-grid"><article className="panel wide-panel"><FeedUnavailable title="MACRO FEED UNAVAILABLE" body="FRED did not return a valid regime or Treasury series. No illustrative macro values are shown because they could be mistaken for live data." /></article></section>)}

        {active === 'MARKETS' && (markets ? <section className="dashboard-grid markets-grid">
          <article className="panel heatmap-panel"><PanelHead index="01" title="IDX SECTOR HEATMAP"><div className="range-switcher">{(['1D','1W'] as const).map((item) => <button key={item} onClick={() => setHeatPeriod(item)} className={heatPeriod === item ? 'active' : ''}>{item}</button>)}</div></PanelHead><div className="heatmap">{heatmap.map((item, index) => { const value = heatPeriod === '1D' ? item.daily : item.weekly; return <button key={item.label} onClick={() => setSelectedSector(item.label)} className={`heat-tile ${['xl','lg','md','lg','sm','sm','md','sm','md','lg','md'][index]} ${value === null ? 'no-data' : heatTone(value)} ${item.confidence === 'low' ? 'low-confidence' : ''} ${selectedHeat?.label === item.label ? 'selected' : ''}`}><span>{item.label}</span><strong>{value === null ? '—' : `${signed(value)}%`}</strong><small>{item.confidence === 'low' ? `LOW CONFIDENCE · ${item.validCount ?? 0}/${item.memberCount ?? 0} VALID` : 'VIEW MEMBERS →'}</small></button>; })}</div>{selectedHeat && <div className="heat-drilldown"><div><span>SELECTED SECTOR</span><strong>{selectedHeat.label}</strong><small>SIMPLE AVG · {selectedHeat.validCount ?? selectedHeat.constituents.length}/{selectedHeat.memberCount ?? selectedHeat.constituents.length} VALID</small></div>{selectedHeat.constituents.length ? selectedHeat.constituents.map((stock) => { const value = heatPeriod === '1D' ? stock.daily : stock.weekly; return <div key={stock.ticker} onClick={() => openStockDetail(stock.ticker)} style={{cursor:'pointer'}} title={`Click to view ${stock.ticker} fundamentals`}><span>{stock.ticker}</span><strong>{stock.price.toLocaleString('en-US',{maximumFractionDigits:2})}</strong><small className={value === null ? '' : value >= 0 ? 'positive' : 'negative'}>{value === null ? 'NO VALID RETURN' : `${signed(value)}%`}</small></div>}) : <p>Constituent feed unavailable for this sector.</p>}</div>}<PanelFoot left="SIMPLE AVERAGE OF VALID IDX-IC CONSTITUENT BASKETS" right={`${markets.status.toUpperCase()} · YAHOO UPSTREAM`} /></article>
          <Watchlist watchlist={watchlist} live onSelectStock={(t) => openStockDetail(t)} onAdd={addWatchlistTicker} onRemove={removeWatchlistTicker} managed={watchlistManaged || customWatchlist.length > 0} syncState={watchlistSync} />
          <Calendar data={calendar} />
        </section> : <section className="dashboard-grid markets-grid"><article className="panel wide-panel"><FeedUnavailable title="IDX MARKET FEED UNAVAILABLE" body="The market upstream did not return sector or price data. Price cells are withheld so stale or synthetic values cannot be mistaken for live quotes." /></article><Watchlist watchlist={watchlist} live={false} onSelectStock={(t) => openStockDetail(t)} onAdd={addWatchlistTicker} onRemove={removeWatchlistTicker} managed={watchlistManaged || customWatchlist.length > 0} syncState={watchlistSync} /><Calendar data={calendar} /></section>)}

        {active === 'NEWS' && <NewsIntelligence />}

        {active === 'QUANT LAB' && <QuantLab markets={markets} fred={fred} onSelectStock={openStockDetail} />}

        {active === 'QUANTAMENTAL' && <QuantamentalMap onSelectStock={openStockDetail} />}

        {active === 'PORTFOLIO' && <PortfolioStressLab />}

        {active === 'RISK MAP' && <RiskMap />}

        {active === 'RESEARCH PAPERS' && <ResearchPapers />}

        {active === 'SEASONALITY' && <section className="panel seasonality-panel"><PanelHead index="01" title="MONTHLY RETURN SEASONALITY"><div className="ticker-switcher">{[...new Set([seasonTicker, 'BUMI', 'AMMN', 'ADRO', 'JKSE'])].map((ticker)=><button key={ticker} onClick={()=>setSeasonTicker(ticker)} className={seasonTicker===ticker?'active':''}>{ticker}</button>)}<button type="button" className="season-export" onClick={exportSeasonality} disabled={!seasonality}>EXPORT CSV</button></div></PanelHead>{seasonality ? <><div className="season-summary"><div><span>SELECTED SERIES</span><strong>{seasonality.ticker}</strong><small>{seasonality.symbol}</small></div><p>Average calendar-month return across completed monthly observations. Historical tendency only—not a forecast.</p><b>BASED ON {seasonality.years} YEARS OF HISTORICAL DATA · {seasonality.from}–{seasonality.through}</b></div><div className="season-grid">{seasonality.months.map((month)=><div key={month.month} className={`season-tile ${heatTone(month.average)}`}><span>{monthName(month.month)}</span><strong>{signed(month.average)}%</strong><small>{month.positiveRate.toFixed(0)}% POSITIVE · N={month.observations}</small></div>)}</div><div className="season-legend"><span>WEAKER AVERAGE</span><i/><span>STRONGER AVERAGE</span></div><PanelFoot left="AVERAGE MONTHLY CLOSE-TO-CLOSE RETURN" right="YAHOO FINANCE UPSTREAM · DAILY HISTORY" /></> : <FeedUnavailable title="SEASONALITY FEED UNAVAILABLE" body="No historical values are shown until Yahoo returns a valid 5–10 year price series." />}</section>}

        {active === 'MARKET PARTICIPANT' && <section className="dashboard-grid cot-grid"><article className="panel cot-panel"><PanelHead index="01" title="CFTC COT POSITIONING"><div className="ticker-switcher">{['USD','GOLD','US10Y','BTC'].map((asset)=><button key={asset} onClick={()=>setCotAsset(asset)} className={cotAsset===asset?'active':''} disabled={!cot?.series.some((item)=>item.key===asset)}>{asset}</button>)}</div></PanelHead>{selectedCot ? <><div className="cot-summary"><div><span>CONTRACT</span><strong>{selectedCot.label}</strong></div><div><span>LATEST REPORT</span><strong>{formatDate(selectedCot.latest)}</strong></div><div><span>FREQUENCY</span><strong>WEEKLY · CFTC</strong></div></div><CotChart series={selectedCot} /><CotTable series={selectedCot} /><PanelFoot left="NET POSITION = LONG CONTRACTS − SHORT CONTRACTS" right={`UPDATED WEEKLY · THROUGH ${formatDate(selectedCot.latest)}`} /></> : <FeedUnavailable title="CFTC CONNECTION FAILED" body="No positioning values are shown because the public COT dataset did not return a valid series." />}</article></section>}
        </PanelBoundary>

        <footer className="terminal-footer"><span>JARVIS / RESEARCH USE ONLY</span><span>Unavailable feeds retain explicit connection labels.</span><span>v1.2</span></footer>
      </div>

      {notesOpen && <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setNotesOpen(false); }}><section ref={notesDialogRef} tabIndex={-1} className="drawer" role="dialog" aria-modal="true" aria-label="Research notes"><div className="drawer-head"><div><span>RESEARCH LOG</span><h2>UPDATE CURRENT THESIS</h2></div><button onClick={() => setNotesOpen(false)}>ESC</button></div><label htmlFor="note">NEW NOTE</label><textarea id="note" autoFocus value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} placeholder="What changed in the data, and what would disprove your read?" /><div className="prompt-line"><span>Keep the claim testable. Notes sync to your account.</span><span>{note.length} / 2000</span></div><div className="drawer-actions"><button onClick={() => setNotesOpen(false)}>CANCEL</button><button className="primary-button" onClick={saveNote}>SAVE NOTE</button></div><div className="recent-note"><span>LATEST ENTRY</span><p>{savedNote || 'No thesis saved yet.'}</p><small>{savedNoteLabel}</small></div>{noteHistory.length > 1 && <div className="note-history"><span>THESIS HISTORY</span>{noteHistory.slice(0, 6).map((entry) => <div key={entry.id}><small>{new Date(entry.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' }).toUpperCase()}</small><p>{entry.body}</p></div>)}</div>}</section></div>}
      {settingsOpen && <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setSettingsOpen(false); }}><section ref={settingsDialogRef} tabIndex={-1} className="drawer" role="dialog" aria-modal="true" aria-label="Terminal settings"><div className="drawer-head"><div><span>TERMINAL</span><h2>SETTINGS</h2></div><button onClick={() => setSettingsOpen(false)}>ESC</button></div><div className="setting-block"><h3>COLOR ACCESSIBILITY</h3><p>Choose a signal palette that keeps gains and losses distinct.</p><div className="scheme-list">{SCHEMES.map((item) => <button key={item} className={scheme===item?'selected':''} onClick={() => changeScheme(item)}><i /><span>{item.toUpperCase()}</span><b>{scheme===item?'ON':''}</b></button>)}</div></div><div className="setting-block"><h3>DATA CONNECTIONS</h3><p>Technical feed detail is kept here so the daily view stays focused on decisions.</p><div className="settings-health connection-list"><p><i className={fred ? 'live' : ''} /><strong>FRED</strong><span>{fred ? `Updated ${fred.freshness}` : 'FRED_API_KEY not configured or upstream unavailable'}</span></p><p><i className={markets ? 'live' : ''} /><strong>IDX + SEASONALITY</strong><span>{markets ? `${markets.status} · Yahoo upstream` : 'Live request failed · panel withheld, no synthetic values'}</span></p><p><i className={gdelt ? 'live' : ''} /><strong>GDELT DOC</strong><span>{gdelt ? 'Keyword-frequency series live · Goldstein pending' : 'Live request failed'}</span></p><p><i className={cot ? 'live' : ''} /><strong>CFTC COT</strong><span>{cot ? `${cot.status} · weekly public reports` : 'Public dataset request failed'}</span></p><p><i className={calendar ? 'live' : ''} /><strong>TRADINGECONOMICS</strong><span>{calendar ? 'Calendar connected' : 'TRADING_ECONOMICS_API_KEY required'}</span></p></div></div><PlanCard /><WeeklyDigestOptIn /><FeedbackInbox active={settingsOpen} /><div className="setting-block"><h3>ONBOARDING</h3><p>Revisit the starter watchlist, thesis prompt, and notification setup.</p><button type="button" className="quiet-button" onClick={() => { setSettingsOpen(false); setOnboardingOpen(true); trackEvent('onboarding_start', { source: 'settings' }); }}>{onboardingComplete ? 'REPLAY ONBOARDING' : 'FINISH SETUP'}</button></div><SettingsLogout /><button className="primary-button full" onClick={() => setSettingsOpen(false)}>APPLY SETTINGS</button></section></div>}

      <OnboardingModal
        open={onboardingOpen}
        onClose={() => {
          setOnboardingOpen(false);
          try { localStorage.setItem('jarvis_onboarding_complete_v1', '1'); } catch {}
          savePreferences({ onboardingComplete: true });
          trackEvent('onboarding_complete', { skipped: true });
        }}
        onComplete={completeOnboarding}
        onAddTickers={(tickers) => tickers.forEach(addWatchlistTicker)}
        onOpenNotes={() => { completeOnboarding(); setNotesOpen(true); }}
        onOpenSettings={() => { completeOnboarding(); setSettingsOpen(true); }}
      />
      <CommandPalette
        open={commandOpen}
        onOpenChange={setCommandOpen}
        sections={navigation.map((item) => ({ label: item.label, description: navDesc[item.label] }))}
        onNavigate={(label) => {
          const item = navigation.find((entry) => entry.label === label);
          if (item) changeSection(item.label);
        }}
        onOpenStock={openStockDetail}
        onOpenNotes={() => setNotesOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenPricing={() => { trackEvent('upgrade_click', { source: 'command_palette' }); window.location.assign('/pricing'); }}
        onOpenFeedback={() => setFeedbackOpen(true)}
      />
      <FeedbackModal open={feedbackOpen} section={active} ticker={modalTicker} onClose={() => setFeedbackOpen(false)} />
      {notification && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            zIndex: 9999,
            background: '#09131ef2',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            border: '1px solid #48a6ff',
            boxShadow: '0 12px 32px rgba(0,0,0,0.85), 0 0 15px rgba(72,166,255,0.3)',
            padding: '10px 16px',
            borderRadius: '3px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            fontFamily: 'var(--font-geist-mono), monospace',
            fontSize: '11px',
            color: '#e8edf3',
            letterSpacing: '0.04em',
          }}
        >
          <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#48a6ff', boxShadow: '0 0 8px #48a6ff', flexShrink: 0 }} />
          <span>{notification}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setNotification(null)}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#778596',
              fontSize: '14px',
              cursor: 'pointer',
              padding: '0 0 0 6px',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
      )}
      {modalTicker && (
        <StockDetailModal
          ticker={modalTicker}
          onClose={closeStockDetail}
          onAddToWatchlist={handleAddToWatchlist}
          isInWatchlist={watchlist.some(
            (w) => w.ticker.toUpperCase() === modalTicker.replace('.JK', '').toUpperCase()
          )}
        />
      )}
    </main>
  );
}

function RegimeCanvas({ points, range }: { points: RegimePoint[]; range: '6M'|'1Y'|'3Y' }) {
  const canvas = useRef<HTMLCanvasElement>(null); const visible = useMemo(() => points.slice(-(range === '6M' ? 6 : range === '1Y' ? 12 : 36)), [points, range]);
  useEffect(() => { const el=canvas.current; if(!el) return; const draw=()=>{ const rect=el.getBoundingClientRect(); const scale=window.devicePixelRatio||1; el.width=rect.width*scale; el.height=rect.height*scale; const ctx=el.getContext('2d'); if(!ctx)return; ctx.scale(scale,scale); const w=rect.width,h=rect.height,pad=34; ctx.clearRect(0,0,w,h); ctx.strokeStyle='#202a35'; ctx.lineWidth=1; for(let i=0;i<=8;i++){const x=pad+(w-pad*2)*i/8;const y=pad+(h-pad*2)*i/8;ctx.beginPath();ctx.moveTo(x,pad);ctx.lineTo(x,h-pad);ctx.stroke();ctx.beginPath();ctx.moveTo(pad,y);ctx.lineTo(w-pad,y);ctx.stroke();} ctx.strokeStyle='#485868';ctx.beginPath();ctx.moveTo(w/2,pad);ctx.lineTo(w/2,h-pad);ctx.moveTo(pad,h/2);ctx.lineTo(w-pad,h/2);ctx.stroke(); const xy=(p:RegimePoint)=>({x:pad+((Math.max(-2,Math.min(2,p.growth))+2)/4)*(w-pad*2),y:pad+((2-Math.max(-2,Math.min(2,p.inflation)))/4)*(h-pad*2)}); ctx.strokeStyle='#48a6ff';ctx.lineWidth=2;ctx.beginPath();visible.forEach((p,i)=>{const q=xy(p);if(i)ctx.lineTo(q.x,q.y);else ctx.moveTo(q.x,q.y)});ctx.stroke(); visible.forEach((p,i)=>{const q=xy(p);ctx.fillStyle=i===visible.length-1?'#ff9840':'#48a6ff';ctx.beginPath();ctx.arc(q.x,q.y,i===visible.length-1?5:2.5,0,Math.PI*2);ctx.fill();if(i===0||i===visible.length-1||i===Math.floor(visible.length/2)){ctx.fillStyle='#93a0af';ctx.font='9px monospace';ctx.fillText(formatDate(p.date),q.x+7,q.y-7)}}); }; draw(); const ro=new ResizeObserver(draw);ro.observe(el);return()=>ro.disconnect(); },[visible]);
  const last=visible.at(-1); return <div className="regime-canvas-wrap"><span className="quadrant q1">STAGFLATION</span><span className="quadrant q2">OVERHEAT</span><span className="quadrant q3">DEFLATION</span><span className="quadrant q4">REFLATION</span><div className="regime-sector-overlay" aria-label="Typical IDX sector alignment by regime"><span className="sector-stag">ENERGY · BASIC MATERIALS</span><span className="sector-heat">FINANCIALS · INDUSTRIALS</span><span className="sector-def">HEALTHCARE · NON-CYCLICALS</span><span className="sector-ref">TECHNOLOGY · CYCLICALS</span></div><canvas ref={canvas} aria-label={`Historical growth and inflation z-score path for ${range}`} /><span className="canvas-axis x">GROWTH Z-SCORE</span><span className="canvas-axis y">INFLATION Z-SCORE</span>{last&&<span className="canvas-current">THROUGH {formatDate(last.date)} · G {signed(last.growth)} · I {signed(last.inflation)}</span>}</div>;
}

function CotChart({series}:{series:CotSeries}){const canvas=useRef<HTMLCanvasElement>(null);const points=useMemo(()=>series.points.slice(-52),[series]);useEffect(()=>{const el=canvas.current;if(!el)return;const draw=()=>{const rect=el.getBoundingClientRect(),scale=window.devicePixelRatio||1;el.width=rect.width*scale;el.height=rect.height*scale;const ctx=el.getContext('2d');if(!ctx)return;ctx.scale(scale,scale);const w=rect.width,h=rect.height,pad=38;ctx.clearRect(0,0,w,h);ctx.strokeStyle='#242424';ctx.lineWidth=1;for(let i=0;i<=5;i++){const y=pad+(h-pad*2)*i/5;ctx.beginPath();ctx.moveTo(pad,y);ctx.lineTo(w-pad,y);ctx.stroke()}const all=points.flatMap((point)=>series.groups.map((group)=>point.values[group]??0));const max=Math.max(...all.map(Math.abs),1);const colors=['#48a6ff','#ff9840','#43d4a3'];series.groups.forEach((group,groupIndex)=>{ctx.strokeStyle=colors[groupIndex];ctx.lineWidth=2;ctx.beginPath();points.forEach((point,index)=>{const x=pad+(w-pad*2)*(index/Math.max(points.length-1,1));const y=h/2-((point.values[group]??0)/max)*(h/2-pad);if(index)ctx.lineTo(x,y);else ctx.moveTo(x,y)});ctx.stroke()});ctx.strokeStyle='#55606d';ctx.beginPath();ctx.moveTo(pad,h/2);ctx.lineTo(w-pad,h/2);ctx.stroke();ctx.fillStyle='#778596';ctx.font='8px monospace';ctx.fillText(compact(max),4,pad+3);ctx.fillText('0',18,h/2+3);ctx.fillText(compact(-max),4,h-pad+3);if(points.length){ctx.fillText(formatDate(points[0].date),pad,h-10);const end=formatDate(points.at(-1)!.date);ctx.fillText(end,w-pad-46,h-10)}};draw();const ro=new ResizeObserver(draw);ro.observe(el);return()=>ro.disconnect()},[points,series]);return <div className="cot-chart"><div className="cot-legend">{series.groups.map((group,index)=><span key={group}><i className={`line-${index}`}/>{group}</span>)}</div><canvas ref={canvas} aria-label={`${series.label} net positioning by trader type over 52 weeks`}/></div>}
function CotTable({series}:{series:CotSeries}){
  const rows=series.points.slice(-6).reverse();
  const percentiles=series.groups.map((group)=>{
    const values=series.points.map((point)=>point.values[group]??0);
    const latest=values.at(-1)??0;
    const below=values.filter((value)=>value<=latest).length;
    return {group, latest, percentile: values.length?Math.round((below/values.length)*100):0};
  });
  return <>
    <div className="cot-percentiles" aria-label="52-week positioning percentile">
      {percentiles.map((item)=><div key={item.group}><span>{item.group}</span><strong className={item.percentile>=80?'hot':item.percentile<=20?'cool':''}>{item.percentile}TH</strong><small>52W NET POSITION PERCENTILE</small></div>)}
    </div>
    <div className="cot-table"><div className="cot-row cot-head"><span>REPORT</span>{series.groups.map((group)=><span key={group}>{group}</span>)}</div>{rows.map((point,index)=>{const prior=series.points[series.points.length-2-index];return <div className="cot-row" key={point.date}><strong>{formatDate(point.date)}</strong>{series.groups.map((group)=>{const change=prior?(point.values[group]??0)-(prior.values[group]??0):0;return <span key={group}><b>{compact(point.values[group]??0)}</b><small className={change>=0?'positive':'negative'}>{change>=0?'+':''}{compact(change)} WoW</small></span>})}</div>})}</div>
  </>;
}
function FeedUnavailable({title,body}:{title:string;body:string}){return <div className="feed-unavailable"><span>CONNECTION STATUS</span><strong>{title}</strong><p>{body}</p></div>}

function Watchlist({watchlist,live,onSelectStock,onAdd,onRemove,managed,syncState}:{watchlist:Array<{ticker:string;price:number;change:number}>;live:boolean;onSelectStock?:(ticker:string)=>void;onAdd?:(ticker:string)=>void;onRemove?:(ticker:string)=>void;managed?:boolean;syncState?:'idle'|'syncing'|'synced'|'local'}) {
  const [showSearch, setShowSearch] = useState(false);
  const syncLabel = !managed
    ? (live ? 'LIVE · DAILY' : 'FEED OFFLINE')
    : syncState === 'synced'
      ? 'SYNCED TO ACCOUNT'
      : syncState === 'syncing'
        ? 'SYNCING TO ACCOUNT'
        : syncState === 'local'
          ? 'LOCAL ONLY · NOT SYNCED'
          : 'CHECKING ACCOUNT SYNC';
  return (
    <article className="panel watch-panel">
      <PanelHead index="01" title="IDX WATCHLIST">
        <button
          type="button"
          onClick={() => setShowSearch((v) => !v)}
          className="quiet-button watch-add"
          aria-expanded={showSearch}
        >
          {showSearch ? '✕ CLOSE' : '+ ADD TICKER'}
        </button>
      </PanelHead>
      {showSearch && (
        <div className="watch-search">
          <StockSearch
            onSelect={(stock) => {
              onAdd?.(stock.ticker);
              setShowSearch(false);
            }}
            placeholder="Search IDX ticker (e.g. BBCA, ADRO)..."
          />
        </div>
      )}
      <div className="watch-table table-head"><span>TICKER</span><span>LAST</span><span>1D</span></div>
      {watchlist.length === 0 && (
        <p className="watch-empty">No tickers saved yet. Add one to make this your own.</p>
      )}
      {watchlist.map((stock) => {
        const quoted = live && stock.price > 0;
        const unavailable = quoted ? undefined : 'No live quote for this ticker yet — it may still be loading or unavailable upstream';
        return (
          <div className="watch-table watch-row" key={stock.ticker} style={{cursor:'pointer'}} onClick={()=>onSelectStock?.(stock.ticker)} title={`Click to view ${stock.ticker} fundamentals`}>
            <strong style={{color:'#48a6ff'}}>{stock.ticker}</strong>
            <span title={unavailable} aria-label={unavailable}>{quoted ? stock.price.toLocaleString('en-US',{maximumFractionDigits:2}) : '—'}</span>
            <span className={quoted ? (stock.change >= 0 ? 'positive' : 'negative') : ''} title={unavailable}>{quoted ? `${signed(stock.change)}%` : '—'}</span>
            {managed && <button type="button" className="watch-remove" aria-label={`Remove ${stock.ticker} from watchlist`} onClick={(event) => { event.stopPropagation(); onRemove?.(stock.ticker); }}>×</button>}
          </div>
        );
      })}
      <PanelFoot left={managed ? 'CLICK TICKER FOR DETAIL · × TO REMOVE' : 'STARTER LIST · ADD A TICKER TO PERSONALIZE'} right={syncLabel} />
    </article>
  );
}
function Calendar({data}:{data:CalendarData|null}){
  const rows=(data?.events ?? []).map((event)=>{
    const date=new Date(event.date);
    const valid=!Number.isNaN(date.getTime());
    return {
      date:valid?date.toLocaleDateString('en-GB',{weekday:'short',day:'2-digit',month:'short',timeZone:'Asia/Jakarta'}).toUpperCase():'DATE TBD',
      time:valid?date.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Jakarta'}):'—',
      country:countryCode(event.country),
      event:event.event,
      forecast:event.forecast,
      prior:event.prior,
      status:event.importance>=3?'HIGH':'MED'
    }
  });
  const indonesiaCount=rows.filter((row)=>row.country==='ID').length;
  return <article className="panel calendar-panel">
    <PanelHead index="02" title="ECONOMIC CALENDAR"><span className={`demo-badge ${data?'':'offline'}`}>{data?'LIVE':'OFFLINE'}</span></PanelHead>
    {data ? <>
      <div className="date-rule"><strong>NEXT 7 DAYS · WIB</strong><span>{indonesiaCount} INDONESIA · {rows.length} TOTAL</span></div>
      {rows.length === 0 && <p className="calendar-empty">No scheduled releases returned for this window.</p>}
      {rows.slice(0,10).map((r,index)=><div className="release-row" key={`${r.date}-${r.event}-${index}`}>
        <time><b>{r.date}</b><span>{r.time} WIB</span></time>
        <span className="country-tag">{r.country}</span>
        <div><strong>{r.event}</strong><small>FCST {r.forecast} · PRIOR {r.prior}</small></div>
        <span className={`importance ${r.status.toLowerCase()}`}>{r.status}</span>
      </div>)}
    </> : <FeedUnavailable title="CALENDAR FEED UNAVAILABLE" body="No releases are shown until TradingEconomics returns events. We do not seed this panel with example dates." />}
    <PanelFoot left={data?'TRADINGECONOMICS · ID PRIORITIZED':'TRADINGECONOMICS KEY NOT CONFIGURED'} right="DATES + TIMES IN WIB" />
  </article>
}
function YieldCurve({values}:{values:number[]}){if(values.length<7)return <article className="panel curve-panel"><FeedUnavailable title="TREASURY CURVE INCOMPLETE" body="FRED returned fewer than seven maturities, so the curve is withheld rather than padded with estimates." /></article>;const spread=(values[4]-values[2])*100;return <article className="panel curve-panel"><PanelHead index="03" title="US TREASURY CURVE"><span className="curve-status"><i />{spread<0?'INVERTED':'NORMAL'} {signed(spread)} BP</span></PanelHead><div className="curve-chart"><div className="curve-bars">{values.map((point,index)=><div className="curve-column" key={index}><span>{point.toFixed(2)}%</span><i style={{height:`${Math.max(18,34+(point-3)*58)}px`}} /><b>{['3M','1Y','2Y','5Y','10Y','20Y','30Y'][index]}</b></div>)}</div><div className="curve-baseline" /></div><div className="curve-callouts"><div><span>2Y</span><strong>{values[2].toFixed(2)}%</strong></div><div><span>10Y</span><strong>{values[4].toFixed(2)}%</strong></div><div><span>30Y</span><strong>{values[6].toFixed(2)}%</strong></div></div><PanelFoot left="TREASURY CONSTANT MATURITY RATES" right="FRED LIVE" /></article>}
function MetricCard({label,value,condition,implication,source,tone}:{label:string;value:string;condition:string;implication:string;source:string;tone?:string}){return <div className="metric-card"><span>{label}</span><div className="metric-reading"><strong className={tone}>{value}</strong><b>{condition}</b></div><p>{implication}</p><small>{source}</small></div>}
function PanelHead({index: _index,title,children}:{index:string;title:string;children?:React.ReactNode}){return <header className="panel-head"><div><h2>{title}</h2></div>{children}</header>}
function PanelFoot({left,right}:{left:string;right:string}){return <footer className="panel-foot"><span>{left}</span><span>{right}</span></footer>}
function signed(value:number){return `${value>=0?'+':''}${value.toFixed(2)}`}
function formatNumber(value:number,unit:string){return `${value.toFixed(unit?2:1)}${unit}`}
function zTone(z:number){return z>.75?'hot':z>.25?'warm':z<-.25?'cool':'neutral'}
function heatTone(value:number){const n=Math.abs(value);return value>=0? n>1.5?'up3':n>.6?'up2':'up1':n>1.5?'down3':n>.6?'down2':'down1'}
function formatDate(date:string){return new Date(date+'T00:00:00Z').toLocaleDateString('en-US',{month:'short',year:'2-digit',timeZone:'UTC'})}
function regimeLabel(point:RegimePoint){if(!point.date) return 'UNKNOWN';return point.growth < 0 && point.inflation > 0 ? 'STAGFLATION' : point.growth > 0 && point.inflation > 0 ? 'OVERHEAT' : point.growth < 0 ? 'DEFLATION' : 'REFLATION'}
function feedStatus(payload:{status?:string}|null):'live'|'partial'|'stale'|'unavailable'{if(!payload)return'unavailable';if(payload.status==='live')return'live';if(payload.status==='partial')return'partial';return'stale'}
function spreadLabel(spread:number){return spread < -25 ? 'DEEPLY INVERTED' : spread < 0 ? 'SLIGHTLY INVERTED' : spread < 50 ? 'NORMAL · FLAT' : 'STEEPENING'}
function relativeLabel(last:number,average:number,name:string){if(!last||!average)return `${name} CONTEXT PENDING`;const gap=(last/average-1)*100;return gap>2?`ABOVE 20D AVG · ${signed(gap)}%`:gap<-2?`BELOW 20D AVG · ${signed(gap)}%`:`NEAR 20D AVG · ${signed(gap)}%`}
function countryCode(country:string){const value=country.toLowerCase();return value.includes('indonesia')?'ID':value.includes('china')?'CN':value.includes('united states')?'US':country.slice(0,2).toUpperCase()}
function monthName(month:number){return ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][month-1]}
function compact(value:number){const absolute=Math.abs(value);const sign=value<0?'-':'';return absolute>=1_000_000?`${sign}${(absolute/1_000_000).toFixed(1)}M`:absolute>=1_000?`${sign}${(absolute/1_000).toFixed(1)}K`:`${Math.round(value)}`}
function titleCase(value:string){return value.toLowerCase().replace(/\b\w/g,(x)=>x.toUpperCase())}
function sectionDescription(section:Section){return ({OVERVIEW:'The readings that need attention before the next research session.',MACRO:'Live FRED signals for growth, inflation and the Treasury curve.',MARKETS:'Daily and weekly market performance with the IDX watchlist.',NEWS:'Beta · IDX, macro, and commodity coverage ranked by decision impact.','QUANT LAB':'Beta · Transparent cross-asset and IDX breadth signals.','QUANTAMENTAL':'Beta · Peer-relative valuation against six-month momentum, with every missing input shown explicitly.',PORTFOLIO:'Beta · Personal factor exposure, concentration, and scenario stress testing.','RISK MAP':'Where the world is fragile: market-moving chokepoints, active conflict zones and live hazard pins.','RESEARCH PAPERS':'Institutional research library with admin-managed publication.',SEASONALITY:'Historical monthly return tendencies across selected IDX names and the benchmark.','MARKET PARTICIPANT':'Weekly CFTC positioning by trader category for major futures markets.'})[section]}
