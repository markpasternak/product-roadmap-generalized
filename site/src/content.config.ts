import { defineCollection } from 'astro:content';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { glob, type Loader, type LoaderContext } from 'astro/loaders';
import { itemSchema, docSchema } from './lib/schema';

async function markdownStatus(dir: URL): Promise<'missing' | 'empty' | 'present'> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
    throw error;
  }

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.md')) return 'present';
    if (entry.isDirectory()) {
      const childStatus = await markdownStatus(new URL(`${entry.name}/`, dir));
      if (childStatus === 'present') return 'present';
    }
  }
  return 'empty';
}

function optionalMarkdownGlob(base: string): Loader {
  const loader = glob({ pattern: '**/*.md', base });
  return {
    ...loader,
    name: `optional-${loader.name}`,
    async load(context: LoaderContext): Promise<void> {
      const baseDir = new URL(base, context.config.root);
      if (!baseDir.pathname.endsWith('/')) baseDir.pathname = `${baseDir.pathname}/`;
      const status = await markdownStatus(baseDir);
      if (status === 'present') {
        await loader.load(context);
        return;
      }

      context.store.clear();

      if (context.watcher) {
        const basePath = fileURLToPath(baseDir);
        const prefix = basePath.endsWith('/') ? basePath : `${basePath}/`;
        context.watcher.add(basePath);
        context.watcher.on('add', async (filePath) => {
          if (filePath.startsWith(prefix) && filePath.endsWith('.md')) {
            await loader.load(context);
          }
        });
      }
    },
  };
}

// Read the repo markdown natively - the files under ../content stay the source of truth.
const items = defineCollection({
  loader: glob({ pattern: '**/*.md', base: '../content/items' }),
  schema: itemSchema,
});
const prds = defineCollection({
  loader: optionalMarkdownGlob('../content/prds'),
  schema: docSchema,
});
const techDesign = defineCollection({
  loader: optionalMarkdownGlob('../content/technical-design'),
  schema: docSchema,
});
const research = defineCollection({
  loader: optionalMarkdownGlob('../content/research'),
  schema: docSchema,
});

export const collections = { items, prds, techDesign, research };
