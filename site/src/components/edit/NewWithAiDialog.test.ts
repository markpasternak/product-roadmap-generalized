// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { nextTick } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import NewWithAiDialog from './NewWithAiDialog.vue';

const draftItemMock = vi.fn();
vi.mock('../../lib/ai/draftItem', () => ({
  draftItem: (...args: unknown[]) => draftItemMock(...args),
}));

let wrappers: VueWrapper[] = [];
function mountDialog(props: Record<string, unknown> = {}) {
  const w = mount(NewWithAiDialog, { props, attachTo: document.body });
  wrappers.push(w);
  return w;
}

afterEach(() => {
  for (const w of wrappers) w.unmount();
  wrappers = [];
  document.body.style.overflow = '';
  draftItemMock.mockReset();
});

describe('NewWithAiDialog', () => {
  it('Generate is disabled and no second call is made while a generation is in flight', async () => {
    draftItemMock.mockImplementation(() => new Promise(() => {})); // never resolves in this test

    const w = mountDialog();
    await w.find('[data-test="ai-prompt"]').setValue('Let editors bulk-tag items from a multi-select.');
    const generateBtn = w.find('[data-test="ai-generate"]');
    await generateBtn.trigger('click');

    expect(draftItemMock).toHaveBeenCalledTimes(1);
    expect((generateBtn.element as HTMLButtonElement).disabled).toBe(true);

    // A second click while the first call is still in flight must not fire another.
    await generateBtn.trigger('click');
    expect(draftItemMock).toHaveBeenCalledTimes(1);
  });

  it('Escape cancels an in-flight generation (client-side abort) and closes the dialog', async () => {
    draftItemMock.mockImplementation(() => new Promise(() => {})); // never resolves in this test
    const w = mountDialog();
    await w.find('[data-test="ai-prompt"]').setValue('Let editors bulk-tag items from a multi-select.');
    await w.find('[data-test="ai-generate"]').trigger('click');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await nextTick();
    expect(w.emitted('close')).toBeTruthy();

    // The header close (X) button is no longer disabled while generating.
    expect(w.find('[aria-label="Close"]').attributes('disabled')).toBeUndefined();
  });

  it('the Stop button cancels an in-flight generation, resets state, and keeps the dialog open', async () => {
    draftItemMock.mockImplementation(() => new Promise(() => {})); // never resolves in this test
    const w = mountDialog();
    await w.find('[data-test="ai-prompt"]').setValue('Let editors bulk-tag items from a multi-select.');
    await w.find('[data-test="ai-generate"]').trigger('click');
    await nextTick();
    expect(w.find('[data-test="ai-stop"]').exists()).toBe(true);

    await w.find('[data-test="ai-stop"]').trigger('click');
    await nextTick();

    expect(w.emitted('close')).toBeFalsy(); // dialog stays open
    expect(w.find('[data-test="ai-stop"]').exists()).toBe(false); // generating reset
    expect((w.find('[data-test="ai-generate"]').element as HTMLButtonElement).disabled).toBe(false);
  });

  it('a completed generation emits drafted with the draft plus the selected product', async () => {
    draftItemMock.mockResolvedValue({ title: 'Bulk tag editing', frontmatter: { stage: 'Shaping' }, body: '## One-liner\nBulk-tag items.' });
    const w = mountDialog();
    await w.find('[data-test="ai-prompt"]').setValue('Let editors bulk-tag items from a multi-select.');
    await w.find('[data-test="ai-generate"]').trigger('click');
    await Promise.resolve();
    await Promise.resolve();

    expect(w.emitted('drafted')).toBeTruthy();
    const [payload] = w.emitted('drafted')![0] as [{ title: string; product: string }];
    expect(payload.title).toBe('Bulk tag editing');
    expect(payload.product).toBeTruthy();
  });
});
