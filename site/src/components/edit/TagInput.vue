<script setup lang="ts">
// A chip/tag-list control for the item editor: renders selected tags as removable
// chips with an inline text input, and offers an autocomplete dropdown drawn from
// the roadmap's existing tag vocabulary so a PM can reuse tags instead of retyping
// (and free-typing a brand-new tag still works). Presentational + store-agnostic,
// like the rest of edit/*: parent owns the array, this only reads + emits it back.
import { computed, nextTick, onMounted, onUnmounted, ref, useId } from 'vue';
import { PhX } from '@phosphor-icons/vue';

const props = withDefaults(
  defineProps<{
    modelValue: string[];
    /** All existing tags across items, offered as autocomplete suggestions. */
    suggestions?: string[];
    /** Forwarded to the inline text input so a <label for="…"> can target it. */
    id?: string;
  }>(),
  { suggestions: () => [] },
);

const emit = defineEmits<{ (e: 'update:modelValue', value: string[]): void }>();

const containerRef = ref<HTMLElement>();
const inputRef = ref<HTMLInputElement>();
const draft = ref('');
const isOpen = ref(false);
const activeIndex = ref(-1);
const listboxId = `taginput-listbox-${useId()}`;

function optionId(i: number) {
  return `${listboxId}-option-${i}`;
}

/** Suggestions minus whatever's already selected, minus duplicates, filtered by the
 * in-progress draft — case-insensitively throughout, capped for a tidy dropdown. */
const filtered = computed(() => {
  const q = draft.value.trim().toLowerCase();
  const selected = new Set(props.modelValue.map((t) => t.toLowerCase()));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of props.suggestions) {
    const lower = s.toLowerCase();
    if (!lower || selected.has(lower) || seen.has(lower)) continue;
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

function addTag(raw: string) {
  const trimmed = raw.trim();
  draft.value = '';
  activeIndex.value = -1;
  if (!trimmed) return;
  const exists = props.modelValue.some((t) => t.toLowerCase() === trimmed.toLowerCase());
  if (exists) return;
  emit('update:modelValue', [...props.modelValue, trimmed]);
}

function removeTag(index: number) {
  emit(
    'update:modelValue',
    props.modelValue.filter((_, i) => i !== index),
  );
  nextTick(() => inputRef.value?.focus());
}

function selectSuggestion(s: string) {
  addTag(s);
  isOpen.value = true;
  nextTick(() => inputRef.value?.focus());
}

/** Enter/Tab/comma all commit the same thing: whatever's highlighted in the
 * dropdown, or failing that, the raw typed draft. */
function commitActiveOrTyped() {
  if (activeIndex.value >= 0 && filtered.value[activeIndex.value]) {
    addTag(filtered.value[activeIndex.value]!);
  } else if (draft.value.trim()) {
    addTag(draft.value);
  }
  isOpen.value = true;
}

function onInput() {
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
      e.preventDefault();
      commitActiveOrTyped();
      break;
    case ',':
      e.preventDefault();
      commitActiveOrTyped();
      break;
    case 'Tab':
      if (draft.value.trim() || activeIndex.value >= 0) commitActiveOrTyped();
      break;
    case 'Backspace':
      if (draft.value === '' && props.modelValue.length > 0) {
        e.preventDefault();
        removeTag(props.modelValue.length - 1);
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

function focusInput() {
  inputRef.value?.focus();
}
</script>

<template>
  <div ref="containerRef" class="relative">
    <div
      class="border-border-subtle-default bg-card/80 flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border px-2 py-1.5 transition-colors focus-within:border-[color:var(--color-accent-brand-default)] focus-within:bg-card"
      data-test="taginput-container"
      @click="focusInput"
    >
      <span
        v-for="(tag, i) in modelValue"
        :key="`${tag}-${i}`"
        class="bg-surface-subtle-default text-text-primary-default inline-flex items-center gap-1 rounded-full py-0.5 pr-1 pl-2.5 text-single-sm-medium"
        data-test="tag-chip"
      >
        {{ tag }}
        <button
          type="button"
          class="text-icons-subtle-default hover:bg-surface-transparent-red-25 grid size-5 shrink-0 place-items-center rounded-full transition-colors hover:text-[color:var(--color-accent-brand-default)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--color-accent-brand-default)]"
          :aria-label="`Remove ${tag}`"
          data-test="tag-remove"
          @click.stop="removeTag(i)"
        >
          <PhX :size="11" />
        </button>
      </span>
      <input
        :id="id"
        ref="inputRef"
        v-model="draft"
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-haspopup="listbox"
        :aria-expanded="showDropdown"
        :aria-controls="listboxId"
        :aria-activedescendant="activeOptionId"
        autocomplete="off"
        class="text-single-sm-medium text-text-primary-default placeholder:text-text-subtle-default min-w-[8ch] flex-1 bg-transparent outline-none"
        :placeholder="modelValue.length ? '' : 'Add a tag…'"
        data-test="taginput-input"
        @input="onInput"
        @focus="onFocus"
        @keydown="onKeydown"
      />
    </div>

    <Transition name="taginput-dropdown">
      <ul
        v-if="showDropdown"
        :id="listboxId"
        role="listbox"
        class="border-border-subtle-default bg-card absolute inset-x-0 top-[calc(100%+0.375rem)] z-10 max-h-56 origin-top overflow-y-auto rounded-lg border p-1 shadow-lg"
        data-test="taginput-listbox"
      >
        <li
          v-for="(s, i) in filtered"
          :id="optionId(i)"
          :key="s"
          role="option"
          :aria-selected="i === activeIndex"
          class="text-single-sm-medium text-text-primary-default cursor-pointer truncate rounded-md px-2.5 py-1.5"
          :class="i === activeIndex ? 'bg-surface-transparent-orange-25' : 'hover:bg-surface-subtle-default'"
          data-test="taginput-option"
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
.taginput-dropdown-enter-active,
.taginput-dropdown-leave-active {
  transition:
    opacity 0.14s ease-out,
    transform 0.14s ease-out;
}
.taginput-dropdown-enter-from,
.taginput-dropdown-leave-to {
  opacity: 0;
  transform: scaleY(0.96) translateY(-2px);
}
@media (prefers-reduced-motion: reduce) {
  .taginput-dropdown-enter-active,
  .taginput-dropdown-leave-active {
    transition: none;
  }
}
</style>
