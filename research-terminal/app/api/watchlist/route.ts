import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '../../../utils/supabase/server';
import { checkRateLimit, rateLimitHeaders } from '@/lib/rate-limit';
import { MAX_WATCHLIST_TICKERS, normalizeTicker } from '@/lib/workspace';

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data, error } = await supabase
      .from('jarvis_watchlist')
      .select('ticker,created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Watchlist load failed:', error.message);
      return NextResponse.json({ error: 'Watchlist storage is not configured yet.' }, { status: 503 });
    }
    return NextResponse.json({ tickers: (data ?? []).map((row) => row.ticker) });
  } catch {
    return NextResponse.json({ error: 'Unable to load watchlist.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const limit = await checkRateLimit({
      scope: 'watchlist-write',
      identifier: user.id,
      limit: 60,
      windowSeconds: 60,
    });
    if (!limit.allowed) {
      return NextResponse.json(
        { error: 'Too many watchlist changes. Try again shortly.' },
        { status: 429, headers: rateLimitHeaders(limit) },
      );
    }

    const body: unknown = await request.json().catch(() => null);
    const payload = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    const ticker = normalizeTicker(payload.ticker);
    if (!ticker) {
      return NextResponse.json({ error: 'Enter a valid IDX ticker.' }, { status: 400 });
    }

    const { count, error: countError } = await supabase
      .from('jarvis_watchlist')
      .select('ticker', { count: 'exact', head: true })
      .eq('user_id', user.id);
    if (countError) {
      return NextResponse.json({ error: 'Watchlist storage is not configured yet.' }, { status: 503 });
    }
    if ((count ?? 0) >= MAX_WATCHLIST_TICKERS) {
      return NextResponse.json(
        { error: `A watchlist can hold at most ${MAX_WATCHLIST_TICKERS} tickers.` },
        { status: 409 },
      );
    }

    const { error } = await supabase
      .from('jarvis_watchlist')
      .insert({ user_id: user.id, ticker });

    // 23505 means the ticker is already saved; that is an idempotent success.
    if (error && error.code !== '23505') {
      console.error('Watchlist insert failed:', error.message);
      return NextResponse.json({ error: 'Unable to add ticker.' }, { status: 500 });
    }
    return NextResponse.json({ ok: true, ticker }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Unable to add ticker.' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const ticker = normalizeTicker(request.nextUrl.searchParams.get('ticker'));
    if (!ticker) {
      return NextResponse.json({ error: 'Enter a valid IDX ticker.' }, { status: 400 });
    }

    const { error } = await supabase
      .from('jarvis_watchlist')
      .delete()
      .eq('user_id', user.id)
      .eq('ticker', ticker);

    if (error) {
      console.error('Watchlist delete failed:', error.message);
      return NextResponse.json({ error: 'Unable to remove ticker.' }, { status: 500 });
    }
    return NextResponse.json({ ok: true, ticker });
  } catch {
    return NextResponse.json({ error: 'Unable to remove ticker.' }, { status: 500 });
  }
}
