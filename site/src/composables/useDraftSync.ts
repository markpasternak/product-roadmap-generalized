import { computed, onUnmounted, ref, watch } from "vue";
import type { Draft, createEditStore } from "../lib/edit/store";
import { authedRequest } from "../lib/edit/client";

type Store = ReturnType<typeof createEditStore>;
type RemoteDraft = { revision: number; data: Draft | null; updatedAt?: string };
export type DraftSaveState =
  "loading" | "saving" | "saved" | "local" | "conflict";
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/** Merge independent keys; arrays and text are atomic. Never choose a winner for
 * overlapping edits. Both complete versions remain available to the author. */
export function mergeDraftData(
  base: any,
  mine: any,
  theirs: any,
): { value: any; conflicts: string[] } {
  const conflicts: string[] = [];
  function merge(b: any, m: any, t: any, path: string): any {
    if (same(m, t) || same(t, b)) return m;
    if (same(m, b)) return t;
    if (
      [b, m, t].every(
        (v) => v == null || (typeof v === "object" && !Array.isArray(v)),
      )
    ) {
      const result: Record<string, any> = {};
      for (const key of new Set([
        ...Object.keys(b ?? {}),
        ...Object.keys(m ?? {}),
        ...Object.keys(t ?? {}),
      ])) {
        const value = merge(
          b?.[key],
          m?.[key],
          t?.[key],
          path ? `${path}.${key}` : key,
        );
        if (value !== undefined) result[key] = value;
      }
      return result;
    }
    conflicts.push(path);
    return m;
  }
  return { value: merge(base, mine, theirs, ""), conflicts };
}

export function useDraftSync(store: Store) {
  const state = ref<DraftSaveState>("loading");
  const savedAt = ref("");
  const authExpired = ref(false);
  const conflict = ref<{ remote: RemoteDraft; fields: string[] } | null>(null);
  let active = false,
    stopped = false,
    sending = false,
    serverRevision = 0;
  let acknowledged: Draft | null = null,
    timer: ReturnType<typeof setTimeout> | undefined;
  let syncKey = "",
    suppress = false;
  // No account draft exists once all work has been published or discarded.
  // Keep publication receipts until the live build is confirmed.
  const accountSnapshot = (): Draft | null => {
    const data = store.snapshot();
    return store.dirtyCount.value || data.committedSha || data.requestPayload ? data : null;
  };
  const detail = computed(() =>
    store.persistFailed.value
      ? state.value === "saved"
        ? "Private draft saved · device backup unavailable"
        : "This device cannot save changes. Keep this page open until your draft is saved."
      : state.value === "saved"
        ? "Private draft saved"
        : state.value === "saving"
          ? "Saving your draft…"
          : state.value === "conflict"
            ? "This draft was also changed elsewhere. Both versions are kept."
            : state.value === "loading"
              ? "Connecting your draft…"
              : authExpired.value
                ? "Saved on this device · sign in with GitHub to resume account saving"
                : "Saved on this device · waiting to save to your account",
  );
  const remember = () => {
    try {
      localStorage.setItem(
        syncKey,
        JSON.stringify({ revision: serverRevision, data: acknowledged }),
      );
    } catch {
      /* working copy has its own durability signal */
    }
  };
  function adopt(data: Draft | null) {
    suppress = true;
    store.restore(data ?? {});
    suppress = false;
  }
  function schedule(delay = 700) {
    if (!active || stopped || conflict.value) return;
    clearTimeout(timer);
    if (authExpired.value) {
      state.value = "local";
      return;
    }
    if (!sending && same(accountSnapshot(), acknowledged)) {
      state.value = "saved";
      return;
    }
    state.value = "saving";
    timer = setTimeout(() => void flush(), delay);
  }
  async function flush() {
    if (!active || stopped || sending || conflict.value || authExpired.value) return;
    if (same(accountSnapshot(), acknowledged)) {
      state.value = "saved";
      return;
    }
    sending = true;
    const sent = accountSnapshot();
    try {
      const res = await authedRequest("/api/draft", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: serverRevision, data: sent }),
      });
      if (stopped) return;
      authExpired.value = res.status === 401 || res.status === 403;
      const remote = (await res.json()) as RemoteDraft;
      if (res.status === 409) {
        const merged = mergeDraftData(
          acknowledged,
          accountSnapshot(),
          remote.data,
        );
        if (merged.conflicts.length) {
          conflict.value = { remote, fields: merged.conflicts };
          state.value = "conflict";
        } else {
          serverRevision = remote.revision;
          acknowledged = remote.data;
          adopt(merged.value);
          remember();
          schedule(0);
        }
      } else if (!res.ok) {
        state.value = "local";
        scheduleRetry();
      } else {
        serverRevision = remote.revision;
        acknowledged = sent;
        savedAt.value = remote.updatedAt ?? "";
        remember();
        state.value = same(accountSnapshot(), sent) ? "saved" : "saving";
      }
    } catch {
      state.value = "local";
      scheduleRetry();
    } finally {
      sending = false;
      if (!stopped && state.value === "saving") schedule();
    }
  }
  function scheduleRetry() {
    clearTimeout(timer);
    if (authExpired.value) return;
    timer = setTimeout(() => {
      if (!stopped && !document.hidden) void reconnect();
      else if (!stopped) scheduleRetry();
    }, 15000);
  }
  async function reconnect() {
    if (!active || stopped || sending || conflict.value) return;
    sending = true;
    try {
      const res = await authedRequest("/api/draft");
      if (stopped) return;
      authExpired.value = res.status === 401 || res.status === 403;
      if (!res.ok) throw new Error("draft unavailable");
      const remote = (await res.json()) as RemoteDraft;
      if (remote.revision !== serverRevision) {
        const merged = mergeDraftData(
          acknowledged,
          accountSnapshot(),
          remote.data,
        );
        if (merged.conflicts.length) {
          conflict.value = { remote, fields: merged.conflicts };
          state.value = "conflict";
          return;
        }
        adopt(merged.value);
      }
      serverRevision = remote.revision;
      acknowledged = remote.data;
      remember();
      schedule(0);
    } catch {
      state.value = "local";
      scheduleRetry();
    } finally {
      sending = false;
      if (state.value === "saving" && same(accountSnapshot(), acknowledged)) {
        clearTimeout(timer);
        state.value = "saved";
      }
    }
  }
  async function start(_login: string) {
    syncKey = `${store.recoveryKey()}:account-ack`;
    try {
      const saved = JSON.parse(localStorage.getItem(syncKey) ?? "null");
      if (saved) {
        serverRevision = saved.revision;
        acknowledged = saved.data;
      }
    } catch {
      /* recover through the service */
    }
    active = true;
    sending = true;
    try {
      const res = await authedRequest("/api/draft");
      if (stopped) return;
      authExpired.value = res.status === 401 || res.status === 403;
      if (!res.ok) throw new Error("unavailable");
      const remote = (await res.json()) as RemoteDraft;
      if (
        remote.data &&
        !acknowledged &&
        !store.snapshot().committedSha &&
        store.dirtyCount.value === 0 &&
        !store.snapshot().requestPayload
      )
        adopt(remote.data);
      else if (
        remote.revision !== serverRevision &&
        !same(accountSnapshot(), remote.data)
      ) {
        const merged = mergeDraftData(
          acknowledged,
          accountSnapshot(),
          remote.data,
        );
        if (merged.conflicts.length) {
          conflict.value = { remote, fields: merged.conflicts };
          state.value = "conflict";
          return;
        }
        adopt(merged.value);
      }
      serverRevision = remote.revision;
      acknowledged = remote.data;
      remember();
      schedule(0);
    } catch {
      state.value = "local";
      scheduleRetry();
    } finally {
      sending = false;
      if (state.value === "saving" && same(accountSnapshot(), acknowledged)) {
        clearTimeout(timer);
        state.value = "saved";
      }
    }
  }
  function resolve(keepLocal: boolean) {
    const remote = conflict.value?.remote;
    if (!remote) return;
    // Keep an explicit recovery copy before the author's resolution.
    try {
      localStorage.setItem(
        `${syncKey}:recovery:${Date.now()}`,
        JSON.stringify({ local: store.snapshot(), remote }),
      );
    } catch {
      /* the server still has the remote draft */
    }
    if (!keepLocal) adopt(remote.data);
    serverRevision = remote.revision;
    acknowledged = remote.data;
    conflict.value = null;
    remember();
    schedule(0);
  }
  watch(
    store.revision,
    () => {
      if (!suppress) schedule();
    },
    { flush: "sync" },
  );
  const online = () => void reconnect();
  const visible = () => {
    if (!document.hidden) void reconnect();
  };
  if (typeof window !== "undefined") {
    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", visible);
  }
  onUnmounted(() => {
    stopped = true;
    clearTimeout(timer);
    window.removeEventListener("online", online);
    document.removeEventListener("visibilitychange", visible);
  });
  return { state, detail, savedAt, authExpired, conflict, start, flush, resolve, reconnect };
}
