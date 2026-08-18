<!-- Product mark: three stacked horizon bars (Now / Next / Later) narrowing as
     confidence drops, on a rounded accent square. Kept as inline vector so it
     needs no raster asset and inherits the accent token. The favicon in
     Base.astro and the OG card in scripts/gen-og.mjs draw the same glyph. -->
<script setup lang="ts">
withDefaults(defineProps<{ size?: number | string }>(), { size: 32 });
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 415 415"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label="Product roadmap mark"
  >
    <rect width="415" height="415" rx="41.5" fill="var(--color-accent-brand-default)" />
    <rect x="88" y="120" width="239" height="44" rx="22" fill="white" />
    <rect x="88" y="186" width="172" height="44" rx="22" fill="white" fill-opacity="0.82" />
    <rect x="88" y="252" width="105" height="44" rx="22" fill="white" fill-opacity="0.6" />
  </svg>
</template>
