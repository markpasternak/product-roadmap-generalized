<script setup lang="ts">
defineProps<{ value: string | number; label: string; dot?: string }>();
</script>

<template>
  <div
    class="border-border-subtle-default bg-card inline-flex items-baseline gap-2 rounded-full border px-3.5 py-2"
  >
    <span v-if="dot" class="size-2 self-center rounded-full" :style="{ background: dot }" />
    <b class="text-body-md-semibold text-text-primary-default tabular-nums">{{ value }}</b>
    <span class="text-single-sm-medium text-text-subtle-default tracking-wide uppercase">{{ label }}</span>
  </div>
</template>
