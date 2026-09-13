import type { ItemFrontmatter, DocFrontmatter } from '../schema';
import type { ItemHistory } from '../itemHistory';
import type { DocCollection } from '../slugs';

export type ContentItem = { id: string; filePath?: string; data: ItemFrontmatter; body?: string };
export type ContentDocument = { id: string; filePath?: string; data: DocFrontmatter; body?: string };
export type ContentDocuments = { coll: DocCollection; root: 'prds' | 'technical-design' | 'research'; entries: ContentDocument[] };
export type ContentSource = {
  items: ContentItem[];
  documents: { coll: DocCollection; entries: { id: string; filePath?: string; data: unknown; body?: string }[] }[];
};
export type ModelOptions = {
  base: string;
  audience: 'internal' | 'public';
  historyForPath: (path: string | null) => ItemHistory;
};
