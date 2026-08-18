<script setup lang="ts">
// A single-value counterpart to TagInput (see TagInput.vue) for the item editor's Owner
// field: a plain text input with an autocomplete dropdown drawn from every owner already
// in use across the roadmap, so a PM can reuse an existing owner instead of retyping a
// slightly different spelling — but typing a brand-new owner still works, free-text.
// Presentational + store-agnostic, like the rest of edit/*: the parent owns the string
// and this only reads + emits it back.
import { computed, onMounted, onUnmounted, ref, useId, watch } from 'vue';

const props = withDefaults(
  defineProps<{
    modelValue: string;
    /** Every distinct owner across items, offered as autocomplete suggestions. */
    suggestions?: string[];
    /** Forwarded to the input so a <label for="…"> can target it. */
    id?: string;
  }>(),
  { suggestions: () => [] },
);

const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>();

const containerRef = ref<HTMLElement>();
const inputRef = ref<HTMLInputElement>();
const isOpen = ref(false);
const activeIndex = ref(-1);
const listboxId = `ownerinput-listbox-${useId()}`;

// A local draft mirrors `modelValue` so filtering reacts to every keystroke immediately,
// without depending on the parent round-tripping the emit back into the prop before the
// next render (unlike TagInput's chip list, a single value doesn't have that guarantee —
// there's no separate "committed" vs. "in-progress" state to fall back on). Kept in sync
// whenever the prop changes from outside (switching items, a programmatic reset).
const draft = ref(props.modelValue);
watch(
  () => props.modelValue,
  (v) => {
    if (v !== draft.value) draft.value = v;
  },
);

function optionId(i: number) {
  return `${listboxId}-option-${i}`;
}

/** Suggestions filtered by the current input value — case-insensitively, deduped, capped
 * for a tidy dropdown. Unlike TagInput there's no "already selected" set to exclude: a
 * single-value field's current value IS the draft, so typing it fully just narrows to
 * itself (harmless — selecting it re-emits the same value). */
const filtered = computed(() => {
  const q = draft.value.trim().toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of props.suggestions) {
    const lower = s.toLowerCase();
    if (!lower || seen.has(lower)) continue;
    if (q && !lower.includes(q)) continue;
    seen.add(lower);
    out.push(s);
  }
  return out.slice(0, 8);
});

const showDropdown = computed(() => isOpen.value && filtered.value.length > 0);
const activeOptionId = computed(() =>
  activeIndex.value >= 0 && activeIndex.value < filtered.value.length ? optionId(activeIndex.value) : undefined,
);

function commit(value: string) {
  draft.value = value;
  emit('update:modelValue', value);
  isOpen.value = false;
  activeIndex.value = -1;
}

function selectSuggestion(s: string) {
  // The option's `@mousedown.prevent` (below) already stops the browser from shifting
  // focus off the input on click, so — unlike TagInput, which re-opens the dropdown to
  // add another tag — committing a single value should just close it, not re-focus.
  commit(s);
}

function onInput(e: Event) {
  const value = (e.target as HTMLInputElement).value;
  draft.value = value;
  emit('update:modelValue', value);
  isOpen.value = true;
  activeIndex.value = -1;
}

function onFocus() {
  isOpen.value = true;
}

function onKeydown(e: KeyboardEvent) {
  switch (e.key) {
    case 'ArrowDown': {
      e.preventDefault();
      isOpen.value = true;
      if (filtered.value.length) activeIndex.value = (activeIndex.value + 1) % filtered.value.length;
      break;
    }
    case 'ArrowUp': {
      e.preventDefault();
      isOpen.value = true;
      if (filtered.value.length) {
        activeIndex.value = activeIndex.value <= 0 ? filtered.value.length - 1 : activeIndex.value - 1;
      }
      break;
    }
    case 'Enter':
      if (activeIndex.value >= 0 && filtered.value[activeIndex.value]) {
        e.preventDefault();
        commit(filtered.value[activeIndex.value]!);
      } else {
        isOpen.value = false;
        activeIndex.value = -1;
      }
      break;
    case 'Escape':
      if (isOpen.value) {
        // Keep Escape scoped to the dropdown — the editor panel also closes on
        // Escape, and closing the dropdown shouldn't take the whole panel with it.
        e.preventDefault();
        e.stopPropagation();
        isOpen.value = false;
        activeIndex.value = -1;
      }
      break;
  }
}

function onPointerDown(e: MouseEvent) {
  if (!containerRef.value || containerRef.value.contains(e.target as Node)) return;
  isOpen.value = false;
  activeIndex.value = -1;
}

onMounted(() => document.addEventListener('mousedown', onPointerDown));
onUnmounted(() => document.removeEventListener('mousedown', onPointerDown));
</script>

<template>
  <div ref="containerRef" class="relative">
    <input
      :id="id"
      ref="inputRef"
      :value="draft"
      type="text"
      role="combobox"
      aria-autocomplete="list"
      aria-haspopup="listbox"
      :aria-expanded="showDropdown"
      :aria-controls="listboxId"
      :aria-activedescendant="activeOptionId"
      autocomplete="off"
      class="text-single-sm-medium text-text-primary-default border-border-subtle-default bg-card/80 min-h-10 w-full rounded-lg border px-3 py-2 outline-none transition-colors focus:border-[color:var(--color-accent-brand-default)] focus:bg-card"
      data-test="ownerinput-input"
      @input="onInput"
      @focus="onFocus"
      @keydown="onKeydown"
    />

    <Transition name="ownerinput-dropdown">
      <ul
        v-if="showDropdown"
        :id="listboxId"
        role="listbox"
        class="border-border-subtle-default bg-card absolute inset-x-0 top-[calc(100%+0.375rem)] z-10 max-h-56 origin-top overflow-y-auto rounded-lg border p-1 shadow-lg"
        data-test="ownerinput-listbox"
      >
        <li
          v-for="(s, i) in filtered"
          :id="optionId(i)"
          :key="s"
          role="option"
          :aria-selected="i === activeIndex"
          class="text-single-sm-medium text-text-primary-default cursor-pointer truncate rounded-md px-2.5 py-1.5"
          :class="i === activeIndex ? 'bg-surface-transparent-orange-25' : 'hover:bg-surface-subtle-default'"
          data-test="ownerinput-option"
          @mousedown.prevent
          @mouseenter="activeIndex = i"
          @click="selectSuggestion(s)"
        >
          {{ s }}
        </li>
      </ul>
    </Transition>
  </div>
</template>

<style scoped>
.ownerinput-dropdown-enter-active,
.ownerinput-dropdown-leave-active {
  transition:
    opacity 0.14s ease-out,
    transform 0.14s ease-out;
}
.ownerinput-dropdown-enter-from,
.ownerinput-dropdown-leave-to {
  opacity: 0;
  transform: scaleY(0.96) translateY(-2px);
}
@media (prefers-reduced-motion: reduce) {
  .ownerinput-dropdown-enter-active,
  .ownerinput-dropdown-leave-active {
    transition: none;
  }
}
</style>
