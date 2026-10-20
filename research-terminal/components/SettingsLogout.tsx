'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../utils/supabase/client'
import AdminAnalyticsLink from './AdminAnalyticsLink'

export default function SettingsLogout() {
  const router = useRouter()
  const [loggingOut, setLoggingOut] = useState(false)
  const [error, setError] = useState('')

  const handleLogout = async () => {
    setLoggingOut(true)
    setError('')
    const { error: signOutError } = await createClient().auth.signOut()
    if (signOutError) {
      setError('LOG OUT FAILED · PLEASE TRY AGAIN')
      setLoggingOut(false)
      return
    }
    router.replace('/access')
    router.refresh()
  }

  return <>
    <AdminAnalyticsLink />
    <div className="setting-block">
      <h3>ACCOUNT</h3>
      <p>End this Jarvis session on this device.</p>
      {error && <p role="alert">{error}</p>}
      <button type="button" className="primary-button full" onClick={handleLogout} disabled={loggingOut}>
        {loggingOut ? 'SIGNING OUT…' : 'LOG OUT'}
      </button>
    </div>
  </>
}
