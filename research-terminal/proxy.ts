import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
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

  if (path === '/access' || path.startsWith('/api/cron/') || path.startsWith('/api/v1/') || path.startsWith('/_next/') || path === '/favicon.svg' || path === '/jarvis-logo.png' || path === '/og.png') {
    return response;
  }

  if (!user) {
    const destination = request.nextUrl.clone();
    destination.pathname = '/access';
    destination.searchParams.set('returnTo', path);
    return NextResponse.redirect(destination);
  }

  return response;
}

export const config = { matcher: ['/((?!_next/static|_next/image).*)'] };
