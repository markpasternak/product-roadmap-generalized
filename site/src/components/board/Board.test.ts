import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { flushPromises } from '@vue/test-utils';
import type { ItemVM } from '../../lib/filters';
import { PRODUCTS } from '../../lib/schema';
import { BOARD_VIEW_STORAGE_KEY } from '../../lib/boardViewState';

// Board pulls in a lot of real child components (drawer, editors, share dialog); auto-stub
// them via `global.stubs: true` below so this test only exercises Board's own script:
// U4 edit-mode persistence/auto-resume, and U9's newer-version reload affordance
// (including the clear-vs-keep predicate in reloadToLatest).
const meMock = vi.fn(async () => ({ editor: true, login: 'octocat' }));
const syncMock = vi.fn();
// U4 (R4/R5/KTD4): defaults to "unavailable" (null) so every test not explicitly exercising
// the deploy-status poll degrades silently — matching real behavior in local dev / when the
// endpoint 401s — rather than needing every existing doSync test to also mock it.
const deployStatusMock = vi.fn(async () => null as null | { status: string; conclusion: string; headSha: string; htmlUrl: string });
let newVersionCb: (() => void) | null = null;
const watchForNewVersionMock = vi.fn((cb: () => void, _intervalMs?: number) => {
  newVersionCb = cb;
  return vi.fn();
});

vi.mock('../../lib/edit/client', () => ({
  EDIT_API: 'https://edit.example.test',
  authedRequest: vi.fn(async (path:string) => new Response(JSON.stringify(path==='/api/assets'?[]:{revision:0,data:null}),{status:200,headers:{'Content-Type':'application/json'}})),
  publicationStatus: vi.fn(async () => ({ok:false})),
  clearToken: vi.fn(),
  rememberSignInLocation: vi.fn(),
  readTokenFromHash: vi.fn(() => null),
  me: (...args: unknown[]) => meMock(...(args as [])),
  loginUrl: vi.fn(() => '#'),
  fetchItems: vi.fn(async () => []),
  sync: (...args: unknown[]) => syncMock(...(args as [])),
  deployStatus: (...args: unknown[]) => deployStatusMock(...(args as [])),
  // RecentChanges (U2) resolves the activity feed through the same session
  // token the rest of the edit client uses — no token means no fetch (R14),
  // so the peek simply doesn't render in these tests.
  getToken: vi.fn(() => null),
}));
vi.mock('../../lib/share/canvasdrop', () => ({
  getCanvasdrop: vi.fn(() => null),
  updateAuthoredCanvas: vi.fn(),
}));
vi.mock('../../lib/edit/version', () => ({
  fetchDeployedCommit: vi.fn(async () => null),
  watchForNewVersion: (cb: () => void, intervalMs?: number) => watchForNewVersionMock(cb, intervalMs),
}));

import Board from './Board.vue';
import { useEditStore, KEY } from '../../lib/edit/store';

const item = (over: Partial<ItemVM> = {}): ItemVM => ({
  id: 'TALK-1', title: 'Existing item', product: 'Podcasts & Audiobooks',
  horizon: 'Now', stage: 'Building', owner: 'mark@example.com',
  impact: 'High', effort: 'Low', visibility: 'Internal', order: 1, updated: '2026-07-01',
  tags: ['workflow'], themes: ['one-view'], oneliner: 'An existing card',
  outcome: 'The outcome', sections: [{ heading: 'Why it matters', text: 'because' }],
  editUrl: 'https://github.com/edit/x', links: [], text: 'haystack', href: '/item/TALK-1',
  ...over,
});

let wrappers: VueWrapper[] = [];
async function mountBoard(items: ItemVM[] = [item()]) {
  const w = mount(Board, {
    props: { items },
    global: { stubs: { transition: false, ResourceEditor: { template: '<div><slot /></div>' } } },
  });
  wrappers.push(w);
  await flushPromises();
  return w;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/'); // ?horizon=/?item= in the URL leaks between tests
  meMock.mockClear();
  meMock.mockResolvedValue({ editor: true, login: 'octocat' });
  syncMock.mockReset();
  deployStatusMock.mockReset();
  deployStatusMock.mockResolvedValue(null);
  watchForNewVersionMock.mockClear();
  newVersionCb = null;
  vi.spyOn(window.location, 'reload').mockImplementation(() => {});
});

afterEach(() => {
  for (const w of wrappers) w.unmount();
  wrappers = [];
  useEditStore().clear();
  useEditStore().clearCommit();
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('Board — product navigation and view options', () => {
  it('distinguishes an empty roadmap from a filter with no matches', async () => {
    const w = await mountBoard([]);
    expect(w.text()).toContain('No roadmap items yet');
    expect(w.text()).not.toContain('No matching roadmap items');
    expect(w.findAll('button').some((button) => button.text() === 'Clear all filters')).toBe(false);
    const filtered = await mountBoard([item()]);
    await filtered.get('input[type="search"]').setValue('zzzz-no-match');
    await filtered.get('input[type="search"]').trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(filtered.text()).toContain('No matching roadmap items');
    expect(filtered.findAll('button').some((button) => button.text() === 'Clear all filters')).toBe(true);
  });

  it('restores legacy filter links without reviving removed shortcuts', async () => {
    window.history.replaceState(null, '', '/?hygiene=now-early&horizon=Now&sort=updated');
    const w = await mountBoard([item({ stage: 'Shaping' })]);
    expect(w.get('button[aria-label="View options and saved views"]').text()).toBe('View');
    expect(w.get('[aria-label="Roadmap views"]').text()).not.toContain('Modified');
  });

  it('counts only visible horizons in the mobile filter confirmation', async () => {
    const w = await mountBoard([item(), item({ id: 'TALK-2', horizon: 'Completed' })]);
    (w.vm as unknown as { sheetOpen: boolean }).sheetOpen = true;
    await flushPromises();
    expect(w.find('[role="dialog"][aria-label="Filters"]').text()).toContain('Show 1 item');
  });

  it('filters products from the main navigation while preserving the chosen horizon', async () => {
    window.history.replaceState(null, '', '/?horizon=Now');
    const w = await mountBoard([item(), item({ id: 'MUSIC-1', product: 'Music App' }), item({ id: 'MUSIC-2', product: 'Music App', horizon: 'Next' })]);
    const navigation = w.find('[aria-label="Filter by product"]');
    await navigation.setValue('Music App');
    expect((navigation.element as HTMLSelectElement).value).toBe('Music App');
    expect(w.find('[data-filter-kind="product"]').exists()).toBe(false);
    expect(w.findAllComponents({ name: 'RoadmapCard' }).map((card) => card.props('item').id)).toEqual(['MUSIC-1']);
    expect(window.location.pathname).toBe('/music-app/');
    expect(new URLSearchParams(window.location.search).getAll('horizon')).toEqual(['Now']);
    await navigation.setValue('');
    expect(w.findAllComponents({ name: 'RoadmapCard' })).toHaveLength(2);
  });

  it('shows product shorthand only when mixed products share horizon lanes', async () => {
    const w = await mountBoard([item(), item({ id: 'MUSIC-1', product: 'Music App' })]);
    const cards = () => w.findAllComponents({ name: 'RoadmapCard' });
    expect(cards().map(card => card.props('showProduct'))).toEqual([true, true]);

    const navigation = w.find('[aria-label="Filter by product"]');
    await navigation.setValue('Music App');
    expect(cards().map(card => card.props('showProduct'))).toEqual([false]);

    await navigation.setValue('');
    await w.get('[aria-label="View options and saved views"]').trigger('click');
    await w.get('select[name="group"]').setValue('product');
    expect(cards().map(card => [card.props('showProduct'), card.props('showHorizon')])).toEqual([
      [false, true], [false, true],
    ]);
  });

  it('restores historical activity from a link, ignores retired resource filters, and clears the activity chip', async () => {
    localStorage.setItem('rm-sidebar', '1');
    window.history.replaceState(null, '', '/?asset=missing&activity=updated&from=2026-08-01&to=2026-08-31&tz=UTC');
    const w = await mountBoard([
      item({ id: 'TALK-1', updated: '2026-09-06', activityDates: ['2026-08-04T12:00:00Z', '2026-09-06T12:00:00Z'] }),
      item({ id: 'TALK-2', updated: '2026-09-06', activityDates: ['2026-09-06T12:00:00Z'] }),
    ]);
    expect(w.findAllComponents({ name: 'RoadmapCard' }).map(card => card.props('item').id)).toEqual(['TALK-1']);
    expect(w.text()).not.toContain('Linked resources');
    expect(window.location.search).not.toContain('asset=');
    expect(w.get('[data-filter-kind="activity"]').text()).toContain('Aug 1, 2026');
    (w.vm as unknown as { sheetOpen: boolean }).sheetOpen = true;
    await flushPromises();
    expect((w.get('#sheet-activity-from').element as HTMLInputElement).value).toBe('2026-08-01');
    await w.get('[data-filter-kind="activity"] button').trigger('click');
    expect(w.findAllComponents({ name: 'RoadmapCard' })).toHaveLength(2);
    expect(window.location.search).not.toContain('activity=');
  });

  it('keeps visibility in Filters, separate from layout, with URL and chip recovery', async () => {
    localStorage.setItem('rm-sidebar', '1');
    const w = await mountBoard([item(), item({ id: 'TALK-2', visibility: 'Public' })]);
    await w.get('[aria-label="View options and saved views"]').trigger('click');
    expect(w.get('.compact-view-settings').text()).not.toContain('Visibility');
    await w.get('[aria-label="Close views"]').trigger('click');
    await w.get('button[aria-label="Filters"]').trigger('click');
    await w.get('#sheet-visibility').setValue('Public');
    expect(w.findAllComponents({ name: 'RoadmapCard' }).map((card) => card.props('item').id)).toEqual(['TALK-2']);
    expect(window.location.search).toContain('visibility=Public');
    expect(w.get('[data-filter-kind="visibility"]').text()).toContain('Public');
    (w.vm as unknown as { sheetOpen: boolean }).sheetOpen = true;
    await flushPromises();
    expect((w.get('#sheet-visibility').element as HTMLSelectElement).value).toBe('Public');
    await w.get('#sheet-visibility').setValue('Internal');
    expect((w.get('#sheet-visibility').element as HTMLSelectElement).value).toBe('Internal');
    expect(w.findAllComponents({ name: 'RoadmapCard' }).map((card) => card.props('item').id)).toEqual(['TALK-1']);
    await w.get('[data-test="active-filter-clear"]').trigger('click');
    expect(w.findAllComponents({ name: 'RoadmapCard' })).toHaveLength(2);
    expect(window.location.search).not.toContain('visibility');
  });

  it('keeps signed-out board actions focused on viewing', async () => {
    meMock.mockResolvedValue({ editor: false, login: '' });
    const w = await mountBoard();
    expect(w.find('[data-test="sign-in-to-edit"]').exists()).toBe(false);
    expect(w.find('[data-test="edit-toggle"]').exists()).toBe(false);
    expect(w.get('[aria-controls="board-more-actions"]').text()).toContain('More');
  });

  it('opens a clean completed-item link with its lane and item navigation available', async () => {
    meMock.mockResolvedValue({ editor: false, login: '' });
    window.history.replaceState(null, '', '/?item=CM-2');
    const w = await mountBoard([item(), item({ id: 'CM-2', horizon: 'Completed' })]);
    const vm = w.vm as unknown as { selected: ItemVM | null; horizons: string[] };
    expect(vm.selected?.id).toBe('CM-2');
    expect(vm.horizons).toContain('Completed');
    expect(w.find('[aria-label="Previous item"]').exists()).toBe(true);
  });

  it('keeps the layout, product and visible horizons when clearing additional filters', async () => {
    const w = await mountBoard();
    const vm = w.vm as unknown as { filters: ReturnType<typeof import('../../lib/filters').emptyFilters>; horizons: string[] };
    const product = item().product;
    Object.assign(vm.filters, { product, layout: 'timeline', owner: 'Someone' });
    vm.horizons = ['Now'];
    await flushPromises();
    await w.get('button[aria-label="Filters"]').trigger('click');
    const sheet = w.get('[role="dialog"][aria-label="Filters"]');
    await sheet.findAll('button').find(button => button.text() === 'Clear all')!.trigger('click');
    expect(vm.filters.product).toBe(product);
    expect(vm.filters.layout).toBe('timeline');
    expect(vm.filters.owner).toBeNull();
    expect(vm.horizons).toEqual(['Now']);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flushPromises();
    expect(w.get('button[aria-label="Filters"]').attributes('aria-expanded')).toBe('false');
  });

  it('discloses view settings without clearing them when closed', async () => {
    const w = await mountBoard();
    const toggle = w.find('[aria-label="View options and saved views"]');
    expect(toggle.attributes('aria-expanded')).toBe('false');
    await toggle.trigger('click');
    expect(toggle.attributes('aria-expanded')).toBe('true');
    await w.find('select[name="sort"]').setValue('title');
    await toggle.trigger('click');
    expect(toggle.attributes('aria-expanded')).toBe('false');
    await toggle.trigger('click');
    expect((w.find('select[name="sort"]').element as HTMLSelectElement).value).toBe('title');
    expect(new URLSearchParams(window.location.search).get('sort')).toBeNull();
    expect(JSON.parse(localStorage.getItem(BOARD_VIEW_STORAGE_KEY)!).sort).toBe('title');
  });
});

describe('Board — abandoned-add discard on editor close (final review fix 2)', () => {
  it('discards a just-created item left with an empty title when the editor closes', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    const store = useEditStore();
    const id = store.addItem('Podcasts & Audiobooks', '', { horizon: 'Next' });
    (w.vm as unknown as { editingId: string | null }).editingId = id;
    await flushPromises();

    (w.vm as unknown as { onEditorClose: () => void }).onEditorClose();

    expect(store.changeset().created).toEqual([]);
    expect((w.vm as unknown as { editingId: string | null }).editingId).toBeNull();
  });

  it('keeps a just-created item once it has been given a real title', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    const store = useEditStore();
    const id = store.addItem('Podcasts & Audiobooks', '', { horizon: 'Next' });
    store.setField(id, 'title', 'A real title');
    (w.vm as unknown as { editingId: string | null }).editingId = id;
    await flushPromises();

    (w.vm as unknown as { onEditorClose: () => void }).onEditorClose();

    expect(store.changeset().created).toHaveLength(1);
  });
});

describe('Board — reorder guard (canReorder)', () => {
  it('is false by default: manual sort but no product filter narrows to one product', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    expect((w.vm as unknown as { canReorder: boolean }).canReorder).toBe(false);
    expect(w.find('[data-test="reorder-hint"]').text()).toContain('filter to one product');
  });

  it('is true once scoped to one product, manual sort, with no other active filters', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    const vm = w.vm as unknown as { filters: { product: string | null }; sort: string; canReorder: boolean };
    vm.filters.product = 'Podcasts & Audiobooks';
    vm.sort = 'manual';
    await flushPromises();

    expect(vm.canReorder).toBe(true);
    expect(w.find('[data-test="reorder-hint"]').text()).toContain('Drag');
  });

  it('is false again once another filter is layered on top of the product scope', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    const vm = w.vm as unknown as {
      filters: { product: string | null; stage: string[] };
      sort: string;
      canReorder: boolean;
    };
    vm.filters.product = 'Podcasts & Audiobooks';
    vm.sort = 'manual';
    vm.filters.stage = ['Building'];
    await flushPromises();

    expect(vm.canReorder).toBe(false);
  });

  it('is false when sorted by anything other than Priority (manual)', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    const vm = w.vm as unknown as { filters: { product: string | null }; sort: string; canReorder: boolean };
    vm.filters.product = 'Podcasts & Audiobooks';
    vm.sort = 'impact';
    await flushPromises();

    expect(vm.canReorder).toBe(false);
  });
});

// Board's drag-to-reorder/move is implemented on top of SortableJS (see Board.vue's
// "SortableJS wiring" section) — actually simulating a real Sortable drag isn't worth it
// here, so these tests exercise the pure store-translation function (`onLaneSortEnd`)
// directly with synthetic from-lane/to-lane/item/index args, exactly as Sortable's real
// `onEnd` handler calls it once it has resolved those from the DOM.
describe('Board — drag a card between lanes to change its horizon', () => {
  type DragVM = {
    onLaneSortEnd: (fromKey: string, toKey: string, itemId: string, newIndex: number) => void;
  };

  it('cross-lane drop, grouped by horizon, sets the dragged card\'s horizon via editStore.setField', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard([item({ id: 'TALK-1', horizon: 'Now' }), item({ id: 'TALK-2', horizon: 'Next' })]);
    const vm = w.vm as unknown as DragVM;

    vm.onLaneSortEnd('Now', 'Next', 'TALK-1', 0);
    await flushPromises();

    expect(useEditStore().fieldValue('TALK-1', 'horizon')).toBe('Next');
  });

  it('same-lane drop reorders only when canReorder is true', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard([
      item({ id: 'TALK-1', horizon: 'Now', order: 1 }),
      item({ id: 'TALK-2', horizon: 'Now', order: 2 }),
    ]);
    const vm = w.vm as unknown as DragVM & { filters: { product: string | null } };

    // canReorder is false here (no product filter narrowing the lane) — same-lane drop no-ops.
    vm.onLaneSortEnd('Now', 'Now', 'TALK-2', 0);
    await flushPromises();
    expect(useEditStore().changeset().reorder).toEqual({});
    expect(useEditStore().fieldValue('TALK-2', 'horizon')).toBeUndefined();

    // Scope to one product (manual sort is already the default) — now it reorders. TALK-2
    // (index 1) moves to index 0, ahead of TALK-1.
    vm.filters.product = 'Podcasts & Audiobooks';
    await flushPromises();
    vm.onLaneSortEnd('Now', 'Now', 'TALK-2', 0);
    await flushPromises();

    expect(useEditStore().changeset().reorder['Podcasts & Audiobooks']?.Now).toEqual(['TALK-2', 'TALK-1']);
  });

  it('grouped by product, a cross-lane (cross-product) drop is a no-op', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard([
      item({ id: 'TALK-1', product: 'Podcasts & Audiobooks', horizon: 'Now' }),
      item({ id: 'ST-1', product: 'Music App', horizon: 'Now', title: 'Music App item' }),
    ]);
    const vm = w.vm as unknown as DragVM & { filters: { group: 'horizon' | 'product' } };
    vm.filters.group = 'product';
    await flushPromises();

    vm.onLaneSortEnd('Podcasts & Audiobooks', 'Music App', 'TALK-1', 0);
    await flushPromises();

    expect(useEditStore().fieldValue('TALK-1', 'product')).toBeUndefined();
    expect(useEditStore().fieldValue('TALK-1', 'horizon')).toBeUndefined();
    expect(useEditStore().changeset().reorder).toEqual({});
  });

  it('ignores a drop of a card flagged pending deleted', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard([item({ id: 'TALK-1', horizon: 'Now' }), item({ id: 'TALK-2', horizon: 'Next' })]);
    useEditStore().deleteItem('TALK-1');
    await flushPromises();
    const vm = w.vm as unknown as DragVM;

    vm.onLaneSortEnd('Now', 'Next', 'TALK-1', 0);
    await flushPromises();

    expect(useEditStore().fieldValue('TALK-1', 'horizon')).toBeUndefined();
  });

  it('ignores a drop back at the same position — no reorder recorded even when canReorder is true', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard([
      item({ id: 'TALK-1', horizon: 'Now', order: 1 }),
      item({ id: 'TALK-2', horizon: 'Now', order: 2 }),
    ]);
    const vm = w.vm as unknown as DragVM & { filters: { product: string | null } };
    vm.filters.product = 'Podcasts & Audiobooks';
    await flushPromises();

    // TALK-1 is already at index 0 — dropping it back at index 0 is a no-op.
    vm.onLaneSortEnd('Now', 'Now', 'TALK-1', 0);
    await flushPromises();

    expect(useEditStore().changeset().reorder).toEqual({});
  });

  it('shows the drag handle once editMode is on, independent of canReorder', async () => {
    const w = await mountBoard([item({ id: 'TALK-1' })]);
    const vm = w.vm as unknown as { editMode: boolean; canReorder: boolean };
    vm.editMode = true;
    await flushPromises();

    expect(vm.canReorder).toBe(false);
    expect(w.find('[data-test="drag-handle"]').exists()).toBe(true);
  });

  it('resets draggingId and dragOverLaneKey once a move is applied', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard([item({ id: 'TALK-1', horizon: 'Now' }), item({ id: 'TALK-2', horizon: 'Next' })]);
    const vm = w.vm as unknown as DragVM & { draggingId: string | null; dragOverLaneKey: string | null };

    // Simulate what Sortable's onStart/onMove would have set while the drag was in flight.
    vm.draggingId = 'TALK-1';
    vm.dragOverLaneKey = 'Next';

    vm.onLaneSortEnd('Now', 'Next', 'TALK-1', 0);
    await flushPromises();

    expect(vm.draggingId).toBeNull();
    expect(vm.dragOverLaneKey).toBeNull();
  });
});

describe('Board — tag suggestions fed to the editor', () => {
  it('collects every distinct tag across the whole board for `allTags`', async () => {
    const w = await mountBoard([
      item({ id: 'TALK-1', tags: ['workflow', 'beta'] }),
      item({ id: 'TALK-2', tags: ['beta', 'launch'] }),
    ]);

    expect((w.vm as unknown as { allTags: string[] }).allTags).toEqual(['beta', 'launch', 'workflow']);
  });
});

describe('Board — owner suggestions fed to the editor (fix #4)', () => {
  it('collects every distinct owner across the whole board for `allOwners`, sorted', async () => {
    const w = await mountBoard([
      item({ id: 'TALK-1', owner: 'Priya' }),
      item({ id: 'TALK-2', owner: 'Jules' }),
      item({ id: 'TALK-3', owner: 'Priya' }),
    ]);

    expect((w.vm as unknown as { allOwners: string[] }).allOwners).toEqual(['Jules', 'Priya']);
  });

  it('excludes the "Unassigned" placeholder and blank owners from `allOwners`', async () => {
    const w = await mountBoard([
      item({ id: 'TALK-1', owner: 'Unassigned' }),
      item({ id: 'TALK-2', owner: '' }),
      item({ id: 'TALK-3', owner: 'Priya' }),
    ]);

    expect((w.vm as unknown as { allOwners: string[] }).allOwners).toEqual(['Priya']);
  });
});

describe('Board — wires RoadmapCard `editing` separately from `draggable` (fix #1)', () => {
  it('shows the per-card dirty marker in edit mode even when reordering is not active', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');
    await flushPromises();

    // canReorder is false here (no product filter narrowing the lane) — draggable is gated
    // on it, but the per-card dirty dot/discard affordance must still show; those are gated
    // on `editing` (canEdit && editMode), independently.
    expect((w.vm as unknown as { canReorder: boolean }).canReorder).toBe(false);
    expect(w.find('[data-test="dirty-dot"]').exists()).toBe(true);
    expect(w.find('[data-test="discard-item"]').exists()).toBe(true);
  });
});

describe('Board — confirm before discarding all (fix #2)', () => {
  it('does not clear the draft when the confirmation is dismissed', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    const store = useEditStore();
    store.setField('TALK-1', 'title', 'Edited title');


    (w.vm as unknown as { onDiscardAll: () => void }).onDiscardAll();

    await flushPromises();
    expect(document.querySelector('[role=alertdialog]')?.textContent).toContain('1 unpublished change');
    document.querySelector<HTMLButtonElement>('[data-test=cancel-action]')!.click();
    await flushPromises();
    expect(store.dirtyCount.value).toBe(1);
  });

  it('clears the draft once the confirmation is accepted', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    const store = useEditStore();
    store.setField('TALK-1', 'title', 'Edited title');


    (w.vm as unknown as { onDiscardAll: () => void }).onDiscardAll();
    await flushPromises();
    document.querySelector<HTMLButtonElement>('[data-test=confirm-action]')!.click();
    await flushPromises();
    expect(store.dirtyCount.value).toBe(0);
  });
});

describe('Board — pre-Sync title validation (fix #3, now via the general U5 validation pass)', () => {
  it('blocks Sync and surfaces a friendly message naming the product when a new item has no title (fix #10)', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    useEditStore().addItem('Podcasts & Audiobooks', '', { horizon: 'Next' });

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    expect(syncMock).not.toHaveBeenCalled();
    const bar = w.find('[data-test="save-status"]');
    // No title yet to name the item by, so — like the old ad-hoc check — it names the
    // product instead (see validate.ts's `displayNameFor` fallback in Board.vue).
    expect(bar.text()).toContain('Podcasts & Audiobooks');
    expect(bar.text()).toContain('title is required');
  });

  it('names each untitled new item independently, one per product (fix #10)', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    const store = useEditStore();
    store.addItem('Podcasts & Audiobooks', '', { horizon: 'Next' });
    store.addItem('Music App', '   ', { horizon: 'Next' });

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    const text = w.find('[data-test="save-status"]').text();
    expect(text).toContain('Podcasts & Audiobooks');
    expect(text).toContain('Music App');
    expect(text).toContain('title is required');
  });

  it('proceeds with Sync once every new item has a title', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: true, sha: 'abc123' });
    const w = await mountBoard();
    useEditStore().addItem('Podcasts & Audiobooks', 'A real title', { horizon: 'Next' });

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    expect(syncMock).toHaveBeenCalledTimes(1);
  });

  it('does not leave a stale "Publishing…" state masking the validation message', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: true, sha: 'abc123' });
    const w = await mountBoard();
    const store = useEditStore();
    store.setField('TALK-1', 'title', 'Edited title');
    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    store.addItem('Podcasts & Audiobooks', '', { horizon: 'Next' });
    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    const bar = w.find('[data-test="save-status"]');
    expect(bar.text()).not.toContain('Publishing');
    expect(bar.text()).toContain('title is required');
  });
});

describe('Board — pre-Sync validation (U5/R6): every ValidateFrontmatter-enforced field, not just title/owner', () => {
  it('blocks Sync and names the item + field for an invalid enum value (e.g. a bad horizon)', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard([item({ id: 'TALK-1', title: 'Music App Templates' })]);
    useEditStore().setField('TALK-1', 'horizon', 'Sonn');

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    expect(syncMock).not.toHaveBeenCalled();
    const text = w.find('[data-test="save-status"]').text();
    expect(text).toContain('Music App Templates');
    expect(text).toContain('horizon "Sonn" isn\'t a valid horizon');
  });

  it('blocks Sync on a malformed tags value (client-only check, no server rule)', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard([item({ id: 'TALK-1', title: 'Music App Templates' })]);
    useEditStore().setField('TALK-1', 'tags', 'Roadmap, ai');

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    expect(syncMock).not.toHaveBeenCalled();
    const text = w.find('[data-test="save-status"]').text();
    expect(text).toContain('Music App Templates');
    expect(text).toContain('lowercase');
  });

  it('blocks Sync on a YAML-unsafe title (client-only check, no server rule)', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard([item({ id: 'TALK-1', title: 'Music App Templates' })]);
    useEditStore().setField('TALK-1', 'title', '2024');

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    expect(syncMock).not.toHaveBeenCalled();
    const text = w.find('[data-test="save-status"]').text();
    expect(text).toContain('title "2024" reads as a number');
  });

  it('proceeds with Sync when the changeset is fully valid', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: true, sha: 'abc123' });
    const w = await mountBoard([item({ id: 'TALK-1', title: 'Music App Templates' })]);
    useEditStore().setField('TALK-1', 'stage', 'Shipped');

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    expect(syncMock).toHaveBeenCalledTimes(1);
  });
});

describe('Board — reconcile body edits once raw bodies land (fix #4)', () => {
  it('drops a body edit that already matches the freshly-fetched raw source', async () => {
    const { fetchItems } = await import('../../lib/edit/client');
    (fetchItems as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: 'TALK-1', body: 'Published body text' },
    ]);
    localStorage.setItem('rm-edit-mode', '1');
    const store = useEditStore();
    store.setBody('TALK-1', 'Published body text');

    await mountBoard();
    await flushPromises();

    expect(store.changeset().updated).toEqual([]);
    expect(store.dirtyCount.value).toBe(0);
  });

  it('keeps a body edit that still differs from the freshly-fetched raw source', async () => {
    const { fetchItems } = await import('../../lib/edit/client');
    (fetchItems as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: 'TALK-1', body: 'Published body text' },
    ]);
    localStorage.setItem('rm-edit-mode', '1');
    const store = useEditStore();
    store.setBody('TALK-1', 'Still-unsynced body text');

    await mountBoard();
    await flushPromises();

    expect(store.changeset().updated.find((u) => u.id === 'TALK-1')?.body).toBe('Still-unsynced body text');
  });

  it('a failed raw-bodies fetch resets the request guard so a later editMode toggle retries (not a permanent lock)', async () => {
    const { fetchItems } = await import('../../lib/edit/client');
    (fetchItems as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('network down'));
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');

    // The failed fetch left baseVersionLoaded false — doSync fail-closes (R1) rather than
    // sending an update with no base version to check a conflict against.
    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();
    expect(syncMock).not.toHaveBeenCalled();
    expect(w.find('[data-test="save-status"]').text()).toContain('Still loading your workspace');

    // Toggling edit mode off and back on fires the raw-bodies fetch again — if the guard
    // weren't reset on failure, this retry would never even attempt the fetch and Sync would
    // stay permanently blocked until a hard reload.
    (fetchItems as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: 'TALK-1', body: '', sha: 'sha-cm1' },
    ]);
    (w.vm as unknown as { editMode: boolean }).editMode = false;
    await flushPromises();
    (w.vm as unknown as { editMode: boolean }).editMode = true;
    await flushPromises();

    syncMock.mockResolvedValueOnce({ ok: true, sha: 'abc123' });
    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    expect(syncMock).toHaveBeenCalledTimes(1);
  });
});

describe('Board — view-mode body-edit reconcile on reload (U10/R11)', () => {
  it('fetches raw bodies on a plain view-mode mount and reconciles a landed body edit before auto-resume decides', async () => {
    // No `rm-edit-mode` flag saved, so the ONLY reason edit mode would auto-resume is
    // dirtyCount > 0 — a landed body edit must not be allowed to force that, or a plain
    // reload with no real unsynced work would still flash into edit mode (the exact phantom
    // R11 exists to kill).
    const { fetchItems } = await import('../../lib/edit/client');
    (fetchItems as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: 'TALK-1', body: 'Published body text' },
    ]);
    const store = useEditStore();
    store.setBody('TALK-1', 'Published body text'); // already landed on the published site

    const w = await mountBoard();

    expect(fetchItems).toHaveBeenCalledTimes(1);
    expect(store.changeset().updated).toEqual([]);
    expect(store.dirtyCount.value).toBe(0);
    expect(w.find('[data-test="editing-banner"]').exists()).toBe(false);
  });

  it('keeps a genuinely-unsynced body edit after the view-mode reconcile fetch', async () => {
    const { fetchItems } = await import('../../lib/edit/client');
    (fetchItems as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: 'TALK-1', body: 'Published body text' },
    ]);
    const store = useEditStore();
    store.setBody('TALK-1', 'Still unsynced body text');

    await mountBoard();

    expect(store.changeset().updated.find((u) => u.id === 'TALK-1')?.body).toBe('Still unsynced body text');
  });

  it('does not fetch raw bodies on a clean view-mode mount with nothing pending at all', async () => {
    // No draft, no `rm-edit-mode` flag: edit mode never auto-resumes (dirtyCount stays 0), so
    // neither the U10 mount check nor the ordinary edit-mode-entry watcher have any reason to
    // fire — confirms the U10 fetch is conditional, not unconditional on every mount.
    const { fetchItems } = await import('../../lib/edit/client');
    await mountBoard();
    expect(fetchItems).not.toHaveBeenCalled();
  });

  it('a field-only edit auto-resumes edit mode as before, without the U10 body-edit path double-fetching', async () => {
    // A pending FIELD (not body) edit still auto-resumes edit mode (existing U4 behavior,
    // unrelated to U10) — which itself fetches raw bodies once, via the ordinary edit-mode
    // watcher. The U10 mount-time check must not ALSO fetch (hasBodyEdits is false here), so
    // this should still only be exactly one fetch, not two.
    const { fetchItems } = await import('../../lib/edit/client');
    const store = useEditStore();
    store.setField('TALK-1', 'title', 'Field-only edit, no body touched');

    await mountBoard();

    expect(fetchItems).toHaveBeenCalledTimes(1);
    expect(store.changeset().updated.find((u) => u.id === 'TALK-1')?.frontmatter.title).toBe(
      'Field-only edit, no body touched',
    );
  });

  it('degrades gracefully when the view-mode rawBodies fetch fails — no crash, edit left pending', async () => {
    const { fetchItems } = await import('../../lib/edit/client');
    (fetchItems as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('network'));
    const store = useEditStore();
    store.setBody('TALK-1', 'Published body text');

    const w = await mountBoard();

    // No crash, and the mount completed — the edit is simply left pending (conservative: it
    // couldn't be verified against the published source), same as any other reconcile miss.
    expect(w.exists()).toBe(true);
    expect(store.changeset().updated.find((u) => u.id === 'TALK-1')?.body).toBe('Published body text');
  });
});

describe('Board — durable-draft warning (U6/R7)', () => {
  it('surfaces a quiet notice once a draft persist fails, without crashing the edit', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    const store = useEditStore();
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    try {
      expect(() => store.setField('TALK-1', 'title', 'Edited while storage is full')).not.toThrow();
      await flushPromises();
      expect(w.find('[data-test="persist-failed-notice"]').exists()).toBe(true);
      // Still readable/editable in-session even though it never made it to localStorage.
      expect(store.fieldValue('TALK-1', 'title')).toBe('Edited while storage is full');
    } finally {
      spy.mockRestore();
    }
  });

  it('clears the notice once a later persist succeeds', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    const store = useEditStore();
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    store.setField('TALK-1', 'title', 'First edit, fails to persist');
    await flushPromises();
    expect(w.find('[data-test="persist-failed-notice"]').exists()).toBe(true);
    spy.mockRestore();

    store.setField('TALK-1', 'owner', 'Mark');
    await flushPromises();
    expect(w.find('[data-test="persist-failed-notice"]').exists()).toBe(false);
  });

  it('does not show the notice at all when persisting never fails', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Ordinary edit');
    await flushPromises();
    expect(w.find('[data-test="persist-failed-notice"]').exists()).toBe(false);
  });
});

describe('Board — never show the read-only drawer in edit mode (fix #5)', () => {
  it('restores the reading size and retains an explicit change across closing and opening another item', async () => {
    localStorage.setItem('rm-item-reading-mode', 'expanded');
    const w = await mountBoard([item(), item({ id: 'CM-2', title: 'Another item' })]);
    const vm = w.vm as unknown as { selected: ItemVM | null };
    vm.selected = item();
    await flushPromises();
    expect(w.find('.detail-expanded').exists()).toBe(true);
    await w.get('button[aria-label="Collapse item"]').trigger('click');
    expect(localStorage.getItem('rm-item-reading-mode')).toBe('compact');
    await w.get('button[aria-label="Expand item"]').trigger('click');
    vm.selected = null;
    await flushPromises();
    expect(localStorage.getItem('rm-item-reading-mode')).toBe('expanded');
    vm.selected = item({ id: 'CM-2', title: 'Another item' });
    await flushPromises();
    expect(w.find('.detail-expanded').exists()).toBe(true);
  });

  it('closes an open drawer and opens the full editor once edit mode turns on', async () => {
    const w = await mountBoard();
    const vm = w.vm as unknown as { selected: ItemVM | null; editingId: string | null; editMode: boolean };
    vm.selected = item();
    await flushPromises();
    expect(vm.selected).not.toBeNull();

    vm.editMode = true;
    await flushPromises();

    expect(vm.selected).toBeNull();
    expect(vm.editingId).toBe('TALK-1');
  });

  it('lands a card opened via ?item= in edit mode straight in the editor, not the drawer', async () => {
    // Mirrors the `?item=` URL-restore path in onMounted, which sets `selected` directly
    // (bypassing select()) before canEdit/editMode resolve — and the auto-resume check
    // (rm-edit-mode) flips editMode true shortly after, in the same mount.
    localStorage.setItem('rm-edit-mode', '1');
    window.history.replaceState(null, '', '/?item=TALK-1');
    const w = await mountBoard();

    const vm = w.vm as unknown as { selected: ItemVM | null; editingId: string | null };
    expect(vm.selected).toBeNull();
    expect(vm.editingId).toBe('TALK-1');
    // DetailDrawer only renders its overlay while `item` (bound to `selected`) is non-null.
    expect(w.find('.drawer-scrim').exists()).toBe(false);

    window.history.replaceState(null, '', '/');
  });
});

describe('Board — new item lands in the focused horizon (fix #9)', () => {
  it('defaults to the single active horizon when grouped by product with exactly one selected', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    const vm = w.vm as unknown as {
      filters: { group: string };
      horizons: string[];
      addToLane: (lane: { key: string }) => void;
    };
    vm.filters.group = 'product';
    vm.horizons = ['Now'];
    await flushPromises();

    vm.addToLane({ key: 'Podcasts & Audiobooks' });

    const created = useEditStore().changeset().created;
    expect(created[created.length - 1]?.frontmatter.horizon).toBe('Now');
  });

  it('falls back to Next when grouped by product with the default (multiple) horizons active', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    const vm = w.vm as unknown as { filters: { group: string }; addToLane: (lane: { key: string }) => void };
    vm.filters.group = 'product';
    await flushPromises();

    vm.addToLane({ key: 'Podcasts & Audiobooks' });

    const created = useEditStore().changeset().created;
    expect(created[created.length - 1]?.frontmatter.horizon).toBe('Next');
  });
});

describe('Board — multi-select horizon filter', () => {
  type HorizonVM = {
    horizons: string[];
    toggleHorizon: (h: string) => void;
  };

  it('defaults the active set to Now/Next/Later', async () => {
    const w = await mountBoard([item({ id: 'TALK-1', horizon: 'Now' })]);
    const vm = w.vm as unknown as HorizonVM;
    expect(vm.horizons.slice().sort()).toEqual(['Later', 'Next', 'Now']);
  });

  it('shows only items whose horizon is in the active set by default', async () => {
    const w = await mountBoard([
      item({ id: 'TALK-1', horizon: 'Now' }),
      item({ id: 'TALK-2', horizon: 'Candidates', title: 'A candidate' }),
      item({ id: 'TALK-3', horizon: 'Completed', title: 'Shipped thing' }),
    ]);
    expect(w.text()).toContain('Existing item');
    expect(w.text()).not.toContain('A candidate');
    expect(w.text()).not.toContain('Shipped thing');
  });

  it('toggling a chip off removes that horizon from the board', async () => {
    const w = await mountBoard([
      item({ id: 'TALK-1', horizon: 'Now' }),
      item({ id: 'TALK-2', horizon: 'Next', title: 'A next item' }),
    ]);
    const vm = w.vm as unknown as HorizonVM;
    vm.toggleHorizon('Next');
    await flushPromises();

    expect(vm.horizons).not.toContain('Next');
    expect(w.text()).toContain('Existing item');
    expect(w.text()).not.toContain('A next item');
  });

  it('toggling Candidates on shows candidate items', async () => {
    const w = await mountBoard([item({ id: 'TALK-1', horizon: 'Candidates', title: 'A candidate' })]);
    const vm = w.vm as unknown as HorizonVM;
    expect(w.text()).not.toContain('A candidate');

    vm.toggleHorizon('Candidates');
    await flushPromises();

    expect(vm.horizons).toContain('Candidates');
    expect(w.text()).toContain('A candidate');
  });

  it('toggling Completed on shows completed items', async () => {
    const w = await mountBoard([item({ id: 'TALK-1', horizon: 'Completed', title: 'Shipped thing' })]);
    const vm = w.vm as unknown as HorizonVM;
    expect(w.text()).not.toContain('Shipped thing');

    vm.toggleHorizon('Completed');
    await flushPromises();

    expect(vm.horizons).toContain('Completed');
    expect(w.text()).toContain('Shipped thing');
  });

  it('deselecting all horizons shows the empty state and nothing else', async () => {
    const w = await mountBoard([item({ id: 'TALK-1', horizon: 'Now' })]);
    const vm = w.vm as unknown as HorizonVM;
    for (const h of [...vm.horizons]) vm.toggleHorizon(h);
    await flushPromises();

    expect(vm.horizons).toEqual([]);
    expect(w.text()).not.toContain('Existing item');
    expect(w.text()).toContain('No horizons selected');
  });

  it('chooses visible horizons from View without counting them as filters', async () => {
    const w = await mountBoard([item({ id: 'TALK-1', horizon: 'Now' })]);
    await w.get('[aria-label="View options and saved views"]').trigger('click');
    const nowChip = w.find('[data-test="horizon-chip"][data-horizon="Now"]');
    expect(nowChip.attributes('aria-pressed')).toBe('true');

    await nowChip.setValue(false);

    const vm = w.vm as unknown as HorizonVM;
    expect(vm.horizons).not.toContain('Now');
    expect(nowChip.attributes('aria-pressed')).toBe('false');
    expect(w.get('[aria-label="Filters"]').find('.board-filter-count').exists()).toBe(false);
    await w.get('[aria-label="Close views"]').trigger('click');
    await w.get('[aria-label="Filters"]').trigger('click');
    expect(w.get('[role="dialog"][aria-label="Filters"]').find('[data-test="horizon-chip"]').exists()).toBe(false);
  });
});

describe('Board — pre-Sync empty-owner validation (fix #10, now via the general U5 validation pass)', () => {
  it('blocks Sync and surfaces a friendly message naming the item when its owner is cleared (fix #10)', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'owner', '   ');

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    expect(syncMock).not.toHaveBeenCalled();
    const bar = w.find('[data-test="save-status"]');
    expect(bar.text()).toContain('Existing item');
    expect(bar.text()).toContain('owner is required');
  });

  it('does not block Sync when owner was never touched', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: true, sha: 'abc123' });
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    expect(syncMock).toHaveBeenCalledTimes(1);
  });

  it('does not block a new (created) item that has no owner — the server defaults creates to Unassigned', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: true, sha: 'abc123' });
    const w = await mountBoard();
    useEditStore().addItem('Podcasts & Audiobooks', 'A real title', { horizon: 'Next' });

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    expect(syncMock).toHaveBeenCalledTimes(1);
  });

  it('names each item with a cleared owner in the message (fix #10)', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard([item(), item({ id: 'TALK-2', title: 'Second item' })]);
    const store = useEditStore();
    store.setField('TALK-1', 'owner', '');
    store.setField('TALK-2', 'owner', '');

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    const text = w.find('[data-test="save-status"]').text();
    expect(text).toContain('Existing item');
    expect(text).toContain('Second item');
    expect(text).toContain('owner is required');
  });

  it('caps a long list of named items with a cleared owner at 3, then "+N more" (fix #10)', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard([
      item({ id: 'TALK-1', title: 'Alpha' }),
      item({ id: 'TALK-2', title: 'Bravo' }),
      item({ id: 'TALK-3', title: 'Charlie' }),
      item({ id: 'TALK-4', title: 'Delta' }),
      item({ id: 'TALK-5', title: 'Echo' }),
    ]);
    const store = useEditStore();
    for (const id of ['TALK-1', 'TALK-2', 'TALK-3', 'TALK-4', 'TALK-5']) store.setField(id, 'owner', '');

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    const text = w.find('[data-test="save-status"]').text();
    expect(text).toContain('Alpha');
    expect(text).toContain('Bravo');
    expect(text).toContain('Charlie');
    expect(w.get('[data-test=save-error]').text()).not.toContain('Delta');
    expect(text).toContain('+2 more');
  });
});

describe('Board — closing a new item keeps partial work (fix #3)', () => {
  it('keeps a just-created, untitled item once it has a body edit', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    const store = useEditStore();
    const id = store.addItem('Podcasts & Audiobooks', '', { horizon: 'Next' });
    store.setBody(id, 'Some real body content');
    (w.vm as unknown as { editingId: string | null }).editingId = id;
    await flushPromises();

    (w.vm as unknown as { onEditorClose: () => void }).onEditorClose();

    expect(store.changeset().created).toHaveLength(1);
  });

  it('keeps a just-created, untitled item once it has a non-title field edit', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    const store = useEditStore();
    const id = store.addItem('Podcasts & Audiobooks', '', { horizon: 'Next' });
    store.setField(id, 'stage', 'Building');
    (w.vm as unknown as { editingId: string | null }).editingId = id;
    await flushPromises();

    (w.vm as unknown as { onEditorClose: () => void }).onEditorClose();

    expect(store.changeset().created).toHaveLength(1);
  });

  it('still discards a truly untouched new item (blank title, no other edits)', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    const store = useEditStore();
    const id = store.addItem('Podcasts & Audiobooks', '', { horizon: 'Next' });
    (w.vm as unknown as { editingId: string | null }).editingId = id;
    await flushPromises();

    (w.vm as unknown as { onEditorClose: () => void }).onEditorClose();

    expect(store.changeset().created).toEqual([]);
  });
});

describe('Board — unpublished-work indicator in view mode (fix #5)', () => {
  it('is hidden in edit mode', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');
    await flushPromises();

    expect(w.find('[data-test="unpublished-indicator"]').exists()).toBe(false);
  });

  it('is hidden when there is nothing dirty, even out of edit mode', async () => {
    const w = await mountBoard();
    expect(w.find('[data-test="unpublished-indicator"]').exists()).toBe(false);
  });

  it('shows once there is a dirty draft and the user is out of edit mode, and resumes editing on click', async () => {
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');
    (w.vm as unknown as { editMode: boolean }).editMode = false;
    await flushPromises();

    const pill = w.find('[data-test="unpublished-indicator"]');
    expect(pill.exists()).toBe(true);
    expect(pill.text()).toContain('1 unpublished change');
    expect(pill.text()).toContain('Resume editing');

    await pill.trigger('click');

    expect((w.vm as unknown as { editMode: boolean }).editMode).toBe(true);
  });
});

describe('Board — session-expiry re-auth path (fix #2)', () => {
  it('surfaces a "Sign in again" action in the banner when sync reports an auth error', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: false, authError: true, errors: ['Your session expired'] });
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    const banner = w.find('[data-test="save-error"]');
    expect(banner.exists()).toBe(true);
    expect(banner.text()).toContain('Sign in again');
    expect(banner.text()).toContain('draft is kept');
    expect(w.find('[data-test="sign-in-again"]').exists()).toBe(true);
    // The unsynced count still shows in the (still-mounted) SyncBar, and the draft is untouched.
    expect(useEditStore().dirtyCount.value).toBeGreaterThan(0);
  });

  it('keeps the draft intact and does not call sync a second time until the user clicks "Sign in again"', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: false, authError: true, errors: ['Your session expired'] });
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    expect(useEditStore().changeset().updated.find((u) => u.id === 'TALK-1')?.frontmatter.title).toBe(
      'Edited title',
    );
    expect(syncMock).toHaveBeenCalledTimes(1);
  });

  it('navigates to the GitHub sign-in URL when "Sign in again" is clicked', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: false, authError: true, errors: ['Your session expired'] });
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');
    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    // signIn() (unchanged, existing code) does `window.location.href = loginUrl()` — swap in
    // a stand-in `location` for this one test only, and restore the real one immediately after
    // so it doesn't leak into other tests in this file (e.g. the `location.reload` spy in
    // `beforeEach`).
    const originalLocation = window.location;
    const hrefSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...originalLocation, set href(v: string) { hrefSpy(v); } },
      configurable: true,
      writable: true,
    });
    try {
      await w.find('[data-test="sign-in-again"]').trigger('click');
      expect(hrefSpy).toHaveBeenCalledWith('#'); // loginUrl() is mocked to '#' at the top of this file
    } finally {
      Object.defineProperty(window, 'location', { value: originalLocation, configurable: true, writable: true });
    }
  });

  it('blocks repeated publication after expiry while retaining further edits', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: false, authError: true });
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Before expiry');
    await (w.vm as any).doSync();
    useEditStore().setField('TALK-1', 'title', 'After expiry');
    await (w.vm as any).doSync();
    await flushPromises();
    expect(syncMock).toHaveBeenCalledTimes(1);
    expect(w.find('[data-test="sync"]').exists()).toBe(false);
    expect(w.find('[data-test="sign-in-again"]').exists()).toBe(true);
    expect(useEditStore().snapshot().fields['TALK-1'].title).toBe('After expiry');
    expect(useEditStore().snapshot().requestPayload).toBeNull();
  });

});

describe('Board — base-version map gates Sync (U2/R1 fail-closed)', () => {
  it('blocks Sync until the base-version map (the /api/items sha fetch alongside rawBodies) has loaded', async () => {
    const { fetchItems } = await import('../../lib/edit/client');
    let resolveFetch!: (items: { id: string; body: string; sha?: string }[]) => void;
    (fetchItems as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () =>
        new Promise<{ id: string; body: string; sha?: string }[]>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    expect(syncMock).not.toHaveBeenCalled();
    expect(w.find('[data-test="save-status"]').text()).toContain('Still loading your workspace');

    // Once the base-version map actually lands, Sync proceeds normally.
    syncMock.mockResolvedValueOnce({ ok: true, sha: 'abc123' });
    resolveFetch([{ id: 'TALK-1', body: '', sha: 'sha-cm1' }]);
    await flushPromises();

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    expect(syncMock).toHaveBeenCalledTimes(1);
  });

  it('threads baseSha (captured from /api/items) and a requestId into the Sync payload once loaded', async () => {
    const { fetchItems } = await import('../../lib/edit/client');
    (fetchItems as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: 'TALK-1', body: '', sha: 'sha-cm1' },
    ]);
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: true, sha: 'newsha' });
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    expect(syncMock).toHaveBeenCalledTimes(1);
    const sent = syncMock.mock.calls[0][0];
    expect(sent.updated[0]).toMatchObject({ id: 'TALK-1' });
    expect(sent.baseShas['TALK-1']).toBe('sha-cm1'); // single baseShas map (matches edit-service Changeset.BaseShas)
    expect(typeof sent.requestId).toBe('string');
    expect(sent.requestId.length).toBeGreaterThan(0);
  });

  it('omits baseSha for a newly-created item — creates have no prior file to base against', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: true, sha: 'newsha' });
    const w = await mountBoard();
    useEditStore().addItem('Podcasts & Audiobooks', 'A new one', { horizon: 'Next' });

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    const sent = syncMock.mock.calls[0][0];
    expect(sent.created[0]).not.toHaveProperty('baseSha');
  });
});

describe('Board — ItemEditor `published` prop + reset-field wiring (fix #5)', () => {
  it('passes the published (unedited) base item, so a locally-changed field shows the changed indicator', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    const store = useEditStore();
    store.setField('TALK-1', 'stage', 'Shipped');
    (w.vm as unknown as { editingId: string | null }).editingId = 'TALK-1';
    await flushPromises();

    expect(w.find('[data-test="changed-dot-stage"]').exists()).toBe(true);
  });

  it('passes published=null for a never-published (locally-created) item, hiding changed markers', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    const store = useEditStore();
    const id = store.addItem('Podcasts & Audiobooks', 'Brand new item', { horizon: 'Next' });
    (w.vm as unknown as { editingId: string | null }).editingId = id;
    await flushPromises();

    expect(w.find('[data-test="changed-dot-title"]').exists()).toBe(false);
  });

  it('clicking a field reset button calls editStore.revertField, dropping just that field', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    const store = useEditStore();
    store.setField('TALK-1', 'stage', 'Shipped');
    store.setField('TALK-1', 'owner', 'Mark');
    (w.vm as unknown as { editingId: string | null }).editingId = 'TALK-1';
    await flushPromises();

    await w.find('[data-test="reset-field-stage"]').trigger('click');
    await flushPromises();

    expect(store.fieldValue('TALK-1', 'stage')).toBeUndefined();
    expect(store.fieldValue('TALK-1', 'owner')).toBe('Mark');
  });
});

describe('Board — ItemEditor live card preview (fix #6)', () => {
  it('reflects the CURRENT (working-copy) title as it is edited, not the published one', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    const store = useEditStore();
    store.setField('TALK-1', 'title', 'Renamed while editing');
    (w.vm as unknown as { editingId: string | null }).editingId = 'TALK-1';
    await flushPromises();

    expect(w.find('[data-test="preview-title"]').text()).toBe('Renamed while editing');
  });
});

describe('Board — inline card rename wiring (fix #2)', () => {
  it('applies a card rename straight into the changeset via setField', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();

    (w.vm as unknown as { onCardRename: (p: { id: string; title: string }) => void }).onCardRename({
      id: 'TALK-1',
      title: 'Renamed via card',
    });

    expect(useEditStore().fieldValue('TALK-1', 'title')).toBe('Renamed via card');
  });

  it('works for a not-yet-synced new-id item too', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    const store = useEditStore();
    const newId = store.addItem('Podcasts & Audiobooks', '', { horizon: 'Next' });

    (w.vm as unknown as { onCardRename: (p: { id: string; title: string }) => void }).onCardRename({
      id: newId,
      title: 'First title',
    });

    expect(store.changeset().created.find((c) => c.id === newId)?.title).toBe('First title');
  });

  it('ignores an empty rename title (a no-op, nothing gets marked dirty)', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();

    (w.vm as unknown as { onCardRename: (p: { id: string; title: string }) => void }).onCardRename({
      id: 'TALK-1',
      title: '',
    });

    expect(useEditStore().isDirty('TALK-1')).toBe(false);
  });
});

describe('Board — duplicate an item (fix #3)', () => {
  it('creates a copy of the source item (product/title/fields/body) and opens the editor for it', async () => {
    const { fetchItems } = await import('../../lib/edit/client');
    (fetchItems as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: 'TALK-1', body: 'Original body text' },
    ]);
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();

    (w.vm as unknown as { onCardDuplicate: (id: string) => void }).onCardDuplicate('TALK-1');

    const store = useEditStore();
    const created = store.changeset().created;
    expect(created).toHaveLength(1);
    const copy = created[0]!;
    expect(copy.product).toBe('Podcasts & Audiobooks');
    expect(copy.title).toBe('Existing item (copy)');
    expect(copy.frontmatter.horizon).toBe('Now');
    expect(copy.frontmatter.stage).toBe('Building');
    expect(copy.frontmatter.owner).toBe('mark@example.com');
    expect(copy.frontmatter.impact).toBe('High');
    expect(copy.frontmatter.effort).toBe('Low');
    expect(copy.frontmatter.visibility).toBe('Internal');
    expect(copy.frontmatter.tags).toBe('workflow');
    expect(copy.body).toBe('Original body text');

    expect((w.vm as unknown as { editingId: string | null }).editingId).toBe(copy.id);
  });

  it('omits empty frontmatter values so a blank owner/impact/effort does not trip validation', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard([
      item({ id: 'TALK-2', owner: '', impact: null, effort: null, tags: [] }),
    ]);

    (w.vm as unknown as { onCardDuplicate: (id: string) => void }).onCardDuplicate('TALK-2');

    const copy = useEditStore().changeset().created[0]!;
    expect(copy.frontmatter.owner).toBeUndefined();
    expect(copy.frontmatter.impact).toBeUndefined();
    expect(copy.frontmatter.effort).toBeUndefined();
    expect(copy.frontmatter.tags).toBeUndefined();
  });
});

type ChangeSummary = {
  edited: { id: string; title: string }[];
  created: { title: string; product: string }[];
  deleted: { id: string; title: string }[];
  reorderLanes: number;
};

describe('Board — change summary for review (fix #8)', () => {
  it('resolves edited/created/deleted names via byId and counts reordered lanes', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard([
      item({ id: 'TALK-1', title: 'First item' }),
      item({ id: 'TALK-2', title: 'Second item', order: 2 }),
    ]);
    const store = useEditStore();
    store.setField('TALK-1', 'title', 'First item edited');
    store.deleteItem('TALK-2');
    const newId = store.addItem('Podcasts & Audiobooks', 'A brand new item', { horizon: 'Next' });
    store.reorder('Podcasts & Audiobooks', 'Now', ['TALK-1']);
    await flushPromises();

    const summary = (w.vm as unknown as { changeSummary: ChangeSummary }).changeSummary;

    // Edited names resolve to the PUBLISHED title (from byId), not the locally-edited
    // value — that's what "what's about to change" should read as.
    expect(summary.edited).toEqual([{ id: 'TALK-1', title: 'First item' }]);
    expect(summary.created).toEqual([{ title: 'A brand new item', product: 'Podcasts & Audiobooks' }]);
    expect(summary.deleted).toEqual([{ id: 'TALK-2', title: 'Second item' }]);
    expect(summary.reorderLanes).toBe(1);
    expect(newId).toMatch(/^new-/);
  });

  it('opening Review in the save status shows the edited/created/deleted/reordered summary', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard([
      item({ id: 'TALK-1', title: 'First item' }),
      item({ id: 'TALK-2', title: 'Second item', order: 2 }),
    ]);
    const store = useEditStore();
    store.setField('TALK-1', 'title', 'First item edited');
    store.deleteItem('TALK-2');
    store.addItem('Podcasts & Audiobooks', 'A brand new item', { horizon: 'Next' });
    store.reorder('Podcasts & Audiobooks', 'Now', ['TALK-1']);
    await flushPromises();

    expect(w.get('.save-status-review').attributes('open')).toBeUndefined();
    await w.get('.save-status-review summary').trigger('click');

    const panel = w.get('.save-status-review-body');
    expect(panel.text()).toContain('First item');
    expect(panel.text()).toContain('A brand new item');
    expect(panel.text()).toContain('Second item');
    expect(panel.text()).toContain('Priority changed in 1 lane');
  });
});

describe('Board — global keyboard shortcuts (fix #9)', () => {
  it('"e" toggles edit mode when canEdit', async () => {
    const w = await mountBoard();
    expect((w.vm as unknown as { editMode: boolean }).editMode).toBe(false);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e' }));
    await flushPromises();
    expect((w.vm as unknown as { editMode: boolean }).editMode).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e' }));
    await flushPromises();
    expect((w.vm as unknown as { editMode: boolean }).editMode).toBe(false);
  });

  it('"e" is a no-op for a non-editor', async () => {
    meMock.mockResolvedValueOnce({ editor: false, login: '' });
    const w = await mountBoard();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e' }));
    await flushPromises();
    expect((w.vm as unknown as { editMode: boolean }).editMode).toBe(false);
  });

  it('"n" opens a new item in edit mode', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n' }));
    await flushPromises();

    expect((w.vm as unknown as { editingId: string | null }).editingId).not.toBeNull();
  });

  it('"n" is a no-op outside edit mode', async () => {
    const w = await mountBoard();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n' }));
    await flushPromises();

    expect((w.vm as unknown as { editingId: string | null }).editingId).toBeNull();
  });

  it('Cmd/Ctrl+Enter triggers Sync when there are unsynced changes', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: true, sha: 'abc123' });
    await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');
    await flushPromises();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true }));
    await flushPromises();

    expect(syncMock).toHaveBeenCalledTimes(1);
  });

  it('Cmd/Ctrl+Enter is a no-op with nothing unsynced', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    await mountBoard();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true }));
    await flushPromises();

    expect(syncMock).not.toHaveBeenCalled();
  });

  it('ignores every shortcut while focus is inside a text input', async () => {
    const w = await mountBoard();
    const input = document.createElement('input');
    document.body.appendChild(input);
    try {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', bubbles: true }));
      await flushPromises();
      expect((w.vm as unknown as { editMode: boolean }).editMode).toBe(false);

      input.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }));
      await flushPromises();
      expect(w.find('[data-test="shortcuts-cheatsheet"]').exists()).toBe(false);
    } finally {
      document.body.removeChild(input);
    }
  });

  it('"?" opens the shortcuts cheat-sheet, and Escape closes it', async () => {
    const w = await mountBoard();
    expect(w.find('[data-test="shortcuts-cheatsheet"]').exists()).toBe(false);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }));
    await flushPromises();
    expect(w.find('[data-test="shortcuts-cheatsheet"]').exists()).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(w.find('[data-test="shortcuts-cheatsheet"]').exists()).toBe(false);
  });
});

describe('Board — sync-success toast with commit link (fix #10)', () => {
  it('shows a dismissible toast with a link to the commit after a successful sync', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: true, sha: 'abc1234567' });
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    const toast = w.get('[data-test="sync-toast"]');
    expect(toast.text()).toContain('Published');
    const link = w.get('[data-test="sync-toast-link"]');
    expect(link.attributes('href')).toBe('https://github.com/markpasternak/product-roadmap-generalized/commit/abc1234567');
    expect(link.text()).toBe('abc1234');
  });

  it('dismisses the toast when clicked', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: true, sha: 'abc1234567' });
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');
    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    await w.get('[data-test="sync-toast-dismiss"]').trigger('click');
    expect(w.find('[data-test="sync-toast"]').exists()).toBe(false);
  });

  it('auto-dismisses on its own after ~6s', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: true, sha: 'abc1234567' });
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');

    vi.useFakeTimers();
    try {
      await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
      await flushPromises();
      expect(w.find('[data-test="sync-toast"]').exists()).toBe(true);

      await vi.advanceTimersByTimeAsync(6000);
      await flushPromises();
      expect(w.find('[data-test="sync-toast"]').exists()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not show a toast for a failed sync', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: false, errors: ['boom'] });
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    expect(w.find('[data-test="sync-toast"]').exists()).toBe(false);
  });
});

describe('Board — skipped-reorders notice after sync (U8/R9)', () => {
  it('shows a visible notice naming the item(s) when a successful sync reports skippedReorders', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: true, sha: 'abc123', skippedReorders: ['TALK-1'] });
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    const notice = w.find('[data-test="skipped-reorder-notice"]');
    expect(notice.exists()).toBe(true);
    expect(notice.text()).toContain("were skipped");
    expect(notice.text()).toContain('Existing item'); // TALK-1's title, resolved via byId
  });

  it('falls back to the raw id when the item is not in byId (e.g. it was also deleted upstream)', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: true, sha: 'abc123', skippedReorders: ['UNKNOWN-9'] });
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    expect(w.find('[data-test="skipped-reorder-notice"]').text()).toContain('UNKNOWN-9');
  });

  it('shows no notice when skippedReorders is absent or empty', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: true, sha: 'abc123' });
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    expect(w.find('[data-test="skipped-reorder-notice"]').exists()).toBe(false);
  });

  it('is dismissible', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: true, sha: 'abc123', skippedReorders: ['TALK-1'] });
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();
    expect(w.find('[data-test="skipped-reorder-notice"]').exists()).toBe(true);

    await w.get('[data-test="skipped-reorder-notice-dismiss"]').trigger('click');
    expect(w.find('[data-test="skipped-reorder-notice"]').exists()).toBe(false);
  });

  it('clears a stale notice at the start of a fresh sync attempt that does not itself report any', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: true, sha: 'abc123', skippedReorders: ['TALK-1'] });
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');
    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();
    expect(w.find('[data-test="skipped-reorder-notice"]').exists()).toBe(true);

    useEditStore().setField('TALK-1', 'owner', 'Mark');
    syncMock.mockResolvedValueOnce({ ok: true, sha: 'def456' });
    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    expect(w.find('[data-test="skipped-reorder-notice"]').exists()).toBe(false);
  });
});

describe('Board — IA/UX improvement pass', () => {
  it('renders active filter chips and removes individual filters or clears all', async () => {
    window.history.replaceState(null, '', '/?q=launch&stage=Building&tag=workflow&visibility=Internal');
    const w = await mountBoard();

    const chipRow = w.get('[data-test="active-filter-chips"]');
    expect(chipRow.text()).toContain('“launch”');
    expect(chipRow.text()).toContain('Stage: Building');
    expect(chipRow.text()).toContain('workflow');
    expect(chipRow.text()).toContain('Visibility: Internal');

    const stageChip = w
      .findAll('[data-test="active-filter-chip"]')
      .find((chip) => chip.attributes('data-filter-kind') === 'stage');
    expect(stageChip).toBeTruthy();
    await stageChip!.get('button').trigger('click');
    await flushPromises();

    expect((w.vm as unknown as { filters: { stage: string[] } }).filters.stage).toEqual([]);
    expect(w.find('[data-filter-kind="stage"]').exists()).toBe(false);

    await w.get('[data-test="active-filter-clear"]').trigger('click');
    await flushPromises();

    expect(w.find('[data-test="active-filter-chips"]').exists()).toBe(false);
    expect((w.vm as unknown as { filters: { q: string; tags: string[]; visibility: string | null } }).filters).toMatchObject({
      q: '',
      tags: [],
      visibility: null,
    });
  });

  it('uses lane-aware empty copy for visible empty horizon lanes', async () => {
    const w = await mountBoard([item({ horizon: 'Now' })]);
    (w.vm as unknown as { horizons: string[] }).horizons = ['Candidates', 'Now', 'Next', 'Later', 'Completed'];
    await flushPromises();

    const emptyCopy = w.findAll('[data-test="lane-empty-copy"]').map((node) => node.text());
    expect(emptyCopy).toContain('No candidates in this view.');
    expect(emptyCopy).toContain('No Next items match this view.');
    expect(emptyCopy).toContain('No Later items match this view.');
    expect(emptyCopy).toContain('Nothing shipped yet. Completed work lands here.');
  });

  it('disambiguates the presentation-link and publish-share buttons', async () => {
    const w = await mountBoard();
    await w.get('[aria-controls="board-more-actions"]').trigger('click');

    expect(w.find('button[aria-label="Copy presentation link"]').exists()).toBe(true);

    (w.vm as unknown as { shareCopied: boolean; canShare: boolean }).shareCopied = true;
    (w.vm as unknown as { shareCopied: boolean; canShare: boolean }).canShare = true;
    await flushPromises();

    expect(w.find('button[aria-label="Presentation link copied"]').exists()).toBe(true);
    expect(w.find('button[aria-label="Publish a share link…"]').exists()).toBe(true);
  });

  it('enters presentation mode in the current tab', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const w = await mountBoard();

    await w.get('[aria-controls="board-more-actions"]').trigger('click');
    await w.get('button[aria-label="Start presentation"]').trigger('click');
    await flushPromises();

    expect((w.vm as unknown as { present: boolean }).present).toBe(true);
    expect(window.location.search).toContain('present=1');
    expect(open).not.toHaveBeenCalled();
  });

  it('copies a presentation URL without changing the current view', async () => {
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    window.history.replaceState(null, '', '/?horizon=Now&sort=updated');
    const w = await mountBoard();
    await w.get('[aria-controls="board-more-actions"]').trigger('click');
    await w.get('button[aria-label="Copy presentation link"]').trigger('click');
    await flushPromises();
    const copied = new URL(writeText.mock.calls[0]![0]);
    expect(copied.searchParams.get('present')).toBe('1');
    expect(copied.searchParams.get('sort')).toBe('updated');
    expect(copied.searchParams.getAll('horizon')).toEqual(['Now']);
    expect(copied.searchParams.get('group')).toBe('horizon');
    expect(copied.searchParams.get('reverse')).toBe('0');
    expect(new URLSearchParams(window.location.search).get('horizon')).toBe('Now');
    expect(copied.searchParams.has('item')).toBe(false);
    expect((w.vm as unknown as { present: boolean }).present).toBe(false);
    expect(window.location.search).not.toContain('present=1');
    expect(w.get('#board-more-actions [role="status"]').text()).toContain('copied');
  });

  it('reports clipboard failure without claiming success or entering presentation', async () => {
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    const w = await mountBoard();
    await w.get('[aria-controls="board-more-actions"]').trigger('click');
    await w.get('button[aria-label="Copy presentation link"]').trigger('click');
    await flushPromises();
    expect(w.get('#board-more-actions [role="alert"]').text()).toContain('Couldn’t copy');
    expect(w.find('button[aria-label="Presentation link copied"]').exists()).toBe(false);
    expect((w.vm as unknown as { present: boolean }).present).toBe(false);
  });

  it('dismisses More with Escape and outside clicks', async () => {
    const w = await mountBoard();
    const toggle = w.get('[aria-controls="board-more-actions"]');
    const focus = vi.spyOn(toggle.element as HTMLButtonElement, 'focus');
    await toggle.trigger('click');
    await w.get('#board-more-actions button').trigger('keydown', { key: 'Escape' });
    expect(toggle.attributes('aria-expanded')).toBe('false');
    expect(focus).toHaveBeenCalled();
    await toggle.trigger('click');
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await flushPromises();
    expect(toggle.attributes('aria-expanded')).toBe('false');
  });

  it('reports a rejected full-screen request without closing its feedback', async () => {
    const w = await mountBoard();
    Object.defineProperty(w.element, 'requestFullscreen', { configurable: true, value: vi.fn().mockRejectedValue(new Error('blocked')) });
    (w.vm as unknown as { fullscreenAvailable: boolean }).fullscreenAvailable = true;
    await w.get('[aria-controls="board-more-actions"]').trigger('click');
    await w.findAll('#board-more-actions button').find((button) => button.text() === 'Full screen')!.trigger('click');
    await flushPromises();
    expect(w.get('#board-more-actions [role="alert"]').text()).toContain('Couldn’t change full screen');
    expect(w.get('[aria-controls="board-more-actions"]').attributes('aria-expanded')).toBe('true');
  });

  it('offers an obvious way back from presentation mode', async () => {
    window.history.replaceState(null, '', '/?present=1');
    const w = await mountBoard();

    const exit = w.get('[data-test="exit-presentation"]');
    expect(exit.text()).toContain('Exit presentation');

    await exit.trigger('click');
    await flushPromises();

    expect((w.vm as unknown as { present: boolean }).present).toBe(false);
    expect(window.location.search).not.toContain('present=1');
    expect(document.documentElement.dataset.present).toBeUndefined();
  });

  it('carries the selected horizon lanes into the baked share context', async () => {
    const w = await mountBoard();
    (w.vm as unknown as { horizons: string[] }).horizons = ['Now', 'Later'];
    await flushPromises();

    expect((w.vm as unknown as { shareContext: { horizons: string[] } }).shareContext.horizons).toEqual(['Now', 'Later']);
  });

  it('bakes only items allowed by the current stage filter', async () => {
    window.history.replaceState(null, '', '/?stage=Building');
    const w = await mountBoard([
      item({ id: 'TALK-1', stage: 'Building' }),
      item({ id: 'TALK-2', stage: 'Shaping' }),
    ]);

    expect((w.vm as unknown as { shareItems: Array<{ id: string; stage: string }> }).shareItems).toEqual([
      expect.objectContaining({ id: 'TALK-1', stage: 'Building' }),
    ]);
  });
});

describe('Board — search tuning', () => {
  it('shows hidden-lane matches and clicking the hint toggles that horizon on', async () => {
    window.history.replaceState(null, '', '/?q=shipped');
    const w = await mountBoard([
      item({ id: 'TALK-1', title: 'Visible item', horizon: 'Now', text: 'visible' }),
      item({ id: 'TALK-2', title: 'Shipped launch', horizon: 'Completed', text: 'shipped launch' }),
    ]);

    expect(w.get('[data-test="search-results-line"]').text()).toContain('0 results for “shipped”');
    const hint = w.get('[data-test="hidden-lane-match"]');
    expect(hint.text()).toBe('+ 1 more in Completed');

    await hint.trigger('click');
    await flushPromises();

    expect((w.vm as unknown as { horizons: string[] }).horizons).toContain('Completed');
    expect(w.text()).toContain('Shipped launch');
  });
});


it('restores timeline settings across remounts without losing the incoming layout', async () => {
  window.history.replaceState(null, '', '/?view=timeline&timelineGroup=owner&scale=weeks&at=2026-09-01');
  const first = await mountBoard();
  expect(first.find('[aria-label="Roadmap timeline"]').exists()).toBe(true);
  expect(window.location.search).toContain('layout=timeline');
  first.unmount(); wrappers = [];
  const second = await mountBoard();
  expect(second.find('[aria-label="Roadmap timeline"]').exists()).toBe(true);
  expect(window.location.search).toContain('timelineGroup=owner');
  expect(window.location.search).toContain('at=2026-09-01');
});

it('keeps recent changes out of the roadmap until opened from More', async () => {
  window.history.replaceState(null, '', '/?layout=timeline&scale=weeks');
  const w = await mountBoard();
  const before = window.location.search;
  expect(w.findComponent({ name: 'RecentChangesDrawer' }).exists()).toBe(false);
  await w.get('[aria-controls="board-more-actions"]').trigger('click');
  const action = w.findAll('#board-more-actions button').find(button => button.text() === 'Recent changes')!;
  await action.trigger('click');
  await flushPromises();
  expect(w.findComponent({ name: 'RecentChangesDrawer' }).exists()).toBe(true);
  expect(window.location.search).toBe(before);
  document.querySelector<HTMLButtonElement>('[aria-label="Close recent changes"]')!.click();
  await flushPromises();
  expect(w.findComponent({ name: 'RecentChangesDrawer' }).exists()).toBe(false);
  expect(window.location.search).toBe(before);
});


it('restores personal view preferences on a clean URL without exposing them in the address', async () => {
  localStorage.setItem(BOARD_VIEW_STORAGE_KEY, JSON.stringify({
    horizons: ['Now'], group: 'product', sort: 'updated', reverseLanes: true,
  }));
  const w = await mountBoard();
  expect(window.location.pathname).toBe('/');
  expect(window.location.search).toBe('');
  const vm = w.vm as unknown as { filters: { group: string }; horizons: string[]; sort: string; reverseLaneOrder: boolean };
  expect(vm.filters.group).toBe('product');
  expect(vm.horizons).toEqual(['Now']);
  expect(vm.sort).toBe('updated');
  expect(vm.reverseLaneOrder).toBe(true);
});

it('lets an explicit URL override local preferences without overwriting them on load', async () => {
  const local = JSON.stringify({ horizons: ['Later'], group: 'product', sort: 'title', reverseLanes: true });
  localStorage.setItem(BOARD_VIEW_STORAGE_KEY, local);
  window.history.replaceState(null, '', '/?horizon=Now&group=horizon&sort=manual&reverse=0');
  const w = await mountBoard();
  const vm = w.vm as unknown as { filters: { group: string }; horizons: string[]; sort: string; reverseLaneOrder: boolean };
  expect([vm.horizons, vm.filters.group, vm.sort, vm.reverseLaneOrder]).toEqual([['Now'], 'horizon', 'manual', false]);
  await w.get('[aria-label="View options and saved views"]').trigger('click');
  await w.get('select[name="sort"]').setValue('impact');
  expect(localStorage.getItem(BOARD_VIEW_STORAGE_KEY)).toBe(local);
});

it('compacts an existing date-filter link without changing the filter', async () => {
  window.history.replaceState(null, '', '/?timelineGroup=product&scale=months&activity=updated&tz=Europe%2FStockholm&days=7');
  const w = await mountBoard();
  expect(window.location.search).toBe('?days=7&tz=Europe%2FStockholm');
  expect(w.text()).toContain('Updated · Last 7 days');
  await w.get('[data-test="active-filter-clear"]').trigger('click');
  await flushPromises();
  expect(window.location.search).toBe('');
});

it('keeps the default timeline layout explicit without serializing its defaults', async () => {
  window.history.replaceState(null, '', '/?layout=timeline&timelineGroup=product&scale=months');
  const w = await mountBoard();
  expect(window.location.search).toBe('?layout=timeline');
  expect(w.find('[aria-label="Roadmap timeline"]').exists()).toBe(true);
});


it.each(['horizon', 'product'])('reverses %s lanes locally, preserves card order, and carries the choice into sharing', async group => {
  if (group === 'product') localStorage.setItem(BOARD_VIEW_STORAGE_KEY, JSON.stringify({
    horizons: ['Now', 'Next', 'Later'], group: 'product', sort: 'manual', reverseLanes: false,
  }));
  const w = await mountBoard([
    item({ id: 'first', product: PRODUCTS[0], horizon: 'Now', order: 1 }),
    item({ id: 'second', product: PRODUCTS[0], horizon: 'Now', order: 2 }),
    item({ id: 'third', product: PRODUCTS[1], horizon: 'Next', order: 1 }),
  ]);
  const expected = group === 'product' ? [PRODUCTS[1], PRODUCTS[0]] : ['Later', 'Next', 'Now'];
  const beforeURL = window.location.href;
  const vm = w.vm as unknown as { shareItems: unknown; shareContext: { reverseLanes: boolean } };
  await w.get('[aria-label="View options and saved views"]').trigger('click');
  await w.get('.lane-order-setting input').setValue(true);
  await flushPromises();
  expect(w.findAll('section[data-lane-key]').map(lane => lane.attributes('data-lane-key'))).toEqual(expected);
  const lane = w.get(`section[data-lane-key="${group === 'product' ? PRODUCTS[0] : 'Now'}"]`);
  expect(lane.findAll('[data-item-id]').map(card => card.attributes('data-item-id'))).toEqual(['first', 'second']);
  expect(window.location.href).toBe(beforeURL);
  expect(vm.shareContext.reverseLanes).toBe(true);
  expect(JSON.parse(localStorage.getItem(BOARD_VIEW_STORAGE_KEY)!).reverseLanes).toBe(true);
  w.unmount();
  const restored = await mountBoard();
  await restored.get('[aria-label="View options and saved views"]').trigger('click');
  expect((restored.get('.lane-order-setting input').element as HTMLInputElement).checked).toBe(true);
  await restored.get('.lane-order-setting input').setValue(false);
  expect(JSON.parse(localStorage.getItem(BOARD_VIEW_STORAGE_KEY)!).reverseLanes).toBe(false);
});

it('offers the same local lane-order setting in timeline view', async () => {
  window.history.replaceState(null, '', '/?layout=timeline');
  const w = await mountBoard();
  const before = window.location.href;
  await w.get('[aria-label="View options and saved views"]').trigger('click');
  await w.get('.lane-order-setting input').setValue(true);
  expect(w.getComponent({ name: 'TimelineView' }).props('reverseGroups')).toBe(true);
  expect(window.location.href).toBe(before);
});


it('resets hidden horizons independently from active filters', async () => {
  window.history.replaceState(null, '', '/?horizon=none&owner=Alice');
  const w = await mountBoard([item({ owner: 'Alice' })]);
  expect(w.text()).toContain('Choose horizons in View');
  expect(w.get('[aria-label="Filters"] .board-filter-count').text()).toBe('1');
  await w.findAll('button').find(button => button.text() === 'Reset horizons')!.trigger('click');
  await flushPromises();
  const vm = w.vm as unknown as { filters: { owner: string }; horizons: string[] };
  expect(vm.horizons).toEqual(['Now', 'Next', 'Later']);
  expect(vm.filters.owner).toBe('Alice');
  expect(w.text()).toContain('Existing item');
});

it('offers visible horizons under View in timeline mode too', async () => {
  window.history.replaceState(null, '', '/?layout=timeline');
  const w = await mountBoard();
  await w.get('[aria-label="View options and saved views"]').trigger('click');
  expect(w.get('.view-horizons legend').text()).toBe('Show horizons');
  expect(w.findAll('.view-horizons input')).toHaveLength(5);
  expect(w.find('select[name="group"]').exists()).toBe(false);
});
