'use client';

import { useEffect, useRef } from 'react';
import {
  navShortcut,
  pillarDefinition,
  sectionDefinition,
  type Pillar,
  type Section,
} from '../../lib/navigation';

/**
 * Shared page heading. The breadcrumb identifies the pillar, and the tab strip
 * is the secondary navigation for that pillar.
 */
export default function PageHeader({
  pillar,
  section,
  onSelectSection,
}: {
  pillar: Pillar;
  section: Section;
  onSelectSection: (section: Section) => void;
}) {
  const pillarMeta = pillarDefinition(pillar);
  const sectionMeta = sectionDefinition(section);
  const title = section === 'OVERVIEW' ? 'Daily Research Overview' : sectionMeta.short;
  const tabsRef = useRef<HTMLElement | null>(null);
  const activeRef = useRef<HTMLButtonElement | null>(null);

  // Keep the active tab visible when a pillar has more tabs than fit on
  // narrow screens. This replaces the old bottom-dock auto-scroll behavior.
  useEffect(() => {
    const tabs = tabsRef.current;
    const active = activeRef.current;
    if (!tabs || !active) return;
    const left = active.offsetLeft - (tabs.clientWidth - active.clientWidth) / 2;
    tabs.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
  }, [section, pillar]);

  return (
    <div className="view-heading page-header">
      <div className="page-heading-main">
        <div>
          <span className="page-breadcrumb">
            {pillarMeta.id} <b aria-hidden="true">/</b> {sectionMeta.short}
          </span>
          <h2>{title}</h2>
        </div>
        <p>{sectionMeta.description}</p>
      </div>
      <nav ref={tabsRef} className="section-tabs" aria-label={`${pillarMeta.id} sections`}>
        {pillarMeta.sections.map((item, index) => {
          const active = item.label === section;
          return (
            <button
              key={item.label}
              ref={active ? activeRef : undefined}
              type="button"
              className={active ? 'active' : ''}
              aria-current={active ? 'page' : undefined}
              title={`${item.label} · press ${navShortcut(index)}`}
              onClick={() => onSelectSection(item.label)}
            >
              <span>{item.short}</span>
              {item.badge && <small>{item.badge}</small>}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
