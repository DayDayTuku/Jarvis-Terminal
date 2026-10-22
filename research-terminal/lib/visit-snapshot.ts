/**
 * Compact "since your last visit" snapshot. The full dashboard payload is far
 * too large to persist, so we keep only the handful of readings that make the
 * first screen feel like a continuing research session.
 */

export type VisitSnapshot = {
  takenAt: string;
  regime: string;
  breadthPositive: number;
  breadthTotal: number;
  liveFeeds: number;
};

export type VisitDelta = {
  label: string;
  value: string;
  tone: "positive" | "negative" | "neutral";
};

function finiteCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : 0;
}

export function parseVisitSnapshot(raw: string | null | undefined): VisitSnapshot | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return null;
    const takenAt = typeof parsed.takenAt === "string" ? parsed.takenAt : "";
    if (!takenAt || Number.isNaN(Date.parse(takenAt))) return null;
    return {
      takenAt,
      regime: typeof parsed.regime === "string" ? parsed.regime.slice(0, 40) : "UNKNOWN",
      breadthPositive: finiteCount(parsed.breadthPositive),
      breadthTotal: finiteCount(parsed.breadthTotal),
      liveFeeds: finiteCount(parsed.liveFeeds),
    };
  } catch {
    return null;
  }
}

export function buildVisitSnapshot(input: Omit<VisitSnapshot, "takenAt"> & { takenAt?: string }): VisitSnapshot {
  return {
    takenAt: input.takenAt ?? new Date().toISOString(),
    regime: input.regime || "UNKNOWN",
    breadthPositive: finiteCount(input.breadthPositive),
    breadthTotal: finiteCount(input.breadthTotal),
    liveFeeds: finiteCount(input.liveFeeds),
  };
}

export function describeVisitDelta(previous: VisitSnapshot | null, current: VisitSnapshot): VisitDelta[] {
  if (!previous) {
    return [
      { label: "FIRST SESSION", value: "Baseline saved", tone: "neutral" },
      { label: "FEEDS", value: `${current.liveFeeds}/5 live`, tone: current.liveFeeds >= 3 ? "positive" : "negative" },
    ];
  }

  const regimeChanged = previous.regime !== current.regime;
  const breadthDelta = current.breadthTotal > 0
    ? current.breadthPositive - previous.breadthPositive
    : 0;
  const feedDelta = current.liveFeeds - previous.liveFeeds;

  return [
    {
      label: "REGIME",
      value: regimeChanged ? `${previous.regime} → ${current.regime}` : `${current.regime} unchanged`,
      tone: regimeChanged ? "neutral" : "positive",
    },
    {
      label: "BREADTH",
      value: current.breadthTotal > 0
        ? `${breadthDelta >= 0 ? "+" : ""}${breadthDelta} sectors vs last visit`
        : "No valid breadth read",
      tone: breadthDelta > 0 ? "positive" : breadthDelta < 0 ? "negative" : "neutral",
    },
    {
      label: "FEEDS",
      value: `${current.liveFeeds}/5 live (${feedDelta >= 0 ? "+" : ""}${feedDelta})`,
      tone: feedDelta > 0 ? "positive" : feedDelta < 0 ? "negative" : "neutral",
    },
  ];
}

export function visitAgeLabel(takenAt: string, now = Date.now()): string {
  const time = Date.parse(takenAt);
  if (!Number.isFinite(time)) return "UNKNOWN";
  const minutes = Math.max(0, Math.floor((now - time) / 60000));
  if (minutes < 1) return "JUST NOW";
  if (minutes < 60) return `${minutes}M AGO`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}H AGO`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "YESTERDAY" : `${days}D AGO`;
}
