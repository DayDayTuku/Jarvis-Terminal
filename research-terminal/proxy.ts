import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

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

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const supplied = request.headers.get('authorization');
  // Never build a "Bearer undefined" literal from a missing env var. If no
  // service key is configured, there is no service bypass at all.
  const serviceKeys = [process.env.JARVIS_READONLY_API_KEY, process.env.CRON_SECRET]
    .map((key) => key?.trim())
    .filter((key): key is string => Boolean(key));
  const trustedServiceRequest =
    path === '/api/swing-setups' &&
    serviceKeys.some((key) => supplied === `Bearer ${key}`);

  // Public routes and assets never need a Supabase round-trip. Checking this
  // before creating the client keeps the access page and icons off the auth path.
  if (
    path === '/access' ||
    path.startsWith('/_next/') ||
    path.startsWith('/api/cron/') ||
    path.startsWith('/api/v1/') ||
    trustedServiceRequest ||
    PUBLIC_ASSETS.has(path)
  ) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet: { name: string; value: string; options: any }[]) {
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
