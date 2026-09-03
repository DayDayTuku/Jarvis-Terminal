'use client';

import { FormEvent, useState } from 'react';
import { useSearchParams } from 'next/navigation';

export default function AccessPage() {
  const search = useSearchParams();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setLoading(true); setError('');
    const response = await fetch('/api/access', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password, returnTo: search.get('returnTo') || '/' }) });
    const result = await response.json() as { error?: string; returnTo?: string };
    if (!response.ok) { setError(result.error || 'Unable to unlock the terminal.'); setLoading(false); return; }
    window.location.assign(result.returnTo || '/');
  };

  return <main className="access-page"><section className="access-card"><img className="access-logo" src="/jarvis-logo.png" alt="Jarvis" /><h1>JARVIS</h1><p>Enter the shared password to open the personal macro terminal.</p><form onSubmit={submit}><label htmlFor="password">ACCESS PASSWORD</label><input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" autoFocus required /><button type="submit" disabled={loading}>{loading ? 'CHECKING…' : 'OPEN TERMINAL'}</button>{error && <strong role="alert">{error}</strong>}</form><small>Password resets are handled through the deployment environment.</small></section></main>;
}
