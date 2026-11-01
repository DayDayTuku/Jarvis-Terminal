'use client';

import type { ReactNode } from 'react';
import type { Scheme } from '../../lib/preferences';
import type { Pillar } from '../../lib/navigation';

/**
 * Responsive terminal frame. The shell owns layout only; data fetching and
 * section rendering stay in the page so existing behavior is preserved.
 */
export default function AppShell({
  scheme,
  pillar,
  sidebar,
  topBar,
  statusBar,
  signalStrip,
  pageHeader,
  children,
  footer,
}: {
  scheme: Scheme;
  pillar: Pillar;
  sidebar: ReactNode;
  topBar: ReactNode;
  statusBar?: ReactNode;
  signalStrip?: ReactNode;
  pageHeader: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="terminal-shell" data-scheme={scheme} data-pillar={pillar.toLowerCase()}>
      {sidebar}
      <div className="app-column">
        {topBar}
        {statusBar}
        {signalStrip}
        {pageHeader}
        {children}
        {footer}
      </div>
    </main>
  );
}
