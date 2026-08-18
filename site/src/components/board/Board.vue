<script setup lang="ts">
import { reactive, ref, computed, watch, nextTick, onMounted, onUnmounted, defineAsyncComponent } from 'vue';
import Sortable from 'sortablejs';
import FiltersSidebar from './FiltersSidebar.vue';
import RoadmapCard from './RoadmapCard.vue';
import DetailDrawer from './DetailDrawer.vue';
import ActiveFilterChips from './ActiveFilterChips.vue';
import LaneJumpBar from './LaneJumpBar.vue';
import SearchInput from '../ui/SearchInput.vue';
import Select from '../ui/Select.vue';
import BrandMark from '../ui/BrandMark.vue';
import ShareDialog from '../share/ShareDialog.vue';
import RecentChanges from './RecentChanges.vue';
import { cn } from '../../lib/utils';
import { productSlug } from '../../lib/slugs';
import { trapFocus } from '../../lib/focusTrap';
import { projectForShare } from '../../lib/share/project';
import { renderShareHtml, buildShareBundle, type ShareContext, type ShareTheme } from '../../lib/share/render';
import { getCanvasdrop, updateAuthoredCanvas, type AccessRung, type AuthoredCanvas, type Me, type ShareStatus } from '../../lib/share/canvasdrop';
import { SHARE_SOURCE_APP, SHARE_SOURCE_KIND, SHARE_TAG } from '../../lib/share/roadmapShares';
import { formatDateTime } from '../../lib/dates';
import { readTokenFromHash, me, loginUrl, fetchItems, sync, deployStatus, type DeployStatus } from '../../lib/edit/client';
import { itemsFromApi } from '../../lib/edit/liveItems';
import { useEditStore } from '../../lib/edit/store';
import { validateChangeset, type FieldError } from '../../lib/edit/validate';
import {
  STATUS_COPY,
  PROGRESSION_STEPS,
  conflictMessage,
  validationBlockedMessage,
  progressionStepFor,
  type LifecycleState,
} from '../../lib/edit/statusCopy';
import { projectBoard } from '../../lib/edit/project';
import { watchForNewVersion } from '../../lib/edit/version';
import SyncBar from '../edit/SyncBar.vue';
import PresenceIndicator from './PresenceIndicator.vue';
import { useBackend } from '../../composables/useBackend';
import { usePresence } from '../../composables/usePresence';
import type { DraftedItem } from '../../lib/ai/draftItem';

// Lazy: keeps the ~270KB md-editor (SectionEditor → MarkdownEditor) out of the initial
// bundle — only fetched once a signed-in editor actually opens the full-screen editor.
const ItemEditor = defineAsyncComponent(() => import('../edit/ItemEditor.vue'));
// Lazy for the same reason as ShareDialog/ItemEditor: this pulls in the AI client and is
// only ever needed once an editor with AI available opens it.
const NewWithAiDialog = defineAsyncComponent(() => import('../edit/NewWithAiDialog.vue'));
import {
  PhSlidersHorizontal,
  PhArrowsOut,
  PhArrowsIn,
  PhX,
  PhPresentation,
  PhCheck,
  PhShareNetwork,
  PhPencilSimple,
  PhPencilSimpleLine,
  PhPlus,
  PhSparkle,
} from '@phosphor-icons/vue';
import { HORIZONS, PRODUCTS, VISIBILITIES } from '../../lib/schema';
import {
  horizonDot,
  horizonDescription,
  horizonStatLabel,
  horizonTone,
  laneEmptyCopy,
  productColor,
  productListSentence,
  toneText,
  type Tone,
} from '../../lib/display';
import { IS_PUBLIC } from '../../lib/audience';
import {
  filterItems,
  createSearchContext,
  sortItems,
  groupItems,
  emptyFilters,
  activeFilterCount,
  activeFilterChips,
  assetOptionsForFilters,
  stageOptionsForItems,
  levelOptionsForItems,
  tagOptionsForFilters,
  type ItemVM,
  type ActiveFilterChip,
  type FilterState,
  type SortKey,
} from '../../lib/filters';

const props = defineProps<{ items: ItemVM[]; initialProduct?: string | null; base?: string }>();

// The board's actual data base. `props.items` is only the SSR seed — the deployed site's
// content, up to ~1 min stale by the time this page is loaded. Everything the board derives
// (filters, tags, owners, the working-copy projection, reconcile) reads `liveItems` instead,
// so a post-Sync refresh (see `refreshLiveItems` below) can swap in the git-fresh state
// `/api/items` reflects immediately — without that, every action taken right after a
// successful Sync (before a full reload) would still operate on the stale seed: a self-
// conflict on the very item just published, a false "unpublished change" on exit, a landed
// delete or create getting re-sent (the latter producing a duplicate item).
const liveItems = ref<ItemVM[]>(props.items.slice());

const filters = reactive<FilterState>(emptyFilters());
// Horizon is a MULTI-select filter, deliberately kept OUTSIDE `filters` — `canReorder`
// (below) reads `filters` only, so keeping horizon separate means selecting/deselecting
// horizon chips never affects whether priority-reordering is allowed.
const DEFAULT_HORIZONS = ['Now', 'Next', 'Later'] as const;
const horizons = ref<string[]>([...DEFAULT_HORIZONS]);
function toggleHorizon(h: string) {
  horizons.value = horizons.value.includes(h) ? horizons.value.filter((x) => x !== h) : [...horizons.value, h];
}
const activeChips = computed(() => activeFilterChips(filters));
const sort = ref<SortKey>('manual');
// Desktop filter sidebar visibility is a sticky preference (like the theme).
const sidebarOpen = ref(true);
watch(sidebarOpen, (v) => {
  try {
    localStorage.setItem('rm-sidebar', v ? '1' : '0');
  } catch {
    /* ignore */
  }
});
const sheetOpen = ref(false);
// Fix #9: the "?" cheat-sheet overlay (global keyboard shortcuts). See onGlobalKey below.
const shortcutsOpen = ref(false);
// Presentation mode (?present=1): the current view, chrome-less, for sharing. POC —
// a real share link would load settings from a store behind a hash.
const present = ref(false);
const selected = ref<ItemVM | null>(null);
const isFull = ref(false);
// The board ships cloaked (SSR renders the default, unfiltered view because a static
// build can't know the URL query). We resolve the real view from the URL in onMounted,
// then flip `ready` to reveal it — so the flash of unfiltered content is never seen.
const ready = ref(false);
const root = ref<HTMLElement>();

const canShare = ref(false);
const shareOpen = ref(false);
const sharePending = ref(false);
const shareError = ref<string | null>(null);
const sharesLoading = ref(false);
const sharesError = ref<string | null>(null);
const authoredShares = ref<AuthoredCanvas[]>([]);
const shareAuthor = ref<Me | null>(null);
const shareResult = ref<{ id?: string; url: string; expiresAt: number | null; status?: ShareStatus; action?: 'created' | 'updated' } | null>(null);

// Gated in-app editing (GitHub sign-in via the edit-service). `canEdit` reflects
// whether the signed-in user is an authorized editor; `editMode` toggles the
// (separately implemented) editing UI once signed in.
const canEdit = ref(false);
const editorLogin = ref('');
const editMode = ref(false);
// U4: "New with AI" is gated on top of canEdit/editMode by the canvas Backend's AI
// accessor actually being present (KTD3) — feature-detected, no probing call, absent
// (not erroring) when the Backend/AI isn't available (R14).
const { aiAvailable, realtimeAvailable } = useBackend();
const newWithAiOpen = ref(false);

// U6: live presence — "N viewing" + avatars, visible to ALL viewers (gated only by
// realtimeAvailable, not canEdit/editMode — R11). The composable itself no-ops when
// realtime isn't available (R14); `othersEditing` only matters once this client is
// also in edit mode (R13). Presentation (the pill + avatars, the "also editing"
// nudge) lives in PresenceIndicator.vue — Board.vue just wires the composable and
// the edit-mode watcher below and passes the reactive values through as props.
const { viewers, othersEditing, setEditing } = usePresence('roadmap');
// Wires this client's own edit-mode state into the realtime "also editing" signal
// (R13) — publishes editing:true the moment edit mode turns on, editing:false when
// it turns off (including on sign-out/unmount, since editMode is reset there too).
watch(editMode, (on) => setEditing(on), { immediate: true });
// U4: persist edit mode across a refresh — a signed-in editor who was mid-edit doesn't
// want to re-toggle it after every reload.
watch(editMode, (on) => {
  try {
    localStorage.setItem('rm-edit-mode', on ? '1' : '0');
  } catch {
    /* ignore */
  }
});
// `location` isn't in Vue's template-globals whitelist, so navigate from a method.
function signIn() {
  window.location.href = loginUrl();
}

const editStore = useEditStore();
const syncPending = ref(false);
const syncResult = ref<{ sha: string } | null>(null);
const syncError = ref<string | null>(null);
// Set when sync() reports the session is gone (401/403) — clearToken() has already run
// server-side of that call; this just drives the "Sign in again" affordance (the draft
// itself is untouched, so signing in again and re-syncing loses nothing). Cleared the
// moment a sync succeeds.
const sessionExpired = ref(false);
// U12 (R13/KTD7): which of the two named, higher-than-unsynced interrupts `syncError` is
// currently carrying — `null` for every other kind of error (a generic "couldn't publish",
// the network-ambiguous catch, the not-yet-loaded-base-version guard), which stay inside the
// plain `unsynced` status rather than claiming one of R13's four named interrupt states.
// Drives `bannerState`'s precedence below; the actual message text still lives in
// `syncError` (built via `conflictMessage`/`validationBlockedMessage` from statusCopy.ts),
// so this is classification only, not a second copy of the copy.
const interruptKind = ref<'conflict' | 'validationBlocked' | null>(null);
// U8 (R9): names of items whose reorder the last successful sync couldn't place (moved lanes
// or deleted upstream) and skipped rather than aborting the whole sync — resolved from
// `SyncResult.skippedReorders` (ids) via `byId` where possible. A quiet, non-blocking notice:
// the sync itself still succeeded, this just says a reorder didn't fully land. Cleared at the
// start of every new sync attempt and left empty when a sync reports none.
const skippedReorderNames = ref<string[]>([]);
// U12 (R16): the persist-failure chip is dismissible, like the cross-tab one and the
// skipped-reorder toast — a secondary notice should never be stuck on screen with no way to
// quiet it. The store only tracks the mechanical `persistFailed` (whether the LAST persist
// attempt threw); "dismissed" is purely a display concern, so it lives here — and resets the
// moment `persistFailed` flips false→true again, so a fresh failure after an old, dismissed
// one is still shown rather than staying hidden forever.
const persistFailedDismissed = ref(false);
watch(
  () => editStore.persistFailed.value,
  (failed, prevFailed) => {
    if (failed && !prevFailed) persistFailedDismissed.value = false;
  },
);
// U4 (R4/KTD4): the deploy-status progression a committed sha moves through, driven by
// polling `/api/status` (see startDeployPoll below). `undefined`/absent means "committed,
// nothing polled back yet" — the plain "Publishing…" copy. `htmlUrl` is only meaningful once
// `stage === 'failed'` (the failing run to link to).
type DeployStage = 'building' | 'live' | 'failed' | 'superseded' | 'no_build';
// Set once a sync lands, while the rebuild it triggered is still in flight. The working
// copy (and the SyncBar) stay visible through this window — nothing the user added or
// changed should vanish before the new deploy is actually live. Reconcile (mount-time and
// the base-version refetch) drops the draft ops the rebuilt content already reflects once
// that deploy lands; `stage` (above) tracks the deploy itself, driven by startDeployPoll.
const publishing = ref<{ sha: string; stage?: DeployStage; htmlUrl?: string } | null>(null);
// U9: true once a rebuild carrying a newer commit than this bundle's is detected live.
const newVersion = ref(false);
let stopVersionWatch: (() => void) | null = null;
// The changeset exactly as last sent to a successful Sync — lets `unsynced` (below) tell
// "nothing edited since" (fully published) from "edited again after Sync" (genuinely dirty).
// A ref (not a plain `let`) so the `unsynced` computed reacts to it.
const syncedJson = ref<string | null>(null);

// Fix #10: a dismissible corner toast fired once a Sync actually lands, complementing the
// "Publishing…" banner (which covers the in-flight window) with a traceable link to the
// commit that just went out. Independent of `syncResult`/`publishing` above — those persist
// until the next Sync (or a rebuild lands) and drive the banner/SyncBar copy, whereas this
// has its own short-lived show/auto-dismiss lifecycle.
const toastVisible = ref(false);
const toastSha = ref('');
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function showSyncToast(sha: string) {
  toastSha.value = sha;
  toastVisible.value = true;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastVisible.value = false;
  }, 6000);
}
function dismissToast() {
  toastVisible.value = false;
  clearTimeout(toastTimer);
}
const toastCommitUrl = computed(() => `https://github.com/markpasternak/product-roadmap-generalized/commit/${toastSha.value}`);
const toastShortSha = computed(() => toastSha.value.slice(0, 7));

// U4 (R4/R5/KTD4): once a Sync commits, poll `/api/status` — bounded backoff, always
// re-fetching the LATEST run (never a pinned run id) — to drive `publishing.value.stage`
// through building → live, or reveal build-failed/superseded/no-build. Deliberately
// lightweight (a later unit, U12, is the full unified status surface): this only makes these
// states real and legible, it doesn't try to own every lifecycle state.
const DEPLOY_POLL_INTERVALS_MS = [3000, 5000, 8000, 13000, 21000, 30000];
// Bound for "we've never even seen a run carrying our commit" — a commit that only touches
// path-filtered files (deploy.yml's path filter) triggers no run at all, so without a bound
// this would poll forever waiting for something that will never arrive (KTD4).
const DEPLOY_NO_RUN_TIMEOUT_MS = 2 * 60 * 1000;
// A hard safety cap on total attempts regardless of state, so a stuck poll (e.g. a
// `superseded` loop that never resolves) can't run forever in a long-lived tab.
const DEPLOY_MAX_POLL_ATTEMPTS = 60;
// On mount, only resume the build banner for a commit recorded within this window — the
// deploy is ~1 min, so past a few minutes any not-yet-cleared committed sha belongs to a
// past session whose build is long live, and must be dropped rather than resurrected.
const DEPLOY_RESUME_MAX_AGE_MS = 5 * 60 * 1000;

let deployPollTimer: ReturnType<typeof setTimeout> | null = null;
let deployPollSha = '';
let deployPollAttempt = 0;
let deployPollStartedAt = 0;
// True once a poll has seen a run whose head IS our committed sha — distinguishes "no run
// has shown up for us yet, still waiting" from "a run for us existed, and now a DIFFERENT
// (necessarily newer, since the endpoint only ever reports the latest) run has taken its
// place" — the latter is a superseding run per KTD4, not a stale unrelated one.
let deployPollSawOwnRun = false;
// Identity epoch for the currently-active poll chain. `syncPending` is cleared in doSync's
// `finally` before the FIRST poll's initial /api/status fetch resolves, so SyncBar re-enables
// Sync and a fast second Sync can call startDeployPoll again while that first fetch is still
// in flight. Comparing against the shared `deployPollSha` isn't enough to catch this — by the
// time the first chain's in-flight callback checks it, `deployPollSha` has already been
// reassigned to the SECOND sha, so the stale chain doesn't bail and both chains end up running
// concurrently against the one shared deployPollTimer/deployPollAttempt (only one is
// cancelable, the other becomes an orphan that keeps hitting /api/status past unmount and
// halves the surviving chain's attempt budget). Every `startDeployPoll`/`stopDeployPoll`
// bumps this counter; each poll chain captures the epoch it was started under and bails the
// moment it no longer matches the live one.
let deployPollEpoch = 0;

function stopDeployPoll() {
  if (deployPollTimer) clearTimeout(deployPollTimer);
  deployPollTimer = null;
  deployPollEpoch += 1;
}

// Maps one `/api/status` run onto `publishing.value.stage` (KTD4's building/live/failed/
// superseded mapping). Never called with a run that isn't ours or a superseding one — see
// pollDeployOnce's identity/ancestry gate below.
function applyDeployRun(run: DeployStatus) {
  if (!publishing.value) return;
  if (run.status === 'completed') {
    if (run.conclusion === 'success') {
      publishing.value = { ...publishing.value, stage: 'live' };
      // Nothing left to resume on a later reload — the build is confirmed live.
      editStore.clearCommit();
    } else if (run.conclusion === 'failure') {
      publishing.value = { ...publishing.value, stage: 'failed', htmlUrl: run.htmlUrl };
    } else {
      // cancelled / skipped / timed_out — deploy.yml's `cancel-in-progress: true` cancels a
      // superseded run rather than failing it; a newer run carrying our (or a later) commit
      // is expected to appear next, so this isn't a failure — keep polling for it.
      publishing.value = { ...publishing.value, stage: 'superseded' };
    }
  } else {
    // queued / in_progress
    publishing.value = { ...publishing.value, stage: 'building' };
  }
}

async function pollDeployOnce(epoch: number) {
  // A newer Sync (or a clean unmount) may have started a fresh chain — or torn this one down —
  // since this attempt was scheduled; bail rather than run alongside/instead of the current one.
  if (epoch !== deployPollEpoch) return;
  if (!publishing.value || publishing.value.sha !== deployPollSha) return;
  const run = await deployStatus();
  if (epoch !== deployPollEpoch) return;
  if (!publishing.value || publishing.value.sha !== deployPollSha) return;
  if (!run) {
    // Unavailable — network error, a session that's gone, or the endpoint simply not
    // existing (e.g. local dev without the edit-service). Degrade silently: no error, just
    // stop polling and leave the plain "Publishing…" copy rather than showing a progression
    // the backend can't actually give us right now.
    stopDeployPoll();
    return;
  }
  const hasRun = !!run.headSha;
  if (hasRun && run.headSha === deployPollSha) {
    deployPollSawOwnRun = true;
    applyDeployRun(run);
  } else if (hasRun && deployPollSawOwnRun) {
    // The latest-run endpoint only ever reports ONE run — a different head showing up after
    // we'd already seen our own can only be a run that superseded ours. `main` is
    // fast-forward-only, so that later commit's tree already contains ours: a `success` there
    // means we're live too — decided by identity/ancestry (KTD4), never by comparing shas
    // lexicographically (git shas aren't ordered).
    applyDeployRun(run);
  }
  // else: a run exists but isn't ours and we've never seen ours yet (e.g. an unrelated
  // in-flight run about to be cancelled once ours starts) — keep waiting, bounded below.

  const stage = publishing.value?.stage;
  if (stage === 'live' || stage === 'failed') {
    stopDeployPoll();
    return;
  }
  if (!deployPollSawOwnRun && Date.now() - deployPollStartedAt > DEPLOY_NO_RUN_TIMEOUT_MS) {
    // No run ever carried our commit — most likely a path-filtered commit that triggers none
    // at all (KTD4) — stop waiting instead of polling indefinitely.
    publishing.value = { ...publishing.value, stage: 'no_build' };
    stopDeployPoll();
    return;
  }
  deployPollAttempt += 1;
  if (deployPollAttempt >= DEPLOY_MAX_POLL_ATTEMPTS) {
    stopDeployPoll();
    return;
  }
  const idx = Math.min(deployPollAttempt - 1, DEPLOY_POLL_INTERVALS_MS.length - 1);
  deployPollTimer = setTimeout(() => void pollDeployOnce(epoch), DEPLOY_POLL_INTERVALS_MS[idx]);
}

// (Re)starts tracking `sha`'s deploy status from scratch — called both right after a
// successful Sync and, on mount, to resume tracking a persisted not-yet-live committed sha
// (R5). Always supersedes any prior poll (a fresh Sync's sha is the only one worth tracking):
// stopDeployPoll bumps `deployPollEpoch`, which is what actually retires any still-in-flight
// callback from a prior chain (see pollDeployOnce) — cancelling the timer alone isn't enough
// since the prior chain's in-flight /api/status fetch has already escaped the timer.
function startDeployPoll(sha: string) {
  stopDeployPoll();
  deployPollSha = sha;
  deployPollAttempt = 0;
  deployPollStartedAt = Date.now();
  deployPollSawOwnRun = false;
  void pollDeployOnce(deployPollEpoch);
}

// Joins up to `max` names for a concise validation/error message, appending "+N more"
// beyond that cap instead of listing every offending item (which could get long).
function capList(names: string[], max = 3): string {
  const shown = names.slice(0, max);
  const extra = names.length - shown.length;
  return extra > 0 ? `${shown.join(', ')} +${extra} more` : shown.join(', ');
}

// U5 (R6/R15): the item name a validation error should be shown under. `byId` (this board's
// published items) covers every UPDATED item; a locally-CREATED item has no published entry
// yet, so fall back to its pending title — or, if that's blank too (the exact case the
// required-title rule below flags), its product — from the same changeset the validator just
// ran against.
function displayNameFor(id: string, cs: ReturnType<typeof editStore.changeset>): string {
  const existing = byId.value.get(id);
  if (existing) return existing.title;
  const draftCreated = cs.created.find((c) => c.id === id);
  if (draftCreated) return draftCreated.title.trim() || `New item in ${draftCreated.product}`;
  return id;
}

// U5 (R6/R15): groups per-field validation errors under their item's display name —
// `Music App Templates: horizon "Sonn" isn't a valid horizon, owner is required` — so a
// multi-field problem on one item reads as one entry rather than several unrelated-looking
// lines (grouped, scannable, plain language — no jargon, no raw field-key dump). Capped at 3
// items, like capList above, so a large bad batch doesn't turn into a wall of text.
function formatValidationErrors(errors: FieldError[], cs: ReturnType<typeof editStore.changeset>): string {
  const byItem = new Map<string, string[]>();
  for (const e of errors) {
    const name = displayNameFor(e.id, cs);
    const messages = byItem.get(name);
    if (messages) messages.push(e.message);
    else byItem.set(name, [e.message]);
  }
  const groups = Array.from(byItem, ([name, messages]) => `${name}: ${messages.join(', ')}`);
  const shown = groups.slice(0, 3);
  const extra = groups.length - shown.length;
  return extra > 0 ? `${shown.join('; ')}; +${extra} more.` : `${shown.join('; ')}.`;
}

async function doSync() {
  // A fresh sync attempt starts from a clean interrupt state — a stale `sessionExpired` left
  // over from an EARLIER auth failure outranks `validationBlocked` in bannerState precedence
  // (see the `authExpired` check above `validationBlocked`), so without this reset a new
  // attempt that hits the validation-blocked early-return below would still show the old
  // "sign in again" banner instead of the fresh validation error the user actually needs to
  // see right now.
  sessionExpired.value = false;
  // R1 (fail-closed, KTD1/KTD2): every update/delete Sync sends must carry a baseSha so the
  // edit-service can detect a same-item conflict — so until the base-version map (fetched
  // alongside rawBodies on edit-mode entry, just above) has actually loaded, there's no
  // baseSha to send at all. Refuse to Sync rather than send an update/delete the server would
  // (correctly) reject as a conflict anyway; this only fires in the brief window right after
  // entering edit mode, or if that fetch failed outright.
  if (!baseVersionLoaded.value) {
    publishing.value = null;
    syncResult.value = null;
    interruptKind.value = null;
    syncError.value = 'Still loading your workspace — try again in a moment.';
    return;
  }
  // U5 (R6/KTD5): validate every field the sync-time server gate (`ValidateFrontmatter` in
  // edit-service/items.go) enforces — id/product/horizon/stage/title/owner/impact/effort/
  // visibility — plus the client-only tag-format and YAML-safety checks (see validate.ts),
  // before the request ever goes out. This is the general pass that replaced the old
  // title-only / owner-only ad-hoc pre-checks (fix #3/#10): it still catches an untitled new
  // item and a cleared owner (both are just one rule each in the general set now), plus every
  // other field a bad edit could poison the whole commit with. Sending anyway would 422 the
  // whole Sync — every other, valid change bundled in the same commit gets rejected with it —
  // so block here instead, with guidance the user can act on directly (which item, which
  // field, what's wrong).
  const preflightChangeset = editStore.changeset();
  const validationErrors = validateChangeset(preflightChangeset);
  if (validationErrors.length) {
    // A validation bounce should be the thing the user sees next — not a stale "Synced ✓"
    // or "Publishing…" left over from an earlier, successful Sync. U12 (R13/R15): tagged as
    // the named `validationBlocked` interrupt so it wins the primary status over a plain
    // `unsynced` (the edits are still dirty) instead of the two competing for the same spot.
    publishing.value = null;
    syncResult.value = null;
    interruptKind.value = 'validationBlocked';
    syncError.value = validationBlockedMessage(formatValidationErrors(validationErrors, preflightChangeset));
    return;
  }
  syncPending.value = true;
  publishing.value = null;
  // syncResult is reset too: SyncBar prioritizes it over `error` just like `publishing`,
  // so a stale "Synced ✓" from a prior success would otherwise mask a new failure here.
  syncResult.value = null;
  syncError.value = null;
  interruptKind.value = null;
  // A fresh attempt starts with no skipped-reorder notice — repopulated below only if this
  // sync itself reports one; a failed/retried sync shouldn't keep showing a stale notice from
  // an earlier, different sync.
  skippedReorderNames.value = [];
  try {
    // The plain (no-baseSha/no-requestId) snapshot still drives `unsynced` (compared against
    // `syncedJson` below) — unaffected by the extra fields spliced into the actual request.
    const sent = JSON.stringify(editStore.changeset());
    // U3 (R3/KTD3): mint-or-reuse the crypto-random requestId and persist it BEFORE sending,
    // so a lost-response retry of this exact changeset reuses it (server-side dedup) instead
    // of risking a duplicate commit; U2 (R1/KTD1): thread each changed/deleted item's captured
    // base blob sha alongside it.
    const requestId = editStore.ensureRequestId();
    const payload = { ...editStore.changeset(baseShaMap.value), requestId };
    const res = await sync(payload);
    if (res.ok) {
      sessionExpired.value = false;
      const sha = res.sha ?? '';
      // A NoChanges response means the server determined the sent changeset produces no real
      // diff against the repo — a true no-op. There's no commit to poll a deploy for, so treat
      // it as a clean resolve: don't set `publishing` (bannerState falls through to clean/
      // unsynced instead of getting stuck on "Publishing…" for a build that never happens),
      // don't show the sync toast, and don't recordCommit/startDeployPoll. The request still
      // landed, though, so the pending requestId is freed just like the normal success path.
      if (res.noChanges || !sha) {
        syncedJson.value = sent;
        editStore.clearRequestId();
      } else {
        syncResult.value = { sha };
        publishing.value = { sha };
        syncedJson.value = sent;
        // The request definitely landed — free the id so the NEXT Sync (of whatever's edited
        // after this) mints a fresh one rather than reusing this one.
        editStore.clearRequestId();
        showSyncToast(sha);
        // U8 (R9): a successful sync can still report reorders it had to skip (a stale reorder
        // id is tolerated, not rejected — KTD2's deliberate exception) — surface a visible,
        // non-blocking notice rather than letting them silently vanish. Resolve to titles via
        // `byId` (the published board) where possible, falling back to the raw id.
        if (res.skippedReorders && res.skippedReorders.length) {
          skippedReorderNames.value = res.skippedReorders.map((id) => byId.value.get(id)?.title ?? id);
        }
        // U4 (R4/R5/KTD4): persist the committed sha (+ the snapshot it was sent for, so a
        // reload can reconstruct `unsynced` correctly — see store.ts's recordCommit) and start
        // following the deploy through building → live / failed.
        editStore.recordCommit(sha, sent);
        startDeployPoll(sha);
      }
      // The edit-service reflects a landed commit in /api/items immediately (it reads git),
      // but this tab's `liveItems`/`baseShaMap` were captured at edit-mode entry — stale the
      // moment this Sync lands. Refresh now, for BOTH branches above (a real commit and a
      // true no-op alike — harmless either way), so the very next action (another edit,
      // another Sync, exiting edit mode) sees the git-fresh base instead of self-conflicting
      // against the commit it just made, or re-sending an op that already landed.
      await refreshLiveItems();
    } else if (res.authError) {
      // The token is already cleared (client.ts's sync()); nothing was committed, so the
      // draft is exactly as safe to retry as any other rejected Sync — the only thing
      // missing is a valid session, which "Sign in again" (the banner) restores without
      // touching the draft at all.
      sessionExpired.value = true;
      syncError.value = STATUS_COPY.authExpired.message;
    } else if (res.conflict && res.conflict.length) {
      // U2 (R1/R2): a per-item base-version conflict — additive to the whole-branch
      // fast-forward check below, not a replacement (KTD2). Nothing committed, draft intact;
      // same "reload, then re-sync" recovery shape as the fast-forward path, naming the
      // item(s) so the user knows what to expect to see change. On that reload the
      // base-version map above is re-captured fresh, so the re-sync actually converges
      // instead of re-sending the same stale baseSha and conflicting forever (R2). U12
      // (R13/R15): tagged as the named `conflict` interrupt — outranks a plain `unsynced`.
      const titles = res.conflict.map((id) => `"${byId.value.get(id)?.title ?? id}"`);
      interruptKind.value = 'conflict';
      syncError.value = conflictMessage(capList(titles));
    } else {
      const errors = res.errors || ['Sync failed'];
      // The edit-service's commit-ref update 422s with a "not a fast-forward"/"update ref"
      // style message when another editor published first — that's not a validation problem
      // with THIS change, it's a stale base, so the fix is "reload, then re-sync" rather than
      // "go fix the data". Same named `conflict` interrupt as the per-item case above — just
      // with no item to name (the whole-branch race, additive per KTD2).
      if (errors.some((e) => /update ref|fast.?forward|not a fast/i.test(e))) {
        interruptKind.value = 'conflict';
        syncError.value = conflictMessage('');
      } else {
        // A clean, non-OK response means the request landed and the server rejected it —
        // safe to fix and retry (nothing was committed). Not one of R13's named interrupts —
        // stays folded into the plain `unsynced` status, detail visible in the SyncBar.
        syncError.value = `Couldn't publish — ${errors.join('; ')}`;
      }
    }
  } catch {
    // A caught exception (network/transport failure) is ambiguous: the commit may have
    // actually landed server-side before the response was lost, so a blind retry could
    // duplicate any created items. Advise a reload first — the mount-time `editStore.
    // reconcile()` (see onMounted) drops any draft ops the freshly-loaded base already
    // reflects, so a reload is always safe before syncing again.
    syncError.value =
      "Couldn't confirm the sync completed (network issue). Reload to check whether it landed before syncing again — otherwise you may create duplicates.";
  } finally {
    syncPending.value = false;
  }
}
function onDiscardAll() {
  // A destructive, all-or-nothing action — confirm with the live count so the prompt says
  // exactly what's about to disappear (SyncBar's own per-click confirm was redundant with
  // this and has been removed; this is now the only gate).
  if (window.confirm(`Discard all ${editStore.dirtyCount.value} unsynced change(s)? This can't be undone.`)) {
    editStore.clear();
  }
}

// U11 (R12): exiting edit mode ("Done") with unsynced changes is a conscious Publish /
// Keep / Discard decision, not a silent drop. `exitPromptOpen` gates a small modal (see the
// template) offering exactly those three choices; nothing is discarded without the explicit
// Discard choice below, and dismissing the modal (Escape / backdrop click) just closes it —
// still editing, nothing decided.
const exitPromptOpen = ref(false);
// `toggleEditMode` is the ONE place both the "Done"/"Edit" button and the `e` keyboard
// shortcut go through (replacing the old direct `editMode.value = !editMode.value`), so
// neither can bypass the prompt below.
function toggleEditMode() {
  if (!editMode.value) {
    editMode.value = true;
    return;
  }
  // Gated on `unsynced` (genuinely dirty SINCE THE LAST SUCCESSFUL SYNC), not the raw
  // `dirtyCount` — dirtyCount can stay >0 for a moment after a publish that fully landed
  // (until reconcile drops the now-redundant ops), which would otherwise show a false
  // "1 unpublished change" prompt on Done right after a clean Sync. `refreshLiveItems`
  // (see doSync) reconciles dirtyCount down to 0 too in that case, but `unsynced` is the
  // right semantic to gate on regardless of that timing.
  if (unsynced.value) {
    exitPromptOpen.value = true;
    return;
  }
  // Nothing unsynced — exit directly, no prompt (today's behavior for a clean board).
  editMode.value = false;
}
function closeExitPrompt() {
  exitPromptOpen.value = false;
}
// Publish now: run the exact same doSync() Sync uses, then only exit edit mode if it
// actually resolved everything (a validation block, conflict, or failure leaves genuinely-
// unsynced work behind — `unsynced` already captures that — so stay in edit mode with the
// error visible rather than exiting on top of an unpublished draft).
async function onExitPublish() {
  exitPromptOpen.value = false;
  await doSync();
  if (!unsynced.value) editMode.value = false;
}
// Keep for later: exit to view mode, draft untouched — today's behavior, just reached
// through a conscious choice now instead of implicitly.
function onExitKeep() {
  exitPromptOpen.value = false;
  editMode.value = false;
}
// Discard: the only path that can drop the draft here, and only after an explicit confirm
// (mirrors onDiscardAll's own confirm) naming the live count.
function onExitDiscard() {
  if (!window.confirm(`Discard all ${editStore.dirtyCount.value} unsynced change(s)? This can't be undone.`)) return;
  exitPromptOpen.value = false;
  editStore.clear();
  editMode.value = false;
}
// True once there are genuinely-unsynced changes: dirty, and either nothing has ever been
// synced or the draft has moved on from the exact snapshot last sent to a successful Sync.
// Drives both the edit banner's copy (Board template) and whether SyncBar renders at all —
// once a Sync lands and nothing has changed since, this goes false and the bottom bar (and
// its Discard/Sync actions) disappears; editing again during publishing flips it back true.
const unsynced = computed(
  () =>
    editStore.dirtyCount.value > 0 &&
    (!publishing.value || JSON.stringify(editStore.changeset()) !== syncedJson.value),
);
// U9: called from the "newer version is live" banner (and the plain in-page Reload button).
// The mount-time reconcile (see onMounted) now drops any draft ops the freshly-loaded base
// already reflects, so a plain reload is always safe and uniform across both paths.
function reloadToLatest() {
  window.location.reload();
}

// U9 (R10): warn before the tab actually closes/navigates away while a sync is in flight or
// there's unsynced local work — losing either silently would contradict the "nothing lost"
// intent the rest of this hardening pass exists for. Silent (no-op) once the draft is clean —
// a plain "leaving edit mode" or closing a fully-synced tab shouldn't nag. `unsynced` already
// captures "genuinely dirty since the last successful Sync" (see its own computed above), so
// this reuses that exact definition rather than a second one that could drift from it.
function onBeforeUnload(e: BeforeUnloadEvent) {
  if (!syncPending.value && !unsynced.value) return;
  e.preventDefault();
  // Legacy browsers require a non-empty returnValue to actually show the confirmation.
  e.returnValue = '';
}

// U12 (R13/KTD7): the ONE primary status the edit banner (and, via `syncError`/`publishing`,
// SyncBar) shows at a time — every lifecycle state from U2-U11 funnels into this single
// precedence-ordered computed instead of being surfaced by independent, possibly-competing
// banners. Precedence, highest first: a fresher published build (orthogonal to this tab's own
// sync attempt — nothing here is trustworthy until it's reloaded) > conflict / session-expired
// (nothing can be published until one is resolved) > validation-blocked (this attempt was
// caught before it could even send) > the publishing/building/live/build-failed/superseded/
// no-build deploy progression (R4/R5/KTD4 — "publishing" itself covers "it IS published, just
// not built yet," no "unpublished" wording) > genuinely-unsynced edits > a clean board with
// nothing to say. `BannerState` is `statusCopy.ts`'s `LifecycleState` — the copy for every
// value below lives in exactly one place (`STATUS_COPY`), not duplicated here or in SyncBar.
type BannerState = LifecycleState;
const bannerState = computed<BannerState>(() => {
  if (newVersion.value) return 'reload';
  if (interruptKind.value === 'conflict') return 'conflict';
  if (sessionExpired.value) return 'authExpired';
  if (interruptKind.value === 'validationBlocked') return 'validationBlocked';
  if (publishing.value && !unsynced.value) {
    switch (publishing.value.stage) {
      case 'building':
        return 'building';
      case 'live':
        return 'live';
      case 'failed':
        return 'buildFailed';
      case 'superseded':
        return 'superseded';
      case 'no_build':
        return 'noBuild';
      default:
        return 'publishing';
    }
  }
  if (unsynced.value) return 'unsynced';
  return 'clean';
});
// R14: the small draft → published → building → live progression's current step — `null`
// for every interrupt state (reload/conflict/authExpired/validationBlocked), where the linear
// story doesn't apply. Passed to SyncBar, which renders it near the primary status.
const progressionStep = computed(() => progressionStepFor(bannerState.value));
// Index into PROGRESSION_STEPS — computed once here rather than repeating `.indexOf` per dot
// in the template, and sidesteps null-narrowing an optional value across template bindings.
const progressionIndex = computed(() => (progressionStep.value ? PROGRESSION_STEPS.indexOf(progressionStep.value) : -1));
// R14 (polish): only surface the progress track for the actual publish → build → live journey.
// A plain "Draft" (clean/unsynced edit mode) isn't a point of progress, so the bar stays hidden
// there rather than showing an empty 0%-filled track on every edit.
const showProgression = computed(() => progressionStep.value != null && progressionStep.value !== 'Draft');
// Fill fraction across the journey — Published ⅓ → Building ⅔ → Live full.
const progressionPct = computed(() => `${(progressionIndex.value / (PROGRESSION_STEPS.length - 1)) * 100}%`);
// Animate the fill (a soft sheen) only while it's still moving toward live.
const progressionActive = computed(() => progressionStep.value !== 'Live');
// Treatments: reload, authExpired, buildFailed, conflict, and validationBlocked are solid,
// attention-grabbing fills — every one of them needs the user to actually do something before
// anything else can proceed; every other "editing is live" state (publishing / building /
// live / superseded / noBuild / unsynced) shares a calm accent-tint, just worded differently;
// clean is muted — editing is on, but there's nothing to say about it.
// `top` sticks the banner directly below the site header (Navbar is `sticky top-0`, 48px
// tall — see components/ui/Navbar.vue) so the two stack without overlapping. Full-screen
// mode (isFull) removes the Navbar from the fullscreen surface entirely (requestFullscreen
// is called on the board root, a Navbar sibling), so the banner sticks to the very top there.
const bannerStyle = computed(() => {
  const top = isFull.value ? '0px' : '48px';
  if (bannerState.value === 'reload') {
    return {
      top,
      background: 'var(--color-accent-brand-default)',
      color: 'var(--color-text-primary-inverted-default)',
      borderBottom: '1px solid var(--color-accent-brand-default)',
    };
  }
  if (
    bannerState.value === 'authExpired' ||
    bannerState.value === 'buildFailed' ||
    bannerState.value === 'conflict' ||
    bannerState.value === 'validationBlocked'
  ) {
    return {
      top,
      background: 'var(--color-feedback-error-surface-primary-default)',
      color: 'var(--color-text-primary-inverted-default)',
      borderBottom: '1px solid var(--color-feedback-error-surface-primary-default)',
    };
  }
  if (bannerState.value === 'clean') {
    return {
      top,
      background: 'color-mix(in srgb, var(--color-accent-brand-default) 8%, transparent)',
      color: 'var(--color-text-primary-default)',
      borderBottom: '1px solid color-mix(in srgb, var(--color-accent-brand-default) 25%, transparent)',
    };
  }
  return {
    top,
    background: 'color-mix(in srgb, var(--color-accent-brand-default) 12%, transparent)',
    color: 'var(--color-accent-brand-default)',
    borderBottom: '1px solid color-mix(in srgb, var(--color-accent-brand-default) 35%, transparent)',
  };
});

// The board only ever sees parsed sections for an item's body (never the raw markdown),
// so the drawer's body editor needs the real source once — fetched from the edit-service
// the first time edit mode is turned on. Best-effort: on failure, body editing still works,
// it just seeds from the board's (lossy) reconstruction instead of the true source.
const rawBodies = ref<Map<string, string>>(new Map());
// U2 (R1/KTD1): each item's git blob sha, the server-computed "base version" — captured from
// the same /api/items response as rawBodies (see below) and threaded through doSync's
// changeset as `baseSha`/`deletedBaseShas` so the edit-service can detect a same-item edit
// race. `baseVersionLoaded` gates doSync itself (R1's fail-closed rule): until this fetch has
// actually succeeded, an update/delete can't carry a baseSha at all, so Sync refuses to send
// one rather than letting a conflict-check-less request through. A reload re-runs this whole
// flow from scratch (fresh mount → fresh fetch), which is exactly R2's "re-capture the
// base-version map on reload" convergence requirement — no extra bookkeeping needed here.
const baseShaMap = ref<Map<string, string>>(new Map());
const baseVersionLoaded = ref(false);
let rawBodiesRequested = false;
// Shared by both the edit-mode-entry watcher below and the U10 (R11) view-mode mount check —
// the one authed call that fetches raw bodies + base shas, and re-reconciles the draft with
// body knowledge in hand. `rawBodiesRequested` guards against firing it twice (e.g. the
// mount-time view-mode fetch already ran, then the user toggles edit mode on right after).
async function loadRawBodies() {
  if (rawBodiesRequested) return;
  rawBodiesRequested = true;
  try {
    const items = (await fetchItems()) as { id: string; body: string; sha?: string }[];
    rawBodies.value = new Map(items.map((it) => [it.id, it.body]));
    baseShaMap.value = new Map(
      items.filter((it): it is { id: string; body: string; sha: string } => !!it.sha).map((it) => [it.id, it.sha]),
    );
    baseVersionLoaded.value = true;
    // The mount-time reconcile (see onMounted) ran without body knowledge, so a body edit
    // that had already landed in the published base was left showing as locally dirty —
    // now that the real source is in hand, reconcile again to drop it.
    if (canEdit.value) editStore.reconcile(liveItems.value, rawBodies.value);
  } catch {
    // Degrade gracefully for the body-editor fallback (DetailDrawer falls back to its
    // parsed-sections reconstruction) — but baseVersionLoaded deliberately stays false here:
    // R1 is fail-closed, so doSync keeps refusing to send updates/deletes until a later
    // attempt (another editMode toggle, or a reload) actually gets the base-version map. U10
    // (R11): on the view-mode mount path this also just means the pending body edit is left
    // exactly as-is — conservative, no crash, nothing lost.
    //
    // Reset the guard so a transient failure (one flaky fetch) doesn't permanently wedge Sync
    // behind "Still loading your workspace…" — without this, `rawBodiesRequested` would stay
    // true forever and no later editMode toggle would ever retry the fetch, even though
    // `baseVersionLoaded` never got set. Only reset on failure: the success path above must
    // keep it true so a landed fetch isn't redundantly re-requested.
    rawBodiesRequested = false;
  }
}
watch(editMode, (on) => {
  if (on) void loadRawBodies();
});

// Refreshes the board's base state (liveItems + baseShaMap) from the edit-service's
// git-fresh `/api/items` — called right after a successful Sync (see doSync below) so the
// very next action (another edit, another Sync, exiting edit mode) operates on what was
// actually just committed rather than the SSR seed. `reconcile` then drops any draft ops the
// refreshed base already reflects — including a just-landed CREATE, matched by product+title
// the same way the mount-time reconcile matches one after a reload (store.ts's reconcile) —
// so a subsequent Sync never re-sends an op that already landed (the duplicate-item bug this
// whole refresh exists to close). Best-effort: any failure (network, parsing) leaves
// liveItems/baseShaMap exactly as they were — the board keeps working off the slightly-stale
// base it already had, and the existing ~1-min-reload path still recovers it eventually.
async function refreshLiveItems() {
  try {
    const api = await fetchItems();
    liveItems.value = itemsFromApi(api, props.base ?? '/');
    baseShaMap.value = new Map(api.filter((i) => i.sha).map((i) => [i.id, i.sha as string]));
    const rawBodies: Record<string, string> = {};
    for (const it of api) rawBodies[it.id] = it.body;
    editStore.reconcile(liveItems.value, rawBodies);
  } catch {
    // Degrade silently — see doc comment above.
  }
}

// The working copy: published items with the local changeset's edits/creates/deletes/
// reorders overlaid, purely for on-screen rendering (never mutates liveItems). Only
// used while a signed-in editor actually has edit mode on — everyone else sees the
// published board untouched.
const projected = computed(() => projectBoard(liveItems.value, editStore.changeset() as any));
const itemsForBoard = computed(() => (canEdit.value && editMode.value ? projected.value : liveItems.value));

// U7: the full-screen editor replaces the drawer's cramped edit panel. It always reads
// from `projected` so it reflects the same working copy the board renders (including a
// just-created item, which only exists there).
const editingId = ref<string | null>(null);
const editingItem = computed(() => (editingId.value ? (projected.value.find((i) => i.id === editingId.value) ?? null) : null));
const editingBody = computed(() =>
  editingId.value ? (editStore.bodyValue(editingId.value) ?? rawBodies.value.get(editingId.value) ?? '') : '',
);
const editingIsNew = computed(() => !!editingId.value && editingId.value.startsWith('new-'));
function openEditor(id: string) {
  editingId.value = id;
}
function onEditorField({ key, value }: { key: string; value: string }) {
  if (!editingId.value) return;
  editStore.setField(editingId.value, key, value);
}
// Fix #5: reset one metadata field back to its published value — the counterpart to
// onEditorField above, keyed off the same editingId.
function onEditorResetField(key: string) {
  if (!editingId.value) return;
  editStore.revertField(editingId.value, key);
}
function onEditorBody(body: string) {
  if (!editingId.value) return;
  editStore.setBody(editingId.value, body);
}
// U5 (R9): RewriteWithAi's Accept, re-emitted up through ItemEditor. Assembles into ONE
// body write (setBody replaces the whole body — a per-section write would clobber it)
// plus one field write per changed frontmatter field, reusing the exact same store
// calls onEditorBody/onEditorField already make rather than duplicating them.
function onEditorRewriteAccept({ body, frontmatter }: { body: string; frontmatter: Record<string, string> }) {
  onEditorBody(body);
  for (const [key, value] of Object.entries(frontmatter)) onEditorField({ key, value });
}
function onEditorDelete() {
  if (!editingId.value) return;
  const id = editingId.value;
  editingId.value = null;
  editStore.deleteItem(id);
}
function onEditorDiscard() {
  if (!editingId.value) return;
  const id = editingId.value;
  editingId.value = null;
  editStore.revertItem(id);
}
// Closing the editor (not via Delete/Discard, which already remove the item) on a
// just-created item that was never given a title AND never touched otherwise (no body/
// field edits) leaves nothing the user asked to keep — silently drop it. But a new item
// with real work in it (a body draft, a filled-in field) is kept even without a title:
// discarding it here would throw away that work; Sync's own pre-flight check (above)
// blocks it with a "needs a title" message until it's titled, same as any other untitled
// create.
function onEditorClose() {
  const id = editingId.value;
  editingId.value = null;
  if (id && id.startsWith('new-')) {
    const c = editStore.changeset().created.find((x) => x.id === id);
    if (c && !c.title.trim() && !editStore.isDirty(id)) editStore.revertItem(id);
  }
}

// The read-only DetailDrawer must never be the thing on screen while editing — an editor
// should always land in the full ItemEditor. Two paths can otherwise leave the drawer open
// in edit mode: the `?item=` URL restore in onMounted sets `selected` directly (it runs
// before `canEdit`/edit-mode resolve, so it can't call `select()`), and toggling edit mode
// ON while a drawer opened pre-edit-mode is still showing. Both funnel through `editMode`
// flipping true with a drawer item already selected, so one watcher covers both.
watch(editMode, (on) => {
  if (on && canEdit.value && selected.value) {
    const id = selected.value.id;
    selected.value = null;
    openEditor(id);
  }
});
// The other ordering: a selection that arrives WHILE edit mode is already on — e.g. the
// `?item=` URL restore runs after auto-resume already flipped editMode — routes to the editor
// too. And `drawerItem` guarantees the read-only drawer is never rendered in edit mode, so
// there's no flash even during the transition, regardless of which fired first.
watch(selected, (v) => {
  if (v && canEdit.value && editMode.value) {
    const id = v.id;
    selected.value = null;
    openEditor(id);
  }
});
const drawerItem = computed(() => (canEdit.value && editMode.value ? null : selected.value));

// Reordering priority (manual sort) is only meaningful viewing ONE product with no other
// filters muddying "priority" — dragging within a lane that mixes filtered-out neighbors
// (or spans products) wouldn't reorder what the user actually thinks they're reordering.
// `activeFilterCount` minus `product` catches every other FilterState field (stage, impact,
// effort, assets, visibility, hygiene, tags, q) staying empty, so this stays correct if the
// filter shape changes.
const canReorder = computed(
  () =>
    canEdit.value &&
    editMode.value &&
    sort.value === 'manual' &&
    !!filters.product &&
    activeFilterCount({ ...filters, product: null }) === 0,
);

type Lane = { key: string; items: ItemVM[] };

// Every projected item, unfiltered by the current view (horizon focus / filters) — the
// dragged card's CURRENT horizon/product (post any earlier edits) has to be looked up
// independent of whatever's actually rendered, since the lane the drag started from may
// not even be the lane the drop lands in.
const projectedById = computed(() => new Map(itemsForBoard.value.map((i) => [i.id, i])));

const draggingId = ref<string | null>(null);
// The lane currently under the pointer while a card is being dragged — drives the quiet
// drop-target ring on the lane container (see `.roadmap-lane-drop-target` below). Set from
// Sortable's `onMove` (fires continuously as the drag passes over a list) and cleared once
// the drag ends (`onLaneSortEnd`, below).
const dragOverLaneKey = ref<string | null>(null);

// A lane may span multiple products (grouped by horizon) or multiple horizons (grouped
// by product); split the new order into per-(product,horizon) runs and persist each —
// that's the granularity the backend's `order` field actually understands.
function reorderWithinLane(lane: Lane, itemId: string, newIndex: number) {
  const ids = lane.items.map((i) => i.id);
  const fromIdx = ids.indexOf(itemId);
  if (fromIdx === -1) return;
  const clampedIndex = Math.max(0, Math.min(newIndex, ids.length - 1));
  if (clampedIndex === fromIdx) return; // dropped back where it started — nothing to persist
  ids.splice(clampedIndex, 0, ids.splice(fromIdx, 1)[0]!);
  const laneById = new Map(lane.items.map((i) => [i.id, i]));
  const groups = new Map<string, string[]>();
  for (const id of ids) {
    const it = laneById.get(id);
    if (!it) continue;
    const key = `${it.product}::${it.horizon}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(id);
  }
  for (const [key, groupIds] of groups) {
    const [product, horizon] = key.split('::') as [string, string];
    editStore.reorder(product, horizon, groupIds);
  }
}

// The single move-translation, deliberately decoupled from any Sortable/DOM event object so
// it can be exercised directly with synthetic args (Sortable itself is a real browser drag —
// not worth simulating in a test; this is). `fromKey`/`toKey` are the lane keys the drag
// started/ended in; `newIndex` is the dragged card's final position among the target lane's
// cards (Sortable's `newDraggableIndex` — i.e. excluding the "+ Add item" control from the
// count; see `createLaneSortable`'s `draggable: '.roadmap-card-item'`).
function onLaneSortEnd(fromKey: string, toKey: string, itemId: string, newIndex: number) {
  draggingId.value = null;
  dragOverLaneKey.value = null;

  const dragged = projectedById.value.get(itemId) as (ItemVM & { pending?: string }) | undefined;
  if (!dragged || dragged.pending === 'deleted') return; // never move a to-be-deleted card

  if (fromKey !== toKey) {
    // Cross-lane, grouped by horizon: reassign the card's horizon — this is a live
    // projection move, not a priority reorder, so it works regardless of canReorder.
    // Grouped by product, a cross-lane (cross-product) drop would relocate the file
    // server-side — out of scope here. The shared Sortable `group`'s put/pull are already
    // off in that case (see `laneSortOptions`), so reaching this branch at all would mean a
    // stale/mid-transition instance; the group === 'horizon' check below is the real guard.
    if (filters.group === 'horizon') editStore.setField(itemId, 'horizon', toKey);
    return;
  }

  // Same lane: the existing within-lane reorder, gated on the same canReorder guard as
  // before (Sortable's own `sort` option already disables this per-lane when canReorder is
  // false — see `laneSortOptions` — this is the defensive backstop).
  if (!canReorder.value) return;
  const lane = lanes.value.find((l) => l.key === toKey);
  if (!lane) return;
  reorderWithinLane(lane, itemId, newIndex);
}

// --- SortableJS wiring -----------------------------------------------------------------
//
// The store (via `lanes`, derived from `projectBoard`) stays the one source of truth for
// what's on screen — Sortable is only ever a visual/gesture layer on top of it, never a
// second copy of the data. That means every drag has to end with the DOM back exactly where
// Vue last put it, so Vue's own reactive re-render (triggered by the store op above) is the
// only thing that ever actually reorders/relocates a card in the DOM.
//
// Sortable, left to itself, physically moves the dragged element as you drag it — across
// lanes too, since every lane shares one Sortable `group`. If we didn't undo that, Vue's
// next patch would be reconciling against a DOM it didn't actually produce, and a cross-lane
// move in particular would risk a duplicated or orphaned card (the moved node physically
// sitting in lane B while Vue still thinks of it as lane A's, mounting a fresh one in B and
// unmounting — from B, thanks to Sortable — what it thinks is A's). So `onEnd` below reverts
// the physical DOM move FIRST (put the exact node back where it started, using a sibling
// reference captured at drag start — robust regardless of which direction it moved, and
// unaffected by other non-card siblings like the "+ Add item" button), and only THEN applies
// the store op, leaving Vue's reactivity to do the entire on-screen move by itself from a
// known-consistent baseline.
const laneListEls = new Map<string, HTMLElement>();
const laneSortables = new Map<string, Sortable>();
const laneKeyByEl = new Map<HTMLElement, string>();
let dragOriginParent: HTMLElement | null = null;
let dragOriginNextSibling: ChildNode | null = null;

function laneSortOptions() {
  const disabled = !(canEdit.value && editMode.value);
  const crossLaneAllowed = !disabled && filters.group === 'horizon';
  return {
    disabled,
    sort: !disabled && canReorder.value,
    group: { name: 'roadmap-lane', pull: crossLaneAllowed, put: crossLaneAllowed },
  };
}

function createLaneSortable(el: HTMLElement): Sortable {
  return Sortable.create(el, {
    animation: 180,
    handle: '.roadmap-drag-handle',
    draggable: '.roadmap-card-item',
    ghostClass: 'roadmap-sortable-ghost',
    chosenClass: 'roadmap-sortable-chosen',
    dragClass: 'roadmap-sortable-drag',
    ...laneSortOptions(),
    onStart(evt) {
      dragOriginParent = evt.from;
      dragOriginNextSibling = evt.item.nextSibling;
      draggingId.value = evt.item.dataset.itemId ?? null;
    },
    onMove(evt) {
      dragOverLaneKey.value = laneKeyByEl.get(evt.to) ?? null;
      return true;
    },
    onEnd(evt) {
      const itemEl = evt.item;
      // Revert Sortable's DOM move before anything else — see the block comment above.
      if (dragOriginParent) {
        if (itemEl.parentNode) itemEl.parentNode.removeChild(itemEl);
        dragOriginParent.insertBefore(itemEl, dragOriginNextSibling);
      }
      dragOriginParent = null;
      dragOriginNextSibling = null;

      const id = itemEl.dataset.itemId;
      const fromKey = laneKeyByEl.get(evt.from);
      const toKey = laneKeyByEl.get(evt.to);
      draggingId.value = null;
      dragOverLaneKey.value = null;
      if (!id || !fromKey || !toKey) return;
      onLaneSortEnd(fromKey, toKey, id, evt.newDraggableIndex ?? evt.newIndex ?? 0);
    },
  });
}

// A Vue inline function-ref. IMPORTANT: Vue 3 re-invokes it on EVERY re-render with the same
// element (not only on mount/unmount) — so during a drag, when dragOverLaneKey changes and the
// board re-renders, this fires mid-gesture. Without the same-element guard below it would
// destroy+recreate the actively-dragging Sortable, aborting the drag and snapping the card back.
// Only a genuine mount (null→el), unmount (el→null), or element replacement should act.
function registerLaneListEl(key: string, el: Element | null) {
  const prevEl = laneListEls.get(key) ?? null;
  const nextEl = (el as HTMLElement | null) ?? null;
  if (prevEl === nextEl) return; // same element re-registered on a routine re-render — leave Sortable intact
  if (prevEl) {
    laneSortables.get(key)?.destroy();
    laneSortables.delete(key);
    laneKeyByEl.delete(prevEl);
    laneListEls.delete(key);
  }
  if (nextEl) {
    laneListEls.set(key, nextEl);
    laneKeyByEl.set(nextEl, key);
    laneSortables.set(key, createLaneSortable(nextEl));
  }
}

// Keep every live Sortable instance's options in sync with edit/filter state — cheaper and
// simpler than tearing lanes down and recreating them on every toggle.
watch([editMode, canReorder, () => filters.group, canEdit], () => {
  const opts = laneSortOptions();
  for (const s of laneSortables.values()) {
    s.option('disabled', opts.disabled);
    s.option('sort', opts.sort);
    s.option('group', opts.group);
  }
});

onUnmounted(() => {
  for (const s of laneSortables.values()) s.destroy();
  laneSortables.clear();
  laneListEls.clear();
  laneKeyByEl.clear();
});

/** The single product a lane's "+ Add" button should create into — unambiguous when the
 * board is grouped by product (the lane key), or when a product filter narrows a
 * horizon-grouped lane to one product. Null (button hidden) for a mixed-product lane. */
function laneProduct(lane: { key: string }): string | null {
  return filters.group === 'product' ? lane.key : filters.product;
}
/** The horizon a lane's new item should be created into: when grouping by horizon the
 * lane key IS the horizon; when grouping by product, use the single active horizon chip
 * if exactly one is selected (all items in the lane share it in that case). Null when
 * ambiguous (zero or multiple horizons active). */
function laneHorizon(lane: { key: string }): string | null {
  if (filters.group === 'horizon') return lane.key;
  return horizons.value.length === 1 ? horizons.value[0]! : null;
}
// +Add creates an (initially untitled) item straight into the changeset, then opens it
// in the full-screen editor — the title itself is set there (see store.ts's changeset(),
// which lets a title edited via setField override the one addItem was called with).
// Global "+ New item" — always available in edit mode regardless of grouping/filters.
// Product/horizon default to the current view (a filtered product, a focused horizon) and
// are fully editable in the full-screen editor that opens.
function addNewItem() {
  const product = filters.product ?? PRODUCTS[0];
  const horizon = horizons.value.length === 1 ? horizons.value[0]! : 'Next';
  const id = editStore.addItem(product, '', { horizon });
  openEditor(id);
}

// U4: "New with AI" — the drafted item (title + suggested frontmatter + full section body)
// seeds a working-copy created item exactly like addNewItem()/addToLane(), then opens the
// same full-screen editor so the draft is reviewed/edited before Sync ever publishes it
// (R5). Nothing here talks to the AI directly — NewWithAiDialog.vue owns the draftItem()
// call and only ever emits the finished draft up.
function onDrafted(draft: DraftedItem & { product: string }) {
  newWithAiOpen.value = false;
  const fm: Record<string, string> = {};
  if (draft.frontmatter.stage) fm.stage = draft.frontmatter.stage;
  // horizon is required + has no default — parseDraft already lands a valid one, but keep the
  // same 'Next' fallback the manual-add path uses so a created item can never lack a horizon.
  fm.horizon = draft.frontmatter.horizon ?? 'Next';
  if (draft.frontmatter.tags) fm.tags = draft.frontmatter.tags;
  const id = editStore.addItem(draft.product, draft.title, fm);
  editStore.setBody(id, draft.body);
  openEditor(id);
}
function addToLane(lane: { key: string }) {
  // Fall back to a sensible product so the per-lane add works even in a mixed-product
  // (horizon-grouped) lane — the editor lets the user pick the real product.
  const product = laneProduct(lane) ?? filters.product ?? PRODUCTS[0];
  const horizon = laneHorizon(lane);
  // Always seed a horizon — even when the lane is ambiguous (grouped by product with no
  // horizon tab focused) — so an abandoned-then-edited item still has one if the user
  // never touches the field; the projection defaults to 'Next' too, so this matches what
  // they'd see on screen.
  const id = editStore.addItem(product, '', { horizon: horizon ?? 'Next' });
  openEditor(id);
}

// Fix #2: RoadmapCard's inline double-click rename emits { id, title } (already trimmed,
// never empty — the card itself swallows an empty commit) straight into the changeset.
// Works uniformly for a real item's id or a not-yet-synced `new-<n>` temp id.
function onCardRename({ id, title }: { id: string; title: string }) {
  if (!title) return;
  editStore.setField(id, 'title', title);
}

// Fix #3: clone a card into a new draft — copies the source's current (working-copy)
// metadata and raw body, then opens the full editor on the new item so the user can tweak
// it (title/etc.) before it's ever synced. Reads from `projectedById` first so a duplicate
// captures any not-yet-synced edits on the source rather than the stale published values;
// falls back to the published `byId` for the rare case the source isn't in the projection.
function omitEmptyFrontmatter(fm: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(fm).filter(([, v]) => v !== ''));
}
function onCardDuplicate(id: string) {
  const src = projectedById.value.get(id) ?? byId.value.get(id);
  if (!src) return;
  const body = rawBodies.value.get(id) ?? '';
  const newId = editStore.addItem(
    src.product,
    `${src.title} (copy)`,
    omitEmptyFrontmatter({
      horizon: src.horizon,
      stage: src.stage,
      owner: src.owner ?? '',
      impact: src.impact ?? '',
      effort: src.effort ?? '',
      visibility: src.visibility,
      tags: (src.tags ?? []).join(', '),
    }),
  );
  editStore.setBody(newId, body);
  openEditor(newId);
}

const byId = computed(() => new Map(liveItems.value.map((i) => [i.id, i])));

// Fix #8: a concise, name-resolved summary of exactly what Sync is about to publish —
// SyncBar's Review affordance renders this so the user can see what they're committing
// before clicking Sync, instead of taking the changeset (all ids/temp-ids) on faith.
// Names resolve through `byId` (the published board) since the changeset itself only
// ever carries ids.
type ChangeSummary = {
  edited: { id: string; title: string }[];
  created: { title: string; product: string }[];
  deleted: { id: string; title: string }[];
  reorderLanes: number;
};
const changeSummary = computed<ChangeSummary>(() => {
  const cs = editStore.changeset();
  return {
    edited: cs.updated.map((u) => ({ id: u.id, title: byId.value.get(u.id)?.title ?? u.id })),
    created: cs.created.map((c) => ({ title: c.title, product: c.product })),
    deleted: cs.deletedIds.map((id) => ({ id, title: byId.value.get(id)?.title ?? id })),
    reorderLanes: Object.values(cs.reorder).reduce((n, lanes) => n + Object.keys(lanes).length, 0),
  };
});

// Real tag suggestions for the editor's TagInput reuse-autocomplete, drawn from every
// item currently on the (unfiltered) board — not just the working set — so a tag used
// on one product still autocompletes while editing another.
const allTags = computed(() => Array.from(new Set(liveItems.value.flatMap((i) => i.tags ?? []))).sort());
// Same idea for the editor's OwnerInput reuse-autocomplete: every distinct owner already
// in use across the whole board, minus the 'Unassigned' placeholder (see matchesHygiene's
// no-owner check in filters.ts) — that's a default, not a real owner worth suggesting.
const allOwners = computed(() =>
  Array.from(new Set(liveItems.value.map((i) => i.owner).filter((o): o is string => !!o && o.trim() !== '' && o !== 'Unassigned'))).sort(),
);

const sortOptions = [
  { value: 'manual', label: 'Sort: Priority' },
  { value: 'impact', label: 'Sort: Impact (High to Low)' },
  { value: 'effort', label: 'Sort: Effort (Low to High)' },
  { value: 'updated', label: 'Sort: Recently updated' },
  { value: 'title', label: 'Sort: Title (A to Z)' },
];
const visibilityOptions = [{ value: '', label: 'All visibility' }, ...VISIBILITIES.map((v) => ({ value: v, label: v }))];
const groupOptions = [
  { value: 'horizon', label: 'Group: Horizon' },
  { value: 'product', label: 'Group: Product' },
];
const visibilityModel = computed({
  get: () => filters.visibility ?? '',
  set: (v: string) => (filters.visibility = v || null),
});
// Clickable stat tiles double as the multi-select horizon chips. In presentation mode
// they describe what the viewer actually sees, so they count the filtered set.
const stats = computed(() => {
  // Scope the horizon tallies to the current product (the page), but not to the
  // transient stage/tag/search filters — so the pills summarise the product view.
  const pool = present.value
    ? shown.value
    : liveItems.value.filter((i) => !filters.product || i.product === filters.product);
  return HORIZONS.map((h) => ({
    key: h as string,
    label: h as string,
    value: pool.filter((i) => i.horizon === h).length,
    dot: horizonDot[h],
    tone: horizonTone[h],
    sub: horizonStatLabel[h],
    active: horizons.value.includes(h),
  }));
});

// Lane containers stay mostly neutral; state color is carried by the lane accent.
const laneWash = (key: string): string =>
  key === 'Now' || key === 'Next'
    ? 'linear-gradient(180deg, var(--roadmap-lane-neutral-start), var(--color-surface-primary-default))'
    : 'linear-gradient(180deg, var(--color-surface-primary-default), var(--color-surface-subtle-default))';

const searchContext = computed(() => createSearchContext(itemsForBoard.value, filters.q));
const shown = computed(() => sortItems(filterItems(itemsForBoard.value, filters, searchContext.value), sort.value));

const availableAssets = computed(() => assetOptionsForFilters(itemsForBoard.value, filters, searchContext.value));
const availableStages = computed(() =>
  stageOptionsForItems(filterItems(itemsForBoard.value, { ...filters, stage: [] }, searchContext.value), filters.stage),
);
const availableImpact = computed(() =>
  levelOptionsForItems(filterItems(itemsForBoard.value, { ...filters, impact: [] }, searchContext.value), 'impact', filters.impact),
);
const availableEffort = computed(() =>
  levelOptionsForItems(filterItems(itemsForBoard.value, { ...filters, effort: [] }, searchContext.value), 'effort', filters.effort),
);
const availableTags = computed(() => tagOptionsForFilters(itemsForBoard.value, filters, searchContext.value));
const focused = computed(() => shown.value.filter((i) => horizons.value.includes(i.horizon)));
const hiddenLaneMatches = computed(() => {
  if (!filters.q.trim()) return [];
  return HORIZONS.filter((h) => !horizons.value.includes(h))
    .map((h) => ({
      key: h as string,
      count: shown.value.filter((i) => i.horizon === h).length,
    }))
    .filter((match) => match.count > 0);
});
const lanes = computed(() => {
  if (filters.group === 'product') {
    const g = groupItems(focused.value, PRODUCTS, (i) => i.product);
    return PRODUCTS.filter((p) => g[p]!.length).map((p) => ({
      key: p as string,
      dot: productColor[p],
      desc: '',
      items: g[p]!,
    }));
  }
  const g = groupItems(focused.value, HORIZONS, (i) => i.horizon);
  // Every ACTIVE horizon gets a lane, in canonical order — even one with zero items in
  // it right now, so a selected-but-empty horizon still shows its lane (and the
  // "nothing here yet" empty state within it) rather than disappearing entirely.
  return HORIZONS.filter((h) => horizons.value.includes(h)).map((h) => ({
    key: h as string,
    dot: horizonDot[h],
    desc: horizonDescription[h],
    items: g[h]!,
  }));
});

function removeFilterChip(chip: ActiveFilterChip) {
  switch (chip.kind) {
    case 'q':
      filters.q = '';
      break;
    case 'product':
      filters.product = null;
      break;
    case 'stage':
      filters.stage = filters.stage.filter((value) => value !== chip.value);
      break;
    case 'impact':
      filters.impact = filters.impact.filter((value) => value !== chip.value);
      break;
    case 'effort':
      filters.effort = filters.effort.filter((value) => value !== chip.value);
      break;
    case 'asset':
      filters.assets = filters.assets.filter((value) => value !== chip.value);
      break;
    case 'visibility':
      filters.visibility = null;
      break;
    case 'hygiene':
      filters.hygiene = null;
      break;
    case 'tag':
      filters.tags = filters.tags.filter((value) => value !== chip.value);
      break;
  }
}

const laneSectionEls = new Map<string, HTMLElement>();
const activeLaneKey = ref<string | null>(null);
let laneObserver: IntersectionObserver | null = null;

function laneDomId(key: string): string {
  return `lane-${key
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')}`;
}

function registerLaneSectionEl(key: string, el: Element | null) {
  const previous = laneSectionEls.get(key);
  if (previous && previous !== el) {
    laneObserver?.unobserve(previous);
    laneSectionEls.delete(key);
  }
  if (!(el instanceof HTMLElement)) return;
  laneSectionEls.set(key, el);
  laneObserver?.observe(el);
}

function setupLaneObserver() {
  laneObserver?.disconnect();
  laneObserver = null;
  if (typeof window === 'undefined' || !('IntersectionObserver' in window)) {
    activeLaneKey.value = lanes.value[0]?.key ?? null;
    return;
  }
  laneObserver = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio || a.boundingClientRect.top - b.boundingClientRect.top);
      const key = visible[0]?.target.getAttribute('data-lane-key');
      if (key) activeLaneKey.value = key;
    },
    { root: null, rootMargin: '-96px 0px -55% 0px', threshold: [0.2, 0.45, 0.7] },
  );
  for (const el of laneSectionEls.values()) laneObserver.observe(el);
  activeLaneKey.value = lanes.value[0]?.key ?? null;
}

function jumpToLane(key: string) {
  const el = laneSectionEls.get(key);
  if (!el || typeof window === 'undefined') return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ block: 'start', inline: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  activeLaneKey.value = key;
}

watch(lanes, async () => {
  const keys = new Set(lanes.value.map((lane) => lane.key));
  for (const key of [...laneSectionEls.keys()]) {
    if (!keys.has(key)) laneSectionEls.delete(key);
  }
  if (!keys.has(activeLaneKey.value ?? '')) activeLaneKey.value = lanes.value[0]?.key ?? null;
  await nextTick();
  setupLaneObserver();
});

function select(item: ItemVM) {
  if (canEdit.value && editMode.value) {
    openEditor(item.id);
    return;
  }
  selected.value = item;
}
function closeDrawer() {
  selected.value = null;
}

// Drawer prev/next walks the visual order (lane by lane, top to bottom) of
// whatever is currently filtered — the URL follows via the ?item= sync below.
const navList = computed(() => lanes.value.flatMap((l) => l.items));
const navIndex = computed(() =>
  selected.value ? navList.value.findIndex((i) => i.id === selected.value!.id) : -1,
);
const navPos = computed(() =>
  navIndex.value >= 0 ? { index: navIndex.value, total: navList.value.length } : null,
);
function navBy(delta: number) {
  const list = navList.value;
  if (!list.length) return;
  const next = navIndex.value === -1 ? 0 : navIndex.value + delta;
  if (next < 0 || next >= list.length) return;
  selected.value = list[next]!;
}

// Keep the open item's card in view while browsing with arrows/swipe.
watch(selected, async (v) => {
  if (!v || typeof document === 'undefined') return;
  await nextTick();
  document
    .querySelector(`[data-item-id="${v.id}"]`)
    ?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
});

// "/" jumps to search from anywhere on the board; Fix #9 adds a small set of global
// shortcuts (edit mode, new item, Sync, and a "?" cheat-sheet) to the same listener.
const searchWrap = ref<HTMLElement>();
// Shared guard: none of these shortcuts should ever fire while the user is actually
// typing — plain text entry (a title, a search query, a body edit) must never be
// hijacked by a single letter like "e" or "n".
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return true;
  return el.isContentEditable === true;
}
function onGlobalKey(e: KeyboardEvent) {
  if (isTypingTarget(e.target)) return;
  // The full-screen item editor and the share dialog own their own keyboard handling
  // (Esc close, etc. — see ItemEditor/ShareDialog) — board-level shortcuts stay out of
  // their way while either is open.
  const overlayOpen = !!editingItem.value || shareOpen.value || exitPromptOpen.value;

  // "?" toggles the cheat-sheet; while it's open, Escape closes it (closing the editor
  // on Escape is already handled in ItemEditor — not duplicated here).
  if (shortcutsOpen.value && e.key === 'Escape') {
    e.preventDefault();
    shortcutsOpen.value = false;
    return;
  }
  if (e.key === '?' && !overlayOpen) {
    e.preventDefault();
    shortcutsOpen.value = !shortcutsOpen.value;
    return;
  }
  // While the cheat-sheet is up, the action shortcuts (e / n / Cmd+Enter / "/") are
  // suppressed — only "?" (toggle) and Escape (close), both handled above, work.
  if (shortcutsOpen.value) return;

  if (!overlayOpen && !e.metaKey && !e.ctrlKey && !e.altKey) {
    if (e.key === 'e' && canEdit.value) {
      e.preventDefault();
      toggleEditMode();
      return;
    }
    if (e.key === 'n' && canEdit.value && editMode.value) {
      e.preventDefault();
      addNewItem();
      return;
    }
  }
  if (!overlayOpen && (e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    if (canEdit.value && editMode.value && unsynced.value && !syncPending.value) {
      e.preventDefault();
      doSync();
    }
    return;
  }

  if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
  if (selected.value || sheetOpen.value) return;
  e.preventDefault();
  searchWrap.value?.querySelector('input')?.focus();
}
// Below lg the filters live in a slide-over sheet; on desktop they toggle inline.
function toggleFilters() {
  if (typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches) {
    sidebarOpen.value = !sidebarOpen.value;
  } else {
    sheetOpen.value = true;
  }
}
function onSheetKey(e: KeyboardEvent) {
  if (e.key === 'Escape') sheetOpen.value = false;
}
const sheetPanel = ref<HTMLElement>();
let releaseSheetFocus: (() => void) | null = null;
watch(sheetOpen, async (open) => {
  if (typeof document === 'undefined') return;
  if (open) {
    document.addEventListener('keydown', onSheetKey);
    document.body.style.overflow = 'hidden';
    await nextTick();
    if (sheetPanel.value) releaseSheetFocus = trapFocus(sheetPanel.value);
  } else {
    document.removeEventListener('keydown', onSheetKey);
    document.body.style.overflow = '';
    releaseSheetFocus?.();
    releaseSheetFocus = null;
  }
});
// U11: same focus-trap/Escape wiring as the mobile filter sheet just above — Escape (or a
// backdrop click, see the template) just closes the modal (still editing, nothing decided),
// it doesn't stand in for any of the three explicit choices.
function onExitPromptKey(e: KeyboardEvent) {
  if (e.key === 'Escape') closeExitPrompt();
}
const exitPromptPanel = ref<HTMLElement>();
let releaseExitPromptFocus: (() => void) | null = null;
watch(exitPromptOpen, async (open) => {
  if (typeof document === 'undefined') return;
  if (open) {
    document.addEventListener('keydown', onExitPromptKey);
    await nextTick();
    if (exitPromptPanel.value) releaseExitPromptFocus = trapFocus(exitPromptPanel.value);
  } else {
    document.removeEventListener('keydown', onExitPromptKey);
    releaseExitPromptFocus?.();
    releaseExitPromptFocus = null;
  }
});
function clear() {
  Object.assign(filters, emptyFilters());
  horizons.value = [...DEFAULT_HORIZONS];
}
function setPresent(on: boolean) {
  present.value = on;
  if (typeof document === 'undefined') return;
  if (on) document.documentElement.dataset.present = '1';
  else delete document.documentElement.dataset.present;
}
const shareCopied = ref(false);
let shareTimer: ReturnType<typeof setTimeout> | undefined;
// Opens the client-facing view in its own window (and puts the link on the clipboard).
function shareView() {
  const p = new URLSearchParams(location.search);
  p.set('present', '1');
  p.delete('item');
  const url = `${location.origin}${location.pathname}?${p.toString()}`;
  navigator.clipboard?.writeText(url);
  window.open(url, '_blank', 'noopener');
  shareCopied.value = true;
  clearTimeout(shareTimer);
  shareTimer = setTimeout(() => (shareCopied.value = false), 1500);
}

// Projected snapshot of exactly what is on screen now — post-filter, post-sort, and
// post horizon-focus (the Now/Next/Later tabs), so the share mirrors the board view.
const shareItems = computed(() => focused.value.map(projectForShare));
const shareContext = computed<ShareContext>(() => ({
  title: filters.product ? `${filters.product} roadmap` : 'Product roadmap',
  product: filters.product,
  generatedAt: formatDateTime(Date.now()),
}));
const sortedAuthoredShares = computed(() => [...authoredShares.value].sort((a, b) => b.updatedAt - a.updatedAt));

async function loadAuthoredShares() {
  const cd = getCanvasdrop();
  if (!cd) return;
  sharesLoading.value = true;
  sharesError.value = null;
  try {
    shareAuthor.value ??= await cd.me();
    authoredShares.value = await cd.canvases.list({
      sourceApp: SHARE_SOURCE_APP,
      sourceKind: SHARE_SOURCE_KIND,
      tags: [SHARE_TAG],
    });
  } catch (err) {
    sharesError.value = (err as { hint?: string; message?: string }).hint
      ?? (err as Error).message ?? 'Could not load shares.';
  } finally {
    sharesLoading.value = false;
  }
}

function openShare() {
  shareError.value = null;
  shareResult.value = null;
  shareOpen.value = true;
  void loadAuthoredShares();
}

// Fetches the roadmap's own OG card (same-origin, so it works even though the
// roadmap is team-auth-gated) so it can be bundled into the share's own zip —
// see buildShareBundle's doc comment for why the share can't just link back.
async function fetchOgImageBytes(): Promise<Uint8Array | undefined> {
  try {
    const root = props.base ?? '/';
    const res = await fetch(`${root}brand/og-card.png`);
    if (!res.ok) return undefined;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return undefined;
  }
}

async function onShareSubmit(p: {
  targetShareId: string | null; canvasTitle: string; canvasDescription: string; roadmapTitle: string; roadmapIntro: string;
  access: AccessRung;
  password: string; expiresAt: number; tags: string[]; theme: ShareTheme; items: ReturnType<typeof projectForShare>[];
}) {
  const cd = getCanvasdrop();
  if (!cd) { shareError.value = 'Sharing is unavailable on this canvas.'; return; }
  sharePending.value = true;
  shareError.value = null;
  try {
    const html = renderShareHtml({
      ...shareContext.value,
      title: p.roadmapTitle,
      intro: p.roadmapIntro,
      theme: p.theme,
      assetBase: window.location.origin,
    }, p.items);
    const bundle = buildShareBundle(html, await fetchOgImageBytes());
    const metadata = {
      sourceApp: SHARE_SOURCE_APP,
      sourceKind: SHARE_SOURCE_KIND,
      theme: p.theme,
      canvasDescription: p.canvasDescription,
      roadmapTitle: p.roadmapTitle,
      roadmapIntro: p.roadmapIntro,
      itemCount: p.items.length,
      laneCount: new Set(p.items.map((item) => item.horizon)).size,
      product: shareContext.value.product,
      generatedAt: Date.now(),
    };
    const baseOptions = {
      title: p.canvasTitle,
      access: p.access,
      password: p.access === 'password' ? p.password : undefined,
      expiresAt: p.expiresAt,
      tags: p.tags,
      metadata,
      bundle,
    };
    const res = p.targetShareId
      ? await updateAuthoredCanvas(cd, p.targetShareId, {
        ...baseOptions,
        password: p.access === 'password' ? p.password : null,
      })
      : await cd.canvases.publish(baseOptions);
    shareResult.value = {
      id: res.id,
      url: res.url,
      expiresAt: res.expiresAt,
      status: res.status,
      action: p.targetShareId ? 'updated' : 'created',
    };
    await loadAuthoredShares();
  } catch (err) {
    shareError.value = (err as { hint?: string; message?: string }).hint
      ?? (err as Error).message ?? 'Publish failed.';
  } finally {
    sharePending.value = false;
  }
}

async function onShareRevoke(id: string) {
  const cd = getCanvasdrop();
  if (!cd) { shareError.value = 'Sharing is unavailable on this canvas.'; return; }
  sharePending.value = true;
  shareError.value = null;
  try {
    await cd.canvases.revoke(id);
    await loadAuthoredShares();
  } catch (err) {
    shareError.value = (err as { hint?: string; message?: string }).hint
      ?? (err as Error).message ?? 'Could not revoke share.';
  } finally {
    sharePending.value = false;
  }
}

// Presentation copy adapts to what's actually being shown.
const presentHeadPrefix = computed(() => (filters.product ? `The ${filters.product}` : 'Our product'));
const presentSub = computed(() =>
  filters.product
    ? `What's Now, Next and Later for ${filters.product}. Committed to what's in Now, flexible on what's further out.`
    : `What's Now, Next and Later across ${productListSentence()}. Committed to what's in Now, flexible on what's further out.`,
);
const heroLead = computed(() =>
  filters.product
    ? `What's Now, Next and Later for ${filters.product}.`
    : 'One view of what every product team is building, what comes after it, and what we have deliberately not scoped yet.',
);
function toggleFull() {
  if (typeof document === 'undefined') return;
  if (!document.fullscreenElement) root.value?.requestFullscreen?.();
  else document.exitFullscreen?.();
}
function onFsChange() {
  isFull.value = typeof document !== 'undefined' && !!document.fullscreenElement;
}

// URL state
onMounted(async () => {
  // Capture the GitHub sign-in token from the callback hash FIRST — before the
  // saved-state restore and syncState() below rewrite the URL via replaceState,
  // which would strip the #roadmap_edit_token fragment before we ever read it.
  readTokenFromHash();
  try {
    if (localStorage.getItem('rm-sidebar') === '0') sidebarOpen.value = false;
  } catch {
    /* ignore */
  }
  // Arriving via a plain link (no params) restores the last board state for this
  // tab — filters, sort, presentation — so navigating away and back doesn't lose
  // your place. A URL that carries params always wins (shared links).
  let search = location.search;
  if (!search) {
    try {
      const saved = sessionStorage.getItem('rm-board-state');
      if (saved) {
        search = saved;
        history.replaceState(null, '', `${location.pathname}${saved}`);
      }
    } catch {
      /* ignore */
    }
  }
  const p = new URLSearchParams(search);
  filters.q = p.get('q') ?? '';
  // Product lives in the URL path (/music-app/), seeded server-side; ?product= is a
  // legacy fallback so old links still resolve (the watch rewrites them to a path).
  filters.product = props.initialProduct ?? p.get('product');
  filters.stage = p.getAll('stage');
  filters.impact = p.getAll('impact');
  filters.effort = p.getAll('effort');
  filters.assets = p.getAll('asset');
  filters.visibility = p.get('visibility');
  filters.tags = p.getAll('tag');
  if (p.get('group') === 'product') filters.group = 'product';
  const hy = p.get('hygiene');
  if (hy === 'no-owner' || hy === 'now-early' || hy === 'stale-later') filters.hygiene = hy;
  const hs = p.getAll('horizon').filter((v): v is (typeof HORIZONS)[number] => (HORIZONS as readonly string[]).includes(v));
  if (hs.length) horizons.value = hs;
  const s = p.get('sort');
  if (s) sort.value = s as SortKey;
  if (p.get('present') === '1') setPresent(true);
  // Defer resolving ?item= until after auth/edit-mode is known (below), so a deep-linked item
  // never flashes the read-only drawer before we route it to the full editor in edit mode.
  const restoreItem = p.get('item');
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('keydown', onGlobalKey);
  // U9 (R10): registered unconditionally (not gated on canEdit, which isn't known yet at this
  // point in onMounted) — the handler itself is a no-op for anyone without unsynced work or an
  // in-flight sync, which a non-editor can never have.
  window.addEventListener('beforeunload', onBeforeUnload);
  // Normalize the URL and seed the saved state for this view.
  syncState();
  // Let the resolved view paint, then reveal it (cascade defined in the scoped styles).
  await nextTick();
  ready.value = true;
  setupLaneObserver();
  const cd = getCanvasdrop();
  if (cd) {
    try {
      shareAuthor.value = await cd.me();
      canShare.value = true;
    } catch {
      shareAuthor.value = null;
      canShare.value = false;
    }
  }
  // Gated editing: consume the OAuth callback hash (if we just landed here from
  // GitHub sign-in), then resolve editor status against the edit-service.
  readTokenFromHash();
  const meRes = await me();
  canEdit.value = meRes.editor;
  // Reconcile the draft against the freshly-loaded (published) base BEFORE the auto-resume
  // check below reads dirtyCount — drops any ops that already landed (a published create,
  // an edit whose value now matches, a delete that's gone), so a stale "new"/"edited" card
  // never reappears after a reload, whether that's a plain browser refresh or the in-app
  // Reload button (see reloadToLatest).
  editStore.reconcile(liveItems.value);
  // R5 (KTD4): a committed-but-not-yet-live sha survives a reload during the build window —
  // resume "awaiting build"/"building"/etc. rather than showing a phantom "unsynced" or
  // "clean". `committedSnapshot` seeds `syncedJson` too, so `unsynced` (which compares the
  // current changeset against it) can correctly read "nothing edited since that sync" even
  // though this is a fresh mount with no in-memory history of its own.
  if (canEdit.value) {
    const pendingSha = editStore.committedSha.value;
    const committedAt = editStore.committedAt.value;
    // Only resume the build banner for a commit still plausibly in its deploy window. A sha
    // left over from a PAST session — whose ~1-min build has long since gone live, but which
    // the poll never got to clear before that tab closed — must NOT resurrect a permanent
    // "Publishing…" here (the exact "shows publishing even though everything is live" bug).
    // Past the window the deploy is certainly done: drop it and show the normal clean state.
    const fresh = committedAt != null && Date.now() - committedAt < DEPLOY_RESUME_MAX_AGE_MS;
    if (pendingSha && editStore.dirtyCount.value === 0) {
      // The freshly loaded static base already reflects the synced draft (reconcile above
      // dropped every pending op). Nothing remains to wait on, so do not resurrect a
      // "Publishing..." banner from localStorage after a successful reload.
      editStore.clearCommit();
    } else if (pendingSha && fresh) {
      publishing.value = { sha: pendingSha };
      syncedJson.value = editStore.committedSnapshot.value;
      startDeployPoll(pendingSha);
    } else if (pendingSha) {
      editStore.clearCommit();
    }
  }
  // U10 (R11): the plain mount-time reconcile just above has no raw body to compare a pending
  // body edit against (see store.ts's reconcile doc comment), so a body edit the published
  // site already reflects would otherwise still count toward dirtyCount here — which would
  // force the auto-resume check right below into edit mode even on a plain view-mode reload,
  // showing a phantom "unpublished" state until whatever LATER happened to fetch raw bodies
  // (previously, edit mode itself) caught up. Fetch + re-reconcile with bodies now, BEFORE
  // that check, whenever the draft actually carries a pending edit on a real item's body — the
  // one case the plain reconcile can't resolve on its own. Degrades silently (loadRawBodies's
  // own catch): a fetch failure just leaves the edit pending, exactly like today.
  if (canEdit.value && editStore.hasBodyEdits.value) {
    await loadRawBodies();
  }
  if (canEdit.value && (localStorage.getItem('rm-edit-mode') === '1' || editStore.dirtyCount.value > 0)) {
    editMode.value = true;
  }
  // Now that edit mode is decided, resolve a deep-linked ?item=: straight to the full editor
  // when editing, else the read-only drawer.
  if (restoreItem && byId.value.has(restoreItem)) {
    if (canEdit.value && editMode.value) openEditor(restoreItem);
    else selected.value = byId.value.get(restoreItem)!;
  }
  editorLogin.value = meRes.login;
  // U9: only real editors (who might have a draft worth preserving) need to know a
  // fresher build has landed.
  if (canEdit.value) stopVersionWatch = watchForNewVersion(() => { newVersion.value = true; });
});
onUnmounted(() => {
  document.removeEventListener('fullscreenchange', onFsChange);
  document.removeEventListener('keydown', onSheetKey);
  document.removeEventListener('keydown', onGlobalKey);
  window.removeEventListener('beforeunload', onBeforeUnload);
  document.body.style.overflow = '';
  stopVersionWatch?.();
  laneObserver?.disconnect();
  clearTimeout(toastTimer);
  stopDeployPoll();
});

function syncState() {
  const p = new URLSearchParams();
  if (filters.q) p.set('q', filters.q);
  filters.stage.forEach((v) => p.append('stage', v));
  filters.impact.forEach((v) => p.append('impact', v));
  filters.effort.forEach((v) => p.append('effort', v));
  filters.assets.forEach((v) => p.append('asset', v));
  if (filters.visibility) p.set('visibility', filters.visibility);
  if (filters.hygiene) p.set('hygiene', filters.hygiene);
  filters.tags.forEach((t) => p.append('tag', t));
  if (filters.group !== 'horizon') p.set('group', filters.group);
  // Only persist the horizon selection when it differs from the default active set —
  // a plain link with nothing customized stays a plain link.
  const isDefaultHorizons =
    horizons.value.length === DEFAULT_HORIZONS.length && DEFAULT_HORIZONS.every((h) => horizons.value.includes(h));
  if (!isDefaultHorizons) horizons.value.forEach((h) => p.append('horizon', h));
  if (sort.value !== 'manual') p.set('sort', sort.value);
  if (present.value) p.set('present', '1');
  if (selected.value) p.set('item', selected.value.id);
  const qs = p.toString();
  // The product filter is reflected in the path (/music-app/), everything else in the query.
  const root = props.base ?? '/';
  const path = filters.product ? `${root}${productSlug(filters.product)}/` : root;
  history.replaceState(null, '', qs ? `${path}?${qs}` : path);
  // Saved state keeps product as a query param so it survives landing on any
  // board path; the mount parser's ?product= fallback picks it up and this
  // function immediately rewrites it back into the path. The open item is
  // deliberately not saved — returning to the board shouldn't reopen the drawer.
  try {
    if (filters.product) p.set('product', filters.product);
    p.delete('item');
    const saved = p.toString();
    sessionStorage.setItem('rm-board-state', saved ? `?${saved}` : '');
  } catch {
    /* ignore */
  }
}

watch([filters, horizons, sort, selected, present], syncState, { deep: true });

const iconBtn =
  'roadmap-action grid size-10 place-items-center rounded-lg border border-border-subtle-default bg-card text-text-subtle-default hover:text-text-primary-default transition-colors';
// Shared "neutral, bordered, icon+label" treatment for the toolbar's secondary action
// buttons (Sign in, New with AI) — same look, one definition.
const editActionBtn =
  'roadmap-action border-border-subtle-default bg-card text-single-sm-medium text-text-primary-default hover:bg-surface-primary-hover inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg border px-3 font-medium transition-colors';
</script>

<template>
  <div
    ref="root"
    class="board-root"
    :data-ready="ready"
    :data-editing="canEdit && editMode ? 'true' : undefined"
    :class="isFull ? 'bg-background overflow-y-auto p-6' : ''"
  >
    <!-- R1/R9: edit mode must be unmistakable — a state-aware brand-accent banner that
         sticks below the site header (see .edit-banner below: `position: sticky`, not
         `fixed` — it shares the page's normal scroll flow and reserves its own height
         automatically, so it can never overlap the Navbar the way a viewport-fixed banner
         at the same top offset would) plus a matching inset ring on the board container
         (see .board-root[data-editing]). Hidden while a full-screen overlay (ItemEditor,
         ShareDialog) is up — those already out-z-index it, but hiding it too keeps a
         covered, non-interactive banner out of the accessibility tree. A newer deployed
         build takes priority over everything else, surfacing the sticky Reload prompt
         right here. flex-wrap + min-w-0 text let long copy wrap on narrow screens instead
         of overflowing or crowding the Reload button. -->
    <div
      v-if="canEdit && editMode && !editingItem && !shareOpen"
      class="edit-banner flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-single-sm-medium sm:px-6"
      :class="[
        bannerState === 'reload' ||
        bannerState === 'authExpired' ||
        bannerState === 'buildFailed' ||
        bannerState === 'conflict' ||
        bannerState === 'validationBlocked'
          ? 'font-semibold'
          : 'font-medium',
        isFull ? '-mx-6 -mt-6' : '',
      ]"
      :style="bannerStyle"
      :data-banner-state="bannerState"
      data-test="editing-banner"
    >
      <span
        class="edit-mode-badge shrink-0 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[0.68rem] font-bold uppercase tracking-[0.12em]"
        :class="
          bannerState === 'reload' ||
          bannerState === 'authExpired' ||
          bannerState === 'buildFailed' ||
          bannerState === 'conflict' ||
          bannerState === 'validationBlocked'
            ? 'bg-[color:var(--color-text-primary-inverted-default)]/20'
            : 'bg-[color:var(--color-accent-brand-default)] text-[color:var(--color-text-primary-inverted-default)]'
        "
      >
        <PhPencilSimpleLine :size="13" weight="bold" /> Edit mode
      </span>
      <!-- U12 (R13): exactly one of these branches ever renders — `bannerState` above is
           the single precedence-ordered source of truth, so a conflict/session-expiry/
           validation block can never be showing at the same time as "unsynced" or a stale
           deploy-progress line underneath it. Static copy comes from `STATUS_COPY`
           (statusCopy.ts) rather than being hand-typed per branch, so the top banner and
           SyncBar (below) can never drift apart on wording. -->
      <template v-if="bannerState === 'reload'">
        <span class="min-w-0">{{ STATUS_COPY.reload.message }}</span>
        <button
          type="button"
          class="ml-auto shrink-0 rounded-lg bg-[color:var(--color-text-primary-inverted-default)]/15 px-3 py-1.5 hover:bg-[color:var(--color-text-primary-inverted-default)]/25"
          data-test="reload-latest"
          @click="reloadToLatest"
        >
          {{ STATUS_COPY.reload.action }}
        </button>
      </template>
      <!-- R2/R13/R16: the "someone else changed this" interrupt — outranks a plain unsynced
           status (see bannerState's precedence) and always carries its one recovery action
           inline, never a dead end. Covers both the per-item base-version conflict (names
           the item(s)) and the whole-branch fast-forward race (generic, no item to name) —
           `syncError` already carries whichever wording `conflictMessage()` produced. -->
      <template v-else-if="bannerState === 'conflict'">
        <span data-test="banner-conflict" class="min-w-0">{{ syncError }}</span>
        <button
          type="button"
          class="ml-auto shrink-0 rounded-lg bg-[color:var(--color-text-primary-inverted-default)]/15 px-3 py-1.5 hover:bg-[color:var(--color-text-primary-inverted-default)]/25"
          data-test="conflict-reload"
          @click="reloadToLatest"
        >
          {{ STATUS_COPY.conflict.action }}
        </button>
      </template>
      <template v-else-if="bannerState === 'authExpired'">
        <span data-test="banner-auth-expired" class="min-w-0">{{ STATUS_COPY.authExpired.message }}</span>
        <button
          type="button"
          class="ml-auto shrink-0 rounded-lg bg-[color:var(--color-text-primary-inverted-default)]/15 px-3 py-1.5 hover:bg-[color:var(--color-text-primary-inverted-default)]/25"
          data-test="sign-in-again"
          @click="signIn"
        >
          {{ STATUS_COPY.authExpired.action }}
        </button>
      </template>
      <!-- R6/R13/R15/R16: validation errors stay grouped/scannable (U5's per-item, per-field
           grouping, formatted by formatValidationErrors) rather than a wall of text — shown
           as the primary status instead of hiding behind a generic "unsynced" while SyncBar
           quietly disagreed underneath it. -->
      <template v-else-if="bannerState === 'validationBlocked'">
        <span data-test="banner-validation-blocked" class="min-w-0">{{ syncError }}</span>
      </template>
      <template v-else-if="bannerState === 'publishing'">
        <span data-test="banner-publishing" class="min-w-0">{{ STATUS_COPY.publishing.message }}</span>
      </template>
      <template v-else-if="bannerState === 'building'">
        <span data-test="banner-building" class="min-w-0">{{ STATUS_COPY.building.message }}</span>
      </template>
      <template v-else-if="bannerState === 'live'">
        <span data-test="banner-live" class="min-w-0">{{ STATUS_COPY.live.message }}</span>
      </template>
      <template v-else-if="bannerState === 'buildFailed'">
        <span data-test="banner-build-failed" class="min-w-0">{{ STATUS_COPY.buildFailed.message }}</span>
        <a
          v-if="publishing?.htmlUrl"
          :href="publishing.htmlUrl"
          target="_blank"
          rel="noopener"
          class="ml-auto shrink-0 rounded-lg bg-[color:var(--color-text-primary-inverted-default)]/15 px-3 py-1.5 hover:bg-[color:var(--color-text-primary-inverted-default)]/25"
          data-test="build-failed-view-run"
        >
          {{ STATUS_COPY.buildFailed.action }}
        </a>
      </template>
      <template v-else-if="bannerState === 'superseded'">
        <span data-test="banner-superseded" class="min-w-0">{{ STATUS_COPY.superseded.message }}</span>
      </template>
      <template v-else-if="bannerState === 'noBuild'">
        <span data-test="banner-no-build" class="min-w-0">{{ STATUS_COPY.noBuild.message }}</span>
      </template>
      <!-- R16: "saved, not published" has to be unmistakable here — STATUS_COPY.unsynced's
           message says exactly that; the live count is appended so the banner still answers
           "how much," same as before. -->
      <template v-else-if="bannerState === 'unsynced'">
        <span data-test="banner-unsynced" class="min-w-0"
          >{{ STATUS_COPY.unsynced.message }} · {{ editStore.dirtyCount.value }} unpublished</span
        >
      </template>
      <template v-else>
        <span data-test="banner-clean" class="min-w-0">{{ STATUS_COPY.clean.message }}</span>
      </template>
      <!-- R14: the legible draft → published → building → live progression, tied to the same
           deploy status U4 tracks — "publishing"/"building" read like tracking a package, not
           a void. `basis-full` wraps it onto its own line under the message on narrow screens
           rather than crowding it. Hidden for every interrupt (`progressionStep` is null) —
           conflict/session-expired/validation-blocked/reload aren't points on this line, and
           showing dots next to one would imply progress that isn't happening. -->
      <div
        v-if="showProgression"
        class="lifecycle-progression flex basis-full items-center gap-2"
        data-test="lifecycle-progression"
        :data-progression-step="progressionStep"
      >
        <span class="progression-track">
          <span class="progression-fill" :style="{ width: progressionPct }" :data-active="progressionActive" />
        </span>
        <span class="progression-label">{{ progressionStep }}</span>
      </div>
    </div>

    <!-- Fix #5: today, leaving edit mode with a pending draft gives zero on-screen
         indication anything is unpublished — the banner above and SyncBar both only render
         while `editMode` is on. This pill is the view-mode counterpart: quiet (muted surface,
         subtle brand-accent border/dot — nowhere near as loud as the edit banner) but always
         reachable, and it's the one and only way back into edit mode from a plain view. The
         `!editMode` guard makes it mutually exclusive with the edit banner above — never both
         on screen at once. Fixed to the corner (not sticky in-flow) since it has no natural
         home in the read-only toolbar and shouldn't shift other layout to make room. -->
    <button
      v-if="canEdit && !editMode && editStore.dirtyCount.value > 0"
      type="button"
      class="unpublished-pill roadmap-action text-single-sm-medium fixed right-4 bottom-4 z-30 flex items-center gap-2 rounded-full border px-3.5 py-2 shadow-md sm:right-6 sm:bottom-6"
      data-test="unpublished-indicator"
      @click="editMode = true"
    >
      <span class="size-1.5 shrink-0 rounded-full" style="background: var(--color-accent-brand-default)" />
      <span
        >{{ editStore.dirtyCount.value }} unpublished change{{ editStore.dirtyCount.value > 1 ? 's' : '' }} —
        Resume editing</span
      >
    </button>

    <!-- U6/U9: quiet, non-modal secondary notices (R16) — never the primary status, just a
         corner chip. Stacked opposite the unpublished-pill above so the two never collide.
         Both are gated on `canEdit` (only an editor's session can ever set either flag). -->
    <div
      v-if="canEdit && ((editStore.persistFailed.value && !persistFailedDismissed) || editStore.crossTabChanged.value)"
      class="fixed left-4 bottom-4 z-30 flex flex-col items-start gap-2 sm:left-6 sm:bottom-6"
    >
      <div
        v-if="editStore.persistFailed.value && !persistFailedDismissed"
        data-test="persist-failed-notice"
        class="persist-failed-notice text-single-sm-medium flex items-center gap-2 rounded-full border px-3.5 py-2 shadow-md"
      >
        <span class="size-1.5 shrink-0 rounded-full" style="background: currentColor" />
        <span>Your changes can't be saved on this device — publish soon.</span>
        <button
          type="button"
          data-test="persist-failed-notice-dismiss"
          class="ml-1 shrink-0 opacity-60 hover:opacity-100"
          aria-label="Dismiss"
          @click="persistFailedDismissed = true"
        >
          <PhX :size="12" weight="bold" />
        </button>
      </div>
      <div
        v-if="editStore.crossTabChanged.value"
        data-test="cross-tab-notice"
        class="cross-tab-notice roadmap-action text-single-sm-medium flex items-center gap-2 rounded-full border px-3.5 py-2 shadow-md"
      >
        <span class="size-1.5 shrink-0 rounded-full" style="background: var(--color-accent-brand-default)" />
        <span>Another tab edited these changes.</span>
        <button
          type="button"
          data-test="cross-tab-notice-dismiss"
          class="ml-1 shrink-0 opacity-60 hover:opacity-100"
          aria-label="Dismiss"
          @click="editStore.dismissCrossTabChanged()"
        >
          <PhX :size="12" weight="bold" />
        </button>
      </div>
    </div>

    <section class="roadmap-masthead reveal mb-4 rounded-[20px] px-4 py-3 sm:px-6 sm:py-3.5 lg:px-7 lg:py-4">
      <div class="grid items-center gap-x-6 gap-y-3 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.54fr)]">
        <div class="max-w-4xl">
          <p class="roadmap-label flex flex-wrap items-center gap-2">
            <span>Product roadmap</span>
            <span
              v-if="present"
              class="inline-flex items-center gap-1.5 rounded-full border border-border-subtle-default/70 bg-card/70 px-2.5 py-1 text-single-sm-medium normal-case tracking-normal text-text-primary-default"
            >
              <span class="size-1.5 rounded-full bg-[color:var(--color-accent-brand-default)]" aria-hidden="true" />
              Presentation mode
            </span>
          </p>
          <h1 class="roadmap-display roadmap-title mt-1.5 text-[1.8rem] sm:text-[2.15rem] lg:text-[2.45rem]">
            <template v-if="filters.product">{{ filters.product }} <em>roadmap</em></template>
            <template v-else>What we’re <em>building</em></template>
          </h1>
          <p class="roadmap-muted mt-1.5 max-w-2xl text-sm leading-relaxed max-sm:hidden">
            {{ present ? presentSub : heroLead }}
          </p>
        </div>

        <div class="roadmap-glass rounded-xl p-1.5 max-sm:overflow-x-auto" role="group" aria-label="Horizons">
          <div class="grid grid-cols-2 gap-1.5 max-sm:flex max-sm:w-max sm:grid-cols-3 lg:grid-cols-5">
            <button
              v-for="s in stats"
              :key="s.key"
              type="button"
              :aria-pressed="s.active"
              data-test="horizon-chip"
              :data-horizon="s.key"
              :class="
                cn(
                  'roadmap-action rounded-lg border px-2.5 py-2 text-left max-sm:flex max-sm:min-h-10 max-sm:min-w-[116px] max-sm:items-center max-sm:gap-2 max-sm:py-1.5',
                  s.active
                    ? 'roadmap-selected-control horizon-selected-control'
                    : 'border-border-subtle-default/70 bg-[color:var(--roadmap-glass-bg)] hover:bg-[color:var(--roadmap-glass-strong)]',
                )
              "
              :style="{ '--horizon-accent': s.dot }"
              @click="toggleHorizon(s.key)"
            >
              <span class="text-single-sm-medium text-text-primary-default flex items-center gap-2">
                <span v-if="s.dot" class="h-3.5 w-1 shrink-0 rounded-full" :style="{ background: s.dot }" />
                {{ s.label }}
              </span>
              <span class="font-display roadmap-title mt-0.5 block text-[1.3rem] leading-none tabular-nums max-sm:mt-0 sm:text-[1.45rem]">
                {{ s.value }}
              </span>
              <span class="text-single-sm-medium mt-0.5 block max-sm:hidden" :style="{ color: toneText[s.tone] }">
                {{ s.sub }}
              </span>
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- R2: a compact "recent changes" peek — hidden entirely (no empty box) when the
         feed is empty or the endpoint/token is unavailable (see RecentChanges.vue), and
         out of the way in presentation mode like the rest of the board chrome. -->
    <RecentChanges v-if="!present" :items="liveItems" :base="props.base ?? '/'" :limit="4" class="mb-4" />

    <!-- Body -->
    <div class="roadmap-glass board-body rounded-[24px] p-3.5 sm:p-4">
    <div class="flex gap-5">
      <FiltersSidebar
        v-if="sidebarOpen && !present"
        class="hidden lg:block"
        :filters="filters"
        :assets="availableAssets"
        :stages="availableStages"
        :impact-options="availableImpact"
        :effort-options="availableEffort"
        :tag-options="availableTags"
        @clear="clear"
      />

      <div class="min-w-0 flex-1">
        <!-- Toolbar. Two stable zones, deliberately kept apart so toggling edit mode never
             reflows the other: the view-controls row below (filters/search/selects/presence/
             the Edit affordance) never changes shape when edit mode flips — the create
             actions (New item, New with AI) live in their own `edit-action-bar` row that only
             ever appears/disappears BELOW this one (see that block further down). -->
        <div v-if="!present" class="mb-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            :class="[iconBtn, 'relative']"
            aria-label="Filters"
            title="Filters"
            @click="toggleFilters"
          >
            <PhSlidersHorizontal :size="17" />
            <span
              v-if="activeFilterCount(filters)"
              class="roadmap-count-badge absolute -top-1.5 -right-1.5 grid size-4.5 place-items-center rounded-md text-[10px] font-semibold tabular-nums"
            >
              {{ activeFilterCount(filters) }}
            </span>
          </button>
            <div ref="searchWrap" class="min-w-[220px] flex-1 max-sm:order-3 max-sm:basis-full"><SearchInput v-model="filters.q" name="q" placeholder="Search roadmap items..." :debounce="150" /></div>
          <div v-if="!IS_PUBLIC" class="max-sm:order-4 max-sm:flex-1 sm:w-40"><Select v-model="visibilityModel" :options="visibilityOptions" name="visibility" aria-label="Visibility" /></div>
          <div class="max-sm:order-5 max-sm:flex-1 sm:w-52"><Select v-model="sort" :options="sortOptions" name="sort" aria-label="Sort" /></div>
          <div class="max-sm:order-6 max-sm:flex-1 sm:w-44"><Select v-model="filters.group" :options="groupOptions" name="group" aria-label="Group by" /></div>
          <!-- R11: live presence — "N viewing" + avatars, visible to ALL viewers (not
               canEdit-gated), gated only by realtimeAvailable (R14). See PresenceIndicator.vue. -->
          <PresenceIndicator :viewers="viewers" :realtime-available="realtimeAvailable" />

          <!-- Session-actions cluster: presentation/share/fullscreen tuck away below `sm` (they
               can always be reached — nothing here is destructive/unique), but the Edit
               affordance is deliberately the one control that's ALWAYS rendered, in this same
               spot, at every width and in every state (signed-out, viewing, editing) — only its
               label/icon/color change, so entering/leaving edit mode never shifts anything to
               its left. `ml-auto` pins the whole cluster to the row's trailing edge. -->
          <div class="ml-auto flex shrink-0 items-center gap-2">
            <button
              type="button"
              :class="[iconBtn, 'max-sm:hidden']"
              :aria-label="shareCopied ? 'Presentation link copied' : 'Copy presentation link'"
              :title="shareCopied ? 'Presentation link copied' : 'Copy presentation link'"
              @click="shareView"
            >
              <PhCheck v-if="shareCopied" :size="17" />
              <PhPresentation v-else :size="17" />
            </button>
            <button
              v-if="canShare"
              type="button"
              :class="[iconBtn, 'chrome-reveal max-sm:hidden']"
              aria-label="Publish a share link…"
              title="Publish a share link…"
              @click="openShare"
            >
              <PhShareNetwork :size="17" />
            </button>
            <button type="button" :class="[iconBtn, 'max-sm:hidden']" :aria-label="isFull ? 'Exit full screen' : 'Full screen'" :title="isFull ? 'Exit full screen' : 'Full screen'" @click="toggleFull">
              <PhArrowsIn v-if="isFull" :size="17" />
              <PhArrowsOut v-else :size="17" />
            </button>

            <button
              v-if="!canEdit"
              type="button"
              :class="editActionBtn"
              aria-label="Sign in to edit"
              title="Sign in to edit"
              data-test="sign-in-to-edit"
              @click="signIn"
            >
              <PhPencilSimple :size="17" />
              <span class="max-sm:hidden">Sign in</span>
            </button>
            <button
              v-else
              type="button"
              :class="[
                'roadmap-action chrome-reveal inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg px-3 text-single-sm-medium font-medium transition-colors',
                editMode
                  ? 'bg-[color:var(--color-accent-brand-default)] text-[color:var(--color-text-primary-inverted-default)] hover:opacity-90'
                  : 'roadmap-primary-action',
              ]"
              :aria-label="editMode ? `Done editing — signed in as ${editorLogin}` : `Edit the roadmap — signed in as ${editorLogin}`"
              :title="editMode ? 'Done editing (e)' : 'Edit (e)'"
              data-test="edit-toggle"
              @click="toggleEditMode"
            >
              <PhCheck v-if="editMode" :size="17" />
              <PhPencilSimpleLine v-else :size="17" />
              <span class="max-sm:hidden">{{ editMode ? 'Done' : 'Edit' }}</span>
            </button>
          </div>
        </div>

        <!-- Edit action bar: the create actions get their own row, appearing/disappearing
             ONLY here, below the view-controls row above — which is why toggling edit mode
             never reflows filters/search/selects/presence/Edit. Pure-CSS entrance (see
             `.edit-action-bar` below), same reasoning as the toast/cheat-sheet's: a plain
             v-if, not a <Transition>, keeps show/hide synchronous for tests. -->
        <div
          v-if="canEdit && editMode && !present"
          class="edit-action-bar mb-3 flex flex-wrap items-center gap-2"
          data-test="edit-action-bar"
        >
          <button
            v-if="aiAvailable"
            type="button"
            :class="editActionBtn"
            aria-label="Draft a new roadmap item with AI"
            title="Draft a new item with AI"
            data-test="new-with-ai"
            @click="newWithAiOpen = true"
          >
            <PhSparkle :size="16" /> New with AI
          </button>
          <button
            type="button"
            class="roadmap-action inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg bg-[color:var(--color-accent-brand-default)] px-3 text-single-sm-medium font-medium text-[color:var(--color-text-primary-inverted-default)] transition-opacity hover:opacity-90"
            aria-label="Add a new roadmap item"
            title="Add a new item"
            data-test="new-item"
            @click="addNewItem"
          >
            <PhPlus :size="16" /> New item
          </button>
        </div>

        <p
          v-if="filters.q.trim() && !present"
          class="text-single-sm-medium text-text-subtle-default -mt-2 mb-3 flex flex-wrap items-center gap-x-2 gap-y-1"
          data-test="search-results-line"
        >
          <span>{{ focused.length }} {{ focused.length === 1 ? 'result' : 'results' }} for “{{ filters.q.trim() }}”</span>
          <button
            v-for="match in hiddenLaneMatches"
            :key="match.key"
            type="button"
            class="text-text-link-default min-h-8 rounded-lg px-1 hover:underline"
            data-test="hidden-lane-match"
            @click="toggleHorizon(match.key)"
          >
            + {{ match.count }} more in {{ match.key }}
          </button>
        </p>

        <!-- Reordering priority only makes sense scoped to one product, sorted by Priority,
             with nothing else filtering the lane — otherwise a drag wouldn't reorder what
             the user thinks it does. Keep the hint quiet either way: it's guidance, not a
             warning. -->
        <p v-if="canEdit && editMode && !present" class="text-single-sm-medium text-text-subtle-default -mt-2 mb-3" data-test="reorder-hint">
          <template v-if="canReorder">Drag a card's ⠿ handle to set priority.</template>
          <template v-else>To reorder priority, filter to one product, sort by Priority, and clear other filters.</template>
        </p>

        <!-- R13: a soft, advisory-only "also editing" nudge — never a lock/merge signal,
             just a heads-up that another editor is in the same edit mode right now.
             See PresenceIndicator.vue. -->
        <PresenceIndicator :others-editing="othersEditing" :can-edit="canEdit" :edit-mode="editMode" :present="present" />

        <ActiveFilterChips
          v-if="activeChips.length && !present"
          :chips="activeChips"
          @remove="removeFilterChip"
          @clear="clear"
        />

        <!-- Empty -->
        <div
          v-if="!focused.length"
          class="roadmap-panel text-single-base-medium text-text-subtle-default rounded-2xl border border-dashed px-6 py-14 text-center"
        >
          <BrandMark class="mx-auto mb-4 size-12 opacity-90" />
          <p class="font-display roadmap-title text-[1.35rem] leading-tight">
            {{ horizons.length === 0 ? 'No horizons selected' : 'No matching roadmap items' }}
          </p>
          <p class="mx-auto mt-1 max-w-sm text-sm leading-relaxed">
            {{ horizons.length === 0 ? 'Pick at least one horizon chip above to see items.' : 'The filters are too narrow for this view.' }}
          </p>
          <button
            v-if="activeFilterCount(filters) || horizons.length === 0"
            class="text-text-link-default mt-3 hover:underline"
            @click="clear"
          >
            {{ horizons.length === 0 && !activeFilterCount(filters) ? 'Reset horizons' : 'Clear all filters' }}
          </button>
          <div v-if="canEdit && editMode" class="mt-4">
            <button
              type="button"
              class="roadmap-action inline-flex items-center gap-1.5 rounded-lg bg-[color:var(--color-accent-brand-default)] px-3.5 py-2 text-single-sm-medium font-medium text-[color:var(--color-text-primary-inverted-default)] transition-opacity hover:opacity-90"
              data-test="empty-new-item"
              @click="addNewItem"
            >
              <PhPlus :size="16" /> New item
            </button>
          </div>
        </div>

        <!-- Board view: each lane is a bordered container; radii stay concentric
             (outer 16px − 8px padding = 8px cards). -->
        <template v-else>
        <LaneJumpBar
          v-if="!present"
          :lanes="lanes"
          :active-key="activeLaneKey"
          @jump="jumpToLane"
        />
        <div class="board-scroll flex flex-col gap-5 pb-2 md:flex-row md:items-start md:gap-4 md:overflow-x-auto">
          <section
            v-for="(lane, i) in lanes"
            :key="lane.key"
            :id="laneDomId(lane.key)"
            :ref="(el) => registerLaneSectionEl(lane.key, el as Element | null)"
            class="reveal w-full rounded-[20px] border border-border-subtle-default/80 p-2.5 shadow-sm md:min-w-[270px] md:flex-1 md:basis-0"
            :class="dragOverLaneKey === lane.key ? 'roadmap-lane-drop-target' : ''"
            :data-lane-key="lane.key"
            :style="{ background: laneWash(lane.key), '--i': i + 1, '--lane-accent': lane.dot }"
          >
            <header class="px-3 pt-2.5">
              <div class="flex items-center gap-2">
                <span class="h-5 w-1 rounded-full bg-[color:var(--lane-accent)]" />
                <h2 class="font-display roadmap-title text-[1.3rem] leading-none">{{ lane.key }}</h2>
                <span
                  class="border-border-subtle-default bg-card/85 text-single-sm-medium text-text-primary-default ml-auto grid size-7 place-items-center rounded-lg border tabular-nums shadow-sm"
                >
                  {{ lane.items.length }}
                </span>
              </div>
              <p v-if="lane.desc" class="text-single-sm-medium text-text-subtle-default mt-1.5 leading-snug">
                {{ lane.desc }}
              </p>
              <div class="border-border-subtle-default mt-2.5 border-t" />
            </header>
            <div
              class="mt-3 flex flex-col gap-2"
              :ref="(el) => registerLaneListEl(lane.key, el as Element | null)"
            >
              <RoadmapCard
                v-for="it in lane.items"
                :key="it.id"
                :item="it"
                :show-horizon="filters.group === 'product'"
                :active="selected?.id === it.id"
                :client="present"
                :editing="canEdit && editMode"
                :draggable="canEdit && editMode"
                :pending="canEdit && editMode ? (it as any).pending : undefined"
                :highlight-query="filters.q"
                @select="select"
                @discard="editStore.revertItem($event)"
                @rename="onCardRename"
                @duplicate="onCardDuplicate"
              />
              <p
                v-if="!lane.items.length"
                class="text-single-sm-medium text-text-subtle-default px-2.5 pt-1 pb-3"
                data-test="lane-empty-copy"
              >
                {{ laneEmptyCopy(lane.key, filters.group) }}
              </p>
              <button
                v-if="canEdit && editMode"
                type="button"
                class="roadmap-action text-single-sm-medium text-text-link-default mt-1 inline-flex items-center gap-1.5 self-start rounded-lg px-2 py-1.5 hover:underline"
                @click="addToLane(lane)"
              >
                <PhPlus :size="14" /> Add item
              </button>
            </div>
          </section>
        </div>
        </template>
      </div>
    </div>
    </div>

    <!-- Mobile filter sheet (below lg the sidebar lives here) -->
    <Transition name="sheet">
      <div v-if="sheetOpen" class="fixed inset-0 z-50 lg:hidden">
        <div class="sheet-scrim bg-surface-transparent-black-50 absolute inset-0" @click="sheetOpen = false" />
        <div
          ref="sheetPanel"
          role="dialog"
          aria-modal="true"
          aria-label="Filters"
          tabindex="-1"
          class="sheet-panel bg-background absolute top-0 left-0 flex h-full w-[300px] max-w-[85vw] flex-col shadow-xl outline-none"
        >
          <div class="border-border-subtle-default flex items-center justify-between border-b px-5 py-3">
            <span class="text-single-sm-medium text-text-subtle-default font-semibold tracking-wide uppercase">Filters</span>
            <div class="flex items-center gap-2">
              <button
                v-if="activeFilterCount(filters)"
                type="button"
                class="text-single-sm-medium text-text-link-default hover:underline"
                @click="clear"
              >
                Clear all
              </button>
              <button
                type="button"
                class="text-icons-subtle-default hover:text-text-primary-default grid size-10 place-items-center"
                aria-label="Close filters"
                @click="sheetOpen = false"
              >
                <PhX :size="18" />
              </button>
            </div>
          </div>
          <div class="flex-1 overflow-y-auto p-5">
            <FiltersSidebar
              :filters="filters"
              :assets="availableAssets"
              :stages="availableStages"
              :impact-options="availableImpact"
              :effort-options="availableEffort"
              :tag-options="availableTags"
              hide-header
              @clear="clear"
            />
          </div>
          <div class="border-border-subtle-default border-t p-4">
            <button
              type="button"
              class="bg-foreground text-text-primary-inverted-default text-single-base-medium w-full rounded-lg py-2.5"
              @click="sheetOpen = false"
            >
              Show {{ shown.length }} item{{ shown.length === 1 ? '' : 's' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <DetailDrawer
      :item="drawerItem"
      :pos="navPos"
      :client="present"
      :edit="false"
      :raw-body="selected ? (rawBodies.get(selected.id) ?? null) : null"
      @close="closeDrawer"
      @prev="navBy(-1)"
      @next="navBy(1)"
    />

    <component
      :is="ItemEditor"
      v-if="canEdit && editMode && editingItem"
      :item="editingItem"
      :body="editingBody"
      :is-new="editingIsNew"
      :all-tags="allTags"
      :all-owners="allOwners"
      :published="editingId ? (byId.get(editingId) ?? null) : null"
      @field="onEditorField"
      @update:body="onEditorBody"
      @delete="onEditorDelete"
      @discard="onEditorDiscard"
      @close="onEditorClose"
      @reset-field="onEditorResetField"
      @rewrite-accept="onEditorRewriteAccept"
    />

    <component
      :is="NewWithAiDialog"
      v-if="canEdit && editMode && aiAvailable && newWithAiOpen"
      :initial-product="filters.product"
      @close="newWithAiOpen = false"
      @drafted="onDrafted"
    />

    <SyncBar
      v-if="canEdit && editMode && unsynced"
      :dirty-count="editStore.dirtyCount.value"
      :pending="syncPending"
      :result="syncResult"
      :error="syncError"
      :publishing="publishing"
      :overwrite-warning="newVersion"
      :change-summary="changeSummary"
      :progression-step="progressionStep"
      @sync="doSync"
      @discard="onDiscardAll"
    />

    <ShareDialog
      v-if="shareOpen"
      :items="shareItems"
      :context="shareContext"
      :author="shareAuthor"
      :shares="sortedAuthoredShares"
      :shares-loading="sharesLoading"
      :shares-error="sharesError"
      :pending="sharePending"
      :result="shareResult"
      :error="shareError"
      @close="shareOpen = false"
      @submit="onShareSubmit"
      @refresh-shares="loadAuthoredShares"
      @revoke="onShareRevoke"
    />

    <!-- Fix #9: global keyboard-shortcuts cheat-sheet, opened with "?". A plain v-if (no
         <Transition> wrapper, unlike the mobile filter sheet above) — the entrance is a
         pure-CSS animation on the panel itself (see `.shortcuts-panel` below), so open/close
         stay perfectly synchronous with `shortcutsOpen` rather than waiting on a leave hook. -->
    <div
      v-if="shortcutsOpen"
      class="fixed inset-0 z-50 flex items-center justify-center bg-surface-transparent-black-50 p-4"
      data-test="shortcuts-cheatsheet"
      @click.self="shortcutsOpen = false"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        class="roadmap-panel shortcuts-panel w-full max-w-sm rounded-2xl border border-border-subtle-default bg-card p-5 shadow-xl"
      >
        <div class="mb-3 flex items-center justify-between">
          <h2 class="font-display roadmap-title text-[1.15rem] leading-none">Keyboard shortcuts</h2>
          <button
            type="button"
            class="text-icons-subtle-default hover:text-text-primary-default grid size-8 place-items-center"
            aria-label="Close"
            data-test="shortcuts-close"
            @click="shortcutsOpen = false"
          >
            <PhX :size="16" />
          </button>
        </div>
        <dl class="text-single-sm-medium text-text-primary-default space-y-2">
          <div class="flex items-center justify-between gap-4">
            <dt class="text-text-subtle-default">Toggle edit mode</dt>
            <dd class="font-mono">E</dd>
          </div>
          <div class="flex items-center justify-between gap-4">
            <dt class="text-text-subtle-default">New item</dt>
            <dd class="font-mono">N</dd>
          </div>
          <div class="flex items-center justify-between gap-4">
            <dt class="text-text-subtle-default">Sync</dt>
            <dd class="font-mono">⌘/Ctrl + Enter</dd>
          </div>
          <div class="flex items-center justify-between gap-4">
            <dt class="text-text-subtle-default">Search</dt>
            <dd class="font-mono">/</dd>
          </div>
          <div class="flex items-center justify-between gap-4">
            <dt class="text-text-subtle-default">Close editor</dt>
            <dd class="font-mono">Esc</dd>
          </div>
          <div class="flex items-center justify-between gap-4">
            <dt class="text-text-subtle-default">This menu</dt>
            <dd class="font-mono">?</dd>
          </div>
        </dl>
      </div>
    </div>

    <!-- Fix #10: dismissible, non-blocking toast fired once a Sync actually lands, with a
         traceable link to the commit — complements the "Publishing…" banner (which covers
         the in-flight window) rather than replacing it. Same reasoning as the cheat-sheet
         above: a plain v-if with a pure-CSS entrance (`.toast` below), not a <Transition>. -->
    <div
      v-if="toastVisible"
      role="status"
      class="toast fixed right-4 bottom-4 z-50 flex items-center gap-2.5 rounded-lg border border-border-subtle-default bg-card px-4 py-3 shadow-xl sm:right-6 sm:bottom-6"
      data-test="sync-toast"
    >
      <PhCheck :size="16" style="color: var(--color-accent-brand-default)" />
      <span class="text-single-sm-medium text-text-primary-default">Published ✓</span>
      <a
        :href="toastCommitUrl"
        target="_blank"
        rel="noopener"
        class="text-single-sm-medium text-text-link-default hover:underline"
        data-test="sync-toast-link"
        @click="dismissToast"
      >
        {{ toastShortSha }}
      </a>
      <button
        type="button"
        class="text-icons-subtle-default hover:text-text-primary-default ml-1"
        aria-label="Dismiss"
        data-test="sync-toast-dismiss"
        @click="dismissToast"
      >
        <PhX :size="14" />
      </button>
    </div>

    <!-- U8 (R9): a quiet, non-blocking notice for reorders the last successful sync couldn't
         place (a stale reorder id — moved lanes or deleted upstream — is tolerated and skipped
         server-side rather than aborting the sync, KTD2's deliberate exception) — visible, not
         silently dropped. Stacked above the sync toast (both can appear at once right after a
         Sync); dismiss just clears the notice, it doesn't affect anything already published. -->
    <div
      v-if="canEdit && skippedReorderNames.length"
      role="status"
      class="toast fixed right-4 bottom-20 z-50 flex items-center gap-2.5 rounded-lg border border-border-subtle-default bg-card px-4 py-3 shadow-xl sm:right-6 sm:bottom-24"
      data-test="skipped-reorder-notice"
    >
      <span class="text-single-sm-medium text-text-primary-default">
        Some reorders couldn't be applied — reload. ({{ capList(skippedReorderNames) }})
      </span>
      <button
        type="button"
        class="text-icons-subtle-default hover:text-text-primary-default ml-1"
        aria-label="Dismiss"
        data-test="skipped-reorder-notice-dismiss"
        @click="skippedReorderNames = []"
      >
        <PhX :size="14" />
      </button>
    </div>

    <!-- U11 (R12): exiting edit mode ("Done") with unsynced changes is a conscious Publish /
         Keep / Discard decision (see toggleEditMode/onExit* above) — not a silent drop.
         Escape/backdrop click just closes the modal (still editing, nothing decided); only
         the three buttons below actually act. -->
    <div
      v-if="exitPromptOpen"
      class="fixed inset-0 z-50 flex items-center justify-center bg-surface-transparent-black-50 p-4"
      data-test="exit-edit-prompt"
      @click.self="closeExitPrompt"
    >
      <div
        ref="exitPromptPanel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="exit-edit-prompt-title"
        tabindex="-1"
        class="roadmap-panel w-full max-w-sm rounded-2xl border border-border-subtle-default bg-card p-5 shadow-xl outline-none"
      >
        <div class="mb-1 flex items-center justify-between">
          <h2 id="exit-edit-prompt-title" class="font-display roadmap-title text-[1.15rem] leading-none">
            You have unpublished changes
          </h2>
          <button
            type="button"
            class="text-icons-subtle-default hover:text-text-primary-default grid size-8 place-items-center"
            aria-label="Close"
            data-test="exit-edit-prompt-close"
            @click="closeExitPrompt"
          >
            <PhX :size="16" />
          </button>
        </div>
        <p class="text-single-sm-default text-text-subtle-default mb-4">
          {{ editStore.dirtyCount.value }} unpublished change{{ editStore.dirtyCount.value === 1 ? '' : 's' }} — saved on
          this device, not yet published. Publish now, keep the draft for later, or discard it.
        </p>
        <div class="flex flex-col gap-2">
          <button
            type="button"
            class="bg-accent-brand-default text-text-primary-inverted-default text-single-sm-medium rounded-lg px-4 py-2.5 disabled:opacity-50"
            data-test="exit-publish"
            :disabled="syncPending"
            @click="onExitPublish"
          >
            {{ syncPending ? 'Publishing…' : 'Publish now' }}
          </button>
          <button
            type="button"
            class="border-border-subtle-default bg-card/80 text-single-sm-medium text-text-primary-default rounded-lg border px-4 py-2.5 transition-colors hover:bg-surface-primary-hover"
            data-test="exit-keep"
            @click="onExitKeep"
          >
            Keep for later
          </button>
          <button
            type="button"
            class="text-single-sm-medium rounded-lg border px-4 py-2.5 transition-colors"
            :style="{ borderColor: toneText.red, color: toneText.red }"
            data-test="exit-discard"
            @click="onExitDiscard"
          >
            Discard
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* R1/R9: an unmistakable edit-mode cue on the board container itself (the banner above
   announces it; this reinforces it while scrolling past the banner). */
.board-root[data-editing='true'] .board-body {
  position: relative;
  border-radius: 16px;
  background-color: color-mix(in srgb, var(--color-accent-brand-default) 4%, transparent);
  box-shadow:
    inset 0 0 0 2px color-mix(in srgb, var(--color-accent-brand-default) 62%, transparent),
    0 0 36px -12px color-mix(in srgb, var(--color-accent-brand-default) 40%, transparent);
}
/* A solid accent stripe along the top edge of the editable board — a persistent "you are
   editing" cue that still reads once the banner has scrolled out of view. */
.board-root[data-editing='true'] .board-body::before {
  content: '';
  position: absolute;
  inset: 0 0 auto 0;
  height: 3px;
  border-radius: 16px 16px 0 0;
  background: var(--color-accent-brand-default);
  pointer-events: none;
  z-index: 1;
}

/* Drag-to-change-horizon: a quiet brand-accent ring on whichever lane is currently under
   the pointer while a card is being dragged — just enough to make the drop target obvious
   without competing with the edit-mode chrome above. `!important` because the lane's own
   background gradient is set inline (see `laneWash`), which otherwise always wins over a
   plain class rule. */
.roadmap-lane-drop-target {
  box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--color-accent-brand-default) 55%, transparent);
  background: color-mix(in srgb, var(--color-accent-brand-default) 6%, transparent) !important;
}

[data-lane-key] {
  scroll-margin-top: 7rem;
}

/* SortableJS drag treatment. `ghostClass` lands on RoadmapCard's own root element — a plain
   (non-`:deep`) selector reaches it because Vue tags a child component's root element with
   this file's scope attribute the same as any element of its own template — and renders the
   live drop-position placeholder: a dashed brand-accent slot with everything inside it
   dimmed, so it reads as "the empty spot this card will land in" rather than a second copy
   of the card. `chosenClass`/`dragClass` need `:deep()` instead, since they style the actual
   card content (RoadmapCard's inner <button>) one level past that root. */
.roadmap-sortable-ghost {
  border-radius: 1rem;
  opacity: 0.55;
  border: 1.5px dashed var(--color-accent-brand-default) !important;
  background: color-mix(in srgb, var(--color-accent-brand-default) 10%, transparent) !important;
  box-shadow: none !important;
}
.roadmap-sortable-chosen :deep(.roadmap-card) {
  opacity: 0.94;
  box-shadow: 0 10px 24px -8px rgb(0 0 0 / 0.3);
}
.roadmap-sortable-drag :deep(.roadmap-card) {
  box-shadow: 0 16px 32px -10px rgb(0 0 0 / 0.4);
}
@media (prefers-reduced-motion: reduce) {
  .roadmap-sortable-chosen :deep(.roadmap-card),
  .roadmap-sortable-drag :deep(.roadmap-card) {
    box-shadow: none;
  }
}

/* R14: the publish → build → live progress track — a slim filled pill that advances with the
   deploy (Published ⅓ → Building ⅔ → Live full), reading like tracking a package rather than a
   row of loose dots. A soft sheen sweeps the fill while it's still moving toward live; it, and
   the width transition, switch off under reduced motion per this file's convention. */
.progression-track {
  position: relative;
  height: 3px;
  width: 5rem;
  flex-shrink: 0;
  overflow: hidden;
  border-radius: 9999px;
  background: color-mix(in srgb, currentColor 16%, transparent);
}
.progression-fill {
  position: absolute;
  inset-block: 0;
  left: 0;
  border-radius: 9999px;
  background: currentColor;
  transition: width 500ms cubic-bezier(0.4, 0, 0.2, 1);
}
.progression-fill[data-active='true']::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent, color-mix(in srgb, currentColor 55%, white 45%), transparent);
  animation: progression-sheen 1.5s ease-in-out infinite;
}
.progression-label {
  font-size: 0.62rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  opacity: 0.75;
}
@keyframes progression-sheen {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(220%);
  }
}
@media (prefers-reduced-motion: reduce) {
  .progression-fill {
    transition: none;
  }
  .progression-fill[data-active='true']::after {
    display: none;
  }
}

/* Sticks below the site header (Navbar is `sticky top-0`, z-40, 48px tall) as the board
   scrolls — `sticky`, not `fixed`: it stays in normal document flow and reserves its own
   height automatically (no manual spacer to keep in sync, and no risk of the two headers
   fighting over the same top-0 band — see `top` in bannerStyle above, which offsets this
   banner to start exactly where the Navbar ends). z-30 — strictly under the Navbar's z-40,
   as a second line of defense if the top offsets above ever drift out of sync — while
   staying above ordinary board content as it scrolls past underneath. Comfortably under
   the full-screen ItemEditor/ShareDialog overlays (z-50) too, though `!editingItem &&
   !shareOpen` above already removes it from the page entirely while either is open, rather
   than relying on stacking alone. */
.edit-banner {
  position: sticky;
  z-index: 30;
  box-shadow: 0 8px 20px -12px rgb(0 0 0 / 0.3);
}

/* Fix #5: quiet by design — a muted surface (not the loud brand fill the edit banner
   uses) with just a subtle brand-tinted border, so it reads as a low-key affordance
   rather than a warning. */
.unpublished-pill {
  background: var(--color-surface-subtle-default);
  color: var(--color-text-subtle-default);
  border-color: color-mix(in srgb, var(--color-accent-brand-default) 30%, transparent);
}
.unpublished-pill:hover {
  color: var(--color-text-primary-default);
  border-color: color-mix(in srgb, var(--color-accent-brand-default) 50%, transparent);
}

/* U6 (R7): a durability warning is more serious than the muted unpublished-pill, but still a
   quiet corner chip, not a modal or a competing top banner (R16) — a tinted-error surface
   says "pay attention" without shouting. */
.persist-failed-notice {
  background: color-mix(in srgb, var(--color-feedback-error-surface-primary-default) 12%, var(--color-surface-primary-default));
  color: var(--color-feedback-error-surface-primary-default);
  border-color: color-mix(in srgb, var(--color-feedback-error-surface-primary-default) 35%, transparent);
}

/* U9 (R10): same quiet treatment as .unpublished-pill — informational, not alarming. */
.cross-tab-notice {
  background: var(--color-surface-subtle-default);
  color: var(--color-text-subtle-default);
  border-color: color-mix(in srgb, var(--color-accent-brand-default) 30%, transparent);
}

/* Cloak-then-reveal. The whole island fades in as one (never showing the unfiltered
   SSR default), while the masthead and lanes rise with a small stagger for an
   editorial cascade. `data-ready` flips true once onMounted has resolved the URL view.
   Timing/easing match the site-wide `.page-reveal` (see global.css) so this reads as the
   SAME reveal as every other page, not a second, different-feeling animation — deliberately
   NOT stacked with `.page-reveal` on the wrapping <main> (that would double-animate and
   flash an empty shell before the board itself faded in); this is the board's one and only
   reveal. `ready` flips as soon as onMounted resolves the URL (before any network round
   trip), so there's no blank gap on a client-side nav to the board — just this one quick,
   coherent fade. */
.board-root {
  opacity: 0;
  transition: opacity 200ms cubic-bezier(0.23, 1, 0.32, 1);
}
.board-root[data-ready='true'] {
  opacity: 1;
}
.board-root .reveal {
  transform: translateY(8px);
  transition: transform 220ms cubic-bezier(0.23, 1, 0.32, 1);
  transition-delay: calc(var(--i, 0) * 50ms);
}
.board-root[data-ready='true'] .reveal {
  transform: none;
}
@media (prefers-reduced-motion: reduce) {
  .board-root {
    transition: opacity 160ms linear;
  }
  .board-root .reveal {
    transform: none;
    transition: none;
  }
}

/* Serif accent in the presentation hero, echoing the ST brand guidelines. */
.present-serif {
  font-family: 'Source Serif Pro', Georgia, 'Times New Roman', serif;
  font-style: italic;
  font-weight: 400;
  letter-spacing: 0;
}

.sheet-enter-active,
.sheet-leave-active {
  transition: opacity 0.2s ease;
}
.sheet-enter-active .sheet-panel,
.sheet-leave-active .sheet-panel {
  transition: transform 0.25s ease;
}
.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}
.sheet-enter-from .sheet-panel,
.sheet-leave-to .sheet-panel {
  transform: translateX(-100%);
}
@media (prefers-reduced-motion: reduce) {
  .sheet-enter-active,
  .sheet-leave-active,
  .sheet-enter-active .sheet-panel,
  .sheet-leave-active .sheet-panel {
    transition: none;
  }
}

/* Fix #10: a quiet, quick entrance for the corner sync toast — a plain `v-if` (not a
   <Transition>, which would delay its removal in tests behind a leave hook) animated in
   with a pure-CSS keyframe instead: well under 200ms, opacity/transform only
   (compositor-friendly, no layout-affecting properties). No exit animation — it's removed
   instantly on dismiss/auto-dismiss, same as every other quiet affordance on this board. */
.toast {
  animation: toast-in 160ms ease both;
}
@keyframes toast-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .toast {
    animation: none;
  }
}

/* Fix #9: same reasoning as the toast above — a plain `v-if`, with the entrance carried by
   a pure-CSS keyframe on the dialog panel rather than a <Transition>. */
.shortcuts-panel {
  animation: shortcuts-in 160ms ease both;
}
@keyframes shortcuts-in {
  from {
    opacity: 0;
    transform: translateY(6px) scale(0.98);
  }
}
@media (prefers-reduced-motion: reduce) {
  .shortcuts-panel {
    animation: none;
  }
}

/* Toolbar-stability fix: the edit action bar (New with AI / New item) slides in BELOW the
   main toolbar row when edit mode turns on — the row above never moves. Same reasoning as
   the toast/cheat-sheet above: a plain v-if with a pure-CSS entrance, not a <Transition>
   (which would delay removal behind a leave hook in tests). Opacity/transform only. */
.edit-action-bar {
  animation: edit-action-bar-in 160ms ease both;
}
@keyframes edit-action-bar-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .edit-action-bar {
    animation: none;
  }
}
</style>
