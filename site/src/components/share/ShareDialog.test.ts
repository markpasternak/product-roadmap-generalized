import { afterEach, describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import ShareDialog from './ShareDialog.vue';
import type { ProjectedItem } from '../../lib/share/project';
import type { AuthoredCanvas } from '../../lib/share/canvasdrop';

const mk = (over: Partial<ProjectedItem>): ProjectedItem => ({
  id: 'TALK-1', title: 'T', oneliner: 'o', outcome: '', product: 'Podcasts & Audiobooks',
  horizon: 'Now', stage: 'Building', tags: [], themes: [], sections: [],
  ...over,
});
const context = { title: 'CM view', product: 'Podcasts & Audiobooks', generatedAt: '2026-07-05' };
const mkShare = (over: Partial<AuthoredCanvas>): AuthoredCanvas => ({
  id: 'S1',
  url: 'https://existing.canvas-drop.com/s1',
  title: 'Canvas record name',
  tags: ['Podcasts & Audiobooks', 'roadmap-share'],
  access: 'public_link',
  status: 'live',
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
});

// The dialog is two-step; the settings + submit controls live on step 2.
const toSettings = (w: ReturnType<typeof mount>) => w.get('[data-test="next"]').trigger('click');
const submitted = (w: ReturnType<typeof mount>) => w.emitted('submit')?.[0]?.[0] as {
  targetShareId: string | null; canvasTitle: string; canvasDescription: string; roadmapTitle: string; roadmapIntro: string;
  access: string; password: string; expiresAt: number; theme: string; items: ProjectedItem[];
};

afterEach(() => vi.restoreAllMocks());

describe('ShareDialog', () => {
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
    expect(p.access).toBe('public_link');
    expect(p.roadmapIntro).toBe('For Q3 we are focused on one-view.');
    expect(p.theme).toBe('light');
    expect(p.items.map((i) => i.id)).toEqual(['A', 'B']);
    expect(p.expiresAt).toBeGreaterThan(Date.now());
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

  it('maps legacy specific-people shares to whole-org copy', async () => {
    const w = mount(ShareDialog, {
      props: {
        items: [mk({ id: 'A' })],
        context,
        shares: [mkShare({ id: 'S1', access: 'specific_people' })],
      },
    });
    await toSettings(w);
    const row = w.get('[data-test="share-row-S1"]');
    expect(row.text()).toContain('Whole org');
    expect(row.text()).toContain('Signed-in org members');
    expect(row.text()).not.toContain('Specific people');

    await w.get('[data-test="target-existing"]').trigger('click');
    await w.get('[data-test="submit"]').trigger('click');
    expect(submitted(w).access).toBe('whole_org');
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
  });

  it('shows managed shares and emits list actions', async () => {
    const w = mount(ShareDialog, {
      props: {
        items: [mk({ id: 'A' })],
        context,
        author: { id: 'dev', email: 'dev@example.com', name: 'Mark' },
        shares: [mkShare({ id: 'S1', access: 'password' })],
      },
    });
    await toSettings(w);
    expect(w.text()).toContain('Signed in as Mark');
    expect(w.get('[data-test="share-title-S1"]').text()).toContain('Viewer roadmap title');
    expect(w.get('[data-test="share-row-S1"]').text()).toContain('Canvas: Canvas record name');
    expect(w.get('[data-test="share-row-S1"]').text()).toContain('Password protected');
    expect(w.get('[data-test="share-row-S1"]').text()).toContain('Link requires a password');
    expect(w.get('[data-test="share-row-S1"]').text()).toContain('Live');
    expect(w.get('[data-test="share-open-canvas-S1"]').attributes('href')).toBe('https://canvas-drop.com/canvases/S1');
    await w.get('[data-test="refresh-shares"]').trigger('click');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await w.get('[data-test="share-revoke-S1"]').trigger('click');
    expect(w.emitted('refreshShares')).toHaveLength(1);
    expect(w.emitted('revoke')?.[0]).toEqual(['S1']);
  });

  it('hides non-live shares from the update list', async () => {
    const w = mount(ShareDialog, {
      props: {
        items: [mk({ id: 'A' })],
        context,
        shares: [
          mkShare({ id: 'LIVE', status: 'live', title: 'Live share' }),
          mkShare({ id: 'PRIVATE', status: 'private', title: 'Private share' }),
          mkShare({ id: 'REVOKED', status: 'revoked', title: 'Revoked share', revokedAt: Date.now() }),
        ],
      },
    });
    await toSettings(w);
    expect(w.find('[data-test="share-row-LIVE"]').exists()).toBe(true);
    expect(w.find('[data-test="share-row-PRIVATE"]').exists()).toBe(false);
    expect(w.find('[data-test="share-row-REVOKED"]').exists()).toBe(false);
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
    await w.get('select').setValue('password');
    await w.get('[data-test="submit"]').trigger('click');
    expect(w.emitted('submit')).toBeUndefined(); // blocked: no password yet
    await w.get('[data-test="password"]').setValue('hunter2');
    await w.get('[data-test="submit"]').trigger('click');
    expect(submitted(w).password).toBe('hunter2');
  });
});
