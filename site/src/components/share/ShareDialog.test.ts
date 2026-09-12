import { afterEach, describe, it, expect, vi } from 'vitest';
import { flushPromises, mount, enableAutoUnmount } from '@vue/test-utils';
import ShareDialog from './ShareDialog.vue';
import * as assets from '../../lib/share/assets';
enableAutoUnmount(afterEach);
import type { ProjectedItem } from '../../lib/share/project';
import type { AuthoredCanvas } from '../../lib/share/canvasdrop';

const mk = (over: Partial<ProjectedItem>): ProjectedItem => ({
  id: 'TALK-1', title: 'T', oneliner: 'o', outcome: '', product: 'Podcasts & Audiobooks',
  horizon: 'Now', stage: 'Building', tags: [], themes: [], sections: [],
  ...over,
});
const context = { title: 'CM view', product: 'Podcasts & Audiobooks', generatedAt: '2026-07-05' };
const mkShare = (over: Partial<AuthoredCanvas>): AuthoredCanvas => {
  const share: AuthoredCanvas = {
    id: 'S1',
    url: 'https://existing.canvas-drop.com/s1',
    title: 'Canvas record name',
    tags: ['Podcasts & Audiobooks', 'roadmap-share'],
    access: 'public_link',
    accessMode: 'public_link',
    hasPassword: false,
    status: 'live',
    publicationStatus: 'published',
    createdAt: Date.now() - 10_000,
    updatedAt: Date.now() - 5_000,
    expiresAt: Date.now() + 30 * 86_400_000,
    revokedAt: null,
    createdBy: 'dev',
    version: 'v1',
    bundleUpdatedAt: Date.now() - 5_000,
    sourceApp: 'product-roadmap',
    sourceKind: 'roadmap-share',
    metadata: { theme: 'dark', roadmapTitle: 'Viewer roadmap title' },
    ...over,
  };
  if (over.accessMode === undefined) {
    share.accessMode = share.access === 'whole_org' ? 'whole_org' : share.access === 'public_link' ? 'public_link' : 'restricted';
  }
  if (over.publicationStatus === undefined) {
    share.publicationStatus = share.status === 'expired'
      ? 'expired'
      : share.status === 'revoked'
        ? 'unpublished'
        : share.version === null
          ? 'draft'
          : 'published';
  }
  return share;
};

// The dialog is two-step; the settings + submit controls live on step 2.
const toSettings = (w: ReturnType<typeof mount>) => w.get('[data-test="next"]').trigger('click');
const submitted = (w: ReturnType<typeof mount>) => w.emitted('submit')?.[0]?.[0] as {
  targetShareId: string | null; canvasTitle: string; canvasDescription: string; roadmapTitle: string; roadmapIntro: string;
  access: string | null; password?: string | null; expectedUpdatedAt?: number; theme: string; tags: string[]; preservedMetadata: Record<string, unknown>; items: ProjectedItem[];
};

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('ShareDialog', () => {
  it('updates the same share with current item content, automatic inline images, and remembered attachments', async () => {
    const resources = [
      { key: 'A:inline', itemId: 'A', label: 'Screenshot', href: 'https://example.com/image.png', repoPath: null, image: true, inline: true },
      { key: 'A:notes', itemId: 'A', label: 'Notes', href: 'https://example.com/notes', repoPath: null },
    ];
    const w = mount(ShareDialog, { props: {
      items: [mk({ id: 'A', title: 'Old title' })], context, resources,
      shares: [mkShare({ metadata: { resourceKeys: ['A:notes'] } })],
    } });
    expect(w.get('input[aria-label="Screenshot — included inline"]').element).toMatchObject({ checked: true, disabled: true });
    await toSettings(w);
    await w.get('[data-test="target-existing"]').trigger('click');
    await w.setProps({ items: [mk({ id: 'A', title: 'Updated title', horizon: 'Completed', sections: [{ heading: 'Scope', text: 'Delivered.' }] })] });
    await w.get('[data-test="submit"]').trigger('click');
    expect(submitted(w).targetShareId).toBe('S1');
    expect(submitted(w).items[0]).toMatchObject({ title: 'Updated title', horizon: 'Completed', sections: [{ heading: 'Scope', text: 'Delivered.' }] });
    expect((w.emitted('submit')![0][0] as { resources: unknown[] }).resources).toEqual(resources);
  });

  it('fits a mobile preview without changing the recipient viewport width', async () => {
    let resize: ResizeObserverCallback;
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { resize = callback; }
      observe() {}
      disconnect = disconnect;
    });
    vi.spyOn(assets, 'inlinePreviewAssets').mockResolvedValue(assets.previewAssetUrls());
    const w = mount(ShareDialog, { props: { items: [mk({})], context } });
    await toSettings(w);
    await w.findAll('button').find((button) => button.text() === 'Preview as recipient')!.trigger('click');
    await flushPromises();
    await w.get('select[aria-label="Preview width"]').setValue('mobile');
    resize!([{ contentRect: { width: 260 } } as ResizeObserverEntry], {} as ResizeObserver);
    await flushPromises();
    expect(w.get('iframe').element.style.width).toBe('390px');
    expect(w.get('iframe').element.style.transform).toBe(`scale(${260 / 390})`);
    w.unmount();
    expect(disconnect).toHaveBeenCalled();
  });

  it('holds the preview until its assets are ready and offers a retry after failure', async () => {
    const load = vi.spyOn(assets, 'inlinePreviewAssets').mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce(assets.previewAssetUrls());
    const w = mount(ShareDialog, { props: { items: [mk({})], context } });
    await toSettings(w);
    await w.findAll('button').find((button) => button.text() === 'Preview as recipient')!.trigger('click');
    expect(w.find('iframe').exists()).toBe(false);
    await flushPromises();
    expect(w.text()).toContain('Design assets could not load');
    await w.findAll('button').find((button) => button.text() === 'Retry preview')!.trigger('click');
    await flushPromises();
    expect(load).toHaveBeenCalledTimes(2);
    expect(w.find('iframe').exists()).toBe(true);
  });

  it('shows a resource error without rendering a blank recipient frame', async () => {
    vi.spyOn(assets, 'inlinePreviewAssets').mockResolvedValue(assets.previewAssetUrls());
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ documents: [], assets: [] }))));
    const w = mount(ShareDialog, {
      props: {
        items: [mk({ cover: '../../assets/ast_missing/rev_one/cover.png' })],
        context,
      },
    });
    await toSettings(w);
    await w.findAll('button').find((button) => button.text() === 'Preview as recipient')!.trigger('click');
    await flushPromises();
    expect(w.text()).toContain('not published yet');
    expect(w.find('iframe').exists()).toBe(false);
  });

  it('previews selected horizon lanes and isolates the preview', async () => {
    vi.spyOn(assets, 'inlinePreviewAssets').mockResolvedValue(assets.previewAssetUrls());
    const w = mount(ShareDialog, {
      props: {
        items: [Object.assign(mk({ id: 'A', title: 'Included', sections: [{ heading: 'Open questions', text: 'INTERNAL ONLY' }] }), { owner: 'SECRET OWNER' }), mk({ id: 'B', title: 'Excluded', horizon: 'Later' })],
        context: { ...context, horizons: ['Now', 'Next', 'Later'] },
      },
    });
    await w.get('[data-test="lane-Later"]').setValue(false);
    await toSettings(w);
    await w.findAll('button').find((button) => button.text() === 'Preview as recipient')!.trigger('click');
    await flushPromises();
    const frame = w.get('iframe');
    const html = frame.attributes('srcdoc');
    expect(frame.attributes('sandbox')).toBe('allow-scripts');
    expect(html).toContain('Included');
    expect(html).not.toContain('Excluded');
    expect(html).not.toContain('SECRET OWNER');
    expect(html).not.toContain('INTERNAL ONLY');
    expect(html).not.toContain('data-lane="Later"');
    expect(html).toContain('data-lane="Now"');
    expect(html).toContain('data-lane="Next"');
    expect(html).toContain('1 item');
    expect(html).not.toContain('data-horizon-filter="');
    await w.get('[data-test="submit"]').trigger('click');
    expect(submitted(w).items.map((item) => item.id)).toEqual(['A']);
    w.unmount();
  });
  it('selects every item in the current view by default', async () => {
    const w = mount(ShareDialog, {
      props: { items: [mk({ id: 'A' }), mk({ id: 'B' })], context },
    });
    expect(w.text().toLowerCase()).not.toContain('internal title');
    await toSettings(w);
    await w.get('[data-test="submit"]').trigger('click');
    expect(submitted(w).items.map((i) => i.id)).toEqual(['A', 'B']);
  });

  it('Select all includes every item', async () => {
    const w = mount(ShareDialog, { props: { items: [mk({ id: 'A' }), mk({ id: 'B' })], context } });
    await w.get('[data-test="deselect-all"]').trigger('click');
    await w.get('[data-test="select-all"]').trigger('click');
    await toSettings(w);
    await w.get('[data-test="submit"]').trigger('click');
    expect(submitted(w).items.map((i) => i.id)).toEqual(['A', 'B']);
  });

  it('Clear deselects everything and blocks proceeding', async () => {
    const w = mount(ShareDialog, { props: { items: [mk({ id: 'A' }), mk({ id: 'B' })], context } });
    await w.get('[data-test="deselect-all"]').trigger('click');
    expect(w.get('[data-test="next"]').attributes('disabled')).toBeDefined();
  });

  it('a lane toggle deselects every item in that lane', async () => {
    const w = mount(ShareDialog, {
      props: { items: [mk({ id: 'A', horizon: 'Now' }), mk({ id: 'B', horizon: 'Now' }), mk({ id: 'C', horizon: 'Later' })], context },
    });
    await w.get('[data-test="lane-Now"]').setValue(false);
    await toSettings(w);
    await w.get('[data-test="submit"]').trigger('click');
    expect(submitted(w).items.map((i) => i.id)).toEqual(['C']);
  });

  it('reviews selected content in canonical roadmap horizon order', () => {
    const horizons = ['Candidates', 'Now', 'Next', 'Later', 'Completed'] as const;
    const w = mount(ShareDialog, {
      props: {
        items: horizons.map((horizon, index) => mk({ id: `TALK-${index + 1}`, horizon })),
        context,
      },
    });

    expect(w.findAll('input[data-test^="lane-"]').map((input) => input.attributes('data-test'))).toEqual(
      horizons.map((horizon) => `lane-${horizon}`),
    );
  });

  it('excludes an individually unchecked item', async () => {
    const w = mount(ShareDialog, { props: { items: [mk({ id: 'A' }), mk({ id: 'B' })], context } });
    await w.get('[data-test="collapse-Now"]').trigger('click'); // lanes start collapsed; expand to reach items
    await w.get('[data-test="item-B"]').setValue(false);
    await toSettings(w);
    await w.get('[data-test="submit"]').trigger('click');
    expect(submitted(w).items.map((i) => i.id)).toEqual(['A']);
  });

  it('emits submit with separate canvas and roadmap copy', async () => {
    const w = mount(ShareDialog, { props: { items: [mk({ id: 'A' }), mk({ id: 'B' })], context } });
    await toSettings(w);
    await w.get('[data-test="canvas-title"]').setValue('CM operator share');
    await w.get('[data-test="canvas-description"]').setValue('Weekly customer sync.');
    await w.get('[data-test="roadmap-title"]').setValue('Podcasts & Audiobooks Q3 roadmap');
    await w.get('[data-test="intro"]').setValue('For Q3 we are focused on one-view.');
    await w.get('[data-test="submit"]').trigger('click');
    const p = submitted(w);
    expect(p.targetShareId).toBeNull();
    expect(p.canvasTitle).toBe('CM operator share');
    expect(p.canvasDescription).toBe('Weekly customer sync.');
    expect(p.roadmapTitle).toBe('Podcasts & Audiobooks Q3 roadmap');
    expect(p.access).toBe('private');
    expect(p.roadmapIntro).toBe('For Q3 we are focused on one-view.');
    expect(p.theme).toBe('light');
    expect(p.items.map((i) => i.id)).toEqual(['A', 'B']);
    expect(p).not.toHaveProperty('expiresAt');
    expect(p.tags).toEqual(['Podcasts & Audiobooks', 'roadmap-share']);
  });

  it('publishes a public roadmap share without inventing expiry or gallery visibility', async () => {
    const w = mount(ShareDialog, { props: { items: [mk({ id: 'A' })], context } });
    await toSettings(w);
    await w.get('select[aria-label="Access"]').setValue('public_link');
    await w.get('[data-test="submit"]').trigger('click');

    expect(submitted(w)).not.toHaveProperty('expiresAt');
    expect(submitted(w)).not.toHaveProperty('galleryListed');
  });

  it('offers whole-org access and removes specific-people from the picker', async () => {
    const w = mount(ShareDialog, { props: { items: [mk({ id: 'A' })], context } });
    await toSettings(w);
    const access = w.get('select');
    expect(access.text()).toContain('Whole org');
    expect(access.text()).not.toContain('Specific people');
    await access.setValue('whole_org');
    await w.get('[data-test="submit"]').trigger('click');
    expect(submitted(w).access).toBe('whole_org');
  });

  it('shows and preserves a specific-people audience managed in Canvas Drop', async () => {
    const w = mount(ShareDialog, {
      props: {
        items: [mk({ id: 'A' })],
        context,
        shares: [mkShare({ id: 'S1', access: 'specific_people' })],
      },
    });
    await toSettings(w);
    const row = w.get('[data-test="share-row-S1"]');
    expect(row.text()).toContain('Restricted');
    expect(row.text()).toContain('people or teams added in Canvas Drop');
    expect(row.text()).not.toContain('Whole org');

    await w.get('[data-test="target-existing"]').trigger('click');
    expect(w.get('[data-test="canvasdrop-managed-audience"]').text()).toContain('Added people and teams are preserved');
    await w.get('[data-test="submit"]').trigger('click');
    expect(submitted(w).access).toBeNull();
  });

  it('shows and preserves a team audience and its independent password lock', async () => {
    const w = mount(ShareDialog, {
      props: {
        items: [mk({ id: 'A' })],
        context,
        shares: [mkShare({
          id: 'TEAM', access: 'team', hasPassword: true,
          audienceSummary: { count: 2, names: ['R&D', 'Leadership'] }, viewerRole: 'editor',
        })],
      },
    });
    await toSettings(w);
    const row = w.get('[data-test="share-row-TEAM"]');
    expect(row.text()).toContain('Team');
    expect(row.text()).toContain('Restricted');
    expect(row.text()).toContain('R&D, Leadership');
    expect(row.text()).toContain('editor');
    expect(row.text()).toContain('Password protected');

    await w.get('[data-test="target-existing"]').trigger('click');
    expect((w.get('[data-test="password-enabled"]').element as HTMLInputElement).checked).toBe(true);
    expect(w.get('[data-test="password-set"]').text()).toContain('Password is set');
    await w.get('[data-test="submit"]').trigger('click');
    expect(submitted(w).access).toBeNull();
  });

  it('emits the selected share appearance', async () => {
    const w = mount(ShareDialog, { props: { items: [mk({ id: 'A' })], context } });
    await toSettings(w);
    await w.findAll('select')[1]!.setValue('dark');
    await w.get('[data-test="submit"]').trigger('click');
    expect(submitted(w).theme).toBe('dark');
  });

  it('can update an existing share instead of minting a new one', async () => {
    const w = mount(ShareDialog, {
      props: {
        items: [mk({ id: 'A' })],
        context,
        shares: [mkShare({
          id: 'S1',
          updatedAt: 123,
          metadata: { theme: 'dark', canvasDescription: 'Sync note', roadmapTitle: 'Customer roadmap', roadmapIntro: 'Intro' },
        })],
      },
    });
    await toSettings(w);
    await w.get('[data-test="target-existing"]').trigger('click');
    await w.get('[data-test="submit"]').trigger('click');
    const p = submitted(w);
    expect(p.targetShareId).toBe('S1');
    expect(p.canvasDescription).toBe('Sync note');
    expect(p.roadmapTitle).toBe('Customer roadmap');
    expect(p.roadmapIntro).toBe('Intro');
    expect(p.theme).toBe('dark');
    expect(p.expectedUpdatedAt).toBe(123);
  });

  it('resets access to private when switching from an existing share to a new share', async () => {
    const w = mount(ShareDialog, {
      props: {
        items: [mk({ id: 'A' })],
        context,
        shares: [mkShare({ id: 'PRIVATE', access: 'private', status: 'private' })],
      },
    });
    await toSettings(w);
    await w.get('[data-test="target-existing"]').trigger('click');
    await w.get('[data-test="target-new"]').trigger('click');
    await w.get('[data-test="submit"]').trigger('click');

    expect(submitted(w).targetShareId).toBeNull();
    expect(submitted(w).access).toBe('private');
  });

  it('rehydrates the same existing share after a new-share round trip', async () => {
    const w = mount(ShareDialog, {
      props: {
        items: [mk({ id: 'A' })],
        context,
        shares: [mkShare({ id: 'PUBLIC', access: 'public_link', title: 'Existing public share' })],
      },
    });
    await toSettings(w);
    await w.get('[data-test="target-existing"]').trigger('click');
    await w.get('[data-test="target-new"]').trigger('click');
    await w.get('[data-test="target-existing"]').trigger('click');
    await w.get('[data-test="submit"]').trigger('click');

    expect(submitted(w).targetShareId).toBe('PUBLIC');
    expect(submitted(w).access).toBeNull();
    expect(submitted(w).canvasTitle).toBe('Existing public share');
  });

  it('only sends general access when the author changes it', async () => {
    const w = mount(ShareDialog, {
      props: {
        items: [mk({ id: 'A' })],
        context,
        shares: [mkShare({ id: 'PUBLIC', access: 'public_link', audienceSummary: { count: 2, names: ['Customers'] } })],
      },
    });
    await toSettings(w);
    await w.get('[data-test="target-existing"]').trigger('click');
    expect(w.get('[data-test="canvasdrop-managed-audience"]').text()).toContain('2 added people or teams');
    await w.get('select[aria-label="Access"]').setValue('whole_org');
    await w.get('[data-test="submit"]').trigger('click');

    expect(submitted(w).access).toBe('whole_org');
  });

  it('shows managed shares and emits list actions', async () => {
    const w = mount(ShareDialog, {
      props: {
        items: [mk({ id: 'A' })],
        context,
        author: { id: 'dev', email: 'dev@example.com', name: 'Mark' },
        shares: [mkShare({ id: 'S1', access: 'public_link', hasPassword: true })],
      },
    });
    await toSettings(w);
    expect(w.text()).toContain('Signed in as Mark');
    expect(w.get('[data-test="share-title-S1"]').text()).toContain('Viewer roadmap title');
    expect(w.get('[data-test="share-row-S1"]').text()).toContain('Canvas: Canvas record name');
    expect(w.get('[data-test="share-row-S1"]').text()).toContain('Password protected');
    expect(w.get('[data-test="share-row-S1"]').text()).toContain('Public link');
    expect(w.get('[data-test="share-row-S1"]').text()).toContain('Anyone with the link');
    expect(w.get('[data-test="share-row-S1"]').text()).toContain('Published');
    expect(w.get('[data-test="share-open-canvas-S1"]').attributes('href')).toBe('https://canvas-drop.com/canvases/S1');
    await w.get('[data-test="refresh-shares"]').trigger('click');
    await w.get('[data-test="share-revoke-S1"]').trigger('click');
    expect(w.emitted('revoke')).toBeUndefined();
    document.querySelector<HTMLButtonElement>('[data-test=confirm-action]')!.click();
    await flushPromises();
    expect(w.emitted('refreshShares')).toHaveLength(1);
    expect(w.emitted('revoke')?.[0]).toEqual(['S1']);
  });

  it('keeps an existing public-link password independently from its audience', async () => {
    const w = mount(ShareDialog, {
      props: {
        items: [mk({ id: 'A' })],
        context,
        shares: [mkShare({ id: 'S1', access: 'public_link', hasPassword: true })],
      },
    });
    await toSettings(w);
    await w.get('[data-test="target-existing"]').trigger('click');

    expect((w.get('select[aria-label="Access"]').element as HTMLSelectElement).value).toBe('public_link');
    expect((w.get('[data-test="password-enabled"]').element as HTMLInputElement).checked).toBe(true);
    expect(w.get('[data-test="password-set"]').text()).toContain('Password is set');
    await w.get('[data-test="submit"]').trigger('click');

    expect(submitted(w).access).toBeNull();
    expect(submitted(w).password).toBeUndefined();
  });

  it('only removes an existing password after an explicit action', async () => {
    const w = mount(ShareDialog, {
      props: {
        items: [mk({ id: 'A' })], context,
        shares: [mkShare({ id: 'S1', access: 'whole_org', hasPassword: true })],
      },
    });
    await toSettings(w);
    await w.get('[data-test="target-existing"]').trigger('click');
    await w.get('[data-test="password-enabled"]').setValue(false);
    await w.get('[data-test="submit"]').trigger('click');

    expect(submitted(w).access).toBeNull();
    expect(submitted(w).password).toBeNull();
  });

  it.each([
    ['private'],
    ['whole_org'],
  ])('does not widen an existing %s share with a password', async (audience) => {
    const w = mount(ShareDialog, {
      props: {
        items: [mk({ id: 'A' })],
        context,
        shares: [mkShare({ id: 'LOCKED', access: audience as AuthoredCanvas['access'], hasPassword: true })],
      },
    });
    await toSettings(w);
    await w.get('[data-test="target-existing"]').trigger('click');
    await w.get('[data-test="submit"]').trigger('click');

    expect(submitted(w).access).toBeNull();
    expect(submitted(w).password).toBeUndefined();
  });

  it('clears a typed replacement password when another share is selected', async () => {
    const w = mount(ShareDialog, {
      props: {
        items: [mk({ id: 'A' })],
        context,
        shares: [
          mkShare({ id: 'A-SHARE', title: 'First', updatedAt: 20, hasPassword: true }),
          mkShare({ id: 'B-SHARE', title: 'Second', updatedAt: 10, hasPassword: true }),
        ],
      },
    });
    await toSettings(w);
    await w.get('[data-test="target-existing"]').trigger('click');
    await w.get('[data-test="password"]').setValue('replacement-for-a');
    await w.get('select[aria-label="Existing share"]').setValue('B-SHARE');
    await w.get('[data-test="submit"]').trigger('click');

    expect(submitted(w).targetShareId).toBe('B-SHARE');
    expect(submitted(w).password).toBeUndefined();
  });

  it('rehydrates a refreshed selected share when the form is untouched', async () => {
    const original = mkShare({ id: 'S1', updatedAt: 10, title: 'Old title', access: 'private', metadata: {} });
    const w = mount(ShareDialog, { props: { items: [mk({ id: 'A' })], context, shares: [original] } });
    await toSettings(w);
    await w.get('[data-test="target-existing"]').trigger('click');

    await w.setProps({ shares: [mkShare({ id: 'S1', updatedAt: 20, title: 'New title', access: 'whole_org', metadata: {} })] });
    await flushPromises();

    expect((w.get('[data-test="canvas-title"]').element as HTMLInputElement).value).toBe('New title');
    expect((w.get('select[aria-label="Access"]').element as HTMLSelectElement).value).toBe('whole_org');
  });

  it('blocks a stale update until the author reloads current share settings', async () => {
    const original = mkShare({ id: 'S1', updatedAt: 10, title: 'Old title' });
    const w = mount(ShareDialog, { props: { items: [mk({ id: 'A' })], context, shares: [original] } });
    await toSettings(w);
    await w.get('[data-test="target-existing"]').trigger('click');
    await w.get('[data-test="canvas-title"]').setValue('My local title');

    await w.setProps({ shares: [mkShare({ id: 'S1', updatedAt: 20, title: 'Remote title' })] });
    await flushPromises();

    expect(w.get('[data-test="share-stale"]').text()).toContain('changed in Canvas Drop');
    expect(w.get('[data-test="submit"]').attributes('disabled')).toBeDefined();
    await w.get('[data-test="reload-share-settings"]').trigger('click');
    expect((w.get('[data-test="canvas-title"]').element as HTMLInputElement).value).toBe('Remote title');
    expect(w.get('[data-test="submit"]').attributes('disabled')).toBeUndefined();
  });

  it('uses the light default when an older existing share has no theme metadata', async () => {
    const w = mount(ShareDialog, {
      props: {
        items: [mk({ id: 'A' })], context,
        shares: [
          mkShare({ id: 'DARK', updatedAt: 20, metadata: { theme: 'dark' } }),
          mkShare({ id: 'LEGACY', updatedAt: 10, metadata: {} }),
        ],
      },
    });
    await toSettings(w);
    await w.get('[data-test="target-existing"]').trigger('click');
    await w.get('select[aria-label="Existing share"]').setValue('LEGACY');
    await w.get('[data-test="submit"]').trigger('click');

    expect(submitted(w).theme).toBe('light');
  });
  it('highlights an existing canvas expiry without changing it', async () => {
    const expiresAt = Date.now() + 7 * 86_400_000;
    const w = mount(ShareDialog, {
      props: {
        items: [mk({ id: 'A' })],
        context,
        shares: [mkShare({
          id: 'EXPIRING',
          expiresAt,
          tags: ['customer-facing', 'roadmap-share'],
          metadata: { ownerNote: 'keep me', theme: 'dark', roadmapTitle: 'Existing title' },
        })],
      },
    });
    await toSettings(w);
    await w.get('[data-test="target-existing"]').trigger('click');

    expect(w.get('[data-test="existing-expiry"]').text()).toContain('Canvas expiry is set');
    await w.get('[data-test="submit"]').trigger('click');
    expect(submitted(w)).not.toHaveProperty('expiresAt');
    expect(submitted(w).tags).toEqual(['customer-facing', 'Podcasts & Audiobooks', 'roadmap-share']);
    expect(submitted(w).preservedMetadata).toMatchObject({ ownerNote: 'keep me' });
  });

  it('replaces the previous product tag while preserving unrelated tags', async () => {
    const w = mount(ShareDialog, {
      props: {
        items: [mk({ id: 'A' })], context,
        shares: [mkShare({
          id: 'OTHER-PRODUCT',
          tags: ['Core Platform & Data', 'customer-facing', 'roadmap-share'],
          metadata: { product: 'Core Platform & Data', theme: 'light' },
        })],
      },
    });
    await toSettings(w);
    await w.get('[data-test="target-existing"]').trigger('click');
    await w.get('[data-test="submit"]').trigger('click');

    expect(submitted(w).tags).toEqual(['customer-facing', 'Podcasts & Audiobooks', 'roadmap-share']);
  });

  it('shows all share records and lets private or expired links be recovered in place', async () => {
    const w = mount(ShareDialog, {
      props: {
        items: [mk({ id: 'A' })],
        context,
        shares: [
          mkShare({ id: 'LIVE', status: 'live', title: 'Live share' }),
          mkShare({ id: 'PRIVATE', status: 'private', access: 'private', title: 'Restricted share' }),
          mkShare({ id: 'EXPIRED', status: 'expired', title: 'Expired share', expiresAt: 1 }),
          mkShare({ id: 'REVOKED', status: 'revoked', title: 'Unpublished share', revokedAt: Date.now() }),
          mkShare({ id: 'ARCHIVED', status: 'private', publicationStatus: 'archived', title: 'Archived canvas', version: 'v1' }),
        ],
      },
    });
    await toSettings(w);
    expect(w.find('[data-test="share-row-LIVE"]').exists()).toBe(true);
    expect(w.get('[data-test="share-row-PRIVATE"]').text()).toContain('Restricted');
    expect(w.get('[data-test="share-status-PRIVATE"]').text()).toBe('Published');
    expect(w.get('[data-test="share-row-EXPIRED"]').text()).toContain('Expired');
    expect(w.get('[data-test="share-status-REVOKED"]').text()).toBe('Unpublished');
    expect(w.find('[data-test="share-row-ARCHIVED"]').exists()).toBe(false);
    expect(w.get('[data-test="share-use-PRIVATE"]').attributes('disabled')).toBeUndefined();
    expect(w.get('[data-test="share-use-PRIVATE"]').text()).toBe('Update this share');
    expect(w.get('[data-test="share-use-EXPIRED"]').attributes('disabled')).toBeUndefined();
    expect(w.get('[data-test="share-use-REVOKED"]').attributes('disabled')).toBeUndefined();

    await w.get('input[aria-label="Search existing shares"]').setValue('expired');
    await flushPromises();
    expect(w.find('[data-test="share-row-EXPIRED"]').exists()).toBe(true);
    expect(w.find('[data-test="share-row-LIVE"]').exists()).toBe(false);
    await w.get('input[aria-label="Search existing shares"]').setValue('');
    await flushPromises();

    await w.get('[data-test="share-use-PRIVATE"]').trigger('click');
    await w.get('[data-test="submit"]').trigger('click');
    expect(submitted(w).targetShareId).toBe('PRIVATE');
  });

  it('keeps share badges wrappable and labels a missing expiry without a contradictory prefix', async () => {
    const w = mount(ShareDialog, {
      props: {
        items: [mk({ id: 'A' })],
        context,
        shares: [mkShare({ id: 'LIVE', expiresAt: null, viewerRole: 'owner' })],
      },
    });
    await toSettings(w);

    const row = w.get('[data-test="share-row-LIVE"]');
    const badges = row.get('[data-test="share-badges-LIVE"]');
    expect(badges.classes()).toContain('max-w-full');
    expect(badges.classes()).toContain('flex-wrap');
    expect(badges.classes()).not.toContain('shrink-0');
    expect(row.text()).toContain('No expiry');
    expect(row.text()).not.toContain('Expires No expiry');
  });

  it('lets the author open the created share in a new tab', () => {
    const url = 'https://canvas-drop.example/share';
    const w = mount(ShareDialog, {
      props: {
        items: [mk({ id: 'A' })],
        context,
        result: { url, expiresAt: null, status: 'live', action: 'created' },
      },
    });
    const link = w.get('[data-test="open-result"]');
    expect(link.attributes('href')).toBe(url);
    expect(link.attributes('target')).toBe('_blank');
    expect(link.attributes('rel')).toBe('noreferrer');
  });

  it('shows an unpublished result without presenting its URL as shareable', () => {
    const w = mount(ShareDialog, {
      props: {
        items: [mk({ id: 'A' })], context,
        result: { url: 'https://canvas-drop.example/unpublished', expiresAt: null, accessMode: 'restricted', publicationStatus: 'unpublished', action: 'updated' },
      },
    });

    expect(w.text()).toContain('Unpublished');
    expect(w.text()).toContain('Restricted');
    expect(w.find('[data-test="open-result"]').exists()).toBe(false);
    expect(w.find('[data-test="result-url"]').exists()).toBe(false);
  });

  it('shows a newly created restricted share as published and copyable', () => {
    const w = mount(ShareDialog, {
      props: {
        items: [mk({ id: 'A' })], context,
        result: { url: 'https://canvas-drop.example/restricted', expiresAt: null, accessMode: 'restricted', publicationStatus: 'published', action: 'created' },
      },
    });

    expect(w.text()).toContain('Your share is published');
    expect(w.text()).toContain('Created · Published · Restricted');
    expect(w.text()).toContain('Your share is ready.');
    expect(w.find('[data-test="result-url"]').exists()).toBe(true);
  });

  it('lanes start collapsed and expand to reveal items, keeping the lane select-all', async () => {
    const w = mount(ShareDialog, { props: { items: [mk({ id: 'A', horizon: 'Now' })], context } });
    expect(w.find('[data-test="lane-Now"]').exists()).toBe(true); // select-all always visible
    expect(w.find('[data-test="item-A"]').exists()).toBe(false); // collapsed by default
    await w.get('[data-test="collapse-Now"]').trigger('click');
    expect(w.find('[data-test="item-A"]').exists()).toBe(true); // expanded
  });

  it('requires a password when the password rung is chosen', async () => {
    const w = mount(ShareDialog, { props: { items: [mk({ id: 'A' })], context } });
    await toSettings(w);
    await w.get('[data-test="password-enabled"]').setValue(true);
    await w.get('[data-test="submit"]').trigger('click');
    expect(w.emitted('submit')).toBeUndefined(); // blocked: no password yet
    await w.get('[data-test="password"]').setValue('hunter2');
    await w.get('[data-test="submit"]').trigger('click');
    expect(submitted(w).password).toBe('hunter2');
  });
});
