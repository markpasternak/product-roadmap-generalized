// Local, id-keyed changeset store for in-app editing. Persists to localStorage on every
// mutation so a crash/reload never loses in-progress edits, and survives a rebuilt base
// (see design spec: "Edit → Sync → rebuild → keep editing").
import { ref, computed } from 'vue';

export const KEY = 'rm-edit-draft';
type Draft = {
  fields: Record<string, Record<string, string>>;
  bodies: Record<string, string>;
  created: { id: string; product: string; title: string; frontmatter?: Record<string, string> }[];
  deleted: string[];
  reorder: Record<string, Record<string, string[]>>;
  // U3 (R3/KTD3): the crypto-random id for the in-flight (or last-unresolved) Sync attempt.
  // Persisted BEFORE the request is sent (see ensureRequestId below) so a crash between
  // persist and send still reuses it on the next attempt instead of minting a fresh one the
  // server would then treat as a distinct request. `requestIdSnapshot` is the JSON of the
  // changeset (sans baseSha/requestId) the id was minted for — reuse only applies while a
  // retry sends that exact same content; a genuinely-changed changeset (new edits since the
  // failed attempt) must never reuse an id the server may have already cached a stale result
  // under. `requestIdAt` bounds reuse to ~the server's dedup-cache TTL (KTD3).
  requestId: string | null;
  requestIdSnapshot: string | null;
  requestIdAt: number | null;
  // U4 (R5/KTD4): the sha of the last commit this client successfully synced, and the exact
  // (no-baseSha/no-requestId) changeset snapshot that was sent for it — persisted so a reload
  // during the build window can tell "nothing edited since that sync" from "edited again
  // since," the same distinction `syncedJson` makes in-memory in Board.vue. Without the
  // snapshot surviving a reload too, a resumed "awaiting build" state would have no baseline
  // to compare the current draft against and could show a phantom "unsynced" the moment
  // dirtyCount is still >0 (which it legitimately is until the rebuild lands and reconcile
  // drops the now-landed ops) — exactly the bug R5 exists to prevent. Cleared once the build
  // is confirmed `live` (see Board's applyDeployRun); left in place through building/failed/
  // superseded/no-build so a reload keeps resuming that same state until it resolves.
  committedSha: string | null;
  committedSnapshot: string | null;
  // When that commit was recorded — so a reload can tell a genuinely in-flight build (resume
  // the "Building…" banner) from a stale sha left behind by a past session whose deploy has
  // long since gone live (the poll never got to clear it before the tab closed). Without this,
  // a stale committedSha resurrects a permanent "Publishing…" on load even though everything
  // is already live. See Board's onMounted resume, which drops a commit older than the window.
  committedAt: number | null;
};
const empty = (): Draft => ({
  fields: {},
  bodies: {},
  created: [],
  deleted: [],
  reorder: {},
  requestId: null,
  requestIdSnapshot: null,
  requestIdAt: null,
  committedSha: null,
  committedSnapshot: null,
  committedAt: null,
});
// KTD3: bound client-side requestId reuse to ~the server's in-memory dedup-cache TTL (~10
// min) — past it the server may have already evicted the cached result (or restarted), so a
// fresh id is minted rather than silently relying on a reuse window the server no longer
// honors. (The repo-reconcile-before-commit safety net on the server covers a TTL-miss safely
// either way — this is a client-side tuning bound, not the correctness guarantee.)
const REQUEST_ID_TTL_MS = 10 * 60 * 1000;

// crypto-random per KTD3 — NOT Math.random. Prefers the standard randomUUID(); falls back to
// hex-encoding raw CSPRNG bytes for older runtimes that expose getRandomValues but not
// randomUUID (both are widely available in browsers and modern Node).
function randomRequestId(): string {
  const c: Crypto | undefined = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c?.randomUUID) return c.randomUUID();
  if (c?.getRandomValues) {
    const bytes = c.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  throw new Error('no crypto RNG available');
}

export function createEditStore() {
  const load = (): Draft => {
    try {
      return { ...empty(), ...JSON.parse(localStorage.getItem(KEY) || '{}') };
    } catch {
      return empty();
    }
  };
  const d = ref<Draft>(load());
  // U6 (R7): localStorage.setItem can throw — quota exceeded, disabled storage, or Safari
  // private-mode's zero-quota jar all throw a DOMException on write. Uncaught, that would
  // blow up every mutation method below (setField/setBody/etc.) right as it's called from a
  // template event handler, and the local edit would be silently lost with it. Catch it, flag
  // `persistFailed` so Board can surface "can't be saved on this device," and — crucially —
  // do NOT rethrow: the mutation itself already happened on `d.value` before persist() was
  // called, so the edit is still readable in-session even though it isn't durable. Clears the
  // moment a later persist actually succeeds (e.g. the user frees up space, or a subsequent
  // write happens to fit).
  const persistFailed = ref(false);
  const persist = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(d.value));
      persistFailed.value = false;
    } catch {
      persistFailed.value = true;
    }
  };

  // U9 (R10): a quiet, dismissible flag — distinct from the silent last-write-wins replace
  // below — that tells Board "another tab just changed what you're looking at," so it can
  // show a non-modal notice rather than letting the draft change out from under the user with
  // zero signal. Only set on a REAL replace (see the no-op guard below) — an identical-draft
  // event (e.g. this tab's own write bouncing back via a shared-worker quirk, or another tab
  // saving the exact same content) must not flag, or the notice would fire constantly.
  const crossTabChanged = ref(false);
  const dismissCrossTabChanged = () => {
    crossTabChanged.value = false;
  };

  // Keep tabs in sync: `d` is only ever loaded once, at page load, so a second open tab
  // writing to the shared localStorage draft would otherwise go unnoticed here until this
  // tab happens to reload — the two tabs would silently diverge and the last one to persist()
  // would clobber the other's edits. `storage` only fires in *other* tabs/windows for the
  // same origin (never in the tab that made the write), so this can't loop off our own
  // persist() calls. Last-write-wins across tabs, but at least both tabs stay consistent
  // instead of silently drifting apart.
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e: StorageEvent) => {
      if (e.key !== KEY) return;
      const next = load();
      if (JSON.stringify(next) === JSON.stringify(d.value)) return; // no real change; skip
      d.value = next;
      crossTabChanged.value = true;
    });
  }

  const setField = (id: string, key: string, val: string) => {
    (d.value.fields[id] ||= {})[key] = val;
    persist();
  };
  const setBody = (id: string, body: string) => {
    d.value.bodies[id] = body;
    persist();
  };
  // Temp ids for locally-created items look like `new-<n>`. Derive the next `n` from the
  // max seen in `created` so ids stay unique across reloads of a persisted draft.
  const nextCreatedId = () => {
    const maxN = d.value.created.reduce((max, c) => {
      const m = /^new-(\d+)$/.exec(c.id);
      return m ? Math.max(max, Number(m[1])) : max;
    }, 0);
    return `new-${maxN + 1}`;
  };
  const createdIndex = (id: string) => d.value.created.findIndex((c) => c.id === id);

  const addItem = (product: string, title: string, frontmatter: Record<string, string> = {}): string => {
    const id = nextCreatedId();
    // Seed a large sentinel `order` so a freshly-created item sorts to the end of its lane by
    // default (the server's reorder renumbering still overrides this once synced/dragged).
    // Only applied when the caller didn't already pass an explicit order.
    const fm = { order: '9999', ...frontmatter };
    d.value.created.push({ id, product, title, frontmatter: fm });
    persist();
    return id;
  };
  const deleteItem = (id: string) => {
    const idx = createdIndex(id);
    if (idx !== -1) {
      // A locally-created item removed before sync never touches the server: drop it
      // entirely instead of adding it to `deleted`.
      d.value.created.splice(idx, 1);
      delete d.value.fields[id];
      delete d.value.bodies[id];
      persist();
      return;
    }
    if (!d.value.deleted.includes(id)) d.value.deleted.push(id);
    // A delete supersedes any pending edit on the same real item — otherwise the changeset
    // would send both an `updated` entry AND a `deletedId` for the same id.
    delete d.value.fields[id];
    delete d.value.bodies[id];
    persist();
  };
  const reorder = (product: string, horizon: string, orderedIds: string[]) => {
    (d.value.reorder[product] ||= {})[horizon] = orderedIds;
    persist();
  };
  const clear = () => {
    d.value = empty();
    // A full clear discards the draft entirely — any secondary notice tied to that now-gone
    // state (a persist failure on edits that no longer exist, a cross-tab replace of a draft
    // nobody's looking at anymore) has nothing left to refer to, so reset both here too rather
    // than leaving a stale chip on screen after a Discard.
    crossTabChanged.value = false;
    persist();
  };
  // Fix #5: revert a single pending field edit (not the whole item) — used by the
  // full-screen editor's per-field "reset to published" control. A no-op body/delete
  // edit on the same item is left untouched; only the one field key is dropped. If that
  // was the item's last pending field, drop the now-empty `fields[id]` entry entirely so
  // `isDirty`/`dirtyCount` (which key off `fields[id]` existing at all) don't keep
  // counting an item with nothing left pending on it.
  const revertField = (id: string, key: string) => {
    const rec = d.value.fields[id];
    if (!rec) return;
    delete rec[key];
    if (Object.keys(rec).length === 0) delete d.value.fields[id];
    persist();
  };
  const revertItem = (id: string) => {
    const idx = createdIndex(id);
    if (idx !== -1) {
      d.value.created.splice(idx, 1);
      delete d.value.fields[id];
      delete d.value.bodies[id];
      persist();
      return;
    }
    delete d.value.fields[id];
    delete d.value.bodies[id];
    d.value.deleted = d.value.deleted.filter((x) => x !== id);
    persist();
  };
  // Base ItemVM subset used to compare pending edits against what the freshly-rebuilt
  // site already reflects (see reconcile below).
  type BaseItem = {
    id: string;
    product?: string;
    title?: string;
    horizon?: string;
    stage?: string;
    owner?: string | null;
    impact?: string | null;
    effort?: string | null;
    visibility?: string;
    tags?: string[];
    order?: number;
  };
  // Normalize a scalar field for base-vs-pending comparison: stringify, treat null/undefined
  // as empty, trim. Lets an empty pending value match a missing/null base value.
  const normField = (v: unknown): string => String(v ?? '').trim();
  // Every scalar field the full-screen editor can set via setField (tags is handled
  // separately below). Keep this in lockstep with ItemEditor's field set — a field left out
  // here would never reconcile and would show as permanently "edited" even once the base
  // item's value catches up (e.g. a synced product move should clear the "edited" badge, not
  // leave it stuck forever).
  const SCALAR_FIELDS = new Set([
    'product',
    'title',
    'horizon',
    'stage',
    'owner',
    'impact',
    'effort',
    'visibility',
  ]);
  // Split a pending comma-separated tags string into a trimmed, non-empty, case-folded set.
  const tagSet = (csv: string): Set<string> =>
    new Set(
      csv
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean),
    );

  // Run after loading a freshly-rebuilt base (page load / Reload): drops draft ops the base
  // already reflects, so a synced-and-rebuilt item stops showing as locally dirty while
  // genuinely unsynced edits survive.
  //
  // `rawBodies` (optional) is an id-keyed map of the published raw markdown body, fetched
  // separately from the ItemVM base (which carries no body). Board can call `reconcile(items)`
  // on mount (no body knowledge yet) and `reconcile(items, rawBodies)` once it has fetched raw
  // bodies in edit mode, to additionally reconcile body edits.
  const reconcile = (items: BaseItem[], rawBodies?: Record<string, string> | Map<string, string>) => {
    const byId = new Map(items.map((it) => [it.id, it]));
    const bodyFor = (id: string): string | undefined =>
      rawBodies instanceof Map ? rawBodies.get(id) : rawBodies?.[id];

    // 1. Landed creates: a created entry whose (product, title) already exists in the base
    // has landed — drop it. An untitled create can never match (it must carry a real,
    // non-empty title to be considered "authored" and thus a plausible landed-create match).
    // Only one created entry is pruned per matching base item, so two intentional creates that
    // happen to share a title don't both get eaten by a single base match.
    // Residual limitation: a create whose title collides with a pre-existing (never-synced-by-
    // us) item can still be mistakenly pruned — accepted as rare.
    const claimedBaseIds = new Set<string>();
    for (const c of [...d.value.created]) {
      const title = d.value.fields[c.id]?.title ?? c.title;
      if (!title.trim()) continue;
      const match = items.find(
        (it) =>
          !claimedBaseIds.has(it.id) &&
          it.product === c.product &&
          normField(it.title).toLowerCase() === title.trim().toLowerCase(),
      );
      if (match) {
        claimedBaseIds.add(match.id);
        revertItem(c.id);
      }
    }

    // 2. Landed field/body edits: an id (not a created temp id) whose every pending field
    // already equals the base value has landed. A pending body edit additionally needs its own
    // reconciliation: without `rawBodies`, the base ItemVM carries no raw body to compare
    // against, so we conservatively leave body-bearing edits alone (unchanged behavior). With
    // `rawBodies`, a pending body that now equals the published body has also landed, and the
    // item can be dropped once fields match too (or immediately, if there are no pending fields
    // at all — the body match is the only thing that was pending).
    const createdIds = new Set(d.value.created.map((c) => c.id));
    const idsWithFieldsOrBodies = new Set([...Object.keys(d.value.fields), ...Object.keys(d.value.bodies)]);
    for (const id of idsWithFieldsOrBodies) {
      if (createdIds.has(id)) continue;
      const base = byId.get(id);
      if (!base) {
        // The item was deleted upstream (no longer in the base at all): a pending field/body
        // edit on it is orphaned — sending it would 422 the next Sync (there's no file left to
        // update). Drop the pending state rather than leaving it to poison future syncs.
        delete d.value.fields[id];
        delete d.value.bodies[id];
        continue;
      }

      const hasBodyEdit = id in d.value.bodies;
      let bodyLanded = !hasBodyEdit;
      if (hasBodyEdit) {
        if (!rawBodies) continue; // conservative: never revert a body-bearing edit
        bodyLanded = d.value.bodies[id] === bodyFor(id);
        if (!bodyLanded) continue;
      }

      const pending = d.value.fields[id];
      const allFieldsMatch =
        !pending ||
        Object.entries(pending).every(([key, val]) => {
          if (key === 'tags') {
            const baseTags = new Set((base.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean));
            const pendingTags = tagSet(val);
            return pendingTags.size === baseTags.size && [...pendingTags].every((t) => baseTags.has(t));
          }
          // Unknown/unmapped field keys are conservatively treated as NOT matching (leave the
          // edit) rather than silently comparing against `undefined` (which would wrongly look
          // "landed" whenever the pending value happened to be empty).
          if (!SCALAR_FIELDS.has(key)) return false;
          const baseVal = (base as Record<string, unknown>)[key];
          return normField(val) === normField(baseVal);
        });
      if (bodyLanded && allFieldsMatch) revertItem(id);
    }

    // 3. Landed deletes: an id no longer present in the base has been deleted server-side —
    // drop it from `deleted` (nothing left to delete).
    d.value.deleted = d.value.deleted.filter((id) => byId.has(id));

    // 4. Prune stale reorder entries: the edit-service rejects a reorder lane referencing an
    // id it can't place in that product×horizon, which aborts the entire Sync — so after the
    // base changes (an item moved lanes, or was deleted upstream), any id in a pending reorder
    // lane that no longer resolves to that same product+horizon in the base must be dropped
    // before it can poison a sync. Created temp-ids aren't in `items` at all, but they're
    // already stripped out of the *emitted* changeset reorder (see changeset() above), so they
    // pass through here untouched rather than being mistaken for stale reals.
    for (const [product, lanes] of Object.entries(d.value.reorder)) {
      const nextLanes: Record<string, string[]> = {};
      for (const [horizon, ids] of Object.entries(lanes)) {
        const kept = ids.filter((id) => {
          if (createdIds.has(id)) return true;
          const base = byId.get(id);
          return !!base && base.product === product && base.horizon === horizon;
        });
        if (!kept.length) continue;
        // Landed reorder: if the published base already has these items in this exact order,
        // the reorder has been applied server-side — drop it so it doesn't linger as a
        // permanent phantom "unpublished change" after a sync + reload. (A lane still holding
        // an unsynced created temp-id can't have fully landed, so it's kept.)
        const hasTempId = kept.some((id) => createdIds.has(id));
        const laneBase = items.filter((it) => it.product === product && it.horizon === horizon && kept.includes(it.id));
        // Only decide "landed" when the base actually carries an `order` for each of these items
        // (real published data always does; without it the order is ambiguous, so keep the
        // reorder rather than risk dropping a genuinely-pending one).
        const hasAllOrders = laneBase.length === kept.length && laneBase.every((it) => Number.isFinite(it.order as number));
        const baseOrder = [...laneBase].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((it) => it.id);
        const landed = !hasTempId && hasAllOrders && kept.every((id, i) => id === baseOrder[i]);
        if (!landed) nextLanes[horizon] = kept;
      }
      if (Object.keys(nextLanes).length) {
        d.value.reorder[product] = nextLanes;
      } else {
        delete d.value.reorder[product];
      }
    }

    persist();
  };

  // U10 (R11): whether the draft carries a pending body edit on a REAL (already-synced) item
  // — i.e. excluding a not-yet-created temp id, whose body reconciliation is handled entirely
  // by the "landed create" title-match pass above and needs no raw-body fetch. Board reads
  // this on mount to decide whether the heavier authed rawBodies fetch (normally only made on
  // edit-mode entry) is worth making on a plain view-mode reload too — only a real item's body
  // edit can be the phantom-dirty case reconcile can't otherwise detect (see reconcile's body
  // branch above: without rawBodies it conservatively leaves every body-bearing edit alone).
  const hasBodyEdits = computed(() => {
    const createdIds = new Set(d.value.created.map((c) => c.id));
    return Object.keys(d.value.bodies).some((id) => !createdIds.has(id));
  });

  const isDirty = (id: string) => !!d.value.fields[id] || id in d.value.bodies || d.value.deleted.includes(id);
  // Read-back helpers for controlled inputs: the pending override for one field/body,
  // or undefined when the item hasn't been touched (caller falls back to the source value).
  const fieldValue = (id: string, key: string): string | undefined => d.value.fields[id]?.[key];
  const bodyValue = (id: string): string | undefined => d.value.bodies[id];
  const isDeleted = (id: string) => d.value.deleted.includes(id);

  const dirtyCount = computed(() => {
    const createdIds = new Set(d.value.created.map((c) => c.id));
    // A created item's own field/body edits are already counted once via created.length;
    // don't let them also land in the generic ids set below.
    const ids = new Set<string>(
      [...Object.keys(d.value.fields), ...Object.keys(d.value.bodies), ...d.value.deleted].filter(
        (id) => !createdIds.has(id),
      ),
    );
    const reorderN = Object.values(d.value.reorder).reduce((n, lanes) => n + Object.keys(lanes).length, 0);
    return ids.size + d.value.created.length + reorderN;
  });

  // The plain changeset shape, with no base-version/idempotency data — used everywhere that
  // isn't the actual network send (board projection, pre-flight checks, the sent-vs-current
  // diff that drives `unsynced`) so those stay unaffected by baseSha/requestId churn. Renamed
  // from the old zero-arg `changeset()`; `changeset(baseShaMap)` below wraps it for the one
  // call site (Sync) that needs the extra fields.
  const changesetCore = () => {
    const createdIds = new Set(d.value.created.map((c) => c.id));
    return {
      updated: Object.keys({ ...d.value.fields, ...Object.fromEntries(Object.keys(d.value.bodies).map((k) => [k, 1])) })
        .filter((id) => !d.value.deleted.includes(id) && !createdIds.has(id))
        .map((id) => ({ id, frontmatter: d.value.fields[id] || {}, body: d.value.bodies[id] || '' })),
      // `id` here is a client-only temp id for the working-copy projection; the server's
      // ItemNew has no id field and ignores unknown JSON keys, so it's safe to send.
      created: d.value.created.map((c) => ({
        id: c.id,
        // A new item's product is edited via setField(tempId, 'product', ...) once the full
        // editor opens it — that override must win over the product `addItem` was called
        // with, since the edit-service writes the created file into a product-keyed folder
        // (and derives its id prefix from it): an ignored override would land the file in the
        // wrong folder under the wrong id.
        product: d.value.fields[c.id]?.product ?? c.product,
        // A new item's title is edited via setField(tempId, 'title', ...) once the full
        // editor opens it — that override must win over the (often empty) title `addItem`
        // was called with, since the edit-service requires a non-empty title to create it.
        title: d.value.fields[c.id]?.title ?? c.title,
        frontmatter: { ...(c.frontmatter ?? {}), ...(d.value.fields[c.id] || {}) },
        body: d.value.bodies[c.id] ?? '',
      })),
      deletedIds: d.value.deleted.filter((id) => !createdIds.has(id)),
      // A locally-created item's temp id (`new-<n>`) is meaningless to the server — if a
      // lane containing one gets reordered, drop the temp id from the persisted order
      // rather than sending an id the server will reject (which would abort the whole
      // Sync). The real ids around it still carry their relative order.
      reorder: Object.fromEntries(
        Object.entries(d.value.reorder).map(([product, lanes]) => [
          product,
          Object.fromEntries(
            Object.entries(lanes).map(([horizon, ids]) => [horizon, ids.filter((id) => !createdIds.has(id))]),
          ),
        ]),
      ),
    };
  };

  // U2 (R1/KTD1): when a base-version map (id -> the item file's git blob sha, captured
  // alongside rawBodies on edit-mode entry — see Board.vue) is supplied, build a single
  // `baseShas` map covering both `updated` and `deletedIds` ids, keyed the same way — a create
  // is exempt (KTD1/R1: only a true create has no prior file to base against). Called with no
  // argument, this returns exactly the old shape (no `baseShas` key at all) — every other
  // caller (board projection, pre-flight checks, the sent-vs-current diff behind `unsynced`)
  // keeps working unchanged.
  const changeset = (baseShaMap?: Record<string, string> | Map<string, string>) => {
    const core = changesetCore();
    const shaFor = (id: string): string | undefined =>
      baseShaMap instanceof Map ? baseShaMap.get(id) : baseShaMap?.[id];
    // KTD1/R1: send ONE `baseShas` map (id → the git blob sha the client last saw), keyed by
    // every updated + deleted id that has a known base sha — matching the edit-service's
    // `Changeset.BaseShas map[string]string`. A create is exempt (no prior file to base against).
    // Called with no map → the old shape (no `baseShas` key at all), so the board projection,
    // pre-flight checks, and the sent-vs-current diff behind `unsynced` stay unaffected.
    const baseShas: Record<string, string> | undefined = baseShaMap
      ? Object.fromEntries(
          [...core.updated.map((u) => u.id), ...core.deletedIds].flatMap((id) => {
            const sha = shaFor(id);
            return sha !== undefined ? [[id, sha] as const] : [];
          }),
        )
      : undefined;
    return { ...core, baseShas };
  };

  // U3 (R3/KTD3): mint (or reuse) the crypto-random requestId for the NEXT Sync attempt and
  // persist it immediately — before the caller sends anything — so a crash between persist and
  // send still reuses the same id on the following attempt rather than minting a new one the
  // server would treat as an unrelated request. Reuse only applies while the changeset content
  // is unchanged from the attempt the pending id was minted for AND the id is still within the
  // TTL bound; otherwise (first attempt, changed changeset, or expired) a fresh id is minted.
  const ensureRequestId = (): string => {
    const snapshot = JSON.stringify(changesetCore());
    const expired = Date.now() - (d.value.requestIdAt ?? 0) > REQUEST_ID_TTL_MS;
    let id = d.value.requestId;
    if (!id || d.value.requestIdSnapshot !== snapshot || expired) {
      id = randomRequestId();
      d.value.requestId = id;
      d.value.requestIdSnapshot = snapshot;
      d.value.requestIdAt = Date.now();
      persist();
    }
    return id;
  };
  // Clears the pending requestId once a Sync actually lands — the next Sync (even of an
  // unchanged changeset, which shouldn't normally happen once synced) mints a fresh id rather
  // than reusing one the server may already have a cached result for.
  const clearRequestId = () => {
    d.value.requestId = null;
    d.value.requestIdSnapshot = null;
    d.value.requestIdAt = null;
    persist();
  };
  // Read-back helper for tests/callers that want to inspect the pending id without minting one.
  const pendingRequestId = (): string | null => d.value.requestId;

  // U4 (R5/KTD4): record the sha (and the snapshot it was sent for) the moment a Sync lands —
  // called right alongside the in-memory `syncedJson`/`publishing` Board sets on success, but
  // persisted so it survives a reload. `committedSha` is read back on mount to resume the
  // "awaiting build"/"building" banner state instead of showing a phantom "unsynced"/"clean".
  const recordCommit = (sha: string, snapshotJson: string) => {
    d.value.committedSha = sha;
    d.value.committedSnapshot = snapshotJson;
    d.value.committedAt = Date.now();
    persist();
  };
  // Called once the deploy poll confirms the commit is actually live (or the caller otherwise
  // decides tracking it is no longer useful) — nothing further to resume on a later reload.
  const clearCommit = () => {
    d.value.committedSha = null;
    d.value.committedSnapshot = null;
    d.value.committedAt = null;
    persist();
  };
  const committedSha = computed(() => d.value.committedSha);
  const committedSnapshot = computed(() => d.value.committedSnapshot);
  const committedAt = computed(() => d.value.committedAt);

  return {
    setField,
    setBody,
    addItem,
    deleteItem,
    reorder,
    clear,
    revertItem,
    revertField,
    reconcile,
    isDirty,
    dirtyCount,
    changeset,
    ensureRequestId,
    clearRequestId,
    pendingRequestId,
    recordCommit,
    clearCommit,
    committedSha,
    committedSnapshot,
    committedAt,
    fieldValue,
    bodyValue,
    isDeleted,
    persistFailed,
    crossTabChanged,
    dismissCrossTabChanged,
    hasBodyEdits,
  };
}

let singleton: ReturnType<typeof createEditStore> | null = null;
export function useEditStore() {
  return (singleton ||= createEditStore());
}
