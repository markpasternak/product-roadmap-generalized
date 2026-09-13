import { createSSRApp, type App } from 'vue';
import PublishedPage from './components/published/PublishedPage.vue';
import type { PublishedContent } from './lib/published/model';

let app: App | undefined;
function mount() {
  const host = document.getElementById('published-root');
  const seed = document.getElementById('published-seed');
  if (!host || !seed || host.dataset.hydrated) return;
  const props = JSON.parse(seed.textContent ?? '') as { model: PublishedContent; base: string; route?: string };
  app = createSSRApp(PublishedPage, props);
  app.mount(host);
  host.dataset.hydrated = 'true';
}
document.addEventListener('astro:before-swap', () => { app?.unmount(); app = undefined; });
document.addEventListener('astro:page-load', mount);
mount();
