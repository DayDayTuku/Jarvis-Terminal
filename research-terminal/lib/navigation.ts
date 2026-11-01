/**
 * Navigation model for the four-pillar terminal shell.
 *
 * The product is organised into four primary pillars, with the existing
 * research sections kept as secondary navigation underneath them. Section
 * labels are intentionally unchanged so every existing hash bookmark
 * (`#quant-lab`, `#risk-map`, ...) continues to resolve.
 */

export type Pillar = 'HOME' | 'DISCOVER' | 'INTELLIGENCE' | 'PORTFOLIO';

export type Section =
  | 'OVERVIEW'
  | 'MACRO'
  | 'MARKETS'
  | 'NEWS'
  | 'QUANT LAB'
  | 'QUANTAMENTAL'
  | 'PORTFOLIO'
  | 'RISK MAP'
  | 'RESEARCH PAPERS'
  | 'SEASONALITY'
  | 'MARKET PARTICIPANT';

export type SectionDefinition = {
  label: Section;
  /** Compact label used by the secondary tab strip. */
  short: string;
  icon: string;
  description: string;
  /** Existing beta marker, preserved from the previous navigation. */
  badge?: string;
};

export type PillarDefinition = {
  id: Pillar;
  /** Lowercase slug used for progressive pillar deep links. */
  slug: string;
  icon: string;
  description: string;
  defaultSection: Section;
  sections: readonly SectionDefinition[];
};

const SECTION_COPY: Record<Section, { short: string; description: string; badge?: string }> = {
  OVERVIEW: {
    short: 'Overview',
    description: 'The readings that need attention before the next research session.',
  },
  MACRO: {
    short: 'Macro',
    description: 'Live FRED signals for growth, inflation and the Treasury curve.',
  },
  MARKETS: {
    short: 'Market Explorer',
    description: 'Sector heatmap, market movers and a filterable view of the scanned IDX universe.',
  },
  NEWS: {
    short: 'News',
    description: 'Beta · IDX, macro, and commodity coverage ranked by decision impact.',
    badge: 'BETA',
  },
  'QUANT LAB': {
    short: 'Quant Lab',
    description: 'Beta · Transparent cross-asset and IDX breadth signals.',
    badge: 'BETA',
  },
  QUANTAMENTAL: {
    short: 'Quantamental',
    description:
      'Beta · Peer-relative valuation against six-month momentum, with every missing input shown explicitly.',
    badge: 'BETA',
  },
  PORTFOLIO: {
    short: 'Portfolio',
    description: 'Beta · Personal factor exposure, concentration, and scenario stress testing.',
    badge: 'BETA',
  },
  'RISK MAP': {
    short: 'World Monitor',
    description:
      'Confirmed hazards, wildfires, static chokepoints and conflict references, plus news-derived disruption reports.',
  },
  'RESEARCH PAPERS': {
    short: 'Research Papers',
    description: 'Institutional research library with admin-managed publication.',
  },
  SEASONALITY: {
    short: 'Seasonality',
    description: 'Historical monthly return tendencies across selected IDX names and the benchmark.',
  },
  'MARKET PARTICIPANT': {
    short: 'COT Positioning',
    description: 'Weekly CFTC positioning by trader category for major futures markets.',
  },
};

const SECTION_ICONS: Record<Section, string> = {
  OVERVIEW: '⌂',
  MACRO: '∿',
  MARKETS: '◇',
  NEWS: '◫',
  'QUANT LAB': 'Σ',
  QUANTAMENTAL: '◉',
  PORTFOLIO: '◈',
  'RISK MAP': '⌖',
  'RESEARCH PAPERS': '▤',
  SEASONALITY: '▦',
  'MARKET PARTICIPANT': '≋',
};

function section(label: Section): SectionDefinition {
  return { label, icon: SECTION_ICONS[label], ...SECTION_COPY[label] };
}

/**
 * Phase 1 keeps every existing section exactly where it works today; only the
 * grouping changes. Phase 2 will promote the World Monitor experience inside
 * DISCOVER and Phase 4 will add holdings-aware surfaces to PORTFOLIO.
 */
export const PILLARS: readonly PillarDefinition[] = [
  {
    id: 'HOME',
    slug: 'home',
    icon: '⌂',
    description: 'Daily command center',
    defaultSection: 'OVERVIEW',
    sections: [section('OVERVIEW'), section('MACRO')],
  },
  {
    id: 'DISCOVER',
    slug: 'discover',
    icon: '◇',
    description: 'Markets, news and world monitor',
    defaultSection: 'MARKETS',
    sections: [
      section('MARKETS'),
      section('NEWS'),
      section('SEASONALITY'),
      section('MARKET PARTICIPANT'),
      section('RISK MAP'),
    ],
  },
  {
    id: 'INTELLIGENCE',
    slug: 'intelligence',
    icon: '◉',
    description: 'Research, quant and valuation',
    defaultSection: 'QUANT LAB',
    sections: [section('QUANT LAB'), section('QUANTAMENTAL'), section('RESEARCH PAPERS')],
  },
  {
    id: 'PORTFOLIO',
    slug: 'portfolio',
    icon: '◈',
    description: 'Holdings, risk and model portfolios',
    defaultSection: 'PORTFOLIO',
    sections: [section('PORTFOLIO')],
  },
] as const;

/** Every section in pillar order, used by the command palette and tests. */
export const ALL_SECTIONS: readonly SectionDefinition[] = PILLARS.flatMap((pillar) => pillar.sections);

export function sectionSlug(value: Section): string {
  return value.toLowerCase().replace(/\s+/g, '-');
}

export function pillarForSection(value: Section): Pillar {
  return PILLARS.find((pillar) => pillar.sections.some((item) => item.label === value))?.id ?? 'HOME';
}

export function pillarDefinition(value: Pillar): PillarDefinition {
  return PILLARS.find((pillar) => pillar.id === value) ?? PILLARS[0];
}

export function sectionDefinition(value: Section): SectionDefinition {
  return ALL_SECTIONS.find((item) => item.label === value) ?? ALL_SECTIONS[0];
}

/**
 * Resolve a hash to a section. Existing section hashes win, so every bookmark
 * keeps working. Pillar slugs are additive progressive deep links and resolve
 * to that pillar's default section.
 */
export function sectionFromHashValue(value: string): Section {
  const slug = value.replace(/^#/, '').toLowerCase();
  const sectionMatch = ALL_SECTIONS.find((item) => sectionSlug(item.label) === slug);
  if (sectionMatch) return sectionMatch.label;
  const pillarMatch = PILLARS.find((pillar) => pillar.slug === slug);
  return pillarMatch?.defaultSection ?? 'OVERVIEW';
}

/** Parse a pillar deep link (`#home`, `#discover`, ...), if one is present. */
export function pillarFromHashValue(value: string): Pillar | null {
  const slug = value.replace(/^#/, '').toLowerCase();
  return PILLARS.find((pillar) => pillar.slug === slug)?.id ?? null;
}

export function sectionFromHash(): Section {
  if (typeof window === 'undefined') return 'OVERVIEW';
  return sectionFromHashValue(window.location.hash);
}

/** 1..9, then 0 for the tenth item, scoped to the active pillar. */
export function navShortcut(index: number): string {
  return index === 9 ? '0' : index < 9 ? String(index + 1) : '—';
}

/** Existing beta badge text shown next to a section name. */
export function navBadge(value: Section): string {
  return SECTION_COPY[value].badge ?? '';
}
