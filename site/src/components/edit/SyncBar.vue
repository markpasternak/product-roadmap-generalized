<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { STATUS_COPY, PROGRESSION_STEPS, type ProgressionStep } from '../../lib/edit/statusCopy';

type ChangeSummary = {
  edited: { id: string; title: string }[];
  created: { title: string; product: string }[];
  deleted: { id: string; title: string }[];
  reorderLanes: number;
};

const props = withDefaults(
  defineProps<{
    dirtyCount: number;
    pending: boolean;
    result: { sha: string } | null;
    error: string | null;
    /** Set right after a successful sync while the rebuild carrying it is in flight —
     * the working copy is kept on screen (see Board's doSync), so the bar needs to say
     * why nothing looks "final" yet. `stage` (U4/KTD4) is the deploy-status progression
     * Board's poll drives it through — absent/undefined means "committed, nothing polled
     * back yet" (the plain "Publishing…" copy); `htmlUrl` is only set once `stage === 'failed'`. */
    publishing?: { sha: string; stage?: 'building' | 'live' | 'failed' | 'superseded' | 'no_build'; htmlUrl?: string } | null;
    /** True when a newer build than this bundle's has been detected live (Board's
     * `newVersion`) while there are still unsynced edits — Sync will last-write-wins
     * over it. Non-blocking: just makes that trade-off visible near the Sync action. */
    overwriteWarning?: boolean;
    /** Fix #8: a concise, name-resolved summary of exactly what Sync is about to
     * publish (Board's `changeSummary`) — rendered behind the "Review" affordance so
     * the user can see what they're committing before clicking Sync. */
    changeSummary?: ChangeSummary;
    /** U12 (R14): the draft → published → building → live progression's current step,
     * computed by Board from the same `bannerState`/deploy-status this bar's own copy
     * below is driven by — `null`/absent while an interrupt (conflict, session-expired,
     * validation-blocked) is the primary status, since the linear story doesn't apply then. */
    progressionStep?: ProgressionStep | null;
  }>(),
  { changeSummary: () => ({ edited: [], created: [], deleted: [], reorderLanes: 0 }) },
);
const emit = defineEmits<{ (e: 'sync'): void; (e: 'discard'): void }>();

// U12 (KTD7): the per-stage publishing copy, sourced from the same `STATUS_COPY` table the
// top edit banner reads from (Board.vue) — one place for the sentence, not two hand-typed
// copies drifting apart. `undefined`/no stage yet still reads as the plain "Publishing…"
// entry (nothing polled back from the deploy status endpoint yet).
// Index into PROGRESSION_STEPS, computed once here (rather than repeating `.indexOf` per
// dot in the template) — also sidesteps template-level null-narrowing of the optional prop.
const progressionIndex = computed(() => (props.progressionStep ? PROGRESSION_STEPS.indexOf(props.progressionStep) : -1));
const publishingCopy = computed(() => {
  switch (props.publishing?.stage) {
    case 'building':
      return STATUS_COPY.building;
    case 'live':
      return STATUS_COPY.live;
    case 'failed':
      return STATUS_COPY.buildFailed;
    case 'superseded':
      return STATUS_COPY.superseded;
    case 'no_build':
      return STATUS_COPY.noBuild;
    default:
      return STATUS_COPY.publishing;
  }
});

// Confirmation now lives one level up (Board's onDiscardAll), which knows the live
// dirty count and can word the prompt accordingly — this button just reports the click.

// Fix #8: the review popover. Quiet by design — closed by default, toggled from the
// dirty-count text, and dismissed on an outside click (like OwnerInput's suggestion
// dropdown) so it never lingers over the board once the user looks away.
const reviewOpen = ref(false);
const reviewContainerRef = ref<HTMLElement>();
function onPointerDown(e: MouseEvent) {
  if (!reviewContainerRef.value || reviewContainerRef.value.contains(e.target as Node)) return;
  reviewOpen.value = false;
}
onMounted(() => document.addEventListener('mousedown', onPointerDown));
onUnmounted(() => document.removeEventListener('mousedown', onPointerDown));

// Joins up to `max` names for a concise, scannable list, appending "+N more" beyond that
// cap instead of listing every changed item (which could get long in a big Sync).
function formatNames(names: string[], max = 5): string {
  const shown = names.slice(0, max);
  const extra = names.length - shown.length;
  return extra > 0 ? `${shown.join(', ')} +${extra} more` : shown.join(', ');
}
const editedNames = computed(() => props.changeSummary.edited.map((e) => e.title));
const createdNames = computed(() => props.changeSummary.created.map((c) => c.title.trim() || 'Untitled'));
const deletedNames = computed(() => props.changeSummary.deleted.map((d) => d.title));
const hasReviewContent = computed(
  () =>
    editedNames.value.length > 0 ||
    createdNames.value.length > 0 ||
    deletedNames.value.length > 0 ||
    props.changeSummary.reorderLanes > 0,
);
</script>

<template>
  <div
    v-if="dirtyCount > 0 || result || error || publishing"
    data-test="sync-bar"
    class="border-border-subtle-default bg-background fixed inset-x-0 bottom-0 z-40 flex flex-col gap-1.5 border-t px-6 py-3 shadow-xl"
  >
    <p
      v-if="overwriteWarning"
      data-test="overwrite-warning"
      class="text-single-sm-medium rounded-md px-2.5 py-1.5"
      :style="{
        background: 'color-mix(in srgb, var(--color-accent-brand-default) 12%, transparent)',
        color: 'var(--color-accent-brand-default)',
      }"
    >
      A newer version is live — syncing overwrites it for your edited items. Reload to build on it first.
    </p>
    <!-- U12 (R14): the same draft → published → building → live progression the top edit
         banner shows (Board.vue) — mirrored here from the `progressionStep` prop it computes,
         so this bar never tells a different story. Hidden during an interrupt (conflict/
         session-expired/validation-blocked), same as the banner's copy. -->
    <div
      v-if="progressionStep"
      class="flex items-center gap-1.5 text-[0.7rem] text-text-subtle-default"
      data-test="sync-bar-progression"
      :data-progression-step="progressionStep"
    >
      <template v-for="(step, i) in PROGRESSION_STEPS" :key="step">
        <span class="size-1.5 shrink-0 rounded-full bg-current" :class="progressionIndex >= i ? 'opacity-100' : 'opacity-30'" />
        <span
          v-if="i < PROGRESSION_STEPS.length - 1"
          class="h-px w-3 shrink-0 bg-current"
          :class="progressionIndex > i ? 'opacity-100' : 'opacity-30'"
        />
      </template>
      <span class="ml-1">{{ progressionStep }}</span>
    </div>
    <div class="flex items-center justify-between gap-4">
      <p class="text-single-sm-medium text-text-primary-default">
        <template v-if="publishing">
          <span data-test="publishing-state"
            >{{ publishingCopy.message }}
            <a
              v-if="publishing.stage === 'failed' && publishing.htmlUrl"
              :href="publishing.htmlUrl"
              target="_blank"
              rel="noopener"
              class="underline decoration-dotted underline-offset-2"
              data-test="publishing-build-failed-link"
              >{{ publishingCopy.action }}</a
            ></span
          >
        </template>
        <template v-else-if="result">Synced ✓ — live in ~1 min</template>
        <template v-else-if="error">
          <span
            data-test="sync-error"
            class="font-semibold"
            :style="{ color: 'var(--color-feedback-error-text-independent-default)' }"
            >{{ error }}</span
          >
        </template>
        <template v-else>
          <span ref="reviewContainerRef" class="relative inline-block">
            <button
              type="button"
              data-test="review-toggle"
              class="rounded underline decoration-dotted underline-offset-2 hover:text-accent-brand-default"
              :aria-expanded="reviewOpen"
              @click="reviewOpen = !reviewOpen"
            >
              <b class="tabular-nums">{{ dirtyCount }}</b> unpublished change{{ dirtyCount === 1 ? '' : 's' }}
            </button>
            <!-- R16: "saved, not published" has to be unmistakable — the top edit banner
                 (Board.vue) already states this plainly for the unsynced status; repeated
                 here in SyncBar's own words too, but only from `sm` up — this row has no
                 flex-wrap, and this board is mobile-critical, so the extra clause is dropped
                 rather than risking the Discard/Sync buttons getting squeezed on a narrow
                 screen. -->
            <span class="text-text-subtle-default font-normal no-underline hidden sm:inline"> — saved on this device, not published</span>

            <div
              v-if="reviewOpen && hasReviewContent"
              data-test="review-panel"
              class="border-border-subtle-default bg-card absolute bottom-full left-0 mb-2 w-72 max-w-[80vw] rounded-lg border p-3 text-left shadow-lg"
            >
              <p v-if="editedNames.length" data-test="review-edited" class="mb-1 last:mb-0">
                <b>Edited ({{ editedNames.length }}):</b> {{ formatNames(editedNames) }}
              </p>
              <p v-if="createdNames.length" data-test="review-created" class="mb-1 last:mb-0">
                <b>New ({{ createdNames.length }}):</b> {{ formatNames(createdNames) }}
              </p>
              <p v-if="deletedNames.length" data-test="review-deleted" class="mb-1 last:mb-0">
                <b>Deleted ({{ deletedNames.length }}):</b> {{ formatNames(deletedNames) }}
              </p>
              <p v-if="changeSummary.reorderLanes > 0" data-test="review-reorder" class="mb-1 last:mb-0">
                Reordered {{ changeSummary.reorderLanes }} lane{{ changeSummary.reorderLanes === 1 ? '' : 's' }}.
              </p>
            </div>
          </span>
        </template>
      </p>
      <div v-if="dirtyCount > 0" class="flex items-center gap-2.5">
        <button
          type="button"
          data-test="discard-all"
          class="border-border-subtle-default bg-card/80 text-single-sm-medium text-text-subtle-default hover:text-text-primary-default rounded-lg border px-3.5 py-2 transition-colors disabled:opacity-50"
          :disabled="pending"
          @click="emit('discard')"
        >
          Discard all
        </button>
        <button
          type="button"
          data-test="sync"
          title="Sync — combines every change into one commit"
          :disabled="pending"
          class="bg-accent-brand-default text-text-primary-inverted-default rounded-lg px-4 py-2 text-single-sm-medium disabled:opacity-50"
          @click="emit('sync')"
        >
          {{ pending ? 'Syncing…' : 'Sync → one commit' }}
        </button>
      </div>
    </div>
  </div>
</template>
