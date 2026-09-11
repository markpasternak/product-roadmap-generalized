<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import { PhBookmarkSimple, PhCaretDown, PhCheck, PhPencilSimple, PhPlus, PhX } from '@phosphor-icons/vue';
import { activityLabel } from '../../lib/activityFilter';
import type { FilterState, SortKey } from '../../lib/filters';
import { SAVED_VIEWS_KEY, readSavedViews, sameViewSelection, snapshotView, type SavedView } from '../../lib/savedViews';

const props = defineProps<{ filters: FilterState; horizons: string[]; sort: SortKey; compact?: boolean }>();
const emit = defineEmits<{ (e: 'apply', view: SavedView): void }>();
type ViewEntry = { key: string; view: SavedView };
const views = ref<SavedView[]>([]);
const entries = computed<ViewEntry[]>(() => views.value.map(view => ({ key: `saved:${view.name}`, view })));
const selectedKey = ref<string | null>(null);
const selected = computed(() => entries.value.find(entry => entry.key === selectedKey.value)
  ?? entries.value.find(entry => sameViewSelection(entry.view, props)));
const modified = computed(() => !!selected.value && !sameViewSelection(selected.value.view, props));
const open = ref(false);
const mode = ref<'list' | 'create' | 'rename'>('list');
const editingName = ref<string | null>(null);
const name = ref('');
const error = ref('');
const message = ref('');
const removed = ref<{ view: SavedView; index: number; wasSelected: boolean } | null>(null);
const root = ref<HTMLElement>();
const panel = ref<HTMLElement>();
const opensAbove = ref(false);
const panelMaxHeight = ref('');
const panelOffset = ref(0);
const trigger = ref<HTMLButtonElement>();
const nameInput = ref<HTMLInputElement>();
const panelId = useId();
const inputId = useId();
const errorId = useId();
const sortLabels: Record<SortKey, string> = { manual: 'Board order', updated: 'Recently updated', title: 'Title A–Z', impact: 'Highest impact', effort: 'Lowest effort' };
const editorView = computed(() => mode.value === 'rename' ? views.value.find(view => view.name === editingName.value) : props);
watch(() => [props.filters, props.horizons, props.sort], () => {
  if (!removed.value) message.value = '';
}, { deep: true });

function summary(view: Pick<SavedView, 'filters' | 'horizons' | 'sort'>) {
  const { filters, horizons, sort } = view;
  const scope = [filters.layout === 'timeline' ? 'Timeline' : 'Board', filters.product ?? 'All products', horizons.length ? horizons.join(', ') : 'No horizons'];
  if (filters.activity) scope.push(activityLabel(filters.activity));
  if (filters.hygiene === 'now-early') scope.push('Early stage');
  const extra = [filters.q, filters.owner, ...filters.stage, ...filters.impact, ...filters.effort, ...filters.assets, filters.visibility, ...filters.tags,
    filters.hygiene && filters.hygiene !== 'now-early' ? filters.hygiene : null].filter(Boolean).length;
  if (extra) scope.push(`${extra} filter${extra === 1 ? '' : 's'}`);
  if (filters.layout === 'timeline') {
    scope.push(`Grouped by ${filters.timeline?.group ?? 'product'}`, filters.timeline?.fit ? 'Fit all dated items' : filters.timeline?.scale ?? 'months');
  } else {
    if (filters.group === 'product') scope.push('Grouped by product');
    scope.push(sortLabels[sort]);
  }
  return scope.join(' · ');
}

onMounted(() => {
  try { views.value = readSavedViews(localStorage.getItem(SAVED_VIEWS_KEY)); } catch { /* Saving reports unavailable storage. */ }
  selectedKey.value = selected.value?.key ?? null;
  document.addEventListener('pointerdown', onOutsidePointer);
  window.addEventListener('storage', onStorage);
  window.addEventListener('resize', positionPanel);
});
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onOutsidePointer);
  window.removeEventListener('storage', onStorage);
  window.removeEventListener('resize', positionPanel);
});

function onStorage(event: StorageEvent) {
  if (event.key !== null && event.key !== SAVED_VIEWS_KEY) return;
  views.value = readSavedViews(event.newValue);
}

function persist(next: SavedView[]) {
  try {
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(next));
    views.value = next;
    error.value = '';
    return true;
  } catch {
    error.value = 'This browser couldn’t save the change. Your saved views are unchanged.';
    return false;
  }
}
async function close(restoreFocus = true) {
  open.value = false;
  error.value = '';
  if (restoreFocus) { await nextTick(); trigger.value?.focus(); }
}
function onOutsidePointer(event: PointerEvent) {
  if (open.value && event.target instanceof Node && !root.value?.contains(event.target)) void close(false);
}
function onFocusOut(event: FocusEvent) {
  // Replacing the picker with its name form briefly blurs the removed button.
  // Clicking a label can also move focus to a page ancestor before its checkbox is activated.
  // Only dismiss for a concrete outside focus target; outside pointers are handled above.
  if (open.value && event.relatedTarget instanceof Node && !event.relatedTarget.contains(root.value ?? null)
    && !root.value?.contains(event.relatedTarget)) void close(false);
}
async function positionPanel() {
  if (!open.value) return;
  panelMaxHeight.value = '';
  await nextTick();
  if (!open.value || !root.value || !panel.value) return;
  const anchor = root.value.getBoundingClientRect();
  if (props.compact) {
    const width = panel.value.getBoundingClientRect().width;
    const left = anchor.right - width;
    panelOffset.value = Math.min(Math.max(left, 16), Math.max(16, window.innerWidth - width - 16)) - left;
  }
  const below = window.innerHeight - anchor.bottom - 12;
  const navigationBottom = document.querySelector('.site-navbar')?.getBoundingClientRect().bottom ?? 0;
  const above = anchor.top - Math.max(12, navigationBottom + 12);
  opensAbove.value = panel.value.getBoundingClientRect().height > below && above > below;
  panelMaxHeight.value = `${Math.max(0, opensAbove.value ? above : below)}px`;
}
function toggle() {
  if (open.value) { void close(); return; }
  mode.value = 'list';
  error.value = '';
  open.value = true;
  void positionPanel();
}
function apply(entry: ViewEntry) {
  selectedKey.value = entry.key;
  emit('apply', snapshotView(entry.view.name, entry.view.filters, entry.view.horizons, entry.view.sort));
  message.value = '';
  void close();
}
function reset() {
  if (selected.value) apply(selected.value);
}
async function edit(view?: SavedView) {
  mode.value = view ? 'rename' : 'create';
  editingName.value = view?.name ?? null;
  name.value = view?.name ?? [props.filters.layout === 'timeline' ? 'Timeline' : null, props.filters.product, props.horizons.join(', ')].filter(Boolean).join(' — ');
  error.value = '';
  open.value = true;
  await positionPanel();
  nameInput.value?.focus();
  nameInput.value?.select();
}
function save() {
  const nextName = name.value.trim();
  if (!nextName) { error.value = 'Give this view a name.'; nameInput.value?.focus(); return; }
  if (views.value.filter(view => view.name !== editingName.value)
    .some(view => view.name.toLowerCase() === nextName.toLowerCase())) {
    error.value = 'That name is already in use. Try another name.';
    nameInput.value?.focus();
    return;
  }
  const previous = views.value.find(view => view.name === editingName.value);
  if (mode.value === 'rename' && !previous) { error.value = 'This view is no longer available.'; return; }
  if (!previous && views.value.length >= 30) { error.value = 'You can save up to 30 views. Remove one to make room.'; return; }
  let next: SavedView;
  try {
    const source = previous ?? props;
    next = snapshotView(nextName, source.filters, source.horizons, source.sort);
  } catch { error.value = 'This view couldn’t be saved. Check the name and filters, then try again.'; return; }
  if (!persist(previous ? views.value.map(view => view.name === previous.name ? next : view) : [...views.value, next])) return;
  if (!previous || selectedKey.value === `saved:${previous.name}`) selectedKey.value = `saved:${next.name}`;
  removed.value = null;
  message.value = previous ? `Renamed to “${next.name}”.` : `Saved “${next.name}”.`;
  void close();
}
function update() {
  const entry = selected.value;
  if (!entry || !modified.value) return;
  let next: SavedView;
  try { next = snapshotView(entry.view.name, props.filters, props.horizons, props.sort); }
  catch { error.value = 'This view couldn’t be updated. Check the filters and try again.'; return; }
  if (!persist(views.value.map(view => view.name === next.name ? next : view))) return;
  removed.value = null;
  message.value = `Updated “${next.name}”.`;
  trigger.value?.focus();
}
function remove() {
  const index = views.value.findIndex(view => view.name === editingName.value);
  const view = views.value[index];
  if (!view) return;
  const wasSelected = selectedKey.value === `saved:${view.name}`;
  if (!persist(views.value.filter((_, i) => i !== index))) return;
  removed.value = { view, index, wasSelected };
  if (wasSelected) selectedKey.value = null;
  message.value = `Removed “${view.name}”.`;
  void close();
}
function undo() {
  const entry = removed.value;
  if (!entry) return;
  if (views.value.length >= 30 || views.value.some(view => view.name.toLowerCase() === entry.view.name.toLowerCase())) {
    error.value = 'Your saved views changed in another tab. Make room or rename the matching view before restoring this one.';
    return;
  }
  const next = [...views.value];
  next.splice(entry.index, 0, entry.view);
  if (!persist(next)) return;
  if (entry.wasSelected) selectedKey.value = `saved:${entry.view.name}`;
  removed.value = null;
  message.value = `Restored “${entry.view.name}”.`;
  trigger.value?.focus();
}
</script>

<template>
  <div ref="root" class="saved-views" :class="{ compact }" aria-label="Roadmap views" @focusout="onFocusOut" @keydown.esc.stop.prevent="close()">
    <div class="view-toolbar">
      <button ref="trigger" type="button" class="view-trigger roadmap-action" :aria-expanded="open" :aria-controls="panelId"
        :aria-label="compact ? 'View options and saved views' : `Choose view: ${selected?.view.name ?? 'Current view'}${modified ? ', modified' : ''}`" @click="toggle">
        <PhBookmarkSimple v-if="!compact" :size="16" aria-hidden="true" />
        <span class="view-current-name">{{ compact ? 'View' : selected?.view.name ?? 'Current view' }}</span>
        <PhCaretDown :size="12" aria-hidden="true" class="view-caret" :class="{ 'is-open': open }" />
      </button>
      <span v-if="modified && !compact" class="view-modified">Modified</span>
      <div v-if="!compact" class="view-actions">
        <button v-if="modified" type="button" class="view-text-action" @click="reset">Reset</button>
        <button v-if="selected && modified" type="button" class="view-text-action view-save" @click="update">Save changes</button>
        <button v-else type="button" class="view-text-action view-save" @click="edit()"><PhPlus :size="14" aria-hidden="true" /> Save view</button>
      </div>
    </div>

    <section v-if="open" :id="panelId" ref="panel" class="view-popover" :class="{ 'opens-above': opensAbove }" :style="{ maxHeight: panelMaxHeight, transform: compact ? `translateX(${panelOffset}px)` : undefined }" :aria-label="mode === 'list' ? 'Choose a view' : mode === 'create' ? 'Save view' : 'Rename view'">
      <div class="view-popover-heading">
        <h2>{{ mode === 'list' ? (compact ? 'View options' : 'Your saved views') : mode === 'create' ? 'Save this view' : 'Edit saved view' }}</h2>
        <button type="button" class="view-icon-action" aria-label="Close views" @click="close()"><PhX :size="16" aria-hidden="true" /></button>
      </div>
      <template v-if="mode === 'list'">
        <slot name="settings" />
        <div v-if="compact && modified" class="view-current-status">
          <span>{{ selected?.view.name }} · Modified</span>
          <button type="button" class="view-text-action" @click="reset">Reset</button>
          <button type="button" class="view-text-action view-save" @click="update">Save changes</button>
        </div>
        <div class="view-list">
          <div class="view-section-label"><span>Saved in this browser</span></div>
          <p v-if="!views.length" class="view-empty">Save a combination of filters to come back to it.</p>
          <div v-for="entry in entries" :key="entry.key" class="view-saved-row">
            <button type="button" class="view-option" :aria-pressed="selected?.key === entry.key" @click="apply(entry)">
              <span class="view-option-copy"><span>{{ entry.view.name }}</span><small>{{ summary(entry.view) }}</small></span>
              <PhCheck v-if="selected?.key === entry.key" :size="16" aria-hidden="true" />
            </button>
            <button type="button" class="view-icon-action" :aria-label="`Edit view ${entry.view.name}`" @click="edit(entry.view)"><PhPencilSimple :size="15" aria-hidden="true" /></button>
          </div>
        </div>
        <div class="view-popover-footer">
          <button type="button" class="view-text-action view-save" @click="edit()"><PhPlus :size="15" aria-hidden="true" /> Save as new view</button>
        </div>
      </template>
      <form v-else class="view-form" @submit.prevent="save">
        <label :for="inputId">View name</label>
        <input :id="inputId" ref="nameInput" v-model="name" maxlength="60" autocomplete="off" :aria-invalid="!!error" :aria-describedby="error ? errorId : undefined" @input="error = ''" />
        <p v-if="editorView" class="view-scope">{{ summary(editorView) }}</p>
        <p class="view-help">{{ mode === 'create' ? 'Keeps your filters, layout, grouping and date window.' : 'Renaming keeps this view’s saved filters and layout.' }} Saved in this browser; not synced across devices.</p>
        <p v-if="error" :id="errorId" role="alert" class="view-error">{{ error }}</p>
        <div class="view-form-actions">
          <button v-if="mode === 'rename'" type="button" class="view-text-action view-remove" @click="remove">Remove view</button>
          <span class="view-form-spacer" />
          <button type="button" class="view-text-action" @click="close()">Cancel</button>
          <button type="submit" class="view-submit roadmap-primary-action roadmap-action">{{ mode === 'create' ? 'Save view' : 'Save name' }}</button>
        </div>
      </form>
    </section>
    <div v-if="message" class="view-feedback">
      <span role="status">{{ message }}</span>
      <button v-if="removed" type="button" class="view-text-action" @click="undo">Undo</button>
    </div>
    <p v-if="error && (!open || mode === 'list')" role="alert" class="view-error">{{ error }}</p>
  </div>
</template>

<style scoped>
.saved-views.compact { margin-bottom: 0; flex-shrink: 0; }
.compact .view-popover { width: min(380px, calc(100vw - 32px)); left: auto; right: 0; }
.compact .view-feedback { position: absolute; right: 0; top: 100%; width: 260px; padding: .5rem; background: var(--color-card); z-index: 31; }
.view-current-status { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; padding: .5rem 1rem; }
.view-current-status > span { flex-basis: 100%; color: var(--roadmap-ink-muted); }
.saved-views { position: relative; margin-bottom: 1rem; font-size: .8125rem; color: var(--roadmap-ink); }
.view-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: .6rem; min-height: 40px; }
.view-trigger { display: inline-flex; align-items: center; gap: .65rem; min-width: 0; max-width: min(320px, 100%); min-height: 40px; padding: .5rem .75rem; border: 1px solid var(--roadmap-glass-border); border-radius: 6px; background: var(--color-card); font-weight: 500; cursor: pointer; }
.view-current-name { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.view-trigger > svg { flex-shrink: 0; color: var(--roadmap-ink-muted); }
.view-caret { margin-left: .5rem; }
.view-caret.is-open { transform: rotate(180deg); }
.view-modified { color: var(--roadmap-ink-muted); font-size: .7rem; }
.view-actions { display: flex; align-items: center; gap: .65rem; }
.view-text-action { display: inline-flex; justify-content: center; align-items: center; gap: .3rem; min-height: 40px; padding: .4rem .25rem; font-size: .75rem; font-weight: 500; color: var(--roadmap-ink-muted); cursor: pointer; white-space: nowrap; }
.view-save { color: var(--color-accent-brand-default); }
.view-popover { display: flex; flex-direction: column; position: absolute; top: calc(100% + 6px); left: 0; width: min(380px, 100%); z-index: 30; overflow: hidden; border: 1px solid var(--roadmap-glass-border); border-radius: 12px; background: var(--color-card); box-shadow: var(--roadmap-warm-shadow), 0 4px 12px rgb(0 0 0 / 6%); }
.view-popover.opens-above { top: auto; bottom: calc(100% + 6px); }
.view-popover-heading { display: flex; flex-shrink: 0; align-items: center; justify-content: space-between; padding: .6rem .75rem .4rem 1rem; }
.view-popover-heading h2 { margin: 0; font-size: .875rem; font-weight: 600; }
.view-icon-action { display: inline-grid; place-items: center; width: 36px; height: 36px; flex-shrink: 0; border-radius: 5px; color: var(--roadmap-ink-muted); cursor: pointer; }
.view-list { min-height: 0; max-height: min(360px, 48dvh); overflow-y: auto; overscroll-behavior: contain; padding: 0 .5rem .5rem; scrollbar-width: thin; }
.view-section-label { margin: .5rem .5rem .35rem; font-size: .68rem; font-weight: 500; color: var(--roadmap-ink-muted); }
.view-option { display: flex; align-items: center; justify-content: space-between; gap: .75rem; flex: 1; width: 100%; min-width: 0; text-align: left; padding: .7rem .5rem; border-radius: 6px; cursor: pointer; }
.view-option[aria-pressed='true'] { background: var(--color-surface-subtle-default); }
.view-option > svg { color: var(--color-accent-brand-default); flex-shrink: 0; }
.view-option-copy { display: grid; gap: .3rem; min-width: 0; }
.view-option-copy > span { font-weight: 500; overflow-wrap: anywhere; }
.view-option-copy small { color: var(--roadmap-ink-muted); font-size: .68rem; line-height: 1.5; }
.view-saved-row { display: flex; align-items: center; gap: .25rem; }
.view-empty { color: var(--roadmap-ink-muted); font-size: .75rem; line-height: 1.6; padding: .3rem .5rem .5rem; }
.view-popover-footer { flex-shrink: 0; padding: .3rem 1rem; border-top: 1px solid var(--roadmap-glass-border); }
.view-form { overflow-y: auto; overscroll-behavior: contain; padding: .3rem 1rem 1rem; }
.view-form label { display: block; font-size: .75rem; font-weight: 500; margin-bottom: .5rem; }
.view-form input { width: 100%; min-height: 44px; padding: .6rem .7rem; border: 1px solid var(--roadmap-control-border); border-radius: 6px; background: var(--color-card); color: var(--roadmap-ink); font: inherit; }
.view-scope { padding: .8rem 0 .5rem; color: var(--roadmap-ink); font-size: .75rem; line-height: 1.6; }
.view-help { color: var(--roadmap-ink-muted); font-size: .7rem; line-height: 1.6; }
.view-form-actions { display: flex; align-items: center; gap: .75rem; margin-top: 1rem; }
.view-form-spacer { flex: 1; }
.view-submit { min-height: 40px; border-radius: 6px; padding: .5rem .8rem; font-size: .75rem; font-weight: 500; cursor: pointer; }
.view-remove, .view-error { color: var(--color-data-red-border-primary-default); }
.view-error { margin-top: .75rem; font-size: .75rem; line-height: 1.5; }
.view-feedback { display: flex; align-items: center; gap: .75rem; margin-top: .4rem; color: var(--roadmap-ink-muted); font-size: .75rem; }
.view-feedback .view-text-action { min-height: 28px; color: var(--color-accent-brand-default); }
@media (hover: hover) and (pointer: fine) {
  .view-trigger:hover, .view-icon-action:hover, .view-option:hover { background: var(--color-surface-subtle-default); }
  .view-text-action:hover { text-decoration: underline; text-underline-offset: 3px; }
}
@media (max-width: 640px) {
  .view-trigger { max-width: 100%; }
  .view-toolbar { gap: .25rem .6rem; }
  .view-form input { font-size: 16px; }
  .view-icon-action { width: 40px; height: 40px; }
}
</style>
