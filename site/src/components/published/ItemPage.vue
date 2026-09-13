<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch, ref } from 'vue';
import Breadcrumb from '../ui/Breadcrumb.vue';
import ProductMark from '../ui/ProductMark.vue';
import PlannedDates from '../board/PlannedDates.vue';
import { PhCaretLeft, PhCaretRight, PhLink, PhPencilSimple, PhFileText, PhArrowSquareOut } from '@phosphor-icons/vue';
import { horizonDot, productColor, toneSurface, toneSurfaceStrong, toneText, tagTone } from '../../lib/display';
import { parseSections } from '../../lib/items';
import { sectionLabel } from '../../lib/sectionHeadings';
import { renderRichMarkdown } from '../../lib/richMarkdown';
import { resourceHref, isImageResource } from '../../lib/resources';
import { coverPresentationCss } from '../../lib/coverPresentation';
import { productSlug } from '../../lib/slugs';
import { formatDateTime, formatDateTimeOrDate } from '../../lib/dates';
import { linkSource } from '../../lib/sources';
import { installItemImageViewer } from '../../lib/itemImageViewer';
import '../../styles/image-viewer.css';
import type { PublishedModel } from '../../lib/published/model';

const props = defineProps<{ model: PublishedModel; id: string; base: string; audience: 'internal' | 'public' }>();
const entry = computed(() => props.model.items.find(item => item.data.id === props.id));
const item = computed(() => props.model.boardItems.find(item => item.id === props.id));
const previous = computed(() => props.model.boardItems[props.model.boardItems.findIndex(item => item.id === props.id) - 1]);
const next = computed(() => props.model.boardItems[props.model.boardItems.findIndex(item => item.id === props.id) + 1]);
const sections = computed(() => parseSections(entry.value?.body ?? '').filter(section => !['One-liner', 'Links', 'Resources'].includes(section.heading)).map(section => ({ heading: sectionLabel(section.heading), html: renderRichMarkdown(section.raw, props.base) })));
const cover = computed(() => item.value?.cover ? resourceHref(item.value.cover, props.base) : '');
function linkText(link: NonNullable<typeof item.value>['links'][number]) {
  if (link.kind === 'external') {
    try { return new URL(link.target).hostname.replace(/^www\./, ''); } catch { return link.target; }
  }
  if (link.kind === 'presentation') return (link.href.split('/').filter(Boolean).at(-1) ?? '').replace(/[-_]/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
  return link.title ?? link.target.split('/').at(-1) ?? link.target;
}
const links = computed(() => (item.value?.links ?? []).map(link => ({ ...link, source: linkSource(link.label, link.target), display: linkText(link) })));
const mounted = ref(false);
const dateOptions = computed(() => mounted.value ? {} : { timeZone: 'UTC', suffix: 'UTC' });
const historyTitle = (at?: string, by?: string, subject?: string) => [at ? formatDateTime(at, dateOptions.value) : '', by, subject].filter(Boolean).join(' · ');
const details = computed(() => item.value ? [
  { label: 'Product', value: item.value.product, href: `${props.base}${productSlug(item.value.product)}/` },
  ...(props.audience === 'internal' && item.value.owner ? [{ label: 'Owner', value: item.value.owner }] : []),
  { label: 'Created', value: formatDateTimeOrDate(item.value.createdAt, item.value.created, dateOptions.value), datetime: item.value.createdAt || item.value.created, title: historyTitle(item.value.createdAt, item.value.createdBy, item.value.createdSubject) },
  { label: 'Updated', value: formatDateTimeOrDate(item.value.updatedAt, item.value.updated, dateOptions.value), datetime: item.value.updatedAt || item.value.updated, title: historyTitle(item.value.updatedAt, item.value.updatedBy, item.value.updatedSubject) },
  ...(links.value.length ? [{ label: 'Resources', value: String(links.value.length) }] : []),
  { label: 'Item ID', value: item.value.id },
].filter(row => row.value) : []);
const tagHref = (tag: string) => `${props.base}?${new URLSearchParams({ tag })}`;
let viewer: ReturnType<typeof installItemImageViewer> | undefined;
function updateViewer() {
  if (!mounted.value) return;
  viewer?.destroy();
  const root = document.querySelector<HTMLElement>('[data-item-page]');
  viewer = root ? installItemImageViewer(root) : undefined;
}
onMounted(() => { mounted.value = true; updateViewer(); });
watch(() => props.model, updateViewer, { flush: 'post' });
onUnmounted(() => { mounted.value = false; viewer?.destroy(); });
</script>

<template>
  <main v-if="!entry || !item" class="mx-auto max-w-3xl p-6"><h1>Item unavailable</h1><p>This item is no longer part of the published roadmap.</p><a :href="base">Return to roadmap</a></main>
  <main v-else class="page-reveal mx-auto max-w-[1440px] px-4 pb-10 sm:px-7" data-item-page :data-prev-href="previous ? `${base}item/${previous.id}` : undefined" :data-next-href="next ? `${base}item/${next.id}` : undefined">
    <section :style="{ '--roadmap-product-accent': productColor[entry.data.product] }" class="roadmap-masthead roadmap-product-detail -mx-4 rounded-b-[22px] px-5 py-3 sm:mx-0 sm:mt-4 sm:rounded-[22px] sm:px-6 lg:px-7">
      <div class="flex flex-wrap items-center justify-between gap-4">
        <Breadcrumb :items="[{ label: 'Roadmap', href: base }, { label: item.id }]" />
        <div class="flex flex-wrap items-center gap-3">
          <a :href="previous ? `${base}item/${previous.id}` : undefined" :title="previous ? `Previous: ${previous.title}` : undefined" :aria-label="previous ? `Previous item: ${previous.title}` : 'No previous item'" class="roadmap-action grid size-10 place-items-center rounded-lg border bg-card/80 border-border-subtle-default text-icons-subtle-default" :class="previous ? 'hover:text-text-primary-default' : 'pointer-events-none opacity-30'"><PhCaretLeft :size="19" /></a>
          <a :href="next ? `${base}item/${next.id}` : undefined" :title="next ? `Next: ${next.title}` : undefined" :aria-label="next ? `Next item: ${next.title}` : 'No next item'" class="roadmap-action grid size-10 place-items-center rounded-lg border bg-card/80" :class="next ? 'border-[color:var(--color-accent-brand-default)] text-[color:var(--color-accent-brand-default)]' : 'pointer-events-none border-border-subtle-default text-icons-subtle-default opacity-30'"><PhCaretRight :size="19" /></a>
          <button type="button" data-copy-link class="roadmap-action inline-flex h-10 items-center gap-2 rounded-lg border border-border-subtle-default bg-card/80 px-3.5 text-single-sm-medium text-text-primary-default"><PhLink :size="18" /><span data-copy-label>Copy link</span></button>
          <a v-if="item.editUrl" :href="item.editUrl" target="_blank" rel="noopener" class="roadmap-action hidden h-10 items-center gap-2 rounded-lg border border-border-subtle-default bg-card/80 px-3.5 text-single-sm-medium text-text-primary-default sm:inline-flex"><PhPencilSimple :size="18" /> Edit on GitHub</a>
        </div>
      </div>
      <p data-copy-status role="status" class="mt-2 text-sm text-text-subtle-default empty:hidden" />
      <div class="item-page-hero" :class="{ 'has-cover': cover, 'is-completed': item.horizon === 'Completed' }">
        <div v-if="cover" class="item-page-cover roadmap-cover-media" aria-hidden="true" :style="coverPresentationCss(item.coverPosition, item.coverFraming)"><img v-for="layer in ['backdrop', 'fill', 'reveal']" :key="layer" :class="`roadmap-cover-${layer}`" :src="cover" alt="" decoding="async"><span class="item-page-cover-treatment" /></div>
        <div class="item-page-hero-copy"><ProductMark :product="item.product" :size="40" /><div class="min-w-0"><h1 class="roadmap-display roadmap-title">{{ item.title }}</h1><p v-if="item.oneliner" class="roadmap-muted mt-1.5 max-w-3xl text-sm leading-relaxed sm:text-base">{{ item.oneliner }}</p></div></div>
      </div>
      <dl class="item-page-status-summary">
        <div><dt>Horizon</dt><dd><span :style="{ background: horizonDot[entry.data.horizon] }" />{{ item.horizon }}</dd></div>
        <div><dt>Stage</dt><dd>{{ item.stage }}</dd></div><div><dt>Impact</dt><dd>{{ item.impact || 'Not scored' }}</dd></div><div><dt>Effort</dt><dd>{{ item.effort || 'Not scoped' }}</dd></div>
        <div v-if="audience === 'internal'"><dt>Visibility</dt><dd>{{ item.visibility }}</dd></div>
      </dl>
    </section>
    <div class="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <article class="min-w-0">
        <PlannedDates :start-date="item.startDate" :end-date="item.endDate" />
        <section class="mt-3"><div class="space-y-5"><section v-for="(section, index) in sections" :key="`${section.heading}-${index}`" class="item-reading-section item-section-surface"><div class="min-w-0"><h2 class="roadmap-section-heading">{{ section.heading }}</h2><div class="resource-markdown item-prose mt-1.5 text-base leading-relaxed text-text-primary-default" v-html="section.html" /></div></section></div>
          <div v-if="item.tags.length || item.themes.length" class="mt-6 flex flex-wrap gap-2"><a v-for="theme in item.themes" :key="theme" :href="tagHref(`theme:${theme}`)" class="text-single-sm-medium inline-flex min-h-8 items-center rounded-lg border border-border-subtle-default/60 px-2.5 py-1 hover:underline" :style="{ background: toneSurface.orange, color: toneText.orange }">{{ theme }}</a><a v-for="tag in item.tags" :key="tag" :href="tagHref(tag)" class="text-single-sm-medium inline-flex min-h-8 items-center rounded-lg border border-border-subtle-default/60 px-2.5 py-1 hover:underline" :style="{ background: toneSurface[tagTone(tag)], color: toneText[tagTone(tag)] }">{{ tag }}</a></div>
        </section>
      </article>
      <aside class="flex flex-col gap-5 lg:sticky lg:top-20 lg:self-start">
        <section v-if="links.length" class="roadmap-panel rounded-[22px] p-4"><h2 class="font-display roadmap-title flex items-center gap-2 text-[1.35rem] leading-none"><PhFileText :size="20" /> Related resources</h2>
          <div class="mt-4 grid grid-cols-[minmax(0,1fr)] gap-2.5"><a v-for="(link, index) in links" :key="`${link.href}-${index}`" :href="link.href" :target="['external', 'presentation'].includes(link.kind) ? '_blank' : undefined" rel="noopener" class="roadmap-action flex min-w-0 items-center gap-3 rounded-xl border border-border-subtle-default bg-card/70 px-3 py-2.5 hover:bg-card">
            <img v-if="link.image || isImageResource(link.target)" :src="link.href" alt="" loading="lazy" decoding="async" class="h-16 w-20 shrink-0 rounded-lg border border-border-subtle-default object-contain"><span v-else class="grid size-9 shrink-0 place-items-center rounded-lg" :style="{ background: toneSurfaceStrong[link.source.tone], color: toneText[link.source.tone] }"><component :is="link.source.Icon" :size="19" /></span>
            <span class="min-w-0 flex-1"><span class="text-single-sm-medium block whitespace-normal font-semibold" :style="{ color: toneText[link.source.tone] }">{{ link.label }}</span><span class="text-single-base-medium text-text-primary-default block whitespace-normal break-words leading-snug" :title="link.kind === 'external' ? link.target : undefined">{{ link.display }}</span></span><span class="text-single-sm-medium inline-flex shrink-0 items-center gap-1.5 text-text-subtle-default">Open <PhArrowSquareOut :size="17" /></span>
          </a></div><a :href="`${base}docs`" class="roadmap-action mt-3 flex h-10 items-center justify-center gap-2 rounded-lg border border-border-subtle-default bg-card/70 text-single-sm-medium text-text-primary-default hover:bg-card"><PhFileText :size="18" /> Browse source documents</a>
        </section>
        <section class="roadmap-panel rounded-[22px] p-4">
          <h2 class="font-display roadmap-title text-[1.35rem] leading-none">Item details</h2>
          <dl class="mt-4 grid grid-cols-[minmax(0,1fr)] gap-2.5">
            <div v-for="row in details" :key="row.label" class="flex items-baseline justify-between gap-4 border-b border-border-subtle-default pb-2.5 last:border-b-0 last:pb-0">
              <dt class="text-single-sm-medium text-text-subtle-default">{{ row.label }}</dt>
              <dd class="text-single-sm-medium text-text-primary-default text-right">
                <a v-if="'href' in row" :href="row.href" class="text-text-link-default hover:underline">{{ row.value }}</a>
                <time v-else-if="'datetime' in row" :datetime="row.datetime" :title="row.title">{{ row.value }}</time>
                <template v-else>{{ row.value }}</template>
              </dd>
            </div>
          </dl>
        </section>
      </aside>
    </div>
  </main>
</template>

<style scoped>
.item-page-hero { position:relative; margin-top:.625rem; padding:.625rem 0 .875rem; overflow:hidden; }
  .item-page-hero.has-cover { display:flex; min-height:clamp(190px,24vw,270px); margin-inline:-1.5rem; padding:2rem 1.5rem 1.5rem; align-items:flex-end; border-radius:16px; isolation:isolate; }
  .item-page-cover,.item-page-cover-treatment { position:absolute; inset:0; width:100%; height:100%; }
  .item-page-cover { z-index:-1; overflow:hidden; background:color-mix(in srgb,var(--roadmap-product-accent) 18%,var(--color-surface-subtle-default)); }
  .item-page-cover .roadmap-cover-fill,.item-page-cover .roadmap-cover-reveal { filter:saturate(.82) contrast(.94); }
  .item-page-cover-treatment { background:linear-gradient(to top,var(--roadmap-glass-bg) 0%,color-mix(in srgb,var(--roadmap-glass-bg) 96%,transparent) 18%,color-mix(in srgb,var(--roadmap-glass-bg) 62%,transparent) 52%,color-mix(in srgb,var(--roadmap-glass-bg) 14%,transparent) 100%),color-mix(in srgb,var(--roadmap-product-accent) 14%,transparent); }
  :global(:root[data-theme='dark']) .item-page-cover .roadmap-cover-fill,:global(:root[data-theme='dark']) .item-page-cover .roadmap-cover-reveal { filter:brightness(.7) saturate(.68) contrast(.92); }
  :global(:root[data-theme='dark']) .item-page-cover-treatment { background:linear-gradient(to top,var(--roadmap-glass-bg) 0%,color-mix(in srgb,var(--roadmap-glass-bg) 97%,transparent) 20%,color-mix(in srgb,var(--roadmap-glass-bg) 68%,transparent) 54%,color-mix(in srgb,var(--roadmap-glass-bg) 20%,transparent) 100%),color-mix(in srgb,var(--roadmap-product-accent) 20%,transparent); }
  .item-page-hero.is-completed .item-page-cover .roadmap-cover-fill,.item-page-hero.is-completed .item-page-cover .roadmap-cover-reveal { filter:grayscale(.28) saturate(.65) contrast(.94); }
  :global(:root[data-theme='dark']) .item-page-hero.is-completed .item-page-cover .roadmap-cover-fill,:global(:root[data-theme='dark']) .item-page-hero.is-completed .item-page-cover .roadmap-cover-reveal { filter:brightness(.72) grayscale(.3) saturate(.52) contrast(.92); }
  .item-page-hero-copy { position:relative; display:grid; width:100%; grid-template-columns:40px minmax(0,1fr); gap:14px; align-items:start; }
  .item-page-hero.has-cover .item-page-hero-copy { width:fit-content; max-width:100%; padding:14px 16px; border:1px solid color-mix(in srgb,var(--color-border-subtle-default) 72%,transparent); border-radius:13px; background:color-mix(in srgb,var(--color-card) 92%,transparent); box-shadow:0 12px 32px rgb(10 14 20 / 18%),inset 0 1px 0 rgb(255 255 255 / 20%); -webkit-backdrop-filter:blur(12px) saturate(.86); backdrop-filter:blur(12px) saturate(.86); }
  :global(:root[data-theme='dark']) .item-page-hero.has-cover .item-page-hero-copy { border-color:rgb(255 255 255 / 14%); background:color-mix(in srgb,var(--color-card) 90%,transparent); box-shadow:0 14px 36px rgb(0 0 0 / 34%),inset 0 1px 0 rgb(255 255 255 / 7%); }
  .item-page-hero h1 { max-width:30ch; margin:0; font-size:clamp(1.8rem,3vw,2.5rem); line-height:1.06; }
  .item-page-status-summary { display:flex; flex-wrap:wrap; gap:10px clamp(24px,4vw,48px); margin:0; padding:14px 0 2px; border-top:1px solid var(--color-border-subtle-default); }
  .item-page-status-summary dt { color:var(--color-text-subtle-default); font-size:11px; font-weight:600; line-height:1.3; }
  .item-page-status-summary dd { display:flex; align-items:center; gap:7px; margin:4px 0 0; color:var(--color-text-primary-default); font-size:14px; font-weight:600; line-height:1.35; }
  .item-page-status-summary dd span { width:4px; height:16px; border-radius:999px; }
  @media (max-width:639px) {
    .item-page-hero.has-cover { min-height:165px; margin-inline:-1rem; padding:1.5rem 1rem 1.125rem; }
    .item-page-hero-copy { grid-template-columns:1fr; }
    .item-page-hero-copy :global(.product-mark) { display:none; }
    .item-page-hero h1 { font-size:clamp(1.7rem,8vw,2.1rem); }
    .item-page-status-summary { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); }
  }
  @media (prefers-reduced-transparency:reduce) { .item-page-hero.has-cover .item-page-hero-copy { background:color-mix(in srgb,var(--color-card) 98%,transparent);-webkit-backdrop-filter:none;backdrop-filter:none; } }
  @media (prefers-contrast:more) { .item-page-hero.has-cover .item-page-hero-copy { border-color:var(--color-text-primary-default);background:var(--color-card);box-shadow:none; } }
</style>
