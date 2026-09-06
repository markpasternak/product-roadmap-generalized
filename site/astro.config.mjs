import managedAssets from './scripts/managed-assets.mjs';
import { defineConfig } from 'astro/config';
import vue from '@astrojs/vue';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { execSync } from 'node:child_process';

// The commit this build was built from, stamped into the client bundle so it can compare
// itself against public/version.json (scripts/gen-version.mjs, same derivation) and detect
// when a newer deploy is live.
const BUILD_COMMIT =
  process.env.GITHUB_SHA ||
  (() => {
    try {
      return execSync('git rev-parse HEAD').toString().trim();
    } catch {
      return 'dev';
    }
  })();

// Leave ```mermaid fenced blocks as <pre class="mermaid"> so the client island can render them.
// (Shiki is told to skip the mermaid language via markdown.syntaxHighlight.excludeLangs.)
function rehypeMermaid() {
  /** @param {any} tree */
  return (tree) => {
    /** @param {any} node @param {any} parent */
    const walk = (node, parent) => {
      if (
        node.type === 'element' &&
        node.tagName === 'code' &&
        (node.properties?.className || []).includes('language-mermaid') &&
        parent?.tagName === 'pre'
      ) {
        const code = (node.children || []).map((/** @type {any} */ c) => c.value || '').join('');
        parent.properties = { className: ['mermaid'] };
        parent.children = [{ type: 'text', value: code }];
        return;
      }
      (node.children || []).forEach((/** @type {any} */ child) => walk(child, node));
    };
    walk(tree, null);
  };
}

// Rewrite in-body links to linked docs (../../content/prds/X.md → /docs/prd/X) and mark
// external links to open in a new tab.
function rehypeLinks(base) {
  const typeRoute = { prds: 'prd', 'technical-design': 'technical-design', research: 'research' };
  const prefix = base.replace(/\/$/, '');
  /** @param {any} tree */
  return (tree) => {
    /** @param {any} node */
    const walk = (node) => {
      if (node.type === 'element' && node.tagName === 'img' && typeof node.properties?.src === 'string') node.properties.src = node.properties.src.replace(/^(?:\.\.\/\.\.\/|content\/|\/)assets\//, `${prefix}/assets/`);
      if (node.type === 'element' && node.tagName === 'a' && node.properties?.href) {
        const href = String(node.properties.href);
        const m = href.match(/(?:^|\/)(prds|technical-design|research)\/(?:.*\/)?([^/]+)\.md$/);
        if (m) {
          node.properties.href = `${prefix}/docs/${typeRoute[m[1]]}/${m[2].toLowerCase()}`;
        } else if (/^https?:\/\//i.test(href)) {
          node.properties.target = '_blank';
          node.properties.rel = 'noopener';
        }
      }
      (node.children || []).forEach(walk);
    };
    walk(tree);
  };
}

// Remove `## <heading>` sections from rendered bodies. `Links` is always stripped
// (item pages render a structured "Related documents" block from the same source);
// public builds also strip internal-only sections.
function rehypeStripSections(headings) {
  /** @param {any} tree */
  return (tree) => {
    const kids = tree.children;
    if (!Array.isArray(kids)) return;
    for (const heading of headings) {
      let start = -1;
      let end = kids.length;
      for (let i = 0; i < kids.length; i++) {
        const n = kids[i];
        if (n.type === 'element' && n.tagName === 'h2') {
          const text = (n.children || []).map((/** @type {any} */ c) => c.value || '').join('').trim();
          if (start === -1 && text === heading) start = i;
          else if (start !== -1) {
            end = i;
            break;
          }
        }
      }
      if (start !== -1) kids.splice(start, end - start);
    }
  };
}

// Drop `## Section`s whose content is empty or still the template placeholder
// ("To fill in.") — placeholders must never render on a page.
function rehypeStripPlaceholders() {
  /** @param {any} node @returns {string} */
  const textOf = (node) => (node.value || '') + (node.children || []).map(textOf).join('');
  /** @param {any} tree */
  return (tree) => {
    const kids = tree.children;
    if (!Array.isArray(kids)) return;
    for (let i = 0; i < kids.length; i++) {
      const n = kids[i];
      if (!(n.type === 'element' && n.tagName === 'h2')) continue;
      let end = i + 1;
      while (end < kids.length && !(kids[end].type === 'element' && kids[end].tagName === 'h2')) end++;
      const content = kids
        .slice(i + 1, end)
        .map(textOf)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (/^(to fill in\.?)?$/i.test(content)) {
        kids.splice(i, end - i);
        i--;
      }
    }
  };
}

// Presentations are static sites staged into public/p/ (scripts/sync-presentations.mjs).
// Vite's static middleware doesn't resolve directory indexes in dev, so /p/<slug>/
// needs an explicit rewrite to index.html. Build output is unaffected (Pages does this).
function presentationIndexes() {
  return {
    name: 'presentation-indexes',
    hooks: {
      /** @param {any} ctx */
      'astro:server:setup'({ server }) {
        server.middlewares.use((/** @type {any} */ req, /** @type {any} */ _res, /** @type {any} */ next) => {
          const url = (req.url || '').split('?')[0];
          const m = url.match(/^(.*\/p\/[a-z0-9_-]+)\/?$/i);
          if (m) req.url = `${m[1]}/index.html`;
          next();
        });
      },
    },
  };
}

// Base path is portable: root by default; set SITE_BASE=/product-roadmap for GitHub project Pages.
const base = process.env.SITE_BASE || '/';

// SITE_AUDIENCE=public builds the external site: Public items only, no owners,
// internal-only sections stripped. Default is the full internal site.
const audience = process.env.SITE_AUDIENCE === 'public' ? 'public' : 'internal';
// 'One-liner' renders as the item-page lede, not as a body section.
const strippedSections =
  audience === 'public' ? ['Links', 'One-liner', 'Open questions'] : ['Links', 'One-liner'];

export default defineConfig({
  site: process.env.SITE_URL || 'https://roadmapdemo.canvas-drop.com',
  base,
  trailingSlash: 'ignore',
  integrations: [vue(), sitemap(), presentationIndexes(), managedAssets(audience, base)],
  vite: {
    plugins: [tailwindcss()],
    define: { __SITE_AUDIENCE__: JSON.stringify(audience), __BUILD_COMMIT__: JSON.stringify(BUILD_COMMIT) },
    build: {
      // The Mermaid renderer is imported lazily by the Mermaid island only when
      // markdown contains a diagram. Keep its heavy ELK layout worker named and
      // accounted for instead of letting Vite report an anonymous index chunk.
      chunkSizeWarningLimit: 1650,
      rollupOptions: {
        output: {
          manualChunks(id) {
            const normalized = id.replace(/\\/g, '/');
            if (normalized.includes('/node_modules/elkjs/')) return 'mermaid-elk';
            if (
              normalized.includes('/node_modules/beautiful-mermaid/') ||
              normalized.includes('/node_modules/entities/')
            ) {
              return 'mermaid-renderer';
            }
          },
        },
      },
    },
  },
  markdown: {
    syntaxHighlight: { type: 'shiki', excludeLangs: ['mermaid'] },
    shikiConfig: { themes: { light: 'github-light', dark: 'github-dark' }, wrap: true },
    rehypePlugins: [
      rehypeMermaid,
      [rehypeLinks, base],
      [rehypeStripSections, strippedSections],
      rehypeStripPlaceholders,
    ],
  },
});
