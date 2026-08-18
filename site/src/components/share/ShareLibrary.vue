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
import Avatar from '../ui/Avatar.vue';
import { getCanvasdrop, type AccessRung, type AuthoredCanvas, type Me } from '../../lib/share/canvasdrop';
import {
  SHARE_SOURCE_APP,
  SHARE_SOURCE_KIND,
  SHARE_TAG,
  isLiveRoadmapShare,
  shareAccessDescription,
  shareAccessLabel,
  shareCanvasHref,
  shareCanvasTitle,
  shareDate,
  shareMetaNumber,
  shareMetaString,
  shareRoadmapTitle,
} from '../../lib/share/roadmapShares';

defineProps<{ base: string }>();

const shares = ref<AuthoredCanvas[]>([]);
const author = ref<Me | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const unavailable = ref(false);
const copiedId = ref<string | null>(null);
let copyTimer: ReturnType<typeof setTimeout> | undefined;

const liveShares = computed(() =>
  shares.value.filter(isLiveRoadmapShare).sort((a, b) => b.updatedAt - a.updatedAt),
);
const inactiveCount = computed(() => shares.value.length - liveShares.value.length);
const authorName = computed(() => author.value?.name || author.value?.email || 'Signed-in author');
const authorEmail = computed(() =>
  author.value?.email && author.value.email !== authorName.value ? author.value.email : '',
);

async function loadShares() {
  const cd = getCanvasdrop();
  if (!cd) {
    unavailable.value = true;
    loading.value = false;
    return;
  }
  loading.value = true;
  error.value = null;
  try {
    author.value = await cd.me();
    shares.value = await cd.canvases.list({
      sourceApp: SHARE_SOURCE_APP,
      sourceKind: SHARE_SOURCE_KIND,
      tags: [SHARE_TAG],
    });
  } catch (err) {
    error.value = (err as { hint?: string; message?: string }).hint
      ?? (err as Error).message
      ?? 'Could not load shares.';
  } finally {
    loading.value = false;
  }
}

function copyShare(share: AuthoredCanvas) {
  navigator.clipboard?.writeText(share.url);
  copiedId.value = share.id;
  clearTimeout(copyTimer);
  copyTimer = setTimeout(() => (copiedId.value = null), 1500);
}

async function disableShare(share: AuthoredCanvas) {
  const ok = window.confirm(`Disable the share link for "${shareRoadmapTitle(share)}"? Viewers will no longer be able to open it.`);
  if (!ok) return;
  const cd = getCanvasdrop();
  if (!cd) return;
  try {
    await cd.canvases.revoke(share.id);
    await loadShares();
  } catch (err) {
    error.value = (err as { hint?: string; message?: string }).hint
      ?? (err as Error).message
      ?? 'Could not disable share.';
  }
}

function accessIcon(access: AccessRung): Component {
  return ({
    public_link: PhGlobe,
    whole_org: PhUsersThree,
    specific_people: PhUsersThree,
    password: PhKey,
    private: PhLock,
  } satisfies Record<AccessRung, Component>)[access];
}

function accessClass(access: AccessRung) {
  return ({
    public_link: 'bg-surface-transparent-green-25',
    whole_org: 'bg-surface-transparent-blue-25',
    specific_people: 'bg-surface-transparent-blue-25',
    password: 'bg-surface-transparent-yellow-25',
    private: 'bg-surface-transparent-violet-25',
  } satisfies Record<AccessRung, string>)[access];
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
  <div class="space-y-6">
    <header class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p class="roadmap-label">Shares</p>
        <h1 class="font-display text-text-primary-default mt-2 text-[2rem] sm:text-[2.4rem]">Share links</h1>
        <p class="text-body-md text-text-subtle-default mt-2 max-w-2xl">
          Live roadmap links you can open, copy, update from the roadmap, or disable when they should stop working.
        </p>
        <div
          v-if="author"
          class="border-border-subtle-default bg-card mt-4 inline-flex max-w-full items-center gap-3 rounded-lg border px-3 py-2"
        >
          <Avatar :name="authorName" :size="30" />
          <div class="min-w-0">
            <p class="text-single-sm-medium text-text-primary-default truncate">Signed in as {{ authorName }}</p>
            <p v-if="authorEmail" class="text-single-sm-medium text-text-subtle-default truncate">{{ authorEmail }}</p>
          </div>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <a
          :href="base"
          class="roadmap-action border-border-subtle-default bg-card text-single-base-medium text-text-primary-default hover:bg-surface-primary-hover inline-flex h-10 items-center gap-2 rounded-lg border px-3.5"
        >
          <PhRoadHorizon :size="17" />
          Create from roadmap
        </a>
        <button
          type="button"
          class="roadmap-action border-border-subtle-default bg-card text-single-base-medium text-text-primary-default hover:bg-surface-primary-hover inline-flex h-10 items-center gap-2 rounded-lg border px-3.5"
          @click="loadShares"
        >
          <PhArrowClockwise :size="17" />
          Refresh
        </button>
      </div>
    </header>

    <p v-if="loading" class="text-single-base-medium text-text-subtle-default rounded-xl border border-border-subtle-default bg-card px-4 py-4">
      Loading share links...
    </p>
    <p v-else-if="unavailable" class="text-single-base-medium text-text-subtle-default rounded-xl border border-border-subtle-default bg-card px-4 py-4">
      Sharing is only available from a signed-in Canvas Drop roadmap canvas.
    </p>
    <p v-else-if="error" class="text-single-base-medium rounded-xl border border-border-subtle-default bg-surface-transparent-orange-25 px-4 py-4 text-[color:var(--color-accent-brand-default)]">
      {{ error }}
    </p>

    <template v-else>
      <p v-if="inactiveCount > 0" class="text-single-sm-medium text-text-subtle-default">
        {{ inactiveCount }} inactive Canvas Drop record{{ inactiveCount === 1 ? '' : 's' }} hidden from this list.
      </p>

      <div v-if="!liveShares.length" class="border-border-subtle-default bg-card rounded-xl border border-dashed px-5 py-6">
        <p class="text-heading-md-semibold text-text-primary-default">No live share links</p>
        <p class="text-body-md text-text-subtle-default mt-2 max-w-xl">
          Create a share from the roadmap view. Once it is live, it will appear here for quick access.
        </p>
      </div>

      <div v-else class="grid gap-3">
        <article
          v-for="share in liveShares"
          :key="share.id"
          class="border-border-subtle-default bg-card rounded-xl border px-4 py-4"
        >
          <div class="flex flex-wrap items-start gap-3 sm:flex-nowrap">
            <span
              class="border-border-subtle-default text-icons-subtle-default mt-0.5 grid size-10 shrink-0 place-items-center rounded-lg border"
              :class="accessClass(share.access)"
              aria-hidden="true"
            >
              <component :is="accessIcon(share.access)" :size="19" />
            </span>
            <div class="min-w-0 flex-1">
              <div class="flex min-w-0 flex-wrap items-start justify-between gap-3">
                <div class="min-w-0">
                  <h2 class="text-heading-sm-semibold text-text-primary-default truncate" :data-test="'share-title-' + share.id">
                    {{ shareRoadmapTitle(share) }}
                  </h2>
                  <p v-if="shareMetaString(share, 'roadmapIntro')" class="text-single-sm-medium text-text-subtle-default mt-1 max-w-2xl">
                    {{ shareMetaString(share, 'roadmapIntro') }}
                  </p>
                  <p class="text-single-sm-medium text-text-subtle-default mt-1 truncate">
                    Canvas: {{ shareCanvasTitle(share) }}
                  </p>
                  <p v-if="shareMetaString(share, 'canvasDescription')" class="text-single-sm-medium text-text-subtle-default mt-1 max-w-2xl">
                    {{ shareMetaString(share, 'canvasDescription') }}
                  </p>
                </div>
                <div class="flex shrink-0 flex-wrap justify-end gap-1.5">
                  <span
                    class="text-single-sm-medium inline-flex items-center gap-1.5 rounded-md border border-border-subtle-default px-2 py-0.5 font-semibold"
                    :class="accessClass(share.access)"
                  >
                    <component :is="accessIcon(share.access)" :size="14" />
                    {{ shareAccessLabel(share.access) }}
                  </span>
                  <span class="text-single-sm-medium inline-flex items-center gap-1.5 rounded-md border border-border-subtle-default bg-surface-transparent-green-25 px-2 py-0.5 font-semibold">
                    <PhShieldCheck :size="14" />
                    Live
                  </span>
                </div>
              </div>
            </div>
          </div>

          <dl class="mt-4 grid gap-2 text-single-sm-medium sm:grid-cols-2 xl:grid-cols-4">
            <div class="flex min-w-0 gap-2">
              <component :is="accessIcon(share.access)" :size="16" class="text-icons-subtle-default mt-0.5 shrink-0" />
              <div class="min-w-0">
                <dt class="text-text-subtle-default">Access</dt>
                <dd class="text-text-primary-default mt-0.5 truncate">{{ shareAccessDescription(share.access) }}</dd>
              </div>
            </div>
            <div class="flex min-w-0 gap-2">
              <PhClock :size="16" class="text-icons-subtle-default mt-0.5 shrink-0" />
              <div class="min-w-0">
                <dt class="text-text-subtle-default">Last published</dt>
                <dd class="text-text-primary-default mt-0.5">{{ shareDate(share.updatedAt) }}</dd>
              </div>
            </div>
            <div class="flex min-w-0 gap-2">
              <PhClock :size="16" class="text-icons-subtle-default mt-0.5 shrink-0" />
              <div class="min-w-0">
                <dt class="text-text-subtle-default">Expires</dt>
                <dd class="text-text-primary-default mt-0.5">{{ shareDate(share.expiresAt) }}</dd>
              </div>
            </div>
            <div v-if="themeLabel(share)" class="flex min-w-0 gap-2">
              <PhPalette :size="16" class="text-icons-subtle-default mt-0.5 shrink-0" />
              <div class="min-w-0">
                <dt class="text-text-subtle-default">Appearance</dt>
                <dd class="text-text-primary-default mt-0.5 truncate">{{ themeLabel(share) }}</dd>
              </div>
            </div>
          </dl>

          <div class="text-single-sm-medium text-text-subtle-default mt-3 flex flex-wrap gap-x-3 gap-y-1">
            <span v-if="shareContext(share)">{{ shareContext(share) }}</span>
            <span v-if="share.version">Version {{ share.version }}</span>
          </div>

          <div class="mt-4 flex flex-wrap items-center gap-2">
            <a
              :href="share.url"
              target="_blank"
              rel="noreferrer"
              class="roadmap-action border-border-subtle-default bg-card text-single-base-medium text-text-primary-default hover:bg-surface-primary-hover inline-flex h-9 items-center gap-2 rounded-lg border px-3"
            >
              <PhArrowSquareOut :size="16" />
              Open share
            </a>
            <a
              :href="shareCanvasHref(share)"
              target="_blank"
              rel="noreferrer"
              :data-test="'open-canvas-' + share.id"
              class="roadmap-action border-border-subtle-default bg-card text-single-base-medium text-text-primary-default hover:bg-surface-primary-hover inline-flex h-9 items-center gap-2 rounded-lg border px-3"
            >
              <PhBrowsers :size="16" />
              Open canvas
            </a>
            <button
              type="button"
              class="roadmap-action border-border-subtle-default bg-card text-single-base-medium text-text-primary-default hover:bg-surface-primary-hover inline-flex h-9 items-center gap-2 rounded-lg border px-3"
              @click="copyShare(share)"
            >
              <component :is="copiedId === share.id ? PhCheck : PhCopy" :size="16" />
              {{ copiedId === share.id ? 'Copied' : 'Copy URL' }}
            </button>
            <button
              type="button"
              class="roadmap-action text-single-base-medium text-text-subtle-default hover:text-text-primary-default inline-flex h-9 items-center gap-2 rounded-lg px-3"
              @click="disableShare(share)"
            >
              <PhLinkBreak :size="16" />
              Disable link
            </button>
          </div>
        </article>
      </div>
    </template>
  </div>
</template>
