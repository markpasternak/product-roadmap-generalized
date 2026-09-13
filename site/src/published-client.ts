import { createSSRApp, h, nextTick, ref, shallowRef, Suspense, watch } from 'vue';
import PublishedPage from './components/published/PublishedPage.vue';
import type { PublishedContent } from './lib/published/model';
import { parseApplication, parseRelease, watchPublishedContent, type PublishedView, type PublishedApplication, type PublishedRelease } from './lib/published/client';
import { createPublishedContext, publishedContextKey } from './lib/published/usePublishedContent';
import { captureViewState } from './lib/published/viewState';
import { contentRoutes } from './lib/published/routes';
import { formatDateTime } from './lib/dates';

let cleanup: (() => void) | undefined;
function mount() {
  const host = document.getElementById('published-root');
  const seed = document.getElementById('published-seed');
  if (!host || !seed || host.dataset.hydrated || host.dataset.publishedMounting) return;
  const props = JSON.parse(seed.textContent ?? '') as { model: PublishedContent; release?: PublishedRelease; application?: PublishedApplication; base: string; route?: string };
  const identity = props.release ? parseRelease(props.release) : parseApplication(props.application);
  // Astro's initial page-load event may arrive while the lazy route is still
  // hydrating. Claim this host immediately, not only when Suspense resolves.
  host.dataset.publishedMounting = 'true';
  const current = shallowRef<PublishedView>({ model: props.model, release: props.release ?? null });
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
  let mounted = false;
  let startupNotice: HTMLElement | undefined;
  const stopGuardWatch = watch(context.blocked, blocked => { if (!blocked) watcher?.flush(); }, { flush: 'post' });
  function ready() {
    if (stopped) return;
    // Suspense resolves only after the route-specific async child has hydrated.
    host!.dataset.hydrated = 'true';
  }
  function mountPage() {
    if (mounted || stopped) return;
    mounted = true;
    startupNotice?.remove();
    app.mount(host!);
  }
  const app = createSSRApp({ render: () => h(Suspense, { onResolve: ready }, { default: () => h(PublishedPage, { model: current.value.model, base: props.base, route: props.route }) }) });
  app.provide(publishedContextKey, context);
  watcher = watchPublishedContent({ initial: identity, audience: props.model.audience, base: props.base,
      blocked: () => context.blocked.value,
      status: status => {
        context.status.value = status;
        if (!mounted && ['application', 'offline', 'error'].includes(status)) {
          startupNotice?.remove();
          startupNotice = document.createElement('p');
          startupNotice.setAttribute('role', 'status');
          startupNotice.textContent = status === 'application' ? 'A new roadmap version is available. ' : 'Could not load the latest roadmap. Retrying… ';
          const reload = document.createElement('button');
          reload.textContent = 'Reload';
          reload.addEventListener('click', () => window.location.reload());
          startupNotice.append(reload);
          host!.before(startupNotice);
        }
      },
      apply(candidate) {
        const restore = captureViewState(host!);
        current.value = candidate;
        host!.dataset.contentCommit = candidate.release.commit;
        const metadata = contentRoutes(candidate.model, props.base).find(route => route.path === (props.route ?? ''));
        document.title = metadata?.title ?? 'Content unavailable · Roadmap';
        for (const selector of ['meta[name="description"]', 'meta[property="og:description"]']) document.querySelector(selector)?.setAttribute('content', metadata?.description ?? '');
        document.querySelector('meta[property="og:title"]')?.setAttribute('content', document.title);
        for (const time of document.querySelectorAll<HTMLTimeElement>('[data-publication-time]')) {
          time.parentElement?.removeAttribute('hidden');
          time.dateTime = candidate.release.committedAt;
          time.textContent = formatDateTime(candidate.release.committedAt);
        }
        mountPage();
        void nextTick(() => { if (!stopped) restore(); });
      },
    });
  cleanup = () => {
    stopped = true; watcher?.stop(); stopGuardWatch();
    startupNotice?.remove();
    delete host.dataset.publishedMounting;
    delete host.dataset.hydrated;
    document.removeEventListener('compositionstart', compositionStart);
    document.removeEventListener('compositionend', compositionEnd);
    window.removeEventListener('blur', compositionEnd);
    if (mounted) app.unmount();
  };
  // Stable HTML identifies the application, not a global content revision. Keep
  // SSR visible, but start interactive editing/sharing only with a verified base.
  if (props.release) mountPage();
}
document.addEventListener('astro:before-swap', () => { cleanup?.(); cleanup = undefined; });
document.addEventListener('astro:page-load', mount);
mount();
