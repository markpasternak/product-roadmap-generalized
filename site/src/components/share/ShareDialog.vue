<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch, type Component } from 'vue';
import Button from '../ui/Button.vue';
import Select from '../ui/Select.vue';
import Avatar from '../ui/Avatar.vue';
import { trapFocus } from '../../lib/focusTrap';
import { horizonDot } from '../../lib/display';
import {
  PhX,
  PhCheckCircle,
  PhCopy,
  PhCheck,
  PhCaretDown,
  PhArrowSquareOut,
  PhGlobe,
  PhUsersThree,
  PhKey,
  PhLock,
  PhClock,
  PhPalette,
  PhBrowsers,
  PhPencilSimple,
  PhLinkBreak,
} from '@phosphor-icons/vue';
import type { ProjectedItem } from '../../lib/share/project';
import type { AccessRung, AuthoredCanvas, Me, ShareStatus } from '../../lib/share/canvasdrop';
import type { ShareTheme } from '../../lib/share/render';
import {
  SHARE_TAG,
  isLiveRoadmapShare,
  shareAccessDescription,
  shareAccessLabel,
  shareCanvasHref,
  shareCanvasTitle,
  shareDate,
  shareMetaString,
  shareRoadmapTitle,
} from '../../lib/share/roadmapShares';

const props = defineProps<{
  items: ProjectedItem[];
  context: { title: string; product: string | null; generatedAt: string };
  author?: Me | null;
  shares?: AuthoredCanvas[];
  sharesLoading?: boolean;
  sharesError?: string | null;
  pending?: boolean;
  result?: { id?: string; url: string; expiresAt: number | null; status?: ShareStatus; action?: 'created' | 'updated' } | null;
  error?: string | null;
}>();
const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'submit', payload: {
    targetShareId: string | null; canvasTitle: string; canvasDescription: string; roadmapTitle: string; roadmapIntro: string; access: AccessRung; password: string;
    expiresAt: number; tags: string[]; theme: ShareTheme; items: ProjectedItem[];
  }): void;
  (e: 'refreshShares'): void;
  (e: 'revoke', id: string): void;
}>();

const HORIZON_ORDER = ['Now', 'Next', 'Later', 'Completed', 'Candidates'];

// Step 1 = choose what to share · step 2 = share settings.
const step = ref(1);
const canvasTitle = ref(props.context.title);
const canvasDescription = ref('');
const roadmapTitle = ref(props.context.title);
const roadmapIntro = ref('');
const access = ref<AccessRung>('public_link');
const password = ref('');
const theme = ref<ShareTheme>('light');
const targetMode = ref<'new' | 'existing'>('new');
const selectedShareId = ref('');

// Selection is a single set of item ids. The sharer owns the judgment call, so
// everything in the current filtered view starts selected.
const selected = ref(new Set(props.items.map((i) => i.id)));

const lanes = computed(() =>
  HORIZON_ORDER.map((h) => ({ h, items: props.items.filter((i) => i.horizon === h) })).filter((l) => l.items.length),
);
const total = computed(() => props.items.length);
const effectiveItems = computed(() => props.items.filter((i) => selected.value.has(i.id)));
const laneCountInShare = computed(() => new Set(effectiveItems.value.map((i) => i.horizon)).size);

function toggleItem(id: string) {
  const s = new Set(selected.value);
  s.has(id) ? s.delete(id) : s.add(id);
  selected.value = s;
}
function laneSelected(h: string) {
  return props.items.filter((i) => i.horizon === h && selected.value.has(i.id)).length;
}
function laneAll(h: string) {
  const items = props.items.filter((i) => i.horizon === h);
  return items.length > 0 && items.every((i) => selected.value.has(i.id));
}
function laneSome(h: string) {
  const n = laneSelected(h);
  return n > 0 && !laneAll(h);
}
function setLane(h: string, on: boolean) {
  const s = new Set(selected.value);
  props.items.filter((i) => i.horizon === h).forEach((i) => (on ? s.add(i.id) : s.delete(i.id)));
  selected.value = s;
}
function selectAll() {
  selected.value = new Set(props.items.map((i) => i.id));
}
function deselectAll() {
  selected.value = new Set();
}

// Lanes start collapsed — a compact overview of the horizons (with per-lane counts)
// so you can decide what to focus on, then expand the ones you want to review.
const collapsed = ref(new Set<string>(lanes.value.map((l) => l.h)));
function toggleCollapse(h: string) {
  const s = new Set(collapsed.value);
  s.has(h) ? s.delete(h) : s.add(h);
  collapsed.value = s;
}

const canProceed = computed(() => effectiveItems.value.length > 0);
const needsPassword = computed(() => access.value === 'password');
const shares = computed(() => (props.shares ?? []).filter(isLiveRoadmapShare));
const updateableShares = computed(() => shares.value);
const selectedShare = computed(() => updateableShares.value.find((s) => s.id === selectedShareId.value) ?? null);
const authorName = computed(() => props.author?.name || props.author?.email || 'Signed-in author');
const authorEmail = computed(() =>
  props.author?.email && props.author.email !== authorName.value ? props.author.email : '',
);
const canUpdateSelectedShare = computed(() => targetMode.value !== 'existing' || !!selectedShare.value);
const canSubmit = computed(() => canProceed.value && canUpdateSelectedShare.value && (!needsPassword.value || password.value.length > 0));
const submitLabel = computed(() => {
  const isUpdate = targetMode.value === 'existing';
  if (props.pending) return isUpdate ? 'Updating...' : 'Publishing...';
  return isUpdate ? 'Update share' : 'Publish share';
});
const resultVerb = computed(() => (props.result?.action === 'updated' ? 'Updated' : 'Published'));

const accessOptions = [
  { value: 'public_link', label: 'Public link — anyone with the link' },
  { value: 'whole_org', label: 'Whole org — signed-in members' },
  { value: 'password', label: 'Password protected' },
  { value: 'private', label: 'Private — just me' },
];
const selectableAccess = new Set<AccessRung>(accessOptions.map((option) => option.value as AccessRung));
const themeOptions = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];
const shareOptions = computed(() =>
  updateableShares.value.map((share) => ({
    value: share.id,
    label: `${shareRoadmapTitle(share)} — ${shareAccessLabel(share.access)}`,
  })),
);

function editableAccess(accessValue: AccessRung): AccessRung {
  if (accessValue === 'specific_people') return 'whole_org';
  return selectableAccess.has(accessValue) ? accessValue : 'private';
}

let hydratedShareId = '';
watch(selectedShare, (share) => {
  if (!share || targetMode.value !== 'existing' || share.id === hydratedShareId) return;
  hydratedShareId = share.id;
  canvasTitle.value = shareCanvasTitle(share) || props.context.title;
  canvasDescription.value = typeof share.metadata.canvasDescription === 'string' ? share.metadata.canvasDescription : '';
  roadmapTitle.value = shareRoadmapTitle(share) || props.context.title;
  roadmapIntro.value = typeof share.metadata.roadmapIntro === 'string' ? share.metadata.roadmapIntro : '';
  access.value = editableAccess(share.access);
  if (share.metadata.theme === 'light' || share.metadata.theme === 'dark') {
    theme.value = share.metadata.theme;
  }
});
watch(updateableShares, (current) => {
  if (targetMode.value !== 'existing') return;
  if (!current.some((share) => share.id === selectedShareId.value)) {
    selectedShareId.value = current[0]?.id ?? '';
  }
});

function setTargetMode(mode: 'new' | 'existing') {
  if (mode === 'existing' && !updateableShares.value.length) return;
  targetMode.value = mode;
  if (mode === 'existing' && !selectedShareId.value) selectedShareId.value = updateableShares.value[0]?.id ?? '';
  if (mode === 'new') hydratedShareId = '';
}
function useExistingShare(share: AuthoredCanvas) {
  if (share.status !== 'live') return;
  setTargetMode('existing');
  selectedShareId.value = share.id;
  step.value = 2;
}

function submit() {
  if (!canSubmit.value) return;
  emit('submit', {
    targetShareId: targetMode.value === 'existing' ? selectedShareId.value : null,
    canvasTitle: canvasTitle.value,
    canvasDescription: canvasDescription.value,
    roadmapTitle: roadmapTitle.value,
    roadmapIntro: roadmapIntro.value,
    access: access.value,
    password: password.value,
    expiresAt: Date.now() + 30 * 86_400_000,
    tags: [props.context.product, SHARE_TAG].filter(Boolean) as string[],
    theme: theme.value,
    items: effectiveItems.value,
  });
}

function statusLabel(status: ShareStatus) {
  return ({ live: 'Live', expired: 'Expired', revoked: 'Revoked', private: 'Private' } satisfies Record<ShareStatus, string>)[status];
}
function statusClass(status: ShareStatus) {
  return ({
    live: 'bg-surface-transparent-green-25',
    expired: 'bg-surface-transparent-yellow-25',
    revoked: 'bg-surface-transparent-red-25',
    private: 'bg-surface-transparent-blue-25',
  } satisfies Record<ShareStatus, string>)[status];
}
function accessIcon(accessValue: AccessRung): Component {
  return ({
    public_link: PhGlobe,
    whole_org: PhUsersThree,
    specific_people: PhUsersThree,
    password: PhKey,
    private: PhLock,
  } satisfies Record<AccessRung, Component>)[accessValue];
}
function accessClass(accessValue: AccessRung) {
  return ({
    public_link: 'bg-surface-transparent-green-25',
    whole_org: 'bg-surface-transparent-blue-25',
    specific_people: 'bg-surface-transparent-blue-25',
    password: 'bg-surface-transparent-yellow-25',
    private: 'bg-surface-transparent-violet-25',
  } satisfies Record<AccessRung, string>)[accessValue];
}
const formatDate = shareDate;
function requestDisableShare(share: AuthoredCanvas) {
  if (share.status !== 'live') return;
  const ok = window.confirm(`Disable the share link for "${shareRoadmapTitle(share)}"? Viewers will no longer be able to open it.`);
  if (ok) emit('revoke', share.id);
}

// Result — copy the share link.
const copied = ref(false);
let copyTimer: ReturnType<typeof setTimeout> | undefined;
function copyUrl() {
  if (props.result?.url) navigator.clipboard?.writeText(props.result.url);
  copied.value = true;
  clearTimeout(copyTimer);
  copyTimer = setTimeout(() => (copied.value = false), 1500);
}

// A11y: Escape to close, focus trap, scroll lock while open.
const panel = ref<HTMLElement>();
let release: (() => void) | null = null;
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close');
}
onMounted(async () => {
  document.addEventListener('keydown', onKey);
  document.body.style.overflow = 'hidden';
  await nextTick();
  if (panel.value) release = trapFocus(panel.value);
});
onUnmounted(() => {
  document.removeEventListener('keydown', onKey);
  document.body.style.overflow = '';
  release?.();
});

// Native checkbox indeterminate can't be set declaratively.
const vIndeterminate = {
  mounted: (el: HTMLInputElement, b: { value: boolean }) => (el.indeterminate = b.value),
  updated: (el: HTMLInputElement, b: { value: boolean }) => (el.indeterminate = b.value),
};

const inputCls =
  'w-full rounded-lg border border-border-subtle-default bg-card px-3 py-2.5 text-single-sm-medium text-text-primary-default outline-none transition-colors focus:border-[color:var(--color-accent-brand-default)]';
const labelCls = 'text-single-sm-medium text-text-primary-default mb-1.5 block font-semibold';
const checkboxCls = 'size-4 shrink-0 rounded accent-[color:var(--color-accent-brand-default)]';
// The brand accent (orange) is the product's single accent — use it for the primary
// CTA rather than the Button primitive's default blue, so the focal action ties into
// the orange progress bar / selections instead of introducing a second accent.
const primaryCls =
  'bg-accent-brand-default hover:bg-accent-brand-hover active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none';
</script>

<template>
  <div class="fixed inset-0 z-50 grid place-items-center p-4">
    <div class="share-scrim bg-surface-transparent-black-50 absolute inset-0" @click="emit('close')" />
    <div
      ref="panel"
      role="dialog"
      aria-modal="true"
      aria-label="Share this view"
      tabindex="-1"
      class="share-panel bg-background border-border-subtle-default relative z-10 flex max-h-[86vh] w-[860px] max-w-[94vw] flex-col overflow-hidden rounded-2xl border shadow-xl outline-none"
    >
      <!-- Header + stepper -->
      <header class="border-border-subtle-default flex items-start justify-between gap-4 border-b px-6 py-4">
        <div>
          <p class="roadmap-label">Share this view</p>
          <p v-if="!result" class="text-single-sm-medium text-text-subtle-default mt-1">
            Step {{ step }} of 2 — {{ step === 1 ? 'Choose what to share' : 'Share settings' }}
          </p>
          <p v-else class="text-single-sm-medium text-text-subtle-default mt-1">Your share is live</p>
        </div>
        <button
          type="button"
          aria-label="Close"
          class="text-icons-subtle-default hover:text-text-primary-default -mr-1.5 -mt-1 grid size-9 place-items-center rounded-lg transition-colors"
          @click="emit('close')"
        >
          <PhX :size="18" />
        </button>
      </header>
      <div v-if="!result" class="flex gap-1.5 px-6 pt-3">
        <span class="h-1 flex-1 rounded-full" :class="step >= 1 ? 'bg-accent-brand-default' : 'bg-border-subtle-default'" />
        <span class="h-1 flex-1 rounded-full" :class="step >= 2 ? 'bg-accent-brand-default' : 'bg-border-subtle-default'" />
      </div>

      <!-- STEP 1 — content -->
      <div v-if="!result && step === 1" class="flex-1 overflow-y-auto px-6 py-5">
        <div class="mb-4 flex items-center justify-between gap-3">
          <p class="text-single-sm-medium text-text-primary-default font-semibold tabular-nums">
            {{ effectiveItems.length }}<span class="text-text-subtle-default font-normal"> of {{ total }} selected</span>
          </p>
          <div class="text-single-sm-medium flex items-center gap-2">
            <button type="button" data-test="select-all" class="text-text-link-default hover:underline" @click="selectAll">Select all</button>
            <span class="text-border-strong-default">·</span>
            <button type="button" data-test="deselect-all" class="text-text-subtle-default hover:text-text-primary-default" @click="deselectAll">Clear</button>
          </div>
        </div>

        <div class="space-y-6">
          <section v-for="l in lanes" :key="l.h">
            <header class="mb-2.5 flex items-center gap-2.5">
              <input
                type="checkbox"
                :data-test="'lane-' + l.h"
                :class="checkboxCls"
                :checked="laneAll(l.h)"
                v-indeterminate="laneSome(l.h)"
                :aria-label="'Select all in ' + l.h"
                @change="setLane(l.h, ($event.target as HTMLInputElement).checked)"
              />
              <button
                type="button"
                :data-test="'collapse-' + l.h"
                :aria-expanded="!collapsed.has(l.h)"
                class="group -my-1 flex flex-1 items-center gap-2.5 rounded-md py-1 text-left"
                @click="toggleCollapse(l.h)"
              >
                <span class="size-2.5 shrink-0 rounded-full" :style="{ background: horizonDot[l.h] }" />
                <h3 class="text-single-base-medium text-text-primary-default font-semibold">{{ l.h }}</h3>
                <span class="text-single-sm-medium text-text-subtle-default ml-auto tabular-nums">
                  {{ laneSelected(l.h) }}/{{ l.items.length }}
                </span>
                <PhCaretDown
                  :size="15"
                  class="text-icons-subtle-default transition-transform"
                  :class="collapsed.has(l.h) ? '-rotate-90' : ''"
                />
              </button>
            </header>
            <ul v-if="!collapsed.has(l.h)" class="space-y-1.5">
              <li v-for="it in l.items" :key="it.id">
                <label
                  class="border-border-subtle-default flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors"
                  :class="selected.has(it.id) ? 'bg-card' : 'bg-card/40 hover:bg-card/70'"
                >
                  <input
                    type="checkbox"
                    :data-test="'item-' + it.id"
                    :class="[checkboxCls, 'mt-0.5']"
                    :checked="selected.has(it.id)"
                    :aria-label="'Include ' + it.title"
                    @change="toggleItem(it.id)"
                  />
                  <span class="min-w-0 flex-1">
                    <span class="text-single-sm-medium text-text-primary-default block truncate">{{ it.title }}</span>
                  </span>
                </label>
              </li>
            </ul>
          </section>
        </div>
      </div>

      <!-- STEP 2 — settings -->
      <div v-else-if="!result && step === 2" class="flex-1 overflow-y-auto px-6 py-5">
        <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.82fr)]">
          <div class="space-y-5">
            <section class="space-y-3.5">
              <div>
                <p class="text-single-base-medium text-text-primary-default font-semibold">Canvas record</p>
                <p class="text-single-sm-medium text-text-subtle-default mt-0.5">
                  Used for finding and updating this share later.
                </p>
              </div>
              <div>
                <label :class="labelCls" for="share-canvas-title">Canvas name</label>
                <input id="share-canvas-title" v-model="canvasTitle" data-test="canvas-title" :class="inputCls" />
              </div>
              <div>
                <label :class="labelCls" for="share-canvas-description">
                  Description <span class="text-text-subtle-default font-normal">— optional</span>
                </label>
                <textarea
                  id="share-canvas-description"
                  v-model="canvasDescription"
                  data-test="canvas-description"
                  rows="2"
                  placeholder="Internal note for this share…"
                  :class="inputCls"
                />
              </div>
            </section>
            <section class="space-y-3.5">
              <div>
                <p class="text-single-base-medium text-text-primary-default font-semibold">Roadmap page</p>
                <p class="text-single-sm-medium text-text-subtle-default mt-0.5">
                  Shown to viewers inside the published roadmap.
                </p>
              </div>
              <div>
                <label :class="labelCls" for="share-roadmap-title">Roadmap title</label>
                <input id="share-roadmap-title" v-model="roadmapTitle" data-test="roadmap-title" :class="inputCls" />
              </div>
              <div>
                <label :class="labelCls" for="share-roadmap-intro">
                  Intro <span class="text-text-subtle-default font-normal">— optional</span>
                </label>
                <textarea
                  id="share-roadmap-intro"
                  v-model="roadmapIntro"
                  data-test="intro"
                  rows="3"
                  placeholder="A line of framing for whoever you're sharing with..."
                  :class="inputCls"
                />
              </div>
            </section>
            <div>
              <label :class="labelCls">Access</label>
              <Select v-model="access" :options="accessOptions" aria-label="Access" />
              <input
                v-if="needsPassword"
                v-model="password"
                data-test="password"
                type="text"
                placeholder="Set a password to share separately"
                :class="[inputCls, 'mt-2']"
              />
            </div>
            <div>
              <label :class="labelCls">Appearance</label>
              <Select v-model="theme" :options="themeOptions" aria-label="Appearance" />
            </div>

            <div>
              <label :class="labelCls">Destination</label>
              <div class="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  data-test="target-new"
                  class="roadmap-action rounded-lg border px-3 py-2.5 text-left transition-colors"
                  :class="targetMode === 'new' ? 'roadmap-selected-control' : 'border-border-subtle-default bg-card/70 hover:bg-card'"
                  @click="setTargetMode('new')"
                >
                  <span class="text-single-sm-medium text-text-primary-default block font-semibold">New share</span>
                  <span class="text-single-sm-medium text-text-subtle-default block">Create a fresh URL</span>
                </button>
                <button
                  type="button"
                  data-test="target-existing"
                  class="roadmap-action rounded-lg border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45"
                  :class="targetMode === 'existing' ? 'roadmap-selected-control' : 'border-border-subtle-default bg-card/70 hover:bg-card'"
                  :disabled="!updateableShares.length"
                  @click="setTargetMode('existing')"
                >
                  <span class="text-single-sm-medium text-text-primary-default block font-semibold">Update share</span>
                  <span class="text-single-sm-medium text-text-subtle-default block">Keep the same URL</span>
                </button>
              </div>
              <div v-if="targetMode === 'existing'" class="mt-2" data-test="existing-select">
                <Select v-model="selectedShareId" :options="shareOptions" aria-label="Existing share" />
                <p class="text-single-sm-medium text-text-subtle-default mt-1.5">
                  Updates replace the content and settings in place. The public URL stays the same.
                </p>
              </div>
            </div>

            <div class="border-border-subtle-default bg-card/50 rounded-xl border px-4 py-3.5">
              <p class="text-single-sm-medium text-text-primary-default">
                Sharing <b class="tabular-nums">{{ effectiveItems.length }}</b> item{{ effectiveItems.length === 1 ? '' : 's' }}
                across <b class="tabular-nums">{{ laneCountInShare }}</b> lane{{ laneCountInShare === 1 ? '' : 's' }}.
              </p>
              <p class="text-single-sm-medium text-text-subtle-default mt-1">
                {{ theme === 'dark' ? 'Dark' : 'Light' }} share. Link expires in 30 days.
              </p>
            </div>
          </div>

          <aside class="border-border-subtle-default/70 space-y-3 lg:border-l lg:pl-5">
            <header class="flex items-center justify-between gap-3">
              <div>
                <p class="text-single-base-medium text-text-primary-default font-semibold">Your live share links</p>
                <p class="text-single-sm-medium text-text-subtle-default">Only viewer-openable links for this account are shown here.</p>
              </div>
              <Button
                variant="ghost"
                data-test="refresh-shares"
                class="h-8 px-2.5 text-single-sm-medium"
                :disabled="sharesLoading || pending"
                @click="emit('refreshShares')"
              >
                Refresh
              </Button>
            </header>
            <div
              v-if="author"
              class="border-border-subtle-default bg-card/70 flex items-center gap-2.5 rounded-lg border px-3 py-2"
            >
              <Avatar :name="authorName" :size="28" />
              <div class="min-w-0">
                <p class="text-single-sm-medium text-text-primary-default truncate">Signed in as {{ authorName }}</p>
                <p v-if="authorEmail" class="text-single-sm-medium text-text-subtle-default truncate">{{ authorEmail }}</p>
              </div>
            </div>

            <p v-if="sharesLoading" class="text-single-sm-medium text-text-subtle-default rounded-lg border border-border-subtle-default px-3 py-3">
              Loading shares...
            </p>
            <p v-else-if="sharesError" class="text-single-sm-medium rounded-lg border border-border-subtle-default bg-surface-transparent-orange-25 px-3 py-3 text-[color:var(--color-accent-brand-default)]">
              {{ sharesError }}
            </p>
            <p v-else-if="!shares.length" class="text-single-sm-medium text-text-subtle-default rounded-lg border border-border-subtle-default px-3 py-3">
              No live roadmap shares yet.
            </p>
            <ul v-else class="space-y-2.5">
              <li
                v-for="share in shares"
                :key="share.id"
                :data-test="'share-row-' + share.id"
                class="border-border-subtle-default bg-card/70 rounded-xl border px-3 py-3"
              >
                <div class="flex items-start gap-3">
                  <span
                    class="border-border-subtle-default text-icons-subtle-default mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border"
                    :class="accessClass(share.access)"
                    aria-hidden="true"
                  >
                    <component :is="accessIcon(share.access)" :size="16" />
                  </span>
                  <div class="min-w-0 flex-1">
                    <div class="flex min-w-0 flex-wrap items-start justify-between gap-2">
                      <div class="min-w-0">
                        <p
                          class="text-single-sm-medium text-text-primary-default truncate font-semibold"
                          :data-test="'share-title-' + share.id"
                        >
                          {{ shareRoadmapTitle(share) }}
                        </p>
                        <p class="text-single-sm-medium text-text-subtle-default mt-0.5 truncate">
                          Canvas: {{ shareCanvasTitle(share) }}
                        </p>
                      </div>
                      <div class="flex shrink-0 flex-wrap justify-end gap-1.5">
                        <span
                          class="text-single-sm-medium rounded-md border border-border-subtle-default px-2 py-0.5 font-semibold"
                          :class="accessClass(share.access)"
                        >
                          {{ shareAccessLabel(share.access) }}
                        </span>
                        <span
                          class="text-single-sm-medium rounded-md border border-border-subtle-default px-2 py-0.5 font-semibold"
                          :class="statusClass(share.status)"
                        >
                          {{ statusLabel(share.status) }}
                        </span>
                      </div>
                    </div>

                    <div class="text-single-sm-medium text-text-subtle-default mt-3 grid gap-1.5">
                      <span class="flex min-w-0 items-center gap-1.5">
                        <component :is="accessIcon(share.access)" :size="14" class="text-icons-subtle-default shrink-0" />
                        <span class="truncate">{{ shareAccessDescription(share.access) }}</span>
                      </span>
                      <span class="flex min-w-0 items-center gap-1.5">
                        <PhClock :size="14" class="text-icons-subtle-default shrink-0" />
                        <span class="truncate">Updated {{ formatDate(share.updatedAt) }} · Expires {{ formatDate(share.expiresAt) }}</span>
                      </span>
                      <span v-if="shareMetaString(share, 'theme')" class="flex min-w-0 items-center gap-1.5">
                        <PhPalette :size="14" class="text-icons-subtle-default shrink-0" />
                        <span class="truncate">{{ shareMetaString(share, 'theme') }} mode</span>
                      </span>
                    </div>
                  </div>
                </div>
                <div class="mt-3 flex flex-wrap items-center gap-2">
                  <a
                    :href="share.url"
                    target="_blank"
                    rel="noreferrer"
                    :data-test="'share-open-' + share.id"
                    class="roadmap-action border-border-subtle-default bg-card text-single-sm-medium text-text-primary-default hover:bg-surface-primary-hover inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5"
                  >
                    <PhArrowSquareOut :size="15" />
                    Open share
                  </a>
                  <a
                    :href="shareCanvasHref(share)"
                    target="_blank"
                    rel="noreferrer"
                    :data-test="'share-open-canvas-' + share.id"
                    class="roadmap-action border-border-subtle-default bg-card text-single-sm-medium text-text-primary-default hover:bg-surface-primary-hover inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5"
                  >
                    <PhBrowsers :size="15" />
                    Open canvas
                  </a>
                  <button
                    type="button"
                    :data-test="'share-use-' + share.id"
                    class="roadmap-action text-single-sm-medium text-text-primary-default hover:text-[color:var(--color-accent-brand-default)] inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 disabled:pointer-events-none disabled:opacity-40"
                    :disabled="share.status !== 'live'"
                    @click="useExistingShare(share)"
                  >
                    <PhPencilSimple :size="15" />
                    {{ targetMode === 'existing' && selectedShareId === share.id ? 'Selected' : 'Use' }}
                  </button>
                  <button
                    type="button"
                    :data-test="'share-revoke-' + share.id"
                    class="roadmap-action text-single-sm-medium text-text-subtle-default hover:text-text-primary-default inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 disabled:pointer-events-none disabled:opacity-40"
                    :disabled="share.status !== 'live' || pending"
                    @click="requestDisableShare(share)"
                  >
                    <PhLinkBreak :size="15" />
                    Disable link
                  </button>
                </div>
              </li>
            </ul>
          </aside>
        </div>
      </div>

      <!-- RESULT -->
      <div v-else-if="result" class="flex-1 overflow-y-auto px-6 py-6">
        <div class="mb-1.5 flex items-center gap-2 text-[color:var(--color-text-success-default,#27be51)]">
          <PhCheckCircle :size="20" weight="fill" />
          <span class="text-single-base-medium font-semibold">{{ resultVerb }}</span>
        </div>
        <p class="text-single-sm-medium text-text-subtle-default mb-4">
          {{ result?.action === 'updated' ? 'Your share was updated in place at the same URL.' : 'Your share is ready.' }}
        </p>
        <label :class="labelCls" for="share-result">Share link</label>
        <div class="flex gap-2">
          <input id="share-result" :value="result.url" readonly data-test="result-url" :class="[inputCls, 'flex-1']" />
          <Button variant="outline" :href="result.url" target="_blank" rel="noreferrer" class="shrink-0" data-test="open-result">
            <PhArrowSquareOut :size="15" />
            Open
          </Button>
          <Button variant="outline" class="shrink-0" @click="copyUrl">
            <component :is="copied ? PhCheck : PhCopy" :size="15" />
            {{ copied ? 'Copied' : 'Copy' }}
          </Button>
        </div>
      </div>

      <!-- Error -->
      <p
        v-if="error && !result"
        class="bg-surface-transparent-orange-25 text-single-sm-medium mx-6 mb-1 rounded-lg px-3 py-2 text-[color:var(--color-accent-brand-default)]"
      >
        {{ error }}
      </p>

      <!-- Footer -->
      <footer class="border-border-subtle-default flex items-center justify-between gap-3 border-t px-6 py-4">
        <template v-if="result">
          <span />
          <Button variant="primary" :class="primaryCls" @click="emit('close')">Done</Button>
        </template>
        <template v-else-if="step === 1">
          <Button variant="ghost" data-test="cancel" @click="emit('close')">Cancel</Button>
          <Button variant="primary" data-test="next" :class="primaryCls" :disabled="!canProceed" @click="step = 2">
            Next — share settings
          </Button>
        </template>
        <template v-else>
          <Button variant="ghost" data-test="back" @click="step = 1">Back</Button>
          <Button variant="primary" data-test="submit" :class="primaryCls" :disabled="!canSubmit || pending" @click="submit">
            {{ submitLabel }}
          </Button>
        </template>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.share-scrim {
  animation: share-fade 0.18s ease;
}
.share-panel {
  animation: share-pop 0.22s cubic-bezier(0.23, 1, 0.32, 1);
}
@keyframes share-fade {
  from {
    opacity: 0;
  }
}
@keyframes share-pop {
  from {
    opacity: 0;
    transform: translateY(6px) scale(0.98);
  }
}
@media (prefers-reduced-motion: reduce) {
  .share-scrim,
  .share-panel {
    animation: none;
  }
}
</style>
