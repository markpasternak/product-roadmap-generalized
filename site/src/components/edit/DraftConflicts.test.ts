import { mount } from '@vue/test-utils';
import { describe, it, expect } from 'vitest';
import DraftConflicts from './DraftConflicts.vue';
import { createEditStore } from '../../lib/edit/store';
describe('account draft comparison', () => {
  it('shows overlapping versions and closes without choosing a winner', async () => {
    const store = createEditStore();
    store.clear();
    const mine = store.snapshot();
    mine.bodies.A = 'My text';
    const remote = { ...mine, bodies: { A: 'Saved text' } };
    const w = mount(DraftConflicts, {
      props: { mine, remote, fields: ['bodies.A'], titles: { A: 'Useful title' } },
      attachTo: document.body,
    });
    expect(document.body.textContent).toContain('Useful title · Write-up');
    expect(document.body.textContent).toContain('My text');
    expect(document.body.textContent).toContain('Saved text');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(w.emitted('close')).toHaveLength(1);
    expect(w.emitted('resolve')).toBeUndefined();
    w.unmount();
  });
  it('requires a choice for each overlap and emits only those choices', async () => {
    const store = createEditStore();
    store.clear();
    const w = mount(DraftConflicts, {
      props: { mine: store.snapshot(), remote: store.snapshot(), fields: ['created'], titles: {} },
      attachTo: document.body,
    });
    const confirm = document.querySelector<HTMLButtonElement>('footer button')!;
    expect(confirm.disabled).toBe(true);
    document.querySelector<HTMLInputElement>('input[value="local"]')!.click();
    await w.vm.$nextTick();
    expect(confirm.disabled).toBe(false);
    confirm.click();
    expect(w.emitted('resolve')).toEqual([[{ created: 'local' }]]);
    w.unmount();
  });
});
