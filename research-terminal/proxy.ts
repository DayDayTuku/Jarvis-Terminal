import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

// Static files the access page and PWA need before a session exists.
const PUBLIC_ASSETS = new Set([
  '/favicon.svg',
  '/jarvis-logo-128.png',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-icon.png',
  '/og-1200.png',
  '/manifest.webmanifest',
  '/sw.js',
]);

/**
 * Strip empty values before they can become the string "undefined" inside a
 * `Bearer ${key}` header. A missing secret must mean no service bypass at all.
 */
export function collectServiceKeys(...values: Array<string | null | undefined>) {
  return values
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
}

/** Only the scanner endpoint accepts the read-only/cron service bypass. */
export function isTrustedServiceRequest(
  path: string,
  authorization: string | null,
  serviceKeys: string[],
) {
  return (
    path === '/api/swing-setups' &&
    serviceKeys.some((key) => authorization === `Bearer ${key}`)
  );
}

/**
 * Routes and assets that never need a Supabase round-trip. API routes listed
 * here authenticate themselves (cron secret or API key).
 */
export function isPublicPath(path: string) {
  return (
    path === '/access' ||
    path.startsWith('/_next/') ||
    path.startsWith('/api/cron/') ||
    path.startsWith('/api/v1/') ||
    PUBLIC_ASSETS.has(path)
  );
}

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const supplied = request.headers.get('authorization');
  const serviceKeys = collectServiceKeys(
    process.env.JARVIS_READONLY_API_KEY,
    process.env.CRON_SECRET,
  );

  // Checking public paths before creating the client keeps the access page and
  // icons off the auth path and avoids requiring Supabase env vars for them.
  if (isPublicPath(path) || isTrustedServiceRequest(path, supplied, serviceKeys)) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    const destination = request.nextUrl.clone();
    destination.pathname = '/access';
    destination.searchParams.set('returnTo', path);
    return NextResponse.redirect(destination);
  }

  return response;
}

export const config = { matcher: ['/((?!_next/static|_next/image).*)'] };
