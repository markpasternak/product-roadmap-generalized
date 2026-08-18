<script setup lang="ts">
import { PhX } from '@phosphor-icons/vue';
import type { ActiveFilterChip } from '../../lib/filters';

defineProps<{ chips: ActiveFilterChip[] }>();
defineEmits<{
  (e: 'remove', chip: ActiveFilterChip): void;
  (e: 'clear'): void;
}>();
</script>

<template>
  <div v-if="chips.length" class="mb-3 flex flex-wrap items-center gap-1.5" data-test="active-filter-chips">
    <span
      v-for="chip in chips"
      :key="chip.key"
      class="roadmap-quiet-chip text-single-sm-medium text-text-primary-default inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-border-subtle-default/70 px-2 py-1"
      data-test="active-filter-chip"
      :data-filter-kind="chip.kind"
      :data-filter-value="chip.value"
    >
      <span>{{ chip.label }}</span>
      <button
        type="button"
        class="text-icons-subtle-default hover:text-text-primary-default relative grid size-5 place-items-center rounded transition-colors after:absolute after:-inset-2 after:content-['']"
        :aria-label="`Remove ${chip.label} filter`"
        @click="$emit('remove', chip)"
      >
        <PhX :size="12" weight="bold" />
      </button>
    </span>
    <button
      type="button"
      class="text-single-sm-medium text-text-link-default ml-1 min-h-10 rounded-lg px-2 hover:underline"
      data-test="active-filter-clear"
      @click="$emit('clear')"
    >
      Clear all
    </button>
  </div>
</template>
