'use client';

import { PILLARS, type Pillar } from '../../lib/navigation';

/** Primary four-pillar navigation. Secondary sections live in PageHeader. */
export default function Navigation({
  active,
  onSelect,
}: {
  active: Pillar;
  onSelect: (pillar: Pillar) => void;
}) {
  return (
    <nav className="pillar-nav" aria-label="Primary navigation">
      {PILLARS.map((pillar) => (
        <button
          key={pillar.id}
          type="button"
          className={`pillar-button${active === pillar.id ? ' active' : ''}`}
          data-label={pillar.id}
          data-desc={pillar.description}
          title={`${pillar.id} · ${pillar.description}`}
          aria-label={`${pillar.id} — ${pillar.description}`}
          aria-current={active === pillar.id ? 'page' : undefined}
          onClick={() => onSelect(pillar.id)}
        >
          <span className="pillar-icon" aria-hidden="true">{pillar.icon}</span>
          <span className="pillar-label" aria-hidden="true">{pillar.id}</span>
        </button>
      ))}
    </nav>
  );
}
