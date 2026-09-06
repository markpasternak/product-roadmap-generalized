import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import OwnerInput from './OwnerInput.vue';

let wrappers: VueWrapper[] = [];
function mountInput(props: { modelValue?: string; suggestions?: string[]; id?: string } = {}) {
  const w = mount(OwnerInput, {
    props: { modelValue: '', suggestions: [], ...props },
    attachTo: document.body,
  });
  wrappers.push(w);
  return w;
}

afterEach(() => {
  for (const w of wrappers) w.unmount();
  wrappers = [];
});

describe('OwnerInput', () => {
  it('renders the current modelValue in the input', () => {
    const w = mountInput({ modelValue: 'Jules' });
    expect((w.find('[data-test="ownerinput-input"]').element as HTMLInputElement).value).toBe('Jules');
  });

  it('shows all suggestions on focus when empty', async () => {
    const w = mountInput({ modelValue: '', suggestions: ['Jules', 'Priya', 'Sam'] });
    const input = w.find('[data-test="ownerinput-input"]');
    await input.trigger('focus');

    const options = w.findAll('[data-test="ownerinput-option"]').map((o) => o.text());
    expect(options).toEqual(['Jules', 'Priya', 'Sam']);
  });

  it('filters suggestions case-insensitively by what is typed', async () => {
    const w = mountInput({ modelValue: '', suggestions: ['Jules', 'Priya', 'Sam'] });
    const input = w.find('[data-test="ownerinput-input"]');
    await input.trigger('focus');
    await input.setValue('pri');

    const options = w.findAll('[data-test="ownerinput-option"]').map((o) => o.text());
    expect(options).toEqual(['Priya']);
  });

  it('typing emits update:modelValue with the raw typed value on every keystroke (free text allowed)', async () => {
    const w = mountInput({ modelValue: '' });
    const input = w.find('[data-test="ownerinput-input"]');
    await input.setValue('A Brand New Owner');

    expect(w.emitted('update:modelValue')?.at(-1)![0]).toBe('A Brand New Owner');
  });

  it('clicking a suggestion emits it as the new modelValue', async () => {
    const w = mountInput({ modelValue: '', suggestions: ['Jules', 'Priya', 'Sam'] });
    const input = w.find('[data-test="ownerinput-input"]');
    await input.trigger('focus');
    await input.setValue('pri');

    const options = w.findAll('[data-test="ownerinput-option"]');
    expect(options).toHaveLength(1);
    await options[0]!.trigger('click');

    expect(w.emitted('update:modelValue')?.at(-1)![0]).toBe('Priya');
  });

  it('ArrowDown highlights a suggestion, and Enter commits the highlighted one', async () => {
    const w = mountInput({ modelValue: '', suggestions: ['Jules', 'Priya'] });
    const input = w.find('[data-test="ownerinput-input"]');
    await input.trigger('focus');
    await input.trigger('keydown', { key: 'ArrowDown' });
    await input.trigger('keydown', { key: 'Enter' });

    expect(w.emitted('update:modelValue')?.at(-1)![0]).toBe('Jules');
  });

  it('selecting a suggestion closes the dropdown', async () => {
    const w = mountInput({ modelValue: '', suggestions: ['Jules', 'Priya'] });
    const input = w.find('[data-test="ownerinput-input"]');
    await input.trigger('focus');
    const options = w.findAll('[data-test="ownerinput-option"]');
    await options[0]!.trigger('click');

    expect(w.find('[data-test="ownerinput-listbox"]').exists()).toBe(false);
  });

  it('clicking outside the component closes the dropdown', async () => {
    const w = mountInput({ modelValue: '', suggestions: ['Jules', 'Priya'] });
    const input = w.find('[data-test="ownerinput-input"]');
    await input.trigger('focus');
    expect(w.find('[data-test="ownerinput-listbox"]').exists()).toBe(true);

    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await w.vm.$nextTick();

    expect(w.find('[data-test="ownerinput-listbox"]').exists()).toBe(false);
  });

  // Escape must close the dropdown without bubbling to a document-level listener —
  // ItemEditor closes the whole editor on Escape, and closing the suggestions dropdown
  // shouldn't take the whole panel with it (same pattern as TagInput).
  describe('Escape precedence', () => {
    it('closes the open dropdown and stops the keydown from bubbling to document', async () => {
      const w = mountInput({ modelValue: '', suggestions: ['Jules', 'Priya'] });
      const input = w.find('[data-test="ownerinput-input"]');
      await input.trigger('focus');
      expect(w.find('[data-test="ownerinput-listbox"]').exists()).toBe(true);

      const docHandler = vi.fn();
      document.addEventListener('keydown', docHandler);
      await input.trigger('keydown', { key: 'Escape' });
      document.removeEventListener('keydown', docHandler);

      expect(w.find('[data-test="ownerinput-listbox"]').exists()).toBe(false);
      expect(docHandler).not.toHaveBeenCalled();
    });

    it('lets Escape bubble to document when the dropdown is already closed', async () => {
      const w = mountInput({ modelValue: '', suggestions: ['Jules', 'Priya'] });
      const input = w.find('[data-test="ownerinput-input"]');
      expect(w.find('[data-test="ownerinput-listbox"]').exists()).toBe(false);

      const docHandler = vi.fn();
      document.addEventListener('keydown', docHandler);
      await input.trigger('keydown', { key: 'Escape' });
      document.removeEventListener('keydown', docHandler);

      expect(docHandler).toHaveBeenCalledTimes(1);
    });
  });
});

it('closes suggestions when keyboard focus leaves the control', async () => {
  const w = mount(OwnerInput, { props: { modelValue: '', suggestions: ['Design'] } });
  await w.get('input').trigger('focus');
  expect(w.find('[role="listbox"]').exists()).toBe(true);
  const next = document.createElement('button');
  await w.get('input').trigger('focusout', { relatedTarget: next });
  expect(w.find('[role="listbox"]').exists()).toBe(false);
  w.unmount();
});
