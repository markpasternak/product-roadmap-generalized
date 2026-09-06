import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { flushPromises } from "@vue/test-utils";
import type { ItemVM } from "../../lib/filters";

// Board pulls in a lot of real child components (drawer, editors, share dialog); auto-stub
// them via `global.stubs: true` below so this test only exercises Board's own script:
// U4 edit-mode persistence/auto-resume, and U9's newer-version reload affordance
// (including the clear-vs-keep predicate in reloadToLatest).
const meMock = vi.fn(async () => ({ editor: true, login: "octocat" }));
const syncMock = vi.fn();
// U4 (R4/R5/KTD4): defaults to "unavailable" (null) so every test not explicitly exercising
// the deploy-status poll degrades silently — matching real behavior in local dev / when the
// endpoint 401s — rather than needing every existing doSync test to also mock it.
const deployStatusMock = vi.fn(
  async () =>
    null as null | {
      status: string;
      conclusion: string;
      headSha: string;
      htmlUrl: string;
    },
);
let newVersionCb: (() => void) | null = null;
const watchForNewVersionMock = vi.fn((cb: () => void, _intervalMs?: number) => {
  newVersionCb = cb;
  return vi.fn();
});

vi.mock("../../lib/edit/client", () => ({
  EDIT_API: "https://edit.example.test",
  authedRequest: vi.fn(
    async (path: string) =>
      new Response(
        JSON.stringify(
          path === "/api/assets" ? [] : { revision: 0, data: null },
        ),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
  ),
  publicationStatus: vi.fn(async () => ({ ok: false })),
  clearToken: vi.fn(),
  readTokenFromHash: vi.fn(() => null),
  me: (...args: unknown[]) => meMock(...(args as [])),
  loginUrl: vi.fn(() => "#"),
  fetchItems: vi.fn(async () => []),
  sync: (...args: unknown[]) => syncMock(...(args as [])),
  deployStatus: (...args: unknown[]) => deployStatusMock(...(args as [])),
  // RecentChanges (U2) resolves the activity feed through the same session
  // token the rest of the edit client uses — no token means no fetch (R14),
  // so the peek simply doesn't render in these tests.
  getToken: vi.fn(() => null),
}));
vi.mock("../../lib/share/canvasdrop", () => ({
  getCanvasdrop: vi.fn(() => null),
  updateAuthoredCanvas: vi.fn(),
}));
vi.mock("../../lib/edit/version", () => ({
  fetchDeployedCommit: vi.fn(async () => null),
  watchForNewVersion: (cb: () => void, intervalMs?: number) =>
    watchForNewVersionMock(cb, intervalMs),
}));

import Board from "./Board.vue";
import { useEditStore, KEY } from "../../lib/edit/store";

const item = (over: Partial<ItemVM> = {}): ItemVM => ({
  id: "TALK-1",
  title: "Existing item",
  product: "Podcasts & Audiobooks",
  horizon: "Now",
  stage: "Building",
  owner: "mark@example.com",
  impact: "High",
  effort: "Low",
  visibility: "Internal",
  order: 1,
  updated: "2026-07-01",
  tags: ["workflow"],
  themes: ["one-view"],
  oneliner: "An existing card",
  outcome: "The outcome",
  sections: [{ heading: "Why it matters", text: "because" }],
  editUrl: "https://github.com/edit/x",
  links: [],
  text: "haystack",
  href: "/item/TALK-1",
  ...over,
});

let wrappers: VueWrapper[] = [];
async function mountBoard(items: ItemVM[] = [item()]) {
  const w = mount(Board, {
    attachTo: document.body,
    props: { items },
    global: {
      stubs: {
        transition: false,
        ResourceEditor: { template: "<div><slot /></div>" },
      },
    },
  });
  wrappers.push(w);
  await flushPromises();
  return w;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear(); // board-state (horizonFocus/filters) persists here — isolate tests
  window.history.replaceState(null, "", "/"); // ?horizon=/?item= in the URL leaks between tests
  meMock.mockClear();
  meMock.mockResolvedValue({ editor: true, login: "octocat" });
  syncMock.mockReset();
  deployStatusMock.mockReset();
  deployStatusMock.mockResolvedValue(null);
  watchForNewVersionMock.mockClear();
  newVersionCb = null;
  vi.spyOn(window.location, "reload").mockImplementation(() => {});
});

afterEach(() => {
  for (const w of wrappers) w.unmount();
  wrappers = [];
  useEditStore().clear();
  useEditStore().clearCommit();
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("account drafts and recoverable publication", () => {
  const status = (w: VueWrapper) => w.get('[data-test="save-status"]');
  const send = (w: VueWrapper) => (w.vm as any).doSync();
  async function editing() {
    localStorage.setItem("rm-edit-mode", "1");
    return mountBoard();
  }
  it("shows one save status in editing and inside the item editor", async () => {
    const w = await editing();
    expect(status(w).text()).toContain("draft");
    expect(w.find('[data-test="editing-banner"]').exists()).toBe(false);
    (w.vm as any).openEditor("TALK-1");
    await flushPromises();
    await vi.waitFor(() =>
      expect(
        document.querySelectorAll('[data-test="save-status"]'),
      ).toHaveLength(1),
    );
  });
  it("leaves editing without a decision dialog and keeps the draft", async () => {
    const w = await editing();
    useEditStore().setField("TALK-1", "title", "Mine");
    (w.vm as any).toggleEditMode();
    await flushPromises();
    expect(w.find('[data-test="exit-edit-prompt"]').exists()).toBe(false);
    expect(w.find('[data-test="unpublished-indicator"]').exists()).toBe(true);
    expect(useEditStore().fieldValue("TALK-1", "title")).toBe("Mine");
  });
  it("does not warn when leaving with a durable local draft", async () => {
    await editing();
    useEditStore().setBody("TALK-1", "durable");
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
  it("clears committed edits and keeps saving status visible", async () => {
    const w = await editing();
    useEditStore().setField("TALK-1", "title", "Mine");
    syncMock.mockResolvedValueOnce({ ok: true, sha: "a".repeat(40) });
    await send(w);
    await flushPromises();
    expect(useEditStore().dirtyCount.value).toBe(0);
    expect(status(w).text()).toContain("Changes are in Git");
    expect(status(w).text()).not.toContain("Latest publication is live");
  });
  it("keeps typing during publication as a new unpublished change", async () => {
    const w = await editing();
    const store = useEditStore();
    store.setBody("TALK-1", "first");
    let finish!: (r: any) => void;
    syncMock.mockImplementationOnce(() => new Promise((r) => (finish = r)));
    const work = send(w);
    await flushPromises();
    store.setBody("TALK-1", "second");
    finish({ ok: true, sha: "a".repeat(40) });
    await work;
    expect(store.bodyValue("TALK-1")).toBe("second");
    expect(store.dirtyCount.value).toBe(1);
  });
  it("retries the frozen payload and identity after a lost response", async () => {
    const w = await editing();
    useEditStore().setBody("TALK-1", "first");
    syncMock.mockRejectedValueOnce(new Error("lost response"));
    await send(w);
    const first = syncMock.mock.calls[0][0];
    useEditStore().setBody("TALK-1", "second");
    syncMock.mockResolvedValueOnce({ ok: true, sha: "a".repeat(40) });
    await send(w);
    expect(syncMock.mock.calls[1][0]).toEqual(first);
    expect(useEditStore().bodyValue("TALK-1")).toBe("second");
  });
  it("recovers a confirmed receipt without resending", async () => {
    const { publicationStatus } = await import("../../lib/edit/client");
    const w = await editing();
    useEditStore().setField("TALK-1", "title", "Mine");
    syncMock.mockRejectedValueOnce(new Error("lost"));
    vi.mocked(publicationStatus).mockResolvedValueOnce({
      ok: true,
      sha: "a".repeat(40),
    });
    await send(w);
    expect(syncMock).toHaveBeenCalledTimes(1);
    expect(useEditStore().dirtyCount.value).toBe(0);
  });
  it("keeps the receipt pending until the committed tree can be read", async () => {
    const { fetchItems } = await import("../../lib/edit/client");
    const w = await editing();
    useEditStore().setBody("TALK-1", "first");
    vi.mocked(fetchItems).mockRejectedValueOnce(new Error("unavailable"));
    syncMock.mockResolvedValueOnce({ ok: true, sha: "a".repeat(40) });
    await send(w);
    expect(useEditStore().snapshot().requestPayload).not.toBeNull();
    expect(useEditStore().bodyValue("TALK-1")).toBe("first");
  });
  it("compares overlapping edits while retaining the draft", async () => {
    const w = await editing();
    useEditStore().setBody("TALK-1", "mine");
    syncMock.mockResolvedValueOnce({
      ok: false,
      conflict: ["TALK-1"],
      state: "conflict",
    });
    await send(w);
    await flushPromises();
    expect(w.text()).toContain("Review overlapping changes");
    expect(w.text()).toContain("Your draft");
    expect(w.text()).toContain("Latest in Git");
    expect(useEditStore().bodyValue("TALK-1")).toBe("mine");
    expect(useEditStore().snapshot().requestPayload).toBeNull();
  });
  it("makes unavailable deployment checks actionable", async () => {
    const w = await editing();
    useEditStore().setField("TALK-1", "title", "Mine");
    syncMock.mockResolvedValueOnce({ ok: true, sha: "a".repeat(40) });
    await send(w);
    await flushPromises();
    expect(status(w).text()).toContain("Waiting to confirm");
    expect(status(w).text()).toContain("Check again");
  });
  it("requires deployed-version proof before reporting live", async () => {
    const w = await editing();
    useEditStore().setField("TALK-1", "title", "Mine");
    syncMock.mockResolvedValueOnce({ ok: true, sha: "a".repeat(40) });
    deployStatusMock.mockResolvedValueOnce({
      status: "completed",
      conclusion: "success",
      headSha: "a".repeat(40),
      htmlUrl: "",
    });
    await send(w);
    await flushPromises();
    expect(status(w).text()).not.toContain("Latest publication is live");
    deployStatusMock.mockResolvedValueOnce({
      status: "completed",
      conclusion: "success",
      headSha: "b".repeat(40),
      htmlUrl: "",
      live: true,
      includesCommit: true,
    } as any);
    (w.vm as any).startDeployPoll("a".repeat(40));
    await flushPromises();
    expect(status(w).text()).toContain("Latest publication is live");
    expect(useEditStore().committedSha.value).toBeNull();
  });
  it("retains old pending commits on reload for verification", async () => {
    useEditStore().recordCommit("a".repeat(40), "{}");
    const w = await editing();
    expect(deployStatusMock).toHaveBeenCalled();
    expect(status(w).text()).toContain("Changes are in Git");
  });
  it("does not build a no-op publication", async () => {
    const w = await editing();
    useEditStore().setField("TALK-1", "title", "Mine");
    syncMock.mockResolvedValueOnce({ ok: true, noChanges: true, sha: "" });
    await send(w);
    expect(useEditStore().dirtyCount.value).toBe(0);
    expect(deployStatusMock).not.toHaveBeenCalled();
  });
  it("shows site updates without hiding actionable publication errors", async () => {
    const w = await editing();
    useEditStore().setField("TALK-1", "owner", "");
    await send(w);
    newVersionCb?.();
    await flushPromises();
    expect(w.find('[data-test="reload-latest"]').exists()).toBe(true);
    expect(status(w).text()).toContain("owner");
  });
});
