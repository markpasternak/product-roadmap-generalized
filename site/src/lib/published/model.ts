import { itemSchema, docSchema } from '../schema';
import { DOC_TYPE_ROUTE, docBasename, type DocCollection } from '../slugs';
import { parseSections, serializeSections } from '../edit/sections';
import { STORY_HEADINGS } from '../sectionHeadings';
import { parseLinks } from '../items';
import { resourcePlacements, removeResourcePlacement, resourceHref } from '../resources';
import { buildPublishedBoardItems } from './board';
import type { ContentSource, ContentDocuments, ModelOptions } from './schema';

export function docContentRoot(collection: DocCollection): ContentDocuments['root'] {
  return collection === 'techDesign' ? 'technical-design' : collection;
}

const publicItemHeadings = new Set(['One-liner', 'Target outcome', "Who it's for", ...STORY_HEADINGS, 'Links', 'Resources']);
const privateDocHeadings = new Set(['Acceptance criteria', 'Open questions', 'In the codebase', 'Current behavior', 'Current behavior (in repo)']);

function publicBody(body: string, item: boolean): string {
  const parsed = parseSections(body);
  return serializeSections(item ? '' : parsed.preamble, parsed.sections.filter(s => item ? publicItemHeadings.has(s.heading) : !privateDocHeadings.has(s.heading)));
}

function checkSourcePath(path: string | undefined): void {
  if (!path) return;
  // Astro's filePath may begin ../; inspect the repository-relative suffix.
  const index = path.indexOf('content/');
  if (index < 0 || path.slice(index).split('/').some(p => !p || p === '.' || p === '..' || p.includes('\\')))
    throw new Error('Invalid content source path');
}

/** Pure, invocation-scoped transformation shared by Astro and the content publisher. */
export function buildPublishedModel(source: ContentSource, options: ModelOptions) {
  if (!/^\/(?:[^?#\\]*\/)?$/.test(options.base) || options.base.includes('..')) throw new Error('Invalid base path');
  const isPublic = options.audience === 'public';
  const ids = new Set<string>();
  const items = source.items.map(entry => {
    checkSourcePath(entry.filePath);
    const data = itemSchema.parse(entry.data);
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(data.id)) throw new Error('Invalid item route');
    if (ids.has(data.id.toLowerCase())) throw new Error('Duplicate item identifier');
    ids.add(data.id.toLowerCase());
    return { ...entry, data, body: entry.body ?? '' };
  }).filter(entry => !isPublic || entry.data.visibility === 'Public').map(entry => isPublic
    ? { ...entry, data: { ...entry.data, owner: '' }, body: publicBody(entry.body, true) } : entry);

  const routes = new Set<string>();
  const collections: ContentDocuments[] = source.documents.map(({ coll, entries }) => ({
    coll, root: docContentRoot(coll), entries: entries.map(entry => {
      checkSourcePath(entry.filePath);
      const slug = docBasename(entry.id);
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(slug)) throw new Error('Invalid document route');
      const route = `${DOC_TYPE_ROUTE[coll]}/${slug.toLowerCase()}`;
      if (routes.has(route)) throw new Error('Document route collision');
      routes.add(route);
      return { ...entry, data: docSchema.parse(entry.data), body: entry.body ?? '' };
    }).filter(entry => !isPublic || entry.data.visibility === 'Public').map(entry => isPublic
      ? { ...entry, data: { ...entry.data, owner: undefined }, body: publicBody(entry.body, false) } : entry),
  }));
  const historyForPath: ModelOptions['historyForPath'] = path => {
    const history = options.historyForPath(path);
    return isPublic ? { ...history, createdBy: '', updatedBy: '', createdSubject: '', updatedSubject: '' } : history;
  };
  if (isPublic) {
    const visibleDocs = new Set(collections.flatMap(({ coll, entries }) => entries.map(entry => `${options.base}docs/${DOC_TYPE_ROUTE[coll]}/${docBasename(entry.id)}`)));
    const redactLinks = (body: string) => {
      for (const placement of resourcePlacements(body).sort((a, b) => b.start - a.start)) {
        const href = resourceHref(placement.href, options.base);
        if (href.startsWith(`${options.base}docs/`) && !visibleDocs.has(href)) body = removeResourcePlacement(body, placement);
      }
      return body;
    };
    for (const entry of items) entry.body = redactLinks(entry.body);
    const visibleItems = new Set(items.map(item => item.data.id));
    for (const { entries } of collections) for (const entry of entries) {
      entry.body = redactLinks(entry.body ?? '');
      if (entry.data.roadmap_item && !visibleItems.has(entry.data.roadmap_item)) entry.data.roadmap_item = undefined;
      if (entry.data.related) entry.data.related = entry.data.related.filter(id => visibleItems.has(id));
    }
  }
  const boardItems = buildPublishedBoardItems(items, collections, { ...options, historyForPath });
  const documents = collections.flatMap(({ coll, entries }) => entries.map(entry => {
    const href = `${options.base}docs/${DOC_TYPE_ROUTE[coll]}/${docBasename(entry.id)}`;
    const backlinks = items.filter(item => item.data.id === entry.data.roadmap_item || parseLinks(item.body, options.base).some(link => link.kind === 'doc' && link.href === href))
      .map(item => ({ id: item.data.id, title: item.data.title, href: `${options.base}item/${item.data.id}` }));
    return { ...entry, coll, href, backlinks };
  }));
  // A public item's link must not reveal a private document's title/path.
  if (isPublic) {
    const visibleHrefs = new Set(documents.map(doc => doc.href));
    for (const item of boardItems) item.links = item.links.filter(link => link.kind !== 'doc' || visibleHrefs.has(link.href));
  }
  return { items, documents, boardItems };
}

export type PublishedModel = ReturnType<typeof buildPublishedModel>;
export type PublishedContent = PublishedModel & {
  audience: 'internal' | 'public';
  resourceCatalog?: import('../share/resources').ShareResourceCatalog;
  documentHtml: Record<string, { html: string; headings: { depth: number; slug: string; text: string }[] }>;
};
