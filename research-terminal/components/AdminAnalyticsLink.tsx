'use client'

import { useEffect, useState } from 'react'
import { createClient } from '../utils/supabase/client'
import { isAdmin } from '../lib/auth'

export default function AdminAnalyticsLink() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => {
      setVisible(isAdmin(data.user))
    })
  }, [])

  if (!visible) return null

  return <div className="setting-block">
    <h3>ADMIN ANALYTICS</h3>
    <p>Review adoption, feature usage, and Weekly Picks health.</p>
    <a className="primary-button full" href="/admin/analytics" style={{display:'block',textAlign:'center',textDecoration:'none'}}>OPEN ANALYTICS ↗</a>
  </div>
}
