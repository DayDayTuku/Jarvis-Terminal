/** Plan parsing stays deliberately small until a billing provider is chosen. */

export type Plan = "free" | "pro" | "desk";

export const PLAN_LABELS: Record<Plan, string> = {
  free: "Free",
  pro: "Pro",
  desk: "Desk",
};

export function normalizePlan(value: unknown): Plan {
  if (typeof value !== "string") return "free";
  const normalized = value.trim().toLowerCase();
  return normalized === "pro" || normalized === "desk" ? normalized : "free";
}

export function planFromMetadata(metadata: unknown): Plan {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return "free";
  return normalizePlan((metadata as Record<string, unknown>).plan);
}

export function hasPlan(plan: Plan, required: Plan): boolean {
  const rank: Record<Plan, number> = { free: 0, pro: 1, desk: 2 };
  return rank[plan] >= rank[required];
}
