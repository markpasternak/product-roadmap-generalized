<script setup lang="ts">
// U7: full-screen item editor. Replaces the cramped DetailDrawer edit panel with a
// dedicated surface — a metadata column (title, product/horizon/stage/owner/impact/
// effort/visibility, tags) alongside the narrative editor (SectionEditor, U6) as the
// main area. Presentational + store-agnostic, like SectionEditor: the controller wires
// this to the edit store (reading current values, persisting on every `field` /
// `update:body` emit) so it can be built and tested in isolation.
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref } from 'vue';
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
import { PhArrowCounterClockwise, PhX, PhSparkle } from '@phosphor-icons/vue';
import { isTopFocusTrap, trapFocus } from '../../lib/focusTrap';
import { PRODUCTS, HORIZONS, STAGES, LEVELS, VISIBILITIES } from '../../lib/schema';
import { toneText, productColor } from '../../lib/display';
import type { ItemVM } from '../../lib/filters';
import type { ItemHistory } from '../../lib/itemHistory';
import { formatDateTime, formatDateTimeOrDate } from '../../lib/dates';
import { useBackend } from '../../composables/useBackend';

// U5: lazy for the same reason NewWithAiDialog is lazy in Board.vue — this pulls in the
// AI client and is only ever needed once an editor with AI available opens the panel.
const RewriteWithAi = defineAsyncComponent(() => import('./RewriteWithAi.vue'));

export interface ItemEditorItem extends Partial<ItemHistory> {
  startDate?: string | null;
  endDate?: string | null;
  cover?: string | null;
  coverPosition?: string | null;
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
    /** Current board context, so this preview is the same card the editor replaced. */
    previewShowProduct?: boolean;
    previewShowHorizon?: boolean;
    previewShowCover?: boolean;
  }>(),
  { allTags: () => [], allOwners: () => [], published: null, previewShowCover: true },
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
}>();

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
function onRewriteAccept(payload: { body: string; frontmatter: Record<string, string> }) {
  rewriteOpen.value = false;
  emit('rewriteAccept', payload);
}

const PRODUCT_OPTIONS = PRODUCTS.map((v) => ({ value: v, label: v }));
const HORIZON_OPTIONS = HORIZONS.map((v) => ({ value: v, label: v }));
const STAGE_OPTIONS = STAGES.map((v) => ({ value: v, label: v }));
const LEVEL_OPTIONS = [{ value: '', label: 'Not scored' }, ...LEVELS.map((v) => ({ value: v, label: v }))];
const VISIBILITY_OPTIONS = VISIBILITIES.map((v) => ({ value: v, label: v }));

type FieldKey = 'title' | 'product' | 'horizon' | 'stage' | 'owner' | 'impact' | 'effort' | 'visibility' | 'startDate' | 'endDate' | 'cover' | 'coverPosition';

/** A two-way binding for one metadata field: reads straight from the prop, emits
 * `field` on every change. No local store — the parent owns persistence and feeds
 * the (possibly overridden) value back in via `item`. */
function fieldModel(key: FieldKey) {
  return computed<string>({
    get() {
      const v = props.item[key];
      return typeof v === 'string' ? v : (v ?? '');
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
const previewItem = computed<ItemVM>(() => {
  const published = props.published;
  return {
    ...(published ?? {}),
    ...props.item,
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
  // trapFocus above moves focus to the first focusable element in the panel (the
  // Close button, which precedes the metadata column in DOM order). Move it to the
  // Title field instead — the more useful landing spot for both +Add (type a title
  // immediately) and editing an existing item — after the DOM has settled.
  void nextTick(() => titleInput.value?.focus());
});
onUnmounted(() => {
  document.removeEventListener('keydown', onKey);
  document.removeEventListener('pointerdown', closeActions);
  document.removeEventListener('focusin', closeActions);
  releaseFocus?.();
  releaseFocus = null;
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
    class="roadmap-field roadmap-drawer-field roadmap-product-detail fixed inset-0 z-50 flex flex-col outline-none"
    :style="{ '--roadmap-product-accent': productColor[item.product as keyof typeof productColor] ?? 'var(--color-icons-subtle-default)' }"
    data-test="item-editor"
  >
    <div class="shrink-0 flex items-center justify-between gap-4 border-b border-border-subtle-default/60 px-4 py-3 sm:px-6">
      <span id="item-editor-title" class="text-single-sm-medium roadmap-title inline-flex min-w-0 flex-1 items-center gap-2">
        <span class="h-4 w-1 shrink-0 rounded-full bg-[color:var(--color-accent-brand-default)]" />
        <span class="truncate">{{ isNew ? 'New item' : item.id }} — {{ item.title || 'Untitled' }}</span>
      </span>
      <button
        v-if="showRewriteTrigger"
        type="button"
        class="roadmap-action border-border-subtle-default bg-card text-single-sm-medium text-text-primary-default hover:bg-surface-primary-hover inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 sm:px-3"
        aria-label="Rewrite this item with AI"
        title="Rewrite with AI"
        data-test="rewrite-with-ai-button"
        @click="rewriteOpen = true"
      >
        <PhSparkle :size="15" />
        <span class="hidden sm:inline">Rewrite with AI</span>
      </button>
      <details class="relative shrink-0" data-test="item-actions">
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

    <div class="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
      <div class="grid min-h-full gap-5 p-4 sm:p-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div class="roadmap-panel min-w-0 shrink-0 rounded-xl p-4 lg:overflow-y-auto" data-test="metadata-panel">
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
              id="item-editor-title-field"
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
              <Select v-if="isNew" id="item-editor-product" v-model="productModel" :options="PRODUCT_OPTIONS" aria-label="Product" />
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
              <Select id="item-editor-horizon" v-model="horizonModel" :options="HORIZON_OPTIONS" aria-label="Horizon" />
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
              <Select id="item-editor-stage" v-model="stageModel" :options="STAGE_OPTIONS" aria-label="Stage" />
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
                id="item-editor-owner"
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
              <Select id="item-editor-impact" v-model="impactModel" :options="LEVEL_OPTIONS" aria-label="Impact" />
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
              <Select id="item-editor-effort" v-model="effortModel" :options="LEVEL_OPTIONS" aria-label="Effort" />
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
              <Select id="item-editor-visibility" v-model="visibilityModel" :options="VISIBILITY_OPTIONS" aria-label="Visibility" />
            </div>
          </div>

          <div class="mt-3">
            <div class="planned-editor">
              <h3>Planned work window</h3>
              <p>Optional dates for the timeline. They do not change the horizon or stage.</p>
              <div class="planned-editor-fields">
                <label for="item-planned-start">Planned start<input id="item-planned-start" v-model="startDateModel" type="date" /></label>
                <label for="item-planned-end">Planned end<input id="item-planned-end" v-model="endDateModel" type="date" :aria-invalid="planIssue === 'End before start'" /></label>
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
                id="item-editor-tags"
                :model-value="item.tags ?? []"
                :suggestions="allTags"
                data-test="tags-field"
                @update:model-value="onTags"
              />
            </div>
          </div>
        </div>

        <div class="min-h-[420px] min-w-0 overflow-x-auto lg:min-h-0">
          <ResourceEditor :item-id="item.id" :editor-login="editorLogin" v-model:body="bodyModel" v-model:cover="coverModel" v-model:cover-position="coverPositionModel" :visibility="visibilityModel" v-slot="resources"><SectionEditor v-model="bodyModel" managed-resources :managed-resource-hrefs="resources.managedResourceHrefs" /></ResourceEditor>
        </div>
      </div>
    </div>


    <slot name="save-status" />

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
.planned-editor{grid-column:1/-1;border-top:1px solid var(--color-border-subtle-default);padding-top:16px;margin-top:8px}.planned-editor h3{font-size:14px;font-weight:600}.planned-editor p{font-size:12px;color:var(--color-text-subtle-default);margin:5px 0 12px}.planned-editor-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.planned-editor-fields label{display:grid;gap:6px;font-size:12px}.planned-editor input{width:100%;min-width:0;min-height:40px;border:1px solid var(--color-border-subtle-default);border-radius:8px;background:var(--color-card);color:var(--color-text-primary-default);padding:8px;color-scheme:inherit}.planned-editor button{background:none;border:0;color:var(--color-text-link-default);text-decoration:underline;min-height:32px;cursor:pointer;font-size:12px}
</style>
