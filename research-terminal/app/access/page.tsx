'use client';

import { FormEvent, Suspense, useEffect, useState } from 'react';
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
  const [introVisible, setIntroVisible] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setIntroVisible(false), 2100);
    return () => window.clearTimeout(timer);
  }, []);

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
      setError('Please check your email to confirm your account, then log in.');
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
      {introVisible && (
        <div className="access-intro" aria-label="Jarvis Research is loading">
          <div className="access-intro-grid" />
          <div className="access-intro-orbit orbit-one" />
          <div className="access-intro-orbit orbit-two" />
          <div className="access-intro-brand">
            <div className="access-intro-logo-wrap">
              <img src="/jarvis-logo.png" alt="" />
              <span className="access-intro-scan" />
            </div>
            <strong>JARVIS</strong>
            <span>RESEARCH · VALUATION · INTELLIGENCE</span>
            <small><i /> INITIALIZING RESEARCH SYSTEM</small>
          </div>
        </div>
      )}
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
            <h2>{mode === 'login' ? 'Continue your research.' : 'Create your account.'}</h2>
            <p>{mode === 'login' ? 'Enter your details to open Jarvis Research.' : 'Use your email to create a Jarvis account.'}</p>
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
              {loading ? (
                <span className="access-loading"><i aria-hidden="true" /><span>{mode === 'login' ? 'AUTHENTICATING' : 'CREATING ACCOUNT'}</span></span>
              ) : mode === 'login' ? 'OPEN JARVIS →' : 'CREATE ACCOUNT →'}
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
        .access-intro {
          position: fixed;
          inset: 0;
          z-index: 9999;
          display: grid;
          place-items: center;
          overflow: hidden;
          background:
            radial-gradient(circle at 50% 45%, #102d4555, transparent 28%),
            radial-gradient(circle at 50% 45%, #0c201c45, transparent 48%),
            #020407;
          animation: accessIntroCurtain 2.05s cubic-bezier(.76, 0, .24, 1) forwards;
        }
        .access-intro-grid {
          position: absolute;
          inset: -20%;
          opacity: .22;
          background-image:
            linear-gradient(#48a6ff12 1px, transparent 1px),
            linear-gradient(90deg, #48a6ff12 1px, transparent 1px);
          background-size: 42px 42px;
          transform: perspective(700px) rotateX(64deg) translateY(22%);
          mask-image: linear-gradient(to bottom, transparent 12%, black 55%, transparent 88%);
          animation: accessGridDrift 2s ease-out both;
        }
        .access-intro-orbit {
          position: absolute;
          width: min(48vw, 520px);
          aspect-ratio: 1;
          border: 1px solid #48a6ff2d;
          border-radius: 50%;
          animation: accessOrbitPulse 1.55s cubic-bezier(.22, 1, .36, 1) both;
        }
        .access-intro-orbit.orbit-two {
          width: min(62vw, 680px);
          border-color: #43d4a31c;
          animation-delay: 100ms;
        }
        .access-intro-brand {
          position: relative;
          z-index: 1;
          display: grid;
          justify-items: center;
          color: #f3f7fb;
          text-align: center;
          animation: accessBrandIn 900ms cubic-bezier(.22, 1, .36, 1) both;
        }
        .access-intro-logo-wrap {
          position: relative;
          width: 120px;
          height: 120px;
          margin-bottom: 24px;
          overflow: visible;
          filter: drop-shadow(0 0 26px #48a6ff42);
        }
        .access-intro-logo-wrap img {
          width: 100%;
          height: 100%;
          object-fit: contain;
          filter: grayscale(1) brightness(0) invert(1);
        }
        .access-intro-scan {
          position: absolute;
          inset: -20% 0 auto;
          height: 32%;
          background: linear-gradient(to bottom, transparent, #48a6ff55, transparent);
          animation: accessLogoScan 1.25s ease-in-out 250ms both;
        }
        .access-intro-brand strong {
          font: 680 clamp(36px, 5vw, 58px)/1 var(--font-geist-sans);
          letter-spacing: .16em;
          text-indent: .16em;
        }
        .access-intro-brand > span {
          margin-top: 13px;
          color: #8293a7;
          font-size: 8px;
          letter-spacing: .22em;
        }
        .access-intro-brand small {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: 32px;
          color: #48a6ff;
          font-size: 7px;
          letter-spacing: .16em;
        }
        .access-intro-brand small i {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: #43d4a3;
          box-shadow: 0 0 10px #43d4a3;
          animation: accessStatusPulse 700ms ease-in-out infinite alternate;
        }
        .access-card {
          animation: accessCardReveal 720ms cubic-bezier(.22, 1, .36, 1) 1.35s both;
        }
        .access-loading {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 11px;
          letter-spacing: .08em;
        }
        .access-loading > i {
          position: relative;
          width: 18px;
          height: 18px;
          border: 2px solid #74839755;
          border-top-color: #071019;
          border-radius: 50%;
          animation: accessLoadingSpin 720ms linear infinite;
        }
        .access-loading > i::after {
          content: '';
          position: absolute;
          inset: 4px;
          border-radius: 50%;
          background: #48a6ff;
          animation: accessStatusPulse 480ms ease-in-out infinite alternate;
        }
        @keyframes accessIntroCurtain {
          0%, 66% { opacity: 1; transform: translateY(0); }
          100% { opacity: 1; transform: translateY(-101%); }
        }
        @keyframes accessBrandIn {
          from { opacity: 0; transform: translateY(18px) scale(.9); filter: blur(8px); }
          to { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
        }
        @keyframes accessOrbitPulse {
          from { opacity: 0; transform: scale(.55); }
          45% { opacity: 1; }
          to { opacity: 0; transform: scale(1.12); }
        }
        @keyframes accessLogoScan {
          from { transform: translateY(-130%); opacity: 0; }
          25% { opacity: 1; }
          to { transform: translateY(430%); opacity: 0; }
        }
        @keyframes accessGridDrift {
          from { opacity: 0; transform: perspective(700px) rotateX(64deg) translateY(29%); }
          to { opacity: .22; transform: perspective(700px) rotateX(64deg) translateY(18%); }
        }
        @keyframes accessCardReveal {
          from { opacity: 0; transform: translateY(34px) scale(.975); filter: blur(8px); }
          to { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
        }
        @keyframes accessLoadingSpin { to { transform: rotate(360deg); } }
        @keyframes accessStatusPulse { to { opacity: .35; transform: scale(.72); } }
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
          .access-intro { display: none; }
          .access-card,
          .access-loading > i,
          .access-loading > i::after,
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
