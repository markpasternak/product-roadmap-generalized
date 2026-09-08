<script setup lang="ts">
// U6: presentation-only piece of Board.vue's live presence UI (R11-R13) — the
// "N viewing" pill + avatar row, and the advisory "X is also editing" nudge.
// Board.vue owns the usePresence() wiring and the editMode watcher; this
// component just renders from the reactive values it's handed.
//
// Two independent pieces live in this one file because they render in two
// different places in Board.vue's layout (the pill inline in the toolbar, the
// nudge as a full-width line below it) — each usage passes only the props its
// piece needs, and the other piece's v-if simply stays false.
import { computed } from 'vue';
import Avatar from '../ui/Avatar.vue';
import type { RealtimeUser } from '../../lib/share/canvasdrop';

const props = withDefaults(
  defineProps<{
    /** Everyone currently viewing (from usePresence().viewers). Drives the pill. */
    viewers?: RealtimeUser[];
    selfId?: string;
    /** Whether the realtime backend is available — gates the pill (R14). */
    realtimeAvailable?: boolean;
    /** Other clients currently in edit mode (from usePresence().othersEditing). Drives the nudge. */
    othersEditing?: RealtimeUser[];
    /** Whether this client is a signed-in editor currently in edit mode — gates the nudge. */
    canEdit?: boolean;
    editMode?: boolean;
    /** Presentation mode (?present=1) hides the nudge along with the rest of the board chrome. */
    present?: boolean;
  }>(),
  {
    viewers: () => [],
    realtimeAvailable: false,
    othersEditing: () => [],
    canEdit: false,
    editMode: false,
    present: false,
  },
);

// Joins up to `max` names for a concise tooltip/label, appending "+N more"
// beyond that cap instead of listing every viewer/editor (mirrors Board.vue's capList).
function capList(names: string[], max = 3): string {
  const shown = names.slice(0, max);
  const extra = names.length - shown.length;
  return extra > 0 ? `${shown.join(', ')} +${extra} more` : shown.join(', ');
}

// Names for the "N viewing" indicator's tooltip — capList (above) caps the list
// and appends "+N more" so a large team never blows out the title attribute.
function viewerNames(): string[] {
  return otherViewers.value.map((v) => v.name || 'Viewer');
}

// A soft, advisory nudge — never used for locking/merge (R13/scope boundary).
const othersEditingLabel = computed(() => {
  const names = props.othersEditing.map((u) => u.name || 'Someone');
  if (!names.length) return '';
  const verb = names.length === 1 ? 'is' : 'are';
  return `${capList(names)} ${verb} also editing`;
});

const otherViewers = computed(() => props.selfId ? props.viewers.filter(v => v.id !== props.selfId) : []);
const showPill = computed(() => props.realtimeAvailable && otherViewers.value.length > 0);
const showNudge = computed(() => props.canEdit && props.editMode && !props.present && !!othersEditingLabel.value);
</script>

<template>
  <!-- R11: live presence — "N viewing" + avatars, visible to ALL viewers (not
       canEdit-gated), gated only by realtimeAvailable (R14). Mobile collapses the
       avatar row to just the count (see max-sm:hidden below). -->
  <div
    v-if="showPill"
    class="inline-flex shrink-0 items-center px-1"
    data-test="presence-indicator"
    :title="`${capList(viewerNames())} also viewing`"
  >
    <div class="flex -space-x-2">
      <Avatar
        v-for="v in otherViewers.slice(0, 5)"
        :key="v.id"
        :name="v.name || 'Viewer'"
        :size="22"
        class="ring-2 ring-card"
      />
    </div>
    <span class="sr-only">{{ otherViewers.length }} others viewing</span>
  </div>

  <!-- R13: a soft, advisory-only "also editing" nudge — never a lock/merge signal,
       just a heads-up that another editor is in the same edit mode right now. -->
  <p
    v-if="showNudge"
    class="text-single-sm-medium text-accent-brand-default chrome-reveal -mt-2 mb-3"
    data-test="also-editing"
  >
    {{ othersEditingLabel }} — you may want to coordinate to avoid overlapping changes.
  </p>
</template>
