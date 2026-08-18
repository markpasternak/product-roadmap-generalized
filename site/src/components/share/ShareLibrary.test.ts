import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import ShareLibrary from './ShareLibrary.vue';
import type { AuthoredCanvas } from '../../lib/share/canvasdrop';

const mkShare = (over: Partial<AuthoredCanvas>): AuthoredCanvas => ({
  id: 'S1',
  url: 'https://music-app.canvas-drop.com/s1',
  title: 'Canvas record title',
  tags: ['roadmap-share'],
  access: 'public_link',
  status: 'live',
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
  it('shows only live roadmap shares and hides inactive records', async () => {
    (globalThis as any).canvasdrop = {
      me: vi.fn(async () => ({ id: 'dev', email: 'dev@example.com', name: 'Mark' })),
      canvases: {
        list: vi.fn(async () => [
          mkShare({ id: 'LIVE', title: 'Canvas record title', status: 'live', access: 'password' }),
          mkShare({ id: 'PRIVATE', title: 'Private draft', status: 'private', access: 'private' }),
          mkShare({ id: 'REVOKED', title: 'Disabled link', status: 'revoked', revokedAt: 2 }),
        ]),
        revoke: vi.fn(),
      },
    };

    const w = mount(ShareLibrary, { props: { base: '/roadmap/' } });
    await flushPromises();

    expect(w.get('[data-test="share-title-LIVE"]').text()).toContain('Music App customer roadmap');
    expect(w.text()).toContain('Canvas: Canvas record title');
    expect(w.text()).toContain('Password protected');
    expect(w.text()).toContain('Link requires a password');
    expect(w.text()).toContain('A viewer-facing roadmap intro');
    expect(w.text()).toContain('Signed in as Mark');
    expect(w.text()).toContain('dev@example.com');
    expect(w.text()).not.toContain('Private draft');
    expect(w.text()).not.toContain('Disabled link');
    expect(w.text()).toContain('2 inactive Canvas Drop records hidden');
    expect(w.get('a[href="/roadmap/"]').text()).toBe('Create from roadmap');
    expect(w.get('[data-test="open-canvas-LIVE"]').attributes('href')).toBe('https://canvas-drop.com/canvases/LIVE');
  });
});
