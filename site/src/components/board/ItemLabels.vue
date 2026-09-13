<script setup lang="ts">
import { computed } from 'vue';
import { itemLabels } from '../../lib/cardMetadata';
import '../../styles/item-labels.css';
const props = defineProps<{
  item: { tags: string[]; themes: string[] };
  client?: boolean;
  preview?: boolean;
  href?: (token: string) => string;
}>();
const emit = defineEmits<{ filter: [token: string] }>();
const labels = computed(() => itemLabels(props.item, props.client));
</script>

<template>
  <div v-if="labels.length" class="item-labels" aria-label="Themes and tags">
    <component :is="preview ? 'span' : href ? 'a' : 'button'"
      v-for="label in labels" :key="label.token"
      :type="!preview && !href ? 'button' : undefined"
      :href="!preview && href ? href(label.token) : undefined"
      class="item-label" :data-kind="label.kind" :data-card-filter="label.token"
      :aria-label="preview ? undefined : `Filter by ${label.kind}: ${label.label}`"
      @click="!preview && !href && emit('filter', label.token)"
    >{{ label.label }}</component>
  </div>
</template>
