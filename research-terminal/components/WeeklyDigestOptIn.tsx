'use client'

import { useEffect, useState } from 'react'
import { createClient } from '../utils/supabase/client'

type Status = 'loading' | 'subscribed' | 'unsubscribed' | 'saving' | 'error'

/**
 * Explicit opt-in for the weekly digest (and the intraday stop/target alerts
 * that ride the same recipient list). An account alone never enrolls an
 * address; the preference is stored in the user's Supabase metadata so the
 * cron job can read it without a second database table.
 */
export default function WeeklyDigestOptIn() {
  const [status, setStatus] = useState<Status>('loading')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    let active = true
    createClient()
      .auth.getUser()
      .then(({ data, error }) => {
        if (!active) return
        if (error) {
          setStatus('error')
          setMessage('Could not load your email preference.')
          return
        }
        setEmail(data.user?.email ?? '')
        setStatus(data.user?.user_metadata?.weekly_picks_opt_in === true ? 'subscribed' : 'unsubscribed')
      })
      .catch(() => {
        if (!active) return
        setStatus('error')
        setMessage('Could not load your email preference.')
      })
    return () => {
      active = false
    }
  }, [])

  const toggle = async () => {
    if (status === 'loading' || status === 'saving') return
    const next = status !== 'subscribed'
    setStatus('saving')
    setMessage('')
    const { data, error } = await createClient().auth.updateUser({
      data: {
        weekly_picks_opt_in: next,
        weekly_picks_opt_in_at: next ? new Date().toISOString() : null,
      },
    })
    if (error) {
      setStatus('error')
      setMessage('Could not save your preference. Please try again.')
      return
    }
    const saved = data.user?.user_metadata?.weekly_picks_opt_in === true
    setStatus(saved ? 'subscribed' : 'unsubscribed')
    setMessage(
      saved
        ? `Weekly picks and stop/target alerts will be emailed to ${email || 'your account email'}.`
        : 'You will no longer receive weekly picks or market alerts by email.',
    )
  }

  const busy = status === 'loading' || status === 'saving'
  const subscribed = status === 'subscribed'

  return (
    <div className="setting-block">
      <h3>WEEKLY PICKS EMAIL</h3>
      <p>
        Email delivery is opt-in. Turn it on to receive the Friday picks and intraday stop/target
        alerts at your account email. An account by itself does not subscribe you.
      </p>
      <button
        type="button"
        className="primary-button full"
        onClick={toggle}
        disabled={busy}
        aria-pressed={subscribed}
        aria-busy={status === 'saving'}
      >
        {status === 'loading'
          ? 'READING PREFERENCE…'
          : status === 'saving'
            ? 'SAVING…'
            : subscribed
              ? 'TURN OFF WEEKLY EMAIL'
              : 'EMAIL ME WEEKLY PICKS'}
      </button>
      <p role="status" aria-live="polite" style={{ marginTop: 10, color: subscribed ? 'var(--positive)' : undefined }}>
        {message || (subscribed ? 'Subscribed.' : 'Not subscribed.')}
      </p>
    </div>
  )
}
