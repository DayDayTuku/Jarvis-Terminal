import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '../../../../utils/supabase/server'
import { checkRateLimit, rateLimitHeaders } from '@/lib/rate-limit'

const ALLOWED_EVENTS = new Set([
  'session_start',
  'page_view',
  'weekly_picks_view',
  'research_paper_open',
  'stock_detail_open',
  'onboarding_start',
  'onboarding_complete',
  'watchlist_add',
  'watchlist_remove',
  'portfolio_save',
  'note_save',
  'preferences_save',
  'pricing_view',
  'upgrade_click',
  'command_palette_open',
  'news_save',
  'paper_search',
  'seasonality_export',
])

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const limit = await checkRateLimit({
    scope: 'analytics-event',
    identifier: user.id,
    limit: 120,
    windowSeconds: 60,
  })
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many analytics events.' },
      { status: 429, headers: rateLimitHeaders(limit) },
    )
  }

  const body: unknown = await request.json().catch(() => null)
  const payload = body && typeof body === 'object' ? body as Record<string, unknown> : {}
  const eventName = typeof payload.eventName === 'string' ? payload.eventName : ''
  const pagePath = typeof payload.pagePath === 'string' ? payload.pagePath.slice(0, 180) : ''
  const metadata = payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
    ? payload.metadata as Record<string, unknown>
    : {}

  if (!ALLOWED_EVENTS.has(eventName) || !pagePath.startsWith('/')) {
    return NextResponse.json({ error: 'Invalid analytics event.' }, { status: 400 })
  }
  if (JSON.stringify(metadata).length > 2000) {
    return NextResponse.json({ error: 'Analytics metadata is too large.' }, { status: 413 })
  }

  const { error } = await supabase.from('jarvis_product_events').insert({
    user_id: user.id,
    event_name: eventName,
    page_path: pagePath,
    metadata,
  })
  if (error) return NextResponse.json({ error: 'Unable to record event.' }, { status: 500 })
  return new NextResponse(null, { status: 204 })
}
