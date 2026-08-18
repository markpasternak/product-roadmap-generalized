<script setup lang="ts">
import { computed } from 'vue';
import { cn } from '../../lib/utils';
import type { Tone } from '../../lib/display';

const props = withDefaults(defineProps<{ tone?: Tone; class?: string }>(), { tone: 'gray' });

const toneClass: Record<Tone, string> = {
  gray: 'bg-surface-subtle-default text-text-subtle-default',
  blue: 'bg-surface-transparent-blue-25 text-text-primary-default',
  violet: 'bg-surface-transparent-violet-25 text-text-primary-default',
  green: 'bg-surface-transparent-green-25 text-text-primary-default',
  orange: 'bg-surface-transparent-orange-25 text-text-primary-default',
  red: 'bg-surface-transparent-red-25 text-text-primary-default',
  yellow: 'bg-surface-transparent-yellow-25 text-text-primary-default',
};

const cls = computed(() =>
  cn(
    'inline-flex items-center rounded-full px-2.5 py-0.5 text-single-sm-medium whitespace-nowrap',
    toneClass[props.tone],
    props.class,
  ),
);
</script>

<template>
  <span :class="cls"><slot /></span>
</template>
