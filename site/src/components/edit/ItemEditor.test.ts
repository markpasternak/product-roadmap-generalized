import { describe, it, expect, afterEach } from 'vitest';
import { nextTick } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import ItemEditor, { type ItemEditorItem } from './ItemEditor.vue';
import type { ItemVM } from '../../lib/filters';

// Real body shape (mirrors SectionEditor.test.ts) — a preamble plus one known heading,
// enough to prove the SectionEditor slot is wired through without re-testing its own
// parsing/serialization behavior.
const BODY = `# Migrate off Supabase

## One-liner
Move off Supabase with no feature loss.
`;

const ITEM: ItemEditorItem = {
  id: 'TALK-013',
  product: 'Podcasts & Audiobooks',
  title: 'Migrate off Supabase',
  horizon: 'Now',
  stage: 'Building',
  owner: 'Jules',
  impact: 'High',
  effort: 'Medium',
  visibility: 'Internal',
  tags: ['ads-platform', 'migration'],
  created: '2026-07-01',
  updated: '2026-07-02',
  createdAt: '2026-07-01T09:00:00.000Z',
  updatedAt: '2026-07-02T10:30:00.000Z',
  createdBy: 'Mark',
  updatedBy: 'Roadmap Editor',
  createdSubject: 'seed item',
  updatedSubject: 'edit item',
};

let wrappers: VueWrapper[] = [];
function mountEditor(
  props: {
    item?: ItemEditorItem;
    body?: string;
    isNew?: boolean;
    allTags?: string[];
    allOwners?: string[];
    published?: ItemVM | null;
  } = {},
) {
  const w = mount(ItemEditor, { props: { item: ITEM, body: BODY, ...props } });
  wrappers.push(w);
  return w;
}

afterEach(() => {
  for (const w of wrappers) w.unmount();
  wrappers = [];
  document.body.style.overflow = '';
  delete (globalThis as any).canvasdrop;
});

describe('ItemEditor', () => {
  it("renders the item's current values in the metadata fields and the body in the SectionEditor", () => {
    const w = mountEditor();

    expect((w.find('[data-test="title-field"]').element as HTMLInputElement).value).toBe('Migrate off Supabase');
    // Product is read-only for an existing item (only editable at creation) — shown as text.
    expect(w.find('#item-editor-product').exists()).toBe(false);
    expect(w.find('[data-test="product-readonly"]').text()).toContain('Podcasts & Audiobooks');
    expect((w.find('#item-editor-horizon').element as HTMLSelectElement).value).toBe('Now');
    expect((w.find('#item-editor-stage').element as HTMLSelectElement).value).toBe('Building');
    expect((w.find('[data-test="owner-field"] [data-test="ownerinput-input"]').element as HTMLInputElement).value).toBe(
      'Jules',
    );
    expect((w.find('#item-editor-impact').element as HTMLSelectElement).value).toBe('High');
    expect((w.find('#item-editor-effort').element as HTMLSelectElement).value).toBe('Medium');
    expect((w.find('#item-editor-visibility').element as HTMLSelectElement).value).toBe('Internal');
    expect(w.find('[data-test="history-metadata"]').text()).toContain('Created');
    expect(w.find('[data-test="history-metadata"]').text()).toContain('Updated');
    expect(w.find('[data-test="history-metadata"]').text()).toContain('Jul 1, 2026,');
    expect(w.find('[data-test="history-metadata"]').text()).toContain('Jul 2, 2026,');
    const tagChips = w.findAll('[data-test="tags-field"] [data-test="tag-chip"]').map((c) => c.text());
    expect(tagChips).toEqual(['ads-platform', 'migration']);

    // The narrative body is handed to the embedded SectionEditor, which pins the 3
    // canonical sections at the top regardless of which ones the real body populated.
    expect((w.find('[data-test="spine-oneliner"]').element as HTMLInputElement).value).toBe(
      'Move off Supabase with no feature loss.',
    );
    const sectionLabels = w.findAll('[data-test="spine-label"]').map((l) => l.text());
    expect(sectionLabels).toEqual(['One-liner', 'Why it matters', 'What ships']);
  });

  it('changing a Select (horizon) emits field with the new value', async () => {
    const w = mountEditor();
    await w.find('#item-editor-horizon').setValue('Next');

    const emitted = w.emitted('field');
    expect(emitted).toBeTruthy();
    expect(emitted!.at(-1)![0]).toEqual({ key: 'horizon', value: 'Next' });
  });

  it('changing another Select (visibility) emits field with the new value', async () => {
    const w = mountEditor();
    await w.find('#item-editor-visibility').setValue('Public');

    const emitted = w.emitted('field');
    expect(emitted!.at(-1)![0]).toEqual({ key: 'visibility', value: 'Public' });
  });

  it('editing the title emits field', async () => {
    const w = mountEditor();
    await w.find('[data-test="title-field"]').setValue('Migrate off Supabase entirely');

    const emitted = w.emitted('field');
    expect(emitted!.at(-1)![0]).toEqual({ key: 'title', value: 'Migrate off Supabase entirely' });
  });

  it('adding a tag emits field with the full set joined as a comma-separated string', async () => {
    const w = mountEditor();
    const input = w.find('[data-test="tags-field"] [data-test="taginput-input"]');
    await input.setValue('urgent');
    await input.trigger('keydown', { key: 'Enter' });

    const emitted = w.emitted('field');
    expect(emitted!.at(-1)![0]).toEqual({ key: 'tags', value: 'ads-platform, migration, urgent' });
  });

  it('passes allTags through to TagInput as autocomplete suggestions', async () => {
    const w = mountEditor({ allTags: ['ads-platform', 'migration', 'growth'] });
    const input = w.find('[data-test="tags-field"] [data-test="taginput-input"]');
    await input.trigger('focus');

    // 'ads-platform' and 'migration' are already on the item, so only 'growth' is offered.
    const options = w.findAll('[data-test="taginput-option"]').map((o) => o.text());
    expect(options).toEqual(['growth']);
  });

  it('allTags defaults to empty, so no suggestions dropdown appears', async () => {
    const w = mountEditor();
    const input = w.find('[data-test="tags-field"] [data-test="taginput-input"]');
    await input.trigger('focus');
    expect(w.find('[data-test="taginput-listbox"]').exists()).toBe(false);
  });

  it('changing the owner emits field with the new value', async () => {
    const w = mountEditor();
    const input = w.find('[data-test="owner-field"] [data-test="ownerinput-input"]');
    await input.setValue('Priya');

    const emitted = w.emitted('field');
    expect(emitted!.at(-1)![0]).toEqual({ key: 'owner', value: 'Priya' });
  });

  it('passes allOwners through to OwnerInput as autocomplete suggestions', async () => {
    // An item with no owner yet, so focusing shows the full suggestion list unfiltered.
    const w = mountEditor({ item: { ...ITEM, owner: '' }, allOwners: ['Jules', 'Priya', 'Sam'] });
    const input = w.find('[data-test="owner-field"] [data-test="ownerinput-input"]');
    await input.trigger('focus');

    const options = w.findAll('[data-test="owner-field"] [data-test="ownerinput-option"]').map((o) => o.text());
    expect(options).toEqual(['Jules', 'Priya', 'Sam']);
  });

  it('allOwners defaults to empty, so no suggestions dropdown appears', async () => {
    const w = mountEditor();
    const input = w.find('[data-test="owner-field"] [data-test="ownerinput-input"]');
    await input.trigger('focus');
    expect(w.find('[data-test="owner-field"] [data-test="ownerinput-listbox"]').exists()).toBe(false);
  });

  it('a body edit in the SectionEditor emits update:body', async () => {
    const w = mountEditor();
    await w.find('[data-test="spine-oneliner"]').setValue('Rewritten one-liner.');

    const emitted = w.emitted('update:body');
    expect(emitted).toBeTruthy();
    expect(emitted!.at(-1)![0] as string).toContain('## One-liner\nRewritten one-liner.');
  });

  it('clicking Delete emits delete', async () => {
    const w = mountEditor();
    await w.find('[data-test="delete-button"]').trigger('click');
    expect(w.emitted('delete')).toBeUndefined();
    document.querySelector<HTMLButtonElement>('[data-test=confirm-action]')!.click();
    await nextTick();
    expect(w.emitted('delete')).toBeTruthy();
  });

  it('makes Product editable only for a new item', () => {
    expect(mountEditor().find('#item-editor-product').exists()).toBe(false); // existing → read-only
    expect(mountEditor({ isNew: true }).find('#item-editor-product').exists()).toBe(true); // new → editable Select
  });

  it('hides Delete when isNew is true', () => {
    const w = mountEditor({ isNew: true });
    expect(w.find('[data-test="delete-button"]').exists()).toBe(false);
  });

  describe('Rewrite-with-AI trigger: needs AI available AND body content (not a GitHub id)', () => {
    it('hides the Rewrite trigger when AI is unavailable, even for an existing item', () => {
      // No globalThis.canvasdrop.ai — aiAvailable is false regardless of isNew.
      const w = mountEditor({ isNew: false });
      expect(w.find('[data-test="rewrite-with-ai-button"]').exists()).toBe(false);
    });

    it('shows the Rewrite trigger for an existing (non-new) item once AI is available', () => {
      (globalThis as any).canvasdrop = { ai: { chat: async () => ({}), stream: async function* () {} } };
      const w = mountEditor({ isNew: false });
      expect(w.find('[data-test="rewrite-with-ai-button"]').exists()).toBe(true);
    });

    it('shows the Rewrite trigger for a NOT-YET-SYNCED item that has body content', () => {
      (globalThis as any).canvasdrop = { ai: { chat: async () => ({}), stream: async function* () {} } };
      const w = mountEditor({ isNew: true }); // default BODY is non-empty
      expect(w.find('[data-test="rewrite-with-ai-button"]').exists()).toBe(true);
    });

    it('hides the Rewrite trigger only for a brand-new, still-EMPTY item', () => {
      (globalThis as any).canvasdrop = { ai: { chat: async () => ({}), stream: async function* () {} } };
      const w = mountEditor({ isNew: true, body: '   ' }); // no real content yet
      expect(w.find('[data-test="rewrite-with-ai-button"]').exists()).toBe(false);
    });
  });

  it('clicking Discard changes emits discard', async () => {
    const w = mountEditor();
    await w.find('[data-test="discard-button"]').trigger('click');
    expect(w.emitted('discard')).toBeUndefined();
    document.querySelector<HTMLButtonElement>('[data-test=confirm-action]')!.click();
    await nextTick();
    expect(w.emitted('discard')).toBeTruthy();
  });

  it('clicking Close emits close', async () => {
    const w = mountEditor();
    await w.find('[data-test="close-button"]').trigger('click');
    expect(w.emitted('close')).toBeTruthy();
  });

  it('pressing Escape emits close', () => {
    const w = mountEditor();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(w.emitted('close')).toBeTruthy();
  });

  // R2 fix #4: Escape must close an open TagInput suggestions dropdown first, not the
  // whole editor — only a plain Escape (no dropdown open) should close the editor.
  it('pressing Escape while the tags suggestions dropdown is open closes the dropdown, not the editor', async () => {
    const w = mount(ItemEditor, {
      props: { item: ITEM, body: BODY, allTags: ['ads-platform', 'migration', 'growth'] },
      attachTo: document.body,
    });
    wrappers.push(w);
    const input = w.find('[data-test="tags-field"] [data-test="taginput-input"]');
    await input.trigger('focus');
    expect(w.find('[data-test="taginput-listbox"]').exists()).toBe(true);

    await input.trigger('keydown', { key: 'Escape' });

    expect(w.find('[data-test="taginput-listbox"]').exists()).toBe(false);
    expect(w.emitted('close')).toBeFalsy();
  });

  it('locks body scroll while mounted and releases it on unmount', () => {
    const w = mountEditor();
    expect(document.body.style.overflow).toBe('hidden');
    w.unmount();
    expect(document.body.style.overflow).toBe('');
  });

  // R3 fix #5: the title field is the most useful landing spot on open — for +Add it
  // lets you type a title immediately, and for editing an existing item it's the most
  // commonly-changed field. trapFocus alone would land on the Close button instead,
  // since it precedes the metadata column in DOM order.
  it('moves focus to the title field once mounted', async () => {
    const w = mount(ItemEditor, { props: { item: ITEM, body: BODY }, attachTo: document.body });
    wrappers.push(w);
    await nextTick();
    await nextTick();

    expect(document.activeElement).toBe(w.find('[data-test="title-field"]').element);
  });

  // Fix #6: live card preview mirroring RoadmapCard's dot/stage-pill vocabulary.
  describe('card preview (fix #6)', () => {
    it("shows the item's title, horizon, stage, and product", () => {
      const w = mountEditor();
      expect(w.find('[data-test="preview-title"]').text()).toBe('Migrate off Supabase');
      expect(w.find('[data-test="preview-horizon"]').text()).toContain('Now');
      expect(w.find('[data-test="preview-stage"]').text()).toContain('Building');
      expect(w.find('[data-test="preview-product"]').text()).toContain('Podcasts & Audiobooks');
    });

    it('shows "Untitled" when the title is empty', () => {
      const w = mountEditor({ item: { ...ITEM, title: '' } });
      expect(w.find('[data-test="preview-title"]').text()).toBe('Untitled');
    });

    it('updates live as the bound item prop changes', async () => {
      const w = mountEditor();
      await w.setProps({ item: { ...ITEM, title: 'Renamed', horizon: 'Later', stage: 'Discovery' } });
      expect(w.find('[data-test="preview-title"]').text()).toBe('Renamed');
      expect(w.find('[data-test="preview-horizon"]').text()).toContain('Later');
      expect(w.find('[data-test="preview-stage"]').text()).toContain('Discovery');
    });
  });

  // Fix #5: per-field "changed from published" indicator + reset.
  describe('changed-from-published indicator + reset (fix #5)', () => {
    const PUBLISHED: ItemVM = {
      id: 'TALK-013',
      title: 'Migrate off Supabase',
      product: 'Podcasts & Audiobooks',
      horizon: 'Now',
      stage: 'Building',
      owner: 'Jules',
      impact: 'High',
      effort: 'Medium',
      visibility: 'Internal',
      order: 1,
      updated: '2026-07-01',
      tags: ['ads-platform', 'migration'],
      themes: [],
      oneliner: '',
      outcome: '',
      sections: [],
      editUrl: null,
      links: [],
      text: '',
      href: '/item/TALK-013',
    };

    it('shows no changed markers when published is null (new item)', () => {
      const w = mountEditor({ isNew: true });
      expect(w.find('[data-test="changed-dot-title"]').exists()).toBe(false);
      expect(w.find('[data-test="reset-field-title"]').exists()).toBe(false);
    });

    it('shows no changed markers when the item exactly matches published', () => {
      const w = mountEditor({ published: PUBLISHED });
      expect(w.find('[data-test="changed-dot-title"]').exists()).toBe(false);
      expect(w.find('[data-test="changed-dot-stage"]').exists()).toBe(false);
      expect(w.find('[data-test="changed-dot-tags"]').exists()).toBe(false);
    });

    it('marks a scalar field changed and emits resetField on click', async () => {
      const w = mountEditor({
        item: { ...ITEM, stage: 'Shipped' },
        published: PUBLISHED,
      });
      expect(w.find('[data-test="changed-dot-stage"]').exists()).toBe(true);
      expect(w.find('[data-test="reset-field-stage"]').exists()).toBe(true);

      await w.find('[data-test="reset-field-stage"]').trigger('click');
      expect(w.emitted('resetField')).toEqual([['stage']]);
    });

    it('does not mark an unrelated field changed', () => {
      const w = mountEditor({
        item: { ...ITEM, stage: 'Shipped' },
        published: PUBLISHED,
      });
      expect(w.find('[data-test="changed-dot-owner"]').exists()).toBe(false);
    });

    it('treats whitespace-only differences as unchanged', () => {
      const w = mountEditor({
        item: { ...ITEM, title: '  Migrate off Supabase  ' },
        published: PUBLISHED,
      });
      expect(w.find('[data-test="changed-dot-title"]').exists()).toBe(false);
    });

    it('treats tags as changed only when the set differs, ignoring order/case/spacing', () => {
      const w = mountEditor({
        item: { ...ITEM, tags: ['Migration', 'ads-platform'] }, // same set, different order/case
        published: PUBLISHED,
      });
      expect(w.find('[data-test="changed-dot-tags"]').exists()).toBe(false);
    });

    it('marks tags changed when the set actually differs', async () => {
      const w = mountEditor({
        item: { ...ITEM, tags: ['ads-platform', 'migration', 'urgent'] },
        published: PUBLISHED,
      });
      expect(w.find('[data-test="changed-dot-tags"]').exists()).toBe(true);

      await w.find('[data-test="reset-field-tags"]').trigger('click');
      expect(w.emitted('resetField')).toEqual([['tags']]);
    });
  });

  it('closing and reopening still restores focus to the previously active element (focus trap unaffected)', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const w = mount(ItemEditor, { props: { item: ITEM, body: BODY }, attachTo: document.body });
    await nextTick();
    await nextTick();
    expect(document.activeElement).toBe(w.find('[data-test="title-field"]').element);

    w.unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
