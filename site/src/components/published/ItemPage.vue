<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { PhCaretLeft, PhCaretRight, PhLink } from "@phosphor-icons/vue";
import ItemReader from "../item/ItemReader.vue";
import { productColor } from "../../lib/display";
import { productSlug } from "../../lib/slugs";
import { installItemImageViewer } from "../../lib/itemImageViewer";
import { installItemToc } from "../../lib/itemToc";
import { installItemHeader } from "../../lib/itemHeader";
import "../../styles/image-viewer.css";
import "../../styles/item-toc.css";
import "../../styles/reading-toolbar.css";
import type { PublishedModel } from "../../lib/published/model";

const props = defineProps<{
  model: PublishedModel;
  id: string;
  base: string;
  audience: "internal" | "public";
}>();
const item = computed(() =>
  props.model.boardItems.find((item) => item.id === props.id),
);
const previous = computed(
  () =>
    props.model.boardItems[
      props.model.boardItems.findIndex((item) => item.id === props.id) - 1
    ],
);
const next = computed(
  () =>
    props.model.boardItems[
      props.model.boardItems.findIndex((item) => item.id === props.id) + 1
    ],
);
const panel = ref<HTMLElement>();
let viewer: ReturnType<typeof installItemImageViewer> | undefined;
let toc: ReturnType<typeof installItemToc> | undefined;
let header: ReturnType<typeof installItemHeader> | undefined;
let mounted = false;
let navigationObserver: ResizeObserver | undefined;
function cleanup() {
  viewer?.destroy();
  toc?.destroy();
  header?.destroy();
  viewer = undefined;
  toc = undefined;
  header = undefined;
}
function installReader() {
  if (!mounted) return;
  cleanup();
  if (!panel.value) return;
  viewer = installItemImageViewer(panel.value);
  toc = installItemToc(panel.value);
  header = installItemHeader(panel.value);
}
onMounted(() => {
  mounted = true;
  installReader();
  const navigation = document.querySelector<HTMLElement>('.site-navbar');
  if (navigation && typeof ResizeObserver !== 'undefined') {
    const resize = () => panel.value?.style.setProperty('--item-page-navbar-height', `${navigation.getBoundingClientRect().height}px`);
    navigationObserver = new ResizeObserver(resize);
    navigationObserver.observe(navigation);
    resize();
  }
});
watch(
  () => [props.model, props.id],
  async () => {
    await nextTick();
    installReader();
  },
);
onUnmounted(() => {
  mounted = false;
  navigationObserver?.disconnect();
  cleanup();
});
</script>

<template>
  <main v-if="!item" class="mx-auto max-w-3xl p-6">
    <h1>Item unavailable</h1>
    <p>This item is no longer part of the published roadmap.</p>
    <a :href="base">Return to roadmap</a>
  </main>
  <div v-else class="detail-expanded">
    <main
      ref="panel"
      class="item-page-shell roadmap-field roadmap-drawer-field roadmap-product-detail"
      data-item-page
      :style="{
        '--roadmap-product-accent':
          productColor[item.product as keyof typeof productColor],
      }"
      :data-prev-href="previous ? `${base}item/${previous.id}` : undefined"
      :data-next-href="next ? `${base}item/${next.id}` : undefined"
    >
      <div class="item-toolbar">
        <span class="item-toolbar-title"
          ><span class="item-product-accent" /><span class="item-toolbar-copy"
            ><a
              class="item-header-product"
              :href="`${base}${productSlug(item.product)}/`"
              >{{ item.product }}</a
            ><span
              class="item-header-title"
              data-header-title
              aria-hidden="true"
              >{{ item.title }}</span
            ></span
          ></span
        >
        <div class="item-toolbar-controls">
          <div
            class="item-control-group"
            role="group"
            aria-label="Item navigation"
          >
            <a
              v-if="previous"
              :href="`${base}item/${previous.id}`"
              :aria-label="`Previous item: ${previous.title}`"
              :title="`Previous: ${previous.title}`"
              class="item-control"
              ><PhCaretLeft :size="17"
            /></a>
            <a
              v-if="next"
              :href="`${base}item/${next.id}`"
              :aria-label="`Next item: ${next.title}`"
              :title="`Next: ${next.title}`"
              class="item-control"
              ><PhCaretRight :size="17"
            /></a>
          </div>
          <button type="button" data-copy-link class="item-page-copy">
            <PhLink :size="18" /><span data-copy-label>Copy link</span>
          </button>
        </div>
      </div>
      <div class="item-page-scroll" data-reading-scroll>
        <ItemReader
          :item="item"
          :base="base"
          :public="audience === 'public'"
          expanded
          standalone
        >
          <template #status
            ><p
              data-copy-status
              role="status"
              class="mt-2 text-sm text-text-subtle-default empty:hidden"
          /></template>
        </ItemReader>
      </div>
    </main>
  </div>
</template>

<style scoped>
.item-page-shell {
  display: flex;
  flex-direction: column;
  height: calc(100dvh - var(--item-page-navbar-height, 64px));
  min-height: 320px;
}
.item-page-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.item-page-copy {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 36px;
  padding: 0 10px;
  border-radius: 7px;
  color: var(--roadmap-ink-muted);
  font-size: 13px;
  cursor: pointer;
}
.item-page-copy:hover {
  background: color-mix(in srgb, var(--roadmap-ink) 6%, transparent);
}
.item-page-copy:focus-visible {
  outline: 2px solid var(--color-accent-brand-default);
  outline-offset: 2px;
}
</style>
