'use client';

import { useEffect } from 'react';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('Route error', error);
  }, [error]);

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#05070a', color: '#e8edf3', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
      <section role="alert" style={{ maxWidth: 520, border: '1px solid #1f2d3d', background: '#080c11', padding: 28 }}>
        <span style={{ color: '#ff6678', fontSize: 10, letterSpacing: '.1em' }}>JARVIS · ROUTE ERROR</span>
        <h1 style={{ fontSize: 20, margin: '12px 0 10px' }}>The terminal hit an unexpected error.</h1>
        <p style={{ color: '#93a0af', fontSize: 13, lineHeight: 1.7 }}>
          Your session is untouched. Retry the page, or return to the access screen if the problem continues.
        </p>
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button type="button" onClick={reset} style={{ background: '#48a6ff', border: 0, color: '#03111f', padding: '10px 16px', font: 'inherit', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>RETRY</button>
          <a href="/access" style={{ border: '1px solid #2a3a4b', color: '#93a0af', padding: '10px 16px', fontSize: 11, textDecoration: 'none' }}>ACCESS</a>
        </div>
        {error.digest ? <small style={{ display: 'block', marginTop: 18, color: '#5c6875', fontSize: 10 }}>REF {error.digest}</small> : null}
      </section>
    </main>
  );
}
