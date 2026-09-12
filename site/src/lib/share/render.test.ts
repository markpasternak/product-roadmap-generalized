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
  it('shows roadmap status and makes completion take precedence over a stale stage', () => {
    const html = renderShareHtml(ctx, [item, { ...item, id: 'TALK-done', horizon: 'Completed', stage: 'Building' }]);
    expect(html).toContain('Now · Building');
    expect(html).not.toMatch(/data-horizon="Completed">/);
    expect(html).toMatch(/data-horizon="Now">\s*Building\s*<\/span>/);
    expect(html).not.toContain('Completed · Building');
  });

  it('keeps scope aliases and Bottom line, but rejects executable inline image URLs', () => {
    const html = renderShareHtml(ctx, [{ ...item, sections: [
      { heading: 'What shipped', text: 'Done', blocks: [{ image: { href: 'javascript:alert(1)', label: 'Unsafe' } }, { text: 'Done' }] },
      { heading: 'Bottom line', text: 'Complete' },
      { heading: 'In the codebase', text: 'Private note' },
    ] }]);
    const data = JSON.parse(html.match(/id="roadmap-data">([\s\S]*?)<\/script>/)![1]);
    expect(data[0].sections).toEqual([{ heading: 'Scope', text: 'Done', blocks: [{ text: 'Done' }] }, { heading: 'Bottom line', text: 'Complete' }]);
    expect(html).not.toContain('javascript:alert');
    expect(html).not.toContain('Private note');
  });

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
    expect(html).toContain('data-lane="Now"');
    expect(html).not.toContain('data-horizon-filter="Now"');
    expect(html).not.toContain('Shared from the Product Roadmap roadmap');
    expect(html).not.toContain('Shared view');
    expect(html).not.toContain('<p class="roadmap-label">Product roadmap</p>');
    expect(html).toContain('Podcasts &amp; Audiobooks — partner view');
  });

  it('renders frozen cover images by default and honors the shared view toggle', () => {
    const covered = { ...item, cover: 'assets/ast_one/rev_one/cover.png', coverPosition: '40% 65%' };
    const shown = renderShareHtml(ctx, [covered]);
    expect(shown).toContain('class="share-card-cover"');
    expect(shown).toContain('object-position:40% 65%');
    const hiddenOnBoard = renderShareHtml({ ...ctx, showCovers: false }, [covered]);
    expect(hiddenOnBoard).not.toContain('class="share-card-cover"');
    expect(hiddenOnBoard).toContain('data-detail-cover');
    const detailData = JSON.parse(hiddenOnBoard.match(/id="roadmap-data">([\s\S]*?)<\/script>/)![1]);
    expect(detailData[0]).toMatchObject({ cover: 'assets/ast_one/rev_one/cover.png', coverPosition: '40% 65%' });
  });

  it('identifies products with shorthand on mixed horizon boards without repeating marks for one product', () => {
    const infraItem = { ...item, id: 'ADS-1', product: 'Ads Platform' };
    const infraHtml = renderShareHtml({ ...ctx, product: 'Ads Platform' }, [infraItem]);
    expect(infraHtml).toContain('var(--roadmap-product-ads-platform)');
    expect(infraHtml).not.toContain('aria-label="Ads Platform"');
    expect(infraHtml).not.toContain('<span class="card-product">');
    const mixed = renderShareHtml({ ...ctx, product: null }, [item, infraItem]);
    expect(mixed).toContain('aria-label="Ads Platform"');
    expect(mixed).toContain('aria-hidden="true">AP</span>');
    expect(mixed).not.toContain('<span class="card-product">');
  });

  it('honors product grouping and reversed lane order in baked boards', () => {
    const adsItem = { ...item, id: 'ADS-1', product: 'Ads Platform', horizon: 'Next' };
    const rendered = renderShareHtml({ ...ctx, product: null, group: 'product', reverseLanes: true }, [item, adsItem]);
    expect(rendered.indexOf('data-lane="Ads Platform"')).toBeLessThan(rendered.indexOf('data-lane="Podcasts &amp; Audiobooks"'));
    expect(rendered).toContain('data-horizon="Next"');
    expect(rendered).not.toContain('aria-label="Ads Platform"');
  });

  it('does not add an unselected empty Completed lane to a baked roadmap', () => {
    expect(html).not.toContain('data-lane="Completed"');
    expect(html).not.toContain('Nothing shipped yet. Completed work lands here.');
  });

  it('keeps selected empty horizon lanes visible without adding filter controls', () => {
    const shared = renderShareHtml({ ...ctx, horizons: ['Now', 'Next', 'Later'] }, [item]);
    expect([...shared.matchAll(/data-lane="([^"]+)"/g)].map(match => match[1])).toEqual(['Now', 'Next', 'Later']);
    expect(shared.match(/No items in this lane\./g)).toHaveLength(2);
    expect(shared).not.toMatch(/data-horizon-filter="/);
    expect(shared).toContain('1 item');
    expect(shared).not.toContain('across 3 lanes');
  });

  it('groups every included item into canonical horizon order, even with stale selection', () => {
    const horizons = ['Candidates', 'Now', 'Next', 'Later', 'Completed'] as const;
    const items = horizons.map((horizon, index) => ({ ...item, id: `TALK-${index + 1}`, horizon }));
    const shared = renderShareHtml({ ...ctx, horizons: ['Now'] }, [...items].reverse());
    expect([...shared.matchAll(/data-lane="([^"]+)"/g)].map(match => match[1])).toEqual(horizons);
    for (let index = 0; index < items.length; index++) expect(shared).toContain(`data-card-index="${index}"`);
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


it('keeps the resolved activity range visible in a shared snapshot', () => {
  const html = renderShareHtml({ title: 'Review', product: null, generatedAt: 'Sep 6, 2026', activitySummary: 'Updated · Aug 1, 2026 – Aug 31, 2026 (Europe/Stockholm)' }, []);
  expect(html).toContain('Updated · Aug 1, 2026 – Aug 31, 2026 (Europe/Stockholm)');
});

it('shares the fixed timeline period with omitted counts and clickable items', () => {
  const html=renderShareHtml({...ctx,timeline:{group:'product',scale:'months',fit:false,range:{from:'2026-09-01',to:'2026-09-30'}}},[
    {...item,startDate:'2026-09-01',endDate:'2026-09-30'}, {...item,id:'no-dates',title:'Not scheduled'}, {...item,id:'outside',startDate:'2027-01-01',endDate:'2027-02-01'},
  ]);
  expect(html).toContain('Shared roadmap timeline');
  expect(html).toContain('1 missing or invalid dates');
  expect(html).toContain('1 outside this period');
  expect(html).toContain('data-card-index="0"');
  expect(html).toContain('30 Sept 2026');
  expect(html).not.toContain('Public <Title>');
});
it('keeps private tags out of shared timeline grouping', () => {
  const html=renderShareHtml({...ctx,timeline:{group:'tag',scale:'months',fit:true,range:{from:'2026-09-01',to:'2026-09-30'}}},[
    {...item,tags:['secret-internal'],startDate:'2026-09-01',endDate:'2026-09-30'},
  ]);
  expect(html).not.toContain('secret-internal');
  expect(html).toContain('Grouped by product for sharing');
});
