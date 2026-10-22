import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient } from '../../../../utils/supabase/server'
import { isAdmin } from '@/lib/auth'

export const dynamic = 'force-dynamic'

type EventRow = {
  user_id: string
  event_name: string
  page_path: string
  occurred_at: string
}

function dayKey(value: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date(value))
}

export async function GET() {
  const sessionClient = await createClient()
  const { data: { user } } = await sessionClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAdmin(user)) return NextResponse.json({ error: 'Admin access required.' }, { status: 403 })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return NextResponse.json({ error: 'Analytics credentials are unavailable.' }, { status: 503 })

  const service = createServiceClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const now = Date.now()
  const since30 = new Date(now - 30 * 86400000).toISOString()
  const since7 = new Date(now - 7 * 86400000).toISOString()
  const since1 = new Date(now - 86400000).toISOString()

  const [{ data: events, error }, usersResult, latestRunResult] = await Promise.all([
    service.from('jarvis_product_events').select('user_id,event_name,page_path,occurred_at').gte('occurred_at', since30).order('occurred_at'),
    service.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    service.from('jarvis_weekly_runs').select('id,week_of,market_regime,status').order('week_of', { ascending: false }).limit(1).maybeSingle(),
  ])
  if (error) return NextResponse.json({ error: 'Unable to load product analytics.' }, { status: 500 })

  const rows = (events || []) as EventRow[]
  const uniqueSince = (since: string) => new Set(rows.filter((row) => row.occurred_at >= since).map((row) => row.user_id)).size
  const activationNames = ['weekly_picks_view', 'research_paper_open', 'stock_detail_open']
  const featureNames = [
    ...activationNames,
    'onboarding_complete',
    'watchlist_add',
    'portfolio_save',
    'note_save',
    'pricing_view',
    'upgrade_click',
  ]
  const featureUsage = featureNames.map((name) => ({ name, count: rows.filter((row) => row.event_name === name).length }))
  const topPageMap = new Map<string, number>()
  rows.filter((row) => row.event_name === 'page_view').forEach((row) => topPageMap.set(row.page_path, (topPageMap.get(row.page_path) || 0) + 1))
  const topPages = [...topPageMap].map(([path, count]) => ({ path, count })).sort((a, b) => b.count - a.count).slice(0, 8)
  const activeFeatureUsers = new Set(rows.filter((row) => activationNames.includes(row.event_name)).map((row) => row.user_id)).size
  const registeredUsers = usersResult.data?.users?.length || 0

  const dailyMap = new Map<string, Set<string>>()
  rows.forEach((row) => {
    const key = dayKey(row.occurred_at)
    const users = dailyMap.get(key) || new Set<string>()
    users.add(row.user_id)
    dailyMap.set(key, users)
  })
  const dailyActive = Array.from({ length: 14 }, (_, offset) => {
    const date = new Date(now - (13 - offset) * 86400000)
    const key = dayKey(date.toISOString())
    return { date: key, users: dailyMap.get(key)?.size || 0 }
  })

  const latestRun = latestRunResult.data
  let weekly = null
  if (latestRun) {
    const [{ count: picks }, { data: actions }] = await Promise.all([
      service.from('jarvis_weekly_candidates').select('id', { count: 'exact', head: true }).eq('run_id', latestRun.id),
      service.from('jarvis_weekly_actions').select('action,invalidated,target_reached').eq('run_id', latestRun.id),
    ])
    const actionRows = actions || []
    weekly = {
      weekOf: latestRun.week_of,
      regime: latestRun.market_regime,
      status: latestRun.status,
      picks: picks || 0,
      // Milestones, not mutually exclusive: a name can touch its first target and
      // still be stopped later. `targetsBanked` is the one that means "a winner
      // that was not also cut", so the counts can never look like they add up to
      // more picks than exist.
      invalidated: actionRows.filter((row) => row.invalidated).length,
      targetsReached: actionRows.filter((row) => row.target_reached).length,
      targetsBanked: actionRows.filter((row) => row.target_reached && !row.invalidated).length,
      actions: actionRows.reduce<Record<string, number>>((acc, row) => {
        acc[row.action] = (acc[row.action] || 0) + 1
        return acc
      }, {}),
    }
  }

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    overview: {
      registeredUsers,
      dau: uniqueSince(since1),
      wau: uniqueSince(since7),
      mau: uniqueSince(since30),
      sessions30d: rows.filter((row) => row.event_name === 'session_start').length,
      pageViews30d: rows.filter((row) => row.event_name === 'page_view').length,
      activationRate: registeredUsers ? Math.round((activeFeatureUsers / registeredUsers) * 100) : 0,
    },
    featureUsage,
    topPages,
    dailyActive,
    weekly,
  })
}
