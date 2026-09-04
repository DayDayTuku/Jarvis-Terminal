import { NextRequest, NextResponse } from 'next/server';

async function accessToken(password: string) {
  const data = new TextEncoder().encode(`jarvis:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function proxy(request: NextRequest) {
  const password = process.env.RESEARCH_TERMINAL_PASSWORD;
  if (!password) return NextResponse.next();

  const path = request.nextUrl.pathname;
  if (path === '/access' || path === '/api/access' || path.startsWith('/_next/') || path === '/favicon.svg' || path === '/jarvis-logo.png' || path === '/og.png') {
    return NextResponse.next();
  }

  const expected = await accessToken(password);
  if (request.cookies.get('jarvis_access')?.value === expected) return NextResponse.next();

  const destination = request.nextUrl.clone();
  destination.pathname = '/access';
  destination.searchParams.set('returnTo', path);
  return NextResponse.redirect(destination);
}

export const config = { matcher: ['/((?!_next/static|_next/image).*)'] };
