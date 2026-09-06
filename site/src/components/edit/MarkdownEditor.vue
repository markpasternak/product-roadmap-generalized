<script setup lang="ts">
// Self-contained CodeMirror editor with our Git-backed image picker and GFM preview.
// Disable md-editor-v3's CDN-loaded add-ons: the library's image upload/crop UI,
// syntax highlighter, diagrams, math, formatter and browser fullscreen. The custom
// image toolbar uses the same resource owner and Markdown syntax as structured mode.
import { renderMarkdown } from '../../lib/edit/renderMarkdown';
import { ref, inject, onMounted, onUnmounted, nextTick, watch } from 'vue';
import { insertImageKey } from '../../lib/edit/imageAuthoring';
import { resourcePreviewURLs } from '../../lib/edit/resourceClient';
import { PhImage } from '@phosphor-icons/vue';
import { MdEditor, type ExposeParam } from 'md-editor-v3';
import 'md-editor-v3/lib/style.css';

const model = defineModel<string>({ default: '' });
const requestImage = inject(insertImageKey, undefined);
const registerSelection =
  inject<(read: (() => { from: number; to: number } | undefined) | null) => void>('resource-markdown-selection', () => {});

// Forwards md-editor-v3's exposed instance (togglePageFullscreen, focus, insert, …)
// so the full-screen editing context (U7's ItemEditor) can drive it directly.
const editorRef = ref<ExposeParam>();
watch(resourcePreviewURLs, () => editorRef.value?.rerender());
defineExpose({ editorRef });
const host = ref<HTMLElement>();
const theme = ref<'dark' | 'light'>('dark');
let themeObserver: MutationObserver | undefined;
async function labelInput() {
  await nextTick();
  registerSelection?.(() => editorRef.value?.getEditorView()?.state.selection.main);
  host.value?.querySelector('[contenteditable="true"]')?.setAttribute('aria-label', 'Item Markdown');
  const labels: Record<string, string> = {
    revoke: 'Undo',
    'undo revoke': 'Redo',
    strikeThrough: 'Strikethrough',
    title: 'Heading',
    'fullscreen in page': 'Expand editor',
    'block-level code': 'Code block',
  };
  for (const button of host.value?.querySelectorAll<HTMLButtonElement>('.md-editor-toolbar-item') ?? []) {
    const label = labels[button.title];
    if (label) {
      button.title = label;
      button.setAttribute('aria-label', label);
    }
  }
}
onMounted(() => {
  const syncTheme = () => {
    theme.value = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  };
  syncTheme();
  themeObserver = new MutationObserver(syncTheme);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  void labelInput();
});
onUnmounted(() => {
  themeObserver?.disconnect();
  registerSelection?.(null);
});

// Explicit whitelist (see comment above) — `-` is a visual divider, `=` right-aligns
// everything after it in the toolbar.
const TOOLBARS = [
  'bold',
  'italic',
  'strikeThrough',
  'title',
  'quote',
  'unorderedList',
  'orderedList',
  'task',
  'link',
  0,
  'codeRow',
  'code',
  'table',
  '-',
  'revoke',
  'next',
  '=',
  'pageFullscreen',
  'preview',
] as const;
</script>

<template>
  <div ref="host" class="min-w-0">
    <MdEditor
      ref="editorRef"
      v-model="model"
      :theme="theme"
      :preview="true"
      :sanitize="() => renderMarkdown(model)"
      :no-mermaid="true"
      :no-katex="true"
      :no-echarts="true"
      :no-highlight="true"
      :no-prettier="true"
      :no-upload-img="true"
      :toolbars="[...TOOLBARS]"
      language="en-US"
      class="markdown-editor"
      @on-remount="labelInput"
    >
      <template #defToolbars>
        <button type="button" class="md-editor-toolbar-item image-toolbar-button" title="Insert image" aria-label="Insert image" :disabled="!requestImage" @mousedown.prevent @click="requestImage?.()"><PhImage :size="20" /></button>
      </template>
    </MdEditor>
  </div>
</template>

<style scoped>
.markdown-editor {
  height: 100%;
}
</style>
