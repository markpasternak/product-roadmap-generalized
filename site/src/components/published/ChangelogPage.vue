<script setup lang="ts">
import { computed } from 'vue';
import Breadcrumb from '../ui/Breadcrumb.vue';
import ProductMark from '../ui/ProductMark.vue';
import { horizonDot } from '../../lib/display';
import { formatDateOnly } from '../../lib/dates';
import type { PublishedContent } from '../../lib/published/model';
const props = defineProps<{ model: PublishedContent; base: string }>();
const groups = computed(() => {
  const groups: { date: string; items: PublishedContent['boardItems'] }[] = [];
  const items = props.model.boardItems.filter(item => item.updated).sort((a, b) => b.updated.localeCompare(a.updated) || a.id.localeCompare(b.id));
  for (const item of items) {
    const last = groups.at(-1);
    if (last?.date === item.updated) last.items.push(item);
    else groups.push({ date: item.updated, items: [item] });
  }
  return groups;
});
</script>

<template>
  <main class="page-reveal mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
    <Breadcrumb :items="[{ label: 'Roadmap', href: base }, { label: 'Activity' }]" />
    <h1 class="font-display text-text-primary-default mt-6 text-[2rem] sm:text-[2.4rem]">Activity — item updates</h1>
    <p class="text-body-md text-text-subtle-default mt-2 max-w-xl">The most recent change to each roadmap item, grouped by date.</p>
    <nav class="border-border-subtle-default bg-card mt-5 inline-flex rounded-full border p-0.5" aria-label="Activity views">
      <a :href="`${base}changelog`" aria-current="page" class="text-single-sm-medium bg-foreground text-text-primary-inverted-default rounded-full px-3.5 py-1.5 transition-colors">Item updates</a>
      <a :href="`${base}changes`" class="text-single-sm-medium text-text-subtle-default rounded-full px-3.5 py-1.5 transition-colors hover:text-text-primary-default">Commits</a>
    </nav>
    <section v-for="group in groups" :key="group.date" class="mt-8">
      <h2 class="text-single-sm-medium text-text-subtle-default mb-3 tracking-wide uppercase"><time :datetime="group.date">{{ formatDateOnly(group.date) }}</time></h2>
      <div class="flex flex-col gap-2">
        <a v-for="item in group.items" :key="item.id" :href="item.href" class="border-border-subtle-default bg-card hover:border-border-subtle-hover flex items-center gap-3 rounded-lg border px-4 py-3 shadow-sm transition duration-150 hover:shadow-md">
          <ProductMark :product="item.product" :size="30" />
          <span class="text-single-base-medium text-text-primary-default min-w-0 flex-1 whitespace-normal break-words">{{ item.title }}</span>
          <span class="text-single-sm-medium bg-surface-subtle-default text-text-primary-default hidden shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 sm:inline-flex"><span class="size-2 rounded-full" :style="{ background: horizonDot[item.horizon as keyof typeof horizonDot] }" />{{ item.horizon }}</span>
          <span class="text-single-sm-medium text-text-subtle-default hidden shrink-0 md:block">{{ item.stage }}</span>
        </a>
      </div>
    </section>
  </main>
</template>
