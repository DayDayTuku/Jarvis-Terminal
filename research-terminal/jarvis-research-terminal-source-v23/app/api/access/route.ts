import { NextRequest, NextResponse } from 'next/server';

async function accessToken(password: string) {
  const data = new TextEncoder().encode(`jarvis:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function POST(request: NextRequest) {
  const expected = process.env.RESEARCH_TERMINAL_PASSWORD;
  if (!expected) return NextResponse.json({ error: 'Access password is not configured.' }, { status: 503 });

  const body = await request.json() as { password?: string; returnTo?: string };
  if (!body.password || body.password !== expected) {
    return NextResponse.json({ error: 'Password not recognized.' }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true, returnTo: body.returnTo?.startsWith('/') ? body.returnTo : '/' });
  response.cookies.set('jarvis_access', await accessToken(expected), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
