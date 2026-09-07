'use client';

import { FormEvent, Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '../../utils/supabase/client';

function AccessForm() {
  const search = useSearchParams();
  const router = useRouter();
  const supabase = createClient();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [mode, setMode] = useState<'login' | 'signup'>('login');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');

    const { error } =
      mode === 'login'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    if (mode === 'signup') {
      setError('Cek email lo untuk konfirmasi akun, lalu login.');
      setLoading(false);
      setMode('login');
      return;
    }

    router.push(search.get('returnTo') || '/');
    router.refresh();
  };

  return (
    <main className="access-page">
      <section className="access-card">
        <div className="access-welcome">
          <img className="access-logo" src="/jarvis-logo.png" alt="Jarvis" />
          <span className="access-eyebrow">RESEARCH TERMINAL · PRIVATE WORKSPACE</span>
          <h1>See the market as a system.</h1>
          <p>
            Macro regimes, IDX signals, commodities, news intelligence, and your research notes—one focused workspace.
          </p>
          <div className="access-points">
            <span><i /> Live data with honest fallback states</span>
            <span><i /> Transparent models, never black-box calls</span>
            <span><i /> Built for decisions, not endless scrolling</span>
          </div>
        </div>

        <div className="access-form-pane">
          <div className="access-mode" role="tablist" aria-label="Access mode">
            <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError(''); }}>LOG IN</button>
            <button type="button" role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'active' : ''} onClick={() => { setMode('signup'); setError(''); }}>CREATE ACCOUNT</button>
          </div>

          <div className="access-form-heading">
            <span>{mode === 'login' ? 'WELCOME BACK' : 'GET STARTED'}</span>
            <h2>{mode === 'login' ? 'Continue your research.' : 'Build your market view.'}</h2>
            <p>{mode === 'login' ? 'Enter your details to open the terminal.' : 'Create an account with your email. No payment details required.'}</p>
          </div>

          <form onSubmit={submit}>
            <label htmlFor="email">EMAIL ADDRESS</label>
            <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" autoFocus required />

            <label htmlFor="password">PASSWORD</label>
            <div className="password-field">
              <input id="password" type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder={mode === 'login' ? 'Your password' : 'Choose a secure password'} minLength={6} required />
              <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? 'HIDE' : 'SHOW'}</button>
            </div>

            <button className="access-submit" type="submit" disabled={loading}>
              {loading ? 'OPENING TERMINAL…' : mode === 'login' ? 'OPEN JARVIS →' : 'CREATE ACCOUNT →'}
            </button>
            {error && <strong role="alert">{error}</strong>}
          </form>

          <small>
            {mode === 'login' ? 'New here? ' : 'Already have an account? '}
            <button type="button" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); }}>
              {mode === 'login' ? 'Create an account' : 'Log in'}
            </button>
          </small>
        </div>
      </section>
    </main>
  );
}

export default function AccessPage() {
  return (
    <Suspense fallback={null}>
      <AccessForm />
    </Suspense>
  );
}
