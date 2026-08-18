<script setup lang="ts">
import { computed } from 'vue';
import { cn } from '../../lib/utils';

type Variant = 'primary' | 'outline' | 'ghost';
const props = withDefaults(
  defineProps<{ variant?: Variant; href?: string; class?: string }>(),
  { variant: 'primary' },
);

const variants: Record<Variant, string> = {
  primary: 'bg-accent-primary-default text-text-primary-inverted-default hover:bg-accent-primary-hover',
  outline: 'border border-border-subtle-default text-text-primary-default hover:bg-surface-primary-hover',
  ghost: 'text-text-primary-default hover:bg-surface-primary-hover',
};

const cls = computed(() =>
  cn(
    'inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md px-3 text-single-base-medium transition-colors',
    variants[props.variant],
    props.class,
  ),
);
</script>

<template>
  <a v-if="href" :href="href" :class="cls"><slot /></a>
  <button v-else type="button" :class="cls"><slot /></button>
</template>
