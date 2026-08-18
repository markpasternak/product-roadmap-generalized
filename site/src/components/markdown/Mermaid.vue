<script setup lang="ts">
// Client island: renders any <pre class="mermaid"> block to an SVG with
// beautiful-mermaid (~10MB, mermaid-compatible syntax; no heavyweight mermaid dep).
// Dynamically imported only when a diagram is actually present on the page.
// Colors are passed as CSS variables so diagrams follow the site's light/dark theme
// live, with no re-render needed.
import { onMounted } from 'vue';

onMounted(async () => {
  const nodes = document.querySelectorAll<HTMLElement>('pre.mermaid:not([data-processed])');
  if (!nodes.length) return;
  const { renderMermaidSVG } = await import('beautiful-mermaid');
  for (const node of nodes) {
    const code = (node.textContent ?? '').trim();
    if (!code) continue;
    try {
      const svg = renderMermaidSVG(code, {
        fg: 'var(--color-text-primary-default)',
        bg: 'transparent',
        transparent: true,
      });
      const wrap = document.createElement('div');
      wrap.className = 'mermaid-rendered';
      wrap.setAttribute('data-processed', 'true');
      wrap.innerHTML = svg;
      node.replaceWith(wrap);
    } catch (err) {
      node.setAttribute('data-processed', 'error');
      console.error('mermaid render failed', err);
    }
  }
});
</script>

<template>
  <span aria-hidden="true" hidden></span>
</template>
