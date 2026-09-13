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
