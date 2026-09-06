<script setup lang="ts">
import { cn } from '../../lib/utils';

defineProps<{
  lanes: { key: string; dot: string; items: unknown[] }[];
  activeKey: string | null;
}>();
defineEmits<{ (e: 'jump', key: string): void }>();
</script>

<template>
  <nav
    v-if="lanes.length > 1"
    class="lane-jump-bar bg-background/90 border-border-subtle-default/70 sticky top-[var(--roadmap-nav-height)] z-20 -mx-1 mb-3 overflow-x-auto border-y py-2 backdrop-blur md:hidden"
    aria-label="Roadmap lanes"
    data-test="lane-jump-bar"
  >
    <div class="flex w-max min-w-full gap-1.5 px-1">
      <button
        v-for="lane in lanes"
        :key="lane.key"
        type="button"
        :class="
          cn(
            'roadmap-action text-single-sm-medium inline-flex min-h-10 items-center gap-1.5 rounded-lg border px-2.5 transition-colors',
            activeKey === lane.key
              ? 'roadmap-selected-control border-[color:var(--lane-accent)] text-text-primary-default'
              : 'border-border-subtle-default bg-card/80 text-text-subtle-default hover:text-text-primary-default',
          )
        "
        :style="{ '--lane-accent': lane.dot }"
        :aria-current="activeKey === lane.key ? 'true' : undefined"
        @click="$emit('jump', lane.key)"
      >
        <span class="size-2 rounded-full bg-[color:var(--lane-accent)]" aria-hidden="true" />
        <span>{{ lane.key }}</span>
        <span class="tabular-nums">{{ lane.items.length }}</span>
      </button>
    </div>
  </nav>
</template>
