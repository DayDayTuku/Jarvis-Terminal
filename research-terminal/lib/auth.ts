/** Shared admin check for API routes and client-only admin affordances. */
export type AuthUserLike = {
  app_metadata?: Record<string, unknown> | null;
} | null;

export function isAdmin(user: AuthUserLike) {
  return user?.app_metadata?.role === "admin";
}
