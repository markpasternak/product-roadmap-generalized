<script setup lang="ts">
import PlannedDates from './PlannedDates.vue';
import RichMarkdown from '../markdown/RichMarkdown.vue';
import ImageThumbnail from '../markdown/ImageThumbnail.vue';
import { isImageResource } from '../../lib/resources';
import { resourcePreviewURLs } from '../../lib/edit/resourceClient';
import { ref, computed, watch, nextTick, onUnmounted } from 'vue';
import { animate, type AnimationPlaybackControlsWithThen } from 'motion';
import ProductMark from '../ui/ProductMark.vue';
import { useClipboard } from '../../composables/useClipboard';
import ConfirmAction from '../ui/ConfirmAction.vue';
import Select from '../ui/Select.vue';
import {
  PhX,
  PhArrowSquareOut,
  PhCaretLeft,
  PhCaretRight,
  PhLink,
  PhCheck,
  PhUser,
  PhSquaresFour,
  PhCalendarBlank,
  PhStack,
  PhTrash,
  PhArrowCounterClockwise,
  PhGithubLogo,
} from '@phosphor-icons/vue';
import {
  horizonDot,
  toneSurface,
  toneSurfaceStrong,
  toneText,
  tagTone,
} from '../../lib/display';
import { linkSource, linkDisplay } from '../../lib/sources';
import { isTopFocusTrap, trapFocus } from '../../lib/focusTrap';
import type { ItemVM } from '../../lib/filters';
import { formatDateTime, formatDateTimeOrDate } from '../../lib/dates';
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

const CLIENT_SECTIONS = new Set(['Why it matters', 'What ships', 'What shipped']);
const visibleSections = computed(() => {
  const sections = props.item?.sections ?? [];
  return props.client ? sections.filter((s) => CLIENT_SECTIONS.has(s.heading)) : sections;
});
const storyBlocks = computed(() => {
  const blocks = [...visibleSections.value];
  if (props.item?.outcome) blocks.unshift({ heading: 'Target outcome', text: props.item.outcome });
  return blocks;
});
const resourceTypes = computed(() => {
  const counts = new Map<string, number>();
  for (const ln of props.item?.links ?? []) counts.set(ln.label, (counts.get(ln.label) ?? 0) + 1);
  return [...counts.entries()].map(([label, count]) => ({ label, count, src: linkSource(label) }));
});
// Decorate each link with its brand source (icon/tone) and a short display string —
// never the raw URL, which overflows the panel.
const decoratedLinks = computed(() =>
  (props.item?.links ?? []).map((ln) => ({
    ...ln,
    src: linkSource(ln.label, ln.target),
    display: linkDisplay(ln.label, ln.target, ln.title),
  })),
);

const panel = ref<HTMLElement>();
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
        if (panel.value) releaseFocus = trapFocus(panel.value, { initialFocus: () => panel.value?.querySelector<HTMLElement>('#drawer-title') });
      }
    } else {
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
  if (typeof document !== 'undefined') {
    gestureEpoch += 1;
    document.removeEventListener('keydown', onKey);
    releaseFocus?.();
    resetPanelStyles();
    abandonGesture(true);
  }
});

const label = 'text-single-sm-medium font-semibold uppercase tracking-wide text-text-subtle-default';
const actionBtn =
  'roadmap-action border-border-subtle-default bg-card/80 text-single-sm-medium text-text-primary-default hover:bg-card inline-flex h-10 items-center gap-2 rounded-lg border px-3.5 transition-colors';


function historyValue(at: string | undefined, date: string | undefined): string {
  return formatDateTimeOrDate(at, date);
}
function historyDatetime(at: string | undefined, date: string | undefined): string {
  return at || date || '';
}
function historyTitle(at: string | undefined, by: string | undefined, subject: string | undefined): string {
  return [formatDateTime(at), by, subject].filter(Boolean).join(' · ');
}

function tagFilterHref(token: string): string {
  const params = new URLSearchParams();
  params.set('tag', token);
  return `${boardBase}?${params.toString()}`;
}

// Copy a clean, shareable deep link to this item (drops any active filter params).
const { copy, copied, copying, copyError, resetCopy } = useClipboard();
function copyLink() {
  if (props.item) void copy(new URL(props.item.href, location.origin).href);
}
const scrollArea = ref<HTMLElement>();
watch(() => props.item?.id, () => {
  resetCopy();
  if (scrollArea.value) scrollArea.value.scrollTop = 0;
});
</script>

<template>
  <Transition name="drawer">
    <div v-if="item" class="fixed inset-0 z-50 flex items-start justify-center overflow-hidden px-3 py-3 sm:px-6 sm:py-6">
      <div class="drawer-scrim bg-surface-transparent-black-50 fixed inset-0" @click="emit('close')" />
      <aside
        ref="panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        tabindex="-1"
        class="drawer-panel roadmap-field roadmap-drawer-field relative flex max-h-[calc(100dvh-1.5rem)] min-h-[320px] w-full max-w-[900px] flex-col overflow-hidden rounded-[20px] outline-none sm:max-h-[calc(100dvh-3rem)]"
        @click.capture="onPanelClickCapture"
        @pointerdown="onPointerDown"
      >
        <div class="shrink-0 flex items-center justify-between gap-4 px-4 py-2.5 sm:px-5">
          <span class="text-single-sm-medium roadmap-title inline-flex items-center gap-2">
            <span class="h-4 w-1 rounded-full bg-[color:var(--color-accent-brand-default)]" />
            {{ client ? item.product : item.id }}
          </span>
          <div class="flex items-center gap-2">
            <template v-if="pos">
              <button
                class="roadmap-action border-border-subtle-default bg-card/80 text-icons-subtle-default hover:text-text-primary-default grid size-10 place-items-center rounded-lg border disabled:opacity-30"
                aria-label="Previous item"
                :disabled="pos.index === 0"
                @click="emit('prev')"
              >
                <PhCaretLeft :size="17" />
              </button>
              <span class="text-single-sm-medium roadmap-title min-w-12 text-center tabular-nums">
                {{ pos.index + 1 }}/{{ pos.total }}
              </span>
              <button
                class="roadmap-action border-[color:var(--color-accent-brand-default)] bg-card/80 text-[color:var(--color-accent-brand-default)] grid size-10 place-items-center rounded-lg border disabled:opacity-30"
                aria-label="Next item"
                :disabled="pos.index === pos.total - 1"
                @click="emit('next')"
              >
                <PhCaretRight :size="17" />
              </button>
            </template>
            <button
              class="roadmap-action text-icons-primary-default hover:text-[color:var(--color-accent-brand-default)] grid size-10 place-items-center rounded-lg"
              aria-label="Close"
              @click="emit('close')"
            >
              <PhX :size="21" />
            </button>
          </div>
        </div>

        <div ref="scrollArea" class="flex-1 overflow-y-auto">
          <Transition :name="drawerItemTransitionName" mode="out-in">
          <div :key="item.id" class="px-4 pb-5 sm:px-6 sm:pb-6">
            <div class="grid items-start gap-3 lg:grid-cols-[46px_minmax(0,1fr)]">
              <ProductMark :product="item.product" :size="42" />
              <div class="min-w-0">
                <h2 id="drawer-title" tabindex="-1" aria-live="polite" class="roadmap-display roadmap-title text-[1.5rem] sm:text-[1.8rem]">
                  {{ item.title }}
                </h2>
                <PlannedDates :start-date="item.startDate" :end-date="item.endDate" />
                <p class="roadmap-muted mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
                  <span v-if="!client" class="inline-flex items-center gap-2">
                    <PhSquaresFour :size="17" /> {{ item.product }}
                  </span>
                  <span class="inline-flex items-center gap-2">
                    <span class="h-4 w-1 rounded-full" :style="{ background: horizonDot[item.horizon as keyof typeof horizonDot] }" /> {{ item.horizon }}
                  </span>
                  <span v-if="item.owner && !client" class="inline-flex items-center gap-2">
                    <PhUser :size="17" /> {{ item.owner }}
                  </span>
                  <span v-if="historyValue(item.createdAt, item.created) && !client" class="inline-flex items-center gap-2">
                    <PhCalendarBlank :size="17" /> Created
                    <time
                      :datetime="historyDatetime(item.createdAt, item.created)"
                      :title="historyTitle(item.createdAt, item.createdBy, item.createdSubject)"
                    >
                      {{ historyValue(item.createdAt, item.created) }}
                    </time>
                  </span>
                  <span v-if="historyValue(item.updatedAt, item.updated) && !client" class="inline-flex items-center gap-2">
                    <PhCalendarBlank :size="17" /> Updated
                    <time
                      :datetime="historyDatetime(item.updatedAt, item.updated)"
                      :title="historyTitle(item.updatedAt, item.updatedBy, item.updatedSubject)"
                    >
                      {{ historyValue(item.updatedAt, item.updated) }}
                    </time>
                  </span>
                  <span v-if="item.links.length && !client" class="inline-flex items-center gap-2">
                    <PhStack :size="17" /> {{ item.links.length }} resources
                  </span>
                </p>

                <div v-if="!client" class="mt-4 flex flex-wrap items-center gap-2.5">
                  <a
                    :href="item.href"
                    class="roadmap-action border border-border-subtle-default bg-card inline-flex h-10 items-center gap-2 rounded-lg px-4 text-single-sm-medium"
                  >
                    Open full page <PhArrowSquareOut :size="18" />
                  </a>
                  <button type="button" :class="actionBtn" :disabled="copying" @click="copyLink">
                    <template v-if="copied"><PhCheck :size="18" class="text-icons-subtle-default" /> Copied</template>
                    <template v-else><PhLink :size="18" class="text-icons-subtle-default" /> Copy link</template>
                  </button>
                  <a
                    v-if="item.editUrl"
                    :href="item.editUrl"
                    target="_blank"
                    rel="noopener"
                    :class="actionBtn"
                    title="Open this item's markdown file in GitHub's editor"
                  >
                    <PhGithubLogo :size="18" class="text-icons-subtle-default" /> Edit on GitHub
                  </a>
                </div>
              </div>
            </div>

            <p v-if="copyError" role="alert" class="mt-3 text-sm text-text-subtle-default">{{ copyError }}</p>
            <p v-else-if="copied" role="status" class="sr-only">Item link copied.</p>

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

            <dl v-if="!client" class="item-facts mt-5">
              <div><dt>Stage</dt><dd>{{ item.stage }}</dd></div>
              <div><dt>Impact</dt><dd>{{ item.impact || 'Not scored' }}</dd></div>
              <div><dt>Effort</dt><dd>{{ item.effort || 'Not scoped' }}</dd></div>
            </dl>

            <p v-if="item.oneliner" class="mt-5 max-w-4xl text-base leading-relaxed text-text-primary-default">
              {{ item.oneliner }}
            </p>

            <div v-if="storyBlocks.length" class="mt-5 space-y-4">
              <section
                v-for="s in storyBlocks"
                :key="s.heading"
                class="item-reading-section"
              >
                <div>
                  <h3 class="roadmap-label">{{ s.heading }}</h3>
                  <RichMarkdown v-if="s.markdown && !client" :markdown="s.markdown" :overrides="resourcePreviewURLs" class="mt-1.5" />
                  <p v-else class="mt-1.5 whitespace-pre-line text-base leading-relaxed text-text-primary-default">
                    {{ s.text }}
                  </p>
                </div>
              </section>
            </div>

            <div v-if="(!client && item.tags.length) || item.themes.length" class="mt-5 flex flex-wrap items-center gap-2">
              <a
                v-for="t in client ? [] : item.themes"
                :key="'th-link' + t"
                :href="tagFilterHref(`theme:${t}`)"
                class="text-single-sm-medium relative inline-flex min-h-8 items-center rounded-lg border border-border-subtle-default/60 px-2.5 py-1 after:absolute after:-inset-x-1 after:-inset-y-1 hover:underline"
                :style="{ background: toneSurface.orange, color: toneText.orange }"
              >
                {{ t }}
              </a>
              <span
                v-for="t in client ? item.themes : []"
                :key="'th' + t"
                class="text-single-sm-medium rounded-lg border border-border-subtle-default/60 px-2.5 py-1.5"
                :style="{ background: toneSurface.orange, color: toneText.orange }"
              >
                {{ t }}
              </span>
              <a
                v-if="!client && item.themes.length"
                :href="`${boardBase}themes`"
                class="text-single-sm-medium text-text-link-default inline-flex min-h-10 items-center rounded-lg px-1.5 hover:underline"
              >
                All themes →
              </a>
              <a
                v-for="t in client ? [] : item.tags"
                :key="t"
                :href="tagFilterHref(t)"
                class="text-single-sm-medium relative inline-flex min-h-8 items-center rounded-lg border border-border-subtle-default/60 px-2.5 py-1 after:absolute after:-inset-x-1 after:-inset-y-1 hover:underline"
                :style="{ background: toneSurface[tagTone(t)], color: toneText[tagTone(t)] }"
              >
                {{ t }}
              </a>
            </div>

            <div v-if="resourceTypes.length && !client" class="mt-4 flex flex-wrap items-center gap-2">
              <span class="roadmap-label mr-1">Resources</span>
              <span
                v-for="resource in resourceTypes"
                :key="resource.label"
                class="text-single-sm-medium inline-flex items-center gap-2 rounded-lg border border-border-subtle-default/60 px-2.5 py-1.5"
                :style="{ background: toneSurfaceStrong[resource.src.tone], color: toneText[resource.src.tone] }"
              >
                <component :is="resource.src.Icon" :size="16" />
                {{ resource.label }}
                <span v-if="resource.count > 1" class="tabular-nums">×{{ resource.count }}</span>
              </span>
            </div>

            <div v-if="decoratedLinks.length && !client" class="mt-5">
              <h3 :class="label">Related resources</h3>
              <div class="mt-3 grid gap-2">
                <a
                  v-for="ln in decoratedLinks"
                  :key="ln.href"
                  :href="ln.href"
                  :target="ln.kind === 'external' || ln.kind === 'presentation' ? '_blank' : undefined"
                  :rel="ln.kind === 'external' || ln.kind === 'presentation' ? 'noopener' : undefined"
                    class="roadmap-panel roadmap-action flex items-center gap-3 rounded-xl px-3 py-2.5"
                >
                  <ImageThumbnail v-if="ln.image || isImageResource(ln.target)" :href="ln.target" />
                  <span v-else
                    class="grid size-10 shrink-0 place-items-center rounded-lg"
                    :style="{ background: toneSurfaceStrong[ln.src.tone], color: toneText[ln.src.tone] }"
                  >
                    <component :is="ln.src.Icon" :size="20" />
                  </span>
                  <span class="min-w-0 flex-1">
                    <span class="text-single-sm-medium block truncate font-semibold uppercase tracking-wider" :style="{ color: toneText[ln.src.tone] }">
                      {{ ln.label }}
                    </span>
                    <span class="text-single-base-medium text-text-primary-default block truncate" :title="ln.kind === 'external' ? ln.target : undefined">
                      {{ ln.display }}
                    </span>
                  </span>
                  <PhArrowSquareOut :size="18" class="text-icons-subtle-default" />
                </a>
              </div>
            </div>
          </div>
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
