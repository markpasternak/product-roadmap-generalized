// @vitest-environment jsdom
//
// Runs under jsdom rather than the suite-wide happy-dom (see ../../../vitest.config.ts).
// DOMPurify needs a real DOM tree-walker to prune dangerous nodes, and happy-dom is
// documented as unsupported by DOMPurify (cure53/DOMPurify#876) — verified empirically
// here too: sanitizing `<strong>x</strong><script>...</script>` under happy-dom leaves
// the `<script>` tag intact once it isn't the first top-level node, which would make
// the "no script survives" assertions below falsely green. jsdom is DOMPurify's own
// recommended Node.js environment, so this one file opts into it (a per-file
// `@vitest-environment` override) to get an honest answer instead of a passing test
// that isn't actually exercising the sanitizer. The rest of the suite, including
// SectionEditor.test.ts which renders this function's output via `v-html`, stays on
// the default happy-dom environment and sticks to benign markdown.
import { describe, it, expect } from 'vitest';
import { renderMarkdown } from './renderMarkdown';

describe('renderMarkdown', () => {
  it('renders bold text', () => {
    expect(renderMarkdown('**bold**')).toContain('<strong>bold</strong>');
  });

  it('renders italic text', () => {
    expect(renderMarkdown('*italic*')).toContain('<em>italic</em>');
  });

  it('renders a link', () => {
    expect(renderMarkdown('[text](https://example.com)')).toContain('<a href="https://example.com">text</a>');
  });

  it('renders a bullet list', () => {
    const html = renderMarkdown('- one\n- two');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>one</li>');
    expect(html).toContain('<li>two</li>');
  });

  it('renders inline code', () => {
    expect(renderMarkdown('`code`')).toContain('<code>code</code>');
  });

  it('renders a blockquote', () => {
    expect(renderMarkdown('> quoted')).toContain('<blockquote>');
  });

  describe('sanitization', () => {
    it('strips a <script> tag and its contents entirely', () => {
      const html = renderMarkdown('Hello <script>alert(1)</script> world');
      expect(html).not.toContain('<script');
      expect(html).not.toContain('alert(1)');
    });

    it('strips an onerror handler from an inline image', () => {
      const html = renderMarkdown('<img src=x onerror="alert(1)">');
      expect(html).not.toContain('onerror');
    });

    it('neutralizes a javascript: link href', () => {
      const html = renderMarkdown('<a href="javascript:alert(1)">click</a>');
      expect(html.toLowerCase()).not.toContain('javascript:');
    });

    it('strips a <script> tag even when it follows legitimate content', () => {
      // The exact failure mode happy-dom doesn't catch (see file header) — the
      // dangerous node isn't the first one in the document.
      const html = renderMarkdown('**Bold**\n\n<script>alert(1)</script>');
      expect(html).toContain('<strong>Bold</strong>');
      expect(html).not.toContain('<script');
      expect(html).not.toContain('alert(1)');
    });
  });
});
