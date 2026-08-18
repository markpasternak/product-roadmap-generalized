<script setup lang="ts">
import { PhCaretRight } from '@phosphor-icons/vue';
defineProps<{ items: { label: string; href?: string }[] }>();
</script>

<template>
  <nav class="text-single-sm-medium text-text-subtle-default flex flex-wrap items-center gap-1.5">
    <template v-for="(it, i) in items" :key="i">
      <a v-if="it.href" :href="it.href" class="hover:text-text-primary-default">{{ it.label }}</a>
      <span v-else class="text-text-primary-default">{{ it.label }}</span>
      <PhCaretRight v-if="i < items.length - 1" :size="12" class="text-icons-subtle-default" />
    </template>
  </nav>
</template>
