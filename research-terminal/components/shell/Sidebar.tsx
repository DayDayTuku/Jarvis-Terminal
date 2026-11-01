'use client';

import Image from 'next/image';
import Navigation from './Navigation';
import type { Pillar } from '../../lib/navigation';

/** Sidebar rail: brand, four primary pillars, and the existing side tools. */
export default function Sidebar({
  active,
  onSelectPillar,
  onOpenNotes,
  onOpenSettings,
  onOpenFeedback,
}: {
  active: Pillar;
  onSelectPillar: (pillar: Pillar) => void;
  onOpenNotes: () => void;
  onOpenSettings: () => void;
  onOpenFeedback: () => void;
}) {
  return (
    <aside className="side-nav">
      <div className="side-brand" aria-label="Jarvis">
        <Image src="/jarvis-logo-128.png" alt="" width={128} height={128} priority />
      </div>
      <Navigation active={active} onSelect={onSelectPillar} />
      <div className="side-tools">
        <button type="button" aria-label="Notes" data-label="NOTES" title="Notes" onClick={onOpenNotes}>
          <span aria-hidden="true">✎</span>
          <span className="nav-label">NOTES</span>
        </button>
        <button type="button" aria-label="Settings" data-label="SETTINGS" title="Settings" onClick={onOpenSettings}>
          <span aria-hidden="true">⚙</span>
          <span className="nav-label">SETTINGS</span>
        </button>
      </div>
      <button
        className="sidebar-feedback"
        type="button"
        aria-label="Send feedback"
        data-label="FEEDBACK"
        title="Send feedback"
        onClick={onOpenFeedback}
      >
        <span aria-hidden="true">?</span>
        <span className="nav-label">FEEDBACK</span>
      </button>
    </aside>
  );
}
