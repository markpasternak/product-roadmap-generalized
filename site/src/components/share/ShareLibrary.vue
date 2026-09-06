<script setup lang="ts">
import { computed, onMounted, ref, type Component } from 'vue';
import {
  PhArrowSquareOut,
  PhCopy,
  PhCheck,
  PhLinkBreak,
  PhBrowsers,
  PhGlobe,
  PhUsersThree,
  PhKey,
  PhLock,
  PhClock,
  PhPalette,
  PhRoadHorizon,
  PhArrowClockwise,
  PhShieldCheck,
} from '@phosphor-icons/vue';
import ConfirmAction from '../ui/ConfirmAction.vue';
import { useClipboard } from '../../composables/useClipboard';
import SearchInput from '../ui/SearchInput.vue';
import Select from '../ui/Select.vue';
import { getCanvasdrop, type AccessMode, type AuthoredCanvas, type PublicationStatus } from '../../lib/share/canvasdrop';
import {
  SHARE_SOURCE_APP,
  SHARE_SOURCE_KIND,
  isPublishedRoadmapShare,
  isOpenableRoadmapShare,
  isUnpublishableRoadmapShare,
  shareAccessDescription,
  shareAccessLabel,
  shareAccessMode,
  shareAudienceDetail,
  shareCanvasHref,
  shareCanvasTitle,
  shareDate,
  shareHasPassword,
  isVisibleRoadmapShare,
  shareMetaNumber,
  shareMetaString,
  shareRoadmapTitle,
  sharePublicationLabel,
  sharePublicationStatus,
  shareViewerRoleLabel,
} from '../../lib/share/roadmapShares';

defineProps<{ base: string }>();

const shares = ref<AuthoredCanvas[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const unavailable = ref(false);
const copiedId = ref<string | null>(null);
const query = ref('');
const statusFilter = ref('all');
const audienceFilter = ref('all');
const lockFilter = ref('all');
const { copy, copied, copying, copyError } = useClipboard();
const pendingId = ref<string | null>(null);
const revokeTarget = ref<AuthoredCanvas | null>(null);
let loadSequence = 0;

const sortedShares = computed(() => shares.value.filter(isVisibleRoadmapShare).sort((a, b) => b.updatedAt - a.updatedAt));
const filteredShares = computed(() =>
  sortedShares.value.filter((share) => {
    const matchesStatus = statusFilter.value === 'all' || sharePublicationStatus(share) === statusFilter.value;
    const matchesAudience = audienceFilter.value === 'all' || shareAccessMode(share) === audienceFilter.value;
    const matchesLock =
      lockFilter.value === 'all' ||
      (lockFilter.value === 'password' && shareHasPassword(share)) ||
      (lockFilter.value === 'expiry' && share.expiresAt !== null) ||
      (lockFilter.value === 'no_expiry' && share.expiresAt === null);
    const haystack = [
      shareRoadmapTitle(share),
      shareCanvasTitle(share),
      shareMetaString(share, 'product'),
      shareMetaString(share, 'canvasDescription'),
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
      .toLocaleLowerCase();
    return matchesStatus && matchesAudience && matchesLock && haystack.includes(query.value.trim().toLocaleLowerCase());
  }),
);
const statusOptions = [
  { value: 'all', label: 'All statuses' },
  { value: 'published', label: 'Published' },
  { value: 'expired', label: 'Expired' },
  { value: 'unpublished', label: 'Unpublished' },
];
const audienceOptions = [
  { value: 'all', label: 'All audiences' },
  { value: 'restricted', label: 'Restricted' },
  { value: 'whole_org', label: 'Whole org' },
  { value: 'public_link', label: 'Public link' },
];
const lockOptions = [
  { value: 'all', label: 'All protection' },
  { value: 'password', label: 'Password protected' },
  { value: 'expiry', label: 'Has expiry' },
  { value: 'no_expiry', label: 'No expiry' },
];
const activeFilterCount = computed(
  () =>
    [query.value.trim() !== '', statusFilter.value !== 'all', audienceFilter.value !== 'all', lockFilter.value !== 'all'].filter(Boolean)
      .length,
);

async function loadShares() {
  const cd = getCanvasdrop();
  if (!cd) {
    unavailable.value = true;
    loading.value = false;
    return;
  }
  unavailable.value = false;
  loading.value = true;
  error.value = null;
  const sequence = ++loadSequence;
  try {
    const nextShares = await cd.canvases.list({ sourceApp: SHARE_SOURCE_APP, sourceKind: SHARE_SOURCE_KIND });
    if (sequence !== loadSequence) return;
    shares.value = nextShares;
  } catch (err) {
    if (sequence !== loadSequence) return;
    error.value = (err as { hint?: string; message?: string }).hint ?? (err as Error).message ?? 'Could not load shares.';
  } finally {
    if (sequence === loadSequence) loading.value = false;
  }
}

function copyShare(share: AuthoredCanvas) {
  copiedId.value = share.id;
  void copy(share.url);
}

function clearFilters() {
  query.value = '';
  statusFilter.value = 'all';
  audienceFilter.value = 'all';
  lockFilter.value = 'all';
}

async function disableShare() {
  const share = revokeTarget.value;
  if (!share || pendingId.value) return;
  revokeTarget.value = null;
  const cd = getCanvasdrop();
  if (!cd) return;
  pendingId.value = share.id;
  error.value = null;
  try {
    await cd.canvases.revoke(share.id);
    await loadShares();
  } catch (err) {
    error.value = (err as { hint?: string; message?: string }).hint ?? (err as Error).message ?? 'Could not unpublish share.';
  } finally {
    pendingId.value = null;
  }
}

function accessIcon(access: AccessMode): Component {
  return (
    {
      public_link: PhGlobe,
      whole_org: PhUsersThree,
      restricted: PhLock,
    } satisfies Record<AccessMode, Component>
  )[access];
}

function accessClass(access: AccessMode) {
  return (
    {
      public_link: 'bg-surface-transparent-green-25',
      whole_org: 'bg-surface-transparent-blue-25',
      restricted: 'bg-surface-transparent-violet-25',
    } satisfies Record<AccessMode, string>
  )[access];
}

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

function recoveryMessage(status: PublicationStatus) {
  return (
    {
      published: '',
      expired: 'Content updates preserve this expired date. Remove or extend the expiry in Canvas Drop.',
      unpublished: 'Updating republishes at the same URL while preserving its current access unless you change it.',
      draft: '',
      archived: '',
      disabled: '',
      deleted: '',
    } satisfies Record<PublicationStatus, string>
  )[status];
}

function themeLabel(share: AuthoredCanvas) {
  const theme = shareMetaString(share, 'theme');
  return theme ? `${theme[0]?.toUpperCase() ?? ''}${theme.slice(1)} mode` : '';
}

function shareContext(share: AuthoredCanvas) {
  const product = shareMetaString(share, 'product');
  const stats = [
    shareMetaNumber(share, 'itemCount') !== null
      ? `${shareMetaNumber(share, 'itemCount')} item${shareMetaNumber(share, 'itemCount') === 1 ? '' : 's'}`
      : '',
    shareMetaNumber(share, 'laneCount') !== null
      ? `${shareMetaNumber(share, 'laneCount')} lane${shareMetaNumber(share, 'laneCount') === 1 ? '' : 's'}`
      : '',
  ].filter(Boolean);
  return [product, ...stats].filter(Boolean).join(' · ');
}

onMounted(loadShares);
</script>

<template>
  <div class="space-y-5">
    <header class="roadmap-masthead rounded-[20px] px-5 py-5 sm:px-6 sm:py-6">
      <div class="flex flex-wrap items-start justify-between gap-5">
        <div class="max-w-3xl">
          <p class="roadmap-label">Shares</p>
          <h1 class="roadmap-display roadmap-title mt-2 text-[2rem] sm:text-[2.55rem]">Views worth <em>sharing.</em></h1>
          <p class="roadmap-muted text-body-md mt-2 max-w-2xl">
            Manage the snapshots you published from the roadmap. Updating keeps the same URL; unpublishing takes a link offline without
            deleting its record. To update content, open the roadmap, choose Share, then Update share.
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <a
            :href="base"
            class="roadmap-action border-border-subtle-default bg-card text-single-base-medium text-text-primary-default hover:bg-surface-primary-hover inline-flex h-10 items-center gap-2 rounded-lg border px-3.5"
          >
            <PhRoadHorizon :size="17" />
            Create from roadmap
          </a>
          <button
            type="button"
            class="roadmap-action border-border-subtle-default bg-card text-single-base-medium text-text-primary-default hover:bg-surface-primary-hover inline-flex h-10 items-center gap-2 rounded-lg border px-3.5 disabled:cursor-wait disabled:opacity-60"
            :disabled="loading"
            :aria-busy="loading"
            title="Fetch the latest share state from Canvas Drop"
            @click="loadShares"
          >
            <PhArrowClockwise :size="17" />
            {{ loading ? 'Refreshing…' : 'Refresh' }}
          </button>
        </div>
      </div>
      <a :href="base + 'help#shares'" class="mt-5 inline-flex text-single-sm-medium text-text-link-default underline underline-offset-4">Read the sharing guide</a>
    </header>

    <p
      v-if="loading && !shares.length"
      class="text-single-base-medium text-text-subtle-default rounded-xl border border-border-subtle-default bg-card px-4 py-4"
    >
      Loading share links...
    </p>
    <p
      v-else-if="unavailable"
      class="text-single-base-medium text-text-subtle-default rounded-xl border border-border-subtle-default bg-card px-4 py-4"
    >
      Sharing is only available from a signed-in Canvas Drop roadmap canvas.
    </p>
    <p
      v-if="error" role="alert"
      class="text-single-base-medium rounded-xl border border-border-subtle-default bg-surface-transparent-orange-25 px-4 py-4 text-[color:var(--color-accent-brand-default)]"
    >
      {{ error }}
    </p>

    <div v-if="!unavailable && (shares.length || (!loading && !error))" class="roadmap-glass rounded-[24px] p-3.5 sm:p-4">
      <div v-if="sortedShares.length" class="mb-3 flex flex-wrap items-center gap-3" data-test="share-filters">
        <div class="min-w-[220px] flex-1 max-sm:order-3 max-sm:basis-full">
          <SearchInput v-model="query" name="share-search" aria-label="Search shares" placeholder="Search shares…" :debounce="150" />
        </div>
        <div class="max-sm:order-4 max-sm:flex-1 sm:w-40">
          <Select v-model="statusFilter" :options="statusOptions" aria-label="Share status" />
        </div>
        <div class="max-sm:order-5 max-sm:flex-1 sm:w-44">
          <Select v-model="audienceFilter" :options="audienceOptions" aria-label="Share audience" />
        </div>
        <div class="max-sm:order-6 max-sm:flex-1 sm:w-40">
          <Select v-model="lockFilter" :options="lockOptions" aria-label="Share protection" />
        </div>
        <span
          class="roadmap-quiet-chip text-single-sm-medium text-text-subtle-default ml-auto inline-flex min-h-11 items-center rounded-lg px-3 whitespace-nowrap max-sm:order-2"
        >
          {{ filteredShares.length }} of {{ sortedShares.length }}
        </span>
        <button
          v-if="activeFilterCount"
          type="button"
          data-test="clear-share-filters"
          class="roadmap-action border-border-subtle-default bg-card text-text-subtle-default hover:text-text-primary-default inline-flex min-h-10 shrink-0 items-center px-3 rounded-lg border max-sm:order-2"
          aria-label="Clear share filters"
          title="Clear filters"
          @click="clearFilters"
        >
          Clear filters
        </button>
      </div>

      <div v-if="!sortedShares.length" class="border-border-subtle-default bg-card rounded-xl border border-dashed px-5 py-6">
        <p class="text-heading-md-semibold text-text-primary-default">No share links yet</p>
        <p class="text-body-md text-text-subtle-default mt-2 max-w-xl">
          Create a share from the roadmap view. It will appear here for quick access and future updates.
        </p>
      </div>

      <div v-else-if="!filteredShares.length" class="border-border-subtle-default bg-card rounded-xl border border-dashed px-5 py-6">
        <p class="text-heading-md-semibold text-text-primary-default">No matching share links</p>
        <p class="text-body-md text-text-subtle-default mt-2">Try another title, lifecycle status, audience, or protection setting.</p>
        <button
          type="button"
          class="roadmap-action text-single-base-medium text-text-primary-default mt-3 underline underline-offset-4"
          @click="clearFilters"
        >
          Clear filters
        </button>
      </div>

      <div v-else class="grid gap-3">
        <article
          v-for="share in filteredShares"
          :key="share.id"
          :data-test="'share-card-' + share.id"
          class="roadmap-card rounded-xl px-4 py-4 sm:px-5"
        >
          <div class="flex flex-wrap items-start gap-3 sm:flex-nowrap">
            <span
              class="border-border-subtle-default text-icons-subtle-default mt-0.5 grid size-10 shrink-0 place-items-center rounded-lg border"
              :class="accessClass(shareAccessMode(share))"
              aria-hidden="true"
            >
              <component :is="accessIcon(shareAccessMode(share))" :size="19" />
            </span>
            <div class="min-w-0 flex-1">
              <div class="flex min-w-0 flex-wrap items-start justify-between gap-3">
                <div class="min-w-0">
                  <h2 class="text-heading-sm-semibold text-text-primary-default break-words" :data-test="'share-title-' + share.id">
                    {{ shareRoadmapTitle(share) }}
                  </h2>
                  <p v-if="shareMetaString(share, 'roadmapIntro')" class="text-single-sm-medium text-text-subtle-default mt-1 max-w-2xl">
                    {{ shareMetaString(share, 'roadmapIntro') }}
                  </p>
                  <p class="text-single-sm-medium text-text-subtle-default mt-1 truncate">Canvas: {{ shareCanvasTitle(share) }}</p>
                  <p
                    v-if="shareMetaString(share, 'canvasDescription')"
                    class="text-single-sm-medium text-text-subtle-default mt-1 max-w-2xl"
                  >
                    {{ shareMetaString(share, 'canvasDescription') }}
                  </p>
                </div>
                <div class="flex shrink-0 flex-wrap justify-end gap-1.5">
                  <span
                    class="text-single-sm-medium inline-flex items-center gap-1.5 rounded-md border border-border-subtle-default px-2 py-0.5 font-semibold"
                    :class="accessClass(shareAccessMode(share))"
                  >
                    <component :is="accessIcon(shareAccessMode(share))" :size="14" />
                    {{ shareAccessLabel(shareAccessMode(share)) }}
                  </span>
                  <span
                    v-if="shareHasPassword(share)"
                    class="text-single-sm-medium bg-surface-transparent-yellow-25 inline-flex items-center gap-1.5 rounded-md border border-border-subtle-default px-2 py-0.5 font-semibold"
                    :data-test="'share-password-' + share.id"
                  >
                    <PhKey :size="14" />
                    Password protected
                  </span>
                  <span
                    class="text-single-sm-medium inline-flex items-center gap-1.5 rounded-md border border-border-subtle-default px-2 py-0.5 font-semibold"
                    :class="statusClass(sharePublicationStatus(share))"
                    :data-test="'share-status-' + share.id"
                  >
                    <PhShieldCheck :size="14" />
                    {{ sharePublicationLabel(sharePublicationStatus(share)) }}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <dl class="mt-4 grid gap-4 text-single-sm-medium sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <div class="flex min-w-0 gap-2">
              <component :is="accessIcon(shareAccessMode(share))" :size="16" class="text-icons-subtle-default mt-0.5 shrink-0" />
              <div class="min-w-0">
                <dt class="text-text-subtle-default">Access</dt>
                <dd class="text-text-primary-default mt-0.5">
                  {{ shareAccessDescription(shareAccessMode(share)) }}
                </dd>
                <dd v-if="shareAudienceDetail(share)" class="text-text-subtle-default mt-0.5">
                  {{ shareAudienceDetail(share) }}
                </dd>
              </div>
            </div>
            <div class="flex min-w-0 gap-2">
              <PhClock :size="16" class="text-icons-subtle-default mt-0.5 shrink-0" />
              <div class="min-w-0">
                <dt class="text-text-subtle-default">Content updated</dt>
                <dd class="text-text-primary-default mt-0.5">
                  {{ shareDate(share.bundleUpdatedAt) }}
                </dd>
              </div>
            </div>
            <div class="flex min-w-0 gap-2">
              <PhClock :size="16" class="text-icons-subtle-default mt-0.5 shrink-0" />
              <div class="min-w-0">
                <dt class="text-text-subtle-default">Expires</dt>
                <dd class="text-text-primary-default mt-0.5">
                  {{ shareDate(share.expiresAt) }}
                </dd>
              </div>
            </div>
            <div v-if="themeLabel(share)" class="flex min-w-0 gap-2">
              <PhPalette :size="16" class="text-icons-subtle-default mt-0.5 shrink-0" />
              <div class="min-w-0">
                <dt class="text-text-subtle-default">Appearance</dt>
                <dd class="text-text-primary-default mt-0.5 truncate">
                  {{ themeLabel(share) }}
                </dd>
              </div>
            </div>
            <div v-if="share.viewerRole" class="flex min-w-0 gap-2">
              <PhShieldCheck :size="16" class="text-icons-subtle-default mt-0.5 shrink-0" />
              <div class="min-w-0">
                <dt class="text-text-subtle-default">Your role</dt>
                <dd class="text-text-primary-default mt-0.5">
                  {{ shareViewerRoleLabel(share.viewerRole) }}
                </dd>
              </div>
            </div>
          </dl>

          <div
            v-if="share.galleryListed !== undefined || share.discoverability || share.galleryTemplatable"
            class="text-single-sm-medium text-text-subtle-default mt-3 flex flex-wrap items-center gap-1.5"
            aria-label="Canvas Drop settings"
          >
            <span class="mr-1">Canvas Drop:</span>
            <span
              v-if="share.galleryListed !== undefined"
              class="roadmap-quiet-chip rounded-md px-2 py-0.5"
              :data-test="'share-gallery-' + share.id"
            >
              {{ share.galleryListed ? 'In gallery' : 'Not in gallery' }}
            </span>
            <span v-if="share.discoverability" class="roadmap-quiet-chip rounded-md px-2 py-0.5">
              {{ share.discoverability === 'listed' ? 'Listed in org' : 'Link only' }}
            </span>
            <span v-if="share.galleryTemplatable" class="roadmap-quiet-chip rounded-md px-2 py-0.5">Reusable template</span>
          </div>

          <div class="text-single-sm-medium text-text-subtle-default mt-3 flex flex-wrap gap-x-3 gap-y-1">
            <span v-if="shareContext(share)">{{ shareContext(share) }}</span>
            <span v-if="share.version">Version {{ share.version }}</span>
          </div>

          <p v-if="recoveryMessage(sharePublicationStatus(share))" class="text-single-sm-medium text-text-subtle-default mt-3">
            {{ recoveryMessage(sharePublicationStatus(share)) }}
          </p>

          <div class="mt-4 flex flex-wrap items-center gap-2">
            <a
              v-if="isOpenableRoadmapShare(share)"
              :href="share.url"
              target="_blank"
              rel="noreferrer"
              :data-test="'share-open-' + share.id"
              class="roadmap-action border-border-subtle-default bg-card text-single-base-medium text-text-primary-default hover:bg-surface-primary-hover inline-flex min-h-11 items-center gap-2 rounded-lg border px-3"
            >
              <PhArrowSquareOut :size="16" />
              Open share
            </a>
            <a
              :href="shareCanvasHref(share)"
              target="_blank"
              rel="noreferrer"
              :data-test="'open-canvas-' + share.id"
              class="roadmap-action border-border-subtle-default bg-card text-single-base-medium text-text-primary-default hover:bg-surface-primary-hover inline-flex min-h-11 items-center gap-2 rounded-lg border px-3"
            >
              <PhBrowsers :size="16" />
              Manage in Canvas Drop
            </a>
            <button
              v-if="isPublishedRoadmapShare(share)"
              type="button"
              :data-test="'share-copy-' + share.id"
              class="roadmap-action border-border-subtle-default bg-card text-single-base-medium text-text-primary-default hover:bg-surface-primary-hover inline-flex min-h-11 items-center gap-2 rounded-lg border px-3"
              :disabled="copying && copiedId === share.id" @click="copyShare(share)"
            >
              <component :is="copied && copiedId === share.id ? PhCheck : PhCopy" :size="16" />
              {{ copied && copiedId === share.id ? 'Copied' : 'Copy link' }}
            </button>
            <button
              v-if="isUnpublishableRoadmapShare(share)"
              type="button"
              :data-test="'share-disable-' + share.id"
              class="roadmap-action text-single-base-medium text-text-primary-default hover:text-[color:var(--color-accent-brand-default)] inline-flex min-h-11 items-center gap-2 rounded-lg px-3"
              :disabled="!!pendingId" @click="revokeTarget = share"
            >
              <PhLinkBreak :size="16" />
              {{ pendingId === share.id ? 'Unpublishing…' : 'Unpublish' }}
            </button>
          </div>
          <p v-if="copyError && copiedId === share.id" role="alert" class="mt-3 text-sm text-text-subtle-default">{{ copyError }}</p>
          <p v-else-if="copied && copiedId === share.id" role="status" class="sr-only">Share link copied.</p>
        </article>
      </div>
    </div>
    <ConfirmAction v-if="revokeTarget" title="Unpublish this share?" :message="`Viewers will no longer be able to open “${shareRoadmapTitle(revokeTarget)}”. You can publish it again at the same link.`" confirm-label="Unpublish share" @cancel="revokeTarget = null" @confirm="disableShare" />
  </div>
</template>
