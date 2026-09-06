import { describe, expect, it } from 'vitest';
import { inlineMdToHtml, mdToHtml, parseSections, parseLinks } from './items';

it('keeps Markdown images in Resources visible in published resource lists', () => {
  expect(parseLinks('## Resources\n\n![Diagram](https://example.com/image?id=1)\n\n![Evidence](../../assets/ast_one/rev_one/image.png)', '/roadmap/')).toEqual([
    { label: 'Diagram', kind: 'external', href: 'https://example.com/image?id=1', target: 'https://example.com/image?id=1', image: true },
    { label: 'Evidence', kind: 'file', href: '/roadmap/assets/ast_one/rev_one/image.png', target: '../../assets/ast_one/rev_one/image.png', image: true },
  ]);
});

const BODY = `---ignored---
# Title

## One-liner
Short line.

## What ships
Intro line.
- First bullet with **bold**
- Second bullet
Not in scope: the rest.

## Acceptance criteria
1. A clean export uploads.
2. Rows are flagged.

## Empty section

## Placeholder
To fill in.

## Links
- Notion card: https://example.com/x
`;

describe('parseSections', () => {
  it('returns sections in file order, skipping empty and placeholder ones', () => {
    const sections = parseSections(BODY);
    expect(sections.map((s) => s.heading)).toEqual(['One-liner', 'What ships', 'Acceptance criteria', 'Links']);
  });

  it('keeps raw markdown intact', () => {
    const ships = parseSections(BODY).find((s) => s.heading === 'What ships');
    expect(ships?.raw).toContain('- First bullet with **bold**');
  });
});

describe('mdToHtml', () => {
  it('renders bullet lists, paragraphs and inline markdown', () => {
    const html = mdToHtml(parseSections(BODY).find((s) => s.heading === 'What ships')!.raw);
    expect(html).toBe(
      '<p>Intro line.</p><ul><li>First bullet with <strong>bold</strong></li><li>Second bullet</li></ul><p>Not in scope: the rest.</p>',
    );
  });

  it('renders numbered lists as <ol>', () => {
    const html = mdToHtml('1. First\n2. Second');
    expect(html).toBe('<ol><li>First</li><li>Second</li></ol>');
  });

  it('escapes raw HTML', () => {
    expect(mdToHtml('a <script>alert(1)</script> b')).toBe('<p>a &lt;script&gt;alert(1)&lt;/script&gt; b</p>');
  });
});

describe('inlineMdToHtml', () => {
  it('links external URLs in a new tab and keeps internal hrefs plain', () => {
    expect(inlineMdToHtml('[Doc](https://x.com/y)')).toBe(
      '<a href="https://x.com/y" target="_blank" rel="noopener">Doc</a>',
    );
    expect(inlineMdToHtml('[Doc](/docs/a)')).toBe('<a href="/docs/a">Doc</a>');
  });

  it('renders code and emphasis', () => {
    expect(inlineMdToHtml('run `npm test` *now*')).toBe('run <code>npm test</code> <em>now</em>');
  });
});
