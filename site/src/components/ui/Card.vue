<script setup lang="ts">
import { computed } from 'vue';
import { cn } from '../../lib/utils';

const props = defineProps<{ href?: string; interactive?: boolean; class?: string }>();
const tag = computed(() => (props.href ? 'a' : 'div'));
const cls = computed(() =>
  cn(
    'block rounded-xl border border-border-subtle-default bg-card p-4 shadow-sm',
    (props.interactive || props.href) &&
      'transition-all hover:-translate-y-0.5 hover:shadow-md cursor-pointer',
    props.interactive && 'hover:border-[color:var(--color-accent-brand-default)]',
    props.class,
  ),
);
</script>

<template>
  <component :is="tag" :href="href" :class="cls"><slot /></component>
</template>
