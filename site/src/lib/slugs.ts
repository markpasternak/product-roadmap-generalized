// Route slug helpers for items and docs.

export const itemSlug = (id: string): string => id;

/** Product name → URL slug, e.g. 'Music App' → 'music-app', 'Core Platform & Data' →
 *  'core-platform-data'. Every non-alphanumeric run collapses to a single hyphen so a
 *  product name containing punctuation (an ampersand, a slash) still yields a clean,
 *  routable path. The item folder under content/items/ is named for this same slug. */
export const productSlug = (product: string): string =>
  product
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** A doc entry id like 'podcasts-audiobooks/PRD-TALK-001-…' → its filename slug. */
export const docBasename = (entryId: string): string => entryId.split('/').pop() ?? entryId;

export const DOC_COLLECTIONS = ['prds', 'techDesign', 'research'] as const;
export type DocCollection = (typeof DOC_COLLECTIONS)[number];

export const DOC_TYPE_LABEL: Record<DocCollection, string> = {
  prds: 'PRD',
  techDesign: 'Technical design',
  research: 'Research',
};

/** URL segment for a doc type, e.g. /docs/technical-design/<slug>. */
export const DOC_TYPE_ROUTE: Record<DocCollection, string> = {
  prds: 'prd',
  techDesign: 'technical-design',
  research: 'research',
};

export const DOC_ROUTE_TO_COLLECTION: Record<string, DocCollection> = {
  prd: 'prds',
  'technical-design': 'techDesign',
  research: 'research',
};
