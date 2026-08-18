import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import SyncBar from './SyncBar.vue';

describe('SyncBar', () => {
  it('hides when nothing is dirty', () => {
    const w = mount(SyncBar, { props: { dirtyCount: 0, pending: false, result: null, error: null } });
    expect(w.find('[data-test="sync"]').exists()).toBe(false);
  });
  it('shows count and emits sync', async () => {
    const w = mount(SyncBar, { props: { dirtyCount: 3, pending: false, result: null, error: null } });
    expect(w.text()).toContain('3');
    await w.get('[data-test="sync"]').trigger('click');
    expect(w.emitted('sync')).toHaveLength(1);
  });
  it('shows the synced confirmation and stays visible with no dirty count', () => {
    const w = mount(SyncBar, { props: { dirtyCount: 0, pending: false, result: { sha: 'abc123' }, error: null } });
    expect(w.text()).toContain('Synced');
    expect(w.find('[data-test="sync"]').exists()).toBe(false);
  });
  it('shows the sync error', () => {
    const w = mount(SyncBar, { props: { dirtyCount: 2, pending: false, error: 'stage: invalid', result: null } });
    expect(w.text()).toContain('stage: invalid');
  });
  it('shows the publishing state (and stays visible even with no dirty count)', () => {
    const w = mount(SyncBar, {
      props: { dirtyCount: 0, pending: false, result: { sha: 'abc123' }, error: null, publishing: { sha: 'abc123' } },
    });
    expect(w.find('[data-test="publishing-state"]').exists()).toBe(true);
    expect(w.text()).toContain('Publishing');
    expect(w.text()).not.toContain('Synced');
  });
  it('disables the sync button while pending', () => {
    const w = mount(SyncBar, { props: { dirtyCount: 1, pending: true, result: null, error: null } });
    expect((w.get('[data-test="sync"]').element as HTMLButtonElement).disabled).toBe(true);
  });

  it('gives the error a distinct, error-toned treatment rather than a neutral note', () => {
    const w = mount(SyncBar, { props: { dirtyCount: 2, pending: false, error: 'stage: invalid', result: null } });
    const err = w.get('[data-test="sync-error"]');
    expect(err.classes()).toContain('font-semibold');
    expect((err.element as HTMLElement).style.color).toContain('feedback-error');
  });

  describe('discard all', () => {
    // Confirmation now happens one level up, in Board's onDiscardAll (it knows the live
    // dirty count and can word the prompt accordingly) — this button just reports the click.
    it('emits discard immediately, with no confirmation of its own', async () => {
      const w = mount(SyncBar, { props: { dirtyCount: 2, pending: false, result: null, error: null } });
      const confirmSpy = vi.spyOn(window, 'confirm');
      await w.get('[data-test="discard-all"]').trigger('click');
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(w.emitted('discard')).toHaveLength(1);
      confirmSpy.mockRestore();
    });
  });

  describe('overwrite warning', () => {
    it('is hidden by default', () => {
      const w = mount(SyncBar, { props: { dirtyCount: 1, pending: false, result: null, error: null } });
      expect(w.find('[data-test="overwrite-warning"]').exists()).toBe(false);
    });
    it('shows a non-blocking warning when a newer version is live', () => {
      const w = mount(SyncBar, {
        props: { dirtyCount: 1, pending: false, result: null, error: null, overwriteWarning: true },
      });
      const warning = w.get('[data-test="overwrite-warning"]');
      expect(warning.text()).toContain('newer version is live');
      // Non-blocking: Sync stays enabled.
      expect((w.get('[data-test="sync"]').element as HTMLButtonElement).disabled).toBe(false);
    });
  });

  describe('review popover (fix #8)', () => {
    const changeSummary = {
      edited: [{ id: 'TALK-1', title: 'Existing item' }],
      created: [{ title: 'New idea', product: 'Music App' }],
      deleted: [{ id: 'TALK-2', title: 'Old item' }],
      reorderLanes: 2,
    };

    it('stays closed until the dirty count is clicked', () => {
      const w = mount(SyncBar, {
        props: { dirtyCount: 3, pending: false, result: null, error: null, changeSummary },
      });
      expect(w.find('[data-test="review-panel"]').exists()).toBe(false);
    });

    it('opens on click and lists the grouped, name-resolved summary', async () => {
      const w = mount(SyncBar, {
        props: { dirtyCount: 3, pending: false, result: null, error: null, changeSummary },
      });
      await w.get('[data-test="review-toggle"]').trigger('click');

      const panel = w.get('[data-test="review-panel"]');
      expect(panel.text()).toContain('Existing item');
      expect(w.get('[data-test="review-created"]').text()).toContain('New idea');
      expect(w.get('[data-test="review-deleted"]').text()).toContain('Old item');
      expect(w.get('[data-test="review-reorder"]').text()).toContain('Reordered 2 lanes');
    });

    it('toggles closed again on a second click', async () => {
      const w = mount(SyncBar, {
        props: { dirtyCount: 3, pending: false, result: null, error: null, changeSummary },
      });
      await w.get('[data-test="review-toggle"]').trigger('click');
      expect(w.find('[data-test="review-panel"]').exists()).toBe(true);
      await w.get('[data-test="review-toggle"]').trigger('click');
      expect(w.find('[data-test="review-panel"]').exists()).toBe(false);
    });

    it('caps a long list at 5 names and appends "+N more"', async () => {
      const many = {
        edited: Array.from({ length: 7 }, (_, i) => ({ id: `TALK-${i}`, title: `Item ${i}` })),
        created: [],
        deleted: [],
        reorderLanes: 0,
      };
      const w = mount(SyncBar, {
        props: { dirtyCount: 7, pending: false, result: null, error: null, changeSummary: many },
      });
      await w.get('[data-test="review-toggle"]').trigger('click');

      const text = w.get('[data-test="review-edited"]').text();
      expect(text).toContain('Item 0');
      expect(text).toContain('Item 4');
      expect(text).not.toContain('Item 5');
      expect(text).toContain('+2 more');
    });

    it('falls back to "Untitled" for a not-yet-titled created item', async () => {
      const w = mount(SyncBar, {
        props: {
          dirtyCount: 1,
          pending: false,
          result: null,
          error: null,
          changeSummary: { edited: [], created: [{ title: '', product: 'Music App' }], deleted: [], reorderLanes: 0 },
        },
      });
      await w.get('[data-test="review-toggle"]').trigger('click');
      expect(w.get('[data-test="review-created"]').text()).toContain('Untitled');
    });

    it('shows nothing to review when the changeSummary prop is omitted', async () => {
      const w = mount(SyncBar, { props: { dirtyCount: 2, pending: false, result: null, error: null } });
      await w.get('[data-test="review-toggle"]').trigger('click');
      expect(w.find('[data-test="review-panel"]').exists()).toBe(false);
    });
  });
});
