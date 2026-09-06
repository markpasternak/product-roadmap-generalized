<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import ProductMark from '../ui/ProductMark.vue';
import HighlightedText from '../ui/HighlightedText.vue';
import {
  PhArrowUpRight,
  PhArrowCounterClockwise,
  PhCopy,
  PhDotsSixVertical,
} from '@phosphor-icons/vue';
import {
  horizonDot,
} from '../../lib/display';
import { useEditStore } from '../../lib/edit/store';
import type { ItemVM } from '../../lib/filters';

const props = defineProps<{
  item: ItemVM;
  showHorizon?: boolean;
  active?: boolean;
  /** Client-facing (presentation) mode: no internal sizing, no plain tags, no owner. */
  client?: boolean;
  /** Drag-reorder affordance only (gated upstream on canEdit && editMode — SortableJS itself,
   * driven from Board, further gates whether a drag actually reorders/moves anything via its
   * `sort`/`group` options). Controls whether the drag handle renders — it does NOT gate the
   * dirty marker or discard affordance; see `editing`. */
  draggable?: boolean;
  /** In-app editing mode (gated upstream on canEdit && editMode): enables the dirty marker
   * and per-item discard affordance, independent of whether drag-reorder is also active. */
  editing?: boolean;
  /** Working-copy status from projectBoard(): highlights edited/new cards with a brand
   * accent, dims+strikes deleted ones. Undefined outside edit mode. */
  pending?: 'edited' | 'new' | 'deleted';
  /** Active board search query; rendered as quiet highlights on matching text outside presentation mode. */
  highlightQuery?: string;
}>();
const emit = defineEmits<{
  (e: 'select', item: ItemVM): void;
  (e: 'discard', id: string): void;
  (e: 'rename', payload: { id: string; title: string }): void;
  (e: 'duplicate', id: string): void;
  (e: 'move', direction: 'up' | 'down' | 'left' | 'right'): void;
}>();

// Edit mode only: the local changeset store is a singleton, so reading it here (rather
// than threading `dirty`/`isDirty` down as a prop from Board) keeps the wiring local to
// the card that needs it.
const editStore = useEditStore();
const dirty = computed(() => !!props.editing && editStore.isDirty(props.item.id));

// SortableJS (driven from Board.vue) owns drag-and-drop entirely — it's configured with
// `handle: '.roadmap-drag-handle'`, so a drag can only ever start from the grip below, never
// from a click/tap anywhere else on the card. The handle is rendered as a sibling of the
// card's own <button> (see the template — both live in the outer wrapper div, same as the
// discard/duplicate buttons below), so it can never end up nested inside a <button> (invalid
// HTML), and a tap on it never bubbles into the card's own `@click` (open editor) since
// siblings don't bubble through each other — no stopPropagation needed for that.
function onDiscardClick(e: MouseEvent) {
  e.stopPropagation();
  emit('discard', props.item.id);
}
function onDuplicateClick(e: MouseEvent) {
  e.stopPropagation();
  emit('duplicate', props.item.id);
}

// Fix #2: inline rename via double-clicking the title (edit mode only). A real
// double-click still fires two `click` events (bubbling toward the card's own button,
// which opens the full editor) before the browser's `dblclick` ever fires — so the title's
// own click handler defers the `select` emit behind a short timer, and the second click of
// the pair cancels it (the upcoming `dblclick` takes over from there) instead of letting
// both clicks reach the editor. Only wired up while `editing`; outside edit mode the title
// has no listeners and clicks bubble to the card exactly as before.
const renaming = ref(false);
const renameValue = ref('');
const renameInput = ref<HTMLInputElement | null>(null);
let clickTimer: ReturnType<typeof setTimeout> | null = null;
const DBLCLICK_WINDOW_MS = 220;

function onTitleClick(e: MouseEvent) {
  if (!props.editing) return; // let it bubble to the card's own click handler, unchanged
  e.stopPropagation();
  if (clickTimer) {
    // Second click of a double-click: the imminent `dblclick` event owns this gesture.
    clearTimeout(clickTimer);
    clickTimer = null;
    return;
  }
  clickTimer = setTimeout(() => {
    clickTimer = null;
    emit('select', props.item);
  }, DBLCLICK_WINDOW_MS);
}
function onTitleDblClick(e: MouseEvent) {
  if (clickTimer) {
    clearTimeout(clickTimer);
    clickTimer = null;
  }
  if (!props.editing) return;
  e.preventDefault();
  e.stopPropagation();
  renameValue.value = props.item.title;
  renaming.value = true;
  void nextTick(() => {
    renameInput.value?.focus();
    renameInput.value?.select();
  });
}
function commitRename() {
  if (!renaming.value) return;
  const title = renameValue.value.trim();
  renaming.value = false;
  if (!title) return; // empty -> revert to prior title, no emit
  emit('rename', { id: props.item.id, title });
}
function cancelRename() {
  renaming.value = false;
}
function onRenameKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault();
    commitRename();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    cancelRename();
  }
}

const highlightQuery = computed(() => (props.client ? '' : (props.highlightQuery ?? '').trim()));

// R4: working-copy status from projectBoard() — a subtle brand-accent treatment for
// edited/new cards (ring + left accent bar, matching the existing `.roadmap-card-active`
// language), and a dimmed/struck-through treatment for cards flagged for deletion.
const pendingClass = computed(() => {
  if (props.pending === 'edited' || props.pending === 'new') return 'roadmap-card-pending';
  if (props.pending === 'deleted') return 'roadmap-card-deleted';
  return '';
});

// R2: a struck (pending-delete) card's discard control reverts the same as any other
// discard, but "Discard changes" reads wrong for a card that's already gone — it
// should read as undoing the deletion, i.e. Restore.
const isRestore = computed(() => props.pending === 'deleted');
const discardLabel = computed(() => (isRestore.value ? `Restore ${props.item.title}` : `Discard changes to ${props.item.title}`));
const discardTitle = computed(() => (isRestore.value ? 'Restore' : 'Discard changes'));
</script>

<template>
  <div class="relative roadmap-card-item" :data-item-id="item.id">
  <button
    type="button"
    class="group roadmap-card roadmap-action relative block w-full rounded-2xl p-3.5 text-left transition duration-150 active:scale-[0.99]"
    :class="[
      active
        ? 'roadmap-card-active'
        : 'hover:border-[color:var(--color-accent-brand-default)]',
      pendingClass,
    ]"
    @click="emit('select', item)"
  >
    <span
      v-if="dirty"
      data-test="dirty-dot"
      title="Unpublished changes"
      aria-label="Unpublished changes"
      class="absolute top-3 left-3 size-2 rounded-full bg-[color:var(--color-accent-brand-default)]"
    />
    <PhArrowUpRight
      v-if="!draggable"
      :size="14"
      class="text-icons-subtle-default absolute top-3 right-3 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
      aria-hidden="true"
    />

    <div class="flex items-start gap-3">
      <ProductMark :product="item.product" :size="36" />
      <div class="min-w-0 flex-1">
        <h3
          v-if="!renaming"
          data-test="card-title"
          class="text-[15px] font-semibold leading-snug text-text-primary-default pr-8"
          :class="pending === 'deleted' ? 'line-through opacity-70' : ''"
          @click="onTitleClick"
          @dblclick="onTitleDblClick"
        >
          <HighlightedText :text="item.title" :query="highlightQuery" />
          <span
            v-if="pending === 'new'"
            data-test="pending-new-label"
            class="text-single-sm-medium ml-1.5 rounded-md px-1.5 py-0.5 align-middle font-semibold"
            :style="{ background: 'color-mix(in srgb, var(--color-accent-brand-default) 14%, transparent)', color: 'var(--color-accent-brand-default)' }"
          >
            new
          </span>
        </h3>
        <input
          v-else
          ref="renameInput"
          v-model="renameValue"
          type="text"
          data-test="rename-input"
          :aria-label="`Rename ${item.title}`"
          class="text-[15px] font-semibold leading-snug text-text-primary-default w-full rounded-md border border-border-subtle-default bg-card px-1.5 py-0.5 pr-4 outline-none focus:border-[color:var(--color-accent-brand-default)]"
          @click.stop
          @mousedown.stop
          @dragstart.stop
          @keydown="onRenameKeydown"
          @blur="commitRename"
        />
        <p v-if="item.oneliner" class="text-body-sm text-text-subtle-default mt-1.5 line-clamp-2">
          <HighlightedText :text="item.oneliner" :query="highlightQuery" />
        </p>
      </div>
    </div>

    <div class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5" :class="editing ? 'pr-16' : ''">
      <span
        v-if="showHorizon"
        class="roadmap-quiet-chip text-single-sm-medium text-text-primary-default inline-flex items-center gap-1.5 rounded-lg px-2 py-1"
      >
        <span class="h-3.5 w-1 rounded-full" :style="{ background: horizonDot[item.horizon as keyof typeof horizonDot] }" />
        {{ item.horizon }}
      </span>
      <span class="roadmap-quiet-chip text-single-sm-medium text-text-subtle-default inline-flex items-center gap-1 rounded-lg px-2 py-1">
        {{ item.stage }}
      </span>
      <span v-if="!client" class="text-single-sm-medium text-text-subtle-default" data-test="card-owner">
        {{ item.owner || 'Unassigned' }}
      </span>
    </div>
  </button>
  <div
    v-if="dirty || (editing && pending !== 'deleted')"
    class="absolute right-2.5 bottom-2.5 flex items-center gap-1.5"
  >
    <button
      v-if="dirty"
      type="button"
      data-test="discard-item"
      :aria-label="discardLabel"
      :title="discardTitle"
      class="roadmap-action border-border-subtle-default bg-card/90 text-icons-subtle-default hover:text-text-primary-default grid size-7 place-items-center rounded-lg border shadow-sm"
      @click="onDiscardClick"
    >
      <PhArrowCounterClockwise :size="13" />
    </button>
    <button
      v-if="editing && pending !== 'deleted'"
      type="button"
      data-test="duplicate-item"
      :aria-label="`Duplicate ${item.title}`"
      title="Duplicate item"
      class="roadmap-action border-border-subtle-default bg-card/90 text-icons-subtle-default hover:text-text-primary-default grid size-7 place-items-center rounded-lg border shadow-sm"
      @click="onDuplicateClick"
    >
      <PhCopy :size="13" />
    </button>
  </div>
  <span
    v-if="draggable"
    data-test="drag-handle"
    class="roadmap-drag-handle absolute right-2 top-2 z-10 grid size-8 touch-none place-items-center rounded-lg text-icons-subtle-default transition-colors"
    role="button"
    tabindex="0"
    aria-label="Drag to reorder"
    title="Drag to move. Use arrow keys when focused."
    aria-description="Up and down change priority. Left and right move between visible horizons."
    @keydown.up.prevent.stop="emit('move', 'up')"
    @keydown.down.prevent.stop="emit('move', 'down')"
    @keydown.left.prevent.stop="emit('move', 'left')"
    @keydown.right.prevent.stop="emit('move', 'right')"
  >
    <PhDotsSixVertical :size="18" weight="bold" />
  </span>
  </div>
</template>

<style scoped>
/* R4: working-copy status (from projectBoard()), edit mode only. Mirrors the existing
   .roadmap-card-active left-accent language so it reads as "part of the same system". */
.roadmap-card-pending {
  border-color: color-mix(in srgb, var(--color-accent-brand-default) 45%, transparent);
  box-shadow:
    inset 3px 0 0 var(--color-accent-brand-default),
    var(--roadmap-card-shadow);
}
.roadmap-card-deleted {
  opacity: 0.55;
}

/* The one and only way to start a drag (SortableJS's `handle` option, set from Board.vue,
   points at this class) — deliberate and discoverable, so a stray tap/click elsewhere on the
   card can never be mistaken for a reorder gesture. `touch-none` (touch-action: none) stops
   the browser's own scroll gesture from competing with a touch drag started here. */
.roadmap-drag-handle {
  cursor: grab;
}
.roadmap-drag-handle:hover {
  background: var(--color-surface-subtle-default);
  color: var(--color-text-primary-default);
}
.roadmap-drag-handle:active,
.roadmap-sortable-chosen .roadmap-drag-handle {
  cursor: grabbing;
  color: var(--color-accent-brand-default);
}
</style>
