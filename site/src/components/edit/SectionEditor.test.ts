import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import SectionEditor from './SectionEditor.vue';
import MarkdownEditor from './MarkdownEditor.vue';
import { CANONICAL_SECTIONS } from '../../lib/edit/sections';

// The editor schedules delayed preview/zoom work. Finish it while the test DOM
// still exists, and unmount every wrapper instead of leaking it into later tests.
beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
enableAutoUnmount(cleanup => afterEach(async () => {
  cleanup();
  try { await vi.runOnlyPendingTimersAsync(); }
  finally { vi.clearAllTimers(); vi.useRealTimers(); }
}));

// Real body shape (see content/items/podcasts-audiobooks/TALK-013-migrate-off-supabase.md):
// a title preamble, two of the three canonical headings, and one custom/optional
// heading to prove SectionEditor doesn't special-case known optional section names.
const BODY = `# Migrate off Supabase

## One-liner
Move off Supabase with no feature loss.

## Why it matters
Some reasoning here.

## Custom Heading
Custom content.
`;

// md-editor-v3 mounts cleanly in happy-dom (see MarkdownEditor.test.ts); this suite
// follows the same approach of mounting the real component rather than stubbing it,
// and drives its markdown-mode edits through the library's exposed `insert` API rather
// than raw keystrokes for the same reason (CodeMirror 6 contenteditable isn't
// something happy-dom can simulate reliably).
//
// A multi-line section body now has two states: rendered (a `[data-test="spine-display"]`
// / `[data-test="optional-display"]` div showing `renderMarkdown`'s output) and editing (a
// `[data-test="spine-textarea"]` / `[data-test="optional-textarea"]` with the raw
// markdown). Only one section edits at a time, entered by clicking its display and exited
// by blurring its textarea — tests that need the raw value or want to type into a section
// click its display first. renderMarkdown itself (parsing + DOMPurify sanitization) is
// covered in lib/edit/renderMarkdown.test.ts; the markdown used here stays benign (no
// script/HTML payloads) since DOMPurify's tree-walking sanitizer isn't reliable under this
// suite's happy-dom environment (see that file's header comment) — these tests exist to
// prove the click-to-edit/toolbar wiring, not to re-prove sanitization.
describe('SectionEditor', () => {
  it('always renders the 3 canonical sections, pinned in canonical order, plus optional sections after', () => {
    const w = mount(SectionEditor, { props: { modelValue: BODY } });
    const spineLabels = w.findAll('[data-test="spine-label"]').map((l) => l.text());
    expect(spineLabels).toEqual(CANONICAL_SECTIONS);
    expect(spineLabels).toEqual(['One-liner', 'Why it matters', 'What ships']);

    const optionalLabels = w.findAll('[data-test="optional-label"]').map((l) => l.text());
    expect(optionalLabels).toEqual(['Custom Heading']);
  });

  it('never renders the raw preamble as an editable field', () => {
    const w = mount(SectionEditor, { props: { modelValue: BODY } });
    expect(w.find('[data-test="preamble-field"]').exists()).toBe(false);
    expect(w.text()).not.toContain('Preamble');
  });

  it('the One-liner spine field is a plain single-line input, never markdown-rendered or click-to-edit', () => {
    const w = mount(SectionEditor, { props: { modelValue: BODY } });
    const oneLiner = w.find('[data-test="spine-oneliner"]');
    expect(oneLiner.element.tagName).toBe('INPUT');
    expect((oneLiner.element as HTMLInputElement).value).toBe('Move off Supabase with no feature loss.');
    // Only the two non-one-liner canonical sections render as click-to-edit displays.
    expect(w.findAll('[data-test="spine-display"]')).toHaveLength(2);
  });

  it('the other canonical sections render as prose until clicked, then become textareas with the raw markdown', async () => {
    const w = mount(SectionEditor, { props: { modelValue: BODY } });
    const displays = w.findAll('[data-test="spine-display"]');
    expect(displays).toHaveLength(2);
    expect(w.find('[data-test="spine-textarea"]').exists()).toBe(false);

    // "Why it matters" (the first display) has content.
    await displays[0].trigger('click');
    let textarea = w.find('[data-test="spine-textarea"]');
    expect(textarea.exists()).toBe(true);
    expect((textarea.element as HTMLTextAreaElement).value).toBe('Some reasoning here.\n');

    await textarea.trigger('blur');
    expect(w.find('[data-test="spine-textarea"]').exists()).toBe(false);

    // "What ships" is missing from BODY, so it's stubbed empty rather than omitted.
    const displaysAfter = w.findAll('[data-test="spine-display"]');
    await displaysAfter[1].trigger('click');
    textarea = w.find('[data-test="spine-textarea"]');
    expect((textarea.element as HTMLTextAreaElement).value).toBe('');
  });

  it('stubs a missing canonical section as an empty field rather than omitting it', () => {
    const w = mount(SectionEditor, { props: { modelValue: '# Title\n\n## One-liner\nJust this.\n' } });
    const spineLabels = w.findAll('[data-test="spine-label"]').map((l) => l.text());
    expect(spineLabels).toEqual(['One-liner', 'Why it matters', 'What ships']);
  });

  // Fix #7: a quiet character-count hint on the One-liner — never a hard limit.
  describe('One-liner length hint', () => {
    it('shows the current character count, muted, below the soft limit', () => {
      const w = mount(SectionEditor, { props: { modelValue: BODY } });
      const hint = w.find('[data-test="oneliner-hint"]');
      // 'Move off Supabase with no feature loss.' is 39 characters.
      expect(hint.text()).toContain('39');
      expect(hint.attributes('data-over-limit')).toBe('false');
    });

    it('updates the count live as the one-liner is edited', async () => {
      const w = mount(SectionEditor, { props: { modelValue: BODY } });
      await w.find('[data-test="spine-oneliner"]').setValue('Short.');

      expect(w.find('[data-test="oneliner-hint"]').text()).toContain('6');
    });

    it('flips to a warning tone and copy once the one-liner exceeds the ~120-char soft limit', async () => {
      const w = mount(SectionEditor, { props: { modelValue: BODY } });
      const long = 'x'.repeat(130);
      await w.find('[data-test="spine-oneliner"]').setValue(long);

      const hint = w.find('[data-test="oneliner-hint"]');
      expect(hint.attributes('data-over-limit')).toBe('true');
      expect(hint.text()).toContain('130');
      expect(hint.text().toLowerCase()).toContain('one sentence');
    });

    it('never truncates or blocks typing past the soft limit', async () => {
      const w = mount(SectionEditor, { props: { modelValue: BODY } });
      const long = 'y'.repeat(150);
      await w.find('[data-test="spine-oneliner"]').setValue(long);

      expect((w.find('[data-test="spine-oneliner"]').element as HTMLInputElement).value).toBe(long);
      expect((w.find('[data-test="spine-oneliner"]').element as HTMLInputElement).value.length).toBe(150);
    });
  });

  it('editing the one-liner re-assembles the whole body and emits update:modelValue', async () => {
    const w = mount(SectionEditor, { props: { modelValue: BODY } });
    await w.find('[data-test="spine-oneliner"]').setValue('Rewritten one-liner.');

    const emitted = w.emitted('update:modelValue');
    expect(emitted).toBeTruthy();
    const last = emitted![emitted!.length - 1][0] as string;
    expect(last).toContain('## One-liner\nRewritten one-liner.\n');
    // The untouched sections and preamble survive re-assembly unchanged.
    expect(last).toContain('# Migrate off Supabase');
    expect(last).toContain('## Custom Heading\nCustom content.\n');
    expect(last).not.toContain('Move off Supabase with no feature loss.');
  });

  it('editing a spine textarea re-assembles the whole body and emits update:modelValue', async () => {
    const w = mount(SectionEditor, { props: { modelValue: BODY } });
    await w.findAll('[data-test="spine-display"]')[0].trigger('click'); // "Why it matters"
    await w.find('[data-test="spine-textarea"]').setValue('New reasoning.');

    const last = w.emitted('update:modelValue')!.at(-1)![0] as string;
    expect(last).toContain('## Why it matters\nNew reasoning.');
  });

  it('editing an optional section re-assembles the whole body and emits update:modelValue', async () => {
    const w = mount(SectionEditor, { props: { modelValue: BODY } });
    await w.find('[data-test="optional-display"]').trigger('click');
    await w.find('[data-test="optional-textarea"]').setValue('Edited custom content.');

    const last = w.emitted('update:modelValue')!.at(-1)![0] as string;
    expect(last).toContain('## Custom Heading\nEdited custom content.');
  });

  it('removing an optional section drops it from the emitted body (its header controls work without entering edit mode)', async () => {
    const w = mount(SectionEditor, { props: { modelValue: BODY } });
    await w.find('[data-test="remove-section"]').trigger('click');

    expect(w.findAll('[data-test="optional-field"]')).toHaveLength(0);
    const last = w.emitted('update:modelValue')!.at(-1)![0] as string;
    expect(last).not.toContain('## Custom Heading');
    // The spine survives.
    expect(last).toContain('## One-liner\nMove off Supabase with no feature loss.\n');
  });

  it('move-down/move-up buttons reorder optional sections and re-emit', async () => {
    const twoOptional = `${BODY}\n## Links\n- a link\n`;
    const w = mount(SectionEditor, { props: { modelValue: twoOptional } });

    expect(w.findAll('[data-test="optional-label"]').map((l) => l.text())).toEqual(['Custom Heading', 'Links']);

    await w.findAll('[data-test="move-down"]')[0].trigger('click');
    expect(w.findAll('[data-test="optional-label"]').map((l) => l.text())).toEqual(['Links', 'Custom Heading']);

    const last = w.emitted('update:modelValue')!.at(-1)![0] as string;
    expect(last.indexOf('## Links')).toBeLessThan(last.indexOf('## Custom Heading'));

    await w.findAll('[data-test="move-up"]')[1].trigger('click');
    expect(w.findAll('[data-test="optional-label"]').map((l) => l.text())).toEqual(['Custom Heading', 'Links']);
  });

  it('drag-and-drop reorders optional sections', async () => {
    const twoOptional = `${BODY}\n## Links\n- a link\n`;
    const w = mount(SectionEditor, { props: { modelValue: twoOptional } });
    const rows = w.findAll('[data-test="optional-field"]');

    await rows[0].trigger('dragstart');
    await rows[1].trigger('dragover');
    await rows[1].trigger('drop');

    expect(w.findAll('[data-test="optional-label"]').map((l) => l.text())).toEqual(['Links', 'Custom Heading']);
  });

  it('the move-up button is disabled for the first optional section and move-down for the last', () => {
    const twoOptional = `${BODY}\n## Links\n- a link\n`;
    const w = mount(SectionEditor, { props: { modelValue: twoOptional } });
    const moveUps = w.findAll('[data-test="move-up"]');
    const moveDowns = w.findAll('[data-test="move-down"]');

    expect((moveUps[0].element as HTMLButtonElement).disabled).toBe(true);
    expect((moveDowns[moveDowns.length - 1].element as HTMLButtonElement).disabled).toBe(true);
  });

  it('the "+ Add section" menu lists unused optional headings plus a custom option, and appends on selection, auto-entering edit mode', async () => {
    const w = mount(SectionEditor, { props: { modelValue: BODY } });
    const select = w.find('[data-test="add-section-select"] select');
    const optionLabels = select.findAll('option').map((o) => o.text());
    expect(optionLabels).toEqual([
      '+ Add section',
      'Bottom line',
      "Who it's for",
      'Target outcome',
      'Acceptance criteria',
      'Open questions',
      'Current behavior',
      'In the codebase',
      'Resources',
      'Links',
      'What shipped',
      'Custom section…',
    ]);

    await select.setValue('Links');
    expect(w.findAll('[data-test="optional-label"]').map((l) => l.text())).toEqual(['Custom Heading', 'Links']);

    // R3 fix #6: a freshly-added section starts with an empty body, and assembleBody
    // now drops empty sections from the serialized output — so the assembled string is
    // unchanged and no update:modelValue fires yet.
    expect(w.emitted('update:modelValue')).toBeFalsy();

    // The newly-added section opens straight into edit mode (the click-to-edit
    // replacement for the old auto-focus), so its textarea is already there to type into.
    const newTextarea = w.find('[data-test="optional-textarea"]');
    expect(newTextarea.exists()).toBe(true);
    await newTextarea.setValue('A link.');
    const last = w.emitted('update:modelValue')!.at(-1)![0] as string;
    expect(last).toContain('## Links\nA link.');

    // Once added, it drops out of the menu.
    const optionLabelsAfter = w.find('[data-test="add-section-select"] select').findAll('option').map((o) => o.text());
    expect(optionLabelsAfter).not.toContain('Links');
  });

  it('"Custom section…" reveals a heading input that appends a section on Enter, auto-entering edit mode', async () => {
    const w = mount(SectionEditor, { props: { modelValue: BODY } });
    const select = w.find('[data-test="add-section-select"] select');
    await select.setValue('__custom__');

    const customInput = w.find('[data-test="custom-heading-input"]');
    expect(customInput.exists()).toBe(true);
    await customInput.setValue('My Custom Section');
    await customInput.trigger('keydown.enter');

    expect(w.findAll('[data-test="optional-label"]').map((l) => l.text())).toEqual([
      'Custom Heading',
      'My Custom Section',
    ]);

    // R3 fix #6: empty sections are dropped from the assembled output, so nothing was
    // emitted yet for this still-empty new section.
    expect(w.emitted('update:modelValue')).toBeFalsy();

    const newTextarea = w.find('[data-test="optional-textarea"]');
    expect(newTextarea.exists()).toBe(true);
    await newTextarea.setValue('Detail.');
    const last = w.emitted('update:modelValue')!.at(-1)![0] as string;
    expect(last).toContain('## My Custom Section\nDetail.');
  });

  // R2 fix #4: pressing Escape while the "Add section" custom-heading popover is open
  // must close only the popover, not bubble up to a document-level listener (the
  // ItemEditor closes the whole editor on Escape).
  it('Escape while the custom-heading popover is open closes it without bubbling to document', async () => {
    const w = mount(SectionEditor, { props: { modelValue: BODY }, attachTo: document.body });
    const select = w.find('[data-test="add-section-select"] select');
    await select.setValue('__custom__');
    expect(w.find('[data-test="custom-heading-input"]').exists()).toBe(true);

    const docHandler = vi.fn();
    document.addEventListener('keydown', docHandler);
    await w.find('[data-test="custom-heading-input"]').trigger('keydown', { key: 'Escape' });
    document.removeEventListener('keydown', docHandler);

    expect(w.find('[data-test="custom-heading-input"]').exists()).toBe(false);
    expect(w.find('[data-test="add-section-select"]').exists()).toBe(true);
    expect(docHandler).not.toHaveBeenCalled();
    w.unmount();
  });

  it('a body with no ## sections still renders the pinned spine, all empty', () => {
    const w = mount(SectionEditor, { props: { modelValue: 'Just prose.\nNo sections at all.' } });
    expect(w.findAll('[data-test="spine-label"]').map((l) => l.text())).toEqual(['One-liner', 'Why it matters', 'What ships']);
    expect((w.find('[data-test="spine-oneliner"]').element as HTMLInputElement).value).toBe('');
    expect(w.findAll('[data-test="optional-field"]')).toHaveLength(0);
  });

  describe('click-to-edit / render-on-blur', () => {
    // Deliberately benign markdown — renderMarkdown's actual sanitization guarantees are
    // proven in lib/edit/renderMarkdown.test.ts (under jsdom, where DOMPurify's sanitizer
    // reliably works); this suite runs under the project's default happy-dom environment,
    // which does not reliably exercise DOMPurify (see that file's header).
    const MD_BODY = `# T

## One-liner
Quick summary.

## Why it matters
**Bold** and a [link](https://example.com).

## What ships
- item one
- item two
`;

    it('shows rendered HTML for a section body until it is clicked', () => {
      const w = mount(SectionEditor, { props: { modelValue: MD_BODY } });
      const whyItMatters = w.findAll('[data-test="spine-display"]')[0];
      expect(whyItMatters.find('strong').exists()).toBe(true);
      expect(whyItMatters.find('a[href="https://example.com"]').exists()).toBe(true);
      expect(w.find('[data-test="spine-textarea"]').exists()).toBe(false);
    });

    it('renders a bullet list section as an actual list, not raw markdown', () => {
      const w = mount(SectionEditor, { props: { modelValue: MD_BODY } });
      const whatShips = w.findAll('[data-test="spine-display"]')[1];
      expect(whatShips.findAll('li').map((li) => li.text())).toEqual(['item one', 'item two']);
    });

    it('clicking the rendered body switches to a focused textarea holding the raw markdown', async () => {
      const w = mount(SectionEditor, { props: { modelValue: MD_BODY }, attachTo: document.body });
      await w.findAll('[data-test="spine-display"]')[0].trigger('click');

      const textarea = w.find('[data-test="spine-textarea"]');
      expect(textarea.exists()).toBe(true);
      expect((textarea.element as HTMLTextAreaElement).value).toContain('**Bold**');
      expect((textarea.element as HTMLTextAreaElement).value).toContain('[link](https://example.com)');
      expect(document.activeElement).toBe(textarea.element);
      w.unmount();
    });

    it('blurring the textarea renders it back to HTML', async () => {
      const w = mount(SectionEditor, { props: { modelValue: MD_BODY } });
      await w.findAll('[data-test="spine-display"]')[0].trigger('click');
      await w.find('[data-test="spine-textarea"]').trigger('blur');

      expect(w.find('[data-test="spine-textarea"]').exists()).toBe(false);
      const displays = w.findAll('[data-test="spine-display"]');
      expect(displays[0].find('strong').exists()).toBe(true);
    });

    it('an empty section shows a click-to-add placeholder instead of blank space', () => {
      const w = mount(SectionEditor, { props: { modelValue: '# T\n\n## One-liner\nX.\n' } });
      const displays = w.findAll('[data-test="spine-display"]');
      expect(displays[0].text().toLowerCase()).toContain('click to add');
      expect(displays[1].text().toLowerCase()).toContain('click to add');
    });

    it('only one section edits at a time — clicking another section moves editing there', async () => {
      const w = mount(SectionEditor, { props: { modelValue: MD_BODY } });
      await w.findAll('[data-test="spine-display"]')[0].trigger('click'); // "Why it matters"
      expect(w.findAll('[data-test="spine-textarea"]')).toHaveLength(1);

      // Only "What ships" is still a display now; click it instead.
      const remaining = w.findAll('[data-test="spine-display"]');
      expect(remaining).toHaveLength(1);
      await remaining[0].trigger('click');

      expect(w.findAll('[data-test="spine-textarea"]')).toHaveLength(1);
      expect((w.find('[data-test="spine-textarea"]').element as HTMLTextAreaElement).value).toContain('item one');
    });

    it('the one-liner never gets a display element — it stays the plain input', () => {
      const w = mount(SectionEditor, { props: { modelValue: MD_BODY } });
      expect(w.findAll('[data-test="spine-display"]')).toHaveLength(2);
      expect(w.find('[data-test="spine-oneliner"]').element.tagName).toBe('INPUT');
    });
  });

  describe('formatting toolbar', () => {
    it('only appears for the section currently being edited', async () => {
      const w = mount(SectionEditor, { props: { modelValue: BODY } });
      expect(w.find('[data-test="format-toolbar"]').exists()).toBe(false);

      await w.findAll('[data-test="spine-display"]')[0].trigger('click');
      expect(w.find('[data-test="format-toolbar"]').exists()).toBe(true);

      await w.find('[data-test="spine-textarea"]').trigger('blur');
      expect(w.find('[data-test="format-toolbar"]').exists()).toBe(false);
    });

    it('sits directly above the active textarea', async () => {
      const w = mount(SectionEditor, { props: { modelValue: BODY } });
      await w.findAll('[data-test="spine-display"]')[0].trigger('click');

      const toolbar = w.find('[data-test="format-toolbar"]').element;
      const textarea = w.find('[data-test="spine-textarea"]').element;
      expect(toolbar.nextElementSibling).toBe(textarea);
    });

    it('is hidden after switching to markdown mode, even mid-edit', async () => {
      const w = mount(SectionEditor, { props: { modelValue: BODY } });
      await w.findAll('[data-test="spine-display"]')[0].trigger('click');
      expect(w.find('[data-test="format-toolbar"]').exists()).toBe(true);

      await w.find('[data-test="mode-toggle"]').trigger('click');
      expect(w.find('[data-test="format-toolbar"]').exists()).toBe(false);
    });

    it('applies bold to the currently-edited spine textarea and updates the model', async () => {
      const w = mount(SectionEditor, { props: { modelValue: BODY } });
      await w.findAll('[data-test="spine-display"]')[0].trigger('click'); // "Why it matters"
      const textarea = w.find('[data-test="spine-textarea"]').element as HTMLTextAreaElement;
      expect(textarea.value).toBe('Some reasoning here.\n');

      textarea.setSelectionRange(0, 4); // "Some"
      await w.find('[data-test="format-bold"]').trigger('click');

      expect(textarea.value).toBe('**Some** reasoning here.\n');
      const last = w.emitted('update:modelValue')!.at(-1)![0] as string;
      expect(last).toContain('## Why it matters\n**Some** reasoning here.');
    });

    it('toolbar still acts on an EARLIER section after editing a later one (ref-order regression)', async () => {
      const w = mount(SectionEditor, { props: { modelValue: BODY } });
      await w.findAll('[data-test="spine-display"]')[1].trigger('click'); // What ships (later)
      await w.find('[data-test="spine-textarea"]').trigger('blur');
      await w.findAll('[data-test="spine-display"]')[0].trigger('click'); // Why it matters (earlier)
      const textarea = w.find('[data-test="spine-textarea"]').element as HTMLTextAreaElement;
      textarea.setSelectionRange(0, 4);
      await w.find('[data-test="format-bold"]').trigger('click');
      expect(textarea.value).toContain('**Some**'); // activeTextarea correctly points at the earlier section
    });

    it('applies a bullet-list prefix to the currently-edited optional textarea', async () => {
      const w = mount(SectionEditor, { props: { modelValue: BODY } });
      await w.find('[data-test="optional-display"]').trigger('click');
      const textarea = w.find('[data-test="optional-textarea"]').element as HTMLTextAreaElement;
      expect(textarea.value).toBe('Custom content.\n');

      textarea.setSelectionRange(0, 0);
      await w.find('[data-test="format-bullet"]').trigger('click');

      expect(textarea.value).toBe('- Custom content.\n');
      const last = w.emitted('update:modelValue')!.at(-1)![0] as string;
      expect(last).toContain('## Custom Heading\n- Custom content.');
    });

    it('inserts a link with the selection covering the url placeholder', async () => {
      const w = mount(SectionEditor, { props: { modelValue: BODY }, attachTo: document.body });
      await w.findAll('[data-test="spine-display"]')[0].trigger('click');
      const textarea = w.find('[data-test="spine-textarea"]').element as HTMLTextAreaElement;

      textarea.setSelectionRange(0, 4); // "Some"
      await w.find('[data-test="format-link"]').trigger('click');
      await vi.advanceTimersByTimeAsync(0);

      expect(textarea.value).toBe('[Some](https://) reasoning here.\n');
      expect(textarea.value.slice(textarea.selectionStart!, textarea.selectionEnd!)).toBe('https://');
      w.unmount();
    });

    it('a toolbar button click (mousedown) does not blur the active textarea', async () => {
      const w = mount(SectionEditor, { props: { modelValue: BODY }, attachTo: document.body });
      await w.findAll('[data-test="spine-display"]')[0].trigger('click');
      const textarea = w.find('[data-test="spine-textarea"]').element as HTMLTextAreaElement;
      textarea.focus();
      expect(document.activeElement).toBe(textarea);

      await w.find('[data-test="format-italic"]').trigger('mousedown');
      expect(document.activeElement).toBe(textarea);
      // ...and the section is still in edit mode (a real blur would have rendered it).
      expect(w.find('[data-test="spine-textarea"]').exists()).toBe(true);
      w.unmount();
    });

    it('each button has an accessible label', async () => {
      const w = mount(SectionEditor, { props: { modelValue: BODY } });
      await w.findAll('[data-test="spine-display"]')[0].trigger('click');

      const labels = ['Bold', 'Italic', 'Bullet list', 'Numbered list', 'Link', 'Inline code', 'Quote'];
      for (const label of labels) {
        expect(w.find(`[aria-label="${label}"]`).exists()).toBe(true);
      }
      expect(w.find('[role="toolbar"]').exists()).toBe(true);
    });
  });

  it('toggles to the whole-body MarkdownEditor and back without losing content', async () => {
    const w = mount(SectionEditor, { props: { modelValue: '' } });

    await w.find('[data-test="mode-toggle"]').trigger('click');
    await vi.advanceTimersByTimeAsync(20);
    expect(w.find('[data-test="structured-fields"]').exists()).toBe(false);
    expect(w.findComponent(MarkdownEditor).exists()).toBe(true);

    const mdWrapper = w.findComponent(MarkdownEditor) as unknown as { vm: unknown };
    const vm = mdWrapper.vm as {
      editorRef?: { insert: (fn: (selected: string) => { targetValue: string }) => void };
    };
    const written = '# Title\n\n## One-liner\nWritten in markdown mode.\n';
    vm.editorRef?.insert(() => ({ targetValue: written }));
    await vi.advanceTimersByTimeAsync(20);

    expect(w.emitted('update:modelValue')!.at(-1)![0]).toBe(written);

    await w.find('[data-test="mode-toggle"]').trigger('click');
    await vi.advanceTimersByTimeAsync(20);

    expect(w.find('[data-test="structured-fields"]').exists()).toBe(true);
    expect((w.find('[data-test="spine-oneliner"]').element as HTMLInputElement).value).toBe(
      'Written in markdown mode.',
    );
  });
});

it('delegates resource-only sections without losing Markdown or hiding explanatory prose', async () => {
  const body = '## Resources\n\n- [Design](https://example.com/design)\n';
  const w = mount(SectionEditor, { props: { modelValue: body, managedResources: true, managedResourceHrefs: ["https://example.com/design"] } });
  expect(w.get('[data-test="optional-field"]').attributes('style')).toContain('display: none');
  expect(w.emitted('update:modelValue')).toBeUndefined();
  w.unmount();
  const prose = mount(SectionEditor, { props: { modelValue: body + '\nRead this before planning.\n', managedResources: true, managedResourceHrefs: ["https://example.com/design"] } });
  expect(prose.get('[data-test="optional-field"]').attributes('style') ?? '').not.toContain('display: none');
  expect(prose.get('[data-test="optional-display"]').text()).toContain('Read this before planning.');
  prose.unmount();
});

it('keeps resource links readable when the library cannot resolve them', () => {
  const w = mount(SectionEditor, { props: { modelValue: '## Resources\n\n- [Design](../../assets/ast_missing/rev_missing/design.png)\n', managedResources: true, managedResourceHrefs: [] } });
  expect(w.get('[data-test="optional-field"]').attributes('style') ?? '').not.toContain('display: none');
  expect(w.get('[data-test="optional-display"]').text()).toContain('Design');
  w.unmount();
});
