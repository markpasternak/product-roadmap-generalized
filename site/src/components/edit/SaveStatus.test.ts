import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SaveStatus from './SaveStatus.vue';
afterEach(() => vi.useRealTimers());
describe('save status lifecycle', () => {
  it('names the whole publication scope and links changes and validation to their items', async () => {
    const w = mount(SaveStatus, { props: { dirty: 2, summary: {
      edited: [{ id: 'A', title: 'First', changes: [{ label: 'Title', before: 'Old', after: 'New' }] }],
      created: [{ id: 'B', title: 'Second' }], deleted: [], resources: 0, reorderLanes: 0,
    }, issues: [{ id: 'B', title: 'Second', field: 'title', message: 'Title is required' }] } });
    expect(w.get('[data-test="sync"]').text()).toBe('Publish all changes · 2 items');
    expect(w.text()).toContain('Old');
    expect(w.text()).toContain('New');
    await w.get('.save-status-issues button').trigger('click');
    expect(w.emitted('review')).toEqual([['B', 'title']]);
    w.unmount();
  });
  it('offers a workspace retry even when there are no draft changes yet', async () => {
    const w = mount(SaveStatus, { props: { workspaceError: true, blocked: true, blockedReason: 'Could not load your workspace.' } });
    const retry = w.findAll('button').find(button => button.text() === 'Retry loading workspace')!;
    await retry.trigger('click');
    expect(w.emitted('retry-workspace')).toHaveLength(1);
    w.unmount();
  });
  it('does not claim a clean workspace has a saved draft', () => {
    const w = mount(SaveStatus, { props: { detail: 'Private draft saved' } });
    expect(w.find('[data-test="save-status"]').exists()).toBe(false);
    w.unmount();
  });
  it('explains private changes and exposes discard without opening review', async () => {
    const w = mount(SaveStatus, { props: { dirty: 2, detail: 'Private draft saved' } });
    expect(w.text()).toContain('2 unpublished changes');
    expect(w.text()).toContain('Publish to update the roadmap');
    await w.get('.save-status-discard').trigger('click');
    expect(w.emitted('discard')).toHaveLength(1);
    await w.setProps({ discardBlocked: true });
    expect(w.get('.save-status-discard').attributes('disabled')).toBeDefined();
    w.unmount();
  });
  it('dismisses publication status without discarding newer work', async () => {
    const w = mount(SaveStatus, { props: { dirty: 1, publication: { sha: 'one', stage: 'no_build' } } });
    await w.get('[aria-label="Dismiss publication status"]').trigger('click');
    expect(w.text()).toContain('1 unpublished change');
    expect(w.text()).not.toContain('Published to Git');
    expect(w.emitted('discard')).toBeUndefined();
    w.unmount();
  });
  it('clears live confirmation after six seconds, and shows a later publication', async () => {
    vi.useFakeTimers();
    const w = mount(SaveStatus, { props: { publication: { sha: 'one', stage: 'live' } } });
    expect(w.text()).toContain('Your changes are live');
    await vi.advanceTimersByTimeAsync(6000);
    expect(w.find('[data-test="save-status"]').exists()).toBe(false);
    await w.setProps({ publication: { sha: 'two', stage: 'building' } });
    expect(w.text()).toContain('updating the site');
    w.unmount();
  });
  it('keeps failed draft deletion visible until the account confirms it', async () => {
    const w = mount(SaveStatus, { props: { dirty: 0, saveState: 'local' } });
    expect(w.text()).toContain('Account update pending');
    await w.get('.save-status-link').trigger('click');
    expect(w.emitted('retry-save')).toHaveLength(1);
    await w.setProps({ saveState: 'saved' });
    expect(w.find('[data-test="save-status"]').exists()).toBe(false);
    w.unmount();
  });
});

it('offers GitHub sign-in instead of a publication that will fail', async () => {
  const w = mount(SaveStatus, { props: { dirty: 1, authExpired: true, saveState: 'local' } });
  expect(w.find('[data-test="sync"]').exists()).toBe(false);
  await w.get('[data-test="sign-in-again"]').trigger('click');
  expect(w.emitted('signin')).toHaveLength(1);
  expect(w.emitted('publish')).toBeUndefined();
  w.unmount();
});
