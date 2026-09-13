<script setup lang="ts">
import ItemReader from '../item/ItemReader.vue';
import { itemReaderContent } from '../../lib/itemReader';
import { installItemImageViewer } from '../../lib/itemImageViewer';
import { guardPublishedContent } from '../../lib/published/usePublishedContent';
import { createItemViewPreference } from '../../lib/itemViewPreference';
import { installItemToc } from '../../lib/itemToc';
import '../../styles/item-toc.css';
import '../../styles/image-viewer.css';
import '../../styles/reading-toolbar.css';
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { animate, type AnimationPlaybackControlsWithThen } from 'motion';
import { installItemHeader } from '../../lib/itemHeader';
import { useClipboard } from '../../composables/useClipboard';
import ConfirmAction from '../ui/ConfirmAction.vue';
import Select from '../ui/Select.vue';
import {
  PhX,
  PhCaretLeft,
  PhCaretRight,
  PhLink,
  PhCheck,
  PhTrash,
  PhArrowCounterClockwise,
} from '@phosphor-icons/vue';
import {
  productColor,
  toneText,
} from '../../lib/display';
import { isTopFocusTrap, trapFocus } from '../../lib/focusTrap';
import type { ItemVM } from '../../lib/filters';
import { PRODUCTS, HORIZONS, STAGES, LEVELS, VISIBILITIES } from '../../lib/schema';
import { useEditStore } from '../../lib/edit/store';
import { VelocityTracker, decideSwipe, rubberband, type SwipeDecision } from '../../lib/swipe';

const props = defineProps<{
  item: ItemVM | null;
  pos?: { index: number; total: number } | null;
  /** Client-facing (presentation) mode: self-contained — no links, docs, or internal fields. */
  client?: boolean;
  /** In-app editing mode (gated upstream on GitHub sign-in + editor status). */
  edit?: boolean;
  /** The item's true raw markdown body (fetched from the edit-service on entering edit
   * mode). When present, the body editor seeds from this instead of the lossy
   * reconstruction of the board's parsed sections. Null/undefined when not (yet) fetched. */
  rawBody?: string | null;
}>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'prev'): void; (e: 'next'): void }>();
const boardBase = import.meta.env.BASE_URL || '/';

// --- Edit mode: local changeset store wiring -------------------------------------------
const editStore = useEditStore();

const LEVEL_OPTIONS = [{ value: '', label: 'Not scored' }, ...LEVELS.map((v) => ({ value: v, label: v }))];
const PRODUCT_OPTIONS = PRODUCTS.map((v) => ({ value: v, label: v }));
const HORIZON_OPTIONS = HORIZONS.map((v) => ({ value: v, label: v }));
const STAGE_OPTIONS = STAGES.map((v) => ({ value: v, label: v }));
const VISIBILITY_OPTIONS = VISIBILITIES.map((v) => ({ value: v, label: v }));

/** A two-way binding for one frontmatter field: reads the pending override (if any)
 * from the edit store, falling back to the item's current value; writes go straight
 * back through setField so every keystroke/selection is persisted immediately. */
function fieldModel(key: 'title' | 'product' | 'horizon' | 'stage' | 'owner' | 'impact' | 'effort' | 'visibility') {
  return computed<string>({
    get() {
      const id = props.item?.id;
      if (!id) return '';
      const override = editStore.fieldValue(id, key);
      if (override !== undefined) return override;
      const v = (props.item as unknown as Record<string, unknown> | null)?.[key];
      return typeof v === 'string' ? v : '';
    },
    set(val: string) {
      if (props.item) editStore.setField(props.item.id, key, val);
    },
  });
}

const titleModel = fieldModel('title');
const productModel = fieldModel('product');
const horizonModel = fieldModel('horizon');
const stageModel = fieldModel('stage');
const ownerModel = fieldModel('owner');
const impactModel = fieldModel('impact');
const effortModel = fieldModel('effort');
const visibilityModel = fieldModel('visibility');

/** Body editor: seeded from the true raw markdown body (fetched from the edit-service via
 * `rawBody`) when available; otherwise falls back to a best-effort plain-text
 * reconstruction of the rendered sections (the board's parsed view is lossy — headings,
 * formatting, and placeholder-filtered content don't round-trip). A pending edit already
 * in the changeset store always wins over either source. */
const bodyModel = computed<string>({
  get() {
    const id = props.item?.id;
    if (!id) return '';
    const override = editStore.bodyValue(id);
    if (override !== undefined) return override;
    if (props.rawBody != null) return props.rawBody;
    if (props.item?.readingBody !== undefined) return props.item.readingBody;
    return storyBlocks.value.map((b) => `## ${b.heading}\n\n${b.text}`).join('\n\n');
  },
  set(val: string) {
    if (props.item) editStore.setBody(props.item.id, val);
  },
});

const isMarkedDeleted = computed(() => (props.item ? editStore.isDeleted(props.item.id) : false));

const confirmDelete = ref(false);
function onDeleteItem() { confirmDelete.value = true; }
function deleteConfirmed() {
  if (props.item) editStore.deleteItem(props.item.id);
  confirmDelete.value = false;
}
function onUndoDelete() {
  if (props.item) editStore.revertItem(props.item.id);
}

const storyBlocks = computed(() => props.item ? itemReaderContent(props.item, props.client).sections : []);

const panel = ref<HTMLElement>();
const expanded = ref(false);
const viewPreference = createItemViewPreference();
onMounted(() => { expanded.value = viewPreference.read(); });
function toggleExpanded() {
  expanded.value = !expanded.value;
  viewPreference.write(expanded.value);
}
let imageViewer: ReturnType<typeof installItemImageViewer> | null = null;
let itemToc: ReturnType<typeof installItemToc> | null = null;
let itemHeader: ReturnType<typeof installItemHeader> | null = null;
let releaseFocus: (() => void) | null = null;

function onKey(e: KeyboardEvent) {
  if (!isTopFocusTrap(panel.value)) return;
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'Escape') { emit('close'); return; }
  const target = e.target as HTMLElement | null;
  if (target?.closest('input, select, textarea, button, a, summary, [contenteditable=true]')) return;
  else if (e.key === 'ArrowLeft') emit('prev');
  else if (e.key === 'ArrowRight') emit('next');
}

type AxisLock = 'x' | 'y' | null;
type GestureState = {
  pointerId: number;
  startX: number;
  startY: number;
  baseX: number;
  locked: AxisLock;
  swiped: boolean;
};

const AXIS_LOCK_PX = 8;
const RUBBER_LIMIT_RATIO = 0.18;
const INCOMING_OFFSET_RATIO = 0.35;
const SPRING = { type: 'spring' as const, stiffness: 350, damping: 32, restDelta: 0.5, restSpeed: 10 };
const EXIT_SPRING = { type: 'spring' as const, stiffness: 430, damping: 36, restDelta: 0.8, restSpeed: 14 };

const velocityTracker = new VelocityTracker();
const swipeTransitionDisabled = ref(false);
const drawerItemTransitionName = computed(() => (swipeTransitionDisabled.value ? '' : 'drawer-item'));
let gesture: GestureState | null = null;
const gestureActive = ref(false);
guardPublishedContent(gestureActive);
let gestureEpoch = 0;
let currentX = 0;
let pendingX = 0;
let swipeRaf = 0;
let swipeAnimation: AnimationPlaybackControlsWithThen | null = null;
let suppressNextClick = false;

function panelWidth(): number {
  return panel.value?.getBoundingClientRect().width || window.innerWidth || 1;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function writePanelX(x: number) {
  currentX = x;
  if (!panel.value) return;
  panel.value.style.transform = x ? `translate3d(${x}px, 0, 0)` : '';
}

function schedulePanelX(x: number) {
  currentX = x;
  pendingX = x;
  if (swipeRaf) return;
  swipeRaf = requestAnimationFrame(() => {
    swipeRaf = 0;
    writePanelX(pendingX);
  });
}

function clearSwipeFrame() {
  if (!swipeRaf) return;
  cancelAnimationFrame(swipeRaf);
  swipeRaf = 0;
}

function stopSwipeAnimation() {
  swipeAnimation?.stop();
  swipeAnimation = null;
}

function isCurrentEpoch(epoch: number): boolean {
  return gestureEpoch === epoch;
}

function setPanelAnimating(on: boolean) {
  if (!panel.value) return;
  panel.value.style.willChange = on ? 'transform, opacity' : '';
}

function resetPanelStyles() {
  clearSwipeFrame();
  stopSwipeAnimation();
  swipeTransitionDisabled.value = false;
  currentX = 0;
  pendingX = 0;
  if (!panel.value) return;
  panel.value.style.transform = '';
  panel.value.style.opacity = '';
  panel.value.style.willChange = '';
}

function animatePanelTo(x: number, velocityPxMs: number, exit = false): Promise<{ completed: boolean }> {
  stopSwipeAnimation();
  setPanelAnimating(true);
  if (prefersReducedMotion()) {
    writePanelX(x);
    setPanelAnimating(false);
    return Promise.resolve({ completed: true });
  }
  return new Promise((resolve) => {
    let settled = false;
    const settle = (completed: boolean) => {
      if (settled) return;
      settled = true;
      swipeAnimation = null;
      setPanelAnimating(false);
      resolve({ completed });
    };
    swipeAnimation = animate(currentX, x, {
      ...(exit ? EXIT_SPRING : SPRING),
      velocity: velocityPxMs * 1000,
      onUpdate: writePanelX,
      onComplete: () => settle(true),
      onStop: () => settle(false),
    });
  });
}

function safeSetPointerCapture(event: PointerEvent) {
  const el = panel.value;
  if (!el || typeof el.setPointerCapture !== 'function') return;
  try {
    el.setPointerCapture(event.pointerId);
  } catch {
    /* jsdom/older engines may not support capture for this pointer. */
  }
}

function safeReleasePointerCapture(pointerId: number) {
  const el = panel.value;
  if (!el || typeof el.releasePointerCapture !== 'function') return;
  try {
    el.releasePointerCapture(pointerId);
  } catch {
    /* ignore */
  }
}

function addSwipeListeners() {
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerCancel);
}

function removeSwipeListeners() {
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
  window.removeEventListener('pointercancel', onPointerCancel);
}

function abandonGesture(releaseCapture = true) {
  if (gesture && releaseCapture) safeReleasePointerCapture(gesture.pointerId);
  gesture = null;
  gestureActive.value = false;
  velocityTracker.reset();
  removeSwipeListeners();
}

function suppressFollowingClick() {
  suppressNextClick = true;
  window.setTimeout(() => {
    suppressNextClick = false;
  }, 350);
}

function onPanelClickCapture(event: MouseEvent) {
  if (!suppressNextClick) return;
  suppressNextClick = false;
  event.preventDefault();
  event.stopPropagation();
}

function onPointerDown(event: PointerEvent) {
  if ((event.target as HTMLElement).closest('dialog, [data-image-open], button, a, input, textarea, select')) return;
  if (!props.item || event.pointerType === 'mouse' || event.isPrimary === false || gesture) return;
  gestureEpoch += 1;
  swipeTransitionDisabled.value = false;
  stopSwipeAnimation();
  clearSwipeFrame();
  setPanelAnimating(true);
  velocityTracker.reset();
  velocityTracker.add(event.timeStamp, currentX);
  gesture = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    baseX: currentX,
    locked: null,
    swiped: false,
  };
  gestureActive.value = true;
  addSwipeListeners();
}

function onPointerMove(event: PointerEvent) {
  if (!gesture || event.pointerId !== gesture.pointerId) return;
  const dx = event.clientX - gesture.startX;
  const dy = event.clientY - gesture.startY;
  if (!gesture.locked) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) < AXIS_LOCK_PX) return;
    if (Math.abs(dy) > Math.abs(dx)) {
      abandonGesture(false);
      // A vertical scroll that started on a caught mid-flight panel must not leave it
      // frozen at its offset — spring it home; from rest this is a no-op style clear.
      if (currentX !== 0) void animatePanelTo(0, 0);
      else setPanelAnimating(false);
      return;
    }
    gesture.locked = 'x';
    safeSetPointerCapture(event);
  }
  if (gesture.locked !== 'x') return;
  event.preventDefault();
  const rawOffset = gesture.baseX + dx;
  const width = panelWidth();
  const canPrev = !!props.pos && props.pos.index > 0;
  const canNext = !!props.pos && props.pos.index < props.pos.total - 1;
  const renderedOffset =
    rawOffset > 0 && !canPrev
      ? rubberband(rawOffset, width * RUBBER_LIMIT_RATIO)
      : rawOffset < 0 && !canNext
        ? rubberband(rawOffset, width * RUBBER_LIMIT_RATIO)
        : rawOffset;
  gesture.swiped = gesture.swiped || Math.abs(renderedOffset - gesture.baseX) >= AXIS_LOCK_PX;
  velocityTracker.add(event.timeStamp, renderedOffset);
  schedulePanelX(renderedOffset);
}

async function finishSwipe(event: PointerEvent | null) {
  if (!gesture) return;
  const epoch = gestureEpoch;
  const state = gesture;
  if (state.locked !== 'x') {
    abandonGesture(true);
    // A tap that caught a mid-flight panel releases it back home with a spring —
    // never an instant teleport. From rest, just clear the styles.
    if (currentX !== 0) void animatePanelTo(0, 0);
    else resetPanelStyles();
    return;
  }
  if (event) velocityTracker.add(event.timeStamp, currentX);
  const velocity = velocityTracker.velocity(event?.timeStamp);
  const decision = decideSwipe({
    offset: currentX,
    velocity,
    width: panelWidth(),
    canPrev: !!props.pos && props.pos.index > 0,
    canNext: !!props.pos && props.pos.index < props.pos.total - 1,
  });
  if (state.swiped) suppressFollowingClick();
  abandonGesture(true);
  clearSwipeFrame();
  if (decision === 'cancel') {
    await animatePanelTo(0, velocity);
    if (!isCurrentEpoch(epoch)) return;
    writePanelX(0);
    return;
  }
  await commitSwipe(decision, velocity, epoch);
}

async function commitSwipe(decision: Exclude<SwipeDecision, 'cancel'>, velocity: number, epoch: number) {
  const beforeId = props.item?.id ?? null;
  const width = panelWidth();
  const exitX = decision === 'next' ? -width * 1.08 : width * 1.08;
  if (prefersReducedMotion()) {
    if (panel.value) panel.value.style.opacity = '0';
  } else {
    await animatePanelTo(exitX, velocity, true);
    if (!isCurrentEpoch(epoch)) return;
  }

  swipeTransitionDisabled.value = true;
  if (decision === 'next') emit('next'); else emit('prev');
  await nextTick();
  if (!isCurrentEpoch(epoch)) return;
  const changed = beforeId !== (props.item?.id ?? null);
  if (!changed) {
    if (panel.value) panel.value.style.opacity = '';
    await animatePanelTo(0, velocity);
    if (!isCurrentEpoch(epoch)) return;
    writePanelX(0);
    swipeTransitionDisabled.value = false;
    return;
  }

  if (prefersReducedMotion()) {
    resetPanelStyles();
    swipeTransitionDisabled.value = false;
    return;
  }

  writePanelX(decision === 'next' ? width * INCOMING_OFFSET_RATIO : -width * INCOMING_OFFSET_RATIO);
  await animatePanelTo(0, velocity);
  if (!isCurrentEpoch(epoch)) return;
  writePanelX(0);
  swipeTransitionDisabled.value = false;
}

function onPointerUp(event: PointerEvent) {
  if (!gesture || event.pointerId !== gesture.pointerId) return;
  void finishSwipe(event);
}

function onPointerCancel(event: PointerEvent) {
  if (!gesture || event.pointerId !== gesture.pointerId) return;
  abandonGesture(true);
  clearSwipeFrame();
  void animatePanelTo(0, 0);
}
watch(
  () => props.item,
  async (v, prev) => {
    if (typeof document === 'undefined') return;
    if (v) {
      document.addEventListener('keydown', onKey);
      if (!prev) {
        await nextTick();
        if (panel.value) {
          releaseFocus = trapFocus(panel.value, { initialFocus: () => panel.value?.querySelector<HTMLElement>('#drawer-title') });
          imageViewer = installItemImageViewer(panel.value);
          itemToc = installItemToc(panel.value);
          itemHeader = installItemHeader(panel.value);
        }
      } else {
        await nextTick();
        imageViewer?.refresh();
      }
    } else {
      imageViewer?.destroy();
      imageViewer = null;
      itemToc?.destroy();
      itemToc = null;
      itemHeader?.destroy();
      itemHeader = null;
      gestureEpoch += 1;
      resetPanelStyles();
      abandonGesture(true);
      document.removeEventListener('keydown', onKey);
      releaseFocus?.();
      releaseFocus = null;
    }
  },
  { immediate: true },
);
onUnmounted(() => {
  itemHeader?.destroy();
  imageViewer?.destroy();
  itemToc?.destroy();
  if (typeof document !== 'undefined') {
    gestureEpoch += 1;
    document.removeEventListener('keydown', onKey);
    releaseFocus?.();
    resetPanelStyles();
    abandonGesture(true);
  }
});

const label = 'text-single-sm-medium font-semibold uppercase tracking-wide text-text-subtle-default';


// The standalone item URL is permanent and independent of board filters or reading mode.
const { copy, copied, copying, copyError, resetCopy } = useClipboard();
function copyLink() {
  if (!props.item) return;
  const url = new URL(props.item.href || `${boardBase}item/${props.item.id}`, location.origin);
  void copy(url.href);
}
const scrollArea = ref<HTMLElement>();
watch(() => props.item?.id, () => {
  imageViewer?.close();
  resetCopy();
  if (scrollArea.value) scrollArea.value.scrollTop = 0;
});
</script>

<template>
  <Transition name="drawer">
    <div v-if="item" :class="{ 'detail-expanded': expanded }" class="fixed inset-0 z-50 flex items-start justify-center overflow-hidden px-3 py-3 sm:px-6 sm:py-6">
      <div class="drawer-scrim bg-surface-transparent-black-50 fixed inset-0" @click="emit('close')" />
      <aside
        ref="panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        tabindex="-1"
        class="drawer-panel roadmap-field roadmap-drawer-field roadmap-product-detail relative flex max-h-[calc(100dvh-1.5rem)] min-h-[320px] w-full max-w-[900px] flex-col overflow-hidden rounded-[20px] outline-none sm:max-h-[calc(100dvh-3rem)]"
        :style="{ '--roadmap-product-accent': productColor[item.product as keyof typeof productColor] ?? 'var(--color-icons-subtle-default)' }"
        @click.capture="onPanelClickCapture"
        @pointerdown="onPointerDown"
      >
        <div class="item-toolbar">
          <span class="item-toolbar-title">
            <span class="item-product-accent" />
            <span class="item-toolbar-copy"><span class="item-header-product">{{ item.product }}</span><span class="item-header-title" data-header-title aria-hidden="true" :title="item.title">{{ item.title }}</span></span>
          </span>
          <div class="item-toolbar-controls">
            <div v-if="pos" class="item-control-group" role="group" aria-label="Item navigation">
              <button
                class="item-control"
                aria-label="Previous item"
                title="Previous item"
                :disabled="pos.index === 0"
                @click="emit('prev')"
              >
                <PhCaretLeft :size="17" />
              </button>
              <span class="item-control-count">
                {{ pos.index + 1 }}/{{ pos.total }}
              </span>
              <button
                class="item-control"
                aria-label="Next item"
                title="Next item"
                :disabled="pos.index === pos.total - 1"
                @click="emit('next')"
              >
                <PhCaretRight :size="17" />
              </button>
            </div>
            <span v-if="pos" class="item-control-divider" aria-hidden="true" />
            <button type="button" class="item-control" :disabled="copying" :aria-label="copied ? 'Item link copied' : 'Copy item link'" :title="copied ? 'Item link copied' : 'Copy item link'" @click="copyLink">
              <PhCheck v-if="copied" :size="18" /><PhLink v-else :size="18" />
            </button>
            <button type="button" class="item-control" :aria-expanded="expanded" :aria-label="expanded ? 'Collapse item' : 'Expand item'" :title="expanded ? 'Collapse item' : 'Expand item'" @click="toggleExpanded">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path v-if="expanded" d="M4 9h5V4m6 0v5h5M4 15h5v5m6 0v-5h5" />
                <path v-else d="M9 4H4v5m11-5h5v5M4 15v5h5m6 0h5v-5" />
              </svg>
            </button>
            <button
              class="item-control item-close-control"
              aria-label="Close"
              title="Close item"
              @click="emit('close')"
            >
              <PhX :size="21" />
            </button>
          </div>
        </div>

        <div ref="scrollArea" class="flex-1 overflow-y-auto" data-reading-scroll>
          <Transition :name="drawerItemTransitionName" mode="out-in">
          <ItemReader :key="item.id" :item="item" :expanded="expanded" :client="client" :base="boardBase">
            <template #status>
              <p v-if="copyError" role="alert" class="mt-3 text-sm text-text-subtle-default">{{ copyError }}</p>
              <p v-else-if="copied" role="status" class="sr-only">Item link copied.</p>
            </template>
            <div v-if="edit && !client" class="roadmap-panel mt-4 rounded-xl p-3.5" data-test="edit-panel">
              <div class="flex items-center justify-between gap-3">
                <span :class="label">Edit item</span>
                <template v-if="isMarkedDeleted">
                  <button
                    type="button"
                    class="roadmap-action text-single-sm-medium border-border-subtle-default bg-card/80 inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-text-primary-default"
                    @click="onUndoDelete"
                  >
                    <PhArrowCounterClockwise :size="15" /> Undo delete
                  </button>
                </template>
                <button
                  v-else
                  type="button"
                  class="roadmap-action text-single-sm-medium inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5"
                  :style="{ borderColor: toneText.red, color: toneText.red }"
                  @click="onDeleteItem"
                >
                  <PhTrash :size="15" /> Delete
                </button>
              </div>

              <p v-if="isMarkedDeleted" class="text-single-sm-medium mt-2" :style="{ color: toneText.red }">
                Marked for deletion — it will be removed on the next sync.
              </p>

              <div class="mt-3">
                <label :class="label" for="edit-title">Title</label>
                <input
                  id="edit-title"
                  v-model="titleModel"
                  type="text"
                  class="text-single-sm-medium text-text-primary-default border-border-subtle-default bg-card/80 mt-1.5 w-full rounded-lg border px-3 py-2 outline-none transition-colors focus:border-[color:var(--color-accent-brand-default)] focus:bg-card"
                />
              </div>

              <div class="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <label :class="label" for="edit-product">Product</label>
                  <div class="mt-1.5">
                    <Select id="edit-product" v-model="productModel" :options="PRODUCT_OPTIONS" aria-label="Product" />
                  </div>
                </div>
                <div>
                  <label :class="label" for="edit-horizon">Horizon</label>
                  <div class="mt-1.5">
                    <Select id="edit-horizon" v-model="horizonModel" :options="HORIZON_OPTIONS" aria-label="Horizon" />
                  </div>
                </div>
                <div>
                  <label :class="label" for="edit-stage">Stage</label>
                  <div class="mt-1.5">
                    <Select id="edit-stage" v-model="stageModel" :options="STAGE_OPTIONS" aria-label="Stage" />
                  </div>
                </div>
                <div>
                  <label :class="label" for="edit-visibility">Visibility</label>
                  <div class="mt-1.5">
                    <Select
                      id="edit-visibility"
                      v-model="visibilityModel"
                      :options="VISIBILITY_OPTIONS"
                      aria-label="Visibility"
                    />
                  </div>
                </div>
                <div>
                  <label :class="label" for="edit-owner">Owner</label>
                  <input
                    id="edit-owner"
                    v-model="ownerModel"
                    type="text"
                    class="text-single-sm-medium text-text-primary-default border-border-subtle-default bg-card/80 mt-1.5 w-full rounded-lg border px-3 py-2 outline-none transition-colors focus:border-[color:var(--color-accent-brand-default)] focus:bg-card"
                  />
                </div>
                <div>
                  <label :class="label" for="edit-impact">Impact</label>
                  <div class="mt-1.5">
                    <Select id="edit-impact" v-model="impactModel" :options="LEVEL_OPTIONS" aria-label="Impact" />
                  </div>
                </div>
                <div>
                  <label :class="label" for="edit-effort">Effort</label>
                  <div class="mt-1.5">
                    <Select id="edit-effort" v-model="effortModel" :options="LEVEL_OPTIONS" aria-label="Effort" />
                  </div>
                </div>
              </div>

              <div class="mt-3">
                <label :class="label" for="edit-body">Body</label>
                <textarea
                  id="edit-body"
                  v-model="bodyModel"
                  rows="6"
                  class="text-single-sm-medium text-text-primary-default border-border-subtle-default bg-card/80 mt-1.5 w-full rounded-lg border px-3 py-2 outline-none transition-colors focus:border-[color:var(--color-accent-brand-default)] focus:bg-card"
                />
              </div>
            </div>

          </ItemReader>
          </Transition>
        </div>
      </aside>
    </div>
  </Transition>
  <ConfirmAction v-if="confirmDelete && item" title="Delete this item?" :message="`“${item.title}” will be marked for deletion. It stays published until you publish the changes.`" confirm-label="Mark for deletion" @cancel="confirmDelete = false" @confirm="deleteConfirmed" />
</template>

<style scoped>
.drawer-panel {
  touch-action: pan-y;
}
.detail-expanded { padding: 0; }
.detail-expanded > .drawer-panel { width: 100%; max-width: none; height: 100dvh; max-height: 100dvh; border-radius: 0; }
.drawer-enter-active,
.drawer-leave-active {
  transition: opacity 0.2s ease;
}
.drawer-enter-active .drawer-panel,
.drawer-leave-active .drawer-panel {
  transition:
    transform 0.22s ease,
    opacity 0.22s ease;
}
.drawer-enter-from,
.drawer-leave-to {
  opacity: 0;
}
.drawer-enter-from .drawer-panel,
.drawer-leave-to .drawer-panel {
  opacity: 0;
  transform: translateY(14px) scale(0.985);
}
/* Content swap while browsing prev/next: quick fade + slide. */
.drawer-item-enter-active,
.drawer-item-leave-active {
  transition:
    opacity 0.14s ease-out,
    transform 0.14s ease-out;
}
.drawer-item-enter-from {
  opacity: 0;
  transform: translateX(10px);
}
.drawer-item-leave-to {
  opacity: 0;
  transform: translateX(-10px);
}
@media (prefers-reduced-motion: reduce) {
  .drawer-enter-active,
  .drawer-leave-active,
  .drawer-enter-active .drawer-panel,
  .drawer-leave-active .drawer-panel,
  .drawer-item-enter-active,
  .drawer-item-leave-active {
    transition: none;
  }
}
</style>
