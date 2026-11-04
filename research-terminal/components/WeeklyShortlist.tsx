"use client";

import { useEffect, useMemo, useState } from "react";
import type { QuantamentalStock } from "@/lib/quantamental";
import {
  scoreWeeklyPick,
  rankWeeklyPicks,
  WEEKLY_WEIGHTS,
  type WeeklyPickIntelligence,
  type WeeklyTechnicalInput,
} from "@/lib/weekly-intelligence";

type Setup = {
  ticker: string;
  setup: string;
  score: number;
  close: number;
  entryLow: number;
  entryHigh: number;
  invalidation: number;
  target: number;
  riskReward: number;
  sector?: string;
  change?: number | null;
  rsi?: number | null;
  relativeVolume?: number | null;
  distance20?: number | null;
  ema25?: number | null;
  ema50?: number | null;
  distance25?: number | null;
  baseSupport?: number | null;
  baseResistance?: number | null;
  trend?: boolean;
  aboveLongTrend?: boolean;
  nearHigh?: boolean;
  nearLow?: boolean;
  reasons?: string[];
  caution?: string;
};

const isShort = (item: { setup: string }) => item.setup.toLowerCase().startsWith("short_");

type Candidate = {
  id: string;
  rank: number;
  ticker: string;
  setup: string;
  score: number;
  planned_entry_low: number;
  planned_entry_high: number;
  invalidation: number;
  target_one: number;
  position_weight: number;
  reasons?: string[] | null;
  caution?: string | null;
};
type Action = {
  id: string;
  ticker: string;
  action: "BUY" | "HOLD" | "REDUCE" | "EXIT" | "REPLACE" | "NO_ENTRY" | "EXPIRED";
  previous_score: number | null;
  target_weight: number;
  reason: string;
};
type Macro = { exposure: number; flags: string[]; indexChangePct: number | null };
type State = {
  run: { week_of: string; market_regime?: string | null } | null;
  candidates: Candidate[];
  actions: Action[];
  canLock: boolean;
  currentWeek?: string;
  macro?: Macro;
};
type QuantMap = {
  status: string;
  asOf: string;
  dataAsOf: string | null;
  universeSize: number;
  coverage: { statements: number; valuation: number; fundamentalScore: number };
  stocks: QuantamentalStock[];
};
type Scored = Setup & {
  intel: WeeklyPickIntelligence;
  positionWeight: number;
};
type Regime = "RISK ON" | "EMERGING" | "NEUTRAL" | "RISK OFF";

const money = (value: number) =>
  new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(value);
const tick = (value: number) => (value < 200 ? 1 : value < 500 ? 2 : value < 2000 ? 5 : value < 5000 ? 10 : 25);
const px = (value: number, direction: "up" | "down" | "nearest" = "nearest") => {
  const step = tick(value);
  const round = direction === "up" ? Math.ceil : direction === "down" ? Math.floor : Math.round;
  return round(value / step) * step;
};
const regimeFor = (setups: Setup[]): Regime => {
  const valid = setups.filter(
    (item) => !isShort(item) && item.riskReward >= 1.7 && item.setup.toLowerCase() !== "reversal",
  );
  const emerging = valid.filter((item) => item.score >= 75).length;
  const strong = valid.filter((item) => item.score >= 85).length;
  return emerging >= 5 ? "RISK ON" : emerging >= 3 ? "EMERGING" : strong ? "NEUTRAL" : "RISK OFF";
};
const pick = (setups: Setup[], regime: Regime) => {
  if (regime === "RISK OFF") return [];
  const min = regime === "RISK ON" ? 75 : regime === "EMERGING" ? 80 : 85;
  const max = regime === "RISK ON" ? 5 : regime === "EMERGING" ? 3 : 1;
  const sectors = new Map<string, number>();
  return [...setups]
    .filter((item) => !isShort(item) && item.setup.toLowerCase() !== "reversal")
    .sort((a, b) => b.score - a.score || b.riskReward - a.riskReward)
    .filter((item) => item.score >= min && item.riskReward >= 1.7)
    .filter((item) => {
      const key = item.sector || "Other";
      const count = sectors.get(key) || 0;
      if (count >= 2) return false;
      sectors.set(key, count + 1);
      return true;
    })
    .slice(0, max);
};
const shortPick = (setups: Setup[]) =>
  [...setups]
    .filter(isShort)
    .filter((item) => item.score >= 85 && item.riskReward >= 2)
    .sort((a, b) => b.score - a.score || b.riskReward - a.riskReward)
    .slice(0, 1);
const kind = (item: { setup: string; score: number }) =>
  !isShort(item) && item.score >= 85 && /(PULLBACK|ACCUMULATION|TREND)/.test(item.setup.toUpperCase())
    ? "CORE"
    : "TACTICAL";
const weight = (item: { setup: string; score: number }, regime: Regime) => {
  const base =
    kind(item) === "CORE" ? (item.score >= 90 ? 15 : 12.5) : item.score >= 90 ? 10 : 7.5;
  const multiplier = regime === "RISK ON" ? 1 : regime === "EMERGING" ? 0.8 : 0.6;
  return Math.max(5, Math.round((base * multiplier) / 2.5) * 2.5);
};
const shortWeight = (item: Setup, longs: Setup[], regime: Regime) => {
  const weights = longs.map((long) => weight(long, regime)).sort((a, b) => a - b);
  const median = weights.length ? weights[Math.floor(weights.length / 2)] : 10;
  const stop = Math.max(0.1, ((item.invalidation - item.close) / item.close) * 100);
  const raw = Math.min(8, median * 0.7, 50 / stop);
  return Math.max(0, Math.floor(raw * 2) / 2);
};
const change = (action?: Action) =>
  !action
    ? "NEW"
    : action.action === "BUY"
      ? action.previous_score === null
        ? "NEW"
        : "ADD"
      : action.action === "HOLD"
        ? "KEEP"
        : action.action === "REDUCE"
          ? "TRIM"
          : action.action;
const tone: Record<string, string> = {
  NEW: "#43d4a3",
  ADD: "#43d4a3",
  KEEP: "#48a6ff",
  TRIM: "#ff9840",
  EXIT: "#ff6678",
  REPLACE: "#a78bfa",
  NO_ENTRY: "#778596",
  EXPIRED: "#778596",
};
const stanceTone: Record<string, string> = {
  BUY: "#43d4a3",
  WATCH: "#48a6ff",
  AVOID: "#ff6678",
};
const cleanReason = (value?: string | null) =>
  String(value || "").replace(/\s*\[(?:stop|target)-alert:sent\]\s*/g, " ").trim();
const OBS_DAYS = ["Mon", "Tue", "Wed", "Thu"];
const wibWeekKey = () => {
  const wib = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" }));
  const day = wib.getDay() || 7;
  wib.setDate(wib.getDate() - (day - 1));
  return wib.toLocaleDateString("en-CA");
};
const readObserved = () => {
  try {
    const raw = JSON.parse(localStorage.getItem("jarvis_weekly_observed_days") || "null") as {
      week?: string;
      days?: string[];
    } | null;
    return raw && raw.week === wibWeekKey() && Array.isArray(raw.days)
      ? raw.days.filter((day) => OBS_DAYS.includes(day))
      : [];
  } catch {
    return [];
  }
};
const fmtDate = (value?: string | null) => {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  });
};
const toInput = (item: Setup): WeeklyTechnicalInput => ({
  ticker: item.ticker,
  setup: item.setup,
  sector: item.sector,
  score: item.score,
  close: item.close,
  change: item.change ?? null,
  rsi: item.rsi ?? null,
  relativeVolume: item.relativeVolume ?? null,
  distance20: item.distance20 ?? null,
  ema25: item.ema25 ?? null,
  ema50: item.ema50 ?? null,
  distance25: item.distance25 ?? null,
  baseSupport: item.baseSupport ?? null,
  baseResistance: item.baseResistance ?? null,
  trend: item.trend,
  aboveLongTrend: item.aboveLongTrend,
  nearHigh: item.nearHigh,
  nearLow: item.nearLow,
  invalidation: item.invalidation,
  riskReward: item.riskReward,
});

export default function WeeklyShortlist({ setups }: { setups: Setup[] }) {
  const [state, setState] = useState<State | null>(null);
  const [quant, setQuant] = useState<QuantMap | null>(null);
  const [quantError, setQuantError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [observed, setObserved] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = async () => {
    try {
      const response = await fetch("/api/weekly-shortlist", { cache: "no-store" });
      if (!response.ok) throw new Error();
      setState((await response.json()) as State);
    } catch {
      setState(null);
    }
  };

  useEffect(() => {
    void load();
    setObserved(readObserved());
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const response = await fetch("/api/quantamental?scope=full", { cache: "no-store" });
        if (!response.ok) throw new Error("Quantamental map unavailable.");
        const payload = (await response.json()) as QuantMap;
        if (!cancelled) {
          setQuant(payload);
          setQuantError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setQuant(null);
          setQuantError(error instanceof Error ? error.message : "Quantamental map unavailable.");
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const regime = useMemo(() => regimeFor(setups), [setups]);
  const proposed = useMemo(() => pick(setups, regime), [setups, regime]);
  const shorts = useMemo(() => shortPick(setups), [setups]);
  const macro = state?.macro ?? null;
  const stockByTicker = useMemo(
    () => new Map((quant?.stocks ?? []).map((stock) => [stock.ticker, stock])),
    [quant],
  );

  const scored = useMemo<Scored[]>(() => {
    const rows = proposed.map((item) => {
      const intel = scoreWeeklyPick(toInput(item), stockByTicker.get(item.ticker), macro);
      const positionWeight = intel.stance === "BUY" ? weight(item, regime) : 0;
      return { ...item, intel, positionWeight };
    });
    return rankWeeklyPicks(rows);
  }, [proposed, stockByTicker, macro, regime]);

  const displayed = useMemo(() => scored.slice(0, 5), [scored]);

  const shortRows = useMemo(
    () =>
      shorts
        .map((item) => ({ ...item, positionWeight: shortWeight(item, proposed, regime) }))
        .filter((item) => item.positionWeight >= 3),
    [shorts, proposed, regime],
  );

  const proposedRows = useMemo(
    () => [
      ...scored
        .filter((item) => item.intel.stance !== "AVOID")
        .slice(0, 5)
        .map((item) => ({
          ticker: item.ticker,
          setup: item.setup,
          score: item.score,
          stance: item.intel.stance,
          close: item.close,
          entryLow: item.entryLow,
          entryHigh: item.entryHigh,
          invalidation: item.invalidation,
          target: item.target,
          riskReward: item.riskReward,
          positionWeight: item.positionWeight,
          reasons: [item.intel.summary, ...(item.reasons ?? [])],
          caution: item.caution ?? "",
        })),
      ...shortRows.map((item) => ({
        ticker: item.ticker,
        setup: item.setup,
        score: item.score,
        stance: "SHORT",
        close: item.close,
        entryLow: item.entryLow,
        entryHigh: item.entryHigh,
        invalidation: item.invalidation,
        target: item.target,
        riskReward: item.riskReward,
        positionWeight: item.positionWeight,
        reasons: ["Pure short setup; no integrated long score."],
        caution: item.caution ?? "",
      })),
    ],
    [scored, shortRows],
  );

  useEffect(() => {
    if (
      !state?.canLock ||
      busy ||
      state.currentWeek === state.run?.week_of ||
      !setups.length ||
      !quant
    ) {
      return;
    }
    setBusy(true);
    fetch("/api/weekly-shortlist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        candidates: proposedRows,
        marketRegime: `V6 JARVIS ${regime} · 25/25/20/15/15`,
      }),
    })
      .then(load)
      .finally(() => setBusy(false));
  }, [
    state?.canLock,
    state?.currentWeek,
    state?.run?.week_of,
    setups.length,
    regime,
    proposedRows,
    busy,
    quant,
  ]);

  useEffect(() => {
    if (!setups.length) return;
    const day = new Date().toLocaleDateString("en-US", { weekday: "short", timeZone: "Asia/Jakarta" });
    if (!OBS_DAYS.includes(day)) return;
    const days = readObserved();
    if (days.includes(day)) {
      setObserved(days);
      return;
    }
    const next = OBS_DAYS.filter((item) => days.includes(item) || item === day);
    try {
      localStorage.setItem("jarvis_weekly_observed_days", JSON.stringify({ week: wibWeekKey(), days: next }));
    } catch {
      // localStorage can be unavailable in private contexts.
    }
    setObserved(next);
  }, [setups.length]);

  const actions = state?.actions || [];
  const byTicker = new Map(actions.map((action) => [action.ticker, action]));
  const candidates = state?.candidates || [];
  const current = new Set(candidates.map((item) => item.ticker));
  const isFriday =
    new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jakarta", weekday: "short" }).format(new Date()) ===
    "Fri";
  const lockedThisWeek = Boolean(state?.run && state.run.week_of === state.currentWeek);
  const rebalanceLocked = isFriday && lockedThisWeek;
  const closed = rebalanceLocked ? actions.filter((action) => !current.has(action.ticker)) : [];
  const weekStamp =
    lockedThisWeek && state?.run
      ? String(state.run.market_regime || "").replace(/^V[56]\s+/, "").trim()
      : "";
  const intelByTicker = new Map(scored.map((item) => [item.ticker, item]));
  const coverage = quant?.coverage;

  const macroText = macro
    ? macro.exposure <= 0
      ? `STAND ASIDE · MACRO 0%${macro.flags.length ? ` · ${macro.flags.join(", ")}` : ""}`
      : macro.exposure < 1
        ? `MACRO ${Math.round(macro.exposure * 100)}%${macro.flags.length ? ` · ${macro.flags.join(", ")}` : ""}`
        : "MACRO FULL SIZE"
    : "MACRO UNAVAILABLE";

  const renderComponents = (intel: WeeklyPickIntelligence) => (
    <div className="weekly-components">
      {intel.components.map((item) => (
        <div
          key={item.key}
          className={`weekly-component ${item.status === "available" ? "" : "unavailable"}`}
          title={item.detail}
        >
          <span>{item.label.split(" ")[0].slice(0, 4).toUpperCase()} {WEEKLY_WEIGHTS[item.key]}%</span>
          <b>{item.score === null ? "—" : item.score.toFixed(0)}</b>
        </div>
      ))}
    </div>
  );

  const renderBase = (item: Setup) => {
    if (item.ema25 == null && item.ema50 == null && item.baseSupport == null && item.baseResistance == null) {
      return null;
    }
    return (
      <div className="weekly-base">
        <div>
          <span>EMA25</span>
          <b>{item.ema25 == null ? "—" : money(px(item.ema25))}</b>
          <small>{item.distance25 == null ? "" : `${item.distance25 >= 0 ? "+" : ""}${item.distance25.toFixed(1)}% from base`}</small>
        </div>
        <div>
          <span>EMA50</span>
          <b>{item.ema50 == null ? "—" : money(px(item.ema50))}</b>
          <small>Base trend</small>
        </div>
        <div>
          <span>BASE SUPPORT</span>
          <b>{item.baseSupport == null ? "—" : money(px(item.baseSupport))}</b>
          <small>Nearest EMA below price</small>
        </div>
        <div>
          <span>BASE RESISTANCE</span>
          <b>{item.baseResistance == null ? "—" : money(px(item.baseResistance))}</b>
          <small>Nearest EMA above price</small>
        </div>
      </div>
    );
  };

  const renderEvidence = (intel: WeeklyPickIntelligence) => (
    <div className="weekly-evidence">
      <div className="weekly-thesis">
        <span>INVESTMENT THESIS</span>
        <p>{intel.thesis}</p>
      </div>
      <div className="weekly-evidence-grid">
        {intel.components.map((item) => (
          <div key={item.key} className={`weekly-evidence-block ${item.status === "available" ? "" : "unavailable"}`}>
            <div>
              <span>{item.label}</span>
              <b>{item.score === null ? "UNAVAILABLE" : `${item.score.toFixed(1)} / 100 · ${item.weight}% weight`}</b>
            </div>
            <ul>
              {item.evidence.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="weekly-evidence-grid">
        <div className="weekly-evidence-block">
          <div><span>CATALYSTS</span></div>
          <ul>{intel.catalysts.length ? intel.catalysts.map((line, index) => <li key={index}>{line}</li>) : <li>No dated catalyst is available in the live feed.</li>}</ul>
        </div>
        <div className="weekly-evidence-block">
          <div><span>RISKS &amp; INVALIDATION</span></div>
          <ul>{intel.risks.length ? intel.risks.map((line, index) => <li key={index}>{line}</li>) : <li>No additional risk flag beyond the defined stop.</li>}</ul>
        </div>
      </div>
      {intel.dataGaps.length > 0 && (
        <div className="weekly-gaps">
          <span>DATA GAPS</span>
          <ul>{intel.dataGaps.map((line, index) => <li key={index}>{line}</li>)}</ul>
        </div>
      )}
    </div>
  );

  const liveRow = (item: Scored, rank: number) => {
    const action = byTicker.get(item.ticker);
    const open = expanded === item.ticker;
    return (
      <div className="weekly-pick" key={item.ticker}>
        <button
          className="weekly-row weekly-row-button"
          onClick={() => setExpanded(open ? null : item.ticker)}
          aria-expanded={open}
        >
          <div className="weekly-rank">{String(rank).padStart(2, "0")}</div>
          <div>
            <strong>{item.ticker}</strong>
            <small>
              <em className={`weekly-stance ${item.intel.stance.toLowerCase()}`}>{item.intel.stance}</em>{" "}
              · {kind(item)} · {item.setup.toUpperCase().replace("SHORT_", "")} · TECH {item.score.toFixed(0)}
            </small>
            <small>
              {item.intel.jarvisScore === null ? "JARVIS N/A" : `JARVIS ${item.intel.jarvisScore.toFixed(1)}`} ·{" "}
              {item.intel.confidence.toUpperCase()} CONFIDENCE · {Math.round(item.intel.coverage * 100)}% COVERAGE
            </small>
          </div>
          <div className="weekly-score-cell">
            <span>JARVIS</span>
            <b style={{ color: item.intel.jarvisScore === null ? undefined : stanceTone[item.intel.stance] }}>
              {item.intel.jarvisScore === null ? "—" : item.intel.jarvisScore.toFixed(1)}
            </b>
          </div>
          <div>
            <span>WEIGHT</span>
            <b>{item.positionWeight.toFixed(1)}%</b>
          </div>
          <div>
            <span>ENTRY</span>
            <b>{money(px(item.entryLow, "up"))}–{money(px(item.entryHigh, "down"))}</b>
          </div>
          <div>
            <span>STOP</span>
            <b>{money(px(item.invalidation, "up"))}</b>
          </div>
          <div>
            <span>TARGET 1</span>
            <b>{money(px(item.target, "down"))}</b>
          </div>
          <div className="weekly-expand">{open ? "−" : "+"}</div>
        </button>
        {open && (
          <div className="weekly-detail">
            {renderComponents(item.intel)}
            {renderBase(item)}
            {action?.reason && <p className="weekly-detail-reason">{cleanReason(action.reason)}</p>}
            {renderEvidence(item.intel)}
          </div>
        )}
      </div>
    );
  };

  const lockedRow = (item: Candidate, rank: number) => {
    const action = byTicker.get(item.ticker);
    const label = isShort(item) && (!action || action.action === "BUY") ? "SHORT" : change(action);
    const intel = intelByTicker.get(item.ticker)?.intel;
    const open = expanded === item.ticker;
    const stance = intel?.stance ?? String(item.reasons?.[0] ?? "").match(/\((BUY|WATCH|AVOID)\)/)?.[1] ?? "—";
    return (
      <div className="weekly-pick" key={item.id}>
        <button
          className="weekly-row weekly-row-button"
          onClick={() => setExpanded(open ? null : item.ticker)}
          aria-expanded={open}
        >
          <div className="weekly-rank">{String(rank).padStart(2, "0")}</div>
          <div>
            <strong>{item.ticker}</strong>
            <small>
              {isShort(item) ? "SHORT" : kind(item)} · {item.setup.toUpperCase().replace("SHORT_", "")} · TECH{" "}
              {Number(item.score).toFixed(0)}
            </small>
            {intel && <small>JARVIS {intel.jarvisScore === null ? "N/A" : intel.jarvisScore.toFixed(1)}</small>}
          </div>
          <div className="weekly-score-cell">
            <span>CHANGE</span>
            <b className="weekly-action" style={{ color: tone[label], borderColor: tone[label] }}>{label}</b>
          </div>
          <div>
            <span>WEIGHT</span>
            <b>{Number(item.position_weight || 0).toFixed(1)}%</b>
          </div>
          <div>
            <span>ENTRY</span>
            <b>{money(px(item.planned_entry_low, "up"))}–{money(px(item.planned_entry_high, "down"))}</b>
          </div>
          <div>
            <span>STOP</span>
            <b>{money(px(item.invalidation, "up"))}</b>
          </div>
          <div>
            <span>TARGET 1</span>
            <b>{money(px(item.target_one, "down"))}</b>
          </div>
          <div className="weekly-expand">{open ? "−" : "+"}</div>
        </button>
        {open && (
          <div className="weekly-detail">
            {intel ? (
              <>
                {renderComponents(intel)}
                {renderEvidence(intel)}
              </>
            ) : (
              <p className="weekly-detail-reason">{cleanReason(item.reasons?.[0]) || "Stored with the Friday lock."}</p>
            )}
            <span className="weekly-detail-stance">STANCE {stance}</span>
          </div>
        )}
      </div>
    );
  };

  const shortRow = (item: Setup & { positionWeight: number }) => {
    const action = byTicker.get(item.ticker);
    const label = !action || action.action === "BUY" ? "SHORT" : change(action);
    return (
      <div className="weekly-row" key={`short-${item.ticker}`}>
        <div className="weekly-rank">S</div>
        <div>
          <strong>{item.ticker}</strong>
          <small><em className="weekly-stance short">SHORT</em> · HEDGE · {item.setup.toUpperCase().replace("SHORT_", "")} · TECH {item.score.toFixed(0)}</small>
        </div>
        <div className="weekly-score-cell"><span>CHANGE</span><b className="weekly-action" style={{ color: tone[label], borderColor: tone[label] }}>{label}</b></div>
        <div><span>WEIGHT</span><b>{item.positionWeight.toFixed(1)}%</b></div>
        <div><span>ENTRY</span><b>{money(px(item.entryLow, "up"))}–{money(px(item.entryHigh, "down"))}</b></div>
        <div><span>STOP</span><b>{money(px(item.invalidation, "up"))}</b></div>
        <div><span>TARGET 1</span><b>{money(px(item.target, "down"))}</b></div>
        <div className="weekly-expand">·</div>
      </div>
    );
  };

  const lockedView = lockedThisWeek && candidates.length > 0;
  const hasRows = lockedView ? candidates.length > 0 : displayed.length > 0 || shortRows.length > 0;

  return (
    <article className="panel weekly-shortlist">
      <div className="weekly-head">
        <div>
          <span>WEEKLY PICKS · JARVIS INTEGRATED</span>
          <h3>{rebalanceLocked ? "Friday Rebalance Actions" : "This Week’s Picks"}</h3>
          <p>
            Fundamental 25% · Technical 25% · Quantitative 20% · Valuation 15% · Catalysts 15% · Up to 5 longs
            + optional 1 short · Friday official rebalance
          </p>
        </div>
        <div className="weekly-lock">
          {busy ? "LOCKING…" : "FRIDAY DECISION"}
          <small>
            {observed.length} OBSERVATION DAYS · {state?.run?.week_of || "—"}
            {weekStamp ? ` · LOCKED ${weekStamp}` : ""}
          </small>
        </div>
      </div>

      <div className="weekly-context">
        <div>
          <span>MARKET REGIME</span>
          <b>{regime}</b>
          <small>{macroText}</small>
        </div>
        <div>
          <span>JCI SESSION</span>
          <b>{macro?.indexChangePct == null ? "—" : `${macro.indexChangePct >= 0 ? "+" : ""}${macro.indexChangePct.toFixed(2)}%`}</b>
          <small>Local tape reference</small>
        </div>
        <div>
          <span>FUNDAMENTAL MAP</span>
          <b>{quant ? quant.status.toUpperCase() : quantError ? "UNAVAILABLE" : "LOADING"}</b>
          <small>
            {quant
              ? `${quant.universeSize} names · ${coverage ? Math.round((coverage.fundamentalScore / Math.max(1, quant.universeSize)) * 100) : 0}% scored`
              : quantError ?? "Fetching scanner fundamentals"}
          </small>
        </div>
        <div>
          <span>AS OF</span>
          <b>{fmtDate(quant?.asOf)}</b>
          <small>Disclosures {fmtDate(quant?.dataAsOf)}</small>
        </div>
      </div>

      <div className="weekly-observation">
        <strong>OBSERVATION TRAIL</strong>
        {["MON", "TUE", "WED", "THU", "FRI"].map((day, index) => {
          const code = OBS_DAYS[index];
          return (
            <span key={day} className={code && observed.includes(code) ? "seen" : index === 4 && state?.run ? "official" : ""}>
              {day}
              <i />
            </span>
          );
        })}
        <small>Friday is the only official decision. Cash is a valid position.</small>
      </div>

      {!state ? (
        <div className="weekly-empty">WEEKLY RECORD UNAVAILABLE</div>
      ) : !hasRows ? (
        <div className="weekly-empty">
          <strong>NO ACTIONABLE PICK</strong>
          <p>
            Cash is a valid position. No technical setup cleared the screen with an integrated JARVIS stance
            above AVOID. Nothing was forced into the report.
          </p>
        </div>
      ) : (
        <div className="weekly-list">
          {lockedView
            ? candidates.map((item, index) => lockedRow(item, index + 1))
            : displayed.map((item, index) => liveRow(item, index + 1))}
          {!lockedView && shortRows.map(shortRow)}
          {closed.map((action) => {
            const label = change(action);
            const held = action.action === "HOLD" || action.action === "REDUCE";
            return (
              <div className={`weekly-row${held ? "" : " closed"}`} key={action.id}>
                <div className="weekly-rank">—</div>
                <div>
                  <strong>{action.ticker}</strong>
                  <small>{held ? "STILL HELD" : "PRIOR PICK"}</small>
                </div>
                <div>
                  <span>CHANGE</span>
                  <b className="weekly-action" style={{ color: tone[label], borderColor: tone[label] }}>{label}</b>
                </div>
                <div>
                  <span>WEIGHT</span>
                  <b>{action.target_weight.toFixed(1)}%</b>
                </div>
                <div className="weekly-exit-reason">
                  <span>REASON</span>
                  <b>{cleanReason(action.reason)}</b>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <footer>
        <span>
          JARVIS SCORE RENORMALISES OVER AVAILABLE COMPONENTS · MISSING DATA IS UNAVAILABLE, NEVER ZERO
        </span>
        <span>BUY / WATCH / AVOID · CASH IS VALID · NOT INVESTMENT ADVICE</span>
      </footer>
    </article>
  );
}
