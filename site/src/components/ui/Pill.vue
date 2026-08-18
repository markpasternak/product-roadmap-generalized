<script setup lang="ts">
import { computed } from 'vue';
import { cn } from '../../lib/utils';

const props = defineProps<{ active?: boolean; class?: string }>();
const emit = defineEmits<{ (e: 'toggle'): void }>();

const cls = computed(() =>
  cn(
    'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-single-sm-medium whitespace-nowrap cursor-pointer transition-colors',
    props.active
      ? 'bg-foreground text-text-primary-inverted-default border-transparent'
      : 'bg-card text-text-subtle-default border-border-subtle-default hover:text-text-primary-default hover:border-border-subtle-hover',
    props.class,
  ),
);
</script>

<template>
  <button type="button" :class="cls" :aria-pressed="props.active ? 'true' : 'false'" @click="emit('toggle')">
    <slot />
  </button>
</template>
