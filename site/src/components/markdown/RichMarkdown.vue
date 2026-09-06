<script setup lang="ts">
import { computed } from "vue";
import { renderRichMarkdown } from "../../lib/richMarkdown";
defineOptions({ inheritAttrs: true });
const props = withDefaults(
  defineProps<{
    markdown: string;
    base?: string;
    overrides?: Record<string, string>;
  }>(),
  { base: "/", overrides: () => ({}) },
);
const html = computed(() =>
  renderRichMarkdown(props.markdown, props.base, props.overrides),
);
</script>
<template><div class="resource-markdown" v-html="html" /></template>
