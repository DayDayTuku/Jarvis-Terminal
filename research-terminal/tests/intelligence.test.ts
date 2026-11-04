import test from "node:test";
import assert from "node:assert/strict";
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
  type ResearchCandidate,
  type SetupInput,
  type ValuationInput,
} from "../lib/intelligence.ts";

const setup = (overrides: Partial<SetupInput> = {}): SetupInput => ({
  ticker: "BBCA",
  name: "Bank Central Asia",
  sector: "Financials",
  setup: "breakout",
  score: 70,
  riskReward: 2.5,
  ...overrides,
});

const valuation = (overrides: Partial<ValuationInput> = {}): ValuationInput => ({
  ticker: "BBCA",
  name: "Bank Central Asia",
  sector: "Financials",
  quadrant: "re-rating",
  gap: 12.5,
  momentum: 8.1,
  ...overrides,
});

test("merge deduplicates by ticker and normalises IDX/JK suffixes", () => {
  const merged = mergeResearchCandidates(
    [setup({ ticker: "IDX:BBCA" })],
    [valuation({ ticker: "bbca.jk" })],
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].ticker, "BBCA");
  assert.deepEqual(merged[0].sources, ["SETUP", "VALUATION"]);
});

test("merge keeps each source's own fields and never cross-fills", () => {
  const merged = mergeResearchCandidates(
    [setup({ ticker: "BBRI", score: 81 })],
    [valuation({ ticker: "BBRI", quadrant: "value-trap", gap: -9.4, momentum: -3.2 })],
  );
  const [row] = merged;
  assert.equal(row.score, 81);
  assert.equal(row.setup, "breakout");
  assert.equal(row.quadrant, "value-trap");
  assert.equal(row.gap, -9.4);
  assert.equal(row.momentum, -3.2);
});

test("merge leaves absent metrics null rather than zero", () => {
  const merged = mergeResearchCandidates([setup({ ticker: "ANTM", riskReward: null })], []);
  assert.equal(merged[0].gap, null);
  assert.equal(merged[0].momentum, null);
  assert.equal(merged[0].quadrant, null);
  assert.equal(merged[0].riskReward, null);
  assert.deepEqual(merged[0].sources, ["SETUP"]);
});

test("merge ignores rows without a usable ticker", () => {
  const merged = mergeResearchCandidates(
    [setup({ ticker: "   " }), setup({ ticker: "TLKM" })],
    [valuation({ ticker: "" })],
  );
  assert.deepEqual(merged.map((row) => row.ticker), ["TLKM"]);
});

test("merge is deterministic and sorted by ticker", () => {
  const merged = mergeResearchCandidates(
    [setup({ ticker: "ZZZZ" }), setup({ ticker: "AAAA" })],
    [valuation({ ticker: "MMMM" })],
  );
  assert.deepEqual(merged.map((row) => row.ticker), ["AAAA", "MMMM", "ZZZZ"]);
});

test("ranking puts cross-surface names first, then setup score, then gap", () => {
  const merged = mergeResearchCandidates(
    [
      setup({ ticker: "AAAA", score: 99 }),
      setup({ ticker: "BBBB", score: 50 }),
      setup({ ticker: "CCCC", score: 10 }),
    ],
    [
      valuation({ ticker: "BBBB", gap: 5 }),
      valuation({ ticker: "DDDD", gap: 40 }),
      valuation({ ticker: "EEEE", gap: 90 }),
    ],
  );
  const ranked = rankResearchCandidates(merged);
  assert.deepEqual(ranked.map((row) => row.ticker), ["BBBB", "AAAA", "CCCC", "EEEE", "DDDD"]);
});

test("ranking treats null scores and gaps as last, never as zero", () => {
  const candidates: ResearchCandidate[] = [
    { ...baseCandidate("NEAR"), sources: ["SETUP"], score: 0, gap: null },
    { ...baseCandidate("NONE"), sources: ["SETUP"], score: null, gap: null },
    { ...baseCandidate("HIGH"), sources: ["SETUP"], score: 42, gap: null },
  ];
  const ranked = rankResearchCandidates(candidates);
  assert.deepEqual(ranked.map((row) => row.ticker), ["HIGH", "NEAR", "NONE"]);
});

test("ranking respects the limit and a zero limit", () => {
  const merged = mergeResearchCandidates(
    [setup({ ticker: "AAAA" }), setup({ ticker: "BBBB" })],
    [],
  );
  assert.equal(rankResearchCandidates(merged, 1).length, 1);
  assert.equal(rankResearchCandidates(merged, 0).length, 0);
});

function baseCandidate(ticker: string): ResearchCandidate {
  return {
    ticker,
    name: ticker,
    sector: null,
    sources: [],
    setup: null,
    score: null,
    riskReward: null,
    quadrant: null,
    gap: null,
    momentum: null,
    thin: false,
  };
}

test("filters split the union by source", () => {
  const merged = mergeResearchCandidates(
    [setup({ ticker: "AAAA" }), setup({ ticker: "BBBB" })],
    [valuation({ ticker: "BBBB" }), valuation({ ticker: "CCCC" })],
  );
  assert.deepEqual(filterResearchCandidates(merged, "all").map((row) => row.ticker), ["AAAA", "BBBB", "CCCC"]);
  assert.deepEqual(filterResearchCandidates(merged, "both").map((row) => row.ticker), ["BBBB"]);
  assert.deepEqual(filterResearchCandidates(merged, "setup").map((row) => row.ticker), ["AAAA", "BBBB"]);
  assert.deepEqual(filterResearchCandidates(merged, "valuation").map((row) => row.ticker), ["BBBB", "CCCC"]);
});

test("candidateNote explains where a name came from", () => {
  const merged = mergeResearchCandidates(
    [setup({ ticker: "AAAA" }), setup({ ticker: "BBBB" })],
    [valuation({ ticker: "BBBB", quadrant: "priced-in" })],
  );
  const byTicker = new Map(merged.map((row) => [row.ticker, row]));
  assert.equal(candidateNote(byTicker.get("AAAA")!), "Setup scanner only");
  assert.equal(candidateNote(byTicker.get("BBBB")!), "Setup and valuation signal");
  const lone = mergeResearchCandidates([], [valuation({ ticker: "CCCC", quadrant: "value-trap" })])[0];
  assert.equal(candidateNote(lone), "Valuation · CHEAP · DETERIORATING");
});

test("quadrant labels fall back to a readable form for unknown states", () => {
  assert.equal(quadrantLabel("re-rating"), "UNDERVALUED · IMPROVING");
  assert.equal(quadrantLabel("value-trap"), "CHEAP · DETERIORATING");
  assert.equal(quadrantLabel("no-momentum"), "NO MOMENTUM");
  assert.equal(quadrantLabel(null), "—");
});

test("quadrant summary counts known states in a fixed order and ignores the rest", () => {
  const counts = summariseQuadrants([
    valuation({ ticker: "A", quadrant: "re-rating" }),
    valuation({ ticker: "B", quadrant: "re-rating" }),
    valuation({ ticker: "C", quadrant: "value-trap" }),
    valuation({ ticker: "D", quadrant: "no-momentum" }),
    valuation({ ticker: "E", quadrant: "" }),
  ]);
  assert.deepEqual(counts.map((entry) => entry.key), [
    "re-rating",
    "priced-in",
    "value-trap",
    "de-rating",
    "improving",
    "drifting",
  ]);
  assert.equal(counts.find((entry) => entry.key === "re-rating")!.count, 2);
  assert.equal(counts.find((entry) => entry.key === "value-trap")!.count, 1);
  assert.equal(counts.reduce((sum, entry) => sum + entry.count, 0), 3);
});

const paper = (overrides: Partial<PaperInput> = {}): PaperInput => ({
  id: "p1",
  title: "Paper",
  sector: "Banks",
  published_on: "2026-01-05",
  created_at: "2026-01-06T00:00:00Z",
  ...overrides,
});

test("latest papers sort by publication date then creation date", () => {
  const papers = latestPapers([
    paper({ id: "a", published_on: "2026-01-01" }),
    paper({ id: "b", published_on: "2026-03-01" }),
    paper({ id: "c", published_on: "2026-02-01", created_at: "2026-02-02T00:00:00Z" }),
  ]);
  assert.deepEqual(papers.map((item) => item.id), ["b", "c", "a"]);
});

test("latest papers drop invalid dates and honour the limit", () => {
  const papers = latestPapers([
    paper({ id: "bad", published_on: "not-a-date" }),
    paper({ id: "a", published_on: "2026-01-01" }),
    paper({ id: "b", published_on: "2026-02-01" }),
  ], 1);
  assert.deepEqual(papers.map((item) => item.id), ["b"]);
});

test("setup coercion drops rows missing ticker, setup or score", () => {
  const rows = coerceSetupRows({
    setups: [
      { ticker: "IDX:AAAA", name: "A", setup: "breakout", score: 80, riskReward: 2 },
      { ticker: "BBBB", setup: "pullback" },
      { ticker: "CCCC", setup: "", score: 40 },
      { ticker: "", setup: "momentum", score: 40 },
      "nope",
      null,
    ],
  });
  assert.deepEqual(rows.map((row) => row.ticker), ["AAAA"]);
  assert.equal(rows[0].riskReward, 2);
});

test("setup coercion tolerates malformed payloads", () => {
  assert.deepEqual(coerceSetupRows(null), []);
  assert.deepEqual(coerceSetupRows({}), []);
  assert.deepEqual(coerceSetupRows({ setups: "x" }), []);
});

test("valuation coercion drops rows without a ticker or quadrant", () => {
  const rows = coerceValuationRows({
    stocks: [
      { ticker: "AAAA", quadrant: "re-rating", gap: 3.4, momentum: 2.1, thin: true },
      { ticker: "BBBB", gap: 4 },
      { ticker: "CCCC", quadrant: "priced-in", gap: "x" },
    ],
  });
  assert.deepEqual(rows.map((row) => row.ticker), ["AAAA", "CCCC"]);
  assert.equal(rows[0].thin, true);
  assert.equal(rows[1].gap, null);
  assert.equal(rows[1].momentum, null);
});

test("paper coercion keeps valid rows and drops incomplete ones", () => {
  const rows = coercePaperRows<PaperInput & { extra?: string }>({
    papers: [
      { id: "p1", title: "One", published_on: "2026-01-01", sector: "Banks", extra: "keep" },
      { id: "p2", published_on: "2026-01-01" },
      { title: "Three", published_on: "2026-01-01" },
      { id: "p4", title: "Four" },
    ],
  });
  assert.deepEqual(rows.map((row) => row.id), ["p1"]);
  assert.equal(rows[0].extra, "keep");
  assert.equal(rows[0].sector, "Banks");
});
