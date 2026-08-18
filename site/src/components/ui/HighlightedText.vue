<script setup lang="ts">
import { computed } from 'vue';
import { searchTerms } from '../../lib/filters';

const props = defineProps<{ text: string; query?: string }>();

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const segments = computed(() => {
  const terms = searchTerms(props.query ?? '').filter(Boolean).sort((a, b) => b.length - a.length);
  if (!props.text || !terms.length) return [{ text: props.text, mark: false }];
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi');
  const parts: { text: string; mark: boolean }[] = [];
  let lastIndex = 0;
  for (const match of props.text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) parts.push({ text: props.text.slice(lastIndex, index), mark: false });
    parts.push({ text: match[0], mark: true });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < props.text.length) parts.push({ text: props.text.slice(lastIndex), mark: false });
  return parts.length ? parts : [{ text: props.text, mark: false }];
});
</script>

<template>
  <template v-for="(segment, i) in segments" :key="i">
    <mark v-if="segment.mark" class="roadmap-search-mark">{{ segment.text }}</mark>
    <span v-else>{{ segment.text }}</span>
  </template>
</template>

<style scoped>
.roadmap-search-mark {
  background-color: var(--color-surface-transparent-orange-25);
  background: color-mix(in srgb, var(--color-accent-brand-default) 22%, transparent);
  color: inherit;
}
</style>
