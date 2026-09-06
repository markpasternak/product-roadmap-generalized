import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import type { ParsedActivity } from '../../lib/activity';

const fetchActivityMock = vi.fn<() => Promise<ParsedActivity[]>>();
vi.mock('../../lib/activity', async () => {
  const actual = await vi.importActual<typeof import('../../lib/activity')>('../../lib/activity');
  return { ...actual, fetchActivity: () => fetchActivityMock() };
});

import RecentChanges from './RecentChanges.vue';

const items = [
  { id: 'ITEM-1', title: 'Faster onboarding' },
  { id: 'ITEM-2', title: '<b>Bulk</b> export' },
];

afterEach(() => {
  fetchActivityMock.mockReset();
  localStorage.clear();
});

const rows = (n: number): ParsedActivity[] =>
  Array.from({ length: n }, (_, i) => ({
    sha: `c${i}`,
    htmlUrl: `https://x/c${i}`,
    date: '2026-07-01T00:00:00Z',
    isManual: true,
    login: null,
    updated: 0,
    created: 0,
    deleted: 0,
    reordered: 0,
    changedIds: [],
    changedOverflow: 0,
    deletedIds: [],
    deletedOverflow: 0,
    subject: `Commit ${i}`,
  }));

describe('RecentChanges', () => {
  it('offers a useful empty state and retry on the full activity page', async () => {
    fetchActivityMock.mockResolvedValueOnce([]).mockResolvedValueOnce(rows(1));
    const w = mount(RecentChanges, { props: { items, showEmpty: true, showSeeAll: false } });
    expect(w.get('[role=status]').text()).toContain('Loading');
    await flushPromises();
    expect(w.text()).toContain('No commit activity to show');
    expect(w.get('a[href="/changelog"]').text()).toContain('View item updates');
    await w.get('button').trigger('click');
    await flushPromises();
    expect(w.text()).toContain('Commit 0');
    w.unmount();
  });

  it('renders nothing — no empty box — when the feed is empty', async () => {
    fetchActivityMock.mockResolvedValue([]);
    const w = mount(RecentChanges, { props: { items } });
    await flushPromises();

    expect(w.find('section').exists()).toBe(false);
    expect(w.html()).toBe('<!--v-if-->');
  });

  it('renders a Sync row: who, resolved titles, and a link to the commit', async () => {
    fetchActivityMock.mockResolvedValue([
      {
        sha: 'abc123',
        htmlUrl: 'https://github.com/acme/roadmap/commit/abc123',
        date: '2026-07-01T12:00:00Z',
        isManual: false,
        login: 'octocat',
        updated: 1,
        created: 0,
        deleted: 0,
        reordered: 0,
        changedIds: ['ITEM-1'],
        changedOverflow: 0,
        deletedIds: [],
        deletedOverflow: 0,
        subject: 'roadmap: 1 updated, 0 created, 0 deleted, 0 reordered (via octocat)',
      },
    ]);
    const w = mount(RecentChanges, { props: { items } });
    await flushPromises();

    expect(w.find('section').exists()).toBe(true);
    expect(w.text()).toContain('via octocat');
    expect(w.text()).toContain('Faster onboarding');
    expect(w.find('a[href="https://github.com/acme/roadmap/commit/abc123"]').exists()).toBe(true);
    expect(w.get('a[href="/changes"]').text()).toContain('View all');
  });

  it('falls back to the raw subject for a manual commit, and never renders HTML from item titles', async () => {
    fetchActivityMock.mockResolvedValue([
      {
        sha: 'def456',
        htmlUrl: 'https://github.com/acme/roadmap/commit/def456',
        date: '2026-06-30T00:00:00Z',
        isManual: true,
        login: null,
        updated: 0,
        created: 0,
        deleted: 0,
        reordered: 0,
        changedIds: ['ITEM-2'],
        changedOverflow: 0,
        deletedIds: [],
        deletedOverflow: 0,
        subject: 'Fix typo directly on GitHub',
      },
    ]);
    const w = mount(RecentChanges, { props: { items } });
    await flushPromises();

    expect(w.text()).toContain('Manual edit');
    expect(w.text()).toContain('Fix typo directly on GitHub');
    // A hostile/markup-y item title (from a resolved id) must render as escaped text, not HTML.
    expect(w.html()).not.toContain('<b>Bulk</b>');
  });

  it('hides the "See all" link when showSeeAll is false, and caps rows with limit', async () => {
    fetchActivityMock.mockResolvedValue(
      Array.from({ length: 3 }, (_, i) => ({
        sha: `s${i}`,
        htmlUrl: `https://github.com/acme/roadmap/commit/s${i}`,
        date: '2026-07-01T00:00:00Z',
        isManual: true,
        login: null,
        updated: 0,
        created: 0,
        deleted: 0,
        reordered: 0,
        changedIds: [],
        changedOverflow: 0,
        deletedIds: [],
        deletedOverflow: 0,
        subject: `Manual commit ${i}`,
      })),
    );
    const w = mount(RecentChanges, { props: { items, showSeeAll: false, limit: 2 } });
    await flushPromises();

    expect(w.find('a[href="/changes"]').exists()).toBe(false);
    expect(w.findAll('[data-test="recent-change-row"]')).toHaveLength(2);
  });

  describe('collapse/expand (peek only, persisted)', () => {
    it('shows a collapse toggle on the peek (limit set) but not on the full page', async () => {
      fetchActivityMock.mockResolvedValue(rows(3));
      const peek = mount(RecentChanges, { props: { items, limit: 4 } });
      await flushPromises();
      expect(peek.find('[data-test="recent-changes-toggle"]').exists()).toBe(true);

      fetchActivityMock.mockResolvedValue(rows(3));
      const full = mount(RecentChanges, { props: { items } }); // no limit → full /changes page
      await flushPromises();
      expect(full.find('[data-test="recent-changes-toggle"]').exists()).toBe(false);
    });

    it('collapses the list, shows a count, and persists the state to localStorage', async () => {
      fetchActivityMock.mockResolvedValue(rows(3));
      const w = mount(RecentChanges, { props: { items, limit: 4 }, attachTo: document.body });
      await flushPromises();

      const list = w.get('#recent-changes-list');
      expect(list.isVisible()).toBe(true); // expanded by default
      await w.get('[data-test="recent-changes-toggle"]').trigger('click');

      expect(list.isVisible()).toBe(false); // v-show collapses it
      expect(localStorage.getItem('rm-recent-changes-collapsed')).toBe('1');
      expect(w.get('[data-test="recent-changes-count"]').text()).toContain('3');
      w.unmount();
    });

    it('restores a persisted collapsed state on mount', async () => {
      localStorage.setItem('rm-recent-changes-collapsed', '1');
      fetchActivityMock.mockResolvedValue(rows(2));
      const w = mount(RecentChanges, { props: { items, limit: 4 }, attachTo: document.body });
      await flushPromises();

      expect(w.get('#recent-changes-list').isVisible()).toBe(false);
      expect(w.get('[data-test="recent-changes-toggle"]').attributes('aria-expanded')).toBe('false');
      w.unmount();
    });
  });

  it('ignores a fetch that resolves after unmount instead of writing into the torn-down instance', async () => {
    let resolveFetch!: (v: ParsedActivity[]) => void;
    fetchActivityMock.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    const w = mount(RecentChanges, { props: { items } });
    w.unmount();

    expect(() => resolveFetch([])).not.toThrow();
    await flushPromises();
  });
});
