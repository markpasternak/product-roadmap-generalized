import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import TagInput from './TagInput.vue';

let wrappers: VueWrapper[] = [];
function mountInput(props: { modelValue?: string[]; suggestions?: string[]; id?: string } = {}) {
  const w = mount(TagInput, {
    props: { modelValue: [], suggestions: [], ...props },
    attachTo: document.body,
  });
  wrappers.push(w);
  return w;
}

afterEach(() => {
  for (const w of wrappers) w.unmount();
  wrappers = [];
});

describe('TagInput', () => {
  it('renders a chip for each tag in modelValue', () => {
    const w = mountInput({ modelValue: ['ads-platform', 'migration'] });
    const chips = w.findAll('[data-test="tag-chip"]');
    expect(chips).toHaveLength(2);
    expect(chips[0]!.text()).toContain('ads-platform');
    expect(chips[1]!.text()).toContain('migration');
  });

  it('typing a new tag and pressing Enter emits it appended to modelValue', async () => {
    const w = mountInput({ modelValue: ['ads-platform'] });
    const input = w.find('[data-test="taginput-input"]');
    await input.setValue('urgent');
    await input.trigger('keydown', { key: 'Enter' });

    expect(w.emitted('update:modelValue')?.at(-1)![0]).toEqual(['ads-platform', 'urgent']);
  });

  it('comma also commits the typed value', async () => {
    const w = mountInput({ modelValue: [] });
    const input = w.find('[data-test="taginput-input"]');
    await input.setValue('growth');
    await input.trigger('keydown', { key: ',' });

    expect(w.emitted('update:modelValue')?.at(-1)![0]).toEqual(['growth']);
  });

  it('clicking a suggestion in the dropdown adds it', async () => {
    const w = mountInput({ modelValue: [], suggestions: ['ads-platform', 'growth', 'urgent'] });
    const input = w.find('[data-test="taginput-input"]');
    await input.trigger('focus');
    await input.setValue('gro');

    const options = w.findAll('[data-test="taginput-option"]');
    expect(options).toHaveLength(1);
    expect(options[0]!.text()).toBe('growth');
    await options[0]!.trigger('click');

    expect(w.emitted('update:modelValue')?.at(-1)![0]).toEqual(['growth']);
  });

  it('an already-selected tag is not offered as a suggestion', async () => {
    const w = mountInput({ modelValue: ['growth'], suggestions: ['ads-platform', 'growth', 'urgent'] });
    const input = w.find('[data-test="taginput-input"]');
    await input.trigger('focus');

    const options = w.findAll('[data-test="taginput-option"]').map((o) => o.text());
    expect(options).not.toContain('growth');
    expect(options).toEqual(expect.arrayContaining(['ads-platform', 'urgent']));
  });

  it('clicking the × on a chip removes that tag', async () => {
    const w = mountInput({ modelValue: ['ads-platform', 'migration', 'urgent'] });
    const removes = w.findAll('[data-test="tag-remove"]');
    await removes[1]!.trigger('click');

    expect(w.emitted('update:modelValue')?.at(-1)![0]).toEqual(['ads-platform', 'urgent']);
  });

  it('Backspace on an empty input removes the last chip', async () => {
    const w = mountInput({ modelValue: ['ads-platform', 'migration'] });
    const input = w.find('[data-test="taginput-input"]');
    await input.trigger('keydown', { key: 'Backspace' });

    expect(w.emitted('update:modelValue')?.at(-1)![0]).toEqual(['ads-platform']);
  });

  it('Backspace with text in the input does not remove a chip', async () => {
    const w = mountInput({ modelValue: ['ads-platform'] });
    const input = w.find('[data-test="taginput-input"]');
    await input.setValue('partial');
    await input.trigger('keydown', { key: 'Backspace' });

    expect(w.emitted('update:modelValue')).toBeFalsy();
  });

  it('trims whitespace and dedupes case-insensitively', async () => {
    const w = mountInput({ modelValue: ['Ads Platform'] });
    const input = w.find('[data-test="taginput-input"]');
    await input.setValue('  infra  ');
    await input.trigger('keydown', { key: 'Enter' });

    // Duplicate (case-insensitive) of an existing tag: no new emit with an extra entry.
    const emitted = w.emitted('update:modelValue');
    expect(emitted === undefined || emitted.at(-1)![0]).not.toEqual(['Ads Platform', 'ads-platform']);
  });

  it('dropdown lists suggestions on focus even with an empty draft', async () => {
    const w = mountInput({ modelValue: [], suggestions: ['ads-platform', 'growth'] });
    const input = w.find('[data-test="taginput-input"]');
    await input.trigger('focus');

    expect(w.findAll('[data-test="taginput-option"]')).toHaveLength(2);
  });

  it('ArrowDown highlights a suggestion, and Enter commits the highlighted one', async () => {
    const w = mountInput({ modelValue: [], suggestions: ['ads-platform', 'growth'] });
    const input = w.find('[data-test="taginput-input"]');
    await input.trigger('focus');
    await input.trigger('keydown', { key: 'ArrowDown' });
    await input.trigger('keydown', { key: 'Enter' });

    expect(w.emitted('update:modelValue')?.at(-1)![0]).toEqual(['ads-platform']);
  });

  // R2 fix #4: Escape must close the dropdown without bubbling to a document-level
  // listener (ItemEditor closes the whole editor on Escape) — otherwise Escape while
  // the suggestions dropdown is open closes the entire editor instead of just it.
  describe('Escape precedence', () => {
    it('closes the open dropdown and stops the keydown from bubbling to document', async () => {
      const w = mountInput({ modelValue: [], suggestions: ['ads-platform', 'growth'] });
      const input = w.find('[data-test="taginput-input"]');
      await input.trigger('focus');
      expect(w.find('[data-test="taginput-listbox"]').exists()).toBe(true);

      const docHandler = vi.fn();
      document.addEventListener('keydown', docHandler);
      await input.trigger('keydown', { key: 'Escape' });
      document.removeEventListener('keydown', docHandler);

      expect(w.find('[data-test="taginput-listbox"]').exists()).toBe(false);
      expect(docHandler).not.toHaveBeenCalled();
    });

    it('lets Escape bubble to document when the dropdown is already closed', async () => {
      const w = mountInput({ modelValue: [], suggestions: ['ads-platform', 'growth'] });
      const input = w.find('[data-test="taginput-input"]');
      expect(w.find('[data-test="taginput-listbox"]').exists()).toBe(false);

      const docHandler = vi.fn();
      document.addEventListener('keydown', docHandler);
      await input.trigger('keydown', { key: 'Escape' });
      document.removeEventListener('keydown', docHandler);

      expect(docHandler).toHaveBeenCalledTimes(1);
    });
  });
});
