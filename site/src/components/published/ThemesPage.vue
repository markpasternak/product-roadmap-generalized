<script setup lang="ts">
import { computed } from 'vue';
import Breadcrumb from '../ui/Breadcrumb.vue';
import ProductMark from '../ui/ProductMark.vue';
import { horizonDot, toneSurface, toneText } from '../../lib/display';
import type { PublishedContent } from '../../lib/published/model';
const props = defineProps<{ model: PublishedContent; base: string }>();
const themes = computed(() => {
  const groups = new Map<string, PublishedContent['boardItems']>();
  for (const item of props.model.boardItems) for (const theme of item.themes) {
    const items = groups.get(theme) ?? [];
    items.push(item); groups.set(theme, items);
  }
  return [...groups].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
});
</script>

<template>
  <main class="page-reveal mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
    <Breadcrumb :items="[{ label: 'Roadmap', href: base }, { label: 'Themes' }]" />
    <h1 class="font-display text-text-primary-default mt-6 text-[2rem] sm:text-[2.4rem]">Themes</h1>
    <p class="text-body-md text-text-subtle-default mt-2 max-w-xl">The strategic bets the roadmap is organized around. A theme groups items across products and horizons.</p>
    <p v-if="!themes.length" class="border-border-subtle-default text-single-base-medium text-text-subtle-default mt-8 rounded-xl border border-dashed px-6 py-12 text-center">No themes yet. Tag items with <code>theme:&lt;name&gt;</code> to group them here.</p>
    <section v-for="[theme, items] in themes" :key="theme" class="mt-8">
      <h2 class="flex flex-wrap items-center gap-2.5">
        <span class="text-single-base-medium rounded-lg border border-border-subtle-default/60 px-2 py-0.5 font-semibold" :style="{ background: toneSurface.orange, color: toneText.orange }">{{ theme }}</span>
        <span class="text-single-sm-medium text-text-subtle-default tabular-nums">{{ items.length }} item{{ items.length === 1 ? '' : 's' }}</span>
        <a :href="`${base}?tag=theme%3A${encodeURIComponent(theme)}`" class="text-single-sm-medium text-text-link-default ml-auto inline-flex min-h-11 items-center hover:underline">View on board →</a>
      </h2>
      <div class="mt-3 flex flex-col gap-2">
        <a v-for="item in items" :key="item.id" :href="item.href" class="border-border-subtle-default bg-card hover:border-border-subtle-hover flex items-center gap-3 rounded-lg border px-4 py-3 shadow-sm transition duration-150 hover:shadow-md">
          <ProductMark :product="item.product" :size="30" />
          <span class="min-w-0 flex-1"><span class="text-single-base-medium text-text-primary-default block whitespace-normal break-words">{{ item.title }}</span><span v-if="item.oneliner" class="text-single-sm-medium text-text-subtle-default block whitespace-normal break-words">{{ item.oneliner }}</span></span>
          <span class="text-single-sm-medium bg-surface-subtle-default text-text-primary-default hidden shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 sm:inline-flex"><span class="size-2 rounded-full" :style="{ background: horizonDot[item.horizon as keyof typeof horizonDot] }" />{{ item.horizon }}</span>
        </a>
      </div>
    </section>
  </main>
</template>
