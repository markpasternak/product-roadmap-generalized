<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch, type Component } from 'vue';
import Button from '../ui/Button.vue';
import Select from '../ui/Select.vue';
import SearchInput from '../ui/SearchInput.vue';
import Avatar from '../ui/Avatar.vue';
import ConfirmAction from '../ui/ConfirmAction.vue';
import { useClipboard } from '../../composables/useClipboard';
import { isTopFocusTrap, trapFocus } from '../../lib/focusTrap';
import { horizonDot } from '../../lib/display';
import { HORIZONS } from '../../lib/schema';
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
import { prepareShareResources, type ShareResourceChoice } from '../../lib/share/resources';
import type { ProjectedItem } from '../../lib/share/project';
import type { AccessMode, AccessRung, AuthoredCanvas, Me, PublicationStatus, ShareAudience, ShareStatus } from '../../lib/share/canvasdrop';
import { renderShareHtml, type ShareTheme, type ShareContext } from '../../lib/share/render';
import { inlinePreviewAssets, type ShareAssetUrls } from '../../lib/share/assets';
import {
  SHARE_TAG,
  isOpenableRoadmapShare,
  isUnpublishableRoadmapShare,
  isUpdateableRoadmapShare,
  isVisibleRoadmapShare,
  shareAccessDescription,
  shareAccessLabel,
  shareAccessMode,
  shareAudienceDetail,
  shareCanvasHref,
  shareCanvasTitle,
  shareDate,
  shareEditableAccess,
  shareHasPassword,
  shareMetaString,
  shareRoadmapTitle,
  sharePublicationLabel,
  sharePublicationStatus,
  shareViewerRoleLabel,
} from '../../lib/share/roadmapShares';

const props = defineProps<{
  items: ProjectedItem[];
  resources?: ShareResourceChoice[];
  context: ShareContext;
  author?: Me | null;
  shares?: AuthoredCanvas[];
  sharesLoading?: boolean;
  sharesError?: string | null;
  pending?: boolean;
  result?: {
    id?: string;
    url: string;
    expiresAt: number | null;
    access?: ShareAudience;
    accessMode?: AccessMode;
    publicationStatus?: Exclude<PublicationStatus, 'deleted'>;
    /** Compatibility with Canvas Drop responses from before the split contract. */
    status?: ShareStatus;
    action?: 'created' | 'updated';
  } | null;
  error?: string | null;
}>();
const emit = defineEmits<{
  (e: 'close'): void;
  (
    e: 'submit',
    payload: {
      targetShareId: string | null;
      canvasTitle: string;
      canvasDescription: string;
      roadmapTitle: string;
      roadmapIntro: string;
      access: AccessRung | null;
      password?: string | null;
      expectsPassword: boolean;
      expectedUpdatedAt?: number;
      tags: string[];
      preservedMetadata: Record<string, unknown>;
      theme: ShareTheme;
      items: ProjectedItem[];
      resources: ShareResourceChoice[];
    },
  ): void;
  (e: 'refreshShares'): void;
  (e: 'revoke', id: string): void;
}>();

const HORIZON_ORDER = HORIZONS;

// Step 1 = choose what to share · step 2 = share settings.
const step = ref(1);
const canvasTitle = ref(props.context.title);
const canvasDescription = ref('');
const roadmapTitle = ref(props.context.title);
const roadmapIntro = ref('');
const access = ref<AccessRung>('private');
const password = ref('');
const passwordEnabled = ref(false);
const passwordWasSet = ref(false);
const theme = ref<ShareTheme>('light');
const targetMode = ref<'new' | 'existing'>('new');
const selectedShareId = ref('');
const existingShareQuery = ref('');

// Selection is a single set of item ids. The sharer owns the judgment call, so
// everything in the current filtered view starts selected.
const selected = ref(new Set(props.items.map((i) => i.id)));

const lanes = computed(() =>
  HORIZON_ORDER.map((h) => ({
    h,
    items: props.items.filter((i) => i.horizon === h),
  })).filter((l) => l.items.length),
);
const total = computed(() => props.items.length);
const effectiveItems = computed(() => props.items.filter((i) => selected.value.has(i.id)));

const selectedResources = ref<string[]>([]);
const resourceChoices = computed(() => (props.resources??[]).filter(r=>selected.value.has(r.itemId)));
const includedResources = computed(() => resourceChoices.value.filter(r=>selectedResources.value.includes(r.key)));
const previewResources = ref<ProjectedItem[]|null>(null);
const resourceError = ref('');
let resourcePreviewEpoch=0;
async function loadResourcePreview(){ const epoch=++resourcePreviewEpoch;previewResources.value=null;resourceError.value='';try{const prepared=await prepareShareResources(effectiveItems.value,includedResources.value,import.meta.env.BASE_URL,true);if(epoch===resourcePreviewEpoch)previewResources.value=prepared.items;}catch(e){if(epoch===resourcePreviewEpoch)resourceError.value=(e as Error).message;} }
const previewOpen = ref(false);
const previewSize = ref('desktop');
const previewViewport = ref<HTMLElement>();
const previewWidth = ref(390);
let previewObserver: ResizeObserver | undefined;
watch(previewViewport, (element) => {
  previewObserver?.disconnect();
  if (!element || typeof ResizeObserver === 'undefined') return;
  previewObserver = new ResizeObserver(([entry]) => {
    if (entry) previewWidth.value = entry.contentRect.width;
  });
  previewObserver.observe(element);
});
// Keep the recipient viewport at 390px, scaling its preview to fit small dialogs.
const previewDocumentWidth = computed(() => previewSize.value === 'mobile' ? 390 : Math.max(390, previewWidth.value));
const previewScale = computed(() => Math.min(1, previewWidth.value / previewDocumentWidth.value));
const previewAssets = ref<ShareAssetUrls | null>(null);
const previewAssetError = ref(false);
async function loadPreviewAssets() {
  if (previewAssets.value) return;
  previewAssetError.value = false;
  try { previewAssets.value = await inlinePreviewAssets(); }
  catch { previewAssetError.value = true; }
}
watch([previewOpen,effectiveItems,includedResources], ([open]) => { if(open){void loadPreviewAssets();void loadResourcePreview();} });
const previewHtml = computed(() => previewOpen.value && previewAssets.value && previewResources.value ? renderShareHtml({
  ...props.context, title: roadmapTitle.value, intro: roadmapIntro.value, theme: theme.value,
  assets: previewAssets.value,
}, previewResources.value) : '');

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
const shares = computed(() => (props.shares ?? []).filter(isVisibleRoadmapShare).sort((a, b) => b.updatedAt - a.updatedAt));
const filteredShares = computed(() => {
  const query = existingShareQuery.value.trim().toLocaleLowerCase();
  if (!query) return shares.value;
  return shares.value.filter((share) =>
    [
      shareRoadmapTitle(share),
      shareCanvasTitle(share),
      shareMetaString(share, 'product'),
      shareAccessLabel(shareAccessMode(share)),
      shareHasPassword(share) ? 'Password protected' : '',
      share.galleryListed === true ? 'Listed' : share.galleryListed === false ? 'Unlisted' : '',
      share.discoverability ?? '',
      share.galleryTemplatable ? 'Reusable template' : '',
      share.viewerRole ?? '',
      share.audienceSummary?.names?.join(' ') ?? '',
      sharePublicationLabel(sharePublicationStatus(share)),
    ]
      .join(' ')
      .toLocaleLowerCase()
      .includes(query),
  );
});
const updateableShares = computed(() => shares.value.filter(isUpdateableRoadmapShare));
const selectedShare = computed(() => updateableShares.value.find((s) => s.id === selectedShareId.value) ?? null);
const effectiveAccess = computed<AccessRung | null>(() => {
  if (targetMode.value !== 'existing' || !selectedShare.value) return access.value;
  return access.value === shareEditableAccess(selectedShare.value) ? null : access.value;
});
const accessSummary = computed(() => shareAccessLabel(access.value));
const authorName = computed(() => props.author?.name || props.author?.email || 'Signed-in author');
const authorEmail = computed(() => (props.author?.email && props.author.email !== authorName.value ? props.author.email : ''));
const canUpdateSelectedShare = computed(() => targetMode.value !== 'existing' || !!selectedShare.value);
const staleShare = ref(false);
const canSubmit = computed(
  () =>
    canProceed.value &&
    canUpdateSelectedShare.value &&
    !staleShare.value &&
    (!passwordEnabled.value || password.value.length > 0 || (targetMode.value === 'existing' && passwordWasSet.value)),
);
const submitLabel = computed(() => {
  const isUpdate = targetMode.value === 'existing';
  if (props.pending) return isUpdate ? 'Updating...' : 'Publishing...';
  return isUpdate ? 'Update share' : 'Publish share';
});
const resultVerb = computed(() => (props.result?.action === 'updated' ? 'Updated' : 'Created'));
const resultPublicationStatus = computed<PublicationStatus>(() => {
  if (props.result?.publicationStatus) return props.result.publicationStatus;
  if (props.result?.status === 'expired') return 'expired';
  if (props.result?.status === 'revoked') return 'unpublished';
  return 'published';
});
const resultIsPublished = computed(() => resultPublicationStatus.value === 'published');
const resultStatusLabel = computed(() => sharePublicationLabel(resultPublicationStatus.value));
const resultAccessLabel = computed(() => {
  if (props.result?.accessMode) return shareAccessLabel(props.result.accessMode);
  if (props.result?.access) return shareAccessLabel(props.result.access);
  return '';
});
const resultHeader = computed(() => {
  if (resultIsPublished.value) return props.result?.action === 'updated' ? 'Your share is updated' : 'Your share is published';
  return props.result?.action === 'updated' ? 'Share update complete' : 'Share created';
});
const resultMessage = computed(() => {
  const subject = props.result?.action === 'updated' ? 'Content was updated' : 'The share was created';
  if (resultPublicationStatus.value === 'expired')
    return `${subject}, but the share remains Expired. Remove or extend its expiry in Canvas Drop.`;
  if (resultPublicationStatus.value === 'unpublished') return `${subject}, but the share remains Unpublished.`;
  return props.result?.action === 'updated' ? 'Your share was updated in place at the same URL.' : 'Your share is ready.';
});

const accessOptions = [
  {
    value: 'private',
    label: 'Restricted — owners, editors, and added people/teams',
  },
  { value: 'public_link', label: 'Public link — anyone with the link' },
  { value: 'whole_org', label: 'Whole org — signed-in members' },
];
const selectableAccess = new Set<AccessRung>(accessOptions.map((option) => option.value as AccessRung));
const themeOptions = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];
const shareOptions = computed(() =>
  updateableShares.value.map((share) => ({
    value: share.id,
    label: `${shareRoadmapTitle(share)} — ${shareAccessLabel(shareAccessMode(share))}${shareHasPassword(share) ? ' · Password protected' : ''}`,
  })),
);

function editableAccess(share: AuthoredCanvas): AccessRung | null {
  const accessValue = shareEditableAccess(share);
  return accessValue && selectableAccess.has(accessValue) ? accessValue : null;
}

let hydratedShareId = '';
let hydratedUpdatedAt: number | null = null;
let hydrating = false;
const formDirty = ref(false);

function hydrateExistingShare(share: AuthoredCanvas) {
  hydrating = true;
  hydratedShareId = share.id;
  hydratedUpdatedAt = share.updatedAt;
  canvasTitle.value = shareCanvasTitle(share) || props.context.title;
  canvasDescription.value = typeof share.metadata.canvasDescription === 'string' ? share.metadata.canvasDescription : '';
  roadmapTitle.value = shareRoadmapTitle(share) || props.context.title;
  roadmapIntro.value = typeof share.metadata.roadmapIntro === 'string' ? share.metadata.roadmapIntro : '';
  const existingAccess = editableAccess(share);
  if (existingAccess) access.value = existingAccess;
  theme.value = share.metadata.theme === 'dark' ? 'dark' : 'light';
  password.value = '';
  passwordEnabled.value = shareHasPassword(share);
  passwordWasSet.value = shareHasPassword(share);
  staleShare.value = false;
  formDirty.value = false;
  hydrating = false;
}

function resetNewShare() {
  hydrating = true;
  hydratedShareId = '';
  hydratedUpdatedAt = null;
  canvasTitle.value = props.context.title;
  canvasDescription.value = '';
  roadmapTitle.value = props.context.title;
  roadmapIntro.value = '';
  access.value = 'private';
  password.value = '';
  passwordEnabled.value = false;
  passwordWasSet.value = false;
  theme.value = 'light';
  staleShare.value = false;
  formDirty.value = false;
  hydrating = false;
}

watch(
  [canvasTitle, canvasDescription, roadmapTitle, roadmapIntro, access, password, passwordEnabled, theme],
  () => {
    if (!hydrating && targetMode.value === 'existing' && hydratedShareId) formDirty.value = true;
  },
  { flush: 'sync' },
);

watch(selectedShare, (share, previous) => {
  if (!share || targetMode.value !== 'existing') return;
  if (!previous || share.id !== previous.id || share.id !== hydratedShareId) {
    hydrateExistingShare(share);
    return;
  }
  if (share.updatedAt !== hydratedUpdatedAt) {
    if (formDirty.value) staleShare.value = true;
    else hydrateExistingShare(share);
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
  if (mode === 'existing') {
    if (!selectedShareId.value) selectedShareId.value = updateableShares.value[0]?.id ?? '';
    if (selectedShare.value) hydrateExistingShare(selectedShare.value);
  } else resetNewShare();
}
function useExistingShare(share: AuthoredCanvas) {
  if (!isUpdateableRoadmapShare(share)) return;
  setTargetMode('existing');
  selectedShareId.value = share.id;
  step.value = 2;
}

function passwordMutation(): string | null | undefined {
  if (targetMode.value === 'new') return passwordEnabled.value ? password.value : undefined;
  if (passwordEnabled.value) return password.value || undefined;
  return passwordWasSet.value ? null : undefined;
}

function submit() {
  if (!canSubmit.value || props.pending) return;
  const preservedTags = targetMode.value === 'existing' ? (selectedShare.value?.tags ?? []) : [];
  const previousProduct =
    targetMode.value === 'existing' && typeof selectedShare.value?.metadata.product === 'string'
      ? selectedShare.value.metadata.product
      : null;
  const unrelatedTags = preservedTags.filter((tag) => tag !== SHARE_TAG && tag !== previousProduct && tag !== props.context.product);
  emit('submit', {
    targetShareId: targetMode.value === 'existing' ? selectedShareId.value : null,
    canvasTitle: canvasTitle.value,
    canvasDescription: canvasDescription.value,
    roadmapTitle: roadmapTitle.value,
    roadmapIntro: roadmapIntro.value,
    access: effectiveAccess.value,
    password: passwordMutation(),
    expectsPassword: passwordEnabled.value,
    expectedUpdatedAt: targetMode.value === 'existing' ? (hydratedUpdatedAt ?? undefined) : undefined,
    tags: [...new Set([...unrelatedTags, props.context.product, SHARE_TAG].filter(Boolean) as string[])],
    preservedMetadata: targetMode.value === 'existing' ? (selectedShare.value?.metadata ?? {}) : {},
    theme: theme.value,
    items: effectiveItems.value,
    resources: includedResources.value,
  });
}

function reloadShareSettings() {
  if (selectedShare.value) hydrateExistingShare(selectedShare.value);
}

const predictedStatus = computed<PublicationStatus>(() => {
  if (targetMode.value === 'existing' && selectedShare.value?.expiresAt && selectedShare.value.expiresAt <= Date.now()) return 'expired';
  return 'published';
});

function statusClass(status: PublicationStatus) {
  return (
    {
      published: 'bg-surface-transparent-green-25',
      expired: 'bg-surface-transparent-yellow-25',
      unpublished: 'bg-surface-transparent-red-25',
      draft: 'bg-surface-transparent-blue-25',
      archived: 'bg-card',
      disabled: 'bg-surface-transparent-red-25',
      deleted: 'bg-surface-transparent-red-25',
    } satisfies Record<PublicationStatus, string>
  )[status];
}
function accessIcon(accessValue: AccessMode): Component {
  return (
    {
      public_link: PhGlobe,
      whole_org: PhUsersThree,
      restricted: PhLock,
    } satisfies Record<AccessMode, Component>
  )[accessValue];
}
function accessClass(accessValue: AccessMode) {
  return (
    {
      public_link: 'bg-surface-transparent-green-25',
      whole_org: 'bg-surface-transparent-blue-25',
      restricted: 'bg-surface-transparent-violet-25',
    } satisfies Record<AccessMode, string>
  )[accessValue];
}
const formatDate = shareDate;
const revokeTarget = ref<AuthoredCanvas | null>(null);
function requestDisableShare(share: AuthoredCanvas) {
  if (isUnpublishableRoadmapShare(share) && !props.pending) revokeTarget.value = share;
}
function confirmRevoke() {
  if (revokeTarget.value && !props.pending) emit('revoke', revokeTarget.value.id);
  revokeTarget.value = null;
}
const { copy, copied, copying, copyError } = useClipboard();
function copyUrl() {
  if (props.result?.url) void copy(props.result.url);
}

// A11y: Escape to close, focus trap, scroll lock while open.
const panel = ref<HTMLElement>();
let release: (() => void) | null = null;
watch([step, () => props.result], async () => {
  await nextTick();
  if (isTopFocusTrap(panel.value)) panel.value?.querySelector<HTMLElement>('[data-share-heading]')?.focus();
});
function onKey(e: KeyboardEvent) {
  if (!isTopFocusTrap(panel.value)) return;
  if (e.key === 'Escape') emit('close');
}
onMounted(async () => {
  document.addEventListener('keydown', onKey);
  await nextTick();
  if (panel.value) release = trapFocus(panel.value, { initialFocus: () => panel.value?.querySelector<HTMLElement>('[data-share-heading]') });
});
onUnmounted(() => {
  document.removeEventListener('keydown', onKey);
  release?.();
  previewObserver?.disconnect();
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
      :style="{ width: previewOpen ? '1200px' : '860px' }"
      class="share-panel bg-background border-border-subtle-default relative z-10 flex max-h-[calc(100dvh-2rem)] w-[860px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border shadow-xl outline-none"
    >
      <!-- Header + stepper -->
      <header class="border-border-subtle-default flex items-start justify-between gap-4 border-b px-6 py-4">
        <div>
          <h2 data-share-heading tabindex="-1" class="roadmap-label">{{ result ? resultHeader : step === 1 ? "Choose what to share" : "Share settings" }}</h2>
          <p v-if="!result" class="text-single-sm-medium text-text-subtle-default mt-1">
            Step {{ step }} of 2 —
            {{ step === 1 ? 'Content' : 'Access and appearance' }}
          </p>
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
            <button type="button" data-test="select-all" class="text-text-link-default hover:underline" @click="selectAll">
              Select all
            </button>
            <span class="text-border-strong-default">·</span>
            <button
              type="button"
              data-test="deselect-all"
              class="text-text-subtle-default hover:text-text-primary-default"
              @click="deselectAll"
            >
              Clear
            </button>
          </div>
        </div>

        <p class="mb-5 text-single-sm-medium text-text-subtle-default">
          Review the selected text, including any internal items. Recipients see products and stages, without owner names or Now / Next / Later. Choose any files and links to include below.
        </p>
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
                <h3 class="text-single-base-medium text-text-primary-default font-semibold">
                  {{ l.h }}
                </h3>
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
          <details v-if="resourceChoices.length" class="share-resource-picker">
            <summary>
              <span>Files and links</span>
              <small>{{ includedResources.length ? `${includedResources.length} included` : 'None included' }}</small>
            </summary>
            <div class="share-resource-options">
              <p>Choose what recipients can open. Files are copied into the snapshot; later changes won’t update those copies.</p>
              <label v-for="resource in resourceChoices" :key="resource.key">
                <input v-model="selectedResources" :value="resource.key" type="checkbox" />
                <span>{{ resource.label }}<small>{{ items.find(i => i.id === resource.itemId)?.title }} · {{ resource.repoPath ? 'File copy' : 'External link' }}</small></span>
              </label>
            </div>
          </details>
        </div>
      </div>

      <!-- STEP 2 — settings -->
      <div v-else-if="!result && step === 2" class="flex-1 overflow-y-auto px-6 py-5">
        <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.82fr)]">
            <section class="lg:col-span-2 rounded-xl border border-border-subtle-default p-4">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <Button variant="outline" :aria-expanded="previewOpen" @click="previewOpen = !previewOpen">
                  {{ previewOpen ? 'Hide recipient preview' : 'Preview as recipient' }}
                </Button>
                <Select v-if="previewOpen" v-model="previewSize" aria-label="Preview width"
                  :options="[{ value: 'desktop', label: 'Full width' }, { value: 'mobile', label: 'Mobile · 390px' }]" />
              </div>
              <p class="mt-2 text-single-sm-medium text-text-subtle-default">The published snapshot uses this layout and selected content. Access follows your sharing settings.</p>
              <div v-if="previewOpen" ref="previewViewport" class="mt-3 overflow-hidden rounded-lg bg-surface-subtle-default p-1">
                <p v-if="resourceError" role="alert" class="p-2 text-sm">{{ resourceError }}</p><p v-if="!previewAssets || (!previewResources && !resourceError)" role="status" class="p-2 text-single-sm-medium text-text-subtle-default">{{ previewAssetError ? 'Design assets could not load.' : 'Loading fonts and artwork…' }}</p>
                <button v-if="previewAssetError" type="button" class="min-h-11 px-2 text-sm underline" @click="loadPreviewAssets">Retry preview</button>
                <div v-if="previewAssets" class="mx-auto" :style="{ height: `${560 * previewScale}px`, width: `${previewDocumentWidth * previewScale}px` }">
                  <iframe title="Recipient roadmap preview" sandbox="allow-scripts" :srcdoc="previewHtml"
                    class="block h-[560px] origin-top-left border-0" :style="{ width: `${previewDocumentWidth}px`, transform: `scale(${previewScale})` }" />
                </div>
              </div>
            </section>
          <div class="space-y-5">
            <section class="space-y-3.5">
              <div>
                <p class="text-single-base-medium text-text-primary-default font-semibold">Canvas record</p>
                <p class="text-single-sm-medium text-text-subtle-default mt-0.5">Used for finding and updating this share later.</p>
              </div>
              <div>
                <label :class="labelCls" for="share-canvas-title">Canvas name</label>
                <input id="share-canvas-title" v-model="canvasTitle" data-test="canvas-title" :class="inputCls" />
              </div>
              <div>
                <label :class="labelCls" for="share-canvas-description">
                  Description
                  <span class="text-text-subtle-default font-normal">— optional</span>
                </label>
                <textarea
                  id="share-canvas-description"
                  v-model="canvasDescription"
                  data-test="canvas-description"
                  rows="2"
                  placeholder="Describe this share for your team…"
                  :class="inputCls"
                />
              </div>
            </section>
            <section class="space-y-3.5">
              <div>
                <p class="text-single-base-medium text-text-primary-default font-semibold">Roadmap page</p>
                <p class="text-single-sm-medium text-text-subtle-default mt-0.5">Shown to viewers inside the published roadmap.</p>
              </div>
              <div>
                <label :class="labelCls" for="share-roadmap-title">Roadmap title</label>
                <input id="share-roadmap-title" v-model="roadmapTitle" data-test="roadmap-title" :class="inputCls" />
              </div>
              <div>
                <p v-if="context.timeline && ['owner', 'tag'].includes(context.timeline.group)" class="text-sm text-text-subtle-default">This timeline will group by product. Owner names and internal tags stay private.</p>
                <label :class="labelCls" for="share-roadmap-intro">
                  Intro
                  <span class="text-text-subtle-default font-normal">— optional</span>
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
              <label :class="labelCls">General access</label>
              <Select v-model="access" :options="accessOptions" aria-label="Access" />
              <div
                v-if="targetMode === 'existing' && selectedShare"
                data-test="canvasdrop-managed-audience"
                class="border-border-subtle-default bg-card/70 mt-2 rounded-lg border px-3 py-2.5"
              >
                <p class="text-single-sm-medium text-text-primary-default font-semibold">Added people and teams are preserved</p>
                <p class="text-single-sm-medium text-text-subtle-default mt-0.5">
                  {{ shareAudienceDetail(selectedShare) || 'No viewer audience is currently added.' }}
                  Manage this list in Canvas Drop. Changing general access does not remove it.
                </p>
              </div>
            </div>
            <div>
              <label :class="labelCls">Password lock</label>
              <label class="border-border-subtle-default bg-card/70 flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5">
                <input v-model="passwordEnabled" data-test="password-enabled" type="checkbox" :class="[checkboxCls, 'mt-0.5']" />
                <span>
                  <span class="text-single-sm-medium text-text-primary-default block font-semibold">Require a password</span>
                  <span class="text-single-sm-medium text-text-subtle-default block">
                    This lock is separate from who is allowed to open the canvas.
                  </span>
                </span>
              </label>
              <input
                v-if="passwordEnabled"
                v-model="password"
                data-test="password"
                type="password"
                :placeholder="
                  targetMode === 'existing' && passwordWasSet
                    ? 'Leave blank to keep the current password'
                    : 'Set a password to share separately'
                "
                :class="[inputCls, 'mt-2']"
              />
              <p
                v-if="passwordEnabled && targetMode === 'existing' && passwordWasSet"
                data-test="password-set"
                class="text-single-sm-medium text-text-subtle-default mt-1.5"
              >
                Password is set. Leave the field blank to keep it, or enter a new password to replace it.
              </p>
              <p v-else-if="targetMode === 'existing' && passwordWasSet" class="text-single-sm-medium text-text-subtle-default mt-1.5">
                The existing password will be removed when you update this share.
              </p>
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
                  Updates replace the content and selected settings in place. The share URL stays the same.
                </p>
                <div
                  v-if="selectedShare?.expiresAt"
                  data-test="existing-expiry"
                  class="border-border-subtle-default bg-card/70 mt-2 rounded-lg border px-3 py-2.5"
                >
                  <p class="text-single-sm-medium text-text-primary-default inline-flex items-center gap-1.5 font-semibold">
                    <PhClock :size="14" /> Canvas expiry is set:
                    {{ shareDate(selectedShare.expiresAt) }}
                  </p>
                  <p class="text-single-sm-medium text-text-subtle-default mt-0.5">
                    This roadmap update will preserve it. Change or remove it in Canvas Drop.
                  </p>
                </div>
                <div
                  v-if="staleShare"
                  data-test="share-stale"
                  class="border-border-subtle-default bg-surface-transparent-yellow-25 mt-2 rounded-lg border px-3 py-2.5"
                >
                  <p class="text-single-sm-medium text-text-primary-default font-semibold">This share changed in Canvas Drop.</p>
                  <p class="text-single-sm-medium text-text-subtle-default mt-0.5">
                    Reload its current settings before updating so newer sharing changes are not overwritten.
                  </p>
                  <Button variant="outline" data-test="reload-share-settings" class="mt-2 h-8" @click="reloadShareSettings">
                    Reload current settings
                  </Button>
                </div>
              </div>
            </div>



            <div class="border-border-subtle-default bg-card/50 rounded-xl border px-4 py-3.5">
              <p class="text-single-sm-medium text-text-primary-default">
                Sharing
                <b class="tabular-nums">{{ effectiveItems.length }}</b> item{{ effectiveItems.length === 1 ? '' : 's' }}.
              </p>
              <p class="text-single-sm-medium text-text-subtle-default mt-1">
                {{ accessSummary }}{{ passwordEnabled ? ' · Password protected' : '' }} · {{ theme === 'dark' ? 'Dark' : 'Light' }} share ·
                {{
                  selectedShare?.expiresAt && targetMode === 'existing'
                    ? `Expires ${shareDate(selectedShare.expiresAt)} (preserved)`
                    : 'No expiry'
                }}.
              </p>
              <p
                v-if="targetMode === 'existing'"
                data-test="predicted-status"
                class="text-single-sm-medium text-text-primary-default mt-1 font-semibold"
              >
                After update: {{ sharePublicationLabel(predictedStatus) }}
              </p>
              <p v-if="targetMode === 'existing' && selectedShare" class="text-single-sm-medium text-text-subtle-default mt-1">
                Canvas title, roadmap content, general access, password lock, and appearance will be updated. Canvas Drop preserves added
                people, teams, and expiry and applies its gallery rules.
              </p>
            </div>
          </div>

          <aside class="border-border-subtle-default/70 space-y-3 lg:border-l lg:pl-5">
            <header class="flex items-center justify-between gap-3">
              <div>
                <p class="text-single-base-medium text-text-primary-default font-semibold">Your share links</p>
                <p class="text-single-sm-medium text-text-subtle-default">
                  Update content at the same URL. Existing audience, password, and expiry are shown before you publish.
                </p>
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
            <div v-if="author" class="border-border-subtle-default bg-card/70 flex items-center gap-2.5 rounded-lg border px-3 py-2">
              <Avatar :name="authorName" :size="28" />
              <div class="min-w-0">
                <p class="text-single-sm-medium text-text-primary-default truncate">Signed in as {{ authorName }}</p>
                <p v-if="authorEmail" class="text-single-sm-medium text-text-subtle-default truncate">
                  {{ authorEmail }}
                </p>
              </div>
            </div>

            <SearchInput
              v-if="shares.length > 3 || existingShareQuery"
              v-model="existingShareQuery"
              name="existing-share-search"
              aria-label="Search existing shares"
              placeholder="Find an existing share…"
            />

            <p
              v-if="sharesLoading"
              class="text-single-sm-medium text-text-subtle-default rounded-lg border border-border-subtle-default px-3 py-3"
            >
              Loading shares...
            </p>
            <p
              v-else-if="sharesError"
              class="text-single-sm-medium rounded-lg border border-border-subtle-default bg-surface-transparent-orange-25 px-3 py-3 text-[color:var(--color-accent-brand-default)]"
            >
              {{ sharesError }}
            </p>
            <p
              v-else-if="!shares.length"
              class="text-single-sm-medium text-text-subtle-default rounded-lg border border-border-subtle-default px-3 py-3"
            >
              No roadmap shares yet.
            </p>
            <p
              v-else-if="!filteredShares.length"
              class="text-single-sm-medium text-text-subtle-default rounded-lg border border-border-subtle-default px-3 py-3"
            >
              No shares match that search.
            </p>
            <ul v-else class="space-y-2.5">
              <li
                v-for="share in filteredShares"
                :key="share.id"
                :data-test="'share-row-' + share.id"
                class="border-border-subtle-default bg-card/70 rounded-xl border px-3 py-3"
              >
                <div class="flex items-start gap-3">
                  <span
                    class="border-border-subtle-default text-icons-subtle-default mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border"
                    :class="accessClass(shareAccessMode(share))"
                    aria-hidden="true"
                  >
                    <component :is="accessIcon(shareAccessMode(share))" :size="16" />
                  </span>
                  <div class="min-w-0 flex-1">
                    <div class="min-w-0">
                      <div class="min-w-0">
                        <p
                          class="text-single-sm-medium text-text-primary-default truncate font-semibold"
                          :data-test="'share-title-' + share.id"
                        >
                          {{ shareRoadmapTitle(share) }}
                        </p>
                        <p class="text-single-sm-medium text-text-subtle-default mt-0.5 truncate">Canvas: {{ shareCanvasTitle(share) }}</p>
                      </div>
                      <div :data-test="'share-badges-' + share.id" class="mt-2 flex min-w-0 max-w-full flex-wrap justify-start gap-1.5">
                        <span
                          class="text-single-sm-medium shrink-0 whitespace-nowrap rounded-md border border-border-subtle-default px-2 py-0.5 font-semibold"
                          :class="accessClass(shareAccessMode(share))"
                        >
                          {{ shareAccessLabel(shareAccessMode(share)) }}
                        </span>
                        <span
                          v-if="shareHasPassword(share)"
                          class="text-single-sm-medium bg-surface-transparent-yellow-25 shrink-0 whitespace-nowrap rounded-md border border-border-subtle-default px-2 py-0.5 font-semibold"
                          :data-test="'share-password-' + share.id"
                        >
                          Password protected
                        </span>
                        <span
                          v-if="share.galleryListed !== undefined"
                          class="text-single-sm-medium bg-card shrink-0 whitespace-nowrap rounded-md border border-border-subtle-default px-2 py-0.5 font-semibold"
                          :data-test="'share-gallery-' + share.id"
                        >
                          {{ share.galleryListed ? 'Gallery listed' : 'Not in gallery' }}
                        </span>
                        <span
                          v-if="share.discoverability"
                          class="text-single-sm-medium bg-card shrink-0 whitespace-nowrap rounded-md border border-border-subtle-default px-2 py-0.5 font-semibold"
                        >
                          {{ share.discoverability === 'listed' ? 'Org listed' : 'Link only' }}
                        </span>
                        <span
                          v-if="share.galleryTemplatable"
                          class="text-single-sm-medium bg-card shrink-0 whitespace-nowrap rounded-md border border-border-subtle-default px-2 py-0.5 font-semibold"
                        >
                          Reusable template
                        </span>
                        <span
                          v-if="share.viewerRole"
                          class="text-single-sm-medium bg-card shrink-0 whitespace-nowrap rounded-md border border-border-subtle-default px-2 py-0.5 font-semibold"
                          title="Your management role on this Canvas Drop canvas"
                        >
                          {{ shareViewerRoleLabel(share.viewerRole) }}
                        </span>
                        <span
                          class="text-single-sm-medium shrink-0 whitespace-nowrap rounded-md border border-border-subtle-default px-2 py-0.5 font-semibold"
                          :class="statusClass(sharePublicationStatus(share))"
                          :data-test="'share-status-' + share.id"
                        >
                          {{ sharePublicationLabel(sharePublicationStatus(share)) }}
                        </span>
                      </div>
                    </div>

                    <div class="text-single-sm-medium text-text-subtle-default mt-3 grid gap-1.5">
                      <span class="flex min-w-0 items-start gap-1.5">
                        <component :is="accessIcon(shareAccessMode(share))" :size="14" class="text-icons-subtle-default mt-0.5 shrink-0" />
                        <span class="min-w-0">
                          <span class="block">{{ shareAccessDescription(shareAccessMode(share)) }}</span>
                          <span v-if="shareAudienceDetail(share)" class="mt-0.5 block">{{ shareAudienceDetail(share) }}</span>
                        </span>
                      </span>
                      <span class="flex min-w-0 items-center gap-1.5">
                        <PhClock :size="14" class="text-icons-subtle-default shrink-0" />
                        <span>
                          Updated {{ formatDate(share.updatedAt) }} ·
                          {{ share.expiresAt ? `Expires ${formatDate(share.expiresAt)}` : 'No expiry' }}
                        </span>
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
                    v-if="isOpenableRoadmapShare(share)"
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
                    Manage in Canvas Drop
                  </a>
                  <button
                    type="button"
                    :data-test="'share-use-' + share.id"
                    class="roadmap-action text-single-sm-medium text-text-primary-default hover:text-[color:var(--color-accent-brand-default)] inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 disabled:pointer-events-none disabled:opacity-40"
                    :disabled="!isUpdateableRoadmapShare(share)"
                    @click="useExistingShare(share)"
                  >
                    <PhPencilSimple :size="15" />
                    {{ targetMode === 'existing' && selectedShareId === share.id ? 'Selected' : 'Update this share' }}
                  </button>
                  <button
                    type="button"
                    :data-test="'share-revoke-' + share.id"
                    class="roadmap-action text-single-sm-medium inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 disabled:pointer-events-none disabled:opacity-40"
                    :class="
                      isUnpublishableRoadmapShare(share)
                        ? 'text-text-primary-default hover:text-[color:var(--color-accent-brand-default)]'
                        : 'text-text-subtle-default'
                    "
                    :disabled="!isUnpublishableRoadmapShare(share) || pending"
                    @click="requestDisableShare(share)"
                  >
                    <PhLinkBreak :size="15" />
                    Unpublish
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
          <span class="text-single-base-medium font-semibold">
            {{ [resultVerb, resultStatusLabel, resultAccessLabel].filter(Boolean).join(' · ') }}
          </span>
        </div>
        <p class="text-single-sm-medium text-text-subtle-default mb-4">
          {{ resultMessage }}
        </p>
        <template v-if="resultIsPublished">
          <label :class="labelCls" for="share-result">Share link</label>
          <div class="flex flex-wrap gap-2">
            <input id="share-result" :value="result.url" readonly data-test="result-url" :class="[inputCls, 'min-w-0 flex-1 max-sm:basis-full']" />
            <Button variant="outline" :href="result.url" target="_blank" rel="noreferrer" class="shrink-0" data-test="open-result">
              <PhArrowSquareOut :size="15" />
              Open
            </Button>
            <Button variant="outline" class="shrink-0" :disabled="copying" @click="copyUrl">
              <component :is="copied ? PhCheck : PhCopy" :size="15" />
              {{ copied ? 'Copied' : 'Copy' }}
            </Button>
          </div>
        </template>
      </div>

      <p v-if="copyError" role="alert" class="mx-6 mb-4 text-sm text-text-subtle-default">{{ copyError }}</p>
      <p v-else-if="copied" role="status" class="sr-only">Share link copied.</p>
      <!-- Error -->
      <p
        v-if="error && !result" role="alert"
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
          <Button variant="ghost" data-test="back" :disabled="pending" @click="step = 1">Back</Button>
          <Button variant="primary" data-test="submit" :class="primaryCls" :disabled="!canSubmit || pending" @click="submit">
            {{ submitLabel }}
          </Button>
        </template>
      </footer>
    </div>
  </div>
  <ConfirmAction v-if="revokeTarget" title="Unpublish this share?" :message="`Viewers will no longer be able to open “${shareRoadmapTitle(revokeTarget)}”. You can publish it again at the same link.`" confirm-label="Unpublish share" @cancel="revokeTarget = null" @confirm="confirmRevoke" />
</template>

<style scoped>
.share-resource-picker { margin-top: 1.25rem; border: 1px solid var(--color-border-subtle-default); border-radius: 10px; }
.share-resource-picker summary { display: flex; align-items: center; gap: .6rem; min-height: 52px; padding: .8rem 1rem; cursor: pointer; font-size: .8125rem; font-weight: 500; list-style: none; }
.share-resource-picker summary::-webkit-details-marker { display: none; }
.share-resource-picker summary::before { content: ''; width: 6px; height: 6px; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; transform: rotate(-45deg); margin-right: .25rem; }
.share-resource-picker[open] summary::before { transform: rotate(45deg); }
.share-resource-picker summary small { margin-left: auto; color: var(--color-text-subtle-default); font-size: .75rem; font-weight: 400; }
.share-resource-options { padding: 0 1rem 1rem; }
.share-resource-options > p { font-size: .75rem; line-height: 1.6; color: var(--color-text-subtle-default); margin-bottom: .75rem; }
.share-resource-options label { display: flex; gap: .7rem; padding: .6rem 0; font-size: .8125rem; cursor: pointer; }
.share-resource-options input { flex-shrink: 0; width: 16px; height: 16px; margin-top: .15rem; accent-color: var(--color-accent-brand-default); }
.share-resource-options label small { display: block; margin-top: .3rem; font-size: .7rem; line-height: 1.5; color: var(--color-text-subtle-default); }

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
