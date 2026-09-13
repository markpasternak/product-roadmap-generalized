import { buildPublishedModel, type PublishedContent } from './model';
import { loadContentSource } from './source';
import { renderDocument } from './markdown';
import { createItemHistoryReader } from '../itemHistory.server';

/** The same model and Markdown policy in development and compiled publication. */
export async function prepareModel(root: string, base: string, audience: 'internal' | 'public', cache?: { get: <T>(kind: string, inputs: unknown, produce: () => Promise<T>) => Promise<T> }) {
  const model = buildPublishedModel(await loadContentSource(root), { base, audience, historyForPath: createItemHistoryReader(root) });
  const documentHtml: PublishedContent['documentHtml'] = {};
  for (const entry of model.documents) documentHtml[entry.href] = await (cache ? cache.get('document', [entry.body ?? '', base, audience], () => renderDocument(entry.body ?? '', base, audience)) : renderDocument(entry.body ?? '', base, audience));
  return { ...model, audience, documentHtml };
}
