import { describe, expect, it } from 'vitest';
import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import ItemPage from './ItemPage.vue';
import DocumentPage from './DocumentPage.vue';
import { buildPublishedModel, type PublishedContent } from '../../lib/published/model';
import { pageSeed } from '../../lib/published/seed';
import { itemSchema } from '../../lib/schema';
import { EMPTY_ITEM_HISTORY } from '../../lib/itemHistory';

function fixture(audience: 'internal' | 'public' = 'internal'): PublishedContent {
  const model = buildPublishedModel({
    items: ['A', 'B', 'C', 'D'].map(id => ({ id, filePath: `content/items/${id}.md`,
      data: itemSchema.parse({ id, title: `Item ${id}`, product: 'Studio', horizon: 'Now', stage: 'Pilot', owner: 'Private owner', visibility: 'Public', order: id.charCodeAt(0) }),
      body: '## One-liner\nA helpful summary.\n\n## Why it matters\nPublic reasoning.\n\n## Current behavior\nPRIVATE SECTION\n\n## Links\n- PRD: content/prds/brief.md\n' })),
    documents: [{ coll: 'prds', entries: [{ id: 'brief', data: { title: 'Launch brief', visibility: 'Public', updated: '2026-09-13', roadmap_item: 'B' }, body: 'Document body' }] }],
  }, { base: '/roadmap/', audience, historyForPath: () => ({ ...EMPTY_ITEM_HISTORY, created: '2026-09-01', updated: '2026-09-13', updatedBy: 'Private author', updatedSubject: 'Private subject' }) });
  return { ...model, audience, documentHtml: { '/roadmap/docs/prd/brief': { html: '<h2 id="overview">Overview</h2><p>Document body</p>', headings: [{ depth: 2, slug: 'overview', text: 'Overview' }] } } };
}

describe('published presentation parity', () => {
  const renderItem = (model: PublishedContent, id = 'B') => renderToString(createSSRApp(ItemPage, { model, id, audience: model.audience, base: '/roadmap/' }));
  it('keeps full initial item HTML, metadata, sections, resources and sibling navigation with a small seed', async () => {
    const model = fixture();
    const html = await renderItem(model);
    expect(html).toBe(await renderItem(pageSeed(model, '/roadmap/', 'item/B')));
    for (const value of ['Item B', 'A helpful summary.', 'Why it matters', 'PRIVATE SECTION', 'Private owner', 'Launch brief', '/roadmap/item/A', '/roadmap/item/C', 'Sep 13, 2026']) expect(html).toContain(value);
    expect(html).not.toContain('data-local-date-time'); // Date-only Git fallback must not acquire a timezone.
  });
  it('filters private data before any public HTML or seed serialization', async () => {
    const model = fixture('public');
    const html = await renderItem(model);
    expect(html).toContain('Public reasoning.');
    expect(html + JSON.stringify(model)).not.toMatch(/Private owner|Private author|Private subject|PRIVATE SECTION|Edit on GitHub/);
    expect(await renderItem(model, 'removed')).toContain('Item unavailable');
  });
  it('renders a directly reachable document with its same-revision backlinks and date', async () => {
    const model = fixture();
    const entry = model.documents[0];
    const html = await renderToString(createSSRApp(DocumentPage, { entry, rendered: model.documentHtml[entry.href], base: '/roadmap/' }));
    for (const value of ['Launch brief', 'Document body', 'Related roadmap items', '/roadmap/item/B', 'Sep 13, 2026', 'id="overview"']) expect(html).toContain(value);
  });
  it('hydrates serialized item props without mismatch or losing handlers', async () => {
    const model = pageSeed(fixture(), '/roadmap/', 'item/B');
    const props = { model, id: 'B', audience: model.audience, base: '/roadmap/' };
    const host = document.createElement('div');
    host.innerHTML = await renderToString(createSSRApp(ItemPage, props));
    document.body.append(host);
    const app = createSSRApp(ItemPage, JSON.parse(JSON.stringify(props)));
    const warnings: string[] = [];
    app.config.warnHandler = warning => warnings.push(warning);
    try {
      app.mount(host);
      expect(warnings.filter(warning => /hydration|mismatch/i.test(warning))).toEqual([]);
      expect(host.querySelector('h1')?.textContent).toBe('Item B');
      expect(host.querySelector('[data-copy-link]')).not.toBeNull();
    } finally { app.unmount(); host.remove(); }
  });
});
