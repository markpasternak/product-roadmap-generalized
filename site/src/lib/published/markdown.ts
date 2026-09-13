import { createMarkdownProcessor } from '@astrojs/markdown-remark';
import rehypeRaw from 'rehype-raw';
import { rehypeMermaid, rehypeLinks, rehypeStripSections, rehypeStripPlaceholders } from '../../../scripts/markdown-plugins.mjs';
import type { Root, Element, RootContent } from 'hast';

function safeDocumentHtml() {
  const allowed = new Set('a abbr audio b blockquote br caption code col colgroup dd del details div dl dt em figcaption figure h1 h2 h3 h4 h5 h6 hr i img input kbd li mark ol p picture pre s samp section small source span strong sub summary sup table tbody td th thead tr u ul video'.split(' '));
  const attributes = new Set('id className title href src poster alt width height controls loop muted preload type checked disabled colSpan rowSpan start reversed open loading decoding align'.split(' '));
  return (tree: Root) => {
    const clean = (parent: Root | Element) => {
      parent.children = parent.children.filter(node => node.type === 'text' || (node.type === 'element' && allowed.has(node.tagName))) as typeof parent.children;
      for (const node of parent.children as RootContent[]) {
        if (node.type !== 'element') continue;
        for (const key of Object.keys(node.properties)) {
          const value = String(node.properties[key] ?? '').replace(/[\u0000-\u0020\u007f]/g, '');
          // Only the colour declarations emitted by Shiki survive. Arbitrary CSS,
          // custom elements, forms, named properties and executable URL schemes do not.
          if (key === 'style') {
            const declarations = String(node.properties[key]).split(';').filter(Boolean);
            const safe = declarations.every(declaration => /^\s*(?:color|background-color|--shiki-(?:light|dark)(?:-bg)?):\s*#[a-f\d]{3,8}\s*$/i.test(declaration));
            if (!safe) delete node.properties[key];
          } else if (!attributes.has(key)
            || (key === 'id' && /^(?:published-|__roadmap)/i.test(value))
            || (['href', 'src', 'poster'].includes(key) && /^(?!https?:|mailto:)[a-z][a-z0-9+.-]*:/i.test(value))) delete node.properties[key];
        }
        if (node.tagName === 'input') { node.properties.disabled = true; node.properties.type = 'checkbox'; }
        clean(node);
      }
    };
    clean(tree);
  };
}

// Cache processor setup by profile, never document state. Each render owns its VFile.
const processors = new Map<string, ReturnType<typeof createMarkdownProcessor>>();
export async function renderDocument(body: string, base: string, audience: 'internal' | 'public') {
  const key = JSON.stringify([base, audience]);
  let processor = processors.get(key);
  if (!processor) {
    processor = createMarkdownProcessor({
      syntaxHighlight: { type: 'shiki', excludeLangs: ['mermaid'] },
      shikiConfig: { themes: { light: 'github-light', dark: 'github-dark' }, wrap: true },
      rehypePlugins: [rehypeRaw, rehypeMermaid, [rehypeLinks, base], [rehypeStripSections, audience === 'public' ? ['Links', 'One-liner', 'Open questions'] : ['Links', 'One-liner']], rehypeStripPlaceholders, safeDocumentHtml],
    });
    processors.set(key, processor);
    processor.catch(() => processors.delete(key));
  }
  const rendered = await (await processor).render(body);
  return { html: rendered.code, headings: rendered.metadata.headings };
}
