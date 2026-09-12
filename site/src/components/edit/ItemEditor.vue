<script setup lang="ts">
// U7: full-screen item editor. Replaces the cramped DetailDrawer edit panel with a
// dedicated surface — a metadata column (title, product/horizon/stage/owner/impact/
// effort/visibility, tags) alongside the narrative editor (SectionEditor, U6) as the
// main area. Presentational + store-agnostic, like SectionEditor: the controller wires
// this to the edit store (reading current values, persisting on every `field` /
// `update:body` emit) so it can be built and tested in isolation.
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { fieldLabel, fieldTarget } from '../../lib/edit/fieldLabels';
import type { FieldError } from '../../lib/edit/validate';
import Select from '../ui/Select.vue';
import RoadmapCard from '../board/RoadmapCard.vue';
import SectionEditor from './SectionEditor.vue';
import ResourceEditor from './ResourceEditor.vue';
import { resourceTransferCount } from '../../lib/edit/resourceClient';
import TagInput from './TagInput.vue';
import ConfirmAction from '../ui/ConfirmAction.vue';
import OwnerInput from './OwnerInput.vue';
import PlannedDates from '../board/PlannedDates.vue';
import { scheduleIssue } from '../../lib/timeline';
import { PhArrowCounterClockwise, PhX, PhSparkle, PhListChecks, PhArrowRight } from '@phosphor-icons/vue';
import { isTopFocusTrap, trapFocus } from '../../lib/focusTrap';
import { PRODUCTS, HORIZONS, STAGES, LEVELS, VISIBILITIES } from '../../lib/schema';
import { toneText, productColor } from '../../lib/display';
import type { ItemVM } from '../../lib/filters';
import type { ItemHistory } from '../../lib/itemHistory';
import { formatDateTime, formatDateTimeOrDate } from '../../lib/dates';
import { useBackend } from '../../composables/useBackend';
import { normalizeCoverFraming } from '../../lib/coverPresentation';

// U5: lazy for the same reason NewWithAiDialog is lazy in Board.vue — this pulls in the
// AI client and is only ever needed once an editor with AI available opens the panel.
const RewriteWithAi = defineAsyncComponent(() => import('./RewriteWithAi.vue'));

export interface ItemEditorItem extends Partial<ItemHistory> {
  startDate?: string | null;
  endDate?: string | null;
  cover?: string | null;
  coverPosition?: string | null;
  coverFraming?: number | string | null;
  id: string;
  product: string;
  title: string;
  horizon: string;
  stage: string;
  owner: string;
  impact: string | null;
  effort: string | null;
  visibility: string;
  tags: string[];
}

const props = withDefaults(
  defineProps<{
    item: ItemEditorItem;
    editorLogin?: string;
    validationErrors?: FieldError[];
    focusRequest?: { field: string; sequence: number };
    /** Raw markdown body — bound into the SectionEditor. */
    body: string;
    /** True when the item hasn't been persisted yet (hides the Delete action). No longer
     * gates Rewrite-with-AI on its own — Rewrite now keys off whether there's body content
     * to work on (see `hasBody`/`showRewriteTrigger`), so a not-yet-synced draft with
     * content can still be rewritten with AI. Only a brand-new, still-empty item hides it. */
    isNew?: boolean;
    /** Every tag in use across items, offered as autocomplete suggestions in TagInput. */
    allTags?: string[];
    /** Every distinct owner in use across items, offered as autocomplete suggestions in OwnerInput. */
    allOwners?: string[];
    /** Fix #5: the published (live) version of this item, WITHOUT any pending edits —
     * lets each metadata field show whether it's been locally changed from what's live,
     * and offer a per-field reset. Null for a brand-new (never-published) item, which
     * never shows changed markers. */
    published?: ItemVM | null;
    /** Raw published markdown, used for section-level change navigation and review. */
    publishedBody?: string;
    /** The parent has loaded the complete markdown source for this item. */
    contentReady?: boolean;
    /** Loading the complete item failed and can be retried. */
    loadError?: boolean;
    /** Current board context, so this preview is the same card the editor replaced. */
    previewShowProduct?: boolean;
    previewShowHorizon?: boolean;
    previewShowCover?: boolean;
  }>(),
  { allTags: () => [], allOwners: () => [], published: null, previewShowCover: true, contentReady: true },
);

const emit = defineEmits<{
  (e: 'field', payload: { key: string; value: string }): void;
  (e: 'update:body', value: string): void;
  (e: 'delete'): void;
  (e: 'discard'): void;
  (e: 'close'): void;
  /** Fix #5: reset one metadata field back to its published value. */
  (e: 'resetField', key: string): void;
  /** U5: RewriteWithAi's Accept, re-emitted upward. ItemEditor is presentational and
   * never touches the edit store itself — Board.vue (which already owns `onEditorBody`/
   * `onEditorField`) is the one handler that writes to it. */
  (e: 'rewriteAccept', payload: { body: string; frontmatter: Record<string, string> }): void;
  (e: 'retry'): void;
}>();

const resourcesReady = ref(false);
const hasLoadedContent = computed(() => props.contentReady !== false);
const editorReady = computed(() => hasLoadedContent.value && resourcesReady.value);
watch(() => props.item.id, () => { resourcesReady.value = false; });
watch(hasLoadedContent, (ready) => { if (!ready) resourcesReady.value = false; });
function onResourcesReady() {
  resourcesReady.value = true;
}

// U5 (R6, R14): the trigger is gated on AI Backend availability — hidden (not
// disabled/erroring) when the canvas Backend/AI isn't present, same feature-detection
// `Board.vue` uses for "New with AI" — AND on the item being real (not `isNew`):
// Rewrite-with-AI operates on an item's existing content, so it makes no sense on a
// brand-new/empty working copy that hasn't been synced yet.
const { aiAvailable } = useBackend();
// Rewrite-with-AI needs body content to work on — not a GitHub id. So it shows on any
// synced item (they always have a body), AND on a not-yet-synced item once it has body
// content (typed or drafted via "New with AI"). It stays hidden only on a brand-new,
// still-empty item, where "New with AI" is the right tool. This lets you iterate on a
// local draft with AI before ever publishing it.
const hasBody = computed(() => (props.body ?? '').trim().length > 0);
const showRewriteTrigger = computed(() => aiAvailable.value && (!props.isNew || hasBody.value));
const rewriteOpen = ref(false);
const reviewOpen = ref(false);
const reviewPanel = ref<HTMLElement>();
let releaseReviewFocus: (() => void) | null = null;
function onRewriteAccept(payload: { body: string; frontmatter: Record<string, string> }) {
  rewriteOpen.value = false;
  emit('rewriteAccept', payload);
}

const PRODUCT_OPTIONS = PRODUCTS.map((v) => ({ value: v, label: v }));
const HORIZON_OPTIONS = HORIZONS.map((v) => ({ value: v, label: v }));
const STAGE_OPTIONS = STAGES.map((v) => ({ value: v, label: v }));
const LEVEL_OPTIONS = [{ value: '', label: 'Not scored' }, ...LEVELS.map((v) => ({ value: v, label: v }))];
const VISIBILITY_OPTIONS = VISIBILITIES.map((v) => ({ value: v, label: v }));

type FieldKey = 'title' | 'product' | 'horizon' | 'stage' | 'owner' | 'impact' | 'effort' | 'visibility' | 'startDate' | 'endDate' | 'cover' | 'coverPosition' | 'coverFraming';

/** A two-way binding for one metadata field: reads straight from the prop, emits
 * `field` on every change. No local store — the parent owns persistence and feeds
 * the (possibly overridden) value back in via `item`. */
function fieldModel(key: FieldKey) {
  return computed<string>({
    get() {
      const v = props.item[key];
      return String(v ?? '');
    },
    set(val: string) {
      emit('field', { key, value: val });
    },
  });
}

const startDateModel = fieldModel('startDate');
const endDateModel = fieldModel('endDate');
const planIssue = computed(() => scheduleIssue(props.item));
const titleModel = fieldModel('title');
const productModel = fieldModel('product');
const horizonModel = fieldModel('horizon');
const stageModel = fieldModel('stage');
const impactModel = fieldModel('impact');
const effortModel = fieldModel('effort');
const visibilityModel = fieldModel('visibility');
const coverModel = fieldModel('cover');
const coverPositionModel = fieldModel('coverPosition');
const coverFramingModel = fieldModel('coverFraming');
const previewItem = computed<ItemVM>(() => {
  const published = props.published;
  return {
    ...(published ?? {}),
    ...props.item,
    coverFraming: normalizeCoverFraming(props.item.coverFraming),
    title: props.item.title.trim() || 'Untitled',
    updated: props.item.updated ?? published?.updated ?? '',
    order: published?.order ?? 0,
    themes: published?.themes ?? [],
    oneliner: published?.oneliner ?? '',
    outcome: published?.outcome ?? '',
    sections: published?.sections ?? [],
    editUrl: published?.editUrl ?? null,
    links: published?.links ?? [],
    text: published?.text ?? '',
    href: published?.href ?? '#',
  };
});

/** Tags round-trip as a comma-separated string in frontmatter (see schema.ts and
 * lib/edit/project.ts, which splits it back into the array TagInput renders), so the
 * field value emitted here is the raw joined string, not the array. */
function onTags(tags: string[]) {
  emit('field', { key: 'tags', value: tags.join(', ') });
}

/** Same `field` emit other metadata fields use — OwnerInput binds `:model-value`/
 * `@update:model-value` (like TagInput) rather than a `fieldModel` v-model, since it
 * needs the raw current value rather than a getter/setter pair. */
function emitField(key: FieldKey, value: string) {
  emit('field', { key, value });
}

// Fix #5: per-field "changed from published" detection. Normalize scalars the same way
// store.ts's reconcile() does (stringify, null/undefined → '', trim) so an empty pending
// value reads as unchanged against a missing/null published value; tags compare as a
// case-folded set so reordering/whitespace alone never shows as "changed".
type ChangeKey = FieldKey | 'tags';
const normField = (v: unknown): string => String(v ?? '').trim();
const tagSet = (tags: string[] | undefined): Set<string> =>
  new Set((tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean));
const CHANGE_KEYS: ChangeKey[] = [
  'title',
  'product',
  'horizon',
  'stage',
  'owner',
  'impact',
  'effort',
  'visibility',
  'cover',
  'coverPosition',
  'coverFraming',
  'tags',
];
const changed = computed<Record<ChangeKey, boolean>>(() => {
  const base = props.published;
  const out = {} as Record<ChangeKey, boolean>;
  for (const key of CHANGE_KEYS) {
    if (!base) {
      out[key] = false;
    } else if (key === 'tags') {
      const a = tagSet(props.item.tags);
      const b = tagSet(base.tags);
      out[key] = a.size !== b.size || [...a].some((t) => !b.has(t));
    } else {
      out[key] = normField(props.item[key]) !== normField((base as unknown as Record<string, unknown>)[key]);
    }
  }
  return out;
});
const metadataChangeRows = computed(() => {
  const base = props.published;
  if (!base) return [];
  const rows: { key: ChangeKey; label: string; before: string; after: string; target: string }[] = [];
  const definitions: { key: ChangeKey; label: string; target: string }[] = [
    { key: 'title', label: 'Title', target: 'item-editor-title-field' },
    { key: 'product', label: 'Product', target: 'item-editor-product' },
    { key: 'horizon', label: 'Horizon', target: 'item-editor-horizon' },
    { key: 'stage', label: 'Stage', target: 'item-editor-stage' },
    { key: 'owner', label: 'Owner', target: 'item-editor-owner' },
    { key: 'impact', label: 'Impact', target: 'item-editor-impact' },
    { key: 'effort', label: 'Effort', target: 'item-editor-effort' },
    { key: 'visibility', label: 'Visibility', target: 'item-editor-visibility' },
    { key: 'tags', label: 'Tags', target: 'item-editor-tags' },
  ];
  for (const definition of definitions) {
    if (!changed.value[definition.key]) continue;
    const before = definition.key === 'tags'
      ? (base.tags ?? []).join(', ')
      : normField((base as unknown as Record<string, unknown>)[definition.key]);
    const after = definition.key === 'tags'
      ? (props.item.tags ?? []).join(', ')
      : normField((props.item as unknown as Record<string, unknown>)[definition.key]);
    rows.push({ ...definition, before: before || 'Empty', after: after || 'Empty' });
  }
  return rows;
});
const bodyChanged = computed(() => props.publishedBody !== undefined && props.body.trim() !== props.publishedBody.trim());
const editorChangeCount = computed(() => metadataChangeRows.value.length + Number(bodyChanged.value));
function focusChange(target: string) {
  reviewOpen.value = false;
  nextTick(() => {
    const el = panel.value?.querySelector<HTMLElement>(`#${target}, [data-test="${target}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el?.focus();
  });
}
const errorAttrs = (field: string) => props.validationErrors?.some(issue => issue.field === field)
  ? { 'aria-invalid': 'true' as const, 'aria-describedby': `item-error-${field}` } : {};
watch(() => props.focusRequest, async request => {
  if (!request) return;
  await nextTick();
  const target = fieldTarget(request.field);
  const el = panel.value?.querySelector<HTMLElement>(`#${target}, [data-test="${target}"]`);
  el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  const control = el?.matches('input, select, textarea, button, [tabindex]') ? el : el?.querySelector<HTMLElement>('input, select, textarea, button, [tabindex]');
  control?.focus();
}, { immediate: true });
function resetField(key: ChangeKey) {
  emit('resetField', key);
}

const bodyModel = computed<string>({
  get: () => props.body,
  set: (val: string) => emit('update:body', val),
});

const confirmation = ref<'delete' | 'discard' | null>(null);
function onDelete() { confirmation.value = 'delete'; }
function onDiscard() { confirmation.value = 'discard'; }
function confirmAction() {
  if (confirmation.value === 'delete') emit('delete');
  else if (confirmation.value === 'discard') emit('discard');
  confirmation.value = null;
}
function onClose() {
  // Same guard as `onKey`'s Escape handling: while the Rewrite panel is open, Close
  // belongs to IT — clicking the editor's own Close button underneath it must not also
  // close the whole item editor.
  if (rewriteOpen.value || resourceTransferCount.value) return;
  emit('close');
}

const panel = ref<HTMLElement>();
const titleInput = ref<HTMLInputElement>();
let releaseFocus: (() => void) | null = null;

watch(reviewOpen, async (open) => {
  releaseReviewFocus?.();
  releaseReviewFocus = null;
  if (!open) return;
  await nextTick();
  if (reviewPanel.value) releaseReviewFocus = trapFocus(reviewPanel.value);
});

function closeActions(event: Event) {
  const menu = panel.value?.querySelector<HTMLDetailsElement>('[data-test=item-actions][open]');
  if (menu && event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
}
function onKey(e: KeyboardEvent) {
  if (!isTopFocusTrap(panel.value)) return;
  // While the Rewrite panel is open, Escape belongs to IT (closing just the panel) — its
  // own document-level listener is registered after this one, so without this guard
  // pressing Escape would also close the whole item editor underneath it.
  if (e.key === 'Escape') {
    const menu = panel.value?.querySelector<HTMLDetailsElement>('[data-test=item-actions][open]');
    if (menu) { menu.open = false; menu.querySelector('summary')?.focus(); e.preventDefault(); e.stopPropagation(); } else onClose();
  }
}

onMounted(() => {
  document.addEventListener('keydown', onKey);
  document.addEventListener('pointerdown', closeActions);
  document.addEventListener('focusin', closeActions);
  if (panel.value) releaseFocus = trapFocus(panel.value);
});
watch(editorReady, (ready) => {
  // Do not place a typing cursor into a partial item. Once its source and resources
  // are ready, move focus to the title as the editor did before this loading gate.
  if (ready) void nextTick(() => titleInput.value?.focus());
}, { immediate: true });
onUnmounted(() => {
  document.removeEventListener('keydown', onKey);
  document.removeEventListener('pointerdown', closeActions);
  document.removeEventListener('focusin', closeActions);
  releaseFocus?.();
  releaseFocus = null;
  releaseReviewFocus?.();
  releaseReviewFocus = null;
});

const label = 'text-single-sm-medium font-semibold uppercase tracking-wide text-text-subtle-default';
const fieldInput =
  'text-single-sm-medium text-text-primary-default border-border-subtle-default bg-card/80 mt-1.5 min-h-10 w-full rounded-lg border px-3 py-2 outline-none transition-colors focus:border-[color:var(--color-accent-brand-default)] focus:bg-card';
// Fix #5: quiet by design — a small brand-accent dot plus a tiny reset icon, tucked next
// to the label rather than competing with the field itself.
const labelRow = 'flex items-center gap-1.5';
const changedDot = 'size-1.5 shrink-0 rounded-full bg-[color:var(--color-accent-brand-default)]';
const resetBtn =
  'ml-auto inline-flex items-center gap-1 rounded px-1 py-0.5 text-single-sm-medium text-text-subtle-default transition-colors hover:text-[color:var(--color-accent-brand-default)]';
function historyValue(at: string | undefined, date: string | undefined): string {
  return formatDateTimeOrDate(at, date);
}
function historyDatetime(at: string | undefined, date: string | undefined): string {
  return at || date || '';
}
function historyTitle(at: string | undefined, by: string | undefined, subject: string | undefined): string {
  return [formatDateTime(at), by, subject].filter(Boolean).join(' · ');
}
const historyRows = computed(() => [
  {
    label: 'Created',
    value: historyValue(props.item.createdAt, props.item.created),
    datetime: historyDatetime(props.item.createdAt, props.item.created),
    title: historyTitle(props.item.createdAt, props.item.createdBy, props.item.createdSubject),
  },
  {
    label: 'Updated',
    value: historyValue(props.item.updatedAt, props.item.updated),
    datetime: historyDatetime(props.item.updatedAt, props.item.updated),
    title: historyTitle(props.item.updatedAt, props.item.updatedBy, props.item.updatedSubject),
  },
].filter((row) => row.value));
</script>

<template>
  <div
    ref="panel"
    role="dialog"
    aria-modal="true"
    aria-labelledby="item-editor-title"
    tabindex="-1"
    :aria-busy="!editorReady"
    class="roadmap-field roadmap-drawer-field roadmap-product-detail fixed inset-0 z-50 flex flex-col outline-none"
    :style="{ '--roadmap-product-accent': productColor[item.product as keyof typeof productColor] ?? 'var(--color-icons-subtle-default)' }"
    data-test="item-editor"
  >
    <header class="item-editor-header">
      <div class="item-editor-header-main">
        <span id="item-editor-title" class="text-single-sm-medium roadmap-title inline-flex min-w-0 flex-1 items-center gap-2">
          <span class="h-4 w-1 shrink-0 rounded-full bg-[color:var(--roadmap-product-accent)]" />
          <span class="truncate">{{ isNew ? 'New item' : item.id }} — {{ item.title || 'Untitled' }}</span>
        </span>
        <button
          v-if="editorChangeCount"
          type="button"
          class="item-review-trigger"
          data-test="item-review-trigger"
          :disabled="!editorReady"
          @click="reviewOpen = true"
        >
          <PhListChecks :size="16" /> {{ editorChangeCount }} changed
        </button>
        <button
          v-if="showRewriteTrigger"
          type="button"
          class="roadmap-action border-border-subtle-default bg-card text-single-sm-medium text-text-primary-default hover:bg-surface-primary-hover inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 sm:px-3"
          aria-label="Rewrite this item with AI"
          title="Rewrite with AI"
          data-test="rewrite-with-ai-button"
          :disabled="!editorReady"
          @click="rewriteOpen = true"
        >
          <PhSparkle :size="15" />
          <span class="hidden sm:inline">Rewrite with AI</span>
        </button>
        <details class="relative shrink-0" data-test="item-actions" :inert="!editorReady">
          <summary class="roadmap-action cursor-pointer rounded-lg px-3 py-2 text-sm">Item actions</summary>
          <div class="roadmap-panel absolute right-0 top-full z-20 mt-2 grid min-w-48 gap-1 rounded-lg border border-border-subtle-default p-2 shadow-lg">
            <button v-if="!isNew" type="button" class="rounded-md px-3 py-2 text-left text-sm" :style="{ color: toneText.red }" :disabled="!!resourceTransferCount" data-test="delete-button" @click="onDelete">Delete item…</button>
            <button type="button" class="rounded-md px-3 py-2 text-left text-sm" :disabled="!!resourceTransferCount" data-test="discard-button" @click="onDiscard">Discard item changes…</button>
          </div>
        </details>
        <button
          type="button"
          class="roadmap-action text-icons-primary-default hover:text-[color:var(--color-accent-brand-default)] grid size-10 shrink-0 place-items-center rounded-lg"
          aria-label="Close"
          data-test="close-button"
          :disabled="!!resourceTransferCount"
          :title="resourceTransferCount ? 'Finish or cancel file uploads before closing' : 'Close editor'"
          @click="onClose"
        >
          <PhX :size="21" />
        </button>
      </div>
      <div class="item-decision-strip" aria-label="Item summary">
        <span><small>Product</small><b>{{ item.product }}</b></span>
        <span><small>Horizon</small><b>{{ item.horizon }}</b></span>
        <span><small>Stage</small><b>{{ item.stage }}</b></span>
        <span><small>Owner</small><b>{{ item.owner || 'Unassigned' }}</b></span>
        <span class="hidden sm:flex"><small>Impact</small><b>{{ item.impact || 'Not scored' }}</b></span>
        <span class="hidden sm:flex"><small>Effort</small><b>{{ item.effort || 'Not scoped' }}</b></span>
      </div>
    </header>

    <div class="item-editor-scroll relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
      <div v-if="!editorReady" class="item-editor-loading" role="status" aria-live="polite" data-test="item-editor-loading">
        <span class="item-editor-loading-spinner" aria-hidden="true" />
        <p class="roadmap-label">{{ loadError ? 'Item unavailable' : 'Loading item' }}</p>
        <h2>{{ loadError ? `Could not load ${item.id}` : `Preparing ${item.id}…` }}</h2>
        <p>{{ loadError ? 'Your draft is safe. Try loading the item again.' : 'Loading its sections, cover, and resources.' }}</p>
        <button v-if="loadError" type="button" class="roadmap-action" @click="$emit('retry')">Try again</button>
      </div>
      <div class="item-editor-layout grid min-h-full gap-5 p-4 sm:p-6 lg:grid-cols-[320px_minmax(0,1fr)]" :inert="!editorReady" :aria-hidden="!editorReady">
        <aside class="item-editor-rail roadmap-panel min-w-0 shrink-0 rounded-xl p-4" data-test="metadata-panel">
          <!-- Reuse the production card so cover crop, hierarchy, truncation and board context
               cannot drift from what the editor is actually changing. -->
          <div class="mb-4" data-test="editor-preview" aria-label="Card preview">
            <RoadmapCard
              :item="previewItem"
              :show-product="previewShowProduct"
              :show-horizon="previewShowHorizon"
              :show-cover="previewShowCover"
              preview
            />
          </div>

          <dl v-if="historyRows.length" class="mb-4 grid gap-2 rounded-xl border border-border-subtle-default/70 bg-card/60 px-3 py-2.5" data-test="history-metadata">
            <div v-for="row in historyRows" :key="row.label" class="flex items-baseline justify-between gap-3">
              <dt class="text-single-sm-medium text-text-subtle-default">{{ row.label }}</dt>
              <dd class="text-single-sm-medium text-text-primary-default text-right">
                <time :datetime="row.datetime" :title="row.title">{{ row.value }}</time>
              </dd>
            </div>
          </dl>

          <div>
            <div :class="labelRow">
              <label :class="label" for="item-editor-title-field">Title</label>
              <template v-if="changed.title">
                <span :class="changedDot" aria-hidden="true" data-test="changed-dot-title" />
                <button
                  type="button"
                  :class="resetBtn"
                  aria-label="Reset to published"
                  data-test="reset-field-title"
                  @click="resetField('title')"
                >
                  <PhArrowCounterClockwise :size="12" />
                </button>
              </template>
            </div>
            <input
              id="item-editor-title-field" v-bind="errorAttrs('title')"
              ref="titleInput"
              v-model="titleModel"
              type="text"
              :class="fieldInput"
              data-test="title-field"
            />
          </div>

          <div class="mt-3">
            <div :class="labelRow">
              <label :class="label" for="item-editor-product">Product</label>
              <template v-if="changed.product">
                <span :class="changedDot" aria-hidden="true" data-test="changed-dot-product" />
                <button
                  type="button"
                  :class="resetBtn"
                  aria-label="Reset to published"
                  data-test="reset-field-product"
                  @click="resetField('product')"
                >
                  <PhArrowCounterClockwise :size="12" />
                </button>
              </template>
            </div>
            <div class="mt-1.5 [&_select]:min-h-10">
              <!-- Product is only editable at creation: changing an existing item's product
                   would need the file relocated to a new folder + a new (product-prefixed) id
                   server-side. To move an existing item, duplicate it into the target product
                   and delete the original. -->
              <Select v-if="isNew" id="item-editor-product" v-bind="errorAttrs('product')" v-model="productModel" :options="PRODUCT_OPTIONS" aria-label="Product" />
              <div v-else class="flex items-center gap-2 text-single-sm-medium text-text-primary-default" data-test="product-readonly">
                <span class="h-3.5 w-1 shrink-0 rounded-full" :style="{ background: productColor[item.product as keyof typeof productColor] }" aria-hidden="true" />
                <span>{{ item.product }}</span>
                <span class="text-text-subtle-default text-xs">· set at creation</span>
              </div>
            </div>
          </div>

          <div class="mt-3">
            <div :class="labelRow">
              <label :class="label" for="item-editor-horizon">Horizon</label>
              <template v-if="changed.horizon">
                <span :class="changedDot" aria-hidden="true" data-test="changed-dot-horizon" />
                <button
                  type="button"
                  :class="resetBtn"
                  aria-label="Reset to published"
                  data-test="reset-field-horizon"
                  @click="resetField('horizon')"
                >
                  <PhArrowCounterClockwise :size="12" />
                </button>
              </template>
            </div>
            <div class="mt-1.5 [&_select]:min-h-10">
              <Select id="item-editor-horizon" v-bind="errorAttrs('horizon')" v-model="horizonModel" :options="HORIZON_OPTIONS" aria-label="Horizon" />
            </div>
          </div>

          <div class="mt-3">
            <div :class="labelRow">
              <label :class="label" for="item-editor-stage">Stage</label>
              <template v-if="changed.stage">
                <span :class="changedDot" aria-hidden="true" data-test="changed-dot-stage" />
                <button
                  type="button"
                  :class="resetBtn"
                  aria-label="Reset to published"
                  data-test="reset-field-stage"
                  @click="resetField('stage')"
                >
                  <PhArrowCounterClockwise :size="12" />
                </button>
              </template>
            </div>
            <div class="mt-1.5 [&_select]:min-h-10">
              <Select id="item-editor-stage" v-bind="errorAttrs('stage')" v-model="stageModel" :options="STAGE_OPTIONS" aria-label="Stage" />
            </div>
          </div>

          <div class="mt-3">
            <div :class="labelRow">
              <label :class="label" for="item-editor-owner">Owner</label>
              <template v-if="changed.owner">
                <span :class="changedDot" aria-hidden="true" data-test="changed-dot-owner" />
                <button
                  type="button"
                  :class="resetBtn"
                  aria-label="Reset to published"
                  data-test="reset-field-owner"
                  @click="resetField('owner')"
                >
                  <PhArrowCounterClockwise :size="12" />
                </button>
              </template>
            </div>
            <div class="mt-1.5">
              <OwnerInput
                id="item-editor-owner" v-bind="errorAttrs('owner')"
                :model-value="item.owner ?? ''"
                :suggestions="allOwners"
                data-test="owner-field"
                @update:model-value="(v) => emitField('owner', v)"
              />
            </div>
          </div>

          <div class="mt-3">
            <div :class="labelRow">
              <label :class="label" for="item-editor-impact">Impact</label>
              <template v-if="changed.impact">
                <span :class="changedDot" aria-hidden="true" data-test="changed-dot-impact" />
                <button
                  type="button"
                  :class="resetBtn"
                  aria-label="Reset to published"
                  data-test="reset-field-impact"
                  @click="resetField('impact')"
                >
                  <PhArrowCounterClockwise :size="12" />
                </button>
              </template>
            </div>
            <div class="mt-1.5 [&_select]:min-h-10">
              <Select id="item-editor-impact" v-bind="errorAttrs('impact')" v-model="impactModel" :options="LEVEL_OPTIONS" aria-label="Impact" />
            </div>
          </div>

          <div class="mt-3">
            <div :class="labelRow">
              <label :class="label" for="item-editor-effort">Effort</label>
              <template v-if="changed.effort">
                <span :class="changedDot" aria-hidden="true" data-test="changed-dot-effort" />
                <button
                  type="button"
                  :class="resetBtn"
                  aria-label="Reset to published"
                  data-test="reset-field-effort"
                  @click="resetField('effort')"
                >
                  <PhArrowCounterClockwise :size="12" />
                </button>
              </template>
            </div>
            <div class="mt-1.5 [&_select]:min-h-10">
              <Select id="item-editor-effort" v-bind="errorAttrs('effort')" v-model="effortModel" :options="LEVEL_OPTIONS" aria-label="Effort" />
            </div>
          </div>

          <div class="mt-3">
            <div :class="labelRow">
              <label :class="label" for="item-editor-visibility">Visibility</label>
              <template v-if="changed.visibility">
                <span :class="changedDot" aria-hidden="true" data-test="changed-dot-visibility" />
                <button
                  type="button"
                  :class="resetBtn"
                  aria-label="Reset to published"
                  data-test="reset-field-visibility"
                  @click="resetField('visibility')"
                >
                  <PhArrowCounterClockwise :size="12" />
                </button>
              </template>
            </div>
            <div class="mt-1.5 [&_select]:min-h-10">
              <Select id="item-editor-visibility" v-bind="errorAttrs('visibility')" v-model="visibilityModel" :options="VISIBILITY_OPTIONS" aria-label="Visibility" />
            </div>
          </div>

          <div class="mt-3">
            <div class="planned-editor">
              <h3>Planned work window</h3>
              <p>Optional dates for the timeline. They do not change the horizon or stage.</p>
              <div class="planned-editor-fields">
                <label for="item-planned-start">Planned start<input id="item-planned-start" v-bind="errorAttrs('startDate')" v-model="startDateModel" type="date" /></label>
                <label for="item-planned-end">Planned end<input id="item-planned-end" v-bind="errorAttrs('endDate')" v-model="endDateModel" type="date" :aria-invalid="planIssue === 'End before start' || !!errorAttrs('endDate')['aria-invalid']" /></label>
              </div>
              <p v-if="planIssue === 'End before start'" role="alert">End must be on or after the start date.</p>
              <PlannedDates :start-date="item.startDate" :end-date="item.endDate" />
              <button v-if="item.startDate || item.endDate" type="button" @click="emitField('startDate', ''); emitField('endDate', '')">Clear dates</button>
            </div>
            <div :class="labelRow">
              <label :class="label" for="item-editor-tags">Tags</label>
              <template v-if="changed.tags">
                <span :class="changedDot" aria-hidden="true" data-test="changed-dot-tags" />
                <button
                  type="button"
                  :class="resetBtn"
                  aria-label="Reset to published"
                  data-test="reset-field-tags"
                  @click="resetField('tags')"
                >
                  <PhArrowCounterClockwise :size="12" />
                </button>
              </template>
            </div>
            <div class="mt-1.5">
              <TagInput
                id="item-editor-tags" v-bind="errorAttrs('tags')"
                :model-value="item.tags ?? []"
                :suggestions="allTags"
                data-test="tags-field"
                @update:model-value="onTags"
              />
            </div>
          </div>
        </aside>

        <div class="min-h-[420px] min-w-0 overflow-x-auto lg:min-h-0">
          <ResourceEditor v-if="hasLoadedContent" :item-id="item.id" :editor-login="editorLogin" v-model:body="bodyModel" v-model:cover="coverModel" v-model:cover-position="coverPositionModel" v-model:cover-framing="coverFramingModel" :visibility="visibilityModel" @ready="onResourcesReady" v-slot="resources"><SectionEditor v-model="bodyModel" :published-value="publishedBody" managed-resources :managed-resource-hrefs="resources.managedResourceHrefs" /></ResourceEditor>
        </div>
      </div>
    </div>


    <div v-if="validationErrors?.length" class="sr-only">
      <p v-for="issue in validationErrors" :id="`item-error-${issue.field}`" :key="issue.field">{{ fieldLabel(issue.field) }} · {{ issue.message }}</p>
    </div>
    <slot name="save-status" />

    <div v-if="reviewOpen" class="item-change-review-shell" data-test="item-change-review">
      <button type="button" class="item-change-review-backdrop" aria-label="Close change review" @click="reviewOpen = false" />
      <aside ref="reviewPanel" class="item-change-review" role="dialog" aria-modal="true" aria-labelledby="item-change-review-title" tabindex="-1" @keydown.esc.stop.prevent="reviewOpen = false">
        <header>
          <div>
            <p class="roadmap-label">Before publishing</p>
            <h2 id="item-change-review-title">Review item changes</h2>
          </div>
          <button type="button" class="roadmap-action" aria-label="Close change review" @click="reviewOpen = false"><PhX :size="20" /></button>
        </header>
        <div class="item-change-review-body">
          <p v-if="!editorChangeCount" class="roadmap-muted">This item matches the published version.</p>
          <button
            v-for="row in metadataChangeRows"
            :key="row.key"
            type="button"
            class="item-change-row"
            @click="focusChange(row.target)"
          >
            <span><b>{{ row.label }}</b><small>Changed</small></span>
            <span class="item-change-values"><del>{{ row.before }}</del><PhArrowRight :size="14" /><ins>{{ row.after }}</ins></span>
          </button>
          <button v-if="bodyChanged" type="button" class="item-change-row" @click="focusChange('structured-fields')">
            <span><b>Write-up</b><small>Sections changed</small></span>
            <span class="item-change-values"><span>Review the marked sections</span><PhArrowRight :size="14" /></span>
          </button>
        </div>
        <footer><span>{{ editorChangeCount }} {{ editorChangeCount === 1 ? 'area' : 'areas' }} changed</span><button type="button" @click="reviewOpen = false">Continue editing</button></footer>
      </aside>
    </div>

    <!-- Teleported to <body>: keeps RewriteWithAi's DOM entirely OUTSIDE this panel's
         subtree, so its own focus trap and Escape handling are fully independent of
         ItemEditor's (a nested overlay sharing this panel's DOM would otherwise leak
         into ItemEditor's own `trapFocus` querySelectorAll scope, since Vue components
         don't create a DOM boundary). -->
    <Teleport to="body">
      <component
        :is="RewriteWithAi"
        v-if="rewriteOpen"
        :body="body"
        :frontmatter="{ stage: item.stage, horizon: item.horizon, tags: (item.tags ?? []).join(', ') }"
        @close="rewriteOpen = false"
        @accept="onRewriteAccept"
      />
    </Teleport>
  </div>
  <ConfirmAction v-if="confirmation" :title="confirmation === 'delete' ? 'Delete this item?' : 'Discard changes to this item?'"
    :message="confirmation === 'delete' ? `“${item.title}” will be marked for deletion. It stays published until you publish the changes.` : `This removes the unpublished changes to “${item.title || 'Untitled item'}” from this browser. This can’t be undone.`"
    :confirm-label="confirmation === 'delete' ? 'Mark for deletion' : 'Discard changes'" @cancel="confirmation = null" @confirm="confirmAction" />
</template>

<style scoped>
.item-editor-header{position:relative;z-index:8;flex-shrink:0;border-bottom:1px solid color-mix(in srgb,var(--color-border-subtle-default) 66%,transparent);background:color-mix(in srgb,var(--color-card) 92%,transparent);box-shadow:0 12px 28px rgb(0 0 0 / 5%);-webkit-backdrop-filter:blur(18px) saturate(.9);backdrop-filter:blur(18px) saturate(.9)}
.item-editor-header-main{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:.65rem 1rem .45rem}
.item-editor-header :is(button:disabled,[inert]){opacity:.45;cursor:wait}
.item-editor-loading{position:absolute;inset:0;z-index:7;display:grid;place-content:center;justify-items:center;gap:.65rem;padding:2rem;text-align:center;background:color-mix(in srgb,var(--color-background) 92%,transparent);-webkit-backdrop-filter:blur(12px) saturate(.8);backdrop-filter:blur(12px) saturate(.8)}.item-editor-loading h2{margin:0;font-family:var(--font-display,inherit);font-size:clamp(1.45rem,3vw,2.1rem);font-weight:600}.item-editor-loading>p:last-of-type{max-width:36ch;color:var(--color-text-subtle-default);font-size:.9rem}.item-editor-loading button{min-height:40px;margin-top:.35rem;padding:.55rem .9rem;border:1px solid color-mix(in srgb,var(--roadmap-product-accent) 45%,var(--color-border-subtle-default));border-radius:9px;background:var(--color-card);color:var(--color-text-primary-default);font-weight:650}.item-editor-loading-spinner{width:34px;height:34px;border:3px solid color-mix(in srgb,var(--roadmap-product-accent) 22%,var(--color-border-subtle-default));border-top-color:var(--roadmap-product-accent);border-radius:50%;animation:item-editor-spin .8s linear infinite}@keyframes item-editor-spin{to{transform:rotate(360deg)}}
.item-decision-strip{display:flex;gap:.35rem;padding:0 1rem .65rem;overflow-x:auto;scrollbar-width:none}
.item-decision-strip::-webkit-scrollbar{display:none}.item-decision-strip>span{display:flex;flex:0 0 auto;align-items:baseline;gap:.4rem;min-height:28px;padding:.28rem .58rem;border:1px solid color-mix(in srgb,var(--color-border-subtle-default) 70%,transparent);border-radius:999px;background:color-mix(in srgb,var(--roadmap-product-accent) 6%,var(--color-card));white-space:nowrap}.item-decision-strip small{color:var(--color-text-subtle-default);font-size:.62rem;font-weight:600;text-transform:uppercase;letter-spacing:.08em}.item-decision-strip b{font-size:.72rem;font-weight:600;color:var(--color-text-primary-default)}
.item-review-trigger{display:inline-flex;align-items:center;gap:.4rem;min-height:36px;padding:.4rem .7rem;border:1px solid color-mix(in srgb,var(--roadmap-product-accent) 38%,var(--color-border-subtle-default));border-radius:9px;background:color-mix(in srgb,var(--roadmap-product-accent) 10%,var(--color-card));color:var(--color-text-primary-default);font-size:.75rem;font-weight:650;cursor:pointer}
.item-editor-layout{width:min(100%,1480px);margin-inline:auto}.item-editor-rail{position:sticky;top:1rem;align-self:start;max-height:calc(100dvh - 190px);overflow-y:auto;scrollbar-gutter:stable;box-shadow:0 14px 34px rgb(0 0 0 / 7%)}
.planned-editor{grid-column:1/-1;border-top:1px solid var(--color-border-subtle-default);padding-top:16px;margin-top:8px}.planned-editor h3{font-size:14px;font-weight:600}.planned-editor p{font-size:12px;color:var(--color-text-subtle-default);margin:5px 0 12px}.planned-editor-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.planned-editor-fields label{display:grid;gap:6px;font-size:12px}.planned-editor input{width:100%;min-width:0;min-height:40px;border:1px solid var(--color-border-subtle-default);border-radius:8px;background:var(--color-card);color:var(--color-text-primary-default);padding:8px;color-scheme:inherit}.planned-editor button{background:none;border:0;color:var(--color-text-link-default);text-decoration:underline;min-height:32px;cursor:pointer;font-size:12px}
.item-change-review-shell{position:fixed;inset:0;z-index:90;display:flex;justify-content:flex-end}.item-change-review-backdrop{position:absolute;inset:0;border:0;background:rgb(8 10 14 / 54%);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);cursor:default}.item-change-review{position:relative;display:flex;width:min(520px,94vw);height:100%;flex-direction:column;border-left:1px solid var(--color-border-subtle-default);background:var(--color-card);box-shadow:-24px 0 64px rgb(0 0 0 / 28%);animation:item-review-in 220ms cubic-bezier(.2,.8,.2,1)}.item-change-review>header{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:1.25rem;border-bottom:1px solid var(--color-border-subtle-default)}.item-change-review h2{margin:.2rem 0 0;font-family:var(--font-display,inherit);font-size:1.55rem}.item-change-review-body{display:grid;gap:.6rem;overflow:auto;padding:1rem;flex:1}.item-change-row{display:grid;gap:.7rem;width:100%;padding:.85rem;text-align:left;border:1px solid var(--color-border-subtle-default);border-radius:12px;background:color-mix(in srgb,var(--color-card) 88%,var(--color-surface-subtle-default));color:var(--color-text-primary-default);cursor:pointer}.item-change-row:hover{border-color:color-mix(in srgb,var(--roadmap-product-accent) 52%,var(--color-border-subtle-default));transform:translateY(-1px)}.item-change-row>span:first-child{display:flex;justify-content:space-between;gap:1rem}.item-change-row small{color:var(--color-accent-brand-default);font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em}.item-change-values{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;gap:.5rem;color:var(--color-text-subtle-default);font-size:.76rem;line-height:1.4}.item-change-values :is(del,ins){overflow-wrap:anywhere;text-decoration:none}.item-change-values del{opacity:.7}.item-change-values ins{color:var(--color-text-primary-default);font-weight:600}.item-change-review>footer{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:1rem 1.25rem;border-top:1px solid var(--color-border-subtle-default);font-size:.78rem}.item-change-review>footer button{min-height:38px;border:0;border-radius:8px;padding:.5rem .8rem;background:var(--color-accent-brand-default);color:var(--color-text-primary-inverted-default);font-weight:600;cursor:pointer}@keyframes item-review-in{from{transform:translateX(22px);opacity:0}}
@media(max-width:1023px){.item-editor-rail{position:relative;top:auto;max-height:none;overflow:visible}.item-editor-layout{grid-template-columns:1fr}.item-editor-rail{display:grid;grid-template-columns:minmax(220px,320px) minmax(0,1fr);gap:0 1rem}.item-editor-rail>[data-test="editor-preview"],.item-editor-rail>[data-test="history-metadata"]{grid-column:1}.item-editor-rail>div:not([data-test="editor-preview"]):not([data-test="history-metadata"]){grid-column:2}}
@media(max-width:700px){.item-editor-header-main{gap:.4rem;padding-inline:.75rem}.item-editor-header-main details summary{font-size:0;width:38px}.item-editor-header-main details summary::after{content:'•••';font-size:14px}.item-review-trigger{font-size:0;padding:.4rem}.item-review-trigger svg{width:18px;height:18px}.item-decision-strip{padding-inline:.75rem}.item-editor-layout{padding:0}.item-editor-rail{display:block;border-radius:0;border-inline:0;padding:1rem}.item-editor-scroll>div>div:last-child{padding:1rem}.planned-editor-fields{grid-template-columns:1fr}.item-change-review{width:100vw}.item-change-review-backdrop{display:none}}
@media(prefers-reduced-motion:reduce){.item-change-review{animation:none}.item-change-row:hover{transform:none}.item-editor-loading-spinner{animation:none;border-top-color:color-mix(in srgb,var(--roadmap-product-accent) 22%,var(--color-border-subtle-default))}}
@media(prefers-reduced-transparency:reduce){.item-editor-header{background:var(--color-card);-webkit-backdrop-filter:none;backdrop-filter:none}.item-change-review-backdrop{-webkit-backdrop-filter:none;backdrop-filter:none}}
</style>
