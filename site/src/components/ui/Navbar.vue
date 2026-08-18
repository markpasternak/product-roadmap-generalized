<script setup lang="ts">
import BrandMark from './BrandMark.vue';
import { computed, onMounted, ref } from 'vue';
import { PhSun, PhMoon, PhRoadHorizon, PhFiles, PhInfo, PhShareNetwork } from '@phosphor-icons/vue';
import Avatar from './Avatar.vue';
import { getCanvasdrop, type Me } from '../../lib/share/canvasdrop';

const props = defineProps<{ base: string; active?: 'roadmap' | 'shares' | 'docs' | 'help' }>();
const author = ref<Me | null>(null);
const authorName = computed(() => author.value?.name || author.value?.email || 'Signed-in author');

function toggle() {
  const current = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem('rm-theme', next);
  } catch {
    /* ignore */
  }
}

onMounted(async () => {
  const cd = getCanvasdrop();
  if (!cd) return;
  try {
    author.value = await cd.me();
  } catch {
    author.value = null;
  }
});

// Below sm the labels hide (icon-only) so all four nav items fit without overflowing;
// the accessible name is kept via aria-label on each link.
const link =
  'roadmap-action relative inline-flex h-10 items-center gap-2 border-b-2 px-2.5 sm:px-3.5 text-single-base-medium transition-colors';
const activeCls = 'border-[color:var(--color-accent-brand-default)] text-[color:var(--color-accent-brand-default)]';
const idleCls = 'border-transparent text-text-primary-default hover:text-[color:var(--color-accent-brand-default)]';
</script>

<template>
  <header class="site-navbar border-border-subtle-default/70 bg-card/82 sticky top-0 z-40 border-b backdrop-blur-xl">
    <div class="mx-auto grid h-12 max-w-[1680px] grid-cols-[auto_1fr_auto] items-center px-4 sm:px-7">
      <a
        :href="base"
        class="flex h-full items-center gap-2.5 border-r border-border-subtle-default/70 pr-5"
        aria-label="Product Roadmap"
      >
        <BrandMark :size="24" class="shrink-0" />
        <span class="font-display text-text-primary-default text-[0.95rem] leading-none tracking-tight max-sm:hidden">
          Roadmap
        </span>
      </a>
      <nav class="flex h-full min-w-0 items-center px-1 sm:px-4" aria-label="Primary">
        <a :href="base" aria-label="Roadmap" title="Roadmap" :class="[link, active === 'roadmap' ? activeCls : idleCls]"
          ><PhRoadHorizon :size="18" class="shrink-0" /><span class="max-sm:hidden">Roadmap</span></a
        >
        <a :href="base + 'shares'" aria-label="Shares" title="Shares" :class="[link, active === 'shares' ? activeCls : idleCls]"
          ><PhShareNetwork :size="18" class="shrink-0" /><span class="max-sm:hidden">Shares</span></a
        >
        <a :href="base + 'docs'" aria-label="Docs" title="Docs" :class="[link, active === 'docs' ? activeCls : idleCls]"
          ><PhFiles :size="18" class="shrink-0" /><span class="max-sm:hidden">Docs</span></a
        >
        <a :href="base + 'help'" aria-label="Help" title="Help" :class="[link, active === 'help' ? activeCls : idleCls]"
          ><PhInfo :size="18" class="shrink-0" /><span class="max-sm:hidden">Help</span></a
        >
      </nav>
      <div class="flex items-center justify-end gap-2">
        <div
          v-if="author"
          class="border-border-subtle-default/80 bg-card text-single-sm-medium text-text-primary-default flex h-9 max-w-[180px] items-center gap-2 rounded-lg border px-2"
          :title="'Signed in as ' + authorName"
        >
          <Avatar :name="authorName" :size="24" />
          <span class="hidden truncate lg:inline">{{ authorName }}</span>
        </div>
        <button
          class="roadmap-action text-text-subtle-default hover:text-text-primary-default hover:bg-surface-primary-hover grid size-9 place-items-center rounded-lg border border-border-subtle-default/80 bg-card"
          aria-label="Toggle theme"
          @click="toggle"
        >
          <PhMoon class="theme-icon-light" :size="18" />
          <PhSun class="theme-icon-dark" :size="18" />
        </button>
      </div>
    </div>
  </header>
</template>
