import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, enableAutoUnmount } from '@vue/test-utils';
import ShareLibrary from './ShareLibrary.vue';
enableAutoUnmount(afterEach);
import type { AuthoredCanvas } from '../../lib/share/canvasdrop';

const mkShare = (over: Partial<AuthoredCanvas>): AuthoredCanvas => ({
  id: 'S1',
  url: 'https://studio.canvas-drop.com/s1',
  title: 'Canvas record title',
  tags: ['roadmap-share'],
  access: 'public_link',
  accessMode: 'public_link',
  hasPassword: false,
  status: 'live',
  publicationStatus: 'published',
  createdAt: 1,
  updatedAt: 3,
  expiresAt: null,
  revokedAt: null,
  createdBy: 'dev',
  version: 'v1',
  bundleUpdatedAt: 3,
  sourceApp: 'product-roadmap',
  sourceKind: 'roadmap-share',
  metadata: {
    product: 'Music App',
    theme: 'dark',
    roadmapTitle: 'Music App customer roadmap',
    roadmapIntro: 'A viewer-facing roadmap intro',
    canvasDescription: 'Board review',
    itemCount: 12,
    laneCount: 3,
  },
  ...over,
});

afterEach(() => {
  delete (globalThis as any).canvasdrop;
  vi.restoreAllMocks();
});

describe('ShareLibrary', () => {
  it('keeps loaded shares available when a refresh fails', async () => {
    const list = vi.fn().mockResolvedValueOnce([mkShare({})]).mockRejectedValueOnce(new Error('Connection lost'));
    (globalThis as any).canvasdrop = { canvases: { list } };
    const w = mount(ShareLibrary, { props: { base: '/' } });
    await flushPromises();
    await w.findAll('button').find((button) => button.text() === 'Refresh')!.trigger('click');
    await flushPromises();
    expect(w.get('[role=alert]').text()).toContain('Connection lost');
    expect(w.find('[data-test="share-open-S1"]').exists()).toBe(true);
    expect(w.findAll('button').some((button) => button.text() === 'Refresh')).toBe(true);
  });

  it('shows a copy error on the relevant share without claiming success', async () => {
    (globalThis as any).canvasdrop = { canvases: { list: async () => [mkShare({})] } };
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(new Error('Denied'));
    const w = mount(ShareLibrary, { props: { base: '/' } });
    await flushPromises();
    await w.get('[data-test="share-copy-S1"]').trigger('click');
    await flushPromises();
    expect(w.get('[data-test="share-copy-S1"]').text()).toBe('Copy link');
    expect(w.get('[data-test="share-card-S1"] [role=alert]').text()).toContain('try again');
  });

  it('requires an explicit unpublish decision and blocks a duplicate request', async () => {
    const revoke = vi.fn(() => new Promise<void>(() => {}));
    (globalThis as any).canvasdrop = { canvases: { list: async () => [mkShare({})], revoke } };
    const w = mount(ShareLibrary, { props: { base: '/' } });
    await flushPromises();
    await w.get('[data-test="share-disable-S1"]').trigger('click');
    expect(revoke).not.toHaveBeenCalled();
    document.querySelector<HTMLButtonElement>('[data-test=cancel-action]')!.click();
    await flushPromises();
    expect(revoke).not.toHaveBeenCalled();
    await w.get('[data-test="share-disable-S1"]').trigger('click');
    document.querySelector<HTMLButtonElement>('[data-test=confirm-action]')!.click();
    await flushPromises();
    await w.get('[data-test="share-disable-S1"]').trigger('click');
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith('S1');
    expect(w.get('[data-test="share-disable-S1"]').attributes('disabled')).toBeDefined();
  });

  it('shows live and inactive roadmap shares with truthful recovery states', async () => {
    const list = vi.fn(async () => [
      mkShare({
        id: 'LIVE', title: 'Canvas record title', status: 'live', hasPassword: true, tags: [],
        discoverability: 'link_only', galleryTemplatable: true, viewerRole: 'editor',
        audienceSummary: { count: 1, names: ['Customers'] },
      }),
      mkShare({ id: 'PRIVATE', title: 'Restricted share', status: 'private', access: 'private', accessMode: 'restricted' }),
      mkShare({ id: 'EXPIRED', title: 'Expired link', status: 'expired', publicationStatus: 'expired', expiresAt: 2 }),
      mkShare({ id: 'REVOKED', title: 'Unpublished link', status: 'revoked', publicationStatus: 'unpublished', revokedAt: 2 }),
      mkShare({ id: 'PEOPLE', title: 'People link', access: 'specific_people', accessMode: 'restricted' }),
      mkShare({ id: 'TEAM', title: 'Team link', access: 'team', accessMode: 'restricted', audienceSummary: { count: 2, names: ['R&D', 'Leadership'] } }),
      mkShare({ id: 'ORG', title: 'Org link', access: 'whole_org', accessMode: 'whole_org' }),
      mkShare({ id: 'ARCHIVED', title: 'Archived canvas', status: 'private', publicationStatus: 'archived', access: 'private', accessMode: 'restricted' }),
    ]);
    (globalThis as any).canvasdrop = {
      me: vi.fn(async () => ({ id: 'dev', email: 'dev@example.com', name: 'Mark' })),
      canvases: {
        list,
        revoke: vi.fn(),
      },
    };

    const w = mount(ShareLibrary, { props: { base: '/roadmap/' } });
    await flushPromises();

    expect(list).toHaveBeenCalledWith({ sourceApp: 'product-roadmap', sourceKind: 'roadmap-share' });

    expect(w.get('[data-test="share-title-LIVE"]').text()).toContain('Music App customer roadmap');
    expect(w.text()).toContain('Canvas: Canvas record title');
    expect(w.text()).toContain('Password protected');
    expect(w.get('[data-test="share-card-LIVE"]').text()).toContain('Public link');
    expect(w.get('[data-test="share-card-LIVE"]').text()).toContain('Anyone with the link');
    expect(w.get('[data-test="share-card-PEOPLE"]').text()).toContain('Restricted');
    expect(w.get('[data-test="share-card-PEOPLE"]').text()).toContain('people or teams added in Canvas Drop');
    expect(w.get('[data-test="share-card-TEAM"]').text()).toContain('Restricted');
    expect(w.get('[data-test="share-card-TEAM"]').text()).toContain('R&D, Leadership');
    expect(w.get('[data-test="share-card-ORG"]').text()).toContain('Anyone in your org');
    expect(w.get('[data-test="share-card-LIVE"]').text()).toContain('1 added person or team');
    expect(w.get('[data-test="share-card-LIVE"]').text()).toContain('Link only');
    expect(w.get('[data-test="share-card-LIVE"]').text()).toContain('Reusable template');
    expect(w.get('[data-test="share-card-LIVE"]').text()).toContain('editor');
    expect(w.text()).toContain('A viewer-facing roadmap intro');
    expect(w.get('[data-test="share-status-LIVE"]').text()).toBe('Published');
    expect(w.get('[data-test="share-status-PRIVATE"]').text()).toBe('Published');
    expect(w.get('[data-test="share-card-PRIVATE"]').text()).toContain('Restricted');
    expect(w.get('[data-test="share-status-EXPIRED"]').text()).toBe('Expired');
    expect(w.get('[data-test="share-status-REVOKED"]').text()).toBe('Unpublished');
    expect(w.get('[data-test="share-title-PRIVATE"]').text()).toContain('Music App customer roadmap');
    expect(w.get('[data-test="share-title-EXPIRED"]').text()).toContain('Music App customer roadmap');
    expect(w.get('[data-test="share-title-REVOKED"]').text()).toContain('Music App customer roadmap');
    expect(w.get('[data-test="share-card-EXPIRED"]').text()).toContain('Content updates preserve this expired date');
    expect(w.get('[data-test="share-card-REVOKED"]').text()).toContain('republishes at the same URL while preserving its current access');
    expect(w.find('[data-test="share-card-ARCHIVED"]').exists()).toBe(false);
    expect(w.find('[data-test="share-open-PRIVATE"]').exists()).toBe(true);
    expect(w.find('[data-test="share-copy-PRIVATE"]').exists()).toBe(true);
    expect(w.find('[data-test="share-disable-PRIVATE"]').exists()).toBe(true);
    expect(w.get('[data-test="share-disable-LIVE"]').text()).toBe('Unpublish');
    expect(w.get('a[href="/roadmap/"]').text()).toBe('Create from roadmap');
    expect(w.get('[data-test="open-canvas-LIVE"]').attributes('href')).toBe('https://canvas-drop.com/canvases/LIVE');

    await w.get('select[aria-label="Share status"]').setValue('unpublished');
    await flushPromises();
    expect(w.find('[data-test="share-card-REVOKED"]').exists()).toBe(true);
    expect(w.find('[data-test="share-card-LIVE"]').exists()).toBe(false);

    await w.get('select[aria-label="Share status"]').setValue('all');
    await w.get('select[aria-label="Share audience"]').setValue('restricted');
    await flushPromises();
    expect(w.find('[data-test="share-card-TEAM"]').exists()).toBe(true);
    expect(w.find('[data-test="share-card-LIVE"]').exists()).toBe(false);
    expect(w.find('[data-test="share-card-PRIVATE"]').exists()).toBe(true);

    await w.get('select[aria-label="Share audience"]').setValue('all');
    await w.get('select[aria-label="Share protection"]').setValue('password');
    await flushPromises();
    expect(w.find('[data-test="share-card-LIVE"]').exists()).toBe(true);
    expect(w.find('[data-test="share-card-TEAM"]').exists()).toBe(false);

    await w.get('select[aria-label="Share protection"]').setValue('all');
    await w.get('input[aria-label="Search shares"]').setValue('does not exist');
    await vi.waitFor(() => expect(w.text()).toContain('No matching share links'));
    await w.get('[data-test="clear-share-filters"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-test="share-card-LIVE"]').exists()).toBe(true);
  });
});
