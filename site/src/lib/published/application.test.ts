// @vitest-environment node
import { expect, it } from 'vitest';
import { escapeSeed, fillTemplate } from './application';

it('inserts literal content once without interpreting marker-looking user data', () => {
  const template = '<head><!--ROADMAP_STYLES--><title>__ROADMAP_TITLE__</title></head><div><!--ROADMAP_CONTENT--></div><script type="application/json">__ROADMAP_SEED__</script><script src="__ROADMAP_CLIENT__"></script>';
  const html = fillTemplate(template, { title: 'A <title> "test"', html: '<p>__ROADMAP_TITLE__</p>', seed: { text: '</script><script>bad()</script>' } });
  expect(html).toContain('<title>A &lt;title&gt; &quot;test&quot;</title>');
  expect(html).toContain('<p>__ROADMAP_TITLE__</p>');
  expect(html.match(/<script/g)).toHaveLength(2);
});

it('rejects a shell that lost its styles rather than silently serving unstyled pages', () => {
  const template = '<title>__ROADMAP_TITLE__</title><!--ROADMAP_CONTENT-->__ROADMAP_SEED____ROADMAP_CLIENT__';
  expect(() => fillTemplate(template, { title: 'Item', html: '', seed: {}, styles: ['/assets/item.css'] })).toThrow(/template/i);
});

it('escapes JSON script termination and rejects a template without its insertion point', () => {
  expect(JSON.parse(escapeSeed({ value: '</script>\u2028' }))).toEqual({ value: '</script>\u2028' });
  expect(() => fillTemplate('<div/>', { title: 'Test', html: '', seed: {} })).toThrow(/template/i);
});
