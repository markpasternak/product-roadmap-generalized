<script setup lang="ts">
// Structured editor for an item body: a pinned "spine" of the 3 canonical sections
// every roadmap item has (One-liner, Why it matters, What ships), plus a reorderable
// list of optional sections — with a toggle to the whole-body MarkdownEditor (U5) for
// free-form editing. Both modes drive the same `v-model` string — structured edits
// re-assemble on every keystroke/reorder, and the markdown editor is re-parsed back
// into the spine/optional fields when toggling to structured mode. Presentational
// only: no store coupling, the parent (U7's ItemEditor) owns persistence.
//
// The preamble (the `# Title` line the metadata Title field manages, plus any lead-in
// prose) is kept internally so it round-trips, but is never rendered — a roadmap item
// HAS a known shape, and that shape starts at "One-liner", not at a raw text box.
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import {
  parseSections,
  splitSpine,
  assembleBody,
  CANONICAL_SECTIONS,
  OPTIONAL_SECTIONS,
  type Section,
} from '../../lib/edit/sections';
import { wrapInline, prefixLines, insertLink } from '../../lib/edit/markdownFormat';
import { renderMarkdown } from '../../lib/edit/renderMarkdown';
import MarkdownEditor from './MarkdownEditor.vue';
import Select from '../ui/Select.vue';
import {
  PhArrowDown,
  PhArrowUp,
  PhDotsSixVertical,
  PhX,
  PhTarget,
  PhHeart,
  PhCube,
  PhFileText,
  PhTextB,
  PhTextItalic,
  PhListBullets,
  PhListNumbers,
  PhLinkSimple,
  PhCode,
  PhQuotes,
} from '@phosphor-icons/vue';
import { toneSurfaceStrong, toneText, type Tone } from '../../lib/display';

const model = defineModel<string>({ default: '' });

const mode = ref<'structured' | 'markdown'>('structured');

// Same heading → tone/icon mapping DetailDrawer uses to render a published item's
// sections (see DetailDrawer's `sectionTone`/`sectionIcon`) — kept in sync by hand so a
// structured field's heading carries the identical accent it will render with once
// published, in and out of edit mode.
function sectionTone(heading: string): Tone {
  const h = heading.toLowerCase();
  if (h.includes('target')) return 'orange';
  if (h.includes('why')) return 'red';
  if (h.includes('ships')) return 'violet';
  return 'blue';
}
function sectionIcon(heading: string) {
  const h = heading.toLowerCase();
  if (h.includes('target')) return PhTarget;
  if (h.includes('why')) return PhHeart;
  if (h.includes('ships')) return PhCube;
  return PhFileText;
}

type OptionalRow = Section & { id: number };

const preamble = ref('');
const canonicalBodies = ref<string[]>(CANONICAL_SECTIONS.map(() => ''));
const optional = ref<OptionalRow[]>([]);
let nextId = 0;

function loadFromModel() {
  const spine = splitSpine(parseSections(model.value));
  preamble.value = spine.preamble;
  canonicalBodies.value = spine.canonical.map((s) => s.body);
  optional.value = spine.optional.map((s) => ({ id: nextId++, heading: s.heading, body: s.body }));
}
loadFromModel();

function currentAssembled(): string {
  const canonical: Section[] = CANONICAL_SECTIONS.map((heading, i) => ({ heading, body: canonicalBodies.value[i] }));
  const opt: Section[] = optional.value.map(({ heading, body }) => ({ heading, body }));
  return assembleBody(preamble.value, canonical, opt);
}

// Keeps the structured fields in sync with the underlying string whenever it changes
// from something other than this component's own structured edits — the markdown
// editor typing in markdown mode, or the parent resetting the whole body (e.g. loading
// a different item). Our own structured edits assemble `model` from the same state
// below, so `currentAssembled()` already matches the new value and this is a no-op for
// them; it only does real work for external changes.
watch(model, (next) => {
  if (currentAssembled() === next) return;
  loadFromModel();
});

function emitUpdate() {
  model.value = currentAssembled();
}

// --- Click-to-edit / render-on-blur (multi-line section bodies only) -----------------
//
// Exactly one section body can be "in edit" (a raw-markdown textarea) at a time; every
// other body renders its markdown. `editingKey` identifies which one by a stable key —
// `spine-${i}` for the canonical bodies (i >= 1; the One-liner at i === 0 stays a plain
// `<input>` and never participates in this), `opt-${row.id}` for optional sections.
const editingKey = ref<string | null>(null);

function spineKey(i: number): string {
  return `spine-${i}`;
}
function optKey(id: number): string {
  return `opt-${id}`;
}
function isBlank(body: string): boolean {
  return body.trim() === '';
}

function enterEdit(key: string) {
  editingKey.value = key;
  nextTick(() => {
    const el = activeTextarea.value;
    if (!el) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  });
}

// The textarea's own `@blur` is the only thing that clears `editingKey` — clicking a
// different section's rendered display sets `editingKey` to *that* section on `@click`.
// Both happen synchronously in the same browser task (mousedown moves focus off the old
// textarea → blur fires → mouseup/click fires on the new display), so Vue's reactivity
// only ever flushes the final value; there's no intermediate "nothing is editing" frame
// to flicker through. A toolbar button's `@mousedown.prevent` (below) is what keeps a
// button click from ever reaching this at all.
function exitEdit() {
  editingKey.value = null;
  activeTextarea.value = null;
}

// --- Spine (canonical, pinned, not reorderable/removable) ---------------------------

const ONE_LINER_INDEX = 0;

const oneLinerValue = computed(() => canonicalBodies.value[ONE_LINER_INDEX].replace(/\n+$/, ''));

// Fix #7: the One-liner is meant to stay a single short sentence — a quiet length hint
// (never a hard limit; nothing here blocks typing or truncates) nudges once it runs long.
const ONE_LINER_SOFT_LIMIT = 120;
const oneLinerLength = computed(() => oneLinerValue.value.length);
const oneLinerOverLimit = computed(() => oneLinerLength.value > ONE_LINER_SOFT_LIMIT);

function updateOneLiner(value: string) {
  canonicalBodies.value[ONE_LINER_INDEX] = value === '' ? '' : `${value}\n`;
  emitUpdate();
}

function updateCanonical(index: number, value: string) {
  canonicalBodies.value[index] = value;
  emitUpdate();
}

// --- Optional sections (reorderable, removable) --------------------------------------

function updateOptional(index: number, value: string) {
  optional.value[index] = { ...optional.value[index], body: value };
  emitUpdate();
}

function removeOptional(index: number) {
  const row = optional.value[index];
  if (editingKey.value === optKey(row.id)) exitEdit();
  optional.value = optional.value.filter((_, i) => i !== index);
  emitUpdate();
}

function moveOptional(from: number, to: number) {
  if (to < 0 || to >= optional.value.length || from === to) return;
  const arr = [...optional.value];
  const [row] = arr.splice(from, 1);
  arr.splice(to, 0, row);
  optional.value = arr;
  emitUpdate();
}

function moveUp(index: number) {
  moveOptional(index, index - 1);
}
function moveDown(index: number) {
  moveOptional(index, index + 1);
}

// Drag-to-reorder among optional sections only (HTML5 DnD). Keyboard-accessible
// up/down buttons above cover the same operation for anyone not using a mouse. Drag
// listeners live on the row container, entirely separate from the body's click-to-edit
// handler, so starting a drag never gets swallowed by (or swallows) entering edit mode.
const dragIndex = ref<number | null>(null);
const dragOverIndex = ref<number | null>(null);

function onDragStart(index: number, e: DragEvent) {
  dragIndex.value = index;
  e.dataTransfer?.setData('text/plain', String(index));
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
}
function onDragOverRow(index: number, e: DragEvent) {
  if (dragIndex.value === null) return;
  e.preventDefault();
  dragOverIndex.value = index;
}
function onDropRow(index: number, e: DragEvent) {
  e.preventDefault();
  const from = dragIndex.value;
  dragIndex.value = null;
  dragOverIndex.value = null;
  if (from === null) return;
  moveOptional(from, index);
}
function onDragEnd() {
  dragIndex.value = null;
  dragOverIndex.value = null;
}

// --- Add section ----------------------------------------------------------------------

const ADD_PLACEHOLDER = '';
const ADD_CUSTOM = '__custom__';

const addChoice = ref(ADD_PLACEHOLDER);
const showCustomInput = ref(false);
const customHeading = ref('');
const customInputRef = ref<HTMLInputElement>();

const addOptions = computed(() => {
  const present = new Set(optional.value.map((s) => s.heading.toLowerCase()));
  const available = OPTIONAL_SECTIONS.filter((h) => !present.has(h.toLowerCase()));
  return [
    { value: ADD_PLACEHOLDER, label: '+ Add section' },
    ...available.map((h) => ({ value: h, label: h })),
    { value: ADD_CUSTOM, label: 'Custom section…' },
  ];
});

function addOptionalSection(heading: string) {
  const trimmed = heading.trim();
  if (!trimmed) return;
  const id = nextId++;
  optional.value = [...optional.value, { id, heading: trimmed, body: '' }];
  emitUpdate();
  // A freshly-added section starts empty — open it straight into edit mode (the same
  // "ready to type immediately" affordance the old auto-focus gave it).
  enterEdit(optKey(id));
}

watch(addChoice, (value) => {
  if (value === ADD_PLACEHOLDER) return;
  if (value === ADD_CUSTOM) {
    showCustomInput.value = true;
    addChoice.value = ADD_PLACEHOLDER;
    nextTick(() => customInputRef.value?.focus());
    return;
  }
  addOptionalSection(value);
  addChoice.value = ADD_PLACEHOLDER;
});

function commitCustomSection() {
  if (!showCustomInput.value) return;
  const heading = customHeading.value;
  showCustomInput.value = false;
  customHeading.value = '';
  addOptionalSection(heading);
}

function cancelCustomSection() {
  showCustomInput.value = false;
  customHeading.value = '';
}

// --- Shared bits ------------------------------------------------------------------------

// The scroll container for the structured fields — used to re-size every textarea at once.
const structuredRef = ref<HTMLElement | null>(null);

// Auto-grows a textarea to fit its content. Deferred to the next frame: measuring
// scrollHeight synchronously at mount inside the full-screen editor happens before the
// overlay's width has settled, so wrapped multi-line content is under-counted and CLIPPED.
// A post-layout measurement gets the true wrapped height.
function autosize(el: Element | null) {
  const ta = el as HTMLTextAreaElement | null;
  if (!ta) return;
  const apply = () => {
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(apply);
  else apply();
}

// Re-size every visible section textarea — on mount, when content loads/changes (an item
// opens, or the parent resets the body), and when toggling back to structured mode — so
// pre-filled multi-line content is sized correctly instead of clamped to `rows`.
function resizeAll() {
  structuredRef.value?.querySelectorAll('textarea').forEach((ta) => autosize(ta));
}
onMounted(() => nextTick(resizeAll));
watch([canonicalBodies, optional, mode], () => nextTick(resizeAll), { deep: true });

function toggleMode() {
  mode.value = mode.value === 'structured' ? 'markdown' : 'structured';
}

// --- Formatting toolbar (contextual: only for the section currently being edited) ------
//
// Applies markdown-compatible formatting to whichever textarea is currently in edit mode
// — at most one exists in the DOM at a time (see `editingKey` above), so `activeTextarea`
// is just bound to it directly via the textarea's `:ref` callback rather than tracked
// through focus events. The transforms themselves (`wrapInline`/`prefixLines`/
// `insertLink`) are pure string functions from lib/edit/markdownFormat — this is just the
// DOM plumbing: mutate the textarea's value directly, then dispatch a real `input` event
// so the existing `@input="updateCanonical/updateOptional"` handler on that element runs
// exactly as it would for a keystroke, keeping this the single path that updates the
// model. Finally the selection is restored (covering the just-inserted/-wrapped text, or
// a placeholder like the link URL) and the field is re-measured for autosize.
const activeTextarea = ref<HTMLTextAreaElement | null>(null);

// Only ADOPT the element on mount; never null it from the unmount side. Vue applies v-for
// ref callbacks in DOM order, so when editing moves to an EARLIER section the new textarea
// mounts (sets this) before the old one unmounts — nulling on unmount would clobber the
// just-set ref, breaking focus + the toolbar. `activeTextarea` is cleared deterministically
// by the blur-driven `exitEdit` instead.
function bindEditingTextarea(el: Element | null) {
  if (el) {
    activeTextarea.value = el as HTMLTextAreaElement;
    autosize(el);
  }
}

type FormatKind = 'bold' | 'italic' | 'code' | 'bullet' | 'numbered' | 'quote' | 'link';

const toolbarButtons: { kind: FormatKind; icon: unknown; label: string }[] = [
  { kind: 'bold', icon: PhTextB, label: 'Bold' },
  { kind: 'italic', icon: PhTextItalic, label: 'Italic' },
  { kind: 'bullet', icon: PhListBullets, label: 'Bullet list' },
  { kind: 'numbered', icon: PhListNumbers, label: 'Numbered list' },
  { kind: 'link', icon: PhLinkSimple, label: 'Link' },
  { kind: 'code', icon: PhCode, label: 'Inline code' },
  { kind: 'quote', icon: PhQuotes, label: 'Quote' },
];

// One transform per toolbar button, all sharing the same (value, selStart, selEnd) ->
// FormatResult shape from lib/edit/markdownFormat — keeps `applyFormat` itself a plain
// dispatch table lookup rather than a branchy if/else.
const FORMAT_TRANSFORMS: Record<FormatKind, (value: string, s: number, e: number) => ReturnType<typeof wrapInline>> = {
  bold: (v, s, e) => wrapInline(v, s, e, '**'),
  italic: (v, s, e) => wrapInline(v, s, e, '*'),
  code: (v, s, e) => wrapInline(v, s, e, '`'),
  bullet: (v, s, e) => prefixLines(v, s, e, '- '),
  numbered: (v, s, e) => prefixLines(v, s, e, (i) => `${i + 1}. `),
  quote: (v, s, e) => prefixLines(v, s, e, '> '),
  link: (v, s, e) => insertLink(v, s, e),
};

function applyFormat(kind: FormatKind) {
  const el = activeTextarea.value;
  if (!el) return;
  const s = el.selectionStart ?? el.value.length;
  const e = el.selectionEnd ?? el.value.length;
  const value = el.value;

  const result = FORMAT_TRANSFORMS[kind](value, s, e);

  el.value = result.value;
  el.dispatchEvent(new Event('input', { bubbles: true }));

  nextTick(() => {
    el.focus();
    el.setSelectionRange(result.selStart, result.selEnd);
    autosize(el);
  });
}

function onToolbarKeydown(e: KeyboardEvent) {
  const meta = e.metaKey || e.ctrlKey;
  if (!meta) return;
  if (e.key.toLowerCase() === 'b') {
    e.preventDefault();
    applyFormat('bold');
  } else if (e.key.toLowerCase() === 'i') {
    e.preventDefault();
    applyFormat('italic');
  } else if (e.key.toLowerCase() === 'k') {
    e.preventDefault();
    applyFormat('link');
  }
}
</script>

<template>
  <div class="flex h-full flex-col gap-3">
    <div class="flex shrink-0 items-center justify-between gap-3">
      <span class="roadmap-label">{{ mode === 'structured' ? 'Sections' : 'Markdown' }}</span>
      <button
        type="button"
        data-test="mode-toggle"
        class="roadmap-action text-single-sm-medium border-border-subtle-default bg-card/80 inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-text-primary-default"
        @click="toggleMode"
      >
        {{ mode === 'structured' ? 'Markdown' : 'Structured' }}
      </button>
    </div>

    <div v-if="mode === 'structured'" ref="structuredRef" class="flex flex-1 flex-col gap-6 overflow-y-auto pr-1" data-test="structured-fields">
      <!-- Pinned spine: always present, canonical order, not removable/reorderable. Styled
           to read like the published item's own headings + prose (see DetailDrawer's
           storyBlocks) rather than a form: a small tone-tinted icon + a display-font
           heading, then a borderless field in the same prose typography as the rendered
           page, with only a quiet hover/focus tint marking it editable. -->
      <div class="flex flex-col gap-5" data-test="spine">
        <div v-for="(heading, i) in CANONICAL_SECTIONS" :key="heading" data-test="spine-field" class="flex flex-col gap-1.5">
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <span
                class="grid size-6 shrink-0 place-items-center rounded-md"
                :style="{ background: toneSurfaceStrong[sectionTone(heading)], color: toneText[sectionTone(heading)] }"
                aria-hidden="true"
              >
                <component :is="sectionIcon(heading)" :size="13" />
              </span>
              <label class="font-display roadmap-title text-[1.05rem]" data-test="spine-label" :for="`spine-${i}`">{{ heading }}</label>
            </div>
            <!-- Fix #7: a quiet nudge, not a limit — the One-liner is meant to be one short
                 sentence, so the count flips from muted to a brand-accent tone past the soft
                 120-char limit, but typing is never blocked and the text is never truncated. -->
            <span
              v-if="i === 0"
              class="text-single-sm-medium shrink-0 tabular-nums transition-colors"
              :class="oneLinerOverLimit ? 'text-[color:var(--color-accent-brand-default)]' : 'text-text-subtle-default'"
              data-test="oneliner-hint"
              :data-over-limit="oneLinerOverLimit"
            >
              {{ oneLinerOverLimit ? `${oneLinerLength} — Keep it to one sentence.` : `${oneLinerLength} characters` }}
            </span>
          </div>
          <!-- One-liner is the item's lead line — a larger, display-ish single line,
               matching how it presents once published, just above the fold. Always a
               plain input: never markdown-rendered, never click-to-edit. -->
          <input
            v-if="i === 0"
            :id="`spine-${i}`"
            data-test="spine-oneliner"
            type="text"
            class="se-field w-full bg-transparent text-lg leading-relaxed text-text-primary-default outline-none placeholder:text-text-subtle-default/70"
            :value="oneLinerValue"
            placeholder="One sentence. What is this, in short?"
            @input="updateOneLiner(($event.target as HTMLInputElement).value)"
          />
          <template v-else>
            <!-- Editing this section: the contextual formatting toolbar sits directly
                 above its textarea (relocated from the old fixed top toolbar), acting on
                 this textarea specifically. `@mousedown.prevent` on every button keeps
                 focus (and the browser's native selection) on the textarea, so a click
                 doesn't blur it out of edit mode before the transform runs. -->
            <div v-if="editingKey === spineKey(i)" class="flex flex-col gap-1.5">
              <div
                role="toolbar"
                aria-label="Formatting"
                data-test="format-toolbar"
                class="border-border-subtle-default bg-card/60 flex shrink-0 items-center gap-0.5 self-start rounded-lg border p-1"
              >
                <button
                  v-for="btn in toolbarButtons"
                  :key="btn.kind"
                  type="button"
                  :aria-label="btn.label"
                  :title="btn.label"
                  :data-test="`format-${btn.kind}`"
                  class="text-icons-subtle-default hover:bg-surface-transparent-orange-25 hover:text-text-primary-default active:bg-surface-transparent-orange-25 grid size-7 place-items-center rounded-md transition-colors"
                  @mousedown.prevent
                  @click="applyFormat(btn.kind)"
                >
                  <component :is="btn.icon" :size="14" />
                </button>
              </div>
              <textarea
                :id="`spine-${i}`"
                data-test="spine-textarea"
                :ref="(el) => bindEditingTextarea(el as Element | null)"
                rows="2"
                placeholder="Add detail…"
                class="se-field roadmap-prose w-full resize-none overflow-hidden bg-transparent outline-none placeholder:text-text-subtle-default/70"
                :value="canonicalBodies[i]"
                @input="
                  updateCanonical(i, ($event.target as HTMLTextAreaElement).value);
                  autosize($event.target as Element);
                "
                @blur="exitEdit"
                @keydown="onToolbarKeydown"
              />
            </div>
            <!-- Not editing: rendered markdown, click anywhere to switch to the raw
                 textarea above (and focus it). -->
            <div
              v-else
              data-test="spine-display"
              class="se-display roadmap-prose w-full cursor-text"
              role="button"
              tabindex="0"
              :aria-label="`Edit ${heading}`"
              @click="enterEdit(spineKey(i))"
              @keydown.enter.prevent="enterEdit(spineKey(i))"
            >
              <span v-if="isBlank(canonicalBodies[i])" class="se-placeholder">Click to add detail…</span>
              <div v-else v-html="renderMarkdown(canonicalBodies[i])" />
            </div>
          </template>
        </div>
      </div>

      <div class="border-border-subtle-default/50 border-t" />

      <!-- Optional sections: draggable to reorder, removable. Same styled-heading + prose
           treatment as the spine; the drag handle and row controls stay quiet (hidden until
           hover) so the list still reads as a page, not a table of form rows. -->
      <div class="flex flex-col gap-1" data-test="optional-list">
        <div
          v-for="(row, i) in optional"
          :key="row.id"
          data-test="optional-field"
          draggable="true"
          class="group/row relative -mx-2 flex flex-col gap-1.5 rounded-lg border-t-2 border-transparent px-2 py-2.5 transition-colors duration-150"
          :class="[
            dragIndex === i ? 'opacity-40' : '',
            dragOverIndex === i && dragIndex !== i ? '!border-[color:var(--color-accent-brand-default)]' : '',
          ]"
          @dragstart="onDragStart(i, $event)"
          @dragover="onDragOverRow(i, $event)"
          @drop="onDropRow(i, $event)"
          @dragend="onDragEnd"
        >
          <div class="flex items-center justify-between gap-2">
            <div class="flex min-w-0 items-center gap-2">
              <span
                data-test="drag-handle"
                class="text-icons-subtle-default -ml-1 cursor-grab opacity-0 transition-opacity group-hover/row:opacity-100 active:cursor-grabbing"
                aria-hidden="true"
              >
                <PhDotsSixVertical :size="14" />
              </span>
              <span
                class="grid size-6 shrink-0 place-items-center rounded-md"
                :style="{ background: toneSurfaceStrong[sectionTone(row.heading)], color: toneText[sectionTone(row.heading)] }"
                aria-hidden="true"
              >
                <component :is="sectionIcon(row.heading)" :size="13" />
              </span>
              <span data-test="optional-label" class="font-display roadmap-title truncate text-[1.05rem]">
                {{ row.heading }}
              </span>
            </div>
            <div class="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100">
              <button
                type="button"
                data-test="move-up"
                :disabled="i === 0"
                aria-label="Move section up"
                class="text-icons-subtle-default hover:text-text-primary-default grid size-6 place-items-center rounded-md disabled:pointer-events-none disabled:opacity-30"
                @click="moveUp(i)"
              >
                <PhArrowUp :size="12" />
              </button>
              <button
                type="button"
                data-test="move-down"
                :disabled="i === optional.length - 1"
                aria-label="Move section down"
                class="text-icons-subtle-default hover:text-text-primary-default grid size-6 place-items-center rounded-md disabled:pointer-events-none disabled:opacity-30"
                @click="moveDown(i)"
              >
                <PhArrowDown :size="12" />
              </button>
              <button
                type="button"
                data-test="remove-section"
                :aria-label="`Remove ${row.heading}`"
                class="text-icons-subtle-default hover:text-text-primary-default grid size-6 place-items-center rounded-md"
                @click="removeOptional(i)"
              >
                <PhX :size="13" />
              </button>
            </div>
          </div>
          <div v-if="editingKey === optKey(row.id)" class="flex flex-col gap-1.5">
            <div
              role="toolbar"
              aria-label="Formatting"
              data-test="format-toolbar"
              class="border-border-subtle-default bg-card/60 flex shrink-0 items-center gap-0.5 self-start rounded-lg border p-1"
            >
              <button
                v-for="btn in toolbarButtons"
                :key="btn.kind"
                type="button"
                :aria-label="btn.label"
                :title="btn.label"
                :data-test="`format-${btn.kind}`"
                class="text-icons-subtle-default hover:bg-surface-transparent-orange-25 hover:text-text-primary-default active:bg-surface-transparent-orange-25 grid size-7 place-items-center rounded-md transition-colors"
                @mousedown.prevent
                @click="applyFormat(btn.kind)"
              >
                <component :is="btn.icon" :size="14" />
              </button>
            </div>
            <textarea
              :ref="(el) => bindEditingTextarea(el as Element | null)"
              data-test="optional-textarea"
              rows="3"
              placeholder="Add detail…"
              class="se-field roadmap-prose w-full resize-none overflow-hidden bg-transparent outline-none placeholder:text-text-subtle-default/70"
              :value="row.body"
              @input="
                updateOptional(i, ($event.target as HTMLTextAreaElement).value);
                autosize($event.target as Element);
              "
              @blur="exitEdit"
              @keydown="onToolbarKeydown"
            />
          </div>
          <div
            v-else
            data-test="optional-display"
            class="se-display roadmap-prose w-full cursor-text"
            role="button"
            tabindex="0"
            :aria-label="`Edit ${row.heading}`"
            @click="enterEdit(optKey(row.id))"
            @keydown.enter.prevent="enterEdit(optKey(row.id))"
          >
            <span v-if="isBlank(row.body)" class="se-placeholder">Click to add detail…</span>
            <div v-else v-html="renderMarkdown(row.body)" />
          </div>
        </div>
      </div>

      <!-- Add section: menu of unused optional headings, plus a custom heading. -->
      <div class="flex items-center gap-2">
        <Select
          v-if="!showCustomInput"
          v-model="addChoice"
          data-test="add-section-select"
          class="w-56"
          aria-label="Add section"
          :options="addOptions"
        />
        <input
          v-else
          ref="customInputRef"
          v-model="customHeading"
          data-test="custom-heading-input"
          type="text"
          placeholder="Section name…"
          class="text-single-sm-medium text-text-primary-default border-border-subtle-default bg-card/80 w-56 rounded-lg border px-3 py-2 outline-none transition-colors focus:border-[color:var(--color-accent-brand-default)] focus:bg-card"
          @keydown.enter.prevent="commitCustomSection"
          @keydown.esc.prevent.stop="cancelCustomSection"
          @blur="commitCustomSection"
        />
      </div>
    </div>

    <MarkdownEditor v-else v-model="model" class="min-h-0 flex-1" />
  </div>
</template>

<style scoped>
/* Quiet editable affordance for the WYSIWYG structured fields: at rest a field is
   transparent and flush with the surrounding prose (no grey box), so the editor reads
   as a styled document rather than a form. Hovering hints it's editable with a faint
   tint; focusing adds the same soft brand-accent left bar `.roadmap-card-active` /
   `.roadmap-selected-filter` use elsewhere for "this is the active one" — enough signal
   without a heavy border. */
.se-field {
  display: block;
  margin: -0.2rem -0.6rem;
  padding: 0.2rem 0.6rem;
  border-radius: 8px;
  transition:
    background-color 0.18s ease,
    box-shadow 0.18s ease;
}
.se-field:hover {
  background: var(--color-surface-subtle-default);
}
.se-field:focus {
  outline: none;
  background: var(--color-surface-subtle-default);
  box-shadow: inset 3px 0 0 var(--color-accent-brand-default);
}

/* The rendered (non-editing) view of a section body — same prose typography as the
   published page, plus a quiet hover tint and pointer cursor hinting it's clickable.
   The display↔edit swap itself is instant (a plain v-if toggle); a fade would cost more
   in perceived responsiveness than it'd add here. */
.se-display {
  margin: -0.2rem -0.6rem;
  padding: 0.2rem 0.6rem;
  border-radius: 8px;
  transition: background-color 0.12s ease;
}
.se-display:hover,
.se-display:focus-visible {
  background: var(--color-surface-subtle-default);
}
.se-display:focus-visible {
  outline: none;
  box-shadow: inset 3px 0 0 var(--color-accent-brand-default);
}
.se-placeholder {
  color: var(--color-text-subtle-default);
  opacity: 0.7;
  font-style: italic;
}
</style>
