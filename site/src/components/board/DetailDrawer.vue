<script setup lang="ts">
import PlannedDates from './PlannedDates.vue';
import RichMarkdown from '../markdown/RichMarkdown.vue';
import ImageThumbnail from '../markdown/ImageThumbnail.vue';
import { installItemImageViewer } from '../../lib/itemImageViewer';
import { createItemViewPreference } from '../../lib/itemViewPreference';
import { installItemToc } from '../../lib/itemToc';
import '../../styles/item-toc.css';
import '../../styles/image-viewer.css';
import '../../styles/reading-toolbar.css';
import { isImageResource, repositoryAssetPath, resourceHref } from '../../lib/resources';
import { resourcePreviewURLs } from '../../lib/edit/resourceClient';
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { animate, type AnimationPlaybackControlsWithThen } from 'motion';
import { installItemHeader } from '../../lib/itemHeader';
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
  PhCalendarBlank,
  PhStack,
  PhTrash,
  PhArrowCounterClockwise,
  PhGithubLogo,
} from '@phosphor-icons/vue';
import {
  horizonDot,
  productColor,
  toneSurface,
  toneSurfaceStrong,
  toneText,
  tagTone,
} from '../../lib/display';
import { linkSource, linkDisplay } from '../../lib/sources';
import { isTopFocusTrap, trapFocus } from '../../lib/focusTrap';
import type { ItemVM } from '../../lib/filters';
import { formatDateTime, formatDateTimeOrDate } from '../../lib/dates';
import { coverPresentationStyle } from '../../lib/coverPresentation';
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

const CLIENT_SECTIONS = new Set(['Why it matters', 'Scope', 'What ships', 'What shipped', 'Bottom line']);
const visibleSections = computed(() => {
  const sections = props.item?.sections ?? [];
  return props.client ? sections.filter((s) => CLIENT_SECTIONS.has(s.heading)) : sections;
});
const storyBlocks = computed(() => {
  const blocks = [...visibleSections.value];
  if (props.item?.outcome) blocks.unshift({ heading: 'Target outcome', text: props.item.outcome });
  return blocks;
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
const detailCoverSrc = computed(() => {
  if (!props.item?.cover) return '';
  const path = repositoryAssetPath(props.item.cover);
  return (path && resourcePreviewURLs.value[path]) || resourceHref(props.item.cover, boardBase);
});
const detailCoverStyle = computed(() => coverPresentationStyle(props.item?.coverPosition, props.item?.coverFraming));
const expandedSections = ref(new Set<string>());
function isLongSection(text: string) { return text.trim().length > 420; }
function sectionExpanded(heading: string) { return expanded.value || expandedSections.value.has(heading); }
function toggleSection(heading: string) {
  const next = new Set(expandedSections.value);
  if (next.has(heading)) next.delete(heading); else next.add(heading);
  expandedSections.value = next;
}

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
  if (!props.item) return;
  const url = new URL(boardBase, location.origin);
  url.searchParams.set('item', props.item.id);
  void copy(url.href);
}
const scrollArea = ref<HTMLElement>();
watch(() => props.item?.id, () => {
  imageViewer?.close();
  expandedSections.value = new Set();
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
          <div :key="item.id" class="drawer-reading-content px-4 pb-5 sm:px-6 sm:pb-6">
            <header class="detail-masthead" :class="{ 'has-cover': detailCoverSrc, 'is-completed': item.horizon === 'Completed' }">
              <div v-if="detailCoverSrc" class="detail-cover-media roadmap-cover-media" :style="detailCoverStyle" aria-hidden="true">
                <img class="roadmap-cover-backdrop" :src="detailCoverSrc" alt="" decoding="async" />
                <img class="roadmap-cover-fill" :src="detailCoverSrc" alt="" decoding="async" />
                <img class="roadmap-cover-reveal" :src="detailCoverSrc" alt="" decoding="async" />
                <span class="detail-cover-treatment" />
              </div>
              <div class="detail-masthead-copy min-w-0">
                <h2 data-reading-title id="drawer-title" tabindex="-1" aria-live="polite" class="roadmap-display roadmap-title text-[1.75rem] sm:text-[2.1rem]">
                  {{ item.title }}
                </h2>
                <PlannedDates :start-date="item.startDate" :end-date="item.endDate" />
              </div>
            </header>

            <div class="detail-summary">
              <dl class="detail-status-summary">
                <div>
                  <dt>Horizon</dt>
                  <dd><span class="detail-status-dot" :style="{ background: horizonDot[item.horizon as keyof typeof horizonDot] }" />{{ item.horizon }}</dd>
                </div>
                <div><dt>Stage</dt><dd>{{ item.stage }}</dd></div>
                <div v-if="!client"><dt>Impact</dt><dd>{{ item.impact || 'Not scored' }}</dd></div>
                <div v-if="!client"><dt>Effort</dt><dd>{{ item.effort || 'Not scoped' }}</dd></div>
              </dl>

              <div class="detail-utility-row">
                <p class="detail-provenance roadmap-muted">
                  <span v-if="item.owner && !client" class="inline-flex items-center gap-2">
                    <PhUser :size="17" /> {{ item.owner }}
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

                <div v-if="!client" class="detail-actions">
                  <a
                    v-if="!expanded"
                    :href="item.href"
                    class="roadmap-action detail-action"
                  >
                    Open full page <PhArrowSquareOut :size="18" />
                  </a>
                  <a
                    v-if="item.editUrl"
                    :href="item.editUrl"
                    target="_blank"
                    rel="noopener"
                    class="roadmap-action detail-action"
                    title="Open this item's markdown file in GitHub's editor"
                  >
                    <PhGithubLogo :size="18" class="text-icons-subtle-default" /> Edit on GitHub
                  </a>
                </div>
              </div>
            </div>

            <p v-if="copyError" role="alert" class="mt-3 text-sm text-text-subtle-default">{{ copyError }}</p>
            <p v-else-if="copied" role="status" class="sr-only">Item link copied.</p>

            <div class="detail-reading-grid" data-reading-layout>
            <div data-reading-body>

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

            <p v-if="item.oneliner" class="mt-5 max-w-4xl text-base leading-relaxed text-text-primary-default">
              {{ item.oneliner }}
            </p>

            <div v-if="storyBlocks.length" class="mt-5 space-y-4">
              <section
                v-for="s in storyBlocks"
                :key="s.heading"
                class="item-reading-section item-section-surface"
                :class="{ 'item-section-preview': isLongSection(s.text) && !sectionExpanded(s.heading) }"
              >
                <div :class="{ 'item-section-body-collapsed': isLongSection(s.text) && !sectionExpanded(s.heading) }">
                  <h3 class="roadmap-section-heading">{{ s.heading }}</h3>
                  <RichMarkdown v-if="s.markdown && !client" :markdown="s.markdown" :overrides="resourcePreviewURLs" class="mt-1.5" />
                  <p v-else class="mt-1.5 whitespace-pre-line text-base leading-relaxed text-text-primary-default">
                    {{ s.text }}
                  </p>
                </div>
                <button
                  v-if="isLongSection(s.text) && !expanded"
                  type="button"
                  class="item-section-toggle roadmap-action"
                  :aria-expanded="sectionExpanded(s.heading)"
                  @click="toggleSection(s.heading)"
                >
                  {{ sectionExpanded(s.heading) ? 'Show less' : 'Continue reading' }}
                </button>
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

            <p v-if="historyValue(item.createdAt, item.created) && !client" class="detail-created roadmap-muted">
              Created
              <time
                :datetime="historyDatetime(item.createdAt, item.created)"
                :title="historyTitle(item.createdAt, item.createdBy, item.createdSubject)"
              >{{ historyValue(item.createdAt, item.created) }}</time>
            </p>

            <div v-if="decoratedLinks.length && !client" class="mt-5">
              <h3 :class="label" data-toc-heading>Related resources</h3>
              <div class="resource-reading-grid mt-3">
                <a
                  v-for="ln in decoratedLinks"
                  :key="ln.href"
                  :href="ln.href"
                  :target="ln.kind === 'external' || ln.kind === 'presentation' ? '_blank' : undefined"
                  :rel="ln.kind === 'external' || ln.kind === 'presentation' ? 'noopener' : undefined"
                    class="roadmap-panel roadmap-action resource-reading-card flex items-center gap-3 rounded-xl px-3 py-2.5"
                    :class="{ 'resource-reading-card-image': ln.image || isImageResource(ln.target) }"
                >
                  <ImageThumbnail v-if="ln.image || isImageResource(ln.target)" :href="ln.target" :alt="ln.title || ln.label" />
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
                    <span class="resource-reading-title text-single-base-medium text-text-primary-default block" :title="ln.display">
                      {{ ln.display }}
                    </span>
                  </span>
                  <span class="resource-reading-open"><span>Open</span><PhArrowSquareOut :size="18" /></span>
                </a>
              </div>
            </div>
            </div>
            <nav class="item-toc" data-item-toc aria-label="On this page" hidden></nav>
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
.detail-expanded { padding: 0; }
.detail-expanded > .drawer-panel { width: 100%; max-width: none; height: 100dvh; max-height: 100dvh; border-radius: 0; }
.drawer-reading-content { padding-top: 12px; }
.detail-expanded .drawer-reading-content { width: 100%; max-width: 1200px; margin-inline: auto; }
.detail-expanded :deep(.item-reading-section p) { max-width: 75ch; }
.detail-masthead { position:relative; padding:10px 0 18px; overflow:hidden; }
.detail-masthead.has-cover {
  display:flex;
  min-height:210px;
  margin:-12px -1rem 0;
  padding:28px 1rem 22px;
  align-items:flex-end;
  isolation:isolate;
}
.detail-cover-media,.detail-cover-treatment { position:absolute; inset:0; width:100%; height:100%; }
.detail-cover-media { z-index:-1; overflow:hidden; background:color-mix(in srgb,var(--roadmap-product-accent) 18%,var(--color-surface-subtle-default)); }
.detail-cover-media .roadmap-cover-fill,.detail-cover-media .roadmap-cover-reveal { filter:saturate(.82) contrast(.94); }
.detail-cover-treatment {
  background:
    linear-gradient(to top,var(--color-card) 0%,color-mix(in srgb,var(--color-card) 96%,transparent) 18%,color-mix(in srgb,var(--color-card) 62%,transparent) 52%,color-mix(in srgb,var(--color-card) 14%,transparent) 100%),
    color-mix(in srgb,var(--roadmap-product-accent) 14%,transparent);
}
:global(:root[data-theme='dark']) .detail-cover-media .roadmap-cover-fill,:global(:root[data-theme='dark']) .detail-cover-media .roadmap-cover-reveal { filter:brightness(.7) saturate(.68) contrast(.92); }
:global(:root[data-theme='dark']) .detail-cover-treatment {
  background:
    linear-gradient(to top,var(--color-card) 0%,color-mix(in srgb,var(--color-card) 97%,transparent) 20%,color-mix(in srgb,var(--color-card) 68%,transparent) 54%,color-mix(in srgb,var(--color-card) 20%,transparent) 100%),
    color-mix(in srgb,var(--roadmap-product-accent) 20%,transparent);
}
.detail-masthead.is-completed .detail-cover-media .roadmap-cover-fill,.detail-masthead.is-completed .detail-cover-media .roadmap-cover-reveal { filter:grayscale(.28) saturate(.65) contrast(.94); }
:global(:root[data-theme='dark']) .detail-masthead.is-completed .detail-cover-media .roadmap-cover-fill,:global(:root[data-theme='dark']) .detail-masthead.is-completed .detail-cover-media .roadmap-cover-reveal { filter:brightness(.72) grayscale(.3) saturate(.52) contrast(.92); }
.detail-masthead-copy { position:relative; width:100%; max-width:960px; }
.detail-masthead.has-cover .detail-masthead-copy { width:fit-content; max-width:min(100%,960px); padding:14px 16px; border:1px solid color-mix(in srgb,var(--color-border-subtle-default) 72%,transparent); border-radius:13px; background:color-mix(in srgb,var(--color-card) 92%,transparent); box-shadow:0 12px 32px rgb(10 14 20 / 18%),inset 0 1px 0 rgb(255 255 255 / 20%); -webkit-backdrop-filter:blur(12px) saturate(.86); backdrop-filter:blur(12px) saturate(.86); }
:global(:root[data-theme='dark']) .detail-masthead.has-cover .detail-masthead-copy { border-color:rgb(255 255 255 / 14%); background:color-mix(in srgb,var(--color-card) 90%,transparent); box-shadow:0 14px 36px rgb(0 0 0 / 34%),inset 0 1px 0 rgb(255 255 255 / 7%); }
.detail-masthead .roadmap-title { max-width:28ch; font-size:clamp(1.75rem,2.6vw,2.25rem); line-height:1.08; }
.detail-summary { padding:14px 0; border-bottom:1px solid var(--color-border-subtle-default); }
.detail-status-summary { display:flex; flex-wrap:wrap; gap:10px clamp(24px,4vw,48px); margin:0; }
.detail-status-summary dt { color:var(--color-text-subtle-default); font-size:11px; font-weight:600; line-height:1.3; }
.detail-status-summary dd { display:flex; align-items:center; gap:7px; margin:4px 0 0; color:var(--color-text-primary-default); font-size:14px; font-weight:600; line-height:1.35; }
.detail-status-dot { width:4px; height:16px; border-radius:999px; }
.detail-utility-row { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:10px 20px; margin-top:13px; padding-top:12px; border-top:1px solid color-mix(in srgb,var(--color-border-subtle-default) 72%,transparent); }
.detail-provenance { display:flex; flex:1 1 360px; flex-wrap:wrap; align-items:center; gap:7px 18px; margin:0; font-size:13px; }
.detail-actions { display:flex; flex-wrap:wrap; align-items:center; gap:6px; }
.detail-action { display:inline-flex; min-height:34px; align-items:center; gap:7px; padding:0 9px; border-radius:7px; color:var(--color-text-subtle-default); font-size:13px; font-weight:500; }
.detail-action:hover { color:var(--color-text-primary-default); background:color-mix(in srgb,var(--roadmap-ink) 6%,transparent); }
.detail-reading-grid { margin-top:20px; }
.detail-created { display:flex; flex-wrap:wrap; gap:5px; margin:24px 0 0; font-size:12px; }
.detail-created time { color:var(--color-text-primary-default); }
.detail-expanded .detail-masthead.has-cover { min-height:clamp(190px,26vh,260px); }
.detail-expanded .detail-masthead .roadmap-title { max-width:30ch; font-size:clamp(2rem,3.2vw,2.5rem); line-height:1.06; }
@media (min-width:640px) {
  .detail-masthead.has-cover { margin-inline:-1.5rem; padding-inline:1.5rem; }
}
@media (max-width:560px) {
  .detail-masthead.has-cover { min-height:165px; }
  .detail-masthead .roadmap-title { font-size:clamp(1.7rem,8vw,2.1rem); }
  .detail-status-summary { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); width:100%; }
  .detail-utility-row { align-items:flex-start; }
}
@media (prefers-reduced-transparency:reduce) { .detail-masthead.has-cover .detail-masthead-copy { background:color-mix(in srgb,var(--color-card) 98%,transparent);-webkit-backdrop-filter:none;backdrop-filter:none; } }
@media (prefers-contrast:more) { .detail-masthead.has-cover .detail-masthead-copy { border-color:var(--color-text-primary-default);background:var(--color-card);box-shadow:none; } }
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
