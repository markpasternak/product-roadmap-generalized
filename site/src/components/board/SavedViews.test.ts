import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import SavedViews from './SavedViews.vue';
import { emptyFilters } from '../../lib/filters';
import { DEFAULT_VIEW, SAVED_VIEWS_KEY, readSavedViews, snapshotView } from '../../lib/savedViews';

const wrappers: VueWrapper[] = [];
const weekly = () => snapshotView('Weekly review', { ...emptyFilters(), product: 'Podcasts & Audiobooks', owner: 'Axel', tags: ['foundation'] }, ['Now', 'Next'], 'updated');
function mountViews(view = DEFAULT_VIEW) {
  const wrapper = mount(SavedViews, { props: { filters: { ...view.filters }, horizons: [...view.horizons], sort: view.sort }, attachTo: document.body });
  wrappers.push(wrapper);
  return wrapper;
}
function button(w: VueWrapper, name: string) {
  const match = w.findAll('button').find(element => element.text() === name);
  if (!match) throw new Error(`Button not found: ${name}`);
  return match;
}
const picker = (w: VueWrapper) => w.get('button[aria-controls]');
const stored = () => readSavedViews(localStorage.getItem(SAVED_VIEWS_KEY));
async function create(w: VueWrapper, name: string) {
  await button(w, 'Save view').trigger('click');
  await w.get('input').setValue(name);
  await w.get('form').trigger('submit');
}
async function edit(w: VueWrapper, name: string) {
  await picker(w).trigger('click');
  await w.get(`button[aria-label="Edit view ${name}"]`).trigger('click');
}
beforeEach(() => localStorage.clear());
afterEach(() => { wrappers.splice(0).forEach(w => w.unmount()); vi.unstubAllGlobals(); localStorage.clear(); vi.restoreAllMocks(); });

describe('saved view picker', () => {
  it('shows only personal saved views and returns focus after choosing one', async () => {
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify([weekly()]));
    const w = mountViews();
    expect(picker(w).text()).toBe('Current view');
    await picker(w).trigger('click');
    expect(w.text()).toContain('Your saved views');
    expect(w.text()).toContain('Saved in this browser');
    expect(w.text()).not.toContain('Quick views');
    expect(w.text()).not.toContain('All priorities');
    expect(w.text()).not.toContain('Now: early stage');
    await w.get('button[aria-pressed]').trigger('click');
    expect(w.emitted('apply')?.[0]).toEqual([weekly()]);
    expect(picker(w).attributes('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(picker(w).element);
  });

  it('carries over existing views and saves the full current selection under a new name', async () => {
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify([weekly()]));
    const w = mountViews(weekly());
    await w.vm.$nextTick();
    expect(picker(w).text()).toBe('Weekly review');
    await create(w, '  Partner check-in  ');
    expect(stored()).toEqual([weekly(), { ...weekly(), name: 'Partner check-in' }]);
    expect(picker(w).text()).toBe('Partner check-in');
    expect(w.get('[role="status"]').text()).toContain('Saved');
  });

  it('keeps edits unsaved until Save changes updates the selected view in place', async () => {
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify([weekly()]));
    const w = mountViews(weekly());
    const filters = { ...weekly().filters, q: 'creative', owner: 'Billy', group: 'product' as const };
    await w.setProps({ filters, horizons: [], sort: 'impact' });
    expect(w.text()).toContain('Modified');
    expect(stored()).toEqual([weekly()]);
    await button(w, 'Save changes').trigger('click');
    expect(stored()).toEqual([snapshotView('Weekly review', filters, [], 'impact')]);
    expect(w.text()).not.toContain('Modified');
    expect(w.emitted('apply')).toBeUndefined();
  });

  it('resets a modified view without overwriting its saved selection', async () => {
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify([weekly()]));
    const w = mountViews(weekly());
    await w.setProps({ filters: emptyFilters() });
    await button(w, 'Reset').trigger('click');
    expect(w.emitted('apply')?.[0]).toEqual([weekly()]);
    expect(stored()).toEqual([weekly()]);
  });

  it('renames the saved snapshot while retaining its unsaved current edits', async () => {
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify([weekly()]));
    const w = mountViews(weekly());
    await w.setProps({ filters: { ...weekly().filters, q: 'unsaved search' } });
    await edit(w, 'Weekly review');
    await w.get('input').setValue('Team review');
    await w.get('form').trigger('submit');
    expect(stored()).toEqual([{ ...weekly(), name: 'Team review' }]);
    expect(picker(w).text()).toBe('Team review');
    expect(w.text()).toContain('Modified');
    expect(w.emitted('apply')).toBeUndefined();
  });

  it('undoes a removal in its original position without changing the board', async () => {
    const other = snapshotView('Data check', { ...emptyFilters(), product: 'Core Platform & Data' }, ['Now'], 'title');
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify([weekly(), other]));
    const w = mountViews(weekly());
    await edit(w, 'Weekly review');
    await button(w, 'Remove view').trigger('click');
    expect(stored()).toEqual([other]);
    await button(w, 'Undo').trigger('click');
    expect(stored()).toEqual([weekly(), other]);
    expect(picker(w).text()).toBe('Weekly review');
    expect(w.emitted('apply')).toBeUndefined();
  });

  it.each(['weekly REVIEW', '   '])('rejects ambiguous or empty names: %s', async name => {
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify([weekly()]));
    const w = mountViews();
    await create(w, name);
    expect(w.get('[role="alert"]').text()).toBeTruthy();
    expect(w.get('input').attributes('aria-invalid')).toBe('true');
    expect(stored()).toEqual([weekly()]);
  });

  it('keeps the form and existing views intact when browser storage fails', async () => {
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify([weekly()]));
    const w = mountViews();
    vi.stubGlobal('localStorage', {
      getItem: localStorage.getItem.bind(localStorage),
      setItem: () => { throw new Error('quota exceeded'); },
    });
    await create(w, 'Another review');
    expect(w.get('[role="alert"]').text()).toContain('couldn’t save');
    expect(w.get('input').element.value).toBe('Another review');
    expect(stored()).toEqual([weekly()]);
    expect(w.find('[role="status"]').exists()).toBe(false);
  });

  it('dismisses with Escape or an outside click without saving a draft', async () => {
    const w = mountViews();
    await button(w, 'Save view').trigger('click');
    expect(document.activeElement).toBe(w.get('input').element);
    await w.get('input').trigger('keydown', { key: 'Escape' });
    expect(picker(w).attributes('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(picker(w).element);
    await picker(w).trigger('click');
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await w.vm.$nextTick();
    expect(picker(w).attributes('aria-expanded')).toBe('false');
    expect(stored()).toEqual([]);
  });

  it('keeps the name form open through its focus handoff, then closes when Tab leaves', async () => {
    const w = mountViews();
    await picker(w).trigger('click');
    await button(w, 'Save as new view').trigger('click');
    await w.trigger('focusout', { relatedTarget: null });
    expect(w.find('input').exists()).toBe(true);
    expect(document.activeElement).toBe(w.get('input').element);
    await w.trigger('focusout', { relatedTarget: document.body });
    expect(picker(w).attributes('aria-expanded')).toBe('true');
    await w.trigger('focusout', { relatedTarget: document.createElement('button') });
    expect(picker(w).attributes('aria-expanded')).toBe('false');
  });

  it('refreshes views changed in another tab and guards Undo against a name collision', async () => {
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify([weekly()]));
    const w = mountViews(weekly());
    await edit(w, 'Weekly review');
    await button(w, 'Remove view').trigger('click');
    const replacement = { ...weekly(), horizons: ['Later'] };
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify([replacement]));
    window.dispatchEvent(new StorageEvent('storage', { key: SAVED_VIEWS_KEY, newValue: JSON.stringify([replacement]) }));
    await w.vm.$nextTick();
    await button(w, 'Undo').trigger('click');
    expect(w.get('[role="alert"]').text()).toContain('another tab');
    expect(stored()).toEqual([replacement]);
  });

  it('keeps a full collection intact when the user tries to save a 31st view', async () => {
    const full = Array.from({ length: 30 }, (_, i) => ({ ...weekly(), name: `View ${i + 1}` }));
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(full));
    const w = mountViews();
    await create(w, 'One more view');
    expect(w.get('[role="alert"]').text()).toContain('30 views');
    expect(stored()).toEqual(full);
  });
});
