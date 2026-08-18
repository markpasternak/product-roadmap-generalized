import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import MarkdownEditor from './MarkdownEditor.vue';

// md-editor-v3 mounts cleanly in happy-dom once its CDN-loading side features
// (highlight/mermaid/katex/echarts/prettier/cropper, all fetched from unpkg.com by
// default) are disabled via the wrapper's `no*` props, so these tests mount the real
// component rather than stubbing it — stubbing by name doesn't intercept it anyway,
// since <script setup> resolves the imported `MdEditor` directly rather than through
// name-based component resolution that `global.stubs` hooks into.
//
// Typing into the real CodeMirror 6 contenteditable isn't something happy-dom can
// simulate reliably, so the update:modelValue path is exercised through the
// library's own exposed `insert` API (forwarded via `editorRef`) instead of raw DOM
// events — a real edit path, just not raw keystrokes.
describe('MarkdownEditor', () => {
  it('renders the live preview from the initial value with no console errors', async () => {
    const w = mount(MarkdownEditor, { props: { modelValue: '# Hello' } });
    await new Promise((r) => setTimeout(r, 20));
    expect(w.find('.cm-content').exists()).toBe(true);
    expect(w.find('.md-editor-preview').html()).toContain('Hello');
  });

  it('uses the dark theme', () => {
    const w = mount(MarkdownEditor, { props: { modelValue: '' } });
    expect(w.find('.md-editor').classes()).toContain('md-editor-dark');
  });

  it('reflects external updates to the model prop', async () => {
    // md-editor-v3 debounces preview re-render (default renderDelay: 500ms), so the
    // wait here needs to clear that, not just a tick.
    const w = mount(MarkdownEditor, { props: { modelValue: '# One' } });
    await new Promise((r) => setTimeout(r, 600));
    await w.setProps({ modelValue: '# Two' });
    await new Promise((r) => setTimeout(r, 600));
    expect(w.find('.md-editor-preview').html()).toContain('Two');
    expect(w.find('.md-editor-preview').html()).not.toContain('One');
  });

  it('emits update:modelValue when the editor content changes', async () => {
    const w = mount(MarkdownEditor, { props: { modelValue: '' } });
    await new Promise((r) => setTimeout(r, 20));

    const vm = w.vm as unknown as {
      editorRef?: { insert: (fn: (selected: string) => { targetValue: string }) => void };
    };
    vm.editorRef?.insert(() => ({ targetValue: 'hello world' }));
    await new Promise((r) => setTimeout(r, 20));

    const emitted = w.emitted('update:modelValue');
    expect(emitted).toBeTruthy();
    expect(emitted![emitted!.length - 1]).toEqual(['hello world']);
  });

  it('never injects a script/link tag pointing at an external CDN (CSP regression guard)', async () => {
    // md-editor-v3's default 'fullscreen' toolbar button loads screenfull from
    // unpkg.com on mount with no no* prop to gate it (see comment in
    // MarkdownEditor.vue) — this failed before the toolbarsExclude fix and must
    // keep passing after it, for any toolbar item, present or future.
    const w = mount(MarkdownEditor, { props: { modelValue: '' } });
    await new Promise((r) => setTimeout(r, 20));

    const externalPattern = /unpkg\.com|jsdelivr|cdn\.|^https?:\/\/(?!localhost|127\.0\.0\.1)/i;
    const offenders: string[] = [];
    for (const root of [document.head, document.body]) {
      for (const el of root.querySelectorAll('script[src], link[href]')) {
        const url = el.getAttribute('src') ?? el.getAttribute('href') ?? '';
        if (externalPattern.test(url)) offenders.push(url);
      }
    }

    expect(offenders).toEqual([]);
    w.unmount();
  });
});
