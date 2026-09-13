import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import PublishedPage from './components/published/PublishedPage.vue';
import { buildPublishedModel } from './lib/published/model';
import type { PublishedContent } from './lib/published/model';
import { renderDocument } from './lib/published/markdown';
import { loadContentSource } from './lib/published/source';
import { createItemHistoryReader } from './lib/itemHistory.server';
import { fillTemplate } from './lib/published/application';
export { assetCatalog, confinedFile } from '../scripts/managed-assets.mjs';
export { pageSeed } from './lib/published/seed';
export { buildPublishedModel, loadContentSource, fillTemplate };

export async function prepareModel(root: string, base: string, audience: 'internal' | 'public') {
  const model = buildPublishedModel(await loadContentSource(root), { base, audience, historyForPath: createItemHistoryReader(root) });
  const documentHtml: PublishedContent['documentHtml'] = {};
  for (const entry of model.documents) documentHtml[entry.href] = await renderDocument(entry.body ?? '', base, audience);
  return { ...model, audience, documentHtml };
}

export async function renderPage(model: PublishedContent, base: string, route = '') {
  return renderToString(createSSRApp(PublishedPage, { model, base, route }));
}
