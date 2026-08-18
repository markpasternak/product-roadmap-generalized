import { describe, it, expect } from 'vitest';
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
    expect(withAssets).toContain('url("https://roadmap.example/brand/accent-wash.svg")');
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

  it('uses the intro as the OG/twitter description when provided', () => {
    const withIntro = renderShareHtml({ ...ctx, intro: 'Framing text' }, [item]);
    expect(withIntro).toContain('<meta property="og:description" content="Framing text">');
    expect(withIntro).toContain('<meta name="twitter:description" content="Framing text">');
  });

  it('renders projected copy and the lane', () => {
    expect(html).toContain('A safe line');
    expect(html).toContain('Now');
    expect(html).toContain('Actively building');
    expect(html).toContain('product roadmap');
    expect(html).toContain('Podcasts &amp; Audiobooks — partner view');
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
