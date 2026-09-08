import { getCollection, type CollectionEntry } from 'astro:content';
import { IS_PUBLIC } from './audience';
import { DOC_COLLECTIONS, type DocCollection } from './slugs';

export function docContentRoot(collection: DocCollection): 'prds' | 'technical-design' | 'research' {
  if (collection === 'techDesign') return 'technical-design';
  return collection;
}

export async function getOptionalDocCollection<C extends DocCollection>(
  collection: C,
): Promise<CollectionEntry<C>[]> {
  // The content loader handles absent/empty directories. Do not inspect source
  // paths here: this module is relocated by the production bundler.
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
