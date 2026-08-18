<script setup lang="ts">
defineProps<{ text?: string }>();
</script>

<template>
  <div
    class="border-border-subtle-default text-single-sm-medium text-text-subtle-default rounded-xl border border-dashed px-4 py-6 text-center"
  >
    <slot>{{ text ?? 'Nothing here yet' }}</slot>
  </div>
</template>
