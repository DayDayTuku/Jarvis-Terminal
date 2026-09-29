'use client'

import { usePathname } from 'next/navigation'
import { useEffect } from 'react'

type EventName = 'session_start' | 'page_view' | 'weekly_picks_view' | 'research_paper_open' | 'stock_detail_open'

function record(eventName: EventName, pagePath: string, metadata: Record<string, string> = {}) {
  void fetch('/api/analytics/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    keepalive: true,
    body: JSON.stringify({ eventName, pagePath, metadata }),
  }).catch(() => undefined)
}

export default function UsageTracker() {
  const pathname = usePathname()

  useEffect(() => {
    if (!pathname || pathname === '/access') return
    if (!sessionStorage.getItem('jarvis_session_started')) {
      sessionStorage.setItem('jarvis_session_started', '1')
      record('session_start', pathname)
    }
    record('page_view', pathname)
  }, [pathname])

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const target = (event.target as HTMLElement | null)?.closest('a,button') as HTMLElement | null
      if (!target) return
      const label = (target.innerText || target.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 100)
      const normalized = label.toUpperCase()
      let eventName: EventName | null = null
      if (normalized.includes('WEEKLY PICKS')) eventName = 'weekly_picks_view'
      else if (normalized.includes('OPEN PAPER')) eventName = 'research_paper_open'
      else if (normalized.includes('OPEN STOCK DETAIL')) eventName = 'stock_detail_open'
      if (eventName) record(eventName, window.location.pathname, { label })
    }
    document.addEventListener('click', handleClick, true)
    return () => document.removeEventListener('click', handleClick, true)
  }, [])

  return null
}
