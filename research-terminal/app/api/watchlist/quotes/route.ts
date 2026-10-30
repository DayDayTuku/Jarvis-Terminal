import { NextResponse } from 'next/server';
import { createClient } from '../../../../utils/supabase/server';
import { checkRateLimit, rateLimitHeaders } from '@/lib/rate-limit';
import { fetchWatchQuotes } from '@/lib/watch-quotes';
import { normalizeTicker, MAX_WATCHLIST_TICKERS } from '@/lib/workspace';

/**
 * Per-account quotes for saved watchlist tickers. The ticker list is read from
 * the database rather than accepted from the client so this endpoint cannot be
 * used as a general-purpose quote proxy.
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const limit = await checkRateLimit({
      scope: 'watchlist-quotes',
      identifier: user.id,
      limit: 60,
      windowSeconds: 60,
    });
    if (!limit.allowed) {
      return NextResponse.json(
        { error: 'Too many quote requests. Try again shortly.' },
        { status: 429, headers: rateLimitHeaders(limit) },
      );
    }

    const { data, error } = await supabase
      .from('jarvis_watchlist')
      .select('ticker')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Watchlist quote tickers failed:', error.message);
      return NextResponse.json({ error: 'Watchlist storage is not configured yet.' }, { status: 503 });
    }

    const tickers = (data ?? []).flatMap((row) => {
      const ticker = normalizeTicker(row.ticker);
      return ticker ? [ticker] : [];
    }).slice(0, MAX_WATCHLIST_TICKERS);

    const result = tickers.length
      ? await fetchWatchQuotes(tickers)
      : { quotes: [], failed: [] };

    return NextResponse.json(result, { headers: { 'cache-control': 'private, no-store' } });
  } catch {
    return NextResponse.json({ error: 'Unable to load watchlist quotes.' }, { status: 500 });
  }
}
