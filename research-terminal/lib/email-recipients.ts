/**
 * Who receives the weekly digest and market alerts.
 *
 * Two independent groups:
 *  - the owner list in JARVIS_EMAIL_TO, which always receives the digest;
 *  - signed-in users who explicitly opted in from Settings.
 *
 * Signing up for an account is not consent to email: only users with
 * `weekly_picks_opt_in === true` in their Supabase user metadata are included,
 * and only once their email address is confirmed. That stops someone from
 * registering with another person's address to pull them into the send list.
 */

export type DigestUser = {
  email?: string | null;
  email_confirmed_at?: string | null;
  confirmed_at?: string | null;
  user_metadata?: Record<string, unknown> | null;
};

function normalize(email: string) {
  return email.trim().toLowerCase();
}

export function hasConfirmedEmail(user: DigestUser) {
  return Boolean(user.email_confirmed_at ?? user.confirmed_at);
}

export function isWeeklyDigestOptedIn(user: DigestUser) {
  return user.user_metadata?.weekly_picks_opt_in === true;
}

export function selectDigestRecipients(users: DigestUser[], configured: string[]) {
  const owners = configured
    .map(normalize)
    .filter((email) => email.length > 0);

  const optedIn = users
    .filter(
      (user) =>
        Boolean(user.email && user.email.trim().length > 0) &&
        hasConfirmedEmail(user) &&
        isWeeklyDigestOptedIn(user),
    )
    .map((user) => normalize(String(user.email)))
    .filter((email) => email.length > 0);

  return [...new Set([...owners, ...optedIn])];
}
