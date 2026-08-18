import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { flushPromises } from '@vue/test-utils';
import type { ItemVM } from '../../lib/filters';

// Board pulls in a lot of real child components (drawer, editors, share dialog); auto-stub
// them via `global.stubs: true` below so this test only exercises Board's own script:
// U4 edit-mode persistence/auto-resume, and U9's newer-version reload affordance
// (including the clear-vs-keep predicate in reloadToLatest).
const meMock = vi.fn(async () => ({ editor: true, login: 'octocat' }));
const syncMock = vi.fn();
// U4 (R4/R5/KTD4): defaults to "unavailable" (null) so every test not explicitly exercising
// the deploy-status poll degrades silently — matching real behavior in local dev / when the
// endpoint 401s — rather than needing every existing doSync test to also mock it.
const deployStatusMock = vi.fn(async () => null as null | { status: string; conclusion: string; headSha: string; htmlUrl: string });
let newVersionCb: (() => void) | null = null;
const watchForNewVersionMock = vi.fn((cb: () => void, _intervalMs?: number) => {
  newVersionCb = cb;
  return vi.fn();
});

vi.mock('../../lib/edit/client', () => ({
  EDIT_API: 'https://edit.example.test',
  readTokenFromHash: vi.fn(() => null),
  me: (...args: unknown[]) => meMock(...(args as [])),
  loginUrl: vi.fn(() => '#'),
  fetchItems: vi.fn(async () => []),
  sync: (...args: unknown[]) => syncMock(...(args as [])),
  deployStatus: (...args: unknown[]) => deployStatusMock(...(args as [])),
  // RecentChanges (U2) resolves the activity feed through the same session
  // token the rest of the edit client uses — no token means no fetch (R14),
  // so the peek simply doesn't render in these tests.
  getToken: vi.fn(() => null),
}));
vi.mock('../../lib/share/canvasdrop', () => ({
  getCanvasdrop: vi.fn(() => null),
  updateAuthoredCanvas: vi.fn(),
}));
vi.mock('../../lib/edit/version', () => ({
  watchForNewVersion: (cb: () => void, intervalMs?: number) => watchForNewVersionMock(cb, intervalMs),
}));

import Board from './Board.vue';
import { useEditStore, KEY } from '../../lib/edit/store';

const item = (over: Partial<ItemVM> = {}): ItemVM => ({
  id: 'TALK-1', title: 'Existing item', product: 'Podcasts & Audiobooks',
  horizon: 'Now', stage: 'Building', owner: 'mark@example.com',
  impact: 'High', effort: 'Low', visibility: 'Internal', order: 1, updated: '2026-07-01',
  tags: ['workflow'], themes: ['one-view'], oneliner: 'An existing card',
  outcome: 'The outcome', sections: [{ heading: 'Why it matters', text: 'because' }],
  editUrl: 'https://github.com/edit/x', links: [], text: 'haystack', href: '/item/TALK-1',
  ...over,
});

let wrappers: VueWrapper[] = [];
async function mountBoard(items: ItemVM[] = [item()]) {
  const w = mount(Board, {
    props: { items },
    global: { stubs: { transition: false } },
  });
  wrappers.push(w);
  await flushPromises();
  return w;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear(); // board-state (horizonFocus/filters) persists here — isolate tests
  window.history.replaceState(null, '', '/'); // ?horizon=/?item= in the URL leaks between tests
  meMock.mockClear();
  meMock.mockResolvedValue({ editor: true, login: 'octocat' });
  syncMock.mockReset();
  deployStatusMock.mockReset();
  deployStatusMock.mockResolvedValue(null);
  watchForNewVersionMock.mockClear();
  newVersionCb = null;
  vi.spyOn(window.location, 'reload').mockImplementation(() => {});
});

afterEach(() => {
  for (const w of wrappers) w.unmount();
  wrappers = [];
  useEditStore().clear();
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('Board — edit mode persistence (U4)', () => {
  it('does not start in edit mode by default for an editor with no saved preference', async () => {
    const w = await mountBoard();
    expect(w.find('[data-test="editing-banner"]').exists()).toBe(false);
  });

  it('auto-resumes edit mode on mount when rm-edit-mode was left on', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    expect(w.find('[data-test="editing-banner"]').exists()).toBe(true);
  });

  it('auto-resumes edit mode when a draft has unsynced changes, even without the saved flag', async () => {
    useEditStore().setField('TALK-1', 'title', 'Edited title');
    const w = await mountBoard();
    expect(w.find('[data-test="editing-banner"]').exists()).toBe(true);
  });

  it('persists edit mode to localStorage when toggled on', async () => {
    const w = await mountBoard();
    (w.vm as unknown as { editMode: boolean }).editMode = true;
    await flushPromises();
    expect(localStorage.getItem('rm-edit-mode')).toBe('1');
  });
});

describe('Board — newer version reload affordance (U9)', () => {
  it('starts the version watcher only once canEdit resolves true', async () => {
    await mountBoard();
    expect(watchForNewVersionMock).toHaveBeenCalledTimes(1);
  });

  it('does not start the version watcher for a non-editor', async () => {
    meMock.mockResolvedValueOnce({ editor: false, login: '' });
    await mountBoard();
    expect(watchForNewVersionMock).not.toHaveBeenCalled();
  });

  it('shows the reload banner once a newer version is detected', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    expect(w.find('[data-test="reload-latest"]').exists()).toBe(false);

    newVersionCb?.();
    await flushPromises();

    expect(w.find('[data-test="reload-latest"]').exists()).toBe(true);
  });

  it('reloads the page unconditionally — reconciling the draft is the mount effect\'s job, not this button\'s', async () => {
    // reloadToLatest was simplified to a bare `location.reload()`: the mount-time
    // `editStore.reconcile()` (see the describe block below) now handles dropping
    // landed ops uniformly, whether the reload was this button or a plain refresh.
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    const store = useEditStore();
    store.setField('TALK-1', 'title', 'Edited title');

    newVersionCb?.();
    await flushPromises();
    await w.find('[data-test="reload-latest"]').trigger('click');

    // The click itself doesn't touch the store — it only navigates.
    expect(store.dirtyCount.value).toBeGreaterThan(0);
    expect(window.location.reload).toHaveBeenCalledTimes(1);
  });
});

describe('Board — abandoned-add discard on editor close (final review fix 2)', () => {
  it('discards a just-created item left with an empty title when the editor closes', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    const store = useEditStore();
    const id = store.addItem('Podcasts & Audiobooks', '', { horizon: 'Next' });
    (w.vm as unknown as { editingId: string | null }).editingId = id;
    await flushPromises();

    (w.vm as unknown as { onEditorClose: () => void }).onEditorClose();

    expect(store.changeset().created).toEqual([]);
    expect((w.vm as unknown as { editingId: string | null }).editingId).toBeNull();
  });

  it('keeps a just-created item once it has been given a real title', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    const store = useEditStore();
    const id = store.addItem('Podcasts & Audiobooks', '', { horizon: 'Next' });
    store.setField(id, 'title', 'A real title');
    (w.vm as unknown as { editingId: string | null }).editingId = id;
    await flushPromises();

    (w.vm as unknown as { onEditorClose: () => void }).onEditorClose();

    expect(store.changeset().created).toHaveLength(1);
  });
});

describe('Board — reconcile draft against fresh base on mount', () => {
  it('drops a created item once it lands in the freshly-loaded base, keeping unrelated edits', async () => {
    // Simulates the "Sync → rebuild → reload" cycle: a create made against the first mount
    // has, by the time of a later reload, landed under a real id in the published base
    // (same product + title). The next mount's `props.items` reflects that — and the mount
    // reconcile (called right after `canEdit` resolves, before the auto-resume check) must
    // drop the now-redundant local `created` entry while leaving a genuinely-unsynced edit
    // made on another item untouched.
    localStorage.setItem('rm-edit-mode', '1');
    const store = useEditStore();
    const createdId = store.addItem('Podcasts & Audiobooks', 'Brand new card', { horizon: 'Next' });
    store.setField('TALK-1', 'title', 'Edited after sync');

    await mountBoard([
      item(),
      item({ id: 'TALK-2', product: 'Podcasts & Audiobooks', title: 'Brand new card' }),
    ]);

    const cs = store.changeset();
    expect(cs.created.find((c) => c.id === createdId)).toBeUndefined();
    expect(cs.updated.find((u) => u.id === 'TALK-1')?.frontmatter.title).toBe('Edited after sync');
  });

  it('drops a field edit once the base already reflects it', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const store = useEditStore();
    // The base's title already matches this "edit" — it has landed.
    store.setField('TALK-1', 'title', 'Existing item');

    await mountBoard();

    expect(store.changeset().updated).toEqual([]);
    expect(store.dirtyCount.value).toBe(0);
  });

  it('keeps a field edit that still differs from the freshly-loaded base', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const store = useEditStore();
    store.setField('TALK-1', 'title', 'Still unsynced title');

    await mountBoard();

    expect(store.changeset().updated.find((u) => u.id === 'TALK-1')?.frontmatter.title).toBe(
      'Still unsynced title',
    );
  });

  it('reconciles before the auto-resume check, so a fully-landed draft does not force edit mode on', async () => {
    // No `rm-edit-mode` flag saved — the only reason edit mode would auto-resume is
    // `dirtyCount > 0`. If reconcile ran AFTER that check (or not at all), this stale,
    // already-landed edit would incorrectly flip edit mode on.
    const store = useEditStore();
    store.setField('TALK-1', 'title', 'Existing item');

    const w = await mountBoard();

    expect(w.find('[data-test="editing-banner"]').exists()).toBe(false);
  });
});

describe('Board — doSync publishing reset', () => {
  it('does not leave a stale "Publishing…" state showing across a failed re-sync after a prior success', async () => {
    // Once a sync lands with nothing changed since, `unsynced` goes false: SyncBar (the
    // bottom bar) unmounts entirely — its Discard/Sync actions have nothing to act on — and
    // the "Publishing…" copy lives solely in the always-visible top banner (see #2/#3).
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: true, sha: 'abc123' });
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();
    expect(w.find('[data-test="sync-bar"]').exists()).toBe(false);
    expect(w.find('[data-test="banner-publishing"]').exists()).toBe(true);

    // Editing again before the failed re-sync reintroduces a genuinely-unsynced delta, so
    // SyncBar reappears (this is what the re-sync attempt below is sent against).
    useEditStore().setField('TALK-1', 'title', 'Edited again');
    syncMock.mockResolvedValueOnce({ ok: false, errors: ['boom'] });
    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    expect(w.find('[data-test="sync-bar"]').text()).not.toContain('Publishing');
    expect(w.find('[data-test="sync-bar"]').text()).toContain('boom');
  });
});

describe('Board — NoChanges (no-op) sync does not get stuck on "Publishing…"', () => {
  it('a NoChanges response is a clean resolve — no stuck publishing banner, no toast, requestId cleared', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: true, noChanges: true, sha: '' });
    const w = await mountBoard();
    const store = useEditStore();
    store.setField('TALK-1', 'title', 'Edited title');
    store.ensureRequestId();

    // doSync now refreshes liveItems/baseShaMap from /api/items after ANY ok sync (real
    // commit or no-op alike — see refreshLiveItems). The refreshed base here still carries
    // the item's ORIGINAL (unedited) title — a distinct value from the pending "Edited
    // title" edit — so the pending edit remains genuinely unsynced after reconcile, keeping
    // this test's real point (no stuck "Publishing…") independent of the refresh/reconcile
    // behavior exercised separately in the "post-sync base refresh" describe block below.
    const { fetchItems } = await import('../../lib/edit/client');
    (fetchItems as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: 'TALK-1',
        sha: 'sha-cm1',
        frontmatter: { title: 'Existing item', product: 'Podcasts & Audiobooks', horizon: 'Now', stage: 'Building', owner: 'mark@example.com' },
        body: '',
      },
    ]);

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    expect(w.find('[data-test="banner-publishing"]').exists()).toBe(false);
    // Falls through to the ordinary unsynced state — the pending edit still differs from the
    // freshly-refreshed base — rather than getting stuck showing "Publishing…" for a build
    // that will never happen.
    expect(w.find('[data-test="banner-unsynced"]').exists()).toBe(true);
    expect(w.find('[data-test="sync-toast"]').exists()).toBe(false);
    expect(store.pendingRequestId()).toBeNull();
  });
});

describe('Board — banner state', () => {
  it('shows the plain "Editing" state when edit mode is on and there is nothing to report', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    expect(w.find('[data-test="banner-clean"]').exists()).toBe(true);
    expect(w.find('[data-test="sync-bar"]').exists()).toBe(false);
  });

  it('shows the unsynced count once there is a genuine unsynced change', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');
    await flushPromises();

    const banner = w.find('[data-test="banner-unsynced"]');
    expect(banner.exists()).toBe(true);
    expect(banner.text()).toContain('1 unpublished');
    expect(banner.text()).not.toContain('unpublished)');
  });

  it('switches to the calm "publishing" state once Sync lands with nothing changed since', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValue({ ok: true, sha: 'abc123' });
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    expect(w.find('[data-test="banner-publishing"]').exists()).toBe(true);
    expect(w.find('[data-test="banner-unsynced"]').exists()).toBe(false);
  });

  it('prioritizes the reload state over publishing/unsynced once a newer build is detected', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValue({ ok: true, sha: 'abc123' });
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');
    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    newVersionCb?.();
    await flushPromises();

    expect(w.find('[data-test="reload-latest"]').exists()).toBe(true);
    expect(w.find('[data-test="banner-publishing"]').exists()).toBe(false);
  });
});

describe('Board — SyncBar visibility follows `unsynced`', () => {
  it('is visible while there is a genuinely-unsynced change', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');
    await flushPromises();
    expect(w.find('[data-test="sync-bar"]').exists()).toBe(true);
  });

  it('disappears immediately once Sync succeeds with nothing changed since', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValue({ ok: true, sha: 'abc123' });
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    expect(w.find('[data-test="sync-bar"]').exists()).toBe(false);
  });

  it('reappears if the user edits again while the prior sync is still publishing', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValue({ ok: true, sha: 'abc123' });
    const w = await mountBoard();
    const store = useEditStore();
    store.setField('TALK-1', 'title', 'Edited title');

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();
    expect(w.find('[data-test="sync-bar"]').exists()).toBe(false);

    store.setField('TALK-1', 'title', 'Edited again, post-sync');
    await flushPromises();

    expect(w.find('[data-test="sync-bar"]').exists()).toBe(true);
  });
});

describe('Board — deploy status polling (U4/R4/R5/KTD4)', () => {
  it('tracks committed → building → live via identity (a success run whose head IS the committed sha)', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: true, sha: 'sha-1' });
    deployStatusMock.mockResolvedValueOnce({ status: 'in_progress', conclusion: '', headSha: 'sha-1', htmlUrl: '' });
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');

    vi.useFakeTimers();
    try {
      await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
      await flushPromises();
      expect(w.find('[data-test="banner-building"]').exists()).toBe(true);

      deployStatusMock.mockResolvedValueOnce({ status: 'completed', conclusion: 'success', headSha: 'sha-1', htmlUrl: '' });
      await vi.advanceTimersByTimeAsync(3000);
      await flushPromises();
      expect(w.find('[data-test="banner-live"]').exists()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('treats a newer superseding success (a different headSha) as live too — identity/ancestry, never a sha-ordering compare', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: true, sha: 'sha-1' });
    deployStatusMock.mockResolvedValueOnce({ status: 'in_progress', conclusion: '', headSha: 'sha-1', htmlUrl: '' });
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');

    vi.useFakeTimers();
    try {
      await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
      await flushPromises();
      expect(w.find('[data-test="banner-building"]').exists()).toBe(true);

      // deploy.yml's `cancel-in-progress` means the latest-run endpoint only ever reports
      // ONE run — a different (later) commit's run superseded ours here; on a
      // fast-forward-only main branch its tree already contains our commit, so this success
      // means we're live too.
      deployStatusMock.mockResolvedValueOnce({ status: 'completed', conclusion: 'success', headSha: 'sha-2-newer', htmlUrl: '' });
      await vi.advanceTimersByTimeAsync(3000);
      await flushPromises();
      expect(w.find('[data-test="banner-live"]').exists()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows "Publish didn\'t build" with a link to the failing run', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: true, sha: 'sha-1' });
    deployStatusMock.mockResolvedValueOnce({
      status: 'completed',
      conclusion: 'failure',
      headSha: 'sha-1',
      htmlUrl: 'https://github.com/x/actions/runs/1',
    });
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    expect(w.find('[data-test="banner-build-failed"]').exists()).toBe(true);
    const link = w.get('[data-test="build-failed-view-run"]');
    expect(link.attributes('href')).toBe('https://github.com/x/actions/runs/1');
  });

  it('maps cancelled/skipped/timed_out to "superseded — awaiting a newer build" (not a failure), and keeps polling for it', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: true, sha: 'sha-1' });
    deployStatusMock.mockResolvedValueOnce({ status: 'completed', conclusion: 'cancelled', headSha: 'sha-1', htmlUrl: '' });
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');

    vi.useFakeTimers();
    try {
      await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
      await flushPromises();
      expect(w.find('[data-test="banner-superseded"]').exists()).toBe(true);
      expect(w.find('[data-test="banner-build-failed"]').exists()).toBe(false);

      deployStatusMock.mockResolvedValueOnce({ status: 'completed', conclusion: 'success', headSha: 'sha-2', htmlUrl: '' });
      await vi.advanceTimersByTimeAsync(3000);
      await flushPromises();
      expect(w.find('[data-test="banner-live"]').exists()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('bounds "no run yet" polling instead of continuing forever, settling on "no build was triggered"', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: true, sha: 'sha-1' });
    // The zero-value response `handleStatus` returns when a commit touches only
    // path-filtered files — no run at all, ever, for this commit.
    deployStatusMock.mockResolvedValue({ status: '', conclusion: '', headSha: '', htmlUrl: '' });
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');

    vi.useFakeTimers();
    try {
      await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
      await flushPromises();
      expect(w.find('[data-test="banner-no-build"]').exists()).toBe(false); // not yet — still bounded-waiting

      await vi.advanceTimersByTimeAsync(3 * 60 * 1000);
      await flushPromises();
      expect(w.find('[data-test="banner-no-build"]').exists()).toBe(true);
      const callsAtTimeout = deployStatusMock.mock.calls.length;

      // Confirms polling actually stopped at the bound, rather than continuing forever.
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      await flushPromises();
      expect(deployStatusMock.mock.calls.length).toBe(callsAtTimeout);
    } finally {
      vi.useRealTimers();
    }
  });

  it('degrades silently when /api/status is unavailable — no error, just no progression', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: true, sha: 'sha-1' });
    deployStatusMock.mockResolvedValue(null);
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    expect(w.find('[data-test="banner-publishing"]').exists()).toBe(true);
    expect(w.find('[data-test="banner-build-failed"]').exists()).toBe(false);
    expect(w.find('[data-test="banner-building"]').exists()).toBe(false);
    expect(deployStatusMock).toHaveBeenCalledTimes(1);
  });

  it('resumes "awaiting build" on reload for a persisted, not-yet-live committed sha — never a phantom "unsynced"/"clean"', async () => {
    // Simulates a prior tab that synced, then reloaded before the build finished: the store
    // already carries a committedSha + the snapshot it was sent for (see store.ts's
    // recordCommit), with the same pending field edit still in the draft (the rebuild hasn't
    // landed yet, so reconcile has nothing to drop).
    const store = useEditStore();
    store.setField('TALK-1', 'title', 'Edited title');
    const snapshot = JSON.stringify(store.changeset());
    store.recordCommit('committed-sha-1', snapshot);
    deployStatusMock.mockResolvedValueOnce({ status: 'in_progress', conclusion: '', headSha: 'committed-sha-1', htmlUrl: '' });
    localStorage.setItem('rm-edit-mode', '1');

    const w = await mountBoard();

    expect(w.find('[data-test="banner-unsynced"]').exists()).toBe(false);
    expect(w.find('[data-test="banner-clean"]').exists()).toBe(false);
    expect(w.find('[data-test="banner-building"]').exists()).toBe(true);
  });

  it('clears a persisted committed sha once reload reconciliation proves a created item is already live', async () => {
    // This is the "created card still says Publishing after reload" case: the previous tab
    // synced a new temp-id item and recorded the commit, then the deployed static build now
    // contains that item under its real id. Mount-time reconcile drops the create; the stale
    // commit marker should be cleared instead of resuming a Publishing banner.
    const store = useEditStore();
    store.addItem('Core Platform & Data', 'mark testaraaar', { horizon: 'Next', stage: 'Discovery' });
    store.recordCommit('committed-create-sha', JSON.stringify(store.changeset()));
    localStorage.setItem('rm-edit-mode', '1');

    const w = await mountBoard([
      item({
        id: 'PLATFORM-001',
        title: 'mark testaraaar',
        product: 'Core Platform & Data',
        horizon: 'Next',
        stage: 'Discovery',
      }),
    ]);
    await flushPromises();

    expect(store.dirtyCount.value).toBe(0);
    expect(w.find('[data-test="banner-publishing"]').exists()).toBe(false);
    expect(w.find('[data-test="banner-clean"]').exists()).toBe(true);
    expect(deployStatusMock).not.toHaveBeenCalled();
    expect(store.committedSha.value).toBeNull();
  });

  it('DROPS a stale committed sha on mount (past session, deploy long live) — no resurrected "Publishing…" and no poll', async () => {
    // The reported bug: a committedSha left by a past session whose ~1-min build went live long
    // ago (the poll never cleared it before that tab closed) must NOT resurrect a permanent
    // build banner on the next load. Drive staleness via the clock: record the commit, then
    // jump well past the resume window before mounting.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-07-07T12:00:00Z'));
      const store = useEditStore();
      store.setField('TALK-1', 'title', 'Edited title');
      store.recordCommit('committed-sha-old', JSON.stringify(store.changeset()));
      vi.setSystemTime(new Date('2026-07-07T12:30:00Z')); // 30 min later — build is long live
      localStorage.setItem('rm-edit-mode', '1');

      const w = await mountBoard();
      await flushPromises();

      expect(w.find('[data-test="banner-building"]').exists()).toBe(false);
      expect(w.find('[data-test="banner-publishing"]').exists()).toBe(false);
      expect(deployStatusMock).not.toHaveBeenCalled(); // no poll started for a stale sha
      expect(useEditStore().committedSha.value).toBeNull(); // dropped, so it can't resurrect later
    } finally {
      vi.useRealTimers();
    }
  });

  it('a fast second Sync retires the first poll chain instead of running both concurrently', async () => {
    // `syncPending` clears in doSync's `finally` before the first poll's initial /api/status
    // fetch resolves, so SyncBar re-enables Sync and a second Sync can start a second poll
    // chain while the first is still in flight. Only one chain should end up alive.
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    const doSync = (w.vm as unknown as { doSync: () => Promise<void> }).doSync;

    let resolveFirstStatus!: (v: { status: string; conclusion: string; headSha: string; htmlUrl: string }) => void;
    const firstStatusFetch = new Promise<{ status: string; conclusion: string; headSha: string; htmlUrl: string }>(
      (resolve) => {
        resolveFirstStatus = resolve;
      },
    );
    syncMock.mockResolvedValueOnce({ ok: true, sha: 'sha-1' });
    deployStatusMock.mockImplementationOnce(() => firstStatusFetch);

    useEditStore().setField('TALK-1', 'title', 'First edit');
    await doSync(); // starts the first poll chain; its initial /api/status fetch is left pending
    await flushPromises();
    expect(deployStatusMock).toHaveBeenCalledTimes(1);

    // A second Sync starts (and lands) while the first chain's fetch is still unresolved.
    syncMock.mockResolvedValueOnce({ ok: true, sha: 'sha-2' });
    deployStatusMock.mockResolvedValueOnce({ status: 'in_progress', conclusion: '', headSha: 'sha-2', htmlUrl: '' });
    useEditStore().setField('TALK-1', 'title', 'Second edit');
    await doSync(); // starts a second, fresh poll chain
    await flushPromises();
    expect(w.find('[data-test="banner-building"]').exists()).toBe(true);
    expect(deployStatusMock).toHaveBeenCalledTimes(2);

    // Now let the stale first chain's fetch resolve — a `success` result for sha-1. If the
    // first chain were still alive it would flip the banner to "live"; instead its captured
    // epoch no longer matches the current one, so it must bail without touching state.
    resolveFirstStatus({ status: 'completed', conclusion: 'success', headSha: 'sha-1', htmlUrl: '' });
    await flushPromises();
    expect(w.find('[data-test="banner-live"]').exists()).toBe(false);
    expect(w.find('[data-test="banner-building"]').exists()).toBe(true);
    // The stale chain didn't reschedule another poll of its own after bailing.
    expect(deployStatusMock).toHaveBeenCalledTimes(2);
  });

  it('unmounting stops the active poll chain — no further /api/status calls after teardown', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: true, sha: 'sha-1' });
    deployStatusMock.mockResolvedValue({ status: 'in_progress', conclusion: '', headSha: 'sha-1', htmlUrl: '' });
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');

    vi.useFakeTimers();
    try {
      await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
      await flushPromises();
      const callsBeforeUnmount = deployStatusMock.mock.calls.length;

      w.unmount();
      wrappers = wrappers.filter((x) => x !== w);

      await vi.advanceTimersByTimeAsync(30000);
      await flushPromises();
      expect(deployStatusMock.mock.calls.length).toBe(callsBeforeUnmount);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Board — reorder guard (canReorder)', () => {
  it('is false by default: manual sort but no product filter narrows to one product', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    expect((w.vm as unknown as { canReorder: boolean }).canReorder).toBe(false);
    expect(w.find('[data-test="reorder-hint"]').text()).toContain('filter to one product');
  });

  it('is true once scoped to one product, manual sort, with no other active filters', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    const vm = w.vm as unknown as { filters: { product: string | null }; sort: string; canReorder: boolean };
    vm.filters.product = 'Podcasts & Audiobooks';
    vm.sort = 'manual';
    await flushPromises();

    expect(vm.canReorder).toBe(true);
    expect(w.find('[data-test="reorder-hint"]').text()).toContain('Drag');
  });

  it('is false again once another filter is layered on top of the product scope', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    const vm = w.vm as unknown as {
      filters: { product: string | null; stage: string[] };
      sort: string;
      canReorder: boolean;
    };
    vm.filters.product = 'Podcasts & Audiobooks';
    vm.sort = 'manual';
    vm.filters.stage = ['Building'];
    await flushPromises();

    expect(vm.canReorder).toBe(false);
  });

  it('is false when sorted by anything other than Priority (manual)', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    const vm = w.vm as unknown as { filters: { product: string | null }; sort: string; canReorder: boolean };
    vm.filters.product = 'Podcasts & Audiobooks';
    vm.sort = 'impact';
    await flushPromises();

    expect(vm.canReorder).toBe(false);
  });
});

// Board's drag-to-reorder/move is implemented on top of SortableJS (see Board.vue's
// "SortableJS wiring" section) — actually simulating a real Sortable drag isn't worth it
// here, so these tests exercise the pure store-translation function (`onLaneSortEnd`)
// directly with synthetic from-lane/to-lane/item/index args, exactly as Sortable's real
// `onEnd` handler calls it once it has resolved those from the DOM.
describe('Board — drag a card between lanes to change its horizon', () => {
  type DragVM = {
    onLaneSortEnd: (fromKey: string, toKey: string, itemId: string, newIndex: number) => void;
  };

  it('cross-lane drop, grouped by horizon, sets the dragged card\'s horizon via editStore.setField', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard([item({ id: 'TALK-1', horizon: 'Now' }), item({ id: 'TALK-2', horizon: 'Next' })]);
    const vm = w.vm as unknown as DragVM;

    vm.onLaneSortEnd('Now', 'Next', 'TALK-1', 0);
    await flushPromises();

    expect(useEditStore().fieldValue('TALK-1', 'horizon')).toBe('Next');
  });

  it('same-lane drop reorders only when canReorder is true', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard([
      item({ id: 'TALK-1', horizon: 'Now', order: 1 }),
      item({ id: 'TALK-2', horizon: 'Now', order: 2 }),
    ]);
    const vm = w.vm as unknown as DragVM & { filters: { product: string | null } };

    // canReorder is false here (no product filter narrowing the lane) — same-lane drop no-ops.
    vm.onLaneSortEnd('Now', 'Now', 'TALK-2', 0);
    await flushPromises();
    expect(useEditStore().changeset().reorder).toEqual({});
    expect(useEditStore().fieldValue('TALK-2', 'horizon')).toBeUndefined();

    // Scope to one product (manual sort is already the default) — now it reorders. TALK-2
    // (index 1) moves to index 0, ahead of TALK-1.
    vm.filters.product = 'Podcasts & Audiobooks';
    await flushPromises();
    vm.onLaneSortEnd('Now', 'Now', 'TALK-2', 0);
    await flushPromises();

    expect(useEditStore().changeset().reorder['Podcasts & Audiobooks']?.Now).toEqual(['TALK-2', 'TALK-1']);
  });

  it('grouped by product, a cross-lane (cross-product) drop is a no-op', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard([
      item({ id: 'TALK-1', product: 'Podcasts & Audiobooks', horizon: 'Now' }),
      item({ id: 'ST-1', product: 'Music App', horizon: 'Now', title: 'Music App item' }),
    ]);
    const vm = w.vm as unknown as DragVM & { filters: { group: 'horizon' | 'product' } };
    vm.filters.group = 'product';
    await flushPromises();

    vm.onLaneSortEnd('Podcasts & Audiobooks', 'Music App', 'TALK-1', 0);
    await flushPromises();

    expect(useEditStore().fieldValue('TALK-1', 'product')).toBeUndefined();
    expect(useEditStore().fieldValue('TALK-1', 'horizon')).toBeUndefined();
    expect(useEditStore().changeset().reorder).toEqual({});
  });

  it('ignores a drop of a card flagged pending deleted', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard([item({ id: 'TALK-1', horizon: 'Now' }), item({ id: 'TALK-2', horizon: 'Next' })]);
    useEditStore().deleteItem('TALK-1');
    await flushPromises();
    const vm = w.vm as unknown as DragVM;

    vm.onLaneSortEnd('Now', 'Next', 'TALK-1', 0);
    await flushPromises();

    expect(useEditStore().fieldValue('TALK-1', 'horizon')).toBeUndefined();
  });

  it('ignores a drop back at the same position — no reorder recorded even when canReorder is true', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard([
      item({ id: 'TALK-1', horizon: 'Now', order: 1 }),
      item({ id: 'TALK-2', horizon: 'Now', order: 2 }),
    ]);
    const vm = w.vm as unknown as DragVM & { filters: { product: string | null } };
    vm.filters.product = 'Podcasts & Audiobooks';
    await flushPromises();

    // TALK-1 is already at index 0 — dropping it back at index 0 is a no-op.
    vm.onLaneSortEnd('Now', 'Now', 'TALK-1', 0);
    await flushPromises();

    expect(useEditStore().changeset().reorder).toEqual({});
  });

  it('shows the drag handle once editMode is on, independent of canReorder', async () => {
    const w = await mountBoard([item({ id: 'TALK-1' })]);
    const vm = w.vm as unknown as { editMode: boolean; canReorder: boolean };
    vm.editMode = true;
    await flushPromises();

    expect(vm.canReorder).toBe(false);
    expect(w.find('[data-test="drag-handle"]').exists()).toBe(true);
  });

  it('resets draggingId and dragOverLaneKey once a move is applied', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard([item({ id: 'TALK-1', horizon: 'Now' }), item({ id: 'TALK-2', horizon: 'Next' })]);
    const vm = w.vm as unknown as DragVM & { draggingId: string | null; dragOverLaneKey: string | null };

    // Simulate what Sortable's onStart/onMove would have set while the drag was in flight.
    vm.draggingId = 'TALK-1';
    vm.dragOverLaneKey = 'Next';

    vm.onLaneSortEnd('Now', 'Next', 'TALK-1', 0);
    await flushPromises();

    expect(vm.draggingId).toBeNull();
    expect(vm.dragOverLaneKey).toBeNull();
  });
});

describe('Board — tag suggestions fed to the editor', () => {
  it('collects every distinct tag across the whole board for `allTags`', async () => {
    const w = await mountBoard([
      item({ id: 'TALK-1', tags: ['workflow', 'beta'] }),
      item({ id: 'TALK-2', tags: ['beta', 'launch'] }),
    ]);

    expect((w.vm as unknown as { allTags: string[] }).allTags).toEqual(['beta', 'launch', 'workflow']);
  });
});

describe('Board — owner suggestions fed to the editor (fix #4)', () => {
  it('collects every distinct owner across the whole board for `allOwners`, sorted', async () => {
    const w = await mountBoard([
      item({ id: 'TALK-1', owner: 'Priya' }),
      item({ id: 'TALK-2', owner: 'Jules' }),
      item({ id: 'TALK-3', owner: 'Priya' }),
    ]);

    expect((w.vm as unknown as { allOwners: string[] }).allOwners).toEqual(['Jules', 'Priya']);
  });

  it('excludes the "Unassigned" placeholder and blank owners from `allOwners`', async () => {
    const w = await mountBoard([
      item({ id: 'TALK-1', owner: 'Unassigned' }),
      item({ id: 'TALK-2', owner: '' }),
      item({ id: 'TALK-3', owner: 'Priya' }),
    ]);

    expect((w.vm as unknown as { allOwners: string[] }).allOwners).toEqual(['Priya']);
  });
});

describe('Board — wires RoadmapCard `editing` separately from `draggable` (fix #1)', () => {
  it('shows the per-card dirty marker in edit mode even when reordering is not active', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');
    await flushPromises();

    // canReorder is false here (no product filter narrowing the lane) — draggable is gated
    // on it, but the per-card dirty dot/discard affordance must still show; those are gated
    // on `editing` (canEdit && editMode), independently.
    expect((w.vm as unknown as { canReorder: boolean }).canReorder).toBe(false);
    expect(w.find('[data-test="dirty-dot"]').exists()).toBe(true);
    expect(w.find('[data-test="discard-item"]').exists()).toBe(true);
  });
});

describe('Board — confirm before discarding all (fix #2)', () => {
  it('does not clear the draft when the confirmation is dismissed', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    const store = useEditStore();
    store.setField('TALK-1', 'title', 'Edited title');
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    (w.vm as unknown as { onDiscardAll: () => void }).onDiscardAll();

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('Discard all 1 unsynced change'));
    expect(store.dirtyCount.value).toBe(1);
    confirmSpy.mockRestore();
  });

  it('clears the draft once the confirmation is accepted', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    const store = useEditStore();
    store.setField('TALK-1', 'title', 'Edited title');
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    (w.vm as unknown as { onDiscardAll: () => void }).onDiscardAll();

    expect(store.dirtyCount.value).toBe(0);
    confirmSpy.mockRestore();
  });
});

describe('Board — pre-Sync title validation (fix #3, now via the general U5 validation pass)', () => {
  it('blocks Sync and surfaces a friendly message naming the product when a new item has no title (fix #10)', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    useEditStore().addItem('Podcasts & Audiobooks', '', { horizon: 'Next' });

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    expect(syncMock).not.toHaveBeenCalled();
    const bar = w.find('[data-test="sync-bar"]');
    // No title yet to name the item by, so — like the old ad-hoc check — it names the
    // product instead (see validate.ts's `displayNameFor` fallback in Board.vue).
    expect(bar.text()).toContain('Podcasts & Audiobooks');
    expect(bar.text()).toContain('title is required');
  });

  it('names each untitled new item independently, one per product (fix #10)', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    const store = useEditStore();
    store.addItem('Podcasts & Audiobooks', '', { horizon: 'Next' });
    store.addItem('Music App', '   ', { horizon: 'Next' });

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    const text = w.find('[data-test="sync-bar"]').text();
    expect(text).toContain('Podcasts & Audiobooks');
    expect(text).toContain('Music App');
    expect(text).toContain('title is required');
  });

  it('proceeds with Sync once every new item has a title', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: true, sha: 'abc123' });
    const w = await mountBoard();
    useEditStore().addItem('Podcasts & Audiobooks', 'A real title', { horizon: 'Next' });

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    expect(syncMock).toHaveBeenCalledTimes(1);
  });

  it('does not leave a stale "Publishing…" state masking the validation message', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: true, sha: 'abc123' });
    const w = await mountBoard();
    const store = useEditStore();
    store.setField('TALK-1', 'title', 'Edited title');
    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    store.addItem('Podcasts & Audiobooks', '', { horizon: 'Next' });
    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    const bar = w.find('[data-test="sync-bar"]');
    expect(bar.text()).not.toContain('Publishing');
    expect(bar.text()).toContain('title is required');
  });
});

describe('Board — pre-Sync validation (U5/R6): every ValidateFrontmatter-enforced field, not just title/owner', () => {
  it('blocks Sync and names the item + field for an invalid enum value (e.g. a bad horizon)', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard([item({ id: 'TALK-1', title: 'Music App Templates' })]);
    useEditStore().setField('TALK-1', 'horizon', 'Sonn');

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    expect(syncMock).not.toHaveBeenCalled();
    const text = w.find('[data-test="sync-bar"]').text();
    expect(text).toContain('Music App Templates');
    expect(text).toContain('horizon "Sonn" isn\'t a valid horizon');
  });

  it('blocks Sync on a malformed tags value (client-only check, no server rule)', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard([item({ id: 'TALK-1', title: 'Music App Templates' })]);
    useEditStore().setField('TALK-1', 'tags', 'Roadmap, ai');

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    expect(syncMock).not.toHaveBeenCalled();
    const text = w.find('[data-test="sync-bar"]').text();
    expect(text).toContain('Music App Templates');
    expect(text).toContain('lowercase');
  });

  it('blocks Sync on a YAML-unsafe title (client-only check, no server rule)', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard([item({ id: 'TALK-1', title: 'Music App Templates' })]);
    useEditStore().setField('TALK-1', 'title', '2024');

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    expect(syncMock).not.toHaveBeenCalled();
    const text = w.find('[data-test="sync-bar"]').text();
    expect(text).toContain('title "2024" reads as a number');
  });

  it('proceeds with Sync when the changeset is fully valid', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: true, sha: 'abc123' });
    const w = await mountBoard([item({ id: 'TALK-1', title: 'Music App Templates' })]);
    useEditStore().setField('TALK-1', 'stage', 'Shipped');

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    expect(syncMock).toHaveBeenCalledTimes(1);
  });
});

describe('Board — reconcile body edits once raw bodies land (fix #4)', () => {
  it('drops a body edit that already matches the freshly-fetched raw source', async () => {
    const { fetchItems } = await import('../../lib/edit/client');
    (fetchItems as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: 'TALK-1', body: 'Published body text' },
    ]);
    localStorage.setItem('rm-edit-mode', '1');
    const store = useEditStore();
    store.setBody('TALK-1', 'Published body text');

    await mountBoard();
    await flushPromises();

    expect(store.changeset().updated).toEqual([]);
    expect(store.dirtyCount.value).toBe(0);
  });

  it('keeps a body edit that still differs from the freshly-fetched raw source', async () => {
    const { fetchItems } = await import('../../lib/edit/client');
    (fetchItems as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: 'TALK-1', body: 'Published body text' },
    ]);
    localStorage.setItem('rm-edit-mode', '1');
    const store = useEditStore();
    store.setBody('TALK-1', 'Still-unsynced body text');

    await mountBoard();
    await flushPromises();

    expect(store.changeset().updated.find((u) => u.id === 'TALK-1')?.body).toBe('Still-unsynced body text');
  });

  it('a failed raw-bodies fetch resets the request guard so a later editMode toggle retries (not a permanent lock)', async () => {
    const { fetchItems } = await import('../../lib/edit/client');
    (fetchItems as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('network down'));
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');

    // The failed fetch left baseVersionLoaded false — doSync fail-closes (R1) rather than
    // sending an update with no base version to check a conflict against.
    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();
    expect(syncMock).not.toHaveBeenCalled();
    expect(w.find('[data-test="sync-bar"]').text()).toContain('Still loading your workspace');

    // Toggling edit mode off and back on fires the raw-bodies fetch again — if the guard
    // weren't reset on failure, this retry would never even attempt the fetch and Sync would
    // stay permanently blocked until a hard reload.
    (fetchItems as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: 'TALK-1', body: '', sha: 'sha-cm1' },
    ]);
    (w.vm as unknown as { editMode: boolean }).editMode = false;
    await flushPromises();
    (w.vm as unknown as { editMode: boolean }).editMode = true;
    await flushPromises();

    syncMock.mockResolvedValueOnce({ ok: true, sha: 'abc123' });
    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    expect(syncMock).toHaveBeenCalledTimes(1);
  });
});

describe('Board — view-mode body-edit reconcile on reload (U10/R11)', () => {
  it('fetches raw bodies on a plain view-mode mount and reconciles a landed body edit before auto-resume decides', async () => {
    // No `rm-edit-mode` flag saved, so the ONLY reason edit mode would auto-resume is
    // dirtyCount > 0 — a landed body edit must not be allowed to force that, or a plain
    // reload with no real unsynced work would still flash into edit mode (the exact phantom
    // R11 exists to kill).
    const { fetchItems } = await import('../../lib/edit/client');
    (fetchItems as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: 'TALK-1', body: 'Published body text' },
    ]);
    const store = useEditStore();
    store.setBody('TALK-1', 'Published body text'); // already landed on the published site

    const w = await mountBoard();

    expect(fetchItems).toHaveBeenCalledTimes(1);
    expect(store.changeset().updated).toEqual([]);
    expect(store.dirtyCount.value).toBe(0);
    expect(w.find('[data-test="editing-banner"]').exists()).toBe(false);
  });

  it('keeps a genuinely-unsynced body edit after the view-mode reconcile fetch', async () => {
    const { fetchItems } = await import('../../lib/edit/client');
    (fetchItems as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: 'TALK-1', body: 'Published body text' },
    ]);
    const store = useEditStore();
    store.setBody('TALK-1', 'Still unsynced body text');

    await mountBoard();

    expect(store.changeset().updated.find((u) => u.id === 'TALK-1')?.body).toBe('Still unsynced body text');
  });

  it('does not fetch raw bodies on a clean view-mode mount with nothing pending at all', async () => {
    // No draft, no `rm-edit-mode` flag: edit mode never auto-resumes (dirtyCount stays 0), so
    // neither the U10 mount check nor the ordinary edit-mode-entry watcher have any reason to
    // fire — confirms the U10 fetch is conditional, not unconditional on every mount.
    const { fetchItems } = await import('../../lib/edit/client');
    await mountBoard();
    expect(fetchItems).not.toHaveBeenCalled();
  });

  it('a field-only edit auto-resumes edit mode as before, without the U10 body-edit path double-fetching', async () => {
    // A pending FIELD (not body) edit still auto-resumes edit mode (existing U4 behavior,
    // unrelated to U10) — which itself fetches raw bodies once, via the ordinary edit-mode
    // watcher. The U10 mount-time check must not ALSO fetch (hasBodyEdits is false here), so
    // this should still only be exactly one fetch, not two.
    const { fetchItems } = await import('../../lib/edit/client');
    const store = useEditStore();
    store.setField('TALK-1', 'title', 'Field-only edit, no body touched');

    await mountBoard();

    expect(fetchItems).toHaveBeenCalledTimes(1);
    expect(store.changeset().updated.find((u) => u.id === 'TALK-1')?.frontmatter.title).toBe(
      'Field-only edit, no body touched',
    );
  });

  it('degrades gracefully when the view-mode rawBodies fetch fails — no crash, edit left pending', async () => {
    const { fetchItems } = await import('../../lib/edit/client');
    (fetchItems as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('network'));
    const store = useEditStore();
    store.setBody('TALK-1', 'Published body text');

    const w = await mountBoard();

    // No crash, and the mount completed — the edit is simply left pending (conservative: it
    // couldn't be verified against the published source), same as any other reconcile miss.
    expect(w.exists()).toBe(true);
    expect(store.changeset().updated.find((u) => u.id === 'TALK-1')?.body).toBe('Published body text');
  });
});

describe('Board — durable-draft warning (U6/R7)', () => {
  it('surfaces a quiet notice once a draft persist fails, without crashing the edit', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    const store = useEditStore();
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    try {
      expect(() => store.setField('TALK-1', 'title', 'Edited while storage is full')).not.toThrow();
      await flushPromises();
      expect(w.find('[data-test="persist-failed-notice"]').exists()).toBe(true);
      // Still readable/editable in-session even though it never made it to localStorage.
      expect(store.fieldValue('TALK-1', 'title')).toBe('Edited while storage is full');
    } finally {
      spy.mockRestore();
    }
  });

  it('clears the notice once a later persist succeeds', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    const store = useEditStore();
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    store.setField('TALK-1', 'title', 'First edit, fails to persist');
    await flushPromises();
    expect(w.find('[data-test="persist-failed-notice"]').exists()).toBe(true);
    spy.mockRestore();

    store.setField('TALK-1', 'owner', 'Mark');
    await flushPromises();
    expect(w.find('[data-test="persist-failed-notice"]').exists()).toBe(false);
  });

  it('does not show the notice at all when persisting never fails', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Ordinary edit');
    await flushPromises();
    expect(w.find('[data-test="persist-failed-notice"]').exists()).toBe(false);
  });
});

describe('Board — leave & cross-tab guards (U9/R10)', () => {
  it('warns before unload while a sync is in flight', async () => {
    const w = await mountBoard();
    (w.vm as unknown as { syncPending: boolean }).syncPending = true;
    await flushPromises();

    const ev = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev);

    expect(ev.defaultPrevented).toBe(true);
  });

  it('warns before unload when there are unsynced changes', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');
    await flushPromises();

    const ev = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev);

    expect(ev.defaultPrevented).toBe(true);
  });

  it('is silent when the draft is clean', async () => {
    await mountBoard();

    const ev = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev);

    expect(ev.defaultPrevented).toBe(false);
  });

  it('stops warning once a sync lands and nothing has changed since', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: true, sha: 'abc123' });
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    const ev = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev);

    expect(ev.defaultPrevented).toBe(false);
  });

  it('shows a quiet notice when another tab changes the draft', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();

    const otherDraft = {
      fields: { 'TALK-1': { title: 'From another tab' } },
      bodies: {},
      created: [],
      deleted: [],
      reorder: {},
    };
    localStorage.setItem(KEY, JSON.stringify(otherDraft));
    window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: JSON.stringify(otherDraft) }));
    await flushPromises();

    expect(w.find('[data-test="cross-tab-notice"]').exists()).toBe(true);
  });

  it('does not show the cross-tab notice for an identical-draft storage event', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    useEditStore().setField('TALK-1', 'title', 'Edited title');
    const w = await mountBoard();
    const sameJson = localStorage.getItem(KEY)!;

    window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: sameJson }));
    await flushPromises();

    expect(w.find('[data-test="cross-tab-notice"]').exists()).toBe(false);
  });

  it('dismissing the cross-tab notice hides it again', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    const otherDraft = {
      fields: { 'TALK-1': { title: 'From another tab' } },
      bodies: {},
      created: [],
      deleted: [],
      reorder: {},
    };
    localStorage.setItem(KEY, JSON.stringify(otherDraft));
    window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: JSON.stringify(otherDraft) }));
    await flushPromises();
    expect(w.find('[data-test="cross-tab-notice"]').exists()).toBe(true);

    await w.find('[data-test="cross-tab-notice-dismiss"]').trigger('click');
    await flushPromises();

    expect(w.find('[data-test="cross-tab-notice"]').exists()).toBe(false);
  });
});

describe('Board — never show the read-only drawer in edit mode (fix #5)', () => {
  it('closes an open drawer and opens the full editor once edit mode turns on', async () => {
    const w = await mountBoard();
    const vm = w.vm as unknown as { selected: ItemVM | null; editingId: string | null; editMode: boolean };
    vm.selected = item();
    await flushPromises();
    expect(vm.selected).not.toBeNull();

    vm.editMode = true;
    await flushPromises();

    expect(vm.selected).toBeNull();
    expect(vm.editingId).toBe('TALK-1');
  });

  it('lands a card opened via ?item= in edit mode straight in the editor, not the drawer', async () => {
    // Mirrors the `?item=` URL-restore path in onMounted, which sets `selected` directly
    // (bypassing select()) before canEdit/editMode resolve — and the auto-resume check
    // (rm-edit-mode) flips editMode true shortly after, in the same mount.
    localStorage.setItem('rm-edit-mode', '1');
    window.history.replaceState(null, '', '/?item=TALK-1');
    const w = await mountBoard();

    const vm = w.vm as unknown as { selected: ItemVM | null; editingId: string | null };
    expect(vm.selected).toBeNull();
    expect(vm.editingId).toBe('TALK-1');
    // DetailDrawer only renders its overlay while `item` (bound to `selected`) is non-null.
    expect(w.find('.drawer-scrim').exists()).toBe(false);

    window.history.replaceState(null, '', '/');
  });
});

describe('Board — overwrite warning surfaced in SyncBar (fix #7)', () => {
  it('shows the warning once a newer version is live alongside genuinely-unsynced edits', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');
    await flushPromises();

    newVersionCb?.();
    await flushPromises();

    // The top banner switches to the "reload" state (it takes priority), but SyncBar stays
    // mounted underneath it (unsynced is still true) carrying the non-blocking warning.
    expect(w.find('[data-test="overwrite-warning"]').exists()).toBe(true);
  });

  it('is absent when there is nothing unsynced to warn about', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();

    newVersionCb?.();
    await flushPromises();

    expect(w.find('[data-test="sync-bar"]').exists()).toBe(false);
  });
});

describe('Board — new item lands in the focused horizon (fix #9)', () => {
  it('defaults to the single active horizon when grouped by product with exactly one selected', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    const vm = w.vm as unknown as {
      filters: { group: string };
      horizons: string[];
      addToLane: (lane: { key: string }) => void;
    };
    vm.filters.group = 'product';
    vm.horizons = ['Now'];
    await flushPromises();

    vm.addToLane({ key: 'Podcasts & Audiobooks' });

    const created = useEditStore().changeset().created;
    expect(created[created.length - 1]?.frontmatter.horizon).toBe('Now');
  });

  it('falls back to Next when grouped by product with the default (multiple) horizons active', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    const vm = w.vm as unknown as { filters: { group: string }; addToLane: (lane: { key: string }) => void };
    vm.filters.group = 'product';
    await flushPromises();

    vm.addToLane({ key: 'Podcasts & Audiobooks' });

    const created = useEditStore().changeset().created;
    expect(created[created.length - 1]?.frontmatter.horizon).toBe('Next');
  });
});

describe('Board — multi-select horizon filter', () => {
  type HorizonVM = {
    horizons: string[];
    toggleHorizon: (h: string) => void;
  };

  it('defaults the active set to Now/Next/Later', async () => {
    const w = await mountBoard([item({ id: 'TALK-1', horizon: 'Now' })]);
    const vm = w.vm as unknown as HorizonVM;
    expect(vm.horizons.slice().sort()).toEqual(['Later', 'Next', 'Now']);
  });

  it('shows only items whose horizon is in the active set by default', async () => {
    const w = await mountBoard([
      item({ id: 'TALK-1', horizon: 'Now' }),
      item({ id: 'TALK-2', horizon: 'Candidates', title: 'A candidate' }),
      item({ id: 'TALK-3', horizon: 'Completed', title: 'Shipped thing' }),
    ]);
    expect(w.text()).toContain('Existing item');
    expect(w.text()).not.toContain('A candidate');
    expect(w.text()).not.toContain('Shipped thing');
  });

  it('toggling a chip off removes that horizon from the board', async () => {
    const w = await mountBoard([
      item({ id: 'TALK-1', horizon: 'Now' }),
      item({ id: 'TALK-2', horizon: 'Next', title: 'A next item' }),
    ]);
    const vm = w.vm as unknown as HorizonVM;
    vm.toggleHorizon('Next');
    await flushPromises();

    expect(vm.horizons).not.toContain('Next');
    expect(w.text()).toContain('Existing item');
    expect(w.text()).not.toContain('A next item');
  });

  it('toggling Candidates on shows candidate items', async () => {
    const w = await mountBoard([item({ id: 'TALK-1', horizon: 'Candidates', title: 'A candidate' })]);
    const vm = w.vm as unknown as HorizonVM;
    expect(w.text()).not.toContain('A candidate');

    vm.toggleHorizon('Candidates');
    await flushPromises();

    expect(vm.horizons).toContain('Candidates');
    expect(w.text()).toContain('A candidate');
  });

  it('toggling Completed on shows completed items', async () => {
    const w = await mountBoard([item({ id: 'TALK-1', horizon: 'Completed', title: 'Shipped thing' })]);
    const vm = w.vm as unknown as HorizonVM;
    expect(w.text()).not.toContain('Shipped thing');

    vm.toggleHorizon('Completed');
    await flushPromises();

    expect(vm.horizons).toContain('Completed');
    expect(w.text()).toContain('Shipped thing');
  });

  it('deselecting all horizons shows the empty state and nothing else', async () => {
    const w = await mountBoard([item({ id: 'TALK-1', horizon: 'Now' })]);
    const vm = w.vm as unknown as HorizonVM;
    for (const h of [...vm.horizons]) vm.toggleHorizon(h);
    await flushPromises();

    expect(vm.horizons).toEqual([]);
    expect(w.text()).not.toContain('Existing item');
    expect(w.text()).toContain('No horizons selected');
  });

  it('clicking a horizon chip in the template toggles it', async () => {
    const w = await mountBoard([item({ id: 'TALK-1', horizon: 'Now' })]);
    const nowChip = w.find('[data-test="horizon-chip"][data-horizon="Now"]');
    expect(nowChip.attributes('aria-pressed')).toBe('true');

    await nowChip.trigger('click');

    const vm = w.vm as unknown as HorizonVM;
    expect(vm.horizons).not.toContain('Now');
    expect(nowChip.attributes('aria-pressed')).toBe('false');
  });
});

describe('Board — pre-Sync empty-owner validation (fix #10, now via the general U5 validation pass)', () => {
  it('blocks Sync and surfaces a friendly message naming the item when its owner is cleared (fix #10)', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'owner', '   ');

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    expect(syncMock).not.toHaveBeenCalled();
    const bar = w.find('[data-test="sync-bar"]');
    expect(bar.text()).toContain('Existing item');
    expect(bar.text()).toContain('owner is required');
  });

  it('does not block Sync when owner was never touched', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: true, sha: 'abc123' });
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    expect(syncMock).toHaveBeenCalledTimes(1);
  });

  it('does not block a new (created) item that has no owner — the server defaults creates to Unassigned', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: true, sha: 'abc123' });
    const w = await mountBoard();
    useEditStore().addItem('Podcasts & Audiobooks', 'A real title', { horizon: 'Next' });

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    expect(syncMock).toHaveBeenCalledTimes(1);
  });

  it('names each item with a cleared owner in the message (fix #10)', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard([item(), item({ id: 'TALK-2', title: 'Second item' })]);
    const store = useEditStore();
    store.setField('TALK-1', 'owner', '');
    store.setField('TALK-2', 'owner', '');

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    const text = w.find('[data-test="sync-bar"]').text();
    expect(text).toContain('Existing item');
    expect(text).toContain('Second item');
    expect(text).toContain('owner is required');
  });

  it('caps a long list of named items with a cleared owner at 3, then "+N more" (fix #10)', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard([
      item({ id: 'TALK-1', title: 'Alpha' }),
      item({ id: 'TALK-2', title: 'Bravo' }),
      item({ id: 'TALK-3', title: 'Charlie' }),
      item({ id: 'TALK-4', title: 'Delta' }),
      item({ id: 'TALK-5', title: 'Echo' }),
    ]);
    const store = useEditStore();
    for (const id of ['TALK-1', 'TALK-2', 'TALK-3', 'TALK-4', 'TALK-5']) store.setField(id, 'owner', '');

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    const text = w.find('[data-test="sync-bar"]').text();
    expect(text).toContain('Alpha');
    expect(text).toContain('Bravo');
    expect(text).toContain('Charlie');
    expect(text).not.toContain('Delta');
    expect(text).toContain('+2 more');
  });
});

describe('Board — closing a new item keeps partial work (fix #3)', () => {
  it('keeps a just-created, untitled item once it has a body edit', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    const store = useEditStore();
    const id = store.addItem('Podcasts & Audiobooks', '', { horizon: 'Next' });
    store.setBody(id, 'Some real body content');
    (w.vm as unknown as { editingId: string | null }).editingId = id;
    await flushPromises();

    (w.vm as unknown as { onEditorClose: () => void }).onEditorClose();

    expect(store.changeset().created).toHaveLength(1);
  });

  it('keeps a just-created, untitled item once it has a non-title field edit', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    const store = useEditStore();
    const id = store.addItem('Podcasts & Audiobooks', '', { horizon: 'Next' });
    store.setField(id, 'stage', 'Building');
    (w.vm as unknown as { editingId: string | null }).editingId = id;
    await flushPromises();

    (w.vm as unknown as { onEditorClose: () => void }).onEditorClose();

    expect(store.changeset().created).toHaveLength(1);
  });

  it('still discards a truly untouched new item (blank title, no other edits)', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    const store = useEditStore();
    const id = store.addItem('Podcasts & Audiobooks', '', { horizon: 'Next' });
    (w.vm as unknown as { editingId: string | null }).editingId = id;
    await flushPromises();

    (w.vm as unknown as { onEditorClose: () => void }).onEditorClose();

    expect(store.changeset().created).toEqual([]);
  });
});

describe('Board — unpublished-work indicator in view mode (fix #5)', () => {
  it('is hidden in edit mode', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');
    await flushPromises();

    expect(w.find('[data-test="unpublished-indicator"]').exists()).toBe(false);
  });

  it('is hidden when there is nothing dirty, even out of edit mode', async () => {
    const w = await mountBoard();
    expect(w.find('[data-test="unpublished-indicator"]').exists()).toBe(false);
  });

  it('shows once there is a dirty draft and the user is out of edit mode, and resumes editing on click', async () => {
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');
    (w.vm as unknown as { editMode: boolean }).editMode = false;
    await flushPromises();

    const pill = w.find('[data-test="unpublished-indicator"]');
    expect(pill.exists()).toBe(true);
    expect(pill.text()).toContain('1 unpublished change');
    expect(pill.text()).toContain('Resume editing');

    await pill.trigger('click');

    expect((w.vm as unknown as { editMode: boolean }).editMode).toBe(true);
  });
});

describe('Board — network-flake sync failure gives reload advice, not a blind retry prompt (fix #9)', () => {
  it('sets a distinct reload-advice message when the sync request throws', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockRejectedValueOnce(new Error('Failed to fetch'));
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    const bar = w.find('[data-test="sync-bar"]');
    expect(bar.text()).toContain("Couldn't confirm the sync completed");
    expect(bar.text()).toContain('Reload');
    expect(bar.text()).toContain('duplicates');
  });

  it('keeps the clean, fixable message for a clean (non-OK) server response, unlike the caught-exception path', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: false, errors: ['stage: invalid'] });
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    const bar = w.find('[data-test="sync-bar"]');
    expect(bar.text()).toContain('stage: invalid');
    expect(bar.text()).not.toContain('duplicates');
  });
});

describe('Board — session-expiry re-auth path (fix #2)', () => {
  it('surfaces a "Sign in again" action in the banner when sync reports an auth error', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: false, authError: true, errors: ['Your session expired'] });
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    const banner = w.find('[data-test="banner-auth-expired"]');
    expect(banner.exists()).toBe(true);
    expect(banner.text()).toContain('session expired');
    expect(banner.text()).toContain('saved');
    expect(w.find('[data-test="sign-in-again"]').exists()).toBe(true);
    // The unsynced count still shows in the (still-mounted) SyncBar, and the draft is untouched.
    expect(useEditStore().dirtyCount.value).toBeGreaterThan(0);
  });

  it('keeps the draft intact and does not call sync a second time until the user clicks "Sign in again"', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: false, authError: true, errors: ['Your session expired'] });
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    expect(useEditStore().changeset().updated.find((u) => u.id === 'TALK-1')?.frontmatter.title).toBe(
      'Edited title',
    );
    expect(syncMock).toHaveBeenCalledTimes(1);
  });

  it('navigates to the GitHub sign-in URL when "Sign in again" is clicked', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: false, authError: true, errors: ['Your session expired'] });
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');
    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    // signIn() (unchanged, existing code) does `window.location.href = loginUrl()` — swap in
    // a stand-in `location` for this one test only, and restore the real one immediately after
    // so it doesn't leak into other tests in this file (e.g. the `location.reload` spy in
    // `beforeEach`).
    const originalLocation = window.location;
    const hrefSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...originalLocation, set href(v: string) { hrefSpy(v); } },
      configurable: true,
      writable: true,
    });
    try {
      await w.find('[data-test="sign-in-again"]').trigger('click');
      expect(hrefSpy).toHaveBeenCalledWith('#'); // loginUrl() is mocked to '#' at the top of this file
    } finally {
      Object.defineProperty(window, 'location', { value: originalLocation, configurable: true, writable: true });
    }
  });

  it('resets sessionExpired once a later sync succeeds', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: false, authError: true, errors: ['Your session expired'] });
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');
    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();
    expect(w.find('[data-test="banner-auth-expired"]').exists()).toBe(true);

    syncMock.mockResolvedValueOnce({ ok: true, sha: 'abc123' });
    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    expect(w.find('[data-test="banner-auth-expired"]').exists()).toBe(false);
  });

  it('a stale sessionExpired does not mask a subsequently-raised validationBlocked banner', async () => {
    // authExpired outranks validationBlocked in bannerState precedence, so a leftover
    // sessionExpired=true from an earlier auth failure must not survive into (and mask) a
    // later attempt that gets caught by pre-flight validation instead.
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: false, authError: true, errors: ['Your session expired'] });
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');
    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();
    expect(w.find('[data-test="banner-auth-expired"]').exists()).toBe(true);

    // A new sync attempt is now blocked by pre-flight validation (an untitled new item) —
    // this early-return path never calls sync() at all, so it must reset sessionExpired
    // itself for the validationBlocked banner to actually show through.
    useEditStore().addItem('Podcasts & Audiobooks', '', { horizon: 'Next' });
    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    expect(w.find('[data-test="banner-auth-expired"]').exists()).toBe(false);
    const bar = w.find('[data-test="sync-bar"]');
    expect(bar.text()).toContain('title is required');
  });
});

describe('Board — concurrent-publish (non-fast-forward) message (fix #3)', () => {
  it('shows a friendly "someone else published" message when the server errors mention a non-fast-forward ref update', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({
      ok: false,
      errors: ['failed to update ref: not a fast forward'],
    });
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    const bar = w.find('[data-test="sync-bar"]');
    expect(bar.text()).toContain('Someone else published in the meantime');
    expect(bar.text()).toContain('reload');
  });

  it('keeps the generic validation-error message for an unrelated 422', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: false, errors: ['stage: invalid'] });
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    const bar = w.find('[data-test="sync-bar"]');
    expect(bar.text()).toContain("Couldn't publish");
    expect(bar.text()).toContain('stage: invalid');
    expect(bar.text()).not.toContain('Someone else published');
  });
});

describe('Board — base-version map gates Sync (U2/R1 fail-closed)', () => {
  it('blocks Sync until the base-version map (the /api/items sha fetch alongside rawBodies) has loaded', async () => {
    const { fetchItems } = await import('../../lib/edit/client');
    let resolveFetch!: (items: { id: string; body: string; sha?: string }[]) => void;
    (fetchItems as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () =>
        new Promise<{ id: string; body: string; sha?: string }[]>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    expect(syncMock).not.toHaveBeenCalled();
    expect(w.find('[data-test="sync-bar"]').text()).toContain('Still loading your workspace');

    // Once the base-version map actually lands, Sync proceeds normally.
    syncMock.mockResolvedValueOnce({ ok: true, sha: 'abc123' });
    resolveFetch([{ id: 'TALK-1', body: '', sha: 'sha-cm1' }]);
    await flushPromises();

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    expect(syncMock).toHaveBeenCalledTimes(1);
  });

  it('threads baseSha (captured from /api/items) and a requestId into the Sync payload once loaded', async () => {
    const { fetchItems } = await import('../../lib/edit/client');
    (fetchItems as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: 'TALK-1', body: '', sha: 'sha-cm1' },
    ]);
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: true, sha: 'newsha' });
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    expect(syncMock).toHaveBeenCalledTimes(1);
    const sent = syncMock.mock.calls[0][0];
    expect(sent.updated[0]).toMatchObject({ id: 'TALK-1' });
    expect(sent.baseShas['TALK-1']).toBe('sha-cm1'); // single baseShas map (matches edit-service Changeset.BaseShas)
    expect(typeof sent.requestId).toBe('string');
    expect(sent.requestId.length).toBeGreaterThan(0);
  });

  it('omits baseSha for a newly-created item — creates have no prior file to base against', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: true, sha: 'newsha' });
    const w = await mountBoard();
    useEditStore().addItem('Podcasts & Audiobooks', 'A new one', { horizon: 'Next' });

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    const sent = syncMock.mock.calls[0][0];
    expect(sent.created[0]).not.toHaveProperty('baseSha');
  });
});

describe('Board — per-item base-version conflict message (U2/R2)', () => {
  it('shows the "someone updated" reload message naming the item on a 422 conflict, draft intact', async () => {
    const { fetchItems } = await import('../../lib/edit/client');
    (fetchItems as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: 'TALK-1', body: '', sha: 'sha-cm1' },
    ]);
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: false, conflict: ['TALK-1'] });
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    const bar = w.find('[data-test="sync-bar"]');
    expect(bar.text()).toContain('Someone updated');
    expect(bar.text()).toContain('Existing item'); // TALK-1's published title, from byId
    expect(bar.text()).toContain('reload');
    expect(bar.text()).toContain('re-sync');
    // Draft is untouched — nothing was discarded by the rejection.
    expect(useEditStore().changeset().updated.find((u) => u.id === 'TALK-1')?.frontmatter.title).toBe(
      'Edited title',
    );
  });

  it('still recognizes the whole-branch fast-forward message when there is no per-item conflict (additive, not replaced)', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: false, errors: ['failed to update ref: not a fast forward'] });
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    const bar = w.find('[data-test="sync-bar"]');
    expect(bar.text()).toContain('Someone else published in the meantime');
  });
});

describe('Board — idempotent Sync requestId (U3/R3)', () => {
  it('reuses the same requestId across a retry of the identical changeset, then mints a fresh one after success', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: false, errors: ['stage: invalid'] });
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();
    const firstId = syncMock.mock.calls[0][0].requestId;
    expect(typeof firstId).toBe('string');

    // Retry of the SAME (still-rejected) changeset reuses the id.
    syncMock.mockResolvedValueOnce({ ok: false, errors: ['stage: invalid'] });
    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();
    expect(syncMock.mock.calls[1][0].requestId).toBe(firstId);

    // Fix the field so the retry actually succeeds.
    useEditStore().setField('TALK-1', 'stage', 'Building');
    syncMock.mockResolvedValueOnce({ ok: true, sha: 'landed-sha' });
    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();
    const thirdId = syncMock.mock.calls[2][0].requestId;
    expect(thirdId).not.toBe(firstId);

    // A later, unrelated edit + Sync after that success mints yet another fresh id.
    useEditStore().setField('TALK-1', 'owner', 'Mark');
    syncMock.mockResolvedValueOnce({ ok: true, sha: 'landed-sha-2' });
    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();
    expect(syncMock.mock.calls[3][0].requestId).not.toBe(thirdId);
  });
});

describe('Board — post-sync base refresh (liveItems)', () => {
  // The root bug this whole unit fixes: after a successful Sync, the client's base state
  // (liveItems/baseShaMap) went stale until a full reload — `refreshLiveItems` (called at the
  // end of doSync's `res.ok` branch) now re-fetches `/api/items` (git-fresh) and reconciles
  // the draft against it immediately, closing the self-conflict / false-unpublished-change /
  // duplicate-create bug family without waiting on a reload.

  it('carries a fresh baseSha into the NEXT sync of the same item — no self-conflict on re-edit', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const { fetchItems } = await import('../../lib/edit/client');
    // Mount-time loadRawBodies fetch (edit mode auto-resumes from the saved flag) — the
    // original, pre-sync base version.
    (fetchItems as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: 'TALK-1', sha: 'sha-1', frontmatter: { title: 'Existing item' }, body: '' },
    ]);
    const w = await mountBoard();
    const store = useEditStore();
    store.setField('TALK-1', 'title', 'First edit');

    // First Sync lands; refreshLiveItems's own fetchItems call sees the freshly-committed
    // state (title now matches what was just sent, and a NEW blob sha).
    syncMock.mockResolvedValueOnce({ ok: true, sha: 'commit-1' });
    (fetchItems as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: 'TALK-1', sha: 'sha-2', frontmatter: { title: 'First edit' }, body: '' },
    ]);
    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();
    // The landed edit reconciles away — nothing pending on TALK-1 anymore.
    expect(store.changeset().updated).toEqual([]);

    // Edit the SAME item again and sync a second time.
    store.setField('TALK-1', 'title', 'Second edit');
    syncMock.mockResolvedValueOnce({ ok: true, sha: 'commit-2' });
    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    // The 2nd sync's payload must carry the FRESH baseSha from the refreshed map
    // ('sha-2', captured after the first sync), not the stale one from mount ('sha-1') —
    // sending the stale sha here is exactly the self-conflict bug (a false "someone updated
    // this item" against the client's own just-landed commit).
    expect(syncMock).toHaveBeenCalledTimes(2);
    expect(syncMock.mock.calls[1]![0].baseShas['TALK-1']).toBe('sha-2');
    expect(w.find('[data-test="banner-conflict"]').exists()).toBe(false);
  });

  it('reconciles away a landed create (matched by product+title) so the next changeset never re-sends it — no duplicate', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    const store = useEditStore();
    const createdId = store.addItem('Podcasts & Audiobooks', 'Brand new card', { horizon: 'Next' });
    expect(store.changeset().created).toHaveLength(1);

    syncMock.mockResolvedValueOnce({ ok: true, sha: 'commit-1' });
    const { fetchItems } = await import('../../lib/edit/client');
    (fetchItems as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: 'TALK-1', sha: 'sha-1', frontmatter: { title: 'Existing item' }, body: '' },
      // The just-created card, now landed under its real, server-minted id.
      { id: 'TALK-99', sha: 'sha-99', frontmatter: { title: 'Brand new card', product: 'Podcasts & Audiobooks' }, body: '' },
    ]);

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    const cs = store.changeset();
    expect(cs.created.find((c) => c.id === createdId)).toBeUndefined();
    expect(cs.created).toEqual([]);
  });

  it('drops dirtyCount to 0 once a publish fully lands, without waiting on a reload', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    const store = useEditStore();
    store.setField('TALK-1', 'title', 'Fully published edit');
    expect(store.dirtyCount.value).toBeGreaterThan(0);

    syncMock.mockResolvedValueOnce({ ok: true, sha: 'commit-1' });
    const { fetchItems } = await import('../../lib/edit/client');
    (fetchItems as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: 'TALK-1', sha: 'sha-2', frontmatter: { title: 'Fully published edit' }, body: '' },
    ]);

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    expect(store.dirtyCount.value).toBe(0);
  });

  it('exits edit mode directly on Done after a fully-published edit — no false "unpublished change" prompt', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    const store = useEditStore();
    store.setField('TALK-1', 'title', 'Fully published edit');

    syncMock.mockResolvedValueOnce({ ok: true, sha: 'commit-1' });
    const { fetchItems } = await import('../../lib/edit/client');
    (fetchItems as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: 'TALK-1', sha: 'sha-2', frontmatter: { title: 'Fully published edit' }, body: '' },
    ]);
    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    (w.vm as unknown as { toggleEditMode: () => void }).toggleEditMode();
    await flushPromises();

    expect((w.vm as unknown as { exitPromptOpen: boolean }).exitPromptOpen).toBe(false);
    expect((w.vm as unknown as { editMode: boolean }).editMode).toBe(false);
  });

  it('degrades silently when the post-sync refresh fetch fails — draft intact, board still usable', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    const store = useEditStore();
    store.setField('TALK-1', 'title', 'Still unsynced after refresh failure');

    syncMock.mockResolvedValueOnce({ ok: true, sha: 'commit-1' });
    const { fetchItems } = await import('../../lib/edit/client');
    (fetchItems as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('network down'));

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    // The refresh failed — liveItems/baseShaMap are left exactly as they were; the edit
    // (now landed server-side, per the mocked sha, but never confirmed to THIS tab) stays
    // pending rather than being silently dropped or crashing the board.
    expect(store.changeset().updated.find((u) => u.id === 'TALK-1')?.frontmatter.title).toBe(
      'Still unsynced after refresh failure',
    );
    // The board itself keeps rendering normally — a failed background refresh degrades
    // silently rather than breaking the edit surface.
    expect(w.find('[data-test="editing-banner"]').exists()).toBe(true);
  });
});

describe('Board — edit banner layering and mobile-safe markup (fix #10)', () => {
  it('is hidden while the full-screen editor is open', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    (w.vm as unknown as { editingId: string | null }).editingId = 'TALK-1';
    await flushPromises();

    expect(w.find('[data-test="editing-banner"]').exists()).toBe(false);
  });

  it('is hidden while the share dialog is open', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    (w.vm as unknown as { shareOpen: boolean }).shareOpen = true;
    await flushPromises();

    expect(w.find('[data-test="editing-banner"]').exists()).toBe(false);
  });

  it('reappears once the full-screen editor closes', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    const vm = w.vm as unknown as { editingId: string | null };
    vm.editingId = 'TALK-1';
    await flushPromises();
    vm.editingId = null;
    await flushPromises();

    expect(w.find('[data-test="editing-banner"]').exists()).toBe(true);
  });

  it('wraps onto multiple lines on narrow viewports instead of overflowing (no fixed-height spacer to keep in sync)', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    const banner = w.get('[data-test="editing-banner"]');

    // `flex-wrap` + `min-w-0` text spans let long copy (e.g. the reload prompt + button, or
    // the unsynced count) wrap on narrow screens; there's no longer a separate fixed-height
    // spacer element to fall out of sync with the banner's actual (possibly wrapped) height —
    // `position: sticky` reserves its own space in normal flow automatically.
    expect(banner.classes()).toContain('flex-wrap');
    expect(w.find('.edit-banner-spacer').exists()).toBe(false);
  });
});

describe('Board — ItemEditor `published` prop + reset-field wiring (fix #5)', () => {
  it('passes the published (unedited) base item, so a locally-changed field shows the changed indicator', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    const store = useEditStore();
    store.setField('TALK-1', 'stage', 'Shipped');
    (w.vm as unknown as { editingId: string | null }).editingId = 'TALK-1';
    await flushPromises();

    expect(w.find('[data-test="changed-dot-stage"]').exists()).toBe(true);
  });

  it('passes published=null for a never-published (locally-created) item, hiding changed markers', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    const store = useEditStore();
    const id = store.addItem('Podcasts & Audiobooks', 'Brand new item', { horizon: 'Next' });
    (w.vm as unknown as { editingId: string | null }).editingId = id;
    await flushPromises();

    expect(w.find('[data-test="changed-dot-title"]').exists()).toBe(false);
  });

  it('clicking a field reset button calls editStore.revertField, dropping just that field', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    const store = useEditStore();
    store.setField('TALK-1', 'stage', 'Shipped');
    store.setField('TALK-1', 'owner', 'Mark');
    (w.vm as unknown as { editingId: string | null }).editingId = 'TALK-1';
    await flushPromises();

    await w.find('[data-test="reset-field-stage"]').trigger('click');
    await flushPromises();

    expect(store.fieldValue('TALK-1', 'stage')).toBeUndefined();
    expect(store.fieldValue('TALK-1', 'owner')).toBe('Mark');
  });
});

describe('Board — ItemEditor live card preview (fix #6)', () => {
  it('reflects the CURRENT (working-copy) title as it is edited, not the published one', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    const store = useEditStore();
    store.setField('TALK-1', 'title', 'Renamed while editing');
    (w.vm as unknown as { editingId: string | null }).editingId = 'TALK-1';
    await flushPromises();

    expect(w.find('[data-test="preview-title"]').text()).toBe('Renamed while editing');
  });
});

describe('Board — inline card rename wiring (fix #2)', () => {
  it('applies a card rename straight into the changeset via setField', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();

    (w.vm as unknown as { onCardRename: (p: { id: string; title: string }) => void }).onCardRename({
      id: 'TALK-1',
      title: 'Renamed via card',
    });

    expect(useEditStore().fieldValue('TALK-1', 'title')).toBe('Renamed via card');
  });

  it('works for a not-yet-synced new-id item too', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    const store = useEditStore();
    const newId = store.addItem('Podcasts & Audiobooks', '', { horizon: 'Next' });

    (w.vm as unknown as { onCardRename: (p: { id: string; title: string }) => void }).onCardRename({
      id: newId,
      title: 'First title',
    });

    expect(store.changeset().created.find((c) => c.id === newId)?.title).toBe('First title');
  });

  it('ignores an empty rename title (a no-op, nothing gets marked dirty)', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();

    (w.vm as unknown as { onCardRename: (p: { id: string; title: string }) => void }).onCardRename({
      id: 'TALK-1',
      title: '',
    });

    expect(useEditStore().isDirty('TALK-1')).toBe(false);
  });
});

describe('Board — duplicate an item (fix #3)', () => {
  it('creates a copy of the source item (product/title/fields/body) and opens the editor for it', async () => {
    const { fetchItems } = await import('../../lib/edit/client');
    (fetchItems as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: 'TALK-1', body: 'Original body text' },
    ]);
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();

    (w.vm as unknown as { onCardDuplicate: (id: string) => void }).onCardDuplicate('TALK-1');

    const store = useEditStore();
    const created = store.changeset().created;
    expect(created).toHaveLength(1);
    const copy = created[0]!;
    expect(copy.product).toBe('Podcasts & Audiobooks');
    expect(copy.title).toBe('Existing item (copy)');
    expect(copy.frontmatter.horizon).toBe('Now');
    expect(copy.frontmatter.stage).toBe('Building');
    expect(copy.frontmatter.owner).toBe('mark@example.com');
    expect(copy.frontmatter.impact).toBe('High');
    expect(copy.frontmatter.effort).toBe('Low');
    expect(copy.frontmatter.visibility).toBe('Internal');
    expect(copy.frontmatter.tags).toBe('workflow');
    expect(copy.body).toBe('Original body text');

    expect((w.vm as unknown as { editingId: string | null }).editingId).toBe(copy.id);
  });

  it('omits empty frontmatter values so a blank owner/impact/effort does not trip validation', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard([
      item({ id: 'TALK-2', owner: '', impact: null, effort: null, tags: [] }),
    ]);

    (w.vm as unknown as { onCardDuplicate: (id: string) => void }).onCardDuplicate('TALK-2');

    const copy = useEditStore().changeset().created[0]!;
    expect(copy.frontmatter.owner).toBeUndefined();
    expect(copy.frontmatter.impact).toBeUndefined();
    expect(copy.frontmatter.effort).toBeUndefined();
    expect(copy.frontmatter.tags).toBeUndefined();
  });
});

type ChangeSummary = {
  edited: { id: string; title: string }[];
  created: { title: string; product: string }[];
  deleted: { id: string; title: string }[];
  reorderLanes: number;
};

describe('Board — change summary for review (fix #8)', () => {
  it('resolves edited/created/deleted names via byId and counts reordered lanes', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard([
      item({ id: 'TALK-1', title: 'First item' }),
      item({ id: 'TALK-2', title: 'Second item', order: 2 }),
    ]);
    const store = useEditStore();
    store.setField('TALK-1', 'title', 'First item edited');
    store.deleteItem('TALK-2');
    const newId = store.addItem('Podcasts & Audiobooks', 'A brand new item', { horizon: 'Next' });
    store.reorder('Podcasts & Audiobooks', 'Now', ['TALK-1']);
    await flushPromises();

    const summary = (w.vm as unknown as { changeSummary: ChangeSummary }).changeSummary;

    // Edited names resolve to the PUBLISHED title (from byId), not the locally-edited
    // value — that's what "what's about to change" should read as.
    expect(summary.edited).toEqual([{ id: 'TALK-1', title: 'First item' }]);
    expect(summary.created).toEqual([{ title: 'A brand new item', product: 'Podcasts & Audiobooks' }]);
    expect(summary.deleted).toEqual([{ id: 'TALK-2', title: 'Second item' }]);
    expect(summary.reorderLanes).toBe(1);
    expect(newId).toMatch(/^new-/);
  });

  it('opening the Review popover in SyncBar shows the edited/created/deleted/reordered summary', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard([
      item({ id: 'TALK-1', title: 'First item' }),
      item({ id: 'TALK-2', title: 'Second item', order: 2 }),
    ]);
    const store = useEditStore();
    store.setField('TALK-1', 'title', 'First item edited');
    store.deleteItem('TALK-2');
    store.addItem('Podcasts & Audiobooks', 'A brand new item', { horizon: 'Next' });
    store.reorder('Podcasts & Audiobooks', 'Now', ['TALK-1']);
    await flushPromises();

    expect(w.find('[data-test="review-panel"]').exists()).toBe(false);
    await w.get('[data-test="review-toggle"]').trigger('click');

    const panel = w.get('[data-test="review-panel"]');
    expect(panel.text()).toContain('First item');
    expect(panel.text()).toContain('A brand new item');
    expect(panel.text()).toContain('Second item');
    expect(panel.text()).toContain('Reordered 1 lane');
  });
});

describe('Board — global keyboard shortcuts (fix #9)', () => {
  it('"e" toggles edit mode when canEdit', async () => {
    const w = await mountBoard();
    expect((w.vm as unknown as { editMode: boolean }).editMode).toBe(false);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e' }));
    await flushPromises();
    expect((w.vm as unknown as { editMode: boolean }).editMode).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e' }));
    await flushPromises();
    expect((w.vm as unknown as { editMode: boolean }).editMode).toBe(false);
  });

  it('"e" is a no-op for a non-editor', async () => {
    meMock.mockResolvedValueOnce({ editor: false, login: '' });
    const w = await mountBoard();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e' }));
    await flushPromises();
    expect((w.vm as unknown as { editMode: boolean }).editMode).toBe(false);
  });

  it('"n" opens a new item in edit mode', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n' }));
    await flushPromises();

    expect((w.vm as unknown as { editingId: string | null }).editingId).not.toBeNull();
  });

  it('"n" is a no-op outside edit mode', async () => {
    const w = await mountBoard();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n' }));
    await flushPromises();

    expect((w.vm as unknown as { editingId: string | null }).editingId).toBeNull();
  });

  it('Cmd/Ctrl+Enter triggers Sync when there are unsynced changes', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: true, sha: 'abc123' });
    await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');
    await flushPromises();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true }));
    await flushPromises();

    expect(syncMock).toHaveBeenCalledTimes(1);
  });

  it('Cmd/Ctrl+Enter is a no-op with nothing unsynced', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    await mountBoard();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true }));
    await flushPromises();

    expect(syncMock).not.toHaveBeenCalled();
  });

  it('ignores every shortcut while focus is inside a text input', async () => {
    const w = await mountBoard();
    const input = document.createElement('input');
    document.body.appendChild(input);
    try {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', bubbles: true }));
      await flushPromises();
      expect((w.vm as unknown as { editMode: boolean }).editMode).toBe(false);

      input.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }));
      await flushPromises();
      expect(w.find('[data-test="shortcuts-cheatsheet"]').exists()).toBe(false);
    } finally {
      document.body.removeChild(input);
    }
  });

  it('"?" opens the shortcuts cheat-sheet, and Escape closes it', async () => {
    const w = await mountBoard();
    expect(w.find('[data-test="shortcuts-cheatsheet"]').exists()).toBe(false);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }));
    await flushPromises();
    expect(w.find('[data-test="shortcuts-cheatsheet"]').exists()).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(w.find('[data-test="shortcuts-cheatsheet"]').exists()).toBe(false);
  });
});

describe('Board — sync-success toast with commit link (fix #10)', () => {
  it('shows a dismissible toast with a link to the commit after a successful sync', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: true, sha: 'abc1234567' });
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    const toast = w.get('[data-test="sync-toast"]');
    expect(toast.text()).toContain('Published');
    const link = w.get('[data-test="sync-toast-link"]');
    expect(link.attributes('href')).toBe('https://github.com/markpasternak/product-roadmap-generalized/commit/abc1234567');
    expect(link.text()).toBe('abc1234');
  });

  it('dismisses the toast when clicked', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: true, sha: 'abc1234567' });
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');
    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    await w.get('[data-test="sync-toast-dismiss"]').trigger('click');
    expect(w.find('[data-test="sync-toast"]').exists()).toBe(false);
  });

  it('auto-dismisses on its own after ~6s', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: true, sha: 'abc1234567' });
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');

    vi.useFakeTimers();
    try {
      await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
      await flushPromises();
      expect(w.find('[data-test="sync-toast"]').exists()).toBe(true);

      await vi.advanceTimersByTimeAsync(6000);
      await flushPromises();
      expect(w.find('[data-test="sync-toast"]').exists()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not show a toast for a failed sync', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: false, errors: ['boom'] });
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    expect(w.find('[data-test="sync-toast"]').exists()).toBe(false);
  });
});

describe('Board — "Done" exit prompt: Publish / Keep / Discard (U11/R12)', () => {
  it('exits edit mode directly, with no prompt, when there is nothing unsynced', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    expect(useEditStore().dirtyCount.value).toBe(0);

    await w.get('[data-test="edit-toggle"]').trigger('click');
    await flushPromises();

    expect(w.find('[data-test="exit-edit-prompt"]').exists()).toBe(false);
    expect(w.find('[data-test="editing-banner"]').exists()).toBe(false);
  });

  it('shows the Publish/Keep/Discard prompt instead of exiting when there are unsynced changes', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');
    await flushPromises();

    await w.get('[data-test="edit-toggle"]').trigger('click');
    await flushPromises();

    expect(w.find('[data-test="exit-edit-prompt"]').exists()).toBe(true);
    // Still in edit mode — nothing decided yet.
    expect(w.find('[data-test="editing-banner"]').exists()).toBe(true);
    expect(useEditStore().dirtyCount.value).toBe(1);
  });

  it('the "e" keyboard shortcut goes through the same prompt as the button', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');
    await flushPromises();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e' }));
    await flushPromises();

    expect(w.find('[data-test="exit-edit-prompt"]').exists()).toBe(true);
  });

  it('Publish now runs doSync and exits edit mode once it lands', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: true, sha: 'abc123' });
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');
    await flushPromises();

    await w.get('[data-test="edit-toggle"]').trigger('click');
    await flushPromises();
    await w.get('[data-test="exit-publish"]').trigger('click');
    await flushPromises();

    expect(syncMock).toHaveBeenCalledTimes(1);
    expect(w.find('[data-test="exit-edit-prompt"]').exists()).toBe(false);
    expect(w.find('[data-test="editing-banner"]').exists()).toBe(false);
  });

  it('Publish now stays in edit mode with the error visible if the sync fails', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: false, errors: ['boom'] });
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');
    await flushPromises();

    await w.get('[data-test="edit-toggle"]').trigger('click');
    await w.get('[data-test="exit-publish"]').trigger('click');
    await flushPromises();

    expect(syncMock).toHaveBeenCalledTimes(1);
    expect(w.find('[data-test="exit-edit-prompt"]').exists()).toBe(false);
    // Still editing — the draft never left, and the failure is visible in SyncBar.
    expect(w.find('[data-test="editing-banner"]').exists()).toBe(true);
    expect(useEditStore().dirtyCount.value).toBe(1);
    expect(w.find('[data-test="sync-bar"]').text()).toContain('boom');
  });

  it('Keep for later exits to view mode with the draft fully intact, without syncing', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');
    await flushPromises();

    await w.get('[data-test="edit-toggle"]').trigger('click');
    await w.get('[data-test="exit-keep"]').trigger('click');
    await flushPromises();

    expect(syncMock).not.toHaveBeenCalled();
    expect(w.find('[data-test="exit-edit-prompt"]').exists()).toBe(false);
    expect(w.find('[data-test="editing-banner"]').exists()).toBe(false);
    expect(useEditStore().dirtyCount.value).toBe(1);
    expect(useEditStore().changeset().updated.find((u) => u.id === 'TALK-1')?.frontmatter.title).toBe('Edited title');
  });

  it('Discard does nothing until the confirmation is accepted, then clears the draft and exits', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');
    await flushPromises();

    await w.get('[data-test="edit-toggle"]').trigger('click');

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    await w.get('[data-test="exit-discard"]').trigger('click');
    await flushPromises();
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('Discard all 1 unsynced change'));
    // Dismissed — prompt still up, draft untouched.
    expect(w.find('[data-test="exit-edit-prompt"]').exists()).toBe(true);
    expect(useEditStore().dirtyCount.value).toBe(1);

    confirmSpy.mockReturnValueOnce(true);
    await w.get('[data-test="exit-discard"]').trigger('click');
    await flushPromises();

    expect(useEditStore().dirtyCount.value).toBe(0);
    expect(w.find('[data-test="exit-edit-prompt"]').exists()).toBe(false);
    expect(w.find('[data-test="editing-banner"]').exists()).toBe(false);
    confirmSpy.mockRestore();
  });

  it('Escape (or a backdrop click) dismisses the prompt without deciding anything — still editing', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');
    await flushPromises();

    await w.get('[data-test="edit-toggle"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-test="exit-edit-prompt"]').exists()).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();

    expect(w.find('[data-test="exit-edit-prompt"]').exists()).toBe(false);
    expect(w.find('[data-test="editing-banner"]').exists()).toBe(true);
    expect(useEditStore().dirtyCount.value).toBe(1);
  });
});

describe('Board — skipped-reorders notice after sync (U8/R9)', () => {
  it('shows a visible notice naming the item(s) when a successful sync reports skippedReorders', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: true, sha: 'abc123', skippedReorders: ['TALK-1'] });
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    const notice = w.find('[data-test="skipped-reorder-notice"]');
    expect(notice.exists()).toBe(true);
    expect(notice.text()).toContain("couldn't be applied");
    expect(notice.text()).toContain('Existing item'); // TALK-1's title, resolved via byId
  });

  it('falls back to the raw id when the item is not in byId (e.g. it was also deleted upstream)', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: true, sha: 'abc123', skippedReorders: ['UNKNOWN-9'] });
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    expect(w.find('[data-test="skipped-reorder-notice"]').text()).toContain('UNKNOWN-9');
  });

  it('shows no notice when skippedReorders is absent or empty', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: true, sha: 'abc123' });
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    expect(w.find('[data-test="skipped-reorder-notice"]').exists()).toBe(false);
  });

  it('is dismissible', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: true, sha: 'abc123', skippedReorders: ['TALK-1'] });
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();
    expect(w.find('[data-test="skipped-reorder-notice"]').exists()).toBe(true);

    await w.get('[data-test="skipped-reorder-notice-dismiss"]').trigger('click');
    expect(w.find('[data-test="skipped-reorder-notice"]').exists()).toBe(false);
  });

  it('clears a stale notice at the start of a fresh sync attempt that does not itself report any', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: true, sha: 'abc123', skippedReorders: ['TALK-1'] });
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');
    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();
    expect(w.find('[data-test="skipped-reorder-notice"]').exists()).toBe(true);

    useEditStore().setField('TALK-1', 'owner', 'Mark');
    syncMock.mockResolvedValueOnce({ ok: true, sha: 'def456' });
    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    expect(w.find('[data-test="skipped-reorder-notice"]').exists()).toBe(false);
  });
});

describe('Board — unified lifecycle status precedence (U12/R13)', () => {
  it('shows the conflict status ahead of a plain unsynced status when both are true', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: false, conflict: ['TALK-1'] });
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    // Nothing committed — the draft is still genuinely dirty, so a plain "unsynced" status
    // would show here if the conflict interrupt didn't outrank it.
    expect(useEditStore().dirtyCount.value).toBeGreaterThan(0);
    expect(w.find('[data-test="editing-banner"]').attributes('data-banner-state')).toBe('conflict');
    expect(w.find('[data-test="banner-conflict"]').exists()).toBe(true);
    expect(w.find('[data-test="banner-unsynced"]').exists()).toBe(false);
  });

  it('shows the validation-blocked status ahead of a plain unsynced status', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    useEditStore().addItem('Podcasts & Audiobooks', '', { horizon: 'Next' }); // untitled — blocked pre-flight

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    expect(syncMock).not.toHaveBeenCalled();
    expect(w.find('[data-test="editing-banner"]').attributes('data-banner-state')).toBe('validationBlocked');
    expect(w.find('[data-test="banner-validation-blocked"]').exists()).toBe(true);
    expect(w.find('[data-test="banner-unsynced"]').exists()).toBe(false);
  });

  it('a conflict from the whole-branch fast-forward race also outranks unsynced, even with no item named', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: false, errors: ['failed to update ref: not a fast forward'] });
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    expect(w.find('[data-test="editing-banner"]').attributes('data-banner-state')).toBe('conflict');
    expect(w.find('[data-test="banner-unsynced"]').exists()).toBe(false);
  });
});

describe('Board — lifecycle progression indicator (U12/R14)', () => {
  it('reflects the deploy stage: Building while in progress, Live once the run succeeds', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: true, sha: 'sha-1' });
    deployStatusMock.mockResolvedValueOnce({ status: 'in_progress', conclusion: '', headSha: 'sha-1', htmlUrl: '' });
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');

    vi.useFakeTimers();
    try {
      await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
      await flushPromises();
      expect(w.find('[data-test="lifecycle-progression"]').attributes('data-progression-step')).toBe('Building');

      deployStatusMock.mockResolvedValueOnce({ status: 'completed', conclusion: 'success', headSha: 'sha-1', htmlUrl: '' });
      await vi.advanceTimersByTimeAsync(3000);
      await flushPromises();
      expect(w.find('[data-test="lifecycle-progression"]').attributes('data-progression-step')).toBe('Live');
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows no progression while an interrupt (conflict) is the primary status', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    syncMock.mockResolvedValueOnce({ ok: false, conflict: ['TALK-1'] });
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');

    await (w.vm as unknown as { doSync: () => Promise<void> }).doSync();
    await flushPromises();

    expect(w.find('[data-test="lifecycle-progression"]').exists()).toBe(false);
  });
});

describe('Board — secondary notices never preempt the primary status (U12/R16)', () => {
  it('keeps the unsynced primary status showing while the persist-failed chip is also up', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    const store = useEditStore();
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    try {
      store.setField('TALK-1', 'title', 'Edited while storage is full');
      await flushPromises();

      expect(w.find('[data-test="persist-failed-notice"]').exists()).toBe(true);
      // The primary status is unaffected — still the plain unsynced banner, never overtaken
      // by the secondary chip's own message.
      expect(w.find('[data-test="editing-banner"]').attributes('data-banner-state')).toBe('unsynced');
      const banner = w.find('[data-test="banner-unsynced"]');
      expect(banner.exists()).toBe(true);
      expect(banner.text()).not.toContain("can't be saved on this device");
    } finally {
      spy.mockRestore();
    }
  });

  it('the persist-failed chip is dismissible without touching the primary status', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    const store = useEditStore();
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    try {
      store.setField('TALK-1', 'title', 'Edited while storage is full');
      await flushPromises();
      expect(w.find('[data-test="persist-failed-notice"]').exists()).toBe(true);

      await w.get('[data-test="persist-failed-notice-dismiss"]').trigger('click');
      expect(w.find('[data-test="persist-failed-notice"]').exists()).toBe(false);
      expect(w.find('[data-test="banner-unsynced"]').exists()).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('Board — "saved, not published" is unmistakable in the unsynced and Done states (U12/R16)', () => {
  it('says the work is saved locally but not live in the unsynced banner', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');
    await flushPromises();

    const text = w.find('[data-test="banner-unsynced"]').text().toLowerCase();
    expect(text).toContain('saved');
    expect(text).toMatch(/not (live|published)/);
  });

  it('says the same in the Done exit prompt', async () => {
    localStorage.setItem('rm-edit-mode', '1');
    const w = await mountBoard();
    useEditStore().setField('TALK-1', 'title', 'Edited title');
    await flushPromises();

    await w.get('[data-test="edit-toggle"]').trigger('click');
    await flushPromises();

    const text = w.find('[data-test="exit-edit-prompt"]').text().toLowerCase();
    expect(text).toContain('saved');
    expect(text).toMatch(/not (yet )?published/);
  });
});

describe('Board — IA/UX improvement pass', () => {
  it('renders active filter chips and removes individual filters or clears all', async () => {
    window.history.replaceState(null, '', '/?q=launch&stage=Building&tag=workflow&visibility=Internal');
    const w = await mountBoard();

    const chipRow = w.get('[data-test="active-filter-chips"]');
    expect(chipRow.text()).toContain('“launch”');
    expect(chipRow.text()).toContain('Stage: Building');
    expect(chipRow.text()).toContain('workflow');
    expect(chipRow.text()).toContain('Visibility: Internal');

    const stageChip = w
      .findAll('[data-test="active-filter-chip"]')
      .find((chip) => chip.attributes('data-filter-kind') === 'stage');
    expect(stageChip).toBeTruthy();
    await stageChip!.get('button').trigger('click');
    await flushPromises();

    expect((w.vm as unknown as { filters: { stage: string[] } }).filters.stage).toEqual([]);
    expect(w.find('[data-filter-kind="stage"]').exists()).toBe(false);

    await w.get('[data-test="active-filter-clear"]').trigger('click');
    await flushPromises();

    expect(w.find('[data-test="active-filter-chips"]').exists()).toBe(false);
    expect((w.vm as unknown as { filters: { q: string; tags: string[]; visibility: string | null } }).filters).toMatchObject({
      q: '',
      tags: [],
      visibility: null,
    });
  });

  it('uses lane-aware empty copy for visible empty horizon lanes', async () => {
    const w = await mountBoard([item({ horizon: 'Now' })]);
    (w.vm as unknown as { horizons: string[] }).horizons = ['Candidates', 'Now', 'Next', 'Later', 'Completed'];
    await flushPromises();

    const emptyCopy = w.findAll('[data-test="lane-empty-copy"]').map((node) => node.text());
    expect(emptyCopy).toContain('No candidates in this view.');
    expect(emptyCopy).toContain('No Next items match this view.');
    expect(emptyCopy).toContain('No Later items match this view.');
    expect(emptyCopy).toContain('Nothing shipped yet. Completed work lands here.');
  });

  it('disambiguates the presentation-link and publish-share buttons', async () => {
    const w = await mountBoard();

    expect(w.find('button[aria-label="Copy presentation link"]').exists()).toBe(true);

    (w.vm as unknown as { shareCopied: boolean; canShare: boolean }).shareCopied = true;
    (w.vm as unknown as { shareCopied: boolean; canShare: boolean }).canShare = true;
    await flushPromises();

    expect(w.find('button[aria-label="Presentation link copied"]').exists()).toBe(true);
    expect(w.find('button[aria-label="Publish a share link…"]').exists()).toBe(true);
  });
});

describe('Board — search tuning', () => {
  it('shows hidden-lane matches and clicking the hint toggles that horizon on', async () => {
    window.history.replaceState(null, '', '/?q=shipped');
    const w = await mountBoard([
      item({ id: 'TALK-1', title: 'Visible item', horizon: 'Now', text: 'visible' }),
      item({ id: 'TALK-2', title: 'Shipped launch', horizon: 'Completed', text: 'shipped launch' }),
    ]);

    expect(w.get('[data-test="search-results-line"]').text()).toContain('0 results for “shipped”');
    const hint = w.get('[data-test="hidden-lane-match"]');
    expect(hint.text()).toBe('+ 1 more in Completed');

    await hint.trigger('click');
    await flushPromises();

    expect((w.vm as unknown as { horizons: string[] }).horizons).toContain('Completed');
    expect(w.text()).toContain('Shipped launch');
  });
});
