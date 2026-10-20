import Link from 'next/link';

export default function NotFound() {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#05070a', color: '#e8edf3', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
      <section style={{ maxWidth: 520, border: '1px solid #1f2d3d', background: '#080c11', padding: 28 }}>
        <span style={{ color: '#48a6ff', fontSize: 10, letterSpacing: '.1em' }}>JARVIS · 404</span>
        <h1 style={{ fontSize: 20, margin: '12px 0 10px' }}>That surface does not exist.</h1>
        <p style={{ color: '#93a0af', fontSize: 13, lineHeight: 1.7 }}>
          The page may have moved, or the ticker/section link is incomplete.
        </p>
        <Link href="/" style={{ display: 'inline-block', marginTop: 20, background: '#48a6ff', color: '#03111f', padding: '10px 16px', fontSize: 11, fontWeight: 700, textDecoration: 'none' }}>RETURN TO TERMINAL</Link>
      </section>
    </main>
  );
}
