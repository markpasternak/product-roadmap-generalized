// @vitest-environment node
import { expect, it } from 'vitest';
import { renderDocument } from './markdown';

it('preserves document headings, GFM, highlighting, Mermaid and resource base URLs', async () => {
  const result = await renderDocument('## Overview\n\n| A | B |\n| - | - |\n| one | two |\n\n- [x] Done\n\n```js\nconst x = 1;\n```\n\n```mermaid\nflowchart LR\nA --> B\n```\n\n![Cover](../../assets/ast_test/rev_one/cover.png)\n', '/roadmap/', 'internal');
  expect(result.html).toContain('<table>');
  expect(result.html).toContain('checked');
  expect(result.html).toContain('astro-code');
  expect(result.html).toContain('class="mermaid"');
  expect(result.html).toContain('/roadmap/assets/ast_test/rev_one/cover.png');
  expect(result.headings[0]).toMatchObject({ depth: 2, slug: 'overview', text: 'Overview' });
});

it('keeps safe HTML but excludes scripts, handlers and dangerous URLs', async () => {
  const { html } = await renderDocument('<p>Safe <b>HTML</b></p>\n<script>alert(1)</script>\n<img src=x onerror="bad()">\n<a href="javascript:bad()">Bad link</a>', '/', 'internal');
  expect(html).toContain('<b>HTML</b>');
  expect(html).not.toMatch(/script|onerror|javascript:|bad\(\)/i);
});

it('rewrites attachment and raw media links for non-root deployments', async () => {
  const { html } = await renderDocument('[Brief](../../assets/ast_test/rev_one/brief.pdf)\n\n<video controls src="../../assets/ast_test/rev_two/clip.mp4"></video>\n\n<img src="../../assets/ast_test/rev_three/cover.png" alt="Cover">', '/roadmap/', 'internal');
  expect(html).toContain('href="/roadmap/assets/ast_test/rev_one/brief.pdf"');
  expect(html).toContain('src="/roadmap/assets/ast_test/rev_two/clip.mp4"');
  expect(html).toContain('src="/roadmap/assets/ast_test/rev_three/cover.png"');
});

it('rejects unlisted HTML, clobbering names and CSS rather than enumerating executable elements', async () => {
  const { html } = await renderDocument('<template><img onerror="bad()" src=x></template>\n<x-widget data-command="bad">bad</x-widget>\n<p id="published-seed" name="document" style="position:fixed;inset:0">Safe</p>\n<a href="java&#x09;script:bad()">Link</a>\n<video poster="data:text/html,bad"></video>', '/', 'internal');
  expect(html).toContain('Safe');
  expect(html).not.toMatch(/template|x-widget|published-seed|name=|style=|script:|data:text|bad\(\)/i);
});
