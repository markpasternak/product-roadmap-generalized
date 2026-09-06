import { ROADMAP_FAVICON } from '../brand';
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderShareHtml, escapeHtml } from './render';
import type { ProjectedItem } from './project';

const item: ProjectedItem = {
  id: 'TALK-1', title: 'Public <Title>', oneliner: 'A safe line', outcome: 'Win',
  product: 'Podcasts & Audiobooks', horizon: 'Now', stage: 'Building',
  tags: ['workflow'], themes: ['one-view'],
  sections: [{ heading: 'Why it matters', text: 'because' }],
};
const ctx = { title: 'Podcasts & Audiobooks — partner view', product: 'Podcasts & Audiobooks', generatedAt: '2026-07-05' };

describe('renderShareHtml', () => {
  const html = renderShareHtml(ctx, [item]);

  it('is an interactive document with no accidental external links by default', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('data-theme="light"');
    expect(html).toContain('<script type="application/json" id="roadmap-data">');
    expect(html).toContain('data-detail-shell');
    expect(html).not.toMatch(/\s(?:src|href)=["']https?:/i);
  });

  it('can use hosted roadmap brand assets for presentation parity', () => {
    const withAssets = renderShareHtml({ ...ctx, assetBase: 'https://roadmap.example' }, [item]);
    expect(withAssets).toContain('src="https://roadmap.example/brand/roadmap-logo.svg"');
  });

  it('uses bundled fonts and artwork without a dependency on the team roadmap', () => {
    expect(html).toContain('url("assets/SourceSerifPro-Regular.ttf")');
    expect(html).toContain('url("assets/Inter-Regular.woff2")');
    expect(html).toContain('url("assets/Inter-Medium.woff2")');
    expect(html).toContain('url("assets/Inter-SemiBold.woff2")');
    expect(html).toContain('src="assets/roadmap-logo.svg" alt="Product Roadmap"');
  });

  it('embeds the app’s current appearance and board styles in the standalone document', () => {
    for (const name of ['appearance', 'roadmap-review']) {
      const source = readFileSync(resolve('src/styles', `${name}.css`), 'utf8');
      expect(html.includes(source), `${name} CSS must be embedded without a separate stylesheet request`).toBe(true);
    }
  });

  it('carries OG/twitter preview meta pointing at the bundled OG card', () => {
    expect(html).toContain('<meta property="og:title" content="Podcasts &amp; Audiobooks — partner view">');
    expect(html).toContain('<meta property="og:type" content="website">');
    expect(html).toContain('<meta property="og:image" content="og-card.png">');
    expect(html).toContain('<meta property="og:image:width" content="1200">');
    expect(html).toContain('<meta property="og:image:height" content="630">');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(html).toContain('<meta name="twitter:image" content="og-card.png">');
    // Default description (no intro) — matches the fallback line used elsewhere.
    expect(html).toContain('A focused view of what is active, planned, and recently shipped.');
    // Bare filename, not an absolute URL back at the (auth-gated) roadmap origin.
    expect(html).not.toMatch(/og:image" content="https?:/);
  });

  it('uses the generic three-horizon product favicon', () => {
    expect(html).toContain(`<link rel="icon" href="${ROADMAP_FAVICON}">`);
    const svg = decodeURIComponent(ROADMAP_FAVICON.split(',')[1]);
    expect(svg).toContain('width="239"');
    expect(svg).toContain('width="172"');
    expect(svg).toContain('width="105"');
  });

  it('uses the intro as the OG/twitter description when provided', () => {
    const withIntro = renderShareHtml({ ...ctx, intro: 'Framing text' }, [item]);
    expect(withIntro).toContain('<meta property="og:description" content="Framing text">');
    expect(withIntro).toContain('<meta name="twitter:description" content="Framing text">');
  });

  it('renders projected copy and the lane', () => {
    expect(html).toContain('A safe line');
    expect(html).toContain('Now');
    expect(html).toContain('Current priorities');
    expect(html).toContain('product roadmap');
    expect(html).toContain('Podcasts &amp; Audiobooks — partner view');
  });

  it('renders the Ads Platform product mark in shared views', () => {
    const infraItem = { ...item, id: 'ADS-1', product: 'Ads Platform' };
    const infraHtml = renderShareHtml({ ...ctx, product: 'Ads Platform' }, [infraItem]);
    expect(infraHtml).toContain('var(--roadmap-product-ads-platform)');
    expect(infraHtml).toContain('title="Ads Platform">AP</span>');
  });

  it('does not add an unselected empty Completed lane to a baked roadmap', () => {
    expect(html).not.toContain('data-lane="Completed"');
    expect(html).not.toContain('Nothing shipped yet. Completed work lands here.');
  });

  it('preserves selected empty horizon lanes from the roadmap view', () => {
    const selectedLanes = renderShareHtml({ ...ctx, horizons: ['Now', 'Next', 'Later'] }, [item]);

    expect(selectedLanes).toContain('data-lane="Now"');
    expect(selectedLanes).toContain('data-lane="Next"');
    expect(selectedLanes).toContain('data-lane="Later"');
    expect(selectedLanes).not.toContain('data-lane="Completed"');
    expect(selectedLanes).toContain('data-horizon-filter="Next"');
    expect(selectedLanes).not.toContain('data-horizon-filter="Completed"');
    expect(selectedLanes).toContain('1 item across 3 lanes');
  });

  it('renders public horizon filters and lanes in canonical roadmap order', () => {
    const horizons = ['Candidates', 'Now', 'Next', 'Later', 'Completed'] as const;
    const items = horizons.map((horizon, index) => ({
      ...item,
      id: `TALK-${index + 1}`,
      horizon,
    }));
    const allHorizons = renderShareHtml({ ...ctx, horizons }, items);

    expect([...allHorizons.matchAll(/data-horizon-filter="([^"]+)"/g)].map((match) => match[1])).toEqual([
      'All',
      ...horizons,
    ]);
    expect([...allHorizons.matchAll(/data-lane="([^"]+)"/g)].map((match) => match[1])).toEqual([...horizons]);
  });

  it('renders presentation-style card actions and public detail copy', () => {
    expect(html).toContain('data-card-index="0"');
    expect(html).toContain('Open Public &lt;Title&gt;');
    expect(html).toContain('Target outcome');
    expect(html).toContain('Why it matters');
    expect(html).toContain('data-detail-prev');
    expect(html).toContain('data-detail-next');
  });

  it('can render a dark share', () => {
    expect(renderShareHtml({ ...ctx, theme: 'dark' }, [item])).toContain('data-theme="dark"');
  });

  it('renders the intro paragraph only when provided', () => {
    expect(html).not.toContain('Framing text');
    expect(renderShareHtml({ ...ctx, intro: 'Framing text' }, [item])).toContain('Framing text');
  });

  it('escapes HTML in item copy', () => {
    expect(html).toContain('Public &lt;Title&gt;');
    expect(html).not.toContain('<Title>');
  });

  it('contains no internal leakage for a projected set', () => {
    for (const needle of ['secret@', 'github.com', 'One-liner', 'editUrl', 'owner']) {
      expect(html).not.toContain(needle);
    }
  });
});

describe('escapeHtml', () => {
  it('escapes the five special chars', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });
});
