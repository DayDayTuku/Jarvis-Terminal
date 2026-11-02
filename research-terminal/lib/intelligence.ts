/**
 * Research Desk aggregation.
 *
 * Combines two independent surfaces that already exist — the swing-setup
 * scanner and the quantamental valuation map — into one queue. Nothing is
 * invented: a candidate only carries the fields its source actually returned,
 * absent values stay `null`, and the ranking rule is deliberately simple and
 * documented so users can reason about why a name appears where it does.
 */

import { normaliseTicker } from "./market-explorer.ts";

export type ResearchSource = "SETUP" | "VALUATION";

export type SetupInput = {
  ticker: string;
  name?: string | null;
  sector?: string | null;
  setup: string;
  score: number;
  riskReward?: number | null;
};

export type ValuationInput = {
  ticker: string;
  name?: string | null;
  sector?: string | null;
  quadrant: string;
  gap: number | null;
  momentum: number | null;
  momentumBasis?: string | null;
  basis?: string | null;
  thin?: boolean;
};

export type ResearchCandidate = {
  ticker: string;
  name: string;
  sector: string | null;
  sources: ResearchSource[];
  setup: string | null;
  score: number | null;
  riskReward: number | null;
  quadrant: string | null;
  gap: number | null;
  momentum: number | null;
  thin: boolean;
};

export type ResearchQueueFilter = "all" | "both" | "setup" | "valuation";

export const QUADRANT_LABELS: Record<string, string> = {
  "re-rating": "RE-RATING",
  "value-trap": "VALUE TRAP",
  "priced-in": "PRICED IN",
  "de-rating": "DE-RATING",
  improving: "IMPROVING",
  drifting: "DRIFTING",
};

const QUADRANT_ORDER = ["re-rating", "priced-in", "value-trap", "de-rating", "improving", "drifting"] as const;

export function quadrantLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return QUADRANT_LABELS[value] ?? value.replace(/-/g, " ").toUpperCase();
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Union scanner setups and valuation stocks by normalised ticker. A name that
 * appears in both keeps both source tags and each source's own fields; neither
 * source is allowed to fill a field owned by the other.
 */
export function mergeResearchCandidates(
  setups: readonly SetupInput[],
  valuations: readonly ValuationInput[],
): ResearchCandidate[] {
  const byTicker = new Map<string, ResearchCandidate>();

  const ensure = (ticker: string, name: string, sector: string | null): ResearchCandidate => {
    const existing = byTicker.get(ticker);
    if (existing) {
      if (!existing.name && name) existing.name = name;
      if (!existing.sector && sector) existing.sector = sector;
      return existing;
    }
    const created: ResearchCandidate = {
      ticker,
      name: name || ticker,
      sector,
      sources: [],
      setup: null,
      score: null,
      riskReward: null,
      quadrant: null,
      gap: null,
      momentum: null,
      thin: false,
    };
    byTicker.set(ticker, created);
    return created;
  };

  for (const setup of setups) {
    const ticker = normaliseTicker(setup.ticker);
    if (!ticker) continue;
    const candidate = ensure(ticker, text(setup.name), text(setup.sector) || null);
    if (!candidate.sources.includes("SETUP")) candidate.sources.push("SETUP");
    candidate.setup = text(setup.setup) || candidate.setup;
    candidate.score = finite(setup.score);
    candidate.riskReward = finite(setup.riskReward);
  }

  for (const valuation of valuations) {
    const ticker = normaliseTicker(valuation.ticker);
    if (!ticker) continue;
    const candidate = ensure(ticker, text(valuation.name), text(valuation.sector) || null);
    if (!candidate.sources.includes("VALUATION")) candidate.sources.push("VALUATION");
    candidate.quadrant = text(valuation.quadrant) || candidate.quadrant;
    candidate.gap = finite(valuation.gap);
    candidate.momentum = finite(valuation.momentum);
    candidate.thin = valuation.thin === true;
  }

  return [...byTicker.values()].sort((a, b) => a.ticker.localeCompare(b.ticker));
}

/**
 * Ranking rule:
 *   1. names confirmed by both surfaces first,
 *   2. then scanner setups by score,
 *   3. then valuation-only names by absolute peer gap,
 *   4. ticker as the deterministic tie-break.
 * Null metrics always sort last; they are never treated as zero.
 */
export function rankResearchCandidates(
  candidates: readonly ResearchCandidate[],
  limit = Number.POSITIVE_INFINITY,
): ResearchCandidate[] {
  const sourceRank = (candidate: ResearchCandidate) =>
    candidate.sources.length > 1 ? 0 : candidate.sources.includes("SETUP") ? 1 : 2;
  const scoreOf = (candidate: ResearchCandidate) => candidate.score ?? -Infinity;
  const gapOf = (candidate: ResearchCandidate) => candidate.gap === null ? -Infinity : Math.abs(candidate.gap);
  return [...candidates]
    .sort((a, b) =>
      sourceRank(a) - sourceRank(b)
      || scoreOf(b) - scoreOf(a)
      || gapOf(b) - gapOf(a)
      || a.ticker.localeCompare(b.ticker))
    .slice(0, Math.max(0, limit));
}

export function filterResearchCandidates(
  candidates: readonly ResearchCandidate[],
  filter: ResearchQueueFilter,
): ResearchCandidate[] {
  if (filter === "all") return [...candidates];
  if (filter === "both") return candidates.filter((candidate) => candidate.sources.length > 1);
  if (filter === "setup") return candidates.filter((candidate) => candidate.sources.includes("SETUP"));
  return candidates.filter((candidate) => candidate.sources.includes("VALUATION"));
}

export function candidateNote(candidate: ResearchCandidate): string {
  if (candidate.sources.length > 1) return "Setup and valuation signal";
  if (candidate.sources.includes("SETUP")) return "Setup scanner only";
  return candidate.quadrant ? `Valuation · ${quadrantLabel(candidate.quadrant)}` : "Valuation only";
}

export type QuadrantCount = { key: string; label: string; count: number };

/** Count plotted quadrants in a fixed display order. Unknown states are ignored. */
export function summariseQuadrants(stocks: readonly ValuationInput[]): QuadrantCount[] {
  const counts = new Map<string, number>();
  for (const stock of stocks) {
    if (!stock.quadrant) continue;
    counts.set(stock.quadrant, (counts.get(stock.quadrant) ?? 0) + 1);
  }
  return QUADRANT_ORDER.map((key) => ({
    key,
    label: QUADRANT_LABELS[key],
    count: counts.get(key) ?? 0,
  }));
}

export type PaperInput = {
  id: string;
  title: string;
  sector?: string | null;
  published_on: string;
  created_at?: string | null;
};

/** Latest papers by publication date, then creation date. Invalid dates drop. */
export function latestPapers<T extends PaperInput>(papers: readonly T[], limit = 3): T[] {
  return [...papers]
    .filter((paper) => /^\d{4}-\d{2}-\d{2}$/.test(paper.published_on))
    .sort((a, b) =>
      b.published_on.localeCompare(a.published_on)
      || String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))
    .slice(0, Math.max(0, limit));
}

/** Coerce the setup scanner payload defensively. Invalid rows are dropped. */
export function coerceSetupRows(payload: unknown): SetupInput[] {
  if (!payload || typeof payload !== "object") return [];
  const rows = (payload as { setups?: unknown }).setups;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const raw = row as Record<string, unknown>;
    const ticker = normaliseTicker(raw.ticker);
    const setup = text(raw.setup);
    const score = finite(raw.score);
    if (!ticker || !setup || score === null) return [];
    return [{
      ticker,
      name: text(raw.name) || ticker,
      sector: text(raw.sector) || null,
      setup,
      score,
      riskReward: finite(raw.riskReward),
    }];
  });
}

/** Coerce the quantamental payload defensively. Missing signals stay null. */
export function coerceValuationRows(payload: unknown): ValuationInput[] {
  if (!payload || typeof payload !== "object") return [];
  const rows = (payload as { stocks?: unknown }).stocks;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const raw = row as Record<string, unknown>;
    const ticker = normaliseTicker(raw.ticker);
    const quadrant = text(raw.quadrant);
    if (!ticker || !quadrant) return [];
    return [{
      ticker,
      name: text(raw.name) || ticker,
      sector: text(raw.sector) || null,
      quadrant,
      gap: finite(raw.gap),
      momentum: finite(raw.momentum),
      momentumBasis: text(raw.momentumBasis) || null,
      basis: text(raw.basis) || null,
      thin: raw.thin === true,
    }];
  });
}

/** Coerce the research-paper payload defensively. */
export function coercePaperRows<T extends PaperInput>(payload: unknown): T[] {
  if (!payload || typeof payload !== "object") return [];
  const rows = (payload as { papers?: unknown }).papers;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const raw = row as Record<string, unknown>;
    const id = text(raw.id);
    const title = text(raw.title);
    const published = text(raw.published_on);
    if (!id || !title || !published) return [];
    return [{ ...raw, id, title, sector: text(raw.sector) || null, published_on: published } as T];
  });
}
