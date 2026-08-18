import { readdir } from 'node:fs/promises';
import { getCollection, type CollectionEntry } from 'astro:content';
import { IS_PUBLIC } from './audience';
import { DOC_COLLECTIONS, type DocCollection } from './slugs';

const DOC_DIRS: Record<DocCollection, URL> = {
  prds: new URL('../../../content/prds/', import.meta.url),
  techDesign: new URL('../../../content/technical-design/', import.meta.url),
  research: new URL('../../../content/research/', import.meta.url),
};

const presenceCache = new Map<DocCollection, Promise<boolean>>();

async function hasMarkdownFile(dir: URL): Promise<boolean> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.md')) return true;
    if (entry.isDirectory() && (await hasMarkdownFile(new URL(`${entry.name}/`, dir)))) return true;
  }
  return false;
}

export function docContentRoot(collection: DocCollection): 'prds' | 'technical-design' | 'research' {
  if (collection === 'techDesign') return 'technical-design';
  return collection;
}

export async function hasDocFiles(collection: DocCollection): Promise<boolean> {
  let promise = presenceCache.get(collection);
  if (!promise) {
    promise = hasMarkdownFile(DOC_DIRS[collection]);
    presenceCache.set(collection, promise);
  }
  return promise;
}

export async function getOptionalDocCollection<C extends DocCollection>(
  collection: C,
): Promise<CollectionEntry<C>[]> {
  if (!(await hasDocFiles(collection))) return [];
  return getCollection(collection) as Promise<CollectionEntry<C>[]>;
}

export async function getVisibleDocCollection<C extends DocCollection>(
  collection: C,
): Promise<CollectionEntry<C>[]> {
  const docs = await getOptionalDocCollection(collection);
  return docs.filter((entry) => !IS_PUBLIC || entry.data.visibility === 'Public');
}

export async function getVisibleDocCollections(): Promise<
  { coll: DocCollection; root: 'prds' | 'technical-design' | 'research'; entries: CollectionEntry<DocCollection>[] }[]
> {
  return Promise.all(
    DOC_COLLECTIONS.map(async (coll) => ({
      coll,
      root: docContentRoot(coll),
      entries: await getVisibleDocCollection(coll),
    })),
  );
}
