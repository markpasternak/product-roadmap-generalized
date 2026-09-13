import { createMarkdownProcessor } from '@astrojs/markdown-remark';
import rehypeRaw from 'rehype-raw';
import { rehypeMermaid, rehypeLinks, rehypeStripSections, rehypeStripPlaceholders } from '../../../scripts/markdown-plugins.mjs';
import type { Root, Element, RootContent } from 'hast';

function safeDocumentHtml() {
  const forbidden = new Set(['script', 'style', 'iframe', 'object', 'embed', 'base', 'meta', 'link', 'form', 'svg', 'math']);
  return (tree: Root) => {
    const clean = (parent: Root | Element) => {
      parent.children = parent.children.filter(node => node.type !== 'element' || !forbidden.has(node.tagName)) as typeof parent.children;
      for (const node of parent.children as RootContent[]) {
        if (node.type !== 'element') continue;
        for (const key of Object.keys(node.properties)) {
          const value = String(node.properties[key] ?? '').replace(/[\u0000-\u0020]/g, '');
          if (/^on/i.test(key) || key === 'srcDoc' || (['href', 'src', 'action', 'formAction', 'xLinkHref'].includes(key) && /^(?!https?:|mailto:)[a-z][a-z0-9+.-]*:/i.test(value))) delete node.properties[key];
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
      rehypePlugins: [rehypeMermaid, [rehypeLinks, base], [rehypeStripSections, audience === 'public' ? ['Links', 'One-liner', 'Open questions'] : ['Links', 'One-liner']], rehypeStripPlaceholders, rehypeRaw, safeDocumentHtml],
    });
    processors.set(key, processor);
    processor.catch(() => processors.delete(key));
  }
  const rendered = await (await processor).render(body);
  return { html: rendered.code, headings: rendered.metadata.headings };
}
