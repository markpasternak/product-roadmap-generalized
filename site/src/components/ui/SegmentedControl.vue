<script setup lang="ts">
import { cn } from '../../lib/utils';

defineProps<{ options: { value: string; label: string }[] }>();
const model = defineModel<string>({ required: true });
</script>

<template>
  <div class="border-border-subtle-default bg-card inline-flex rounded-full border p-0.5">
    <button
      v-for="opt in options"
      :key="opt.value"
      type="button"
      :class="
        cn(
          'text-single-sm-medium rounded-full px-3.5 py-1.5 transition-colors',
          model === opt.value
            ? 'bg-foreground text-text-primary-inverted-default'
            : 'text-text-subtle-default hover:text-text-primary-default',
        )
      "
      @click="model = opt.value"
    >
      {{ opt.label }}
    </button>
  </div>
</template>
