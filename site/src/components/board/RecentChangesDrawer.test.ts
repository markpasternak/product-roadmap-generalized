import { mount, flushPromises } from '@vue/test-utils';
import { expect, it, vi } from 'vitest';
import RecentChangesDrawer from './RecentChangesDrawer.vue';
vi.mock('../../lib/activity', async () => ({ ...await vi.importActual('../../lib/activity'), fetchActivity: vi.fn(async () => []) }));
it('supports keyboard dismissal, restores focus and releases scrolling', async () => {
  const opener=document.createElement('button');document.body.append(opener);opener.focus();
  const w=mount(RecentChangesDrawer,{props:{items:[],base:'/'},attachTo:document.body});
  await flushPromises();
  expect(document.activeElement?.id).toBe('changes-drawer-title');
  expect(document.body.style.overflow).toBe('hidden');
  expect(document.body.textContent).toContain('No commit activity to show');
  document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));
  expect(w.emitted('close')).toHaveLength(1);
  w.unmount();
  expect(document.activeElement).toBe(opener);
  expect(document.body.style.overflow).not.toBe('hidden');
  opener.remove();
});
