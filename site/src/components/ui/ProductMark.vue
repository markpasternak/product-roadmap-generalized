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
    class="inline-grid shrink-0 place-items-center font-semibold text-white"
    :style="{
      background: `linear-gradient(145deg, ${color}, color-mix(in srgb, ${color} 74%, var(--roadmap-brand-ink)))`,
      width: size + 'px',
      height: size + 'px',
      fontSize: Math.round(size * (short.length > 1 ? 0.32 : 0.42)) + 'px',
      borderRadius: Math.max(8, Math.round(size * 0.18)) + 'px',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.22), 0 10px 22px rgba(10, 21, 49, 0.18)',
    }"
    :title="product"
    >{{ short }}</span
  >
</template>
