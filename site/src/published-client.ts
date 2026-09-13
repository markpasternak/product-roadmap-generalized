import { createSSRApp, h, nextTick, ref, shallowRef, Suspense, watch } from 'vue';
import PublishedPage from './components/published/PublishedPage.vue';
import type { PublishedContent } from './lib/published/model';
import { parseRelease, watchPublishedContent, type PublishedCandidate, type PublishedRelease } from './lib/published/client';
import { createPublishedContext, publishedContextKey } from './lib/published/usePublishedContent';
import { captureViewState } from './lib/published/viewState';
import { contentRoutes } from './lib/published/routes';
import { formatDateTime } from './lib/dates';

let cleanup: (() => void) | undefined;
function mount() {
  const host = document.getElementById('published-root');
  const seed = document.getElementById('published-seed');
  if (!host || !seed || host.dataset.hydrated || host.dataset.publishedMounting) return;
  const props = JSON.parse(seed.textContent ?? '') as { model: PublishedContent; release: PublishedRelease; base: string; route?: string };
  parseRelease(props.release);
  // Astro's initial page-load event may arrive while the lazy route is still
  // hydrating. Claim this host immediately, not only when Suspense resolves.
  host.dataset.publishedMounting = 'true';
  const current = shallowRef<PublishedCandidate>({ model: props.model, release: props.release });
  let watcher: ReturnType<typeof watchPublishedContent> | undefined;
  const context = createPublishedContext(current, () => watcher?.refresh());
  const composing = ref(false);
  context.guard(() => composing.value);
  const compositionStart = () => { composing.value = true; };
  const compositionEnd = () => { composing.value = false; };
  document.addEventListener('compositionstart', compositionStart);
  document.addEventListener('compositionend', compositionEnd);
  window.addEventListener('blur', compositionEnd);
  let stopped = false;
  const stopGuardWatch = watch(context.blocked, blocked => { if (!blocked) watcher?.flush(); }, { flush: 'post' });
  function ready() {
    if (watcher || stopped) return;
    // Suspense resolves only after the route-specific async child has hydrated.
    host!.dataset.hydrated = 'true';
    watcher = watchPublishedContent({ initial: props.release, audience: props.model.audience, base: props.base,
      blocked: () => context.blocked.value,
      status: status => { context.status.value = status; },
      apply(candidate) {
        const restore = captureViewState(host!);
        current.value = candidate;
        host!.dataset.contentCommit = candidate.release.commit;
        const metadata = contentRoutes(candidate.model, props.base).find(route => route.path === (props.route ?? ''));
        document.title = metadata?.title ?? 'Content unavailable · Roadmap';
        for (const selector of ['meta[name="description"]', 'meta[property="og:description"]']) document.querySelector(selector)?.setAttribute('content', metadata?.description ?? '');
        document.querySelector('meta[property="og:title"]')?.setAttribute('content', document.title);
        for (const time of document.querySelectorAll<HTMLTimeElement>('[data-publication-time]')) {
          time.dateTime = candidate.release.committedAt;
          time.textContent = formatDateTime(candidate.release.committedAt);
        }
        void nextTick(() => { if (!stopped) restore(); });
      },
    });
  }
  const app = createSSRApp({ render: () => h(Suspense, { onResolve: ready }, { default: () => h(PublishedPage, { model: current.value.model, base: props.base, route: props.route }) }) });
  app.provide(publishedContextKey, context);
  cleanup = () => {
    stopped = true; watcher?.stop(); stopGuardWatch();
    delete host.dataset.publishedMounting;
    delete host.dataset.hydrated;
    document.removeEventListener('compositionstart', compositionStart);
    document.removeEventListener('compositionend', compositionEnd);
    window.removeEventListener('blur', compositionEnd);
    app.unmount();
  };
  app.mount(host);
}
document.addEventListener('astro:before-swap', () => { cleanup?.(); cleanup = undefined; });
document.addEventListener('astro:page-load', mount);
mount();
