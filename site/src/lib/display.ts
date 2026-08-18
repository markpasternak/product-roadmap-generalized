// Domain → visual mappings (tones, lane dot colors, initials). Kept out of components.
// Every color is a design-system CSS variable so it theme-shifts with the token layer;
// components apply them via inline style (var() resolves at paint time).
import { PRODUCTS, type Product, type Horizon, type Level } from './schema';

export type Tone = 'gray' | 'blue' | 'violet' | 'green' | 'orange' | 'red' | 'yellow';

/** Strong tone color — dots, marks, emphasized text. */
export const toneColor: Record<Tone, string> = {
  gray: 'var(--color-icons-subtle-default)',
  blue: 'var(--color-data-blue-surface-primary-default)',
  violet: 'var(--color-data-violet-surface-primary-default)',
  green: 'var(--color-data-green-surface-primary-default)',
  orange: 'var(--color-data-orange-surface-primary-default)',
  red: 'var(--color-data-red-surface-primary-default)',
  yellow: 'var(--color-data-yellow-surface-primary-default)',
};

/** Soft tone tint — chip and wash backgrounds (alpha-based, works on both themes). */
export const toneSurface: Record<Tone, string> = {
  gray: 'var(--color-surface-subtle-default)',
  blue: 'var(--color-surface-transparent-blue-10)',
  violet: 'var(--color-surface-transparent-violet-10)',
  green: 'var(--color-surface-transparent-green-10)',
  orange: 'var(--color-surface-transparent-orange-10)',
  red: 'var(--color-surface-transparent-red-10)',
  yellow: 'var(--color-surface-transparent-yellow-10)',
};

/** Slightly stronger tint for emphasized panels, badges, and active controls. */
export const toneSurfaceStrong: Record<Tone, string> = {
  gray: 'var(--color-surface-subtle-default)',
  blue: 'var(--color-surface-transparent-blue-25)',
  violet: 'var(--color-surface-transparent-violet-25)',
  green: 'var(--color-surface-transparent-green-25)',
  orange: 'var(--color-surface-transparent-orange-25)',
  red: 'var(--color-surface-transparent-red-25)',
  yellow: 'var(--color-surface-transparent-yellow-25)',
};

/** Tone as readable text — darker step than the dot color, for contrast on tints. */
export const toneText: Record<Tone, string> = {
  gray: 'var(--color-text-subtle-default)',
  blue: 'var(--color-data-blue-border-primary-default)',
  violet: 'var(--color-data-violet-border-primary-default)',
  green: 'var(--color-data-green-border-primary-default)',
  orange: 'var(--color-data-orange-border-primary-default)',
  red: 'var(--color-data-red-border-primary-default)',
  yellow: 'var(--color-data-yellow-border-primary-default)',
};

export const productTone: Record<Product, Tone> = {
  'Music App': 'green',
  'Podcasts & Audiobooks': 'violet',
  'Spotify for Artists': 'orange',
  'Ads Platform': 'red',
  'Core Platform & Data': 'blue',
};

export const horizonTone: Record<Horizon, Tone> = {
  Candidates: 'violet',
  Now: 'green',
  Next: 'yellow',
  Later: 'gray',
  Completed: 'blue',
};

/** One-line lane explanations, shown in the lane headers (doubles as an inline legend). */
export const horizonDescription: Record<Horizon, string> = {
  Candidates: 'Ideas in intake. Not on the roadmap yet.',
  Now: 'Active work, defined and broken down. Happening now.',
  Next: 'Queued behind Now. Direction set, details still forming.',
  Later: 'Directional bets. Understood broadly, not yet scoped.',
  Completed: 'Shipped and live.',
};

export function laneEmptyCopy(key: string, group: 'horizon' | 'product'): string {
  if (group === 'product') return `No ${key} items match this view.`;
  if (key === 'Completed') return 'Nothing shipped yet. Completed work lands here.';
  if (key === 'Candidates') return 'No candidates in this view.';
  return `No ${key} items match this view.`;
}

export const horizonDot: Record<Horizon, string> = {
  Candidates: 'var(--roadmap-horizon-candidates)',
  Now: 'var(--roadmap-horizon-now)',
  Next: 'var(--roadmap-horizon-next)',
  Later: 'var(--roadmap-horizon-later)',
  Completed: 'var(--roadmap-horizon-completed)',
};

export const levelTone: Record<Level, Tone> = { Low: 'gray', Medium: 'yellow', High: 'orange' };

/** Strong color for an impact/effort level (shared — do not copy into components). */
export const levelColor = (lvl: string | null | undefined): string =>
  lvl && lvl in levelTone ? toneColor[levelTone[lvl as Level]] : toneColor.gray;

/**
 * Impact renders as a tinted directional chip; effort stays a neutral text label
 * (see RoadmapCard/DetailDrawer). Same hue must never carry opposite valences.
 */
export const impactChipStyle = (lvl: string | null | undefined) => {
  const tone = lvl && lvl in levelTone ? levelTone[lvl as Level] : 'gray';
  return { background: toneSurface[tone], color: toneText[tone] };
};

// Product accent colors, from the design-system data/brand accents.
export const productColor: Record<Product, string> = {
  'Music App': 'var(--roadmap-product-music-app)',
  'Podcasts & Audiobooks': 'var(--roadmap-product-podcasts-audiobooks)',
  'Spotify for Artists': 'var(--roadmap-product-spotify-for-artists)',
  'Ads Platform': 'var(--roadmap-product-ads-platform)',
  'Core Platform & Data': 'var(--roadmap-product-core-platform-data)',
};

// Product shorthand, shown on the square product mark.
export const productShort: Record<Product, string> = {
  'Music App': 'MU',
  'Podcasts & Audiobooks': 'PA',
  'Spotify for Artists': 'SA',
  'Ads Platform': 'AD',
  'Core Platform & Data': 'CP',
};

export const horizonStatLabel: Record<Horizon, string> = {
  Candidates: 'In intake',
  Now: 'Actively building',
  Next: 'Planned next',
  Later: 'Future bets',
  Completed: 'Recently shipped',
};

export function documentTone(label: string): Tone {
  const key = label.toLowerCase();
  if (key.includes('prd')) return 'orange';
  if (key.includes('research') || key.includes('microsite')) return 'green';
  if (key.includes('proposal') || key.includes('deck') || key.includes('presentation')) return 'violet';
  if (key.includes('technical')) return 'blue';
  if (key.includes('design')) return 'blue';
  return 'gray';
}

// Deterministic, distinct tone per tag label (stable across renders).
const TAG_TONES: Tone[] = ['blue', 'violet', 'green', 'yellow', 'orange', 'red'];
export function tagTone(tag: string): Tone {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0;
  return TAG_TONES[h % TAG_TONES.length]!;
}

export const initials = (name: string): string =>
  (name || '?')
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

/** The product list as prose — "A, B, C, D and E". Page descriptions and the
 *  board's subtitle read from this so a new product never leaves a stale
 *  hand-written enumeration behind. */
export const productListSentence = (): string =>
  new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(PRODUCTS);
