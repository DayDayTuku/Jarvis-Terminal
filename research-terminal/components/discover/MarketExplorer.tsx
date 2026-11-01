'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  DEFAULT_SCREEN_FILTERS,
  coerceMarketQuotes,
  rankMovers,
  screenQuotes,
  sectorOptions,
  type MarketQuote,
  type ScreenFilters,
} from '../../lib/market-explorer';

type HeatmapSector = {
  label: string;
  daily: number | null;
  weekly: number | null;
  confidence?: string;
  validCount?: number;
  memberCount?: number;
  constituents: Array<{ ticker: string; price: number; daily: number | null; weekly: number | null }>;
};

type MarketsPayload = {
  status: string;
  freshness: string;
  failures?: string[];
  lowConfidenceSectors?: string[];
  heatmap: HeatmapSector[];
};

type ScannerPayload = {
  status: string;
  asOf: string;
  universe: number;
  scanned: number;
  quotes: MarketQuote[];
  message?: string;
};

type View = 'OVERVIEW' | 'MOVERS' | 'SCREENER';

const VIEWS: Array<{ id: View; label: string; hint: string }> = [
  { id: 'OVERVIEW', label: 'OVERVIEW', hint: 'Sector heatmap and breadth' },
  { id: 'MOVERS', label: 'MOVERS', hint: 'Gainers, losers and volume' },
  { id: 'SCREENER', label: 'SCREENER', hint: 'Filter the scanned IDX universe' },
];

const TILE_SIZES = ['xl', 'lg', 'md', 'lg', 'sm', 'sm', 'md', 'sm', 'md', 'lg', 'md'];

function signed(value: number) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
}
function pct(value: number | null) {
  return value === null ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}
function heatTone(value: number) {
  const magnitude = Math.abs(value);
  return value >= 0 ? (magnitude > 1.5 ? 'up3' : magnitude > 0.6 ? 'up2' : 'up1') : magnitude > 1.5 ? 'down3' : magnitude > 0.6 ? 'down2' : 'down1';
}
function compact(value: number | null) {
  if (value === null) return '—';
  const absolute = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (absolute >= 1e12) return `${sign}${(absolute / 1e12).toFixed(1)}T`;
  if (absolute >= 1e9) return `${sign}${(absolute / 1e9).toFixed(1)}B`;
  if (absolute >= 1e6) return `${sign}${(absolute / 1e6).toFixed(1)}M`;
  if (absolute >= 1e3) return `${sign}${(absolute / 1e3).toFixed(1)}K`;
  return `${Math.round(value)}`;
}
function price(value: number) {
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function MoverList({
  title,
  hint,
  rows,
  empty,
  onSelectStock,
}: {
  title: string;
  hint: string;
  rows: MarketQuote[];
  empty: string;
  onSelectStock: (ticker: string) => void;
}) {
  return (
    <article className="panel mover-card">
      <header className="panel-head">
        <div>
          <h2>{title}</h2>
          <span className="head-note">{hint}</span>
        </div>
      </header>
      <div className="mover-list">
        {rows.length === 0 && <p className="mover-empty">{empty}</p>}
        {rows.map((row) => (
          <button key={row.ticker} type="button" className="mover-row" onClick={() => onSelectStock(row.ticker)}>
            <span className="mover-id">
              <strong>{row.ticker}</strong>
              <small>{row.name}</small>
            </span>
            <span className="mover-price">{price(row.close)}</span>
            <span className={`mover-change ${row.change === null ? '' : row.change >= 0 ? 'positive' : 'negative'}`}>{pct(row.change)}</span>
          </button>
        ))}
      </div>
    </article>
  );
}

export default function MarketExplorer({
  markets,
  calendar,
  onSelectStock,
}: {
  markets: MarketsPayload | null;
  calendar?: ReactNode;
  onSelectStock: (ticker: string) => void;
}) {
  const [view, setView] = useState<View>('OVERVIEW');
  const [heatPeriod, setHeatPeriod] = useState<'1D' | '1W'>('1D');
  const [selectedSector, setSelectedSector] = useState('ENERGY');
  const [scanner, setScanner] = useState<ScannerPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState<ScreenFilters>(DEFAULT_SCREEN_FILTERS);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    fetch('/api/swing-setups', { signal: controller.signal, credentials: 'same-origin' })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.status === 'unavailable') {
          throw new Error(typeof payload?.message === 'string' ? payload.message : 'Scanner unavailable');
        }
        return payload;
      })
      .then((payload) => {
        setScanner({
          status: String(payload?.status ?? 'live'),
          asOf: String(payload?.asOf ?? ''),
          universe: Number(payload?.universe ?? 0),
          scanned: Number(payload?.scanned ?? 0),
          quotes: coerceMarketQuotes(payload),
          message: typeof payload?.message === 'string' ? payload.message : undefined,
        });
      })
      .catch((reason) => {
        if (reason?.name !== 'AbortError') setError(reason instanceof Error ? reason.message : 'Scanner unavailable');
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  const quotes = useMemo(() => scanner?.quotes ?? [], [scanner]);
  const heatmap = markets?.heatmap ?? [];
  const selectedHeat = heatmap.find((item) => item.label === selectedSector) ?? heatmap[0];
  const validSectors = heatmap.filter((item) => item.daily !== null);
  const positiveSectors = validSectors.filter((item) => (item.daily as number) > 0).length;
  const breadthAverage = validSectors.length
    ? validSectors.reduce((sum, item) => sum + (item.daily as number), 0) / validSectors.length
    : null;

  const gainers = useMemo(() => rankMovers(quotes, 'change', 'up', 5), [quotes]);
  const losers = useMemo(() => rankMovers(quotes, 'change', 'down', 5), [quotes]);
  const active = useMemo(() => rankMovers(quotes, 'volume', 'up', 5), [quotes]);
  const unusual = useMemo(() => rankMovers(quotes, 'relativeVolume', 'up', 5), [quotes]);
  const advances = quotes.filter((row) => row.change !== null && row.change > 0).length;
  const declines = quotes.filter((row) => row.change !== null && row.change < 0).length;
  const unchanged = quotes.filter((row) => row.change === 0).length;
  const medianChange = useMemo(() => {
    const values = quotes.flatMap((row) => (row.change === null ? [] : [row.change])).sort((a, b) => a - b);
    if (!values.length) return null;
    const middle = Math.floor(values.length / 2);
    return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
  }, [quotes]);

  const sectors = useMemo(() => sectorOptions(quotes), [quotes]);
  const screened = useMemo(() => screenQuotes(quotes, filters).slice(0, 60), [quotes, filters]);
  const coverage = scanner ? `${quotes.length}/${scanner.universe || '—'}` : '—';

  return (
    <section className="explorer-shell">
      <header className="panel explorer-toolbar">
        <div className="explorer-heading">
          <span className="explorer-kicker">DISCOVER / MARKET EXPLORER</span>
          <h2>IDX market surface</h2>
          <p>One screen for sector structure, movers and the scanned IDX universe. Weekly history is only shown where the Yahoo basket provides it.</p>
        </div>
        <nav className="explorer-views" aria-label="Market explorer views">
          {VIEWS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={view === item.id ? 'active' : ''}
              aria-current={view === item.id ? 'page' : undefined}
              title={item.hint}
              onClick={() => setView(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="explorer-status">
          <span>SCAN COVERAGE <b>{coverage}</b></span>
          <span>SPOT <b>{markets ? markets.status.toUpperCase() : 'OFFLINE'}</b></span>
          <span>WEEKLY <b>{markets?.heatmap.some((item) => item.weekly !== null) ? 'AVAILABLE' : 'UNAVAILABLE'}</b></span>
        </div>
      </header>

      {view === 'OVERVIEW' && (
        <div className="dashboard-grid markets-grid explorer-overview">
          <article className="panel heatmap-panel">
            <header className="panel-head">
              <div><h2>IDX SECTOR HEATMAP</h2></div>
              <div className="range-switcher">
                {(['1D', '1W'] as const).map((item) => (
                  <button key={item} type="button" onClick={() => setHeatPeriod(item)} className={heatPeriod === item ? 'active' : ''}>{item}</button>
                ))}
              </div>
            </header>
            {heatmap.length === 0 ? (
              <div className="feed-unavailable">
                <span>CONNECTION STATUS</span>
                <strong>SECTOR BASKET UNAVAILABLE</strong>
                <p>No sector or constituent prices are shown while the Yahoo basket is offline. The scanner views below use a separate upstream.</p>
              </div>
            ) : (
              <>
                <div className="heatmap">
                  {heatmap.map((item, index) => {
                    const value = heatPeriod === '1D' ? item.daily : item.weekly;
                    return (
                      <button
                        key={item.label}
                        type="button"
                        onClick={() => setSelectedSector(item.label)}
                        className={`heat-tile ${TILE_SIZES[index] ?? 'md'} ${value === null ? 'no-data' : heatTone(value)} ${item.confidence === 'low' ? 'low-confidence' : ''} ${selectedHeat?.label === item.label ? 'selected' : ''}`}
                      >
                        <span>{item.label}</span>
                        <strong>{value === null ? '—' : `${signed(value)}%`}</strong>
                        <small>{item.confidence === 'low' ? `LOW CONFIDENCE · ${item.validCount ?? 0}/${item.memberCount ?? 0} VALID` : 'VIEW MEMBERS →'}</small>
                      </button>
                    );
                  })}
                </div>
                {selectedHeat && (
                  <div className="heat-drilldown">
                    <div>
                      <span>SELECTED SECTOR</span>
                      <strong>{selectedHeat.label}</strong>
                      <small>SIMPLE AVG · {selectedHeat.validCount ?? selectedHeat.constituents.length}/{selectedHeat.memberCount ?? selectedHeat.constituents.length} VALID</small>
                    </div>
                    {selectedHeat.constituents.length ? selectedHeat.constituents.map((stock) => {
                      const value = heatPeriod === '1D' ? stock.daily : stock.weekly;
                      return (
                        <button key={stock.ticker} type="button" className="heat-constituent" onClick={() => onSelectStock(stock.ticker)} title={`Click to view ${stock.ticker} fundamentals`}>
                          <span>{stock.ticker}</span>
                          <strong>{price(stock.price)}</strong>
                          <small className={value === null ? '' : value >= 0 ? 'positive' : 'negative'}>{value === null ? 'NO VALID RETURN' : `${signed(value)}%`}</small>
                        </button>
                      );
                    }) : <p>Constituent feed unavailable for this sector.</p>}
                  </div>
                )}
              </>
            )}
            <footer className="panel-foot">
              <span>SIMPLE AVERAGE OF VALID IDX-IC CONSTITUENT BASKETS</span>
              <span>{markets ? `${markets.status.toUpperCase()} · YAHOO UPSTREAM` : 'FEED OFFLINE'}</span>
            </footer>
          </article>

          <div className="explorer-side">
            <article className="panel breadth-panel">
              <header className="panel-head"><div><h2>MARKET BREADTH</h2></div><span className="head-note">SECTOR BASKET</span></header>
              <div className="breadth-grid">
                <div><span>POSITIVE SECTORS</span><strong>{validSectors.length ? `${positiveSectors}/${validSectors.length}` : '—'}</strong></div>
                <div><span>AVERAGE MOVE</span><strong className={breadthAverage === null ? '' : breadthAverage >= 0 ? 'positive' : 'negative'}>{breadthAverage === null ? '—' : `${signed(breadthAverage)}%`}</strong></div>
                <div><span>SCANNED QUOTES</span><strong>{quotes.length || '—'}</strong></div>
                <div><span>ADVANCE / DECLINE</span><strong>{quotes.length ? `${advances} / ${declines}` : '—'}</strong></div>
              </div>
              <p className="breadth-note">
                Sector breadth uses the Yahoo constituent baskets. The scanner breadth uses the wider TradingView IDX universe and is end-of-day, not intraday.
              </p>
              <footer className="panel-foot"><span>NO ESTIMATES · MISSING VALUES STAY BLANK</span><span>{markets ? markets.freshness.slice(0, 10) : 'OFFLINE'}</span></footer>
            </article>
            {calendar}
          </div>
        </div>
      )}

      {view === 'MOVERS' && (
        <div className="movers-view">
          <article className="panel scanner-strip">
            <div className="scanner-strip-main">
              <span>TRADINGVIEW IDX SCAN</span>
              <strong>{loading ? 'LOADING…' : error ? 'UNAVAILABLE' : `${quotes.length} QUOTES · ${advances} UP / ${declines} DOWN`}</strong>
              <p>{error ? error : 'End-of-day scanner values. Movers rank the fields the scanner actually returned; null metrics are never treated as zero.'}</p>
            </div>
            <div className="scanner-strip-stats">
              <div><span>MEDIAN 1D</span><strong className={medianChange === null ? '' : medianChange >= 0 ? 'positive' : 'negative'}>{medianChange === null ? '—' : `${signed(medianChange)}%`}</strong></div>
              <div><span>UNCHANGED</span><strong>{quotes.length ? unchanged : '—'}</strong></div>
              <div><span>AS OF</span><strong>{scanner?.asOf ? new Date(scanner.asOf).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }) + ' WIB' : '—'}</strong></div>
            </div>
          </article>

          <div className="movers-grid">
            <MoverList title="TOP GAINERS" hint="1D CHANGE · SCANNED UNIVERSE" rows={gainers} empty={loading ? 'Loading scanner…' : error ? 'Scanner unavailable.' : 'No positive changes in this scan.'} onSelectStock={onSelectStock} />
            <MoverList title="TOP LOSERS" hint="1D CHANGE · SCANNED UNIVERSE" rows={losers} empty={loading ? 'Loading scanner…' : error ? 'Scanner unavailable.' : 'No negative changes in this scan.'} onSelectStock={onSelectStock} />
            <MoverList title="MOST ACTIVE" hint="TRADED VOLUME · NOT TURNOVER" rows={active} empty={loading ? 'Loading scanner…' : error ? 'Scanner unavailable.' : 'Volume unavailable.'} onSelectStock={onSelectStock} />
            <MoverList title="UNUSUAL VOLUME" hint="RELATIVE VOLUME VS 10D AVERAGE" rows={unusual} empty={loading ? 'Loading scanner…' : error ? 'Scanner unavailable.' : 'Relative volume unavailable.'} onSelectStock={onSelectStock} />
          </div>
        </div>
      )}

      {view === 'SCREENER' && (
        <article className="panel screener-panel">
          <header className="panel-head">
            <div><h2>IDX SCREENER</h2><span className="head-note">{loading ? 'LOADING SCANNER' : error ? 'SCANNER UNAVAILABLE' : `${quotes.length} QUOTES · END-OF-DAY`}</span></div>
            <span className="head-note">NO PRICE TARGETS · NO ESTIMATED FIELDS</span>
          </header>
          <div className="screener-controls">
            <label>
              <span>SEARCH</span>
              <input
                type="search"
                value={filters.query}
                placeholder="Ticker, company or sector"
                onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
              />
            </label>
            <label>
              <span>SECTOR</span>
              <select value={filters.sector} onChange={(event) => setFilters((current) => ({ ...current, sector: event.target.value }))}>
                <option value="ALL">All sectors</option>
                {sectors.map((sector) => <option key={sector} value={sector}>{sector}</option>)}
              </select>
            </label>
            <label>
              <span>DIRECTION</span>
              <select value={filters.direction} onChange={(event) => setFilters((current) => ({ ...current, direction: event.target.value as ScreenFilters['direction'] }))}>
                <option value="all">All</option>
                <option value="up">Up</option>
                <option value="down">Down</option>
              </select>
            </label>
            <label>
              <span>SORT</span>
              <select value={filters.sort} onChange={(event) => setFilters((current) => ({ ...current, sort: event.target.value as ScreenFilters['sort'] }))}>
                <option value="change">1D change</option>
                <option value="relativeVolume">Relative volume</option>
                <option value="rsi">RSI</option>
                <option value="marketCap">Market cap</option>
                <option value="ticker">Ticker</option>
              </select>
            </label>
          </div>

          {error ? (
            <div className="feed-unavailable">
              <span>CONNECTION STATUS</span>
              <strong>SCREENER FEED UNAVAILABLE</strong>
              <p>{error} No rows are shown rather than a stale or synthetic universe.</p>
            </div>
          ) : (
            <div className="screener-table-wrap">
              <div className="screener-table screener-table-head">
                <span>TICKER</span><span>NAME</span><span>SECTOR</span><span>LAST</span><span>1D</span><span>REL VOL</span><span>RSI</span><span>MKT CAP</span>
              </div>
              {screened.length === 0 && !loading && <p className="screener-empty">No rows match these filters. Clear the search or widen the sector filter.</p>}
              {loading && <p className="screener-empty">Scanning the IDX universe…</p>}
              {screened.map((row) => (
                <button key={row.ticker} type="button" className="screener-table screener-row" onClick={() => onSelectStock(row.ticker)}>
                  <strong>{row.ticker}</strong>
                  <span>{row.name}</span>
                  <span>{row.sector}</span>
                  <span>{price(row.close)}</span>
                  <span className={row.change === null ? '' : row.change >= 0 ? 'positive' : 'negative'}>{pct(row.change)}</span>
                  <span>{row.relativeVolume === null ? '—' : `${row.relativeVolume.toFixed(2)}×`}</span>
                  <span>{row.rsi === null ? '—' : row.rsi.toFixed(1)}</span>
                  <span>{compact(row.marketCap)}</span>
                </button>
              ))}
            </div>
          )}
          <footer className="panel-foot">
            <span>SCANNER VALUES ARE END-OF-DAY · CLICK A ROW FOR STOCK DETAIL</span>
            <span>{scanner ? `${quotes.length}/${scanner.universe || '—'} COVERED` : error ? 'FEED OFFLINE' : 'LOADING'}</span>
          </footer>
        </article>
      )}
    </section>
  );
}
