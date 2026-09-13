import { PRODUCTS } from '../schema';
import { productSlug, docBasename } from '../slugs';
import type { PublishedContent } from './model';

export type PageKind = 'board' | 'item' | 'document' | 'documents' | 'themes' | 'changelog' | 'changes' | 'unavailable';
export const pageComponents: Record<Exclude<PageKind, 'unavailable'>, string> = {
  board: 'board/Board.vue', item: 'published/ItemPage.vue', document: 'published/DocumentPage.vue',
  documents: 'published/DocumentsIndex.vue', themes: 'published/ThemesPage.vue',
  changelog: 'published/ChangelogPage.vue', changes: 'published/ChangesPage.vue',
};
export function pageKind(path: string): PageKind {
  if (path === '' || PRODUCTS.some(product => productSlug(product) === path)) return 'board';
  if (path.startsWith('item/')) return 'item';
  if (path.startsWith('docs/')) return 'document';
  if (path === 'docs') return 'documents';
  if (path === 'themes' || path === 'changelog' || path === 'changes') return path;
  return 'unavailable';
}
export function contentRoutes(model: PublishedContent, base: string) {
  const routes = [
    { path: '', title: 'SeenThis Roadmap', description: 'The Now, Next and Later roadmap across Core Tech, Infra, Data, Studio, Creative Manager and Revenue Ops, ordered by confidence rather than dates.' },
    ...PRODUCTS.map(product => ({ path: productSlug(product), title: `${product} · SeenThis Roadmap`, description: `What's Now, Next and Later for ${product}, ordered by confidence rather than dates.` })),
    { path: 'docs', title: 'Source documents · Roadmap', description: 'Workshop notes, research, and planning documents referenced by roadmap items.' },
    { path: 'themes', title: 'Themes · Roadmap', description: "The strategic themes the roadmap is organized around, and what's in each." },
    { path: 'changelog', title: 'Activity — item updates · Roadmap', description: 'Recently updated and shipped roadmap items.' },
    { path: 'changes', title: 'Activity — commits · Roadmap', description: 'The latest commits to the roadmap — who changed what, and a link to each commit.' },
    ...model.boardItems.map(item => ({ path: `item/${item.id}`, title: `${item.title} · SeenThis Roadmap`, description: item.oneliner || `${item.product} roadmap item ${item.id}` })),
    ...model.documents.map(doc => ({ path: doc.href.slice(base.length), title: `${doc.data.title ?? docBasename(doc.id)} · Source documents`, description: '' })),
  ];
  return routes.map(route => ({ ...route, kind: pageKind(route.path), active: route.path === 'docs' || route.path.startsWith('docs/') ? 'docs' as const : 'roadmap' as const }));
}
