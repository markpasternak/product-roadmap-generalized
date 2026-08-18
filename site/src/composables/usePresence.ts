// Live viewer presence on a canvas-drop realtime channel (R11-R13). Every
// viewer (not just editors — KTD8's "generic Viewer" fallback is only needed
// when `name` is empty, since the roadmap board is team-gated and canvas-drop's
// server-derived {id, name} presence is trustworthy for every session) joins
// the channel on mount; a throttled heartbeat keeps the join alive on real
// activity; ~10 minutes of no activity leaves the channel (R12); an advisory
// "also editing" signal rides the same channel (R13). A no-op — empty
// `viewers`/`othersEditing`, nothing published, no listeners attached — when
// the realtime Backend accessor isn't present at mount (R14).
import { ref, onMounted, onUnmounted, type Ref } from 'vue';
import { getCanvasdrop, type RealtimeChannel, type RealtimeUser } from '../lib/share/canvasdrop';

// R12: idle-out after this long without real user activity.
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;
// Heartbeat cadence: comfortably under canvas-drop's 100 msg/min channel cap
// even with several tabs/users active at once.
const HEARTBEAT_THROTTLE_MS = 25_000;
// A representative slice of "the user is actually here" events — deliberately
// not exhaustive (no mousedown/pointermove/focus etc.) since these five already
// fire on virtually every real interaction with the board.
const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'] as const;

export interface UsePresenceApi {
  /** Everyone currently present on the channel (this client included, per
   * canvas-drop's own presence semantics). Empty when realtime isn't available. */
  viewers: Ref<RealtimeUser[]>;
  /** Other clients currently publishing `editing: true` on the same channel.
   * Advisory only — never used for locking/merge (R13). */
  othersEditing: Ref<RealtimeUser[]>;
  /** Publishes this client's own edit-mode state so other clients' `othersEditing`
   * reflects it. Board.vue wires its `editMode` ref/watcher into this. */
  setEditing: (on: boolean) => void;
  /** Leaves the channel and tears down all listeners/timers. Called
   * automatically on unmount — exposed too for tests and explicit teardown. */
  close: () => void;
}

/** Live presence on `realtime.channel(channelName)`. */
export function usePresence(channelName = 'roadmap'): UsePresenceApi {
  const viewers = ref<RealtimeUser[]>([]);
  const othersEditing = ref<RealtimeUser[]>([]);

  let channel: RealtimeChannel | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let lastPing = 0;
  // This client's own last-published editing intent — replayed on (re)join so a
  // rejoin after an idle-out doesn't silently drop an in-progress "also editing".
  let selfEditing = false;
  // This client's own id (from canvas-drop's `me()`), so a self-published `editing`
  // message never shows up in `othersEditing` — unlike `viewers`, which intentionally
  // includes this client (it drives the "N viewing" count), "also editing" only ever
  // means SOMEONE ELSE. Resolved async on join; best-effort — a self-publish that lands
  // before it resolves is the same "no worse than before" gap this replaces.
  let selfId: string | null = null;
  // Other clients currently editing, keyed by id, so a duplicate publish/leave
  // never double-counts — recomputed into `othersEditing` on every change.
  const editingUsers = new Map<string, RealtimeUser>();

  function clearIdleTimer() {
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function scheduleIdleTimeout() {
    clearIdleTimer();
    idleTimer = setTimeout(leave, IDLE_TIMEOUT_MS);
  }

  function join() {
    if (channel) return; // already joined
    const cd = getCanvasdrop();
    const rt = cd?.realtime;
    if (!rt) return;
    if (cd?.me) {
      cd.me()
        .then((me) => {
          selfId = me.id;
        })
        .catch(() => {
          /* no identity available — self-filtering just no-ops, same as before */
        });
    }
    channel = rt.channel(channelName);
    channel
      .presence()
      .then((users) => {
        viewers.value = users;
      })
      .catch(() => {
        /* best-effort initial snapshot — onJoin/onPresence keep it live regardless */
      });
    channel.onPresence((users) => {
      viewers.value = users;
    });
    channel.onJoin((u) => {
      if (!viewers.value.some((v) => v.id === u.id)) viewers.value = [...viewers.value, u];
    });
    channel.onLeave((u) => {
      viewers.value = viewers.value.filter((v) => v.id !== u.id);
      if (editingUsers.delete(u.id)) othersEditing.value = Array.from(editingUsers.values());
    });
    channel.subscribe((m) => {
      if (m.event !== 'editing') return;
      if (m.from.id === selfId) return; // never echo this client's own editing state back
      const on = !!(m.data as { editing?: boolean } | null)?.editing;
      if (on) editingUsers.set(m.from.id, m.from);
      else editingUsers.delete(m.from.id);
      othersEditing.value = Array.from(editingUsers.values());
    });
    if (selfEditing) channel.publish('editing', { editing: true });
    scheduleIdleTimeout();
  }

  function leave() {
    clearIdleTimer();
    if (channel) {
      channel.close();
      channel = null;
    }
    viewers.value = [];
    othersEditing.value = [];
    editingUsers.clear();
    selfId = null; // re-resolved on the next join
  }

  /** Real user activity: always resets the idle clock; the heartbeat publish
   * itself (or a rejoin, if idled out) is throttled. */
  function registerActivity() {
    if (!getCanvasdrop()?.realtime) return;
    if (!channel) {
      join(); // idled out (or never joined) — activity rejoins
      return;
    }
    scheduleIdleTimeout();
    const now = Date.now();
    if (now - lastPing < HEARTBEAT_THROTTLE_MS) return;
    lastPing = now;
    channel.publish('ping', {});
  }

  function handleActivity() {
    registerActivity();
  }

  function setEditing(on: boolean) {
    selfEditing = on;
    channel?.publish('editing', { editing: on });
  }

  onMounted(() => {
    if (!getCanvasdrop()?.realtime) return; // R14: no-op when realtime isn't available
    join();
    for (const evt of ACTIVITY_EVENTS) {
      document.addEventListener(evt, handleActivity, { passive: true });
    }
  });

  onUnmounted(() => {
    for (const evt of ACTIVITY_EVENTS) {
      document.removeEventListener(evt, handleActivity);
    }
    leave();
  });

  return { viewers, othersEditing, setEditing, close: leave };
}
