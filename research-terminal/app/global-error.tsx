'use client';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#05070a', color: '#e8edf3', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
        <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
          <section role="alert" style={{ maxWidth: 520, border: '1px solid #1f2d3d', background: '#080c11', padding: 28 }}>
            <span style={{ color: '#ff6678', fontSize: 10, letterSpacing: '.1em' }}>JARVIS · APPLICATION ERROR</span>
            <h1 style={{ fontSize: 20, margin: '12px 0 10px' }}>Jarvis could not start this page.</h1>
            <p style={{ color: '#93a0af', fontSize: 13, lineHeight: 1.7 }}>
              Reload the application. If the error persists, check the deployment logs and environment variables.
            </p>
            <button type="button" onClick={reset} style={{ marginTop: 20, background: '#48a6ff', border: 0, color: '#03111f', padding: '10px 16px', font: 'inherit', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>RELOAD</button>
            {error.digest ? <small style={{ display: 'block', marginTop: 18, color: '#5c6875', fontSize: 10 }}>REF {error.digest}</small> : null}
          </section>
        </main>
      </body>
    </html>
  );
}
