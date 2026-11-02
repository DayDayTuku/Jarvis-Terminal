"use client";

import { useEffect, useMemo, useState } from "react";
import type { Section } from "../../lib/navigation";
import {
  candidateNote,
  coercePaperRows,
  coerceSetupRows,
  coerceValuationRows,
  filterResearchCandidates,
  latestPapers,
  mergeResearchCandidates,
  quadrantLabel,
  rankResearchCandidates,
  summariseQuadrants,
  type PaperInput,
  type ResearchQueueFilter,
  type SetupInput,
  type ValuationInput,
} from "../../lib/intelligence";

type ScannerPayload = {
  status: string;
  asOf: string;
  universe: number;
  scanned: number;
  setups: SetupInput[];
  message?: string;
};

type ValuationPayload = {
  status: string;
  asOf: string;
  universeSize: number;
  plotted: number;
  noMomentum: number;
  noValuation: number;
  stocks: ValuationInput[];
};

type PaperPayload = { papers: PaperInput[] };

type Loaded<T> = { data: T | null; error: string | null };

const FILTERS: Array<{ id: ResearchQueueFilter; label: string }> = [
  { id: "all", label: "ALL NAMES" },
  { id: "both", label: "BOTH SIGNALS" },
  { id: "setup", label: "SETUPS" },
  { id: "valuation", label: "VALUATION" },
];

function errorMessage(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  return "Feed unavailable";
}

function signed(value: number | null, digits = 1) {
  return value === null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function number(value: number) {
  return value.toLocaleString("en-US");
}

async function getJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal, credentials: "same-origin", cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    const message = typeof body.message === "string" ? body.message : typeof body.error === "string" ? body.error : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

function statusTone(error: string | null, status?: string) {
  if (error) return "unavailable";
  if (!status) return "loading";
  return status.toLowerCase();
}

export default function ResearchDesk({
  onSelectStock,
  onNavigate,
}: {
  onSelectStock: (ticker: string) => void;
  onNavigate: (section: Section) => void;
}) {
  const [scanner, setScanner] = useState<Loaded<ScannerPayload>>({ data: null, error: null });
  const [valuation, setValuation] = useState<Loaded<ValuationPayload>>({ data: null, error: null });
  const [library, setLibrary] = useState<Loaded<PaperPayload>>({ data: null, error: null });
  const [filter, setFilter] = useState<ResearchQueueFilter>("all");

  useEffect(() => {
    const controller = new AbortController();
    Promise.allSettled([
      getJson("/api/swing-setups", controller.signal),
      getJson("/api/quantamental", controller.signal),
      getJson("/api/research-papers", controller.signal),
    ]).then(([scannerResult, valuationResult, libraryResult]) => {
      if (controller.signal.aborted) return;

      if (scannerResult.status === "fulfilled") {
        const raw = scannerResult.value && typeof scannerResult.value === "object" ? scannerResult.value as Record<string, unknown> : {};
        setScanner({
          data: {
            status: String(raw.status ?? "live"),
            asOf: String(raw.asOf ?? ""),
            universe: Number(raw.universe ?? 0),
            scanned: Number(raw.scanned ?? 0),
            setups: coerceSetupRows(raw),
            message: typeof raw.message === "string" ? raw.message : undefined,
          },
          error: null,
        });
      } else {
        setScanner({ data: null, error: errorMessage(scannerResult.reason) });
      }

      if (valuationResult.status === "fulfilled") {
        const raw = valuationResult.value && typeof valuationResult.value === "object" ? valuationResult.value as Record<string, unknown> : {};
        setValuation({
          data: {
            status: String(raw.status ?? "live"),
            asOf: String(raw.asOf ?? ""),
            universeSize: Number(raw.universeSize ?? 0),
            plotted: Number(raw.plotted ?? 0),
            noMomentum: Number(raw.noMomentum ?? 0),
            noValuation: Number(raw.noValuation ?? 0),
            stocks: coerceValuationRows(raw),
          },
          error: null,
        });
      } else {
        setValuation({ data: null, error: errorMessage(valuationResult.reason) });
      }

      if (libraryResult.status === "fulfilled") {
        setLibrary({ data: { papers: coercePaperRows<PaperInput>(libraryResult.value) }, error: null });
      } else {
        setLibrary({ data: null, error: errorMessage(libraryResult.reason) });
      }
    });
    return () => controller.abort();
  }, []);

  const candidates = useMemo(
    () => mergeResearchCandidates(scanner.data?.setups ?? [], valuation.data?.stocks ?? []),
    [scanner.data, valuation.data],
  );
  const ranked = useMemo(() => rankResearchCandidates(candidates, 60), [candidates]);
  const visible = useMemo(() => filterResearchCandidates(ranked, filter).slice(0, 12), [ranked, filter]);
  const bothCount = candidates.filter((candidate) => candidate.sources.length > 1).length;
  const setupCount = candidates.filter((candidate) => candidate.sources.includes("SETUP")).length;
  const valuationCount = candidates.filter((candidate) => candidate.sources.includes("VALUATION")).length;
  const quadrants = useMemo(
    () => summariseQuadrants(valuation.data?.stocks ?? []).filter((quadrant) => quadrant.count > 0),
    [valuation.data],
  );
  const papers = useMemo(() => latestPapers(library.data?.papers ?? [], 3), [library.data]);
  const paperCount = library.data?.papers.length ?? 0;
  const totalLoading = !scanner.data && !scanner.error && !valuation.data && !valuation.error;
  const queueEmpty = scanner.error !== null && valuation.error !== null;

  return (
    <section className="desk-shell">
      <header className="panel desk-hero">
        <div className="desk-hero-copy">
          <span className="desk-kicker">INTELLIGENCE / RESEARCH DESK</span>
          <h2>Turn scattered signals into one research queue.</h2>
          <p>
            Scanner setups and peer-relative valuation outliers are merged by ticker. A name appears once, keeps every
            source that flagged it, and never receives a field its source did not return.
          </p>
        </div>
        <div className="desk-status" aria-label="Research desk feed status">
          <span className={`desk-status-chip ${statusTone(scanner.error, scanner.data?.status)}`}>
            <i />SETUP SCANNER<b>{scanner.error ? "UNAVAILABLE" : scanner.data ? scanner.data.status.toUpperCase() : "LOADING"}</b>
          </span>
          <span className={`desk-status-chip ${statusTone(valuation.error, valuation.data?.status)}`}>
            <i />VALUATION MAP<b>{valuation.error ? "UNAVAILABLE" : valuation.data ? valuation.data.status.toUpperCase() : "LOADING"}</b>
          </span>
          <span className={`desk-status-chip ${statusTone(library.error)}`}>
            <i />RESEARCH LIBRARY<b>{library.error ? "UNAVAILABLE" : library.data ? `${paperCount} PAPERS` : "LOADING"}</b>
          </span>
        </div>
      </header>

      <div className="desk-metrics">
        <article className="panel desk-metric">
          <span>SETUP CANDIDATES</span>
          <strong>{scanner.data ? number(setupCount) : "—"}</strong>
          <small>{scanner.data ? `${number(scanner.data.scanned)}/${number(scanner.data.universe)} SCANNED · END-OF-DAY` : "SCANNER OFFLINE"}</small>
        </article>
        <article className="panel desk-metric">
          <span>VALUATION OUTLIERS</span>
          <strong>{valuation.data ? number(valuationCount) : "—"}</strong>
          <small>{valuation.data ? `${number(valuation.data.plotted)} PLOTTED · ${number(valuation.data.universeSize)} UNIVERSE` : "VALUATION OFFLINE"}</small>
        </article>
        <article className="panel desk-metric accent">
          <span>CROSS-SURFACE NAMES</span>
          <strong>{scanner.data || valuation.data ? number(bothCount) : "—"}</strong>
          <small>FLAGGED BY BOTH SETUP AND VALUATION</small>
        </article>
        <article className="panel desk-metric">
          <span>RESEARCH LIBRARY</span>
          <strong>{library.data ? number(paperCount) : "—"}</strong>
          <small>{papers[0] ? `LATEST ${new Date(`${papers[0].published_on}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })}` : library.error ? "LIBRARY OFFLINE" : "NO PAPERS PUBLISHED"}</small>
        </article>
      </div>

      <div className="desk-grid">
        <article className="panel desk-queue">
          <header className="panel-head">
            <div>
              <h2>RESEARCH QUEUE</h2>
              <span className="head-note">RANKED: BOTH SIGNALS → SETUP SCORE → ABSOLUTE VALUATION GAP</span>
            </div>
            <button type="button" className="quiet-button" onClick={() => onNavigate("QUANT LAB")}>OPEN QUANT LAB →</button>
          </header>

          <div className="desk-filters" role="group" aria-label="Filter research queue">
            {FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={filter === item.id ? "active" : ""}
                aria-pressed={filter === item.id}
                onClick={() => setFilter(item.id)}
              >
                {item.label}
                <b>{item.id === "all" ? candidates.length : item.id === "both" ? bothCount : item.id === "setup" ? setupCount : valuationCount}</b>
              </button>
            ))}
          </div>

          {totalLoading && <p className="desk-empty">LOADING SCANNER AND VALUATION FEEDS…</p>}

          {queueEmpty && (
            <div className="desk-warning">
              <strong>BOTH CORE FEEDS ARE UNAVAILABLE</strong>
              <span>{scanner.error} · {valuation.error}</span>
              <span>No candidate is shown rather than a stale or synthetic queue.</span>
            </div>
          )}

          {!totalLoading && !queueEmpty && visible.length === 0 && (
            <p className="desk-empty">
              {filter === "both"
                ? "No name is currently flagged by both screens. That is a valid outcome, not a missing row."
                : filter === "setup"
                  ? "No qualifying setup is available right now."
                  : filter === "valuation"
                    ? "No valuation outlier is available right now."
                    : "No candidates are available from the feeds that responded."}
            </p>
          )}

          {visible.map((candidate, index) => (
            <button key={candidate.ticker} type="button" className="desk-row" onClick={() => onSelectStock(candidate.ticker)}>
              <span className="desk-rank">{String(index + 1).padStart(2, "0")}</span>
              <span className="desk-id">
                <strong>{candidate.ticker}</strong>
                <small>{candidate.name}</small>
              </span>
              <span className="desk-tags">
                {candidate.sources.includes("SETUP") && <i className="setup">SETUP</i>}
                {candidate.sources.includes("VALUATION") && <i className="valuation">VALUATION</i>}
              </span>
              <span className="desk-signal">
                <b>{candidate.setup ? candidate.setup.replace(/_/g, " ").toUpperCase() : quadrantLabel(candidate.quadrant)}</b>
                <small>{candidateNote(candidate)}</small>
              </span>
              <span className="desk-numbers">
                <b>{candidate.score === null ? "—" : candidate.score}</b>
                <small>SCORE</small>
              </span>
              <span className="desk-numbers">
                <b className={candidate.gap === null ? "" : candidate.gap >= 0 ? "positive" : "negative"}>{signed(candidate.gap)}</b>
                <small>PEER GAP</small>
              </span>
              <span className="desk-numbers">
                <b className={candidate.momentum === null ? "" : candidate.momentum >= 0 ? "positive" : "negative"}>{signed(candidate.momentum)}</b>
                <small>MOMENTUM</small>
              </span>
            </button>
          ))}

          <footer className="panel-foot">
            <span>CLICK A ROW FOR STOCK DETAIL · QUEUE IS A RESEARCH START, NOT A RECOMMENDATION</span>
            <span>{scanner.data?.asOf ? `SCAN ${new Date(scanner.data.asOf).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" })} WIB` : "SCANNER OFFLINE"}</span>
          </footer>
        </article>

        <div className="desk-side">
          <article className="panel desk-quadrants">
            <header className="panel-head">
              <div><h2>VALUATION QUADRANTS</h2></div>
              <button type="button" className="quiet-button" onClick={() => onNavigate("QUANTAMENTAL")}>OPEN VALUATION MAP →</button>
            </header>
            {valuation.data ? (
              quadrants.length ? (
                <div className="desk-quadrant-list">
                  {quadrants.map((quadrant) => (
                    <div key={quadrant.key}>
                      <span>{quadrant.label}</span>
                      <strong>{number(quadrant.count)}</strong>
                    </div>
                  ))}
                </div>
              ) : <p className="desk-empty">No stock has a comparable valuation gap in the latest scan.</p>
            ) : <p className="desk-empty">{valuation.error ? "Valuation map unavailable. No quadrant counts are estimated." : "Loading valuation map…"}</p>}
            {valuation.data && (
              <footer className="panel-foot">
                <span>{number(valuation.data.noMomentum)} NO MOMENTUM · {number(valuation.data.noValuation)} NO GAP</span>
                <span>PEER-RELATIVE · NOT A PRICE TARGET</span>
              </footer>
            )}
          </article>

          <article className="panel desk-papers">
            <header className="panel-head">
              <div><h2>LATEST RESEARCH</h2></div>
              <button type="button" className="quiet-button" onClick={() => onNavigate("RESEARCH PAPERS")}>OPEN LIBRARY →</button>
            </header>
            {library.error ? (
              <p className="desk-empty">Research library unavailable. {library.error}</p>
            ) : !library.data ? (
              <p className="desk-empty">Loading research library…</p>
            ) : papers.length === 0 ? (
              <p className="desk-empty">No papers published yet. The desk does not seed placeholder research.</p>
            ) : (
              <div className="desk-paper-list">
                {papers.map((paper) => (
                  <div key={paper.id}>
                    <span>{paper.sector || "GENERAL RESEARCH"} · {new Date(`${paper.published_on}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })}</span>
                    <strong>{paper.title}</strong>
                  </div>
                ))}
              </div>
            )}
          </article>

          <p className="desk-footnote">
            Cross-surface names are deduplicated by bare ticker. A valuation gap means cheaper peers when positive; it is
            not a fair-value estimate. Scanner values are end-of-day.
          </p>
        </div>
      </div>
    </section>
  );
}
