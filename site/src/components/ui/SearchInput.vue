<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue';
import { PhMagnifyingGlass, PhX } from '@phosphor-icons/vue';

const model = defineModel<string>({ default: '' });
const props = defineProps<{ placeholder?: string; ariaLabel?: string; name?: string; debounce?: number }>();
const focused = ref(false);
const input = ref<HTMLInputElement>();
const localValue = ref(model.value);
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

function clearTimer() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = undefined;
}

function commit(value = localValue.value) {
  clearTimer();
  model.value = value;
}

function scheduleCommit() {
  const delay = props.debounce ?? 0;
  if (!delay) {
    commit();
    return;
  }
  clearTimer();
  debounceTimer = setTimeout(() => commit(), delay);
}

function clearSearch() {
  localValue.value = '';
  commit('');
  input.value?.focus();
}

watch(model, (value) => {
  if (value !== localValue.value) localValue.value = value;
});

watch(localValue, scheduleCommit);
onUnmounted(clearTimer);
</script>

<template>
  <div class="relative">
    <PhMagnifyingGlass
      class="text-icons-subtle-default pointer-events-none absolute top-1/2 left-3 -translate-y-1/2"
      :size="18"
    />
    <input
      ref="input"
      v-model="localValue"
      type="search"
      autocomplete="off"
      :name="name ?? 'search'"
      :aria-label="ariaLabel ?? placeholder ?? 'Search'"
      :placeholder="placeholder"
      :class="[
        'text-single-base-medium text-text-primary-default border-border-subtle-default bg-card/80 h-10 w-full rounded-lg border pl-10 outline-none transition-colors focus:border-[color:var(--color-accent-brand-default)] focus:bg-card',
        localValue ? 'pr-9' : 'pr-14',
      ]"
      @focus="focused = true"
      @blur="focused = false"
      @keydown.enter="!$event.isComposing && commit()"
    />
    <kbd
      v-if="!localValue && !focused"
      class="search-kbd-hint text-single-sm-medium text-text-subtle-default border-border-subtle-default bg-surface-subtle-default pointer-events-none absolute top-1/2 right-3 hidden -translate-y-1/2 rounded border px-1.5 py-0.5 font-mono sm:inline-block"
      aria-hidden="true"
    >
      /
    </kbd>
    <button
      v-if="localValue"
      type="button"
      class="text-icons-subtle-default hover:text-text-primary-default absolute top-1/2 right-0 grid size-10 -translate-y-1/2 place-items-center rounded-lg"
      aria-label="Clear search"
      @click="clearSearch"
    >
      <PhX :size="16" />
    </button>
  </div>
</template>

<style scoped>
@media (pointer: coarse) {
  .search-kbd-hint {
    display: none;
  }
}
</style>
