import type { PublishedContent } from './model';

/** A route's initial view from one revision, without duplicating every document in every HTML file. */
export function pageSeed(model: PublishedContent, base: string, route: string): PublishedContent {
  const empty = { ...model, items: [], boardItems: [], documents: [], documentHtml: {} };
  if (route.startsWith('item/')) {
    const id = route.slice(5);
    const index = model.boardItems.findIndex(item => item.id === id);
    return { ...empty, items: model.items.filter(item => item.data.id === id),
      boardItems: index < 0 ? [] : model.boardItems.slice(Math.max(0, index - 1), index + 2) };
  }
  const document = model.documents.find(doc => doc.href === `${base}${route}`);
  if (document) return { ...empty, documents: [document], documentHtml: { [document.href]: model.documentHtml[document.href] } };
  return { ...empty, boardItems: model.boardItems };
}
