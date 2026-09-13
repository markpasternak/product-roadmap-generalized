import managedAssets from './scripts/managed-assets.mjs';
import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
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

import { rehypeMermaid, rehypeLinks, rehypeStripSections, rehypeStripPlaceholders } from './scripts/markdown-plugins.mjs';

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
  // Preserve spacing between inline elements across the Astro 7 upgrade.
  compressHTML: true,
  build: { concurrency: 2 },
  site: process.env.SITE_URL || 'https://roadmapdemo.canvas-drop.com',
  base,
  trailingSlash: 'ignore',
  integrations: [vue(), sitemap(), presentationIndexes(),
    ...(process.env.CONTENT_APPLICATION_BUILD === '1' ? [] : [managedAssets(audience, base)]),
    ...(process.env.CONTENT_APPLICATION_BUILD === '1' ? [{ name: 'publication-template', hooks: {
      'astro:config:setup'({ injectRoute }) {
        injectRoute({ pattern: '/_publication-template', entrypoint: './src/layouts/PublishedTemplate.astro' });
        injectRoute({ pattern: '/_publication-template-docs', entrypoint: './src/layouts/PublishedTemplate.astro' });
      },
    } }] : []),
  ],
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
    // Keep the resource-link and Mermaid rehype transformations.
    processor: unified({
      rehypePlugins: [
        rehypeMermaid,
        [rehypeLinks, base],
        [rehypeStripSections, strippedSections],
        rehypeStripPlaceholders,
      ],
    }),
    syntaxHighlight: { type: 'shiki', excludeLangs: ['mermaid'] },
    shikiConfig: { themes: { light: 'github-light', dark: 'github-dark' }, wrap: true },
  },
});
