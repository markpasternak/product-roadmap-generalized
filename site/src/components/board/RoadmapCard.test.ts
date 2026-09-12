import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import RoadmapCard from './RoadmapCard.vue';
import { useEditStore } from '../../lib/edit/store';
import type { ItemVM } from '../../lib/filters';

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
function mountCard(props: Record<string, unknown> = {}) {
  const w = mount(RoadmapCard, { props: { item: item(), ...props } });
  wrappers.push(w);
  return w;
}

beforeEach(() => localStorage.clear());

it('shows ownership internally and omits it in presentation cards', () => {
  expect(mountCard().text()).toContain('mark@example.com');
  const publicCard = mountCard({ client: true });
  expect(publicCard.text()).not.toContain('mark@example.com');
  expect(publicCard.text()).not.toContain('workflow');
  expect(publicCard.text()).not.toContain('High');
  expect(publicCard.text()).toContain('Building');
});

it('renders an explicitly selected cover at its focal point and respects the view toggle', () => {
  const covered = item({ cover: '../../assets/ast_one/rev_one/cover.png', coverPosition: '35% 70%' });
  const shown = mountCard({ item: covered });
  expect(shown.get('.roadmap-card-cover img').attributes('src')).toContain('/assets/ast_one/rev_one/cover.png');
  expect(shown.get('.roadmap-card-cover img').attributes('style')).toContain('object-position: 35% 70%');
  expect(shown.get('button').classes()).toContain('roadmap-card-with-cover');
  expect(shown.get('.roadmap-card-content-over-cover').text()).toContain('Existing item');
  expect(mountCard({ item: covered, showCover: false }).find('.roadmap-card-cover').exists()).toBe(false);
});

it('shows product identity only when the board supplies mixed-product context', () => {
  expect(mountCard().findComponent({ name: 'ProductMark' }).exists()).toBe(false);
  expect(mountCard({ showProduct: true }).getComponent({ name: 'ProductMark' }).props('product')).toBe('Podcasts & Audiobooks');
});

afterEach(() => {
  for (const w of wrappers) w.unmount();
  wrappers = [];
  useEditStore().clear();
  localStorage.clear();
});

describe('RoadmapCard — dirty dot / discard follow `editing`, not `draggable`', () => {
  it('shows neither the dirty dot nor the discard button when the item is clean', () => {
    const w = mountCard({ editing: true, draggable: true });
    expect(w.find('[data-test="dirty-dot"]').exists()).toBe(false);
    expect(w.find('[data-test="discard-item"]').exists()).toBe(false);
  });

  it('shows the dirty dot and discard button when editing is true and the item is dirty, even without draggable', () => {
    useEditStore().setField('TALK-1', 'stage', 'Shipped');
    const w = mountCard({ editing: true, draggable: false });
    expect(w.find('[data-test="dirty-dot"]').exists()).toBe(true);
    expect(w.find('[data-test="discard-item"]').exists()).toBe(true);
  });

  it('hides the dirty dot and discard button when editing is false, even if draggable and dirty', () => {
    useEditStore().setField('TALK-1', 'stage', 'Shipped');
    const w = mountCard({ editing: false, draggable: true });
    expect(w.find('[data-test="dirty-dot"]').exists()).toBe(false);
    expect(w.find('[data-test="discard-item"]').exists()).toBe(false);
  });

  it('hides the dirty dot and discard button when editing is omitted (default), even if dirty', () => {
    useEditStore().setField('TALK-1', 'stage', 'Shipped');
    const w = mountCard({ draggable: true });
    expect(w.find('[data-test="dirty-dot"]').exists()).toBe(false);
    expect(w.find('[data-test="discard-item"]').exists()).toBe(false);
  });

  it('emits discard with the item id when the discard button is clicked', async () => {
    useEditStore().setField('TALK-1', 'stage', 'Shipped');
    const w = mountCard({ editing: true });
    await w.find('[data-test="discard-item"]').trigger('click');
    expect(w.emitted('discard')).toEqual([['TALK-1']]);
  });
});

describe('RoadmapCard — discard control reads as Restore for pending-delete cards', () => {
  it('labels the control Restore when pending is deleted', () => {
    useEditStore().deleteItem('TALK-1');
    const w = mountCard({ editing: true, pending: 'deleted' });
    const btn = w.find('[data-test="discard-item"]');
    expect(btn.attributes('aria-label')).toContain('Restore');
    expect(btn.attributes('title')).toBe('Restore');
  });

  it('keeps the Discard changes wording when pending is edited', () => {
    useEditStore().setField('TALK-1', 'stage', 'Shipped');
    const w = mountCard({ editing: true, pending: 'edited' });
    const btn = w.find('[data-test="discard-item"]');
    expect(btn.attributes('aria-label')).toContain('Discard changes');
    expect(btn.attributes('title')).toBe('Discard changes');
  });

  it('still emits discard (which reverts the delete) when the Restore control is clicked', async () => {
    useEditStore().deleteItem('TALK-1');
    const w = mountCard({ editing: true, pending: 'deleted' });
    await w.find('[data-test="discard-item"]').trigger('click');
    expect(w.emitted('discard')).toEqual([['TALK-1']]);
  });
});

describe('RoadmapCard — inline rename via double-click on the title (fix #2)', () => {
  it('does nothing on double-click when not editing', async () => {
    const w = mountCard({ editing: false });
    await w.find('[data-test="card-title"]').trigger('dblclick');
    expect(w.find('[data-test="rename-input"]').exists()).toBe(false);
  });

  it('shows an input seeded with the current title on double-click while editing', async () => {
    const w = mountCard({ editing: true });
    await w.find('[data-test="card-title"]').trigger('dblclick');
    const input = w.find('[data-test="rename-input"]');
    expect(input.exists()).toBe(true);
    expect((input.element as HTMLInputElement).value).toBe('Existing item');
  });

  it('commits a trimmed rename on Enter and closes the input', async () => {
    const w = mountCard({ editing: true });
    await w.find('[data-test="card-title"]').trigger('dblclick');
    const input = w.find('[data-test="rename-input"]');
    await input.setValue('  New title  ');
    await input.trigger('keydown', { key: 'Enter' });
    expect(w.emitted('rename')).toEqual([[{ id: 'TALK-1', title: 'New title' }]]);
    expect(w.find('[data-test="rename-input"]').exists()).toBe(false);
  });

  it('commits on blur as well as Enter', async () => {
    const w = mountCard({ editing: true });
    await w.find('[data-test="card-title"]').trigger('dblclick');
    const input = w.find('[data-test="rename-input"]');
    await input.setValue('Blurred title');
    await input.trigger('blur');
    expect(w.emitted('rename')).toEqual([[{ id: 'TALK-1', title: 'Blurred title' }]]);
  });

  it('ignores an empty commit — reverts to the prior title without emitting', async () => {
    const w = mountCard({ editing: true });
    await w.find('[data-test="card-title"]').trigger('dblclick');
    const input = w.find('[data-test="rename-input"]');
    await input.setValue('   ');
    await input.trigger('keydown', { key: 'Enter' });
    expect(w.emitted('rename')).toBeUndefined();
    expect(w.find('[data-test="rename-input"]').exists()).toBe(false);
    expect(w.find('[data-test="card-title"]').text()).toContain('Existing item');
  });

  it('Escape cancels without emitting, restoring the title view', async () => {
    const w = mountCard({ editing: true });
    await w.find('[data-test="card-title"]').trigger('dblclick');
    const input = w.find('[data-test="rename-input"]');
    await input.setValue('Abandoned edit');
    await input.trigger('keydown', { key: 'Escape' });
    expect(w.emitted('rename')).toBeUndefined();
    expect(w.find('[data-test="rename-input"]').exists()).toBe(false);
    expect(w.find('[data-test="card-title"]').text()).toContain('Existing item');
  });

  it('a plain single click on the title still emits select once the double-click window elapses', async () => {
    vi.useFakeTimers();
    try {
      const w = mountCard({ editing: true });
      await w.find('[data-test="card-title"]').trigger('click');
      vi.advanceTimersByTime(300);
      expect(w.emitted('select')).toEqual([[item()]]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a double-click never emits select (only the rename input opens)', async () => {
    vi.useFakeTimers();
    try {
      const w = mountCard({ editing: true });
      const title = w.find('[data-test="card-title"]');
      await title.trigger('click');
      await title.trigger('click');
      await title.trigger('dblclick');
      vi.advanceTimersByTime(300);
      expect(w.emitted('select')).toBeUndefined();
      expect(w.find('[data-test="rename-input"]').exists()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('RoadmapCard — duplicate affordance (fix #3)', () => {
  it('shows the duplicate button in edit mode even when the card is clean', () => {
    const w = mountCard({ editing: true });
    expect(w.find('[data-test="duplicate-item"]').exists()).toBe(true);
  });

  it('hides the duplicate button outside edit mode', () => {
    const w = mountCard({ editing: false });
    expect(w.find('[data-test="duplicate-item"]').exists()).toBe(false);
  });

  it('hides the duplicate button for a pending-deleted card', () => {
    useEditStore().deleteItem('TALK-1');
    const w = mountCard({ editing: true, pending: 'deleted' });
    expect(w.find('[data-test="duplicate-item"]').exists()).toBe(false);
  });

  it('emits duplicate with the item id when clicked', async () => {
    const w = mountCard({ editing: true });
    await w.find('[data-test="duplicate-item"]').trigger('click');
    expect(w.emitted('duplicate')).toEqual([['TALK-1']]);
  });
});

describe('RoadmapCard — `draggable` shows/hides the SortableJS drag handle', () => {
  // Actual dragging is entirely SortableJS's job (wired up from Board.vue against
  // `.roadmap-drag-handle`/`.roadmap-card-item`) — RoadmapCard itself no longer has any
  // drag event handlers of its own. What it owns is whether the handle (the one and only
  // way to start a drag) renders at all, and that it renders as a sibling of the card's own
  // <button>, never nested inside it.
  it('shows the drag handle, with its accessible label, when draggable is true', () => {
    const w = mountCard({ draggable: true });
    const handle = w.find('[data-test="drag-handle"]');
    expect(handle.exists()).toBe(true);
    expect(handle.attributes('aria-label')).toBe('Drag to reorder');
  });

  it('omits the drag handle when draggable is false/omitted', () => {
    const w = mountCard({ draggable: false });
    expect(w.find('[data-test="drag-handle"]').exists()).toBe(false);

    const w2 = mountCard({});
    expect(w2.find('[data-test="drag-handle"]').exists()).toBe(false);
  });

  it('renders the handle as a sibling of the card button, not nested inside it', () => {
    const w = mountCard({ draggable: true });
    const btn = w.get('button.roadmap-card');
    expect(btn.find('[data-test="drag-handle"]').exists()).toBe(false);
    expect(w.find('[data-test="drag-handle"]').exists()).toBe(true);
  });

  it('a click on the handle does not bubble into the card\'s own select handler', async () => {
    const w = mountCard({ draggable: true });
    await w.get('[data-test="drag-handle"]').trigger('click');
    expect(w.emitted('select')).toBeUndefined();
  });
});

describe('RoadmapCard — search highlighting', () => {
  it('marks matching terms in the title and one-liner while searching', () => {
    const w = mountCard({
      item: item({ title: 'Import campaigns', oneliner: 'Campaign import workflow' }),
      highlightQuery: 'import',
    });

    const marks = w.findAll('mark');
    expect(marks.map((mark) => mark.text())).toEqual(['Import', 'import']);
  });

  it('renders no marks when the search query is empty', () => {
    const w = mountCard({
      item: item({ title: 'Import campaigns', oneliner: 'Campaign import workflow' }),
      highlightQuery: '',
    });

    expect(w.find('mark').exists()).toBe(false);
  });

  it('renders no marks in client presentation mode', () => {
    const w = mountCard({
      item: item({ title: 'Import campaigns', oneliner: 'Campaign import workflow' }),
      highlightQuery: 'import',
      client: true,
    });

    expect(w.find('mark').exists()).toBe(false);
  });
});

it('provides arrow-key equivalents for moving cards without opening the item', async () => {
  const w = mountCard({ draggable: true, editing: true });
  const handle = w.get('[data-test="drag-handle"]');
  await handle.trigger('keydown', { key: 'ArrowRight' });
  await handle.trigger('keydown', { key: 'ArrowUp' });
  expect(w.emitted('move')).toEqual([['right'], ['up']]);
  expect(w.emitted('select')).toBeUndefined();
});
