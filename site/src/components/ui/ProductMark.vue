<script setup lang="ts">
import { computed } from 'vue';
import { productColor, productShort } from '../../lib/display';

const props = withDefaults(defineProps<{ product: string; size?: number }>(), { size: 34 });
const color = computed(
  () => productColor[props.product as keyof typeof productColor] ?? 'var(--color-icons-subtle-default)',
);
const short = computed(() => productShort[props.product as keyof typeof productShort] ?? '?');
</script>

<template>
  <span
    class="product-mark inline-grid shrink-0 place-items-center font-semibold"
    :style="{
      background: `color-mix(in srgb, ${color} 10%, var(--color-card))`,
      color,
      border: `1px solid color-mix(in srgb, ${color} 20%, transparent)`,
      width: size + 'px',
      height: size + 'px',
      fontSize: Math.round(size * (short.length > 1 ? 0.32 : 0.42)) + 'px',
      borderRadius: Math.max(8, Math.round(size * 0.18)) + 'px',
    }"
    :title="product"
    >{{ short }}</span
  >
</template>
