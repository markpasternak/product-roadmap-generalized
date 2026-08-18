<script setup lang="ts">
// R2/KTD4: a compact "recent changes" peek, built from the edit-service's
// commit history (see `../../lib/activity.ts`). Degrades to rendering
// nothing at all — no empty box, no error — when the feed is empty or the
// endpoint/token isn't available (R14), e.g. signed out or local dev without
// the edit-service running.
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { PhArrowSquareOut, PhClockCounterClockwise, PhCaretDown } from '@phosphor-icons/vue';
import { countsSummary, fetchActivity, formatRelativeTime, resolveTitles, type ParsedActivity } from '../../lib/activity';
import { formatDateTime, isoDateTime } from '../../lib/dates';

const props = withDefaults(
  defineProps<{
    items: { id: string; title: string }[];
    /** Base path (e.g. `/roadmap/`), matching Board.vue's `props.base`. */
    base?: string;
    /** Caps the number of rows shown (the peek). Omit to show everything fetched (the full page). */
    limit?: number;
    /** Whether to show the "View all →" link (hidden on the /changes page itself). */
    showSeeAll?: boolean;
  }>(),
  { base: '/', showSeeAll: true },
);

const entries = ref<ParsedActivity[]>([]);

const byId = computed(() => new Map(props.items.map((i) => [i.id, { title: i.title }])));
const visible = computed(() => (props.limit != null ? entries.value.slice(0, props.limit) : entries.value));

// Collapse/expand — only offered on the board *peek* (a capped `limit`), not on
// the full /changes page where the list is the whole point. The open/collapsed
// choice is persisted to localStorage so it sticks across reloads and SPA nav.
const COLLAPSE_KEY = 'rm-recent-changes-collapsed';
const isPeek = computed(() => props.limit != null);
const collapsed = ref(false);

function toggleCollapsed() {
  collapsed.value = !collapsed.value;
  // Persist best-effort; a quota/private-mode throw must not break the toggle.
  try {
    localStorage.setItem(COLLAPSE_KEY, collapsed.value ? '1' : '0');
  } catch {
    /* ignore — the toggle still works for this session */
  }
}

// Guards the async fetch below against writing into a torn-down instance: if
// the component unmounts (e.g. `present` toggling this out of the tree) before
// fetchActivity() resolves, the resolved entries are simply dropped.
let isMounted = true;
onUnmounted(() => {
  isMounted = false;
});

onMounted(async () => {
  // Restore the persisted collapsed state on the client (SSR renders expanded,
  // so hydration matches; this adjusts right after mount, under the panel's
  // page-reveal fade). Peek-only, and guarded for the no-localStorage case.
  if (isPeek.value && typeof localStorage !== 'undefined') {
    collapsed.value = localStorage.getItem(COLLAPSE_KEY) === '1';
  }
  const activity = await fetchActivity();
  if (isMounted) entries.value = activity;
});

/** "who" label for a row — the human editor from `(via <login>)`, or a
 * generic label for a manual (non-Sync) commit. */
function who(e: ParsedActivity): string {
  return e.isManual ? 'Manual edit' : `via ${e.login}`;
}

/** "what" label for a row — counts + resolved titles for a Sync commit
 * (falling back to the counts alone if every changed item got deleted from
 * the list), or the raw commit subject for a manual commit. */
function what(e: ParsedActivity): string {
  if (e.isManual) return e.subject;
  const counts = countsSummary(e);
  const titles = resolveTitles(e.changedIds, byId.value);
  const overflow = e.changedOverflow > 0 ? [`+${e.changedOverflow} more`] : [];
  const named = [...titles, ...overflow].join(', ');
  return named ? `${counts} — ${named}` : counts || e.subject;
}
</script>

<template>
  <section
    v-if="visible.length"
    class="recent-changes roadmap-panel page-reveal rounded-2xl px-4 py-3.5 sm:px-5 sm:py-4"
    aria-label="Recent changes"
  >
    <header class="flex items-center justify-between gap-3">
      <h2 class="font-display roadmap-title flex min-w-0 items-center gap-2 text-[1.1rem] leading-none">
        <span class="h-5 w-1 shrink-0 rounded-full" style="background: var(--color-accent-brand-default)" />
        <PhClockCounterClockwise :size="18" class="shrink-0" style="color: var(--color-accent-brand-default)" />
        Recent changes
        <span
          v-if="isPeek && collapsed"
          class="text-single-sm-medium text-text-subtle-default font-normal"
          data-test="recent-changes-count"
          >· {{ visible.length }}</span
        >
      </h2>
      <div class="flex shrink-0 items-center gap-3">
        <a
          v-if="showSeeAll"
          :href="base + 'changes'"
          class="text-single-sm-medium text-text-primary-default shrink-0 underline decoration-border-subtle-default underline-offset-4 hover:decoration-current"
          data-test="recent-changes-view-all"
        >
          View all →
        </a>
        <button
          v-if="isPeek"
          type="button"
          class="text-text-subtle-default hover:text-text-primary-default -mr-1 inline-flex shrink-0 items-center rounded-md p-1 transition-transform"
          :class="{ 'rotate-180': !collapsed }"
          :aria-expanded="!collapsed"
          aria-controls="recent-changes-list"
          :aria-label="collapsed ? 'Expand recent changes' : 'Collapse recent changes'"
          :title="collapsed ? 'Expand' : 'Collapse'"
          data-test="recent-changes-toggle"
          @click="toggleCollapsed"
        >
          <PhCaretDown :size="16" />
        </button>
      </div>
    </header>
    <ul v-show="!collapsed" id="recent-changes-list" class="mt-3 flex flex-col gap-2.5">
      <li
        v-for="e in visible"
        :key="e.sha"
        class="flex flex-col gap-0.5 border-t border-border-subtle-default/70 pt-2.5 first:border-t-0 first:pt-0 sm:flex-row sm:items-baseline sm:gap-2"
        data-test="recent-change-row"
      >
        <span class="text-single-sm-medium text-text-primary-default font-semibold sm:shrink-0">{{ who(e) }}</span>
        <span class="text-single-sm-medium text-text-subtle-default min-w-0 flex-1 break-words">{{ what(e) }}</span>
        <span class="flex shrink-0 items-center gap-2 sm:ml-2">
          <time
            class="text-single-sm-medium text-text-subtle-default whitespace-nowrap"
            :datetime="isoDateTime(e.date)"
            :title="formatDateTime(e.date)"
          >{{ formatRelativeTime(e.date) }}</time>
          <a
            :href="e.htmlUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="text-text-subtle-default hover:text-text-primary-default inline-flex items-center"
            aria-label="View commit on GitHub"
            title="View commit on GitHub"
          >
            <PhArrowSquareOut :size="15" />
          </a>
        </span>
      </li>
    </ul>
  </section>
</template>
