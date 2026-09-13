import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { createHash } from 'node:crypto';
import PublishedPage from './PublishedPage.vue';
import { buildPublishedModel, type PublishedContent } from '../../lib/published/model';
import { pageSeed } from '../../lib/published/seed';
import { itemSchema } from '../../lib/schema';
import { EMPTY_ITEM_HISTORY } from '../../lib/itemHistory';
import type { PublishedRelease } from '../../lib/published/client';

function fixture(title: string, cover = '../../assets/ast_cover/rev_one/cover.png'): PublishedContent {
  return { ...buildPublishedModel({ items: [{ id: 'A', filePath: 'content/items/A.md', data: itemSchema.parse({ id: 'A', title, product: 'Music App', horizon: 'Now', stage: 'Pilot', owner: 'Test', visibility: 'Public', order: 1, cover }), body: '## One-liner\nSummary\n\n## Why it matters\nReasoning' }], documents: [] }, { base: '/', audience: 'internal', historyForPath: () => EMPTY_ITEM_HISTORY }), audience: 'internal', documentHtml: {} };
}
function candidate(model: PublishedContent, commit = 'a'.repeat(40)) {
  const bytes = JSON.stringify(model);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const release: PublishedRelease = { commit, applicationCommit: 'b'.repeat(40), applicationPackage: 'c'.repeat(64), profile: 'd'.repeat(64), contentSchema: 1, committedAt: '2026-09-13T09:00:00Z', content: { path: `content/${hash}.json`, hash, size: Buffer.byteLength(bytes) } };
  return { model, release, bytes };
}
const original = candidate(fixture('Initial title'));
let live = original;
let request: ReturnType<typeof vi.fn<typeof fetch>>;
let warnings: string[];
beforeEach(async () => {
  document.dispatchEvent(new Event('astro:before-swap'));
  document.body.replaceChildren(); live = original; warnings = [];
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  request = vi.fn<typeof fetch>().mockImplementation(async url => new Response(String(url).includes('version.json') ? JSON.stringify(live.release) : live.bytes));
  vi.stubGlobal('fetch', request);
  vi.spyOn(console, 'warn').mockImplementation((...args) => warnings.push(args.join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...args) => warnings.push(args.join(' ')));
  vi.spyOn(window.location, 'reload').mockImplementation(() => {});
  // Install navigation handlers once; with no seed present this must not mount.
  await import('../../published-client');
});
afterEach(() => { document.dispatchEvent(new Event('astro:before-swap')); document.body.replaceChildren(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function openItem() {
  const props = { model: pageSeed(original.model, '/', 'item/A'), release: original.release, base: '/', route: 'item/A' };
  const host = document.createElement('div'); host.id = 'published-root';
  host.innerHTML = await renderToString(createSSRApp(PublishedPage, props));
  const seed = document.createElement('script'); seed.id = 'published-seed'; seed.type = 'application/json'; seed.textContent = JSON.stringify(props);
  document.body.append(host, seed);
  document.dispatchEvent(new Event('astro:page-load'));
  document.dispatchEvent(new Event('astro:page-load')); // Initial Astro event can race the lazy route import.
  await vi.waitFor(() => expect(host.dataset.hydrated).toBe('true'));
  await vi.waitFor(() => expect(request).toHaveBeenCalled());
  return host;
}
async function publish(model: PublishedContent) {
  live = candidate(model, 'e'.repeat(40));
  window.dispatchEvent(new Event('focus'));
}

describe('hydrated content replacement', () => {
  it('waits for lazy route hydration, then patches title/cover without remount, reload or focus loss', async () => {
    const host = await openItem();
    const button = host.querySelector<HTMLButtonElement>('[data-copy-link]')!; button.focus();
    await publish(fixture('Published title', '../../assets/ast_cover/rev_two/cover.png'));
    await vi.waitFor(() => expect(host.querySelector('h1')?.textContent).toBe('Published title'));
    expect(host.querySelector('[data-copy-link]')).toBe(button);
    expect(document.activeElement).toBe(button);
    expect(host.querySelector('.roadmap-cover-fill')?.getAttribute('src')).toBe('/assets/ast_cover/rev_two/cover.png');
    expect(document.title).toBe('Published title · Product Roadmap');
    expect(host.dataset.contentCommit).toBe(live.release.commit);
    expect(warnings.filter(warning => /hydration|mismatch/i.test(warning))).toEqual([]);
    expect(window.location.reload).not.toHaveBeenCalled();
  });
  it('holds a complete candidate during IME composition and releases it after composition ends', async () => {
    const host = await openItem();
    document.dispatchEvent(new CompositionEvent('compositionstart'));
    await publish(fixture('Remote during composition'));
    await vi.waitFor(() => expect(host.textContent).toContain('current work is kept'));
    expect(host.querySelector('h1')?.textContent).toBe('Initial title');
    document.dispatchEvent(new CompositionEvent('compositionend'));
    await vi.waitFor(() => expect(host.querySelector('h1')?.textContent).toBe('Remote during composition'));
    expect(window.location.reload).not.toHaveBeenCalled();
  });
  it('explains removal of a directly opened item without navigation', async () => {
    const host = await openItem();
    await publish({ ...original.model, items: [], boardItems: [] });
    await vi.waitFor(() => expect(host.querySelector('h1')?.textContent).toBe('Item unavailable'));
    expect(host.textContent).toContain('no longer part');
    expect(window.location.reload).not.toHaveBeenCalled();
  });
  it('offers only a normal reload for a different application and keeps the old model', async () => {
    const host = await openItem();
    live = { ...candidate(fixture('Incompatible content')), release: { ...original.release, applicationPackage: 'f'.repeat(64) } };
    window.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(host.textContent).toContain('Reload application'));
    expect(host.querySelector('h1')?.textContent).toBe('Initial title');
    host.querySelector<HTMLButtonElement>('[data-published-status] button')!.click();
    expect(window.location.reload).toHaveBeenCalledOnce();
  });
});
