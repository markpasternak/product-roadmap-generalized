// Serializes a projected board into a polished, standalone roadmap share app.
// The bundle keeps its behavior inline and may reference the roadmap app's
// public brand assets for presentation-mode parity. Lanes follow the roadmap
// horizon order.
import { zipSync, strToU8 } from 'fflate';
import type { ProjectedItem } from './project';

export type ShareTheme = 'light' | 'dark';

export interface ShareContext {
  title: string;
  /** Optional framing paragraph shown under the header. */
  intro?: string;
  product: string | null;
  generatedAt: string;
  theme?: ShareTheme;
  /** Absolute app origin used for shared brand assets in minted Canvas Drop pages. */
  assetBase?: string;
}

const HORIZON_ORDER = ['Now', 'Next', 'Later', 'Completed', 'Candidates'] as const;
const HORIZON_META: Record<string, { dot: string; desc: string; stat: string; tone: string }> = {
  Now: { dot: 'var(--roadmap-horizon-now)', desc: 'Active work, defined and broken down. Happening now.', stat: 'Actively building', tone: 'green' },
  Next: { dot: 'var(--roadmap-horizon-next)', desc: 'Queued behind Now. Direction set, details still forming.', stat: 'Planned next', tone: 'yellow' },
  Later: { dot: 'var(--roadmap-horizon-later)', desc: 'Directional bets. Understood broadly, not yet scoped.', stat: 'Future bets', tone: 'gray' },
  Completed: { dot: 'var(--roadmap-horizon-completed)', desc: 'Shipped and live.', stat: 'Recently shipped', tone: 'blue' },
  Candidates: { dot: 'var(--roadmap-horizon-candidates)', desc: 'Ideas in intake. Not on the roadmap yet.', stat: 'In intake', tone: 'violet' },
};
const PRODUCT_META: Record<string, { short: string; color: string }> = {
  'Music App': { short: 'MU', color: 'var(--roadmap-product-music-app)' },
  'Podcasts & Audiobooks': { short: 'PA', color: 'var(--roadmap-product-podcasts-audiobooks)' },
  'Spotify for Artists': { short: 'SA', color: 'var(--roadmap-product-spotify-for-artists)' },
  'Ads Platform': { short: 'AD', color: 'var(--roadmap-product-ads-platform)' },
  'Core Platform & Data': { short: 'CP', color: 'var(--roadmap-product-core-platform-data)' },
};
const CLIENT_SECTIONS = new Set(['Why it matters', 'What ships', 'What shipped']);
const STAT_HORIZONS = ['All', 'Now', 'Next', 'Later'] as const;
const TONE_TEXT: Record<string, string> = {
  gray: 'var(--color-text-subtle-default)',
  blue: 'var(--color-data-blue-border-primary-default)',
  violet: 'var(--color-data-violet-border-primary-default)',
  green: 'var(--color-data-green-border-primary-default)',
  orange: 'var(--color-data-orange-border-primary-default)',
  red: 'var(--color-data-red-border-primary-default)',
  yellow: 'var(--color-data-yellow-border-primary-default)',
};
const TONE_SURFACE_STRONG: Record<string, string> = {
  orange: 'var(--color-surface-transparent-orange-25)',
  red: 'var(--color-surface-transparent-red-25)',
  violet: 'var(--color-surface-transparent-violet-25)',
  blue: 'var(--color-surface-transparent-blue-25)',
};

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function textWithBreaks(s: string): string {
  return escapeHtml(s).replace(/\n/g, '<br>');
}

const DEFAULT_SHARE_DESCRIPTION = 'A focused view of what is active, planned, and recently shipped.';

/** Plain-text (no <br>) description for og:description / twitter:description. */
function shareDescription(context: ShareContext): string {
  const raw = context.intro?.trim() || DEFAULT_SHARE_DESCRIPTION;
  return escapeHtml(raw.replace(/\s+/g, ' '));
}

/** Filename (relative to index.html) the OG image is bundled under — see buildShareBundle. */
const OG_IMAGE_FILENAME = 'og-card.png';

function productMark(product: string): string {
  const meta = PRODUCT_META[product] ?? { short: '?', color: '#6c7892' };
  return `<span class="product-mark" style="--product:${meta.color}" title="${escapeHtml(product)}">${escapeHtml(meta.short)}</span>`;
}

function chips(values: string[]): string {
  return values.map((t) => `<span class="chip theme-chip">${escapeHtml(t)}</span>`).join('');
}

function shareItemData(items: ProjectedItem[]) {
  return items.map((it) => ({
    id: it.id,
    title: it.title,
    oneliner: it.oneliner,
    outcome: it.outcome,
    product: it.product,
    horizon: it.horizon,
    stage: it.stage,
    themes: [...it.themes],
    sections: it.sections
      .filter((section) => CLIENT_SECTIONS.has(section.heading))
      .map((section) => ({ heading: section.heading, text: section.text })),
  }));
}

function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function assetUrl(context: ShareContext, path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (!context.assetBase) return normalizedPath;
  try {
    return new URL(normalizedPath, context.assetBase).toString();
  } catch {
    return normalizedPath;
  }
}

function cssString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '');
}

function card(it: ProjectedItem, index: number): string {
  const themes = chips(it.themes);
  return `<button type="button" class="roadmap-card roadmap-action share-card" data-card-index="${index}" aria-label="Open ${escapeHtml(it.title)}">
    <span class="card-open" aria-hidden="true">↗</span>
    <div class="card-main">
      ${productMark(it.product)}
      <div class="card-copy">
        <h3>${escapeHtml(it.title)}</h3>
        ${it.oneliner ? `<p>${escapeHtml(it.oneliner)}</p>` : ''}
      </div>
    </div>
    <div class="card-meta">
      <span class="roadmap-quiet-chip stage-chip">
        <svg viewBox="0 0 256 256" aria-hidden="true"><path d="M232 56v64a8 8 0 0 1-16 0V75.31l-74.34 74.35a8 8 0 0 1-11.32 0L96 115.31l-58.34 58.35a8 8 0 0 1-11.32-11.32l64-64a8 8 0 0 1 11.32 0L136 132.69 204.69 64H160a8 8 0 0 1 0-16h64a8 8 0 0 1 8 8Z"/></svg>
        ${escapeHtml(it.stage)}
      </span>
    </div>
    ${themes ? `<div class="tags">${themes}</div>` : ''}
  </button>`;
}

function laneWash(name: string): string {
  return name === 'Now' || name === 'Next'
    ? 'linear-gradient(180deg, var(--roadmap-lane-neutral-start), var(--color-surface-primary-default))'
    : 'linear-gradient(180deg, var(--color-surface-primary-default), var(--color-surface-subtle-default))';
}

function lane(name: string, laneItems: ProjectedItem[], allItems: ProjectedItem[]): string {
  const meta = HORIZON_META[name] ?? { dot: 'var(--roadmap-brand-primary)', desc: '', stat: '', tone: 'orange' };
  const empty = name === 'Completed' && !laneItems.length
    ? '<p class="lane-empty">Nothing shipped yet. Completed work lands here.</p>'
    : '';
  return `<section class="lane" data-lane="${escapeHtml(name)}" style="--lane-accent:${meta.dot};background:${laneWash(name)}">
    <header class="lane-head">
      <div class="lane-title-row">
        <span class="lane-bar" aria-hidden="true"></span>
        <h2>${escapeHtml(name)}</h2>
        <span class="lane-count">${laneItems.length}</span>
      </div>
      ${meta.desc ? `<p>${escapeHtml(meta.desc)}</p>` : ''}
      <div class="lane-rule"></div>
    </header>
    <div class="lane-cards">${laneItems.map((it) => card(it, allItems.indexOf(it))).join('')}${empty}</div>
  </section>`;
}

function stat(key: string, label: string, value: number, dot: string | null, tone: string, sub: string): string {
  const selected = key === 'All' ? ' roadmap-selected-control horizon-selected-control' : '';
  const accent = dot ?? 'var(--color-accent-brand-default)';
  const dotHtml = dot ? `<span class="stat-dot" style="background:${dot}"></span>` : '';
  return `<button type="button" class="roadmap-action stat${selected}" role="tab" aria-selected="${key === 'All'}" data-horizon-filter="${escapeHtml(key)}" style="--horizon-accent:${accent}">
    <span class="stat-label">${dotHtml}${escapeHtml(label)}</span>
    <span class="stat-value">${value}</span>
    <span class="stat-sub" style="color:${TONE_TEXT[tone] ?? TONE_TEXT.gray}">${escapeHtml(sub)}</span>
  </button>`;
}

function renderStats(items: ProjectedItem[]): string {
  return STAT_HORIZONS.map((h) => {
    if (h === 'All') return stat(h, 'Total items', items.length, null, 'orange', 'Across all stages');
    const meta = HORIZON_META[h];
    return stat(h, h, items.filter((i) => i.horizon === h).length, meta.dot, meta.tone, meta.stat);
  }).join('');
}

function detailShell(): string {
  return `<div class="detail-shell" data-detail-shell hidden>
    <div class="drawer-scrim detail-scrim" data-detail-close></div>
    <aside class="drawer-panel roadmap-field roadmap-drawer-field" data-detail-panel role="dialog" aria-modal="true" aria-labelledby="detail-title" tabindex="-1">
      <div class="drawer-top">
        <span class="drawer-eyebrow"><span class="drawer-accent"></span><span id="detail-product"></span></span>
        <div class="drawer-nav">
          <button type="button" class="roadmap-action nav-btn" data-detail-prev aria-label="Previous item">‹</button>
          <span class="nav-count" id="detail-count"></span>
          <button type="button" class="roadmap-action nav-btn nav-next" data-detail-next aria-label="Next item">›</button>
          <button type="button" class="roadmap-action nav-close" data-detail-close aria-label="Close">×</button>
        </div>
      </div>
      <div class="drawer-scroll">
        <div class="drawer-content" data-detail-content>
          <div class="detail-hero">
            <span id="detail-mark" class="product-mark"></span>
            <div class="detail-heading">
              <h2 class="roadmap-display roadmap-title detail-title" id="detail-title"></h2>
              <p class="roadmap-muted detail-meta" id="detail-meta"></p>
            </div>
          </div>
          <p class="detail-lede" id="detail-lede"></p>
          <div class="detail-sections" id="detail-sections"></div>
          <div class="detail-themes" id="detail-themes"></div>
        </div>
      </div>
    </aside>
  </div>`;
}

function css(context: ShareContext): string {
  const accentWash = cssString(assetUrl(context, '/brand/accent-wash.svg'));
  return `
  :root {
    color-scheme: light;
    --roadmap-brand-primary: #12857c;
    --roadmap-brand-primary-light: #3fb3a6;
    --roadmap-brand-tint: #e9f4f2;
    --roadmap-brand-ink: #101a2b;
    --roadmap-brand-slate: #3b4a63;
    --roadmap-page-bg: #ffffff;
    --roadmap-ink: var(--roadmap-brand-ink);
    --roadmap-ink-muted: rgba(59, 74, 99, 0.78);
    --roadmap-glass-bg: rgba(255, 255, 255, 0.82);
    --roadmap-glass-strong: rgba(255, 255, 255, 0.96);
    --roadmap-glass-border: rgba(16, 26, 43, 0.12);
    --roadmap-warm-shadow: 0 18px 46px rgba(16, 26, 43, 0.08), 0 3px 12px rgba(18, 133, 124, 0.05);
    --roadmap-card-shadow: 0 10px 30px rgba(16, 26, 43, 0.07), 0 1px 4px rgba(16, 26, 43, 0.05);
    --roadmap-contour: rgba(18, 133, 124, 0.055);
    --roadmap-lane-neutral-start: rgba(233, 244, 242, 0.44);
    --roadmap-brand-image-opacity: 0.16;
    --roadmap-brand-image-blend: multiply;
    --roadmap-product-music-app: #2f8f57;
    --roadmap-product-podcasts-audiobooks: #5b3fb5;
    --roadmap-product-spotify-for-artists: #b8681c;
    --roadmap-product-ads-platform: #b8443f;
    --roadmap-product-core-platform-data: #2f6098;
    --color-chart-5: #795fea;
    --roadmap-horizon-candidates: var(--color-chart-5);
    --roadmap-horizon-now: #2f8f57;
    --roadmap-horizon-next: #c98218;
    --roadmap-horizon-later: rgba(59, 74, 99, 0.72);
    --roadmap-horizon-completed: var(--roadmap-brand-slate);
    --color-accent-brand-default: var(--roadmap-brand-primary);
    --color-text-primary-default: #1b1813;
    --color-text-subtle-default: #767471;
    --color-text-link-default: #1572ed;
    --color-icons-primary-default: #1b1813;
    --color-icons-subtle-default: #767471;
    --color-border-subtle-default: #e3dacf;
    --color-border-muted-default: #bfb29f;
    --color-surface-primary-default: #ffffff;
    --color-surface-subtle-default: #faf7f5;
    --color-card: #ffffff;
    --color-surface-transparent-blue-10: #1572ed1a;
    --color-surface-transparent-blue-25: #1572ed40;
    --color-surface-transparent-violet-10: #8000ff1a;
    --color-surface-transparent-violet-25: #8000ff40;
    --color-surface-transparent-orange-10: #12857c1a;
    --color-surface-transparent-orange-25: #12857c40;
    --color-surface-transparent-red-25: #f4300940;
    --color-surface-transparent-black-50: #00000080;
    --color-data-blue-border-primary-default: #0b438e;
    --color-data-violet-border-primary-default: #4d0099;
    --color-data-green-border-primary-default: #177231;
    --color-data-orange-border-primary-default: #ad2907;
    --color-data-red-border-primary-default: #af0604;
    --scrim: rgba(0, 0, 0, 0.5);
    --brand-iris: url("${accentWash}");
  }
  :root[data-theme="dark"] {
    color-scheme: dark;
    --roadmap-page-bg: #101a2b;
    --roadmap-ink: #f8f8f8;
    --roadmap-ink-muted: rgba(233, 244, 242, 0.72);
    --roadmap-glass-bg: rgba(17, 27, 54, 0.76);
    --roadmap-glass-strong: rgba(19, 32, 63, 0.92);
    --roadmap-glass-border: rgba(63, 179, 166, 0.2);
    --roadmap-warm-shadow: 0 22px 60px rgba(0, 0, 0, 0.34), 0 8px 26px rgba(18, 133, 124, 0.08);
    --roadmap-card-shadow: 0 16px 44px rgba(0, 0, 0, 0.28), 0 2px 12px rgba(18, 133, 124, 0.06);
    --roadmap-contour: rgba(63, 179, 166, 0.11);
    --roadmap-lane-neutral-start: rgba(17, 27, 54, 0.92);
    --roadmap-brand-image-opacity: 0.18;
    --roadmap-brand-image-blend: screen;
    --roadmap-product-music-app: #73d49a;
    --roadmap-product-podcasts-audiobooks: #a79be6;
    --roadmap-product-spotify-for-artists: #f0b863;
    --roadmap-product-ads-platform: #f0908a;
    --roadmap-product-core-platform-data: #8ca4d4;
    --roadmap-horizon-candidates: #b8a8ff;
    --roadmap-horizon-now: #73d49a;
    --roadmap-horizon-next: #f0b863;
    --roadmap-horizon-later: rgba(233, 244, 242, 0.58);
    --roadmap-horizon-completed: #8ca4d4;
    --color-text-primary-default: #ffffff;
    --color-text-subtle-default: rgba(233, 244, 242, 0.74);
    --color-icons-primary-default: #ffffff;
    --color-icons-subtle-default: rgba(233, 244, 242, 0.72);
    --color-border-subtle-default: rgba(233, 244, 242, 0.16);
    --color-border-muted-default: rgba(233, 244, 242, 0.3);
    --color-surface-primary-default: #111b36;
    --color-surface-subtle-default: #172449;
    --color-card: rgba(17, 27, 54, 0.7);
    --color-data-blue-border-primary-default: #8ca4d4;
    --color-data-violet-border-primary-default: #a79be6;
    --color-data-green-border-primary-default: #73d49a;
    --color-data-orange-border-primary-default: var(--roadmap-brand-primary-light);
    --color-data-red-border-primary-default: #fb986a;
    --scrim: rgba(0, 0, 0, 0.58);
  }
  * { box-sizing: border-box; }
  html { min-width: 320px; background: var(--roadmap-page-bg); scroll-behavior: smooth; }
  body {
    margin: 0;
    color: var(--color-text-primary-default);
    font: 15px/1.55 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background:
      radial-gradient(circle at 88% -8%, rgba(18, 133, 124, 0.1), transparent 30rem),
      linear-gradient(180deg, #ffffff 0%, #fffaf8 42%, var(--roadmap-page-bg) 100%);
  }
  :root[data-theme="dark"] body {
    background:
      radial-gradient(circle at 88% -8%, rgba(18, 133, 124, 0.22), transparent 31rem),
      radial-gradient(circle at 7% 14%, rgba(44, 38, 97, 0.34), transparent 26rem),
      linear-gradient(180deg, #101a2b 0%, #111b36 48%, #101a2b 100%);
  }
  body.modal-open {
    overflow: hidden;
  }
  a { color: inherit; }
  button {
    font: inherit;
  }
  svg {
    display: block;
    fill: currentColor;
  }
  .board-root {
    width: min(1680px, 100%);
    margin: 0 auto;
    padding: 24px;
  }
  .roadmap-title {
    color: var(--roadmap-ink);
    text-wrap: balance;
  }
  .roadmap-display {
    font-family: "Source Serif Pro", Georgia, "Times New Roman", serif;
    font-weight: 400;
    letter-spacing: 0;
    line-height: 1.02;
  }
  .roadmap-display em {
    color: var(--color-accent-brand-default);
    font-style: italic;
  }
  .roadmap-muted {
    color: var(--roadmap-ink-muted);
  }
  .roadmap-label {
    color: var(--color-accent-brand-default);
    font-size: .72rem;
    font-weight: 600;
    letter-spacing: .12em;
    line-height: 1;
    text-transform: uppercase;
  }
  .roadmap-action {
    transition: transform .18s ease, border-color .18s ease, background-color .18s ease, box-shadow .18s ease, color .18s ease;
  }
  .roadmap-action:hover {
    transform: translateY(-1px);
  }
  .roadmap-action:active {
    transform: translateY(0) scale(.985);
  }
  .roadmap-masthead,
  .roadmap-field {
    position: relative;
    overflow: hidden;
    isolation: isolate;
    border: 1px solid var(--roadmap-glass-border);
    box-shadow: var(--roadmap-warm-shadow);
  }
  .roadmap-masthead {
    border-color: rgba(16, 26, 43, .12);
    border-radius: 20px;
    background:
      linear-gradient(128deg, rgba(18, 133, 124, .08), rgba(255, 255, 255, 0) 52%),
      linear-gradient(180deg, rgba(255, 255, 255, .98), rgba(255, 250, 248, .96));
    margin-bottom: 16px;
    padding: 14px 28px 16px;
    --roadmap-ink: var(--roadmap-brand-ink);
    --roadmap-ink-muted: rgba(59, 74, 99, .78);
    --roadmap-glass-bg: rgba(255, 255, 255, .68);
    --roadmap-glass-strong: rgba(255, 255, 255, .92);
    --roadmap-glass-border: rgba(18, 133, 124, .16);
    --color-card: rgba(255, 255, 255, .82);
    --color-text-primary-default: var(--roadmap-brand-ink);
    --color-text-subtle-default: rgba(59, 74, 99, .72);
    --color-border-subtle-default: rgba(16, 26, 43, .13);
    --color-surface-subtle-default: rgba(233, 244, 242, .58);
  }
  :root[data-theme="dark"] .roadmap-masthead {
    border-color: rgba(63, 179, 166, .2);
    background:
      linear-gradient(128deg, rgba(18, 133, 124, .15), rgba(44, 38, 97, .16) 50%, rgba(16, 26, 43, 0) 72%),
      linear-gradient(180deg, rgba(17, 27, 54, .98), rgba(16, 26, 43, .96));
    --roadmap-ink: #ffffff;
    --roadmap-ink-muted: rgba(233, 244, 242, .76);
    --roadmap-glass-bg: rgba(17, 27, 54, .58);
    --roadmap-glass-strong: rgba(23, 36, 73, .82);
    --roadmap-glass-border: rgba(63, 179, 166, .18);
    --color-card: rgba(17, 27, 54, .7);
    --color-text-primary-default: #ffffff;
    --color-text-subtle-default: rgba(233, 244, 242, .74);
    --color-border-subtle-default: rgba(233, 244, 242, .16);
    --color-surface-subtle-default: rgba(233, 244, 242, .1);
  }
  .roadmap-masthead::after {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 0;
    background:
      linear-gradient(90deg, rgba(255, 255, 255, .92) 0%, rgba(255, 255, 255, .66) 48%, rgba(255, 255, 255, .18) 100%),
      var(--brand-iris) right -7rem top 38% / min(42rem, 56vw) auto no-repeat;
    opacity: .92;
  }
  :root[data-theme="dark"] .roadmap-masthead::after {
    background:
      linear-gradient(90deg, rgba(16, 26, 43, .94) 0%, rgba(16, 26, 43, .64) 48%, rgba(16, 26, 43, .16) 100%),
      var(--brand-iris) right -7rem top 38% / min(46rem, 58vw) auto no-repeat;
    opacity: .9;
  }
  .roadmap-masthead > * {
    position: relative;
    z-index: 1;
  }
  .hero-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(360px, .54fr);
    gap: 24px;
    align-items: center;
  }
  h1 {
    max-width: 860px;
    margin: 6px 0 0;
    font-size: clamp(1.8rem, 3.1vw, 2.45rem);
  }
  .intro {
    max-width: 68ch;
    margin: 6px 0 0;
    font-size: .95rem;
    line-height: 1.55;
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px;
    border-radius: 12px;
    padding: 6px;
  }
  .stat {
    appearance: none;
    display: block;
    text-align: left;
    min-width: 0;
    border: 1px solid rgba(16, 26, 43, .1);
    border-radius: 8px;
    background: var(--roadmap-glass-bg);
    color: var(--color-text-primary-default);
    cursor: pointer;
    padding: 8px 10px;
  }
  .stat-label {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--color-text-primary-default);
    font-size: 12px;
    font-weight: 500;
  }
  .stat-dot {
    width: 4px;
    height: 14px;
    flex-shrink: 0;
    border-radius: 999px;
  }
  .stat-value {
    display: block;
    margin-top: 4px;
    color: var(--roadmap-ink);
    font-family: Georgia, "Times New Roman", serif;
    font-size: clamp(1.3rem, 2.2vw, 1.45rem);
    font-weight: 400;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }
  .stat-sub {
    display: block;
    margin-top: 4px;
    font-size: 12px;
    font-weight: 500;
  }
  .roadmap-selected-control {
    border-color: var(--color-accent-brand-default);
    background:
      linear-gradient(180deg, rgba(255, 255, 255, .98), rgba(233, 244, 242, .72)),
      linear-gradient(135deg, rgba(18, 133, 124, .12), rgba(63, 179, 166, .04));
    box-shadow: inset 0 2px 0 var(--color-accent-brand-default), 0 10px 28px rgba(18, 133, 124, .11);
  }
  .horizon-selected-control {
    border-color: var(--horizon-accent, var(--color-accent-brand-default));
    box-shadow:
      inset 0 2px 0 var(--horizon-accent, var(--color-accent-brand-default)),
      0 10px 28px color-mix(in srgb, var(--horizon-accent, var(--color-accent-brand-default)) 20%, transparent);
  }
  :root[data-theme="dark"] .roadmap-selected-control {
    background:
      linear-gradient(180deg, rgba(23, 36, 73, .94), rgba(19, 32, 63, .86)),
      linear-gradient(135deg, rgba(18, 133, 124, .18), rgba(63, 179, 166, .08));
    box-shadow: inset 0 2px 0 var(--roadmap-brand-primary-light), 0 12px 30px rgba(0, 0, 0, .22);
  }
  :root[data-theme="dark"] .horizon-selected-control {
    border-color: var(--horizon-accent, var(--roadmap-brand-primary-light));
    box-shadow:
      inset 0 2px 0 var(--horizon-accent, var(--roadmap-brand-primary-light)),
      0 12px 30px rgba(0, 0, 0, .22);
  }
  .roadmap-glass {
    border: 1px solid var(--roadmap-glass-border);
    background: var(--roadmap-glass-bg);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, .92), var(--roadmap-warm-shadow);
    backdrop-filter: blur(18px);
  }
  :root[data-theme="dark"] .roadmap-glass {
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, .08), var(--roadmap-warm-shadow);
  }
  .board-shell {
    border-radius: 24px;
    padding: 16px;
  }
  .board-scroll {
    display: flex;
    flex-direction: row;
    align-items: flex-start;
    gap: 16px;
    overflow-x: auto;
    padding-bottom: 8px;
    scrollbar-width: thin;
    scrollbar-color: transparent transparent;
  }
  .board-scroll:hover {
    scrollbar-color: var(--color-border-muted-default) transparent;
  }
  .board-scroll::-webkit-scrollbar {
    height: 10px;
  }
  .board-scroll::-webkit-scrollbar-thumb {
    background-color: transparent;
    border: 3px solid transparent;
    border-radius: 9999px;
    background-clip: padding-box;
  }
  .board-scroll:hover::-webkit-scrollbar-thumb {
    background-color: var(--color-border-muted-default);
  }
  .lane {
    flex: 1 1 0;
    min-width: 270px;
    border: 1px solid rgba(227, 218, 207, .8);
    border-radius: 20px;
    box-shadow: 0 1px 3px rgba(16, 26, 43, .07);
    padding: 10px;
  }
  .lane[hidden] {
    display: none;
  }
  :root[data-theme="dark"] .lane {
    border-color: rgba(63, 179, 166, .16);
  }
  .lane-head {
    padding: 10px 12px 0;
  }
  .lane-title-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .lane-bar {
    width: 4px;
    height: 20px;
    border-radius: 999px;
    background: var(--lane-accent);
  }
  .lane h2 {
    margin: 0;
    color: var(--roadmap-ink);
    font-family: Georgia, "Times New Roman", serif;
    font-size: 1.3rem;
    font-weight: 400;
    line-height: 1;
  }
  .lane-head p {
    max-width: 28ch;
    margin: 6px 0 0;
    color: var(--color-text-subtle-default);
    font-size: 13px;
    font-weight: 500;
    line-height: 1.35;
  }
  .lane-count {
    margin-left: auto;
    display: grid;
    width: 28px;
    height: 28px;
    place-items: center;
    border: 1px solid var(--color-border-subtle-default);
    border-radius: 8px;
    background: rgba(255, 255, 255, .85);
    color: var(--color-text-primary-default);
    box-shadow: 0 1px 3px rgba(16, 26, 43, .08);
    font-size: 14px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  :root[data-theme="dark"] .lane-count {
    background: rgba(17, 27, 54, .7);
  }
  .lane-rule {
    margin-top: 10px;
    border-top: 1px solid var(--color-border-subtle-default);
  }
  .lane-cards {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 12px;
  }
  .share-card {
    appearance: none;
    position: relative;
    display: block;
    width: 100%;
    cursor: pointer;
    border-radius: 16px;
    padding: 14px;
    color: var(--color-text-primary-default);
    text-align: left;
  }
  .roadmap-card {
    border: 1px solid rgba(16, 26, 43, .11);
    background: linear-gradient(180deg, rgba(255, 255, 255, .99), rgba(255, 250, 248, .94));
    box-shadow: var(--roadmap-card-shadow);
  }
  :root[data-theme="dark"] .roadmap-card {
    border-color: rgba(63, 179, 166, .16);
    background: linear-gradient(180deg, rgba(19, 32, 63, .98), rgba(17, 27, 54, .94));
  }
  .share-card:hover {
    border-color: var(--color-accent-brand-default);
  }
  .share-card:focus-visible,
  .stat:focus-visible,
  .nav-btn:focus-visible,
  .nav-close:focus-visible {
    outline: 3px solid rgba(18, 133, 124, .36);
    outline-offset: 2px;
  }
  .roadmap-card-active {
    border-color: var(--color-accent-brand-default);
    box-shadow: inset 3px 0 0 var(--color-accent-brand-default), 0 14px 34px rgba(18, 133, 124, .12), var(--roadmap-card-shadow);
  }
  :root[data-theme="dark"] .roadmap-card-active {
    box-shadow: inset 3px 0 0 var(--roadmap-brand-primary-light), 0 14px 34px rgba(0, 0, 0, .28), var(--roadmap-card-shadow);
  }
  .card-open {
    position: absolute;
    top: 12px;
    right: 12px;
    color: var(--color-icons-subtle-default);
    font-size: 14px;
    opacity: 0;
    transition: opacity .15s ease;
  }
  .share-card:hover .card-open {
    opacity: 1;
  }
  .card-main {
    display: flex;
    align-items: flex-start;
    gap: 12px;
  }
  .product-mark {
    display: grid;
    flex: 0 0 auto;
    width: 36px;
    height: 36px;
    place-items: center;
    border-radius: 10px;
    background: linear-gradient(145deg, var(--product), color-mix(in srgb, var(--product) 72%, var(--roadmap-brand-ink)));
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, .22), 0 10px 22px rgba(16, 26, 43, .18);
    color: #fff;
    font-size: 12px;
    font-weight: 700;
  }
  .card-copy {
    min-width: 0;
    flex: 1;
  }
  .card-copy h3 {
    margin: 0;
    padding-right: 16px;
    color: var(--color-text-primary-default);
    font-size: 15px;
    font-weight: 600;
    line-height: 1.35;
  }
  .card-copy p {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    margin: 6px 0 0;
    overflow: hidden;
    color: var(--color-text-subtle-default);
    font-size: 14px;
    line-height: 1.45;
  }
  .card-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 12px;
    margin-top: 12px;
  }
  .roadmap-quiet-chip {
    border: 1px solid var(--roadmap-glass-border);
    background: rgba(255, 255, 255, .62);
  }
  :root[data-theme="dark"] .roadmap-quiet-chip {
    background: rgba(19, 32, 63, .62);
  }
  .stage-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border-radius: 8px;
    padding: 4px 8px;
    color: var(--color-text-subtle-default);
    font-size: 12px;
    font-weight: 500;
  }
  .stage-chip svg {
    width: 12px;
    height: 12px;
  }
  .detail-shell[hidden] {
    display: none;
  }
  .detail-shell {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    overflow: hidden;
    padding: 24px;
  }
  .detail-scrim {
    position: fixed;
    inset: 0;
    background: var(--scrim);
    animation: fade .18s ease;
  }
  .drawer-panel {
    position: relative;
    display: flex;
    flex-direction: column;
    width: min(900px, 100%);
    max-height: calc(100dvh - 48px);
    min-height: 320px;
    overflow: hidden;
    border-radius: 20px;
    animation: detail-pop .2s cubic-bezier(.23, 1, .32, 1);
    outline: none;
  }
  .roadmap-field {
    background:
      linear-gradient(128deg, rgba(18, 133, 124, .08), rgba(255, 255, 255, 0) 56%),
      linear-gradient(180deg, rgba(255, 255, 255, .98), rgba(255, 250, 248, .94));
  }
  .roadmap-field::before {
    content: '';
    position: absolute;
    inset: -35% -12% auto 39%;
    height: 130%;
    pointer-events: none;
    background: repeating-radial-gradient(ellipse at center, transparent 0 22px, var(--roadmap-contour) 23px 24px);
    opacity: .48;
    transform: rotate(-9deg);
    z-index: 0;
  }
  .roadmap-field::after {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    background:
      linear-gradient(90deg, rgba(255, 255, 255, .96), rgba(255, 255, 255, .34) 58%, rgba(233, 244, 242, .58)),
      var(--brand-iris) 96% 26% / min(34rem, 54vw) auto no-repeat;
    mix-blend-mode: var(--roadmap-brand-image-blend);
    opacity: .1;
    z-index: 0;
  }
  .roadmap-field > * {
    position: relative;
    z-index: 1;
  }
  :root[data-theme="dark"] .roadmap-field {
    background:
      linear-gradient(128deg, rgba(18, 133, 124, .14), rgba(14, 22, 39, 0) 58%),
      linear-gradient(180deg, rgba(17, 27, 54, .94), rgba(16, 26, 43, .9));
  }
  :root[data-theme="dark"] .roadmap-field::after {
    background:
      linear-gradient(90deg, rgba(16, 26, 43, .94), rgba(16, 26, 43, .34) 58%, rgba(16, 26, 43, .82)),
      var(--brand-iris) 93% 32% / min(38rem, 58vw) auto no-repeat;
    opacity: .18;
  }
  .drawer-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 10px 20px;
  }
  .drawer-eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--roadmap-ink);
    font-size: 13px;
    font-weight: 500;
  }
  .drawer-accent {
    width: 4px;
    height: 16px;
    border-radius: 999px;
    background: var(--color-accent-brand-default);
  }
  .drawer-nav {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .nav-btn {
    appearance: none;
    display: grid;
    width: 40px;
    height: 40px;
    place-items: center;
    border: 1px solid var(--color-border-subtle-default);
    border-radius: 10px;
    background: rgba(255, 255, 255, .8);
    color: var(--color-icons-subtle-default);
    cursor: pointer;
    font-size: 20px;
  }
  .nav-next {
    border-color: var(--color-accent-brand-default);
    color: var(--color-accent-brand-default);
  }
  .nav-close {
    appearance: none;
    display: grid;
    width: 40px;
    height: 40px;
    place-items: center;
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: var(--color-icons-primary-default);
    cursor: pointer;
    font-size: 24px;
  }
  .nav-btn:disabled {
    cursor: default;
    opacity: .34;
  }
  :root[data-theme="dark"] .nav-btn {
    background: rgba(17, 27, 54, .8);
  }
  .nav-count {
    min-width: 48px;
    color: var(--roadmap-ink);
    font-size: 13px;
    font-weight: 500;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .drawer-scroll {
    flex: 1;
    overflow-y: auto;
  }
  .drawer-content {
    padding: 0 24px 24px;
  }
  .detail-hero {
    display: grid;
    grid-template-columns: 46px minmax(0, 1fr);
    gap: 12px;
    align-items: start;
  }
  .detail-hero .product-mark {
    width: 42px;
    height: 42px;
  }
  .detail-title {
    margin: 0;
    font-size: clamp(1.5rem, 4vw, 1.8rem);
  }
  .detail-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 12px;
    margin: 8px 0 0;
    font-size: 14px;
  }
  .detail-meta span {
    display: inline-flex;
    align-items: center;
    gap: 7px;
  }
  .dot {
    width: 4px;
    height: 16px;
    border-radius: 999px;
  }
  .detail-lede {
    max-width: 64rem;
    margin: 20px 0 0;
    color: var(--color-text-primary-default);
    font-size: 1rem;
    line-height: 1.7;
  }
  .detail-sections {
    display: grid;
    gap: 18px;
    margin-top: 22px;
  }
  .detail-section {
    display: grid;
    grid-template-columns: 44px minmax(0, 1fr);
    gap: 12px;
  }
  .section-icon {
    display: grid;
    width: 40px;
    height: 40px;
    place-items: center;
    border: 1px solid var(--roadmap-glass-border);
    border-radius: 10px;
    background: var(--section-surface, var(--color-surface-transparent-orange-25));
    color: var(--section-color, var(--color-data-orange-border-primary-default));
    font-size: 13px;
    font-weight: 700;
  }
  .detail-section h3 {
    margin: 0;
    color: var(--color-accent-brand-default);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: .12em;
    line-height: 1;
    text-transform: uppercase;
  }
  .detail-section p {
    margin: 8px 0 0;
    color: var(--color-text-primary-default);
    font-size: 1rem;
    line-height: 1.7;
    white-space: pre-line;
  }
  .detail-themes {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 22px;
  }
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 12px;
  }
  .chip {
    max-width: 100%;
    overflow: hidden;
    border: 1px solid rgba(227, 218, 207, .6);
    border-radius: 8px;
    background: var(--color-surface-transparent-orange-10);
    color: var(--color-data-orange-border-primary-default);
    padding: 4px 8px;
    font-size: 12px;
    font-weight: 500;
    line-height: 1.15;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  @keyframes fade {
    from { opacity: 0; }
  }
  @keyframes detail-pop {
    from { opacity: 0; transform: translateY(14px) scale(.985); }
  }
  footer {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 10px;
    margin-top: 20px;
    color: var(--color-text-subtle-default);
    font-size: 12px;
  }
  @media (max-width: 940px) {
    .hero-grid { grid-template-columns: 1fr; align-items: start; }
    .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  @media (max-width: 640px) {
    .board-root { padding: 12px; }
    .roadmap-masthead { padding: 20px; }
    h1 { font-size: clamp(1.8rem, 10vw, 2.45rem); }
    .stats { grid-template-columns: 1fr; }
    .board-shell { padding: 14px; }
    .board-scroll { flex-direction: column; gap: 20px; }
    .lane { width: 100%; min-width: 0; }
    .detail-section { grid-template-columns: 1fr; }
    .section-icon { display: none; }
    .detail-shell { padding: 12px; }
    .drawer-panel { max-height: calc(100dvh - 24px); }
    .drawer-top { padding-inline: 16px; }
    .drawer-content { padding-inline: 16px; }
  }
  @media (prefers-reduced-motion: reduce) {
    html { scroll-behavior: auto; }
    .roadmap-action,
    .nav-btn,
    .detail-scrim,
    .drawer-panel {
      animation: none;
      transition: none;
    }
  }`;
}

function js(): string {
  return `
(() => {
  const dataEl = document.getElementById('roadmap-data');
  const items = JSON.parse(dataEl?.textContent || '[]');
  const shell = document.querySelector('[data-detail-shell]');
  const panel = document.querySelector('[data-detail-panel]');
  const title = document.getElementById('detail-title');
  const product = document.getElementById('detail-product');
  const mark = document.getElementById('detail-mark');
  const meta = document.getElementById('detail-meta');
  const lede = document.getElementById('detail-lede');
  const sections = document.getElementById('detail-sections');
  const themes = document.getElementById('detail-themes');
  const count = document.getElementById('detail-count');
  const prev = document.querySelector('[data-detail-prev]');
  const next = document.querySelector('[data-detail-next]');
  const cards = Array.from(document.querySelectorAll('[data-card-index]'));
  const lanes = Array.from(document.querySelectorAll('[data-lane]'));
  const filters = Array.from(document.querySelectorAll('[data-horizon-filter]'));
  const horizonColor = ${safeJson(Object.fromEntries(Object.entries(HORIZON_META).map(([key, value]) => [key, value.dot])))};
  const productMeta = ${safeJson(PRODUCT_META)};
  const toneText = ${safeJson(TONE_TEXT)};
  const toneSurfaceStrong = ${safeJson(TONE_SURFACE_STRONG)};
  let index = -1;
  let activeHorizon = 'All';
  let lastFocus = null;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function sectionIcon(heading) {
    const h = heading.toLowerCase();
    if (h.includes('target')) return 'T';
    if (h.includes('why')) return 'W';
    if (h.includes('ships')) return 'S';
    return 'I';
  }

  function sectionTone(heading) {
    const h = heading.toLowerCase();
    if (h.includes('target')) return 'orange';
    if (h.includes('why')) return 'red';
    if (h.includes('ships')) return 'violet';
    return 'blue';
  }

  function setMark(node, item) {
    const info = productMeta[item.product] || { short: '?', color: '#6c7892' };
    node.style.setProperty('--product', info.color);
    node.title = item.product;
    node.textContent = info.short;
  }

  function visibleIndexes() {
    if (activeHorizon === 'All') return items.map((_, i) => i);
    return items.map((item, i) => item.horizon === activeHorizon ? i : -1).filter((i) => i >= 0);
  }

  function setFilter(nextHorizon) {
    activeHorizon = nextHorizon || 'All';
    filters.forEach((filter) => {
      const selected = filter.dataset.horizonFilter === activeHorizon;
      filter.classList.toggle('roadmap-selected-control', selected);
      filter.classList.toggle('horizon-selected-control', selected);
      filter.setAttribute('aria-selected', selected ? 'true' : 'false');
    });
    lanes.forEach((lane) => {
      lane.hidden = activeHorizon !== 'All' && lane.dataset.lane !== activeHorizon;
    });
  }

  function render(i) {
    if (!items.length || !shell || !panel) return;
    index = Math.max(0, Math.min(items.length - 1, i));
    const visible = visibleIndexes();
    if (!visible.includes(index)) index = visible[0] ?? index;
    const visiblePos = Math.max(0, visible.indexOf(index));
    const item = items[index];
    title.textContent = item.title;
    product.textContent = item.product;
    setMark(mark, item);
    meta.replaceChildren();
    const horizon = el('span');
    const dot = el('i');
    dot.className = 'dot';
    dot.style.background = horizonColor[item.horizon] || '#12857c';
    horizon.append(dot, document.createTextNode(item.horizon));
    meta.append(horizon, el('span', '', item.stage));
    lede.hidden = !item.oneliner;
    lede.textContent = item.oneliner || '';

    const story = [];
    if (item.outcome) story.push({ heading: 'Target outcome', text: item.outcome });
    for (const section of item.sections || []) story.push(section);
    sections.replaceChildren(...story.map((section) => {
      const wrap = el('section', 'detail-section');
      const tone = sectionTone(section.heading);
      const icon = el('span', 'section-icon', sectionIcon(section.heading));
      icon.style.setProperty('--section-surface', toneSurfaceStrong[tone] || toneSurfaceStrong.orange);
      icon.style.setProperty('--section-color', toneText[tone] || toneText.orange);
      wrap.append(icon);
      const body = el('div');
      body.append(el('h3', '', section.heading), el('p', '', section.text));
      wrap.append(body);
      return wrap;
    }));
    sections.hidden = story.length === 0;

    themes.replaceChildren(...(item.themes || []).map((theme) => el('span', 'chip theme-chip', theme)));
    themes.hidden = !item.themes?.length;
    count.textContent = (visiblePos + 1) + '/' + visible.length;
    prev.disabled = visiblePos === 0;
    next.disabled = visiblePos === visible.length - 1;
    cards.forEach((card) => card.classList.toggle('roadmap-card-active', Number(card.dataset.cardIndex) === index));
  }

  function open(i) {
    lastFocus = document.activeElement;
    render(i);
    shell.hidden = false;
    document.body.classList.add('modal-open');
    requestAnimationFrame(() => panel.focus());
  }

  function close() {
    if (!shell || shell.hidden) return;
    shell.hidden = true;
    document.body.classList.remove('modal-open');
    lastFocus?.focus?.();
  }

  document.addEventListener('click', (event) => {
    const card = event.target.closest('[data-card-index]');
    if (card) open(Number(card.dataset.cardIndex));
    const filter = event.target.closest('[data-horizon-filter]');
    if (filter) setFilter(filter.dataset.horizonFilter || 'All');
    if (event.target.closest('[data-detail-close]')) close();
    if (event.target.closest('[data-detail-prev]')) {
      const visible = visibleIndexes();
      const pos = visible.indexOf(index);
      if (pos > 0) render(visible[pos - 1]);
    }
    if (event.target.closest('[data-detail-next]')) {
      const visible = visibleIndexes();
      const pos = visible.indexOf(index);
      if (pos >= 0 && pos < visible.length - 1) render(visible[pos + 1]);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (!shell || shell.hidden) return;
    if (event.key === 'Escape') close();
    if (event.key === 'ArrowLeft') {
      const visible = visibleIndexes();
      const pos = visible.indexOf(index);
      if (pos > 0) render(visible[pos - 1]);
    }
    if (event.key === 'ArrowRight') {
      const visible = visibleIndexes();
      const pos = visible.indexOf(index);
      if (pos >= 0 && pos < visible.length - 1) render(visible[pos + 1]);
    }
  });
  setFilter('All');
})();
`;
}

export function renderShareHtml(context: ShareContext, items: ProjectedItem[]): string {
  const theme = context.theme ?? 'light';
  const lanes = HORIZON_ORDER
    .map((h) => ({ h, items: items.filter((i) => i.horizon === h) }))
    .filter((l) => l.items.length || l.h === 'Completed')
    .map((l) => lane(l.h, l.items, items))
    .join('');
  const title = escapeHtml(context.title);
  const description = shareDescription(context);
  const itemCount = items.length;
  const laneCount = new Set(items.map((i) => i.horizon)).size;
  return `<!doctype html>
<html lang="en" data-theme="${theme}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:type" content="website">
<meta property="og:image" content="${OG_IMAGE_FILENAME}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${description}">
<meta name="twitter:image" content="${OG_IMAGE_FILENAME}">
<style>${css(context)}</style></head>
<body><main class="board-root">
  <section class="roadmap-masthead">
    <div class="hero-grid">
      <div>
        <p class="roadmap-label">Product roadmap</p>
        <h1 class="roadmap-display roadmap-title">${title}</h1>
        ${context.intro ? `<p class="roadmap-muted intro">${textWithBreaks(context.intro)}</p>` : `<p class="roadmap-muted intro">${DEFAULT_SHARE_DESCRIPTION}</p>`}
      </div>
      <aside class="roadmap-glass stats" role="tablist" aria-label="Horizon">${renderStats(items)}</aside>
    </div>
  </section>
  <div class="roadmap-glass board-shell"><div class="board-scroll">${lanes}</div></div>
  <footer>
    <span>Shared from the product roadmap</span>
    <span>Shared ${escapeHtml(context.generatedAt)}</span>
    <span>${itemCount} item${itemCount === 1 ? '' : 's'} across ${laneCount} lane${laneCount === 1 ? '' : 's'}</span>
  </footer>
  ${detailShell()}
  <script type="application/json" id="roadmap-data">${safeJson(shareItemData(items))}</script>
  <script>${js()}</script>
</main></body></html>`;
}

/**
 * Zip index.html (+ the OG card, if supplied) in-browser; publish() requires a
 * zip bundle. `ogImage` is served by canvas-drop as a sibling of index.html at
 * the share's own public origin — the share's `og:image`/`twitter:image` meta
 * reference it by the bare filename (OG_IMAGE_FILENAME) precisely so it
 * resolves there rather than back at the team-auth-gated roadmap origin,
 * which crawlers can't reach.
 */
export function buildShareBundle(html: string, ogImage?: Uint8Array | ArrayBuffer): Blob {
  const files: Record<string, Uint8Array> = { 'index.html': strToU8(html) };
  if (ogImage) {
    files[OG_IMAGE_FILENAME] = ogImage instanceof Uint8Array ? ogImage : new Uint8Array(ogImage);
  }
  const zipped = zipSync(files, { level: 6 });
  // Copy into a fresh ArrayBuffer so the Blob owns a clean, non-shared buffer.
  return new Blob([zipped.slice()], { type: 'application/zip' });
}
