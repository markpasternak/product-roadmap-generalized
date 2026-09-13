import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import PublishedPage from './components/published/PublishedPage.vue';
import { buildPublishedModel } from './lib/published/model';
import type { PublishedContent } from './lib/published/model';
import { loadContentSource } from './lib/published/source';
import { fillTemplate } from './lib/published/application';
export { prepareResources } from '../scripts/managed-assets.mjs';
export { pageSeed } from './lib/published/seed';
export { contentRoutes, pageComponents } from './lib/published/routes';
export { buildPublishedModel, loadContentSource, fillTemplate };
export { prepareModel } from './lib/published/prepare.server';

export async function renderPage(model: PublishedContent, base: string, route = '') {
  return renderToString(createSSRApp(PublishedPage, { model, base, route }));
}
