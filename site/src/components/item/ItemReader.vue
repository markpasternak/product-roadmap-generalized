<script setup lang="ts">
import { computed, ref, onMounted, watch } from "vue";
import PlannedDates from "../board/PlannedDates.vue";
import ItemLabels from "../board/ItemLabels.vue";
import RichMarkdown from "../markdown/RichMarkdown.vue";
import ImageThumbnail from "../markdown/ImageThumbnail.vue";
import {
  PhArrowSquareOut,
  PhGithubLogo,
  PhUser,
  PhCalendarBlank,
  PhStack,
} from "@phosphor-icons/vue";
import { namedOwner } from "../../lib/cardMetadata";
import { horizonDot, toneSurfaceStrong, toneText } from "../../lib/display";
import { coverPresentationStyle } from "../../lib/coverPresentation";
import { resourcePreviewURLs } from "../../lib/edit/resourceClient";
import {
  isImageResource,
  repositoryAssetPath,
  resourceHref,
} from "../../lib/resources";
import { linkSource, linkDisplay } from "../../lib/sources";
import { formatDateTime, formatDateTimeOrDate } from "../../lib/dates";
import { itemReaderContent } from "../../lib/itemReader";
import type { ItemVM } from "../../lib/filters";

const props = withDefaults(
  defineProps<{
    item: ItemVM;
    expanded?: boolean;
    standalone?: boolean;
    client?: boolean;
    public?: boolean;
    base?: string;
  }>(),
  { base: "/" },
);
const hideInternal = computed(() => props.client || props.public);
const content = computed(() => itemReaderContent(props.item, props.client));
const storyBlocks = computed(() => content.value.sections);
const expandedSections = ref(new Set<number>());
function isLongSection(text: string) {
  return text.trim().length > 420;
}
function sectionExpanded(index: number) {
  return props.expanded || expandedSections.value.has(index);
}
function toggleSection(index: number) {
  const next = new Set(expandedSections.value);
  if (next.has(index)) next.delete(index);
  else next.add(index);
  expandedSections.value = next;
}
watch(
  () => props.item.id,
  () => {
    expandedSections.value = new Set();
  },
);
const detailCoverSrc = computed(() => {
  if (!props.item.cover) return "";
  const path = repositoryAssetPath(props.item.cover);
  return (
    (path && resourcePreviewURLs.value[path]) ||
    resourceHref(props.item.cover, props.base)
  );
});
const detailCoverStyle = computed(() =>
  coverPresentationStyle(props.item.coverPosition, props.item.coverFraming),
);
const decoratedLinks = computed(() =>
  props.item.links.map((ln) => ({
    ...ln,
    src: linkSource(ln.label, ln.target),
    display: linkDisplay(ln.label, ln.target, ln.title),
  })),
);
const label =
  "text-single-sm-medium font-semibold uppercase tracking-wide text-text-subtle-default";
const mounted = ref(false);
onMounted(() => {
  mounted.value = true;
});
const dateOptions = computed(() =>
  mounted.value ? {} : { timeZone: "UTC", suffix: "UTC" },
);
const historyValue = (at?: string, date?: string) =>
  formatDateTimeOrDate(at, date, dateOptions.value);
const historyDatetime = (at?: string, date?: string) => at || date || "";
const historyTitle = (at?: string, by?: string, subject?: string) =>
  [at ? formatDateTime(at, dateOptions.value) : "", by, subject]
    .filter(Boolean)
    .join(" · ");
const tagFilterHref = (tag: string) =>
  `${props.base}?${new URLSearchParams({ tag })}`;
</script>

<template>
  <div
    class="item-reader drawer-reading-content px-4 pb-5 sm:px-6 sm:pb-6"
    :class="{ 'is-expanded': expanded }"
    data-item-reader
  >
    <header
      class="detail-masthead"
      :class="{
        'has-cover': detailCoverSrc,
        'is-completed': item.horizon === 'Completed',
      }"
    >
      <div
        v-if="detailCoverSrc"
        class="detail-cover-media roadmap-cover-media"
        :style="detailCoverStyle"
        aria-hidden="true"
      >
        <img
          class="roadmap-cover-backdrop"
          :src="detailCoverSrc"
          alt=""
          decoding="async"
        />
        <img
          class="roadmap-cover-fill"
          :src="detailCoverSrc"
          alt=""
          decoding="async"
        />
        <img
          class="roadmap-cover-reveal"
          :src="detailCoverSrc"
          alt=""
          decoding="async"
        />
        <span class="detail-cover-treatment" />
      </div>
      <div class="detail-masthead-copy min-w-0">
        <component
          :is="standalone ? 'h1' : 'h2'"
          data-reading-title
          :id="standalone ? 'item-title' : 'drawer-title'"
          tabindex="-1"
          aria-live="polite"
          class="roadmap-display roadmap-title text-[1.75rem] sm:text-[2.1rem]"
        >
          {{ item.title }}
        </component>
        <PlannedDates :start-date="item.startDate" :end-date="item.endDate" />
      </div>
    </header>

    <div class="detail-summary">
      <dl class="detail-status-summary">
        <div>
          <dt>Horizon</dt>
          <dd>
            <span
              class="detail-status-dot"
              :style="{
                background: horizonDot[item.horizon as keyof typeof horizonDot],
              }"
            />{{ item.horizon }}
          </dd>
        </div>
        <div>
          <dt>Stage</dt>
          <dd>{{ item.stage }}</dd>
        </div>
        <div v-if="!hideInternal">
          <dt>Impact</dt>
          <dd>{{ item.impact || "Not scored" }}</dd>
        </div>
        <div v-if="!hideInternal">
          <dt>Effort</dt>
          <dd>{{ item.effort || "Not scoped" }}</dd>
        </div>
        <div v-if="!hideInternal">
          <dt>Visibility</dt>
          <dd>{{ item.visibility }}</dd>
        </div>
      </dl>

      <div class="detail-utility-row">
        <p class="detail-provenance roadmap-muted">
          <span
            v-if="namedOwner(item.owner) && !hideInternal"
            class="inline-flex items-center gap-2"
          >
            <PhUser :size="17" /> {{ item.owner }}
          </span>
          <span
            v-if="historyValue(item.updatedAt, item.updated) && !hideInternal"
            class="inline-flex items-center gap-2"
          >
            <PhCalendarBlank :size="17" /> Updated
            <time
              :datetime="historyDatetime(item.updatedAt, item.updated)"
              :title="
                historyTitle(
                  item.updatedAt,
                  item.updatedBy,
                  item.updatedSubject,
                )
              "
            >
              {{ historyValue(item.updatedAt, item.updated) }}
            </time>
          </span>
          <span
            v-if="item.links.length && !hideInternal"
            class="inline-flex items-center gap-2"
          >
            <PhStack :size="17" /> {{ item.links.length }} resources
          </span>
        </p>

        <div v-if="!hideInternal" class="detail-actions">
          <a
            v-if="!standalone && item.href"
            :href="item.href"
            class="roadmap-action detail-action"
          >
            Open full page <PhArrowSquareOut :size="18" />
          </a>
          <a
            v-if="item.editUrl"
            :href="item.editUrl"
            target="_blank"
            rel="noopener"
            class="roadmap-action detail-action"
            title="Open this item's markdown file in GitHub's editor"
          >
            <PhGithubLogo :size="18" class="text-icons-subtle-default" /> Edit
            on GitHub
          </a>
        </div>
      </div>
    </div>

    <ItemLabels
      :item="item"
      :client="hideInternal"
      :href="tagFilterHref"
      class="detail-labels"
    />

    <slot name="status" />

    <div class="detail-reading-grid" data-reading-layout>
      <div data-reading-body>
        <slot />

        <RichMarkdown
          v-if="content.preamble"
          :markdown="content.preamble"
          :base="base"
          :overrides="resourcePreviewURLs"
          class="mt-5"
        />
        <RichMarkdown
          v-if="content.introduction && content.hasSource"
          :markdown="content.introduction"
          :base="base"
          :overrides="resourcePreviewURLs"
          class="item-introduction mt-5"
        />
        <p
          v-else-if="content.introduction"
          class="mt-5 max-w-4xl text-base leading-relaxed text-text-primary-default"
        >
          {{ content.introduction }}
        </p>

        <div v-if="storyBlocks.length" class="mt-5 space-y-4">
          <section
            v-for="(s, index) in storyBlocks"
            :key="`${s.heading}-${index}`"
            class="item-reading-section item-section-surface"
            :class="{
              'item-section-preview':
                isLongSection(s.text) && !sectionExpanded(index),
            }"
          >
            <div
              :class="{
                'item-section-body-collapsed':
                  isLongSection(s.text) && !sectionExpanded(index),
              }"
            >
              <component
                :is="standalone ? 'h2' : 'h3'"
                class="roadmap-section-heading"
                data-toc-heading
                >{{ s.heading }}</component
              >
              <RichMarkdown
                v-if="s.markdown && !client"
                :markdown="s.markdown"
                :base="base"
                :overrides="resourcePreviewURLs"
                class="mt-1.5"
              />
              <p
                v-else
                class="mt-1.5 whitespace-pre-line text-base leading-relaxed text-text-primary-default"
              >
                {{ s.text }}
              </p>
            </div>
            <button
              v-if="isLongSection(s.text) && !expanded"
              type="button"
              class="item-section-toggle roadmap-action"
              :aria-expanded="sectionExpanded(index)"
              @click="toggleSection(index)"
            >
              {{ sectionExpanded(index) ? "Show less" : "Continue reading" }}
            </button>
          </section>
        </div>

        <p
          v-if="historyValue(item.createdAt, item.created) && !hideInternal"
          class="detail-created roadmap-muted"
        >
          Created
          <time
            :datetime="historyDatetime(item.createdAt, item.created)"
            :title="
              historyTitle(item.createdAt, item.createdBy, item.createdSubject)
            "
            >{{ historyValue(item.createdAt, item.created) }}</time
          >
        </p>

        <div
          v-if="decoratedLinks.length && !hideInternal && !content.hasSource"
          class="mt-5"
        >
          <h3 :class="label" data-toc-heading>Related resources</h3>
          <div class="resource-reading-grid mt-3">
            <a
              v-for="ln in decoratedLinks"
              :key="ln.href"
              :href="ln.href"
              :target="
                ln.kind === 'external' || ln.kind === 'presentation'
                  ? '_blank'
                  : undefined
              "
              :rel="
                ln.kind === 'external' || ln.kind === 'presentation'
                  ? 'noopener'
                  : undefined
              "
              class="roadmap-panel roadmap-action resource-reading-card flex items-center gap-3 rounded-xl px-3 py-2.5"
              :class="{
                'resource-reading-card-image':
                  ln.image || isImageResource(ln.target),
              }"
            >
              <ImageThumbnail
                v-if="ln.image || isImageResource(ln.target)"
                :href="ln.target"
                :alt="ln.title || ln.label"
              />
              <span
                v-else
                class="grid size-10 shrink-0 place-items-center rounded-lg"
                :style="{
                  background: toneSurfaceStrong[ln.src.tone],
                  color: toneText[ln.src.tone],
                }"
              >
                <component :is="ln.src.Icon" :size="20" />
              </span>
              <span class="min-w-0 flex-1">
                <span
                  class="text-single-sm-medium block truncate font-semibold uppercase tracking-wider"
                  :style="{ color: toneText[ln.src.tone] }"
                >
                  {{ ln.label }}
                </span>
                <span
                  class="resource-reading-title text-single-base-medium text-text-primary-default block"
                  :title="ln.display"
                >
                  {{ ln.display }}
                </span>
              </span>
              <span class="resource-reading-open"
                ><span>Open</span><PhArrowSquareOut :size="18"
              /></span>
            </a>
          </div>
        </div>
      </div>
      <nav
        class="item-toc"
        data-item-toc
        aria-label="On this page"
        hidden
      ></nav>
    </div>
  </div>
</template>

<style scoped>
.drawer-reading-content {
  padding-top: 12px;
}
.item-reader.is-expanded {
  width: 100%;
  max-width: 1200px;
  margin-inline: auto;
}
.item-reader.is-expanded :deep(.item-reading-section p) {
  max-width: 75ch;
}
.detail-masthead {
  position: relative;
  padding: 10px 0 18px;
  overflow: hidden;
}
.detail-masthead.has-cover {
  display: flex;
  min-height: 210px;
  margin: -12px -1rem 0;
  padding: 28px 1rem 22px;
  align-items: flex-end;
  isolation: isolate;
}
.detail-cover-media,
.detail-cover-treatment {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.detail-cover-media {
  z-index: -1;
  overflow: hidden;
  background: color-mix(
    in srgb,
    var(--roadmap-product-accent) 18%,
    var(--color-surface-subtle-default)
  );
}
.detail-cover-media .roadmap-cover-fill,
.detail-cover-media .roadmap-cover-reveal {
  filter: saturate(0.82) contrast(0.94);
}
.detail-cover-treatment {
  background:
    linear-gradient(
      to top,
      var(--color-card) 0%,
      color-mix(in srgb, var(--color-card) 96%, transparent) 18%,
      color-mix(in srgb, var(--color-card) 62%, transparent) 52%,
      color-mix(in srgb, var(--color-card) 14%, transparent) 100%
    ),
    color-mix(in srgb, var(--roadmap-product-accent) 14%, transparent);
}
:global(:root[data-theme="dark"]) .detail-cover-media .roadmap-cover-fill,
:global(:root[data-theme="dark"]) .detail-cover-media .roadmap-cover-reveal {
  filter: brightness(0.7) saturate(0.68) contrast(0.92);
}
:global(:root[data-theme="dark"]) .detail-cover-treatment {
  background:
    linear-gradient(
      to top,
      var(--color-card) 0%,
      color-mix(in srgb, var(--color-card) 97%, transparent) 20%,
      color-mix(in srgb, var(--color-card) 68%, transparent) 54%,
      color-mix(in srgb, var(--color-card) 20%, transparent) 100%
    ),
    color-mix(in srgb, var(--roadmap-product-accent) 20%, transparent);
}
.detail-masthead.is-completed .detail-cover-media .roadmap-cover-fill,
.detail-masthead.is-completed .detail-cover-media .roadmap-cover-reveal {
  filter: grayscale(0.28) saturate(0.65) contrast(0.94);
}
:global(:root[data-theme="dark"])
  .detail-masthead.is-completed
  .detail-cover-media
  .roadmap-cover-fill,
:global(:root[data-theme="dark"])
  .detail-masthead.is-completed
  .detail-cover-media
  .roadmap-cover-reveal {
  filter: brightness(0.72) grayscale(0.3) saturate(0.52) contrast(0.92);
}
.detail-masthead-copy {
  position: relative;
  width: 100%;
  max-width: 960px;
}
.detail-masthead.has-cover .detail-masthead-copy {
  width: fit-content;
  max-width: min(100%, 960px);
  padding: 14px 16px;
  border: 1px solid
    color-mix(in srgb, var(--color-border-subtle-default) 72%, transparent);
  border-radius: 13px;
  background:
    linear-gradient(
      135deg,
      color-mix(in srgb, var(--roadmap-product-accent) 7%, transparent),
      transparent 62%
    ),
    color-mix(in srgb, var(--color-card) 78%, transparent);
  box-shadow:
    0 12px 32px rgb(10 14 20 / 20%),
    inset 0 1px 0 rgb(255 255 255 / 28%);
  -webkit-backdrop-filter: blur(14px) saturate(0.78);
  backdrop-filter: blur(14px) saturate(0.78);
}
:global(:root[data-theme="dark"])
  .detail-masthead.has-cover
  .detail-masthead-copy {
  border-color: rgb(255 255 255 / 14%);
  background:
    linear-gradient(
      135deg,
      color-mix(in srgb, var(--roadmap-product-accent) 9%, transparent),
      transparent 62%
    ),
    color-mix(in srgb, var(--color-card) 76%, transparent);
  box-shadow:
    0 14px 36px rgb(0 0 0 / 36%),
    inset 0 1px 0 rgb(255 255 255 / 10%);
}
.detail-masthead .roadmap-title {
  max-width: 28ch;
  font-size: clamp(1.75rem, 2.6vw, 2.25rem);
  line-height: 1.08;
}
.detail-summary {
  padding: 14px 0;
  border-bottom: 1px solid var(--color-border-subtle-default);
}
.detail-status-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 10px clamp(24px, 4vw, 48px);
  margin: 0;
}
.detail-status-summary dt {
  color: var(--color-text-subtle-default);
  font-size: 11px;
  font-weight: 600;
  line-height: 1.3;
}
.detail-status-summary dd {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 4px 0 0;
  color: var(--color-text-primary-default);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.35;
}
.detail-status-dot {
  width: 4px;
  height: 16px;
  border-radius: 999px;
}
.detail-utility-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px 20px;
  margin-top: 13px;
  padding-top: 12px;
  border-top: 1px solid
    color-mix(in srgb, var(--color-border-subtle-default) 72%, transparent);
}
.detail-provenance {
  display: flex;
  flex: 1 1 360px;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px 18px;
  margin: 0;
  font-size: 13px;
}
.detail-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.detail-action {
  display: inline-flex;
  min-height: 34px;
  align-items: center;
  gap: 7px;
  padding: 0 9px;
  border-radius: 7px;
  color: var(--color-text-subtle-default);
  font-size: 13px;
  font-weight: 500;
}
.detail-action:hover {
  color: var(--color-text-primary-default);
  background: color-mix(in srgb, var(--roadmap-ink) 6%, transparent);
}
.detail-reading-grid {
  margin-top: 20px;
}
.detail-created {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin: 24px 0 0;
  font-size: 12px;
}
.detail-created time {
  color: var(--color-text-primary-default);
}
.item-reader.is-expanded .detail-masthead.has-cover {
  min-height: clamp(190px, 26vh, 260px);
}
.item-reader.is-expanded .detail-masthead .roadmap-title {
  max-width: 30ch;
  font-size: clamp(2rem, 3.2vw, 2.5rem);
  line-height: 1.06;
}
@media (min-width: 640px) {
  .detail-masthead.has-cover {
    margin-inline: -1.5rem;
    padding-inline: 1.5rem;
  }
}
@media (max-width: 560px) {
  .detail-masthead.has-cover {
    min-height: 165px;
  }
  .detail-masthead .roadmap-title {
    font-size: clamp(1.7rem, 8vw, 2.1rem);
  }
  .detail-status-summary {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    width: 100%;
  }
  .detail-utility-row {
    align-items: flex-start;
  }
}
@media (prefers-reduced-transparency: reduce) {
  .detail-masthead.has-cover .detail-masthead-copy {
    background: color-mix(in srgb, var(--color-card) 98%, transparent);
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
}
@media (prefers-contrast: more) {
  .detail-masthead.has-cover .detail-masthead-copy {
    border-color: var(--color-text-primary-default);
    background: var(--color-card);
    box-shadow: none;
  }
}
</style>
