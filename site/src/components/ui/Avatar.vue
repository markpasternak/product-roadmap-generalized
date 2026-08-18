<script setup lang="ts">
import { computed } from 'vue';
import { initials } from '../../lib/display';

const props = withDefaults(defineProps<{ name: string; size?: number }>(), { size: 24 });
const label = computed(() => initials(props.name));
</script>

<template>
  <span
    class="bg-accent-brand-default text-text-primary-inverted-default inline-grid shrink-0 place-items-center rounded-full font-semibold"
    :style="{ width: size + 'px', height: size + 'px', fontSize: Math.round(size * 0.42) + 'px' }"
    :title="name"
  >
    {{ label }}
  </span>
</template>
