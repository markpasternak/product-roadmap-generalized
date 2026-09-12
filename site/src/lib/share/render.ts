// Serializes a projected board into a polished, standalone roadmap share app.
// The bundle keeps its behavior inline and carries its own brand assets.
// Recipients see the same horizon lanes and item statuses as the main roadmap.
import { timelineModel, timelineSettings, scheduleLabel, scheduleIssue, formatPlanDate, type TimelineSettings, type TimelineRange } from '../timeline';
import timelineCss from '../../styles/timeline.css?raw';
import { zipSync, strToU8 } from 'fflate';
import { ROADMAP_FAVICON } from '../brand';
import reviewCss from '../../styles/roadmap-review.css?raw';
import appearanceCss from '../../styles/appearance.css?raw';
import { SHARE_ASSET_PATHS, type ShareAssetUrls } from './assets';
import type { ProjectedItem } from './project';
import { isStoryHeading, sectionLabel } from '../sectionHeadings';
import { installItemImageViewer } from '../itemImageViewer';
import imageViewerCss from '../../styles/image-viewer.css?raw';
import { HORIZONS, PRODUCTS, type Horizon } from '../schema';
import type { SortKey } from '../filters';
import { createItemViewPreference } from '../itemViewPreference';
import readingToolbarCss from '../../styles/reading-toolbar.css?raw';
import titleTooltipCss from '../../styles/title-tooltips.css?raw';
import { installTitleTooltips } from '../titleTooltips';
import { installItemToc } from '../itemToc';
import { installItemHeader } from '../itemHeader';
import itemTocCss from '../../styles/item-toc.css?raw';

export type ShareTheme = 'light' | 'dark';

/** Preserve originally empty lanes, but remove lanes whose items were all deselected. */
export function selectedShareHorizons(
  horizons: readonly string[] | undefined,
  available: readonly Pick<ProjectedItem, 'horizon'>[],
  selected: readonly Pick<ProjectedItem, 'horizon'>[],
): Horizon[] {
  const availableHorizons = new Set(available.map(item => item.horizon));
  const selectedHorizons = new Set(selected.map(item => item.horizon));
  return HORIZONS.filter(horizon => selectedHorizons.has(horizon)
    || (!!horizons?.includes(horizon) && !availableHorizons.has(horizon)));
}

export interface ShareContext {
  timeline?: TimelineSettings & { range: TimelineRange };
  title: string;
  /** Optional framing paragraph shown under the header. */
  intro?: string;
  product: string | null;
  /** Board grouping captured from the publisher's current view. */
  group?: 'horizon' | 'product';
  /** Included for an explicit, inspectable snapshot contract; items arrive pre-sorted. */
  sort?: SortKey;
  reverseLanes?: boolean;
  showCovers?: boolean;
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
function safeResourceUrl(href: string): boolean {
  return /^(?:https?:\/\/|assets\/ast_[a-z0-9_-]+\/rev_[a-z0-9_-]+\/[A-Za-z0-9_.-]+$|data:(?:image\/(?:png|jpeg|gif|webp|avif|svg\+xml)|video\/(?:mp4|webm)|application\/(?:pdf|zip|vnd\.openxmlformats-officedocument\.(?:wordprocessingml\.document|presentationml\.presentation|spreadsheetml\.sheet))|text\/plain)(?:; ?charset=utf-8)?;base64,)/i.test(href);
}

function statusLabel(item: Pick<ProjectedItem, 'horizon' | 'stage'>): string {
  return item.horizon === 'Completed' ? 'Completed' : [item.horizon, item.stage].filter(Boolean).join(' · ');
}

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

function shareItemData(items: ProjectedItem[]) {
  return items.map((it) => ({
    planned: scheduleLabel(it),
    id: it.id,
    title: it.title,
    oneliner: it.oneliner,
    outcome: it.outcome,
    product: it.product,
    stage: it.stage,
    horizon: it.horizon,
    status: statusLabel(it),
    ...(it.cover && safeResourceUrl(it.cover) ? { cover: it.cover, coverPosition: /^(?:100|\d{1,2})% (?:100|\d{1,2})%$/.test(it.coverPosition ?? '') ? it.coverPosition : '50% 50%' } : {}),
    themes: [...it.themes],
    resources: (it.resources ?? [])
      .filter((r) => safeResourceUrl(r.href))
      .map((r) => ({ label: r.label, href: r.href, mediaType: r.mediaType, bytes: r.bytes, sha256: r.sha256, image: r.image, inline: r.inline })),
    sections: it.sections
      .filter((section) => isStoryHeading(section.heading))
      .map((section) => ({
        heading: sectionLabel(section.heading), text: section.text,
        ...(section.blocks ? { blocks: section.blocks.filter(block => !('image' in block) || safeResourceUrl(block.image.href)) } : {}),
      })),
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

function productMark(product: string): string {
  const info = PRODUCT_META[product] ?? { short: '?', color: 'var(--roadmap-ink-muted)' };
  return `<span class="product-mark" style="--product:${info.color};font-size:${info.short.length > 1 ? 12 : 15}px" title="${escapeHtml(product)}" role="img" aria-label="${escapeHtml(product)}"><span aria-hidden="true">${escapeHtml(info.short)}</span></span>`;
}

function card(it: ProjectedItem, index: number, showProduct: boolean, showHorizon: boolean, showCover: boolean): string {
  const cover = showCover && it.cover && safeResourceUrl(it.cover)
    ? `<span class="share-card-cover" aria-hidden="true"><img src="${escapeHtml(it.cover)}" alt="" loading="lazy" decoding="async" style="object-position:${/^(?:100|\d{1,2})% (?:100|\d{1,2})%$/.test(it.coverPosition ?? '') ? it.coverPosition : '50% 50%'}"><span></span></span>`
    : '';
  return `<button type="button" class="roadmap-card roadmap-product-card roadmap-action share-card${it.horizon === 'Completed' ? ' share-card-completed' : ''}" style="--roadmap-product-accent:${PRODUCT_META[it.product]?.color || 'var(--roadmap-ink-muted)'}" data-card-index="${index}" aria-label="Open ${escapeHtml(it.title)}${showProduct ? `, ${escapeHtml(it.product)}` : ''}">
    <span class="card-open" aria-hidden="true">↗</span>
    ${cover}
    <div class="card-main">
      ${showProduct ? productMark(it.product) : ''}
      <div class="card-copy">
        <h3 data-title-tooltip="${escapeHtml(it.title)}">${escapeHtml(it.title)}</h3>
        ${it.oneliner ? `<p>${escapeHtml(it.oneliner)}</p>` : ''}
      </div>
    </div>
    ${showHorizon || (it.horizon !== 'Completed' && it.stage) ? `<div class="card-meta">
      ${showHorizon ? `<span class="roadmap-quiet-chip stage-chip" data-horizon="${escapeHtml(it.horizon)}">${escapeHtml(it.horizon)}</span>` : ''}
      ${it.horizon !== 'Completed' && it.stage ? `<span class="roadmap-quiet-chip stage-chip"${showHorizon ? '' : ` data-horizon="${escapeHtml(it.horizon)}"`}>${escapeHtml(it.stage)}</span>` : ''}
    </div>` : ''}
    ${scheduleLabel(it) ? `<p class="timeline-range-caption">Planned ${escapeHtml(scheduleLabel(it))}</p>` : ''}
  </button>`;
}

function lane(name: string, laneItems: ProjectedItem[], allItems: ProjectedItem[], group: 'horizon' | 'product', showCovers: boolean): string {
  const accent = group === 'product'
    ? PRODUCT_META[name]?.color ?? 'var(--roadmap-ink-muted)'
    : `var(--roadmap-horizon-${name.toLowerCase()})`;
  const showProduct = group === 'horizon' && new Set(allItems.map(item => item.product)).size > 1;
  return `<section class="lane" data-lane="${escapeHtml(name)}" style="--lane-accent:${accent}">
    <header class="lane-head">
      <div class="lane-title-row">
        <span class="lane-bar" aria-hidden="true"></span>
        <h2>${escapeHtml(name)}</h2>
        <span class="lane-count">${laneItems.length}</span>
      </div>
      <div class="lane-rule"></div>
    </header>
    <div class="lane-cards">${laneItems.length ? laneItems.map((it) => card(it, allItems.indexOf(it), showProduct, group === 'product', showCovers)).join('') : '<p class="lane-empty">No items in this lane.</p>'}</div>
  </section>`;
}

function controlIcon(path: string): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
}

function detailShell(): string {
  return `<div class="detail-shell" data-detail-shell hidden>
    <div class="drawer-scrim detail-scrim" data-detail-close></div>
    <aside class="drawer-panel roadmap-field roadmap-drawer-field roadmap-product-detail" data-detail-panel role="dialog" aria-modal="true" aria-labelledby="detail-title" tabindex="-1">
      <div class="item-toolbar">
        <span class="item-toolbar-title"><span class="item-product-accent"></span><span class="item-toolbar-copy"><span class="item-header-product" id="detail-product"></span><span class="item-header-title" data-header-title aria-hidden="true" id="detail-header-title"></span></span></span>
        <div class="item-toolbar-controls">
          <div class="item-control-group" role="group" aria-label="Item navigation">
            <button type="button" class="item-control" data-detail-prev aria-label="Previous item" title="Previous item">${controlIcon('m14 6-6 6 6 6')}</button>
            <span class="item-control-count" id="detail-count"></span>
            <button type="button" class="item-control" data-detail-next aria-label="Next item" title="Next item">${controlIcon('m10 6 6 6-6 6')}</button>
          </div>
          <span class="item-control-divider" aria-hidden="true"></span>
          <button type="button" class="item-control" data-detail-copy aria-label="Copy item link" title="Copy item link">${controlIcon('M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2')}</button>
          <button type="button" class="item-control" data-detail-expand aria-label="Expand item" aria-expanded="false" title="Expand item"><span data-expand-icon>${controlIcon('M9 4H4v5m11-5h5v5M4 15v5h5m6 0h5v-5')}</span><span data-collapse-icon hidden>${controlIcon('M4 9h5V4m6 0v5h5M4 15h5v5m6 0v-5h5')}</span></button>
          <button type="button" class="item-control item-close-control" data-detail-close aria-label="Close" title="Close item">${controlIcon('m6 6 12 12M6 18 18 6')}</button>
        </div>
      </div>
      <div class="drawer-scroll" data-reading-scroll>
        <div class="drawer-content" data-detail-content>
          <p data-copy-status role="status" hidden></p>
          <input data-copy-fallback aria-label="Item link; select and copy" readonly hidden />
          <header class="detail-masthead" data-detail-masthead>
            <div class="detail-cover-media" data-detail-cover aria-hidden="true" hidden><img data-detail-cover-image alt="" decoding="async"><span></span></div>
            <div class="detail-masthead-copy"><h2 class="roadmap-display roadmap-title detail-title" id="detail-title" data-reading-title tabindex="-1" aria-live="polite"></h2></div>
          </header>
          <dl class="detail-status-summary">
            <div><dt>Horizon</dt><dd><span class="detail-status-dot"></span><span id="detail-horizon"></span></dd></div>
            <div data-detail-stage><dt>Stage</dt><dd id="detail-stage"></dd></div>
            <div data-detail-plan hidden><dt>Plan</dt><dd id="detail-plan"></dd></div>
          </dl>
          <div class="detail-reading-grid" data-reading-layout>
            <div data-reading-body>
              <p class="detail-lede" id="detail-lede"></p>
              <div class="detail-sections" id="detail-sections"></div>
              <div class="detail-themes" id="detail-themes"></div>
            </div>
            <nav class="item-toc" data-item-toc aria-label="On this page" hidden></nav>
          </div>
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
    padding: 12px 24px;
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
    overflow: hidden;
  }
  .share-card-cover {
    position: relative;
    display: block;
    height: 88px;
    margin: -14px -14px 14px;
    overflow: hidden;
    background: color-mix(in srgb, var(--roadmap-product-accent) 18%, var(--color-surface-subtle-default));
  }
  .share-card-cover img,
  .share-card-cover span { position:absolute;inset:0;width:100%;height:100%; }
  .share-card-cover img { object-fit:cover;filter:saturate(.84) contrast(.94); }
  .share-card-cover span { background:linear-gradient(to bottom,transparent 46%,color-mix(in srgb,var(--color-card) 92%,transparent)),color-mix(in srgb,var(--roadmap-product-accent) 12%,transparent); }
  [data-theme="dark"] .share-card-cover img { filter:brightness(.76) saturate(.72) contrast(.92); }
  [data-theme="dark"] .share-card-cover span { background:linear-gradient(to bottom,transparent 42%,color-mix(in srgb,var(--color-card) 96%,transparent)),color-mix(in srgb,var(--roadmap-product-accent) 18%,transparent); }
  .share-card-completed .share-card-cover img { filter:grayscale(.7) saturate(.35); }
  .share-card:focus-visible,
  .stat:focus-visible {
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
  .drawer-accent {
    width: 4px;
    height: 16px;
    border-radius: 999px;
    background: var(--color-accent-brand-default);
  }
  .detail-shell.is-expanded { padding: 0; }
  .detail-shell.is-expanded .drawer-panel { width: 100%; height: 100dvh; max-height: 100dvh; border-radius: 0; }
  .detail-shell.is-expanded .drawer-content { max-width: 1200px; margin-inline: auto; padding-top: 12px; }
  .detail-shell.is-expanded .detail-section p { max-width: 75ch; }
  [data-copy-fallback] { width: 100%; padding: 8px; margin-bottom: 12px; }
  .drawer-scroll {
    flex: 1;
    overflow-y: auto;
  }
  .drawer-content {
    padding: 12px 24px 24px;
  }
  .detail-masthead { position:relative; padding:10px 0 18px; overflow:hidden; }
  .detail-masthead.has-cover { display:flex; min-height:210px; margin:-12px -24px 0; padding:28px 24px 22px; align-items:flex-end; isolation:isolate; }
  .detail-cover-media,.detail-cover-media img,.detail-cover-media span { position:absolute; inset:0; width:100%; height:100%; }
  .detail-cover-media { z-index:-1; overflow:hidden; background:color-mix(in srgb,var(--roadmap-product-accent) 18%,var(--color-surface-subtle-default)); }
  .detail-cover-media[hidden] { display:none; }
  .detail-cover-media img { object-fit:cover; filter:saturate(.82) contrast(.94); }
  .detail-cover-media span { background:linear-gradient(to top,var(--color-card) 0%,color-mix(in srgb,var(--color-card) 96%,transparent) 18%,color-mix(in srgb,var(--color-card) 62%,transparent) 52%,color-mix(in srgb,var(--color-card) 14%,transparent) 100%),color-mix(in srgb,var(--roadmap-product-accent) 14%,transparent); }
  [data-theme="dark"] .detail-cover-media img { filter:brightness(.7) saturate(.68) contrast(.92); }
  [data-theme="dark"] .detail-cover-media span { background:linear-gradient(to top,var(--color-card) 0%,color-mix(in srgb,var(--color-card) 97%,transparent) 20%,color-mix(in srgb,var(--color-card) 68%,transparent) 54%,color-mix(in srgb,var(--color-card) 20%,transparent) 100%),color-mix(in srgb,var(--roadmap-product-accent) 20%,transparent); }
  .detail-masthead.is-completed .detail-cover-media img { filter:grayscale(.28) saturate(.65) contrast(.94); }
  [data-theme="dark"] .detail-masthead.is-completed .detail-cover-media img { filter:brightness(.72) grayscale(.3) saturate(.52) contrast(.92); }
  .detail-masthead-copy { position:relative; width:100%; max-width:960px; }
  .detail-title {
    margin: 0;
    max-width:30ch;
    font-size: clamp(1.75rem, 3vw, 2.5rem);
    line-height:1.06;
  }
  .detail-status-summary { display:flex; flex-wrap:wrap; gap:10px clamp(24px,4vw,48px); margin:0; padding:14px 0; border-bottom:1px solid var(--color-border-subtle-default); }
  .detail-status-summary dt { color:var(--color-text-subtle-default); font-size:11px; font-weight:600; line-height:1.3; }
  .detail-status-summary dd { display:flex; align-items:center; gap:7px; margin:4px 0 0; color:var(--color-text-primary-default); font-size:14px; font-weight:600; line-height:1.35; }
  .detail-status-dot { width:4px; height:16px; border-radius:999px; background:var(--roadmap-product-accent); }
  .detail-reading-grid { margin-top:20px; }
  .detail-lede {
    max-width: 64rem;
    margin: 0;
    color: var(--color-text-primary-default);
    font-size: 1rem;
    line-height: 1.7;
  }
  .shared-resource { display:block; padding:12px 0; color:var(--accent); overflow-wrap:anywhere; }
  .shared-resource img,.shared-resources video { display:block; max-width:100%; max-height:440px; border-radius:8px; margin-bottom:8px; }
  .shared-inline-image { display:block; margin:18px 0; }
  .shared-inline-image img { display:block; width:100%; height:auto; border-radius:8px; }
  .stage-chip[data-horizon="Completed"] { color:var(--color-feedback-success-text-independent-default, #187047); background:var(--color-surface-transparent-green-25, #e8f5ed); }
  .detail-sections {
    display: grid;
    gap: 18px;
    margin-top: 22px;
  }
  .detail-section { min-width: 0; }
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
    margin-top: 12px;
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
    .detail-masthead.has-cover { min-height:190px; }
  }
  @media (max-width: 640px) {
    .board-root { padding: 16px; }
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
    .drawer-content { padding-inline: 16px; }
    .detail-masthead.has-cover { min-height:165px; margin-inline:-16px; padding:24px 16px 18px; }
    .detail-title { font-size:clamp(1.7rem,8vw,2.1rem); }
    .detail-status-summary { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); }
  }
  @media (prefers-reduced-motion: reduce) {
    html { scroll-behavior: auto; }
    .roadmap-action,
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
  const masthead = document.querySelector('[data-detail-masthead]');
  const cover = document.querySelector('[data-detail-cover]');
  const coverImage = document.querySelector('[data-detail-cover-image]');
  const horizon = document.getElementById('detail-horizon');
  const stageGroup = document.querySelector('[data-detail-stage]');
  const stage = document.getElementById('detail-stage');
  const plan = document.querySelector('[data-detail-plan]');
  const planValue = document.getElementById('detail-plan');
  const lede = document.getElementById('detail-lede');
  const sections = document.getElementById('detail-sections');
  const themes = document.getElementById('detail-themes');
  const count = document.getElementById('detail-count');
  const prev = document.querySelector('[data-detail-prev]');
  const next = document.querySelector('[data-detail-next]');
  const cards = Array.from(document.querySelectorAll('[data-card-index]'));
  (${installTitleTooltips.toString()})(document.querySelector('main'));
  const imageViewer = (${installItemImageViewer.toString()})(panel);
  const itemToc = (${installItemToc.toString()})(panel);
  const itemHeader = (${installItemHeader.toString()})(panel);
  const expand = document.querySelector('[data-detail-expand]');
  const viewPreference = (${createItemViewPreference.toString()})();
  const copyStatus = document.querySelector('[data-copy-status]');
  const copyFallback = document.querySelector('[data-copy-fallback]');
  const productMeta = ${safeJson(PRODUCT_META)};
  let index = -1;
  let lastFocus = null;

  function setExpanded(expanded) {
    shell.classList.toggle('is-expanded', expanded);
    expand.setAttribute('aria-expanded', String(expanded));
    expand.setAttribute('aria-label', expanded ? 'Collapse item' : 'Expand item');
    expand.title = expanded ? 'Collapse item' : 'Expand item';
    expand.querySelector('[data-expand-icon]').hidden = expanded;
    expand.querySelector('[data-collapse-icon]').hidden = !expanded;
  }

  function updateHeader() {
    product.textContent = items[index].product;
    const headerTitle = document.getElementById('detail-header-title');
    headerTitle.textContent = items[index].title;
    headerTitle.title = items[index].title;
    itemHeader.refresh();
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function visibleIndexes() { return [...new Set(cards.map(card => Number(card.dataset.cardIndex)))]; }

  function render(i) {
    if (!items.length || !shell || !panel) return;
    imageViewer.close();
    copyStatus.hidden = true;
    copyFallback.hidden = true;
    index = Math.max(0, Math.min(items.length - 1, i));
    const visible = visibleIndexes();
    if (!visible.includes(index)) index = visible[0] ?? index;
    const visiblePos = Math.max(0, visible.indexOf(index));
    const item = items[index];
    title.textContent = item.title;
    updateHeader();
    panel.style.setProperty('--roadmap-product-accent', productMeta[item.product]?.color || 'var(--color-icons-subtle-default)');
    const hasCover = !!item.cover;
    masthead.classList.toggle('has-cover', hasCover);
    masthead.classList.toggle('is-completed', item.horizon === 'Completed');
    cover.hidden = !hasCover;
    if (hasCover) {
      coverImage.src = item.cover;
      coverImage.style.objectPosition = item.coverPosition || '50% 50%';
    } else coverImage.removeAttribute('src');
    horizon.textContent = item.horizon;
    horizon.previousElementSibling.style.background = 'var(--roadmap-horizon-' + item.horizon.toLowerCase() + ')';
    stageGroup.hidden = item.horizon === 'Completed';
    stage.textContent = item.horizon === 'Completed' ? '' : item.stage;
    plan.hidden = !item.planned;
    planValue.textContent = item.planned || '';
    lede.hidden = !item.oneliner;
    lede.textContent = item.oneliner || '';

    const story = [];
    if (item.outcome) story.push({ heading: 'Target outcome', text: item.outcome });
    for (const section of item.sections || []) story.push(section);
    sections.replaceChildren(...story.map((section) => {
      const wrap = el('section', 'detail-section');
      const body = el('div');
      body.append(el('h3', 'roadmap-section-heading', section.heading));
      for (const block of section.blocks || [{ text: section.text }]) {
        if (block.image) {
          const link = el('a', 'shared-inline-image');
          link.href = block.image.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
          const img = el('img'); img.src = block.image.href; img.alt = block.image.label;
          img.loading = 'lazy'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
          link.append(img); body.append(link);
        } else body.append(el('p', '', block.text));
      }
      wrap.append(body);
      return wrap;
    }));
    const attachments = (item.resources || []).filter(resource => !resource.inline);
    if(attachments.length){
      const wrap=el('section','detail-section shared-resources');wrap.append(el('h3','roadmap-section-heading','Resources'));
      for(const resource of attachments){
        const link=el('a','shared-resource',resource.label);link.href=resource.href;link.target='_blank';link.rel='noopener noreferrer';
        if(resource.image || resource.mediaType?.startsWith('image/')){const img=el('img');img.src=resource.href;img.alt=resource.label;img.loading='lazy';img.referrerPolicy='no-referrer';link.prepend(img);}
        if(resource.mediaType?.startsWith('video/')){const video=el('video');video.src=resource.href;video.controls=true;video.preload='metadata';wrap.append(video);}
        wrap.append(link);
      }sections.append(wrap);
    }
    sections.hidden = story.length === 0 && !item.resources?.length;
    imageViewer.refresh();
    itemToc.refresh();

    themes.replaceChildren(...(item.themes || []).map((theme) => el('span', 'chip theme-chip', theme)));
    themes.hidden = !item.themes?.length;
    count.textContent = (visiblePos + 1) + '/' + visible.length;
    prev.disabled = visiblePos === 0;
    next.disabled = visiblePos === visible.length - 1;
    cards.forEach((card) => card.classList.toggle('roadmap-card-active', Number(card.dataset.cardIndex) === index));
    panel.querySelector('.drawer-scroll').scrollTop = 0;
    if (!shell.hidden) title.focus();
  }

  function writeUrl(push = false) {
    if (!/^https?:$/.test(location.protocol)) return;
    const url = new URL(location.href);
    if (shell.hidden) url.searchParams.delete('item');
    else url.searchParams.set('item', items[index].id);
    if (url.href !== location.href) history[push ? 'pushState' : 'replaceState'](null, '', url.href);
  }

  function open(i, updateUrl = true) {
    const wasClosed = shell.hidden;
    if (wasClosed) {
      lastFocus = document.activeElement;
      setExpanded(viewPreference.read());
    }
    render(i);
    shell.hidden = false;
    document.body.classList.add('modal-open');
    if (updateUrl) writeUrl(wasClosed);
    requestAnimationFrame(() => { if (!shell.hidden) title.focus(); });
  }

  function close(updateUrl = true) {
    if (!shell || shell.hidden) return;
    imageViewer.close();
    shell.hidden = true;
    document.body.classList.remove('modal-open');
    if (updateUrl) writeUrl();
    lastFocus?.focus?.();
  }

  function readUrl() {
    const id = new URL(location.href).searchParams.get('item');
    const i = items.findIndex(item => item.id === id);
    const notice = document.querySelector('[data-item-link-notice]');
    notice.hidden = !id || i >= 0;
    if (i >= 0) open(i, false); else close(false);
  }
  window.addEventListener('popstate', readUrl);

  document.addEventListener('click', (event) => {
    if (event.target.closest('.item-image-viewer')) return;
    const card = event.target.closest('[data-card-index]');
    if (card) open(Number(card.dataset.cardIndex));
    if (event.target.closest('[data-detail-close]')) close();
    if (event.target.closest('[data-detail-expand]')) {
      const expanded = !shell.classList.contains('is-expanded');
      setExpanded(expanded);
      viewPreference.write(expanded);
      updateHeader();
    }
    if (event.target.closest('[data-detail-copy]')) {
      const copiedId = items[index].id;
      const url = new URL(location.href);
      url.searchParams.set('item', copiedId);
      const fallback = () => {
        if (shell.hidden || items[index].id !== copiedId) return;
        copyStatus.hidden = false;
        copyStatus.textContent = 'Select and copy the item link below.';
        copyFallback.hidden = false; copyFallback.value = url.href; copyFallback.focus(); copyFallback.select();
      };
      if (!/^https?:$/.test(location.protocol)) { copyStatus.hidden = false; copyStatus.textContent = 'Publish the share to copy an item link.'; }
      else if (!navigator.clipboard?.writeText) fallback();
      else navigator.clipboard.writeText(url.href).then(() => {
        if (shell.hidden || items[index].id !== copiedId) return;
        copyStatus.hidden = false; copyStatus.textContent = 'Item link copied.';
      }).catch(fallback);
    }
    if (event.target.closest('[data-detail-prev]')) {
      const visible = visibleIndexes();
      const pos = visible.indexOf(index);
      if (pos > 0) { render(visible[pos - 1]); writeUrl(); }
    }
    if (event.target.closest('[data-detail-next]')) {
      const visible = visibleIndexes();
      const pos = visible.indexOf(index);
      if (pos >= 0 && pos < visible.length - 1) { render(visible[pos + 1]); writeUrl(); }
    }
  });

  document.addEventListener('keydown', (event) => {
    if (!shell || shell.hidden) return;
    if (event.key === 'Tab') {
      const controls = Array.from(panel.querySelectorAll('button:not(:disabled), a[href], input:not([hidden]), [tabindex="0"]')).filter(control => !control.closest('dialog:not([open]), [hidden]'));
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
      if (pos > 0) { render(visible[pos - 1]); writeUrl(); }
    }
    if (event.key === 'ArrowRight') {
      const visible = visibleIndexes();
      const pos = visible.indexOf(index);
      if (pos >= 0 && pos < visible.length - 1) { render(visible[pos + 1]); writeUrl(); }
    }
  });
  document.addEventListener('focusin', (event) => {
    if (!shell.hidden && !panel.contains(event.target)) title.focus();
  });
  readUrl();
})();
`;
}


function renderSharedTimeline(settings: TimelineSettings & { range: TimelineRange }, items: ProjectedItem[], reverseGroups = false): string {
  // Owner names and internal tags are not part of the customer-facing projection.
  const privateGrouping = settings.group === 'owner' || settings.group === 'tag';
  const config = timelineSettings({ ...settings, group: privateGrouping ? 'product' : settings.group });
  const model = timelineModel(items, config, settings.range);
  const ticks = model.ticks.map(t => `<span class="timeline-tick" style="left:${t.left}%;width:${t.width}%">${escapeHtml(t.label)}</span>`).join('');
  const grid = model.ticks.map(t => `<span aria-hidden="true" class="timeline-tick" style="left:${t.left}%;width:${t.width}%"></span>`).join('');
  const visibleGroups = reverseGroups ? [...model.groups].reverse() : model.groups;
  const groups = visibleGroups.map(group => `<details class="timeline-group" open><summary>${escapeHtml(group.name)}<small>${group.items.length} items</small></summary>${group.items.map(item => {
    const pos = model.position(item), index = items.indexOf(item);
    const color = PRODUCT_META[item.product]?.color ?? 'var(--color-accent-brand-default)';
    return `<div class="timeline-row"><button type="button" class="timeline-label" data-card-index="${index}"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(statusLabel(item))} · ${escapeHtml(item.product)}</small></button><div class="timeline-track">${grid}<button type="button" class="timeline-bar" data-card-index="${index}" data-before="${pos.before}" data-after="${pos.after}" style="left:${pos.left}%;width:${pos.width}%;padding:${pos.width < 4 ? '0' : '0 10px'};font-size:${pos.width < 4 ? '0' : '12px'};--product:${color}" aria-label="${escapeHtml(item.title + '. Planned ' + scheduleLabel(item))}" title="${escapeHtml(scheduleLabel(item))}">${escapeHtml(item.title)}</button></div></div>`;
  }).join('')}</details>`).join('');
  const missing = model.missing.length ? `<details class="timeline-missing-shared"><summary data-timeline-missing>${model.missing.length} missing or invalid dates · Review</summary>${model.missing.map(item => `<p><button type="button" data-card-index="${items.indexOf(item)}">${escapeHtml(item.title)} · ${escapeHtml(scheduleIssue(item) ?? '')}</button></p>`).join('')}</details>` : '';
  const outside = model.outside.length ? `<details class="timeline-missing-shared"><summary data-timeline-outside>${model.outside.length} outside this period · Review</summary>${model.outside.map(item => `<p><button type="button" data-card-index="${items.indexOf(item)}">${escapeHtml(item.title)} · ${escapeHtml(scheduleLabel(item))}</button></p>`).join('')}</details>` : '';
  return `<section aria-label="Shared roadmap timeline"><p class="timeline-range-caption">${escapeHtml(formatPlanDate(model.range.from))} — ${escapeHtml(formatPlanDate(model.range.to))} · Planned work windows · <span data-timeline-counts>${items.length} matching · ${model.visible.length} in this period · ${model.outside.length} outside this period</span>${privateGrouping ? ' · Grouped by product for sharing' : ''}</p>${missing}${outside}<p data-timeline-empty${model.visible.length ? ' hidden' : ''}>No scheduled items in this period.</p>${model.visible.length ? `<div class="timeline-chart" tabindex="0" aria-label="Timeline chart"><div class="timeline-canvas"><div class="timeline-head"><div class="timeline-label">Roadmap item</div><div class="timeline-axis">${ticks}</div></div>${groups}</div></div>` : ''}</section>`;
}

export function renderShareHtml(context: ShareContext, items: ProjectedItem[]): string {
  const theme = context.theme ?? 'light';
  const group = context.group ?? 'horizon';
  let laneNames: readonly string[];
  if (group === 'product') {
    const includedProducts = new Set(items.map(item => item.product));
    laneNames = PRODUCTS.filter(product => includedProducts.has(product));
  } else {
    // Keep selected empty lanes, and never omit included work if the selection is stale.
    const selectedHorizons = new Set([...(context.horizons ?? []), ...items.map(item => item.horizon)]);
    laneNames = HORIZONS.filter(horizon => selectedHorizons.has(horizon));
  }
  if (context.reverseLanes) laneNames = [...laneNames].reverse();
  const lanes = laneNames
    .map(name => lane(name, items.filter(item => group === 'product' ? item.product === name : item.horizon === name), items, group, context.showCovers !== false)).join('');
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
<style>${css(context)}\n${appearanceCss}\n${reviewCss}\n${timelineCss}\n${imageViewerCss}\n${readingToolbarCss}\n${titleTooltipCss}\n${itemTocCss}</style></head>
<body>
<a class="skip-link" href="#main-content">Skip to roadmap</a>
<main id="main-content" class="board-root shared-roadmap" tabindex="-1">
  <p data-item-link-notice role="status" hidden>This initiative is not included in this shared roadmap. Browse the available initiatives below.</p>
  <section class="roadmap-masthead">
    <span class="site-brand-tile"><img src="${logo}" alt="Product Roadmap" width="36" height="36"></span>
    <div class="hero-grid">
      <div>
        <h1 class="roadmap-display roadmap-title">${title}</h1>
        ${context.intro ? `<p class="roadmap-muted intro">${textWithBreaks(context.intro)}</p>` : `<p class="roadmap-muted intro">${DEFAULT_SHARE_DESCRIPTION}</p>`}
      </div>

    </div>
  </section>
  ${context.activitySummary ? `<p class="roadmap-muted" style="margin-bottom:1rem">${escapeHtml(context.activitySummary)}</p>` : ''}
  ${context.timeline ? renderSharedTimeline(context.timeline, items, context.reverseLanes) : `<div class="roadmap-glass board-shell"><div class="board-scroll">${lanes}</div></div>`}
  <footer>
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
