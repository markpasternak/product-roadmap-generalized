<script setup lang="ts">
// Thin wrapper around md-editor-v3 (bundled via npm — no CDN, matches how
// beautiful-mermaid is bundled in components/markdown/Mermaid.vue). Live preview +
// dark theme to match the board's default look; full-screen toggle is left to the
// library's own `pageFullscreen` toolbar action so the parent (U7's ItemEditor) can
// simply mount this full-bleed.
//
// noMermaid/noKatex/noEcharts/noHighlight/noPrettier/noUploadImg are all forced on:
// without them, md-editor-v3 appends <script>/<link> tags pulling highlight.js,
// mermaid, katex, echarts, prettier, and cropper.js from unpkg.com on mount (most of
// these fire unconditionally, not just when a matching code block or feature is
// used) — exactly the CDN dependency this bundle exists to avoid (canvas-drop CSP
// blocks it anyway). Mermaid diagrams still render read-only via the site's own
// beautiful-mermaid island once synced; code blocks preview unhighlighted
// (monospace); image upload/cropping and prettier-reformat are out of scope for
// markdown editing here.
//
// The `toolbars` prop is an explicit whitelist rather than an exclude-list: it's the
// only way to drop 'fullscreen', which injects
// <script src="https://unpkg.com/screenfull@5.2.0/..."> into document.head on mount
// with no no* prop to gate it (the same CDN dependency the props above are forced on
// to avoid). Everything else on the whitelist is a toolbar action that actually works
// in this editor; left off are sub/superscript (rarely used in roadmap prose),
// image upload (no backend to receive it — noUploadImg above hides the icon but the
// toolbar entry still shows without this), mermaid/katex/echarts (rendering is
// disabled via the no* props, so their buttons would insert dead syntax), save
// (no save-as-you-type affordance here), underline (not part of the site's markdown
// rendering), github (an external link, out of scope), and 'fullscreen' as above.
// 'pageFullscreen' is kept: it's a CSS-only class toggle with no network request,
// and U7's ItemEditor drives it directly via editorRef for the full-screen editing
// surface.
import { ref } from 'vue';
import { MdEditor, type ExposeParam } from 'md-editor-v3';
import 'md-editor-v3/lib/style.css';

const model = defineModel<string>({ default: '' });

// Forwards md-editor-v3's exposed instance (togglePageFullscreen, focus, insert, …)
// so the full-screen editing context (U7's ItemEditor) can drive it directly.
const editorRef = ref<ExposeParam>();
defineExpose({ editorRef });

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
  <MdEditor
    ref="editorRef"
    v-model="model"
    theme="dark"
    :preview="true"
    :no-mermaid="true"
    :no-katex="true"
    :no-echarts="true"
    :no-highlight="true"
    :no-prettier="true"
    :no-upload-img="true"
    :toolbars="TOOLBARS"
    language="en-US"
    class="markdown-editor"
  />
</template>

<style scoped>
.markdown-editor {
  height: 100%;
}
</style>
