// Serializes a projected board into a polished, standalone roadmap share app.
// The bundle keeps its behavior inline and carries its own brand assets.
// Recipients see product groups; internal horizon choices stay in the working board.
import { timelineModel, timelineSettings, scheduleLabel, scheduleIssue, formatPlanDate, type TimelineSettings, type TimelineRange } from '../timeline';
import timelineCss from '../../styles/timeline.css?raw';
import { zipSync, strToU8 } from 'fflate';
import { ROADMAP_FAVICON } from '../brand';
import reviewCss from '../../styles/roadmap-review.css?raw';
import appearanceCss from '../../styles/appearance.css?raw';
import { SHARE_ASSET_PATHS, type ShareAssetUrls } from './assets';
import type { ProjectedItem } from './project';

export type ShareTheme = 'light' | 'dark';

export interface ShareContext {
  timeline?: TimelineSettings & { range: TimelineRange };
  title: string;
  /** Optional framing paragraph shown under the header. */
  intro?: string;
  product: string | null;
  /** Horizon lanes selected in the roadmap view, including intentionally empty lanes. */
  horizons?: readonly string[];
  generatedAt: string;
  /** Resolved, fixed activity dates for this snapshot. */
  activitySummary?: string;
  theme?: ShareTheme;
  /** Absolute app origin used for shared brand assets in minted Canvas Drop pages. */
  assetBase?: string;
  /** Preview URLs or the relative paths packaged into the published ZIP. */
  assets?: ShareAssetUrls;
}

const PRODUCT_META: Record<string, { short: string; color: string }> = {
  'Spotify for Artists': { short: 'SA', color: 'var(--roadmap-product-spotify-for-artists)' },
  'Ads Platform': { short: 'AP', color: 'var(--roadmap-product-ads-platform)' },
  'Core Platform & Data': { short: 'CP', color: 'var(--roadmap-product-core-platform-data)' },
  'Music App': { short: 'MA', color: 'var(--roadmap-product-music-app)' },
  'Podcasts & Audiobooks': { short: 'PA', color: 'var(--roadmap-product-podcasts-audiobooks)' },
};
const CLIENT_SECTIONS = new Set(['Why it matters', 'What ships', 'What shipped']);

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

function shareItemData(items: ProjectedItem[]) {
  return items.map((it) => ({
    planned: scheduleLabel(it),
    id: it.id,
    title: it.title,
    oneliner: it.oneliner,
    outcome: it.outcome,
    product: it.product,
    stage: it.stage,
    themes: [...it.themes],
    resources: (it.resources ?? [])
      .filter((r) =>
        /^(?:https?:\/\/|assets\/ast_[a-z0-9_-]+\/rev_[a-z0-9_-]+\/[A-Za-z0-9_.-]+$|data:(?:image\/(?:png|jpeg|gif|webp)|video\/(?:mp4|webm)|application\/(?:pdf|zip|vnd\.openxmlformats-officedocument\.(?:wordprocessingml\.document|presentationml\.presentation|spreadsheetml\.sheet))|text\/plain)(?:; ?charset=utf-8)?;base64,)/.test(
          r.href,
        ),
      )
      .map((r) => ({ label: r.label, href: r.href, mediaType: r.mediaType, bytes: r.bytes, sha256: r.sha256 })),
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
  return `<button type="button" class="roadmap-card roadmap-product-card roadmap-action share-card" style="--roadmap-product-accent:${PRODUCT_META[it.product]?.color ?? 'var(--color-icons-subtle-default)'}" data-card-index="${index}" aria-label="Open ${escapeHtml(it.title)}">
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
        ${escapeHtml(it.stage)}
      </span>
    </div>
    ${scheduleLabel(it) ? `<p class="timeline-range-caption">Planned ${escapeHtml(scheduleLabel(it))}</p>` : ''}
  </button>`;
}

function lane(name: string, laneItems: ProjectedItem[], allItems: ProjectedItem[]): string {
  const accent = PRODUCT_META[name]?.color ?? 'var(--color-accent-brand-default)';
  return `<section class="lane" data-lane="${escapeHtml(name)}" style="--lane-accent:${accent}">
    <header class="lane-head">
      <div class="lane-title-row">
        <span class="lane-bar" aria-hidden="true"></span>
        <h2>${escapeHtml(name)}</h2>
        <span class="lane-count">${laneItems.length}</span>
      </div>
      <div class="lane-rule"></div>
    </header>
    <div class="lane-cards">${laneItems.map((it) => card(it, allItems.indexOf(it))).join('')}</div>
  </section>`;
}

function detailShell(): string {
  return `<div class="detail-shell" data-detail-shell hidden>
    <div class="drawer-scrim detail-scrim" data-detail-close></div>
    <aside class="drawer-panel roadmap-field roadmap-drawer-field roadmap-product-detail" data-detail-panel role="dialog" aria-modal="true" aria-labelledby="detail-title" tabindex="-1">
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
              <h2 class="roadmap-display roadmap-title detail-title" id="detail-title" tabindex="-1" aria-live="polite"></h2>
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
  const assets = context.assets ?? SHARE_ASSET_PATHS;
  return `
  @font-face { font-family: 'Source Serif Pro'; font-style: normal; font-weight: 400; font-display: swap; src: url("${cssString(assets.serif)}") format('truetype'); }
  @font-face { font-family: 'Inter'; font-style: normal; font-weight: 400; font-display: swap; src: url("${cssString(assets.inter)}") format('woff2'); }
  @font-face { font-family: 'Inter'; font-style: normal; font-weight: 500; font-display: swap; src: url("${cssString(assets.medium)}") format('woff2'); }
  @font-face { font-family: 'Inter'; font-style: normal; font-weight: 600; font-display: swap; src: url("${cssString(assets.semibold)}") format('woff2'); }
  :root {
    color-scheme: light;
    --color-surface-transparent-blue-10: #1572ed1a;
    --color-surface-transparent-blue-25: #1572ed40;
    --color-surface-transparent-violet-10: #8000ff1a;
    --color-surface-transparent-violet-25: #8000ff40;
    --color-surface-transparent-orange-10: #12857c1a;
    --color-surface-transparent-orange-25: #12857c40;
    --color-surface-transparent-red-25: #f4300940;
    --color-surface-transparent-black-50: #00000080;
    --scrim: rgba(0, 0, 0, 0.5);
  }
  * { box-sizing: border-box; }
  html { min-width: 320px; background: var(--roadmap-page-bg); scroll-behavior: smooth; }
  body {
    margin: 0;
    color: var(--color-text-primary-default);
    font: 15px/1.55 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: var(--roadmap-page-bg);
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
    width: min(1600px, 100%);
    margin: 0 auto;
    padding: 20px 24px;
  }
  .share-header {
    border-bottom: 1px solid var(--roadmap-glass-border);
    background: var(--color-card);
  }
  .share-header-inner {
    display: flex;
    align-items: center;
    gap: 16px;
    min-height: 64px;
    max-width: 1600px;
    margin: 0 auto;
    padding: 0 24px;
    font-size: 14px;
    font-weight: 500;
  }
  .share-header-caption {
    margin-left: auto;
    color: var(--roadmap-ink-muted);
    font-size: 12px;
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
    border: 1px solid rgba(10, 21, 49, .1);
    border-radius: 8px;
    background: var(--roadmap-glass-bg);
    color: var(--color-text-primary-default);
    cursor: pointer;
    padding: 8px 10px;
  }
  .stat-label {
    display: flex;
    align-items: center;
    min-width: 0;
    gap: 8px;
    color: var(--color-text-primary-default);
    font-size: 12px;
    font-weight: 500;
    line-height: 1.15;
    overflow-wrap: anywhere;
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
    font-family: "Source Serif Pro", Georgia, "Times New Roman", serif;
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
    line-height: 1.15;
    overflow-wrap: anywhere;
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
    box-shadow: 0 1px 3px rgba(10, 21, 49, .07);
    padding: 10px;
  }
  .lane[hidden] {
    display: none;
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
    font-family: "Source Serif Pro", Georgia, "Times New Roman", serif;
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
    background: var(--color-card);
    color: var(--color-text-primary-default);
    box-shadow: 0 1px 3px rgba(10, 21, 49, .08);
    font-size: 14px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
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
  .share-card:focus-visible,
  .stat:focus-visible,
  .nav-btn:focus-visible,
  .nav-close:focus-visible {
    outline: 3px solid rgba(246, 62, 13, .36);
    outline-offset: 2px;
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
    border-radius: 8px;
    background: color-mix(in srgb, var(--product) 10%, var(--color-card));
    border: 1px solid color-mix(in srgb, var(--product) 20%, transparent);
    box-shadow: none;
    color: var(--product);
    font-size: 12px;
    font-weight: 600;
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
    border-radius: 8px;
    background: var(--color-card);
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
    border-radius: 8px;
    background: transparent;
    color: var(--color-icons-primary-default);
    cursor: pointer;
    font-size: 24px;
  }
  .nav-btn:disabled {
    cursor: default;
    opacity: .34;
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
  .shared-resource { display:block; padding:12px 0; color:var(--accent); overflow-wrap:anywhere; }
  .shared-resource img,.shared-resources video { display:block; max-width:100%; max-height:440px; border-radius:8px; margin-bottom:8px; }
  .detail-sections {
    display: grid;
    gap: 18px;
    margin-top: 22px;
  }
  .detail-section { min-width: 0; }
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
  @media (max-width: 767px) {
    .board-scroll { flex-direction: column; gap: 20px; }
    .lane { width: 100%; min-width: 0; }
  }
  @media (max-width: 1023px) {
    .detail-hero { grid-template-columns: 1fr; }
  }
  @media (max-width: 640px) {
    .board-root { padding: 16px; }
    .share-header-inner { padding-inline: 16px; }
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
  const productMeta = ${safeJson(PRODUCT_META)};
  let index = -1;
  let lastFocus = null;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function setMark(node, item) {
    const info = productMeta[item.product] || { short: '?', color: '#6c7892' };
    node.style.setProperty('--product', info.color);
    node.title = item.product;
    node.textContent = info.short;
  }

  function visibleIndexes() { return items.map((_, i) => i); }

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
    panel.style.setProperty('--roadmap-product-accent', productMeta[item.product]?.color || 'var(--color-icons-subtle-default)');
    meta.replaceChildren();
    if (item.planned) meta.append(el('span', '', 'Planned ' + item.planned));
    meta.append(el('span', '', item.stage));
    lede.hidden = !item.oneliner;
    lede.textContent = item.oneliner || '';

    const story = [];
    if (item.outcome) story.push({ heading: 'Target outcome', text: item.outcome });
    for (const section of item.sections || []) story.push(section);
    sections.replaceChildren(...story.map((section) => {
      const wrap = el('section', 'detail-section');
      const body = el('div');
      body.append(el('h3', '', section.heading), el('p', '', section.text));
      wrap.append(body);
      return wrap;
    }));
    if(item.resources?.length){
      const wrap=el('section','detail-section shared-resources');wrap.append(el('h3','','Resources'));
      for(const resource of item.resources){
        const link=el('a','shared-resource',resource.label);link.href=resource.href;link.target='_blank';link.rel='noopener noreferrer';
        if(resource.image || resource.mediaType?.startsWith('image/')){const img=el('img');img.src=resource.href;img.alt=resource.label;img.loading='lazy';img.referrerPolicy='no-referrer';link.prepend(img);}
        if(resource.mediaType?.startsWith('video/')){const video=el('video');video.src=resource.href;video.controls=true;video.preload='metadata';wrap.append(video);}
        wrap.append(link);
      }sections.append(wrap);
    }
    sections.hidden = story.length === 0 && !item.resources?.length;

    themes.replaceChildren(...(item.themes || []).map((theme) => el('span', 'chip theme-chip', theme)));
    themes.hidden = !item.themes?.length;
    count.textContent = (visiblePos + 1) + '/' + visible.length;
    prev.disabled = visiblePos === 0;
    next.disabled = visiblePos === visible.length - 1;
    cards.forEach((card) => card.classList.toggle('roadmap-card-active', Number(card.dataset.cardIndex) === index));
    panel.querySelector('.drawer-scroll').scrollTop = 0;
    if (!shell.hidden) title.focus();
  }

  function open(i) {
    lastFocus = document.activeElement;
    render(i);
    shell.hidden = false;
    document.body.classList.add('modal-open');
    requestAnimationFrame(() => { if (!shell.hidden) title.focus(); });
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
    if (event.key === 'Tab') {
      const controls = Array.from(panel.querySelectorAll('button:not(:disabled), a[href], [tabindex="0"]'));
      const first = controls[0];
      const last = controls[controls.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === title || active === panel || !panel.contains(active))) {
        event.preventDefault(); (last || panel).focus();
      } else if (!event.shiftKey && (active === last || active === title || active === panel || !panel.contains(active))) {
        event.preventDefault(); (first || panel).focus();
      }
      return;
    }
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.target.closest('button, a, input, select, textarea')) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') event.preventDefault();
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
  document.addEventListener('focusin', (event) => {
    if (!shell.hidden && !panel.contains(event.target)) title.focus();
  });
})();
`;
}


function renderSharedTimeline(settings: TimelineSettings & { range: TimelineRange }, items: ProjectedItem[]): string {
  // Owner names and internal tags are not part of the customer-facing projection.
  const privateGrouping = settings.group === 'owner' || settings.group === 'tag';
  const config = timelineSettings({ ...settings, group: privateGrouping ? 'product' : settings.group });
  const model = timelineModel(items, config, settings.range);
  const ticks = model.ticks.map(t => `<span class="timeline-tick" style="left:${t.left}%;width:${t.width}%">${escapeHtml(t.label)}</span>`).join('');
  const grid = model.ticks.map(t => `<span aria-hidden="true" class="timeline-tick" style="left:${t.left}%;width:${t.width}%"></span>`).join('');
  const groups = model.groups.map(group => `<details class="timeline-group" open><summary>${escapeHtml(group.name)}<small>${group.items.length} items</small></summary>${group.items.map(item => {
    const pos = model.position(item), index = items.indexOf(item);
    const color = PRODUCT_META[item.product]?.color ?? 'var(--color-accent-brand-default)';
    return `<div class="timeline-row"><button type="button" class="timeline-label" data-card-index="${index}"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.stage)} · ${escapeHtml(item.product)}</small></button><div class="timeline-track">${grid}<button type="button" class="timeline-bar" data-card-index="${index}" data-before="${pos.before}" data-after="${pos.after}" style="left:${pos.left}%;width:${pos.width}%;padding:${pos.width < 4 ? '0' : '0 10px'};font-size:${pos.width < 4 ? '0' : '12px'};--product:${color}" aria-label="${escapeHtml(item.title + '. Planned ' + scheduleLabel(item))}" title="${escapeHtml(scheduleLabel(item))}">${escapeHtml(item.title)}</button></div></div>`;
  }).join('')}</details>`).join('');
  const missing = model.missing.length ? `<details class="timeline-missing-shared"><summary data-timeline-missing>${model.missing.length} missing or invalid dates · Review</summary>${model.missing.map(item => `<p><button type="button" data-card-index="${items.indexOf(item)}">${escapeHtml(item.title)} · ${escapeHtml(scheduleIssue(item) ?? '')}</button></p>`).join('')}</details>` : '';
  const outside = model.outside.length ? `<details class="timeline-missing-shared"><summary data-timeline-outside>${model.outside.length} outside this period · Review</summary>${model.outside.map(item => `<p><button type="button" data-card-index="${items.indexOf(item)}">${escapeHtml(item.title)} · ${escapeHtml(scheduleLabel(item))}</button></p>`).join('')}</details>` : '';
  return `<section aria-label="Shared roadmap timeline"><p class="timeline-range-caption">${escapeHtml(formatPlanDate(model.range.from))} — ${escapeHtml(formatPlanDate(model.range.to))} · Planned work windows · <span data-timeline-counts>${items.length} matching · ${model.visible.length} in this period · ${model.outside.length} outside this period</span>${privateGrouping ? ' · Grouped by product for sharing' : ''}</p>${missing}${outside}<p data-timeline-empty${model.visible.length ? ' hidden' : ''}>No scheduled items in this period.</p>${model.visible.length ? `<div class="timeline-chart" tabindex="0" aria-label="Timeline chart"><div class="timeline-canvas"><div class="timeline-head"><div class="timeline-label">Roadmap item</div><div class="timeline-axis">${ticks}</div></div>${groups}</div></div>` : ''}</section>`;
}

export function renderShareHtml(context: ShareContext, items: ProjectedItem[]): string {
  const theme = context.theme ?? 'light';
  // Recipient views organize selected work by product, without internal horizon framing.
  const products = [...new Set(items.map(item => item.product))];
  const lanes = products.map(product => lane(product, items.filter(item => item.product === product), items)).join('');
  const title = escapeHtml(context.title);
  const description = shareDescription(context);
  const logo = escapeHtml(
    context.assets?.logo ??
      (context.assetBase ? assetUrl(context, '/brand/roadmap-logo.svg') : SHARE_ASSET_PATHS.logo),
  );
  const itemCount = items.length;

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
<link rel="icon" href="${ROADMAP_FAVICON}">
<style>${css(context)}\n${appearanceCss}\n${reviewCss}\n${timelineCss}</style></head>
<body>
<a class="skip-link" href="#main-content">Skip to roadmap</a>
<header class="share-header"><div class="share-header-inner">
  <span class="site-brand-tile"><img src="${logo}" alt="Product Roadmap" width="36" height="36"></span>
  <span>Roadmap</span><span class="share-header-caption">Shared view</span>
</div></header>
<main id="main-content" class="board-root" tabindex="-1">
  <section class="roadmap-masthead">
    <div class="hero-grid">
      <div>
        <p class="roadmap-label">Product roadmap</p>
        <h1 class="roadmap-display roadmap-title">${title}</h1>
        ${context.intro ? `<p class="roadmap-muted intro">${textWithBreaks(context.intro)}</p>` : `<p class="roadmap-muted intro">${DEFAULT_SHARE_DESCRIPTION}</p>`}
      </div>

    </div>
  </section>
  ${context.activitySummary ? `<p class="roadmap-muted" style="margin-bottom:1rem">${escapeHtml(context.activitySummary)}</p>` : ''}
  ${context.timeline ? renderSharedTimeline(context.timeline, items) : `<div class="roadmap-glass board-shell"><div class="board-scroll">${lanes}</div></div>`}
  <footer>
    <span>Shared from the product roadmap</span>
    <span>Shared ${escapeHtml(context.generatedAt)}</span>
    <span>${itemCount} item${itemCount === 1 ? '' : 's'}${context.timeline ? ' · Timeline' : ''}</span>
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
export function buildShareBundle(
  html: string,
  ogImage?: Uint8Array | ArrayBuffer,
  assets: Record<string, Uint8Array> = {},
): Blob {
  const files: Record<string, Uint8Array> = { ...assets, 'index.html': strToU8(html) };
  if (ogImage) {
    files[OG_IMAGE_FILENAME] = ogImage instanceof Uint8Array ? ogImage : new Uint8Array(ogImage);
  }
  const zipped = zipSync(files, { level: 6 });
  // Copy into a fresh ArrayBuffer so the Blob owns a clean, non-shared buffer.
  return new Blob([zipped.slice()], { type: 'application/zip' });
}
