'use client';

import { FormEvent, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '../../utils/supabase/client';

export default function AccessPage() {
  const search = useSearchParams();
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'login' | 'signup'>('login');

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setLoading(true); setError('');

    const { error } = mode === 'login'
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password });

    if (error) { setError(error.message); setLoading(false); return; }

    if (mode === 'signup') {
      setError('Cek email lo untuk konfirmasi akun, lalu login.');
      setLoading(false);
      setMode('login');
      return;
    }

    router.push(search.get('returnTo') || '/');
    router.refresh();
  };

  return <main className="access-page"><section className="access-card"><img className="access-logo" src="/jarvis-logo.png" alt="Jarvis" /><h1>JARVIS</h1><p>{mode === 'login' ? 'Login dengan email untuk membuka terminal.' : 'Buat akun baru untuk mengakses terminal.'}</p><form onSubmit={submit}><label htmlFor="email">EMAIL</label><input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus required /><label htmlFor="password">PASSWORD</label><input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /><button type="submit" disabled={loading}>{loading ? 'CHECKING…' : mode === 'login' ? 'LOGIN' : 'SIGN UP'}</button>{error && <strong role="alert">{error}</strong>}</form><small onClick={() => setMode(mode === 'login' ? 'signup' : 'login')} style={{cursor:'pointer', textDecoration:'underline'}}>{mode === 'login' ? 'Belum punya akun? Sign up' : 'Sudah punya akun? Login'}</small></section></main>;
}
