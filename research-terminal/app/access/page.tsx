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
    const { error } = mode === 'login'
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

  const switchMode = (nextMode: 'login' | 'signup') => {
    setMode(nextMode);
    setError('');
  };

  return (
    <main className="access-page">
      <section className="access-card">
        <div className="access-welcome">
          <img className="access-logo" src="/jarvis-logo.png" alt="Jarvis Research" />
          <span className="access-eyebrow">IDX · MACRO · COMMODITIES</span>
          <h1>JARVIS</h1>
          <p>JUST ANOTHER RESEARCH, VALUATION AND INTELLIGENCE SYSTEM</p>
          <div className="access-points">
            <span><i /> Skip manual data work and start from decision-ready research</span>
            <span><i /> Research IDX, macro, and commodities in one focused workspace</span>
            <span><i /> See the evidence and risk behind every signal</span>
          </div>
        </div>

        <div className="access-form-pane">
          <div className={`access-mode ${mode}`} role="tablist" aria-label="Access mode">
            <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'active' : ''} onClick={() => switchMode('login')}>LOG IN</button>
            <button type="button" role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'active' : ''} onClick={() => switchMode('signup')}>CREATE ACCOUNT</button>
          </div>

          <div key={mode} className="access-form-heading">
            <span>{mode === 'login' ? 'WELCOME BACK' : 'GET STARTED'}</span>
            <h2>{mode === 'login' ? 'Continue your research.' : 'Create your research workspace.'}</h2>
            <p>{mode === 'login' ? 'Enter your details to open Jarvis Research.' : 'Create an account with your email. No payment details required.'}</p>
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
              {loading ? 'OPENING JARVIS…' : mode === 'login' ? 'OPEN JARVIS →' : 'CREATE ACCOUNT →'}
            </button>
            {error && <strong role="alert">{error}</strong>}
          </form>

          <small>
            {mode === 'login' ? 'New here? ' : 'Already have an account? '}
            <button type="button" onClick={() => switchMode(mode === 'login' ? 'signup' : 'login')}>
              {mode === 'login' ? 'Create an account' : 'Log in'}
            </button>
          </small>
        </div>
      </section>

      <style jsx>{`
        .access-mode {
          position: relative;
          isolation: isolate;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          width: min(252px, 100%);
          min-height: 40px;
        }
        .access-mode::before {
          content: '';
          position: absolute;
          inset: 4px auto 4px 4px;
          z-index: 0;
          width: calc(50% - 6px);
          border-radius: 999px;
          background: #243448;
          box-shadow: 0 3px 10px #00000038;
          transform: translateX(0);
          transition: transform 220ms cubic-bezier(.22, 1, .36, 1);
        }
        .access-mode.signup::before { transform: translateX(calc(100% + 4px)); }
        .access-mode button,
        .access-mode button.active {
          position: relative;
          z-index: 1;
          width: 100%;
          min-width: 0;
          background: transparent;
          transition: color 180ms ease;
        }
        .access-form-heading {
          min-height: 112px;
          animation: accessCopyIn 220ms cubic-bezier(.22, 1, .36, 1);
        }
        @keyframes accessCopyIn {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .access-mode::before,
          .access-mode button { transition: none; }
          .access-form-heading { animation: none; }
        }
      `}</style>
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
