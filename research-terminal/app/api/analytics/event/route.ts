import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '../../../../utils/supabase/server'

const ALLOWED_EVENTS = new Set([
  'session_start',
  'page_view',
  'weekly_picks_view',
  'research_paper_open',
  'stock_detail_open',
])

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const eventName = typeof body?.eventName === 'string' ? body.eventName : ''
  const pagePath = typeof body?.pagePath === 'string' ? body.pagePath.slice(0, 180) : ''
  const metadata = body?.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata) ? body.metadata : {}

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
