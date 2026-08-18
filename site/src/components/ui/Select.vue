<script setup lang="ts">
import { PhCaretDown } from '@phosphor-icons/vue';

const model = defineModel<string>({ required: true });
defineProps<{
  options: { value: string; label: string }[];
  ariaLabel?: string;
  id?: string;
  name?: string;
}>();
</script>

<template>
  <div class="relative">
    <select
      :id="id"
      v-model="model"
      :name="name ?? id"
      :aria-label="ariaLabel"
      autocomplete="off"
      class="text-single-sm-medium text-text-primary-default border-border-subtle-default bg-card/80 w-full cursor-pointer appearance-none rounded-lg border py-2 pr-8 pl-3 outline-none transition-colors focus:border-[color:var(--color-accent-brand-default)] focus:bg-card"
    >
      <option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option>
    </select>
    <PhCaretDown
      class="text-icons-subtle-default pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2"
      :size="14"
    />
  </div>
</template>
