'use client';

import CommandPalette from '../CommandPalette';
import { ALL_SECTIONS, pillarForSection, type Section } from '../../lib/navigation';

/**
 * Command palette wired to the pillar-aware navigation model. The underlying
 * palette stays unchanged; this wrapper only supplies sections and maps a
 * selected label back to a typed section.
 */
export default function GlobalCommandPalette({
  open,
  onOpenChange,
  onNavigate,
  onOpenStock,
  onOpenNotes,
  onOpenSettings,
  onOpenPricing,
  onOpenFeedback,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (section: Section) => void;
  onOpenStock: (ticker: string) => void;
  onOpenNotes: () => void;
  onOpenSettings: () => void;
  onOpenPricing: () => void;
  onOpenFeedback: () => void;
}) {
  return (
    <CommandPalette
      open={open}
      onOpenChange={onOpenChange}
      sections={ALL_SECTIONS.map((item) => ({
        label: item.label,
        description: `${pillarForSection(item.label)} · ${item.description}`,
      }))}
      onNavigate={(label) => {
        const match = ALL_SECTIONS.find((item) => item.label === label);
        if (match) onNavigate(match.label);
      }}
      onOpenStock={onOpenStock}
      onOpenNotes={onOpenNotes}
      onOpenSettings={onOpenSettings}
      onOpenPricing={onOpenPricing}
      onOpenFeedback={onOpenFeedback}
    />
  );
}
