import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createEditStore } from "../lib/edit/store";
import { mergeDraftData, useDraftSync } from "./useDraftSync";
const request = vi.hoisted(() => vi.fn());
vi.mock("../lib/edit/client", () => ({ authedRequest: request }));
const response = (revision: number, data: any, status = 200) =>
  new Response(
    JSON.stringify({ revision, data, updatedAt: "2026-09-06T10:00:00Z" }),
    { status },
  );
const mounted: any[] = [];
function setup() {
  const store = createEditStore();
  let sync!: ReturnType<typeof useDraftSync>;
  const w = mount({
    setup() {
      sync = useDraftSync(store);
      return () => null;
    },
  });
  mounted.push(w);
  return { store, sync };
}
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.useFakeTimers();
  request.mockReset();
});
afterEach(() => {
  mounted.splice(0).forEach((w) => w.unmount());
  vi.useRealTimers();
});
describe("account draft saving", () => {
  it('resolves only overlapping fields and keeps independent edits from both devices', async () => {
    const { store, sync } = setup();
    const baseline = store.snapshot();
    request.mockResolvedValueOnce(response(1, baseline));
    await sync.start('alice');
    store.setField('A', 'title', 'Local title');
    store.setBody('B', 'Independent local text');
    const remote = { ...baseline, fields: { A: { title: 'Remote title', owner: 'Bob' } } };
    request.mockResolvedValueOnce(response(2, remote, 409));
    await sync.flush();
    sync.resolve({ 'fields.A.title': 'remote' });
    expect(store.snapshot().fields.A).toEqual({ title: 'Remote title', owner: 'Bob' });
    expect(store.bodyValue('B')).toBe('Independent local text');
    expect(sync.recoveryCopies.value).toHaveLength(1);
  });
  it("combines independent fields but retains overlapping text for a choice", () => {
    const base = {
      fields: { A: { title: "A", owner: "Alice" } },
      bodies: { A: "old" },
    };
    expect(
      mergeDraftData(
        base,
        { ...base, fields: { A: { title: "Mine", owner: "Alice" } } },
        { ...base, fields: { A: { title: "A", owner: "Bob" } } },
      ),
    ).toEqual({
      value: { ...base, fields: { A: { title: "Mine", owner: "Bob" } } },
      conflicts: [],
    });
    const conflict = mergeDraftData(
      base,
      { ...base, bodies: { A: "mine" } },
      { ...base, bodies: { A: "theirs" } },
    );
    expect(conflict.conflicts).toEqual(["bodies.A"]);
    expect(conflict.value.bodies.A).toBe("mine");
  });
  it("restores an account draft on a new device", async () => {
    const { store, sync } = setup();
    const remote = {
      ...store.snapshot(),
      bodies: { A: "from another device" },
    };
    request.mockResolvedValue(response(2, remote));
    await sync.start("alice");
    expect(store.bodyValue("A")).toBe("from another device");
  });
  it("keeps edits made while a previous save is awaiting its response", async () => {
    const { store, sync } = setup();
    request.mockResolvedValueOnce(response(0, null));
    await sync.start("alice");
    store.setBody("A", "first");
    let finish!: (r: Response) => void;
    request.mockImplementationOnce(() => new Promise((r) => (finish = r)));
    const save = sync.flush();
    store.setBody("A", "second");
    finish(response(1, null));
    await save;
    expect(sync.state.value).toBe("saving");
    expect(store.bodyValue("A")).toBe("second");
    request.mockImplementationOnce((_p, init) =>
      Promise.resolve(response(2, JSON.parse(init.body).data)),
    );
    await vi.advanceTimersByTimeAsync(700);
    expect(sync.state.value).toBe("saved");
    expect(JSON.parse(request.mock.calls.at(-1)![1].body).data.bodies.A).toBe(
      "second",
    );
  });
  it("retains the working copy and retries after an offline failure", async () => {
    const { store, sync } = setup();
    request.mockRejectedValue(new Error("offline"));
    store.setBody("A", "offline draft");
    await sync.start("alice");
    expect(sync.state.value).toBe("local");
    expect(createEditStore().bodyValue("A")).toBe("offline draft");
    request
      .mockResolvedValueOnce(response(0, null))
      .mockImplementationOnce((_p, init) =>
        Promise.resolve(response(1, JSON.parse(init.body).data)),
      );
    await sync.reconnect();
    await vi.advanceTimersByTimeAsync(700);
    expect(sync.state.value).toBe("saved");
  });
  it("a CAS conflict never overwrites either version before a choice", async () => {
    const { store, sync } = setup();
    const baseline = store.snapshot();
    request.mockResolvedValueOnce(response(1, baseline));
    await sync.start("alice");
    store.setBody("A", "mine");
    const remote = { ...baseline, bodies: { A: "theirs" } };
    request.mockResolvedValueOnce(response(2, remote, 409));
    await sync.flush();
    expect(sync.state.value).toBe("conflict");
    expect(store.bodyValue("A")).toBe("mine");
    expect(sync.conflict.value?.remote.data?.bodies.A).toBe("theirs");
    const calls = request.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30000);
    expect(request.mock.calls.length).toBe(calls);
    sync.resolve(false);
    expect(store.bodyValue("A")).toBe("theirs");
  });
  it("does not resurrect a published draft after reload before the cleared draft reached the server", async () => {
    const { store, sync } = setup();
    const previous = {
      ...store.snapshot(),
      created: [{ id: "new-a", product: "Music App", title: "Published" }],
    };
    localStorage.setItem(
      `${store.recoveryKey()}:account-ack`,
      JSON.stringify({ revision: 3, data: previous }),
    );
    store.recordCommit("a".repeat(40), "{}");
    request.mockResolvedValueOnce(response(3, previous));
    await sync.start("alice");
    expect(store.changeset().created).toEqual([]);
    expect(store.committedSha.value).toBe("a".repeat(40));
  });
  it("never allows a slow reconnect read to overtake a save", async () => {
    const { store, sync } = setup();
    request.mockResolvedValueOnce(response(0, null));
    await sync.start("alice");
    let finish!: (r: Response) => void;
    request.mockImplementationOnce(() => new Promise((r) => (finish = r)));
    const reconnect = sync.reconnect();
    store.setBody("A", "new");
    await sync.flush();
    expect(request.mock.calls).toHaveLength(2);
    finish(response(0, null));
    await reconnect;
    request.mockImplementationOnce((_p, init) =>
      Promise.resolve(response(1, JSON.parse(init.body).data)),
    );
    await vi.advanceTimersByTimeAsync(700);
    expect(store.bodyValue("A")).toBe("new");
    expect(sync.state.value).toBe("saved");
  });
  it("keeps each tab's merge base separate when restoring an older working copy", async () => {
    const { store, sync } = setup();
    const baseline = store.snapshot();
    const prior = { ...baseline, bodies: { A: "Original" } };
    localStorage.setItem(
      `${store.recoveryKey()}:account-ack`,
      JSON.stringify({ revision: 1, data: prior }),
    );
    localStorage.setItem(
      "rm-draft-ack:alice",
      JSON.stringify({
        revision: 2,
        data: { ...baseline, bodies: { A: "Other tab" } },
      }),
    );
    store.setBody("A", "This tab");
    request.mockResolvedValueOnce(
      response(2, { ...baseline, bodies: { A: "Other tab" } }),
    );
    await sync.start("alice");
    expect(sync.state.value).toBe("conflict");
    expect(store.bodyValue("A")).toBe("This tab");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("waits for the initial account read before sending edits made during startup", async () => {
    const { store, sync } = setup();
    let finish!: (r: Response) => void;
    request.mockImplementationOnce(() => new Promise((r) => (finish = r)));
    const start = sync.start("alice");
    store.setBody("A", "Typed while connecting");
    await vi.advanceTimersByTimeAsync(700);
    expect(request).toHaveBeenCalledTimes(1);
    finish(response(0, null));
    await start;
    request.mockImplementationOnce((_path, init) =>
      Promise.resolve(response(1, JSON.parse(init.body).data)),
    );
    await vi.advanceTimersByTimeAsync(700);
    expect(sync.state.value).toBe("saved");
    expect(store.bodyValue("A")).toBe("Typed while connecting");
  });
  it("removes the account draft after discard and survives reconnect", async () => {
    const { store, sync } = setup();
    const remote = { ...store.snapshot(), bodies: { A: "discard me" } };
    request.mockResolvedValueOnce(response(1, remote));
    await sync.start("alice");
    store.clear();
    request.mockResolvedValueOnce(response(2, null));
    await sync.flush();
    expect(JSON.parse(request.mock.calls.at(-1)![1].body).data).toBeNull();
    request.mockResolvedValueOnce(response(2, null));
    await sync.reconnect();
    expect(store.dirtyCount.value).toBe(0);
    expect(sync.state.value).toBe("saved");
  });
  it("adopts a deletion from another device without resurrecting unchanged work", async () => {
    const { store, sync } = setup();
    const remote = { ...store.snapshot(), bodies: { A: "old draft" } };
    request.mockResolvedValueOnce(response(1, remote));
    await sync.start("alice");
    request.mockResolvedValueOnce(response(2, null));
    await sync.reconnect();
    expect(store.dirtyCount.value).toBe(0);
    expect(sync.state.value).toBe("saved");
  });
  it("preserves concurrent local edits when the account draft was removed elsewhere", async () => {
    const { store, sync } = setup();
    const remote = { ...store.snapshot(), bodies: { A: "old draft" } };
    request.mockResolvedValueOnce(response(1, remote));
    await sync.start("alice");
    store.setBody("A", "new local work");
    request.mockResolvedValueOnce(response(2, null));
    await sync.reconnect();
    expect(sync.state.value).toBe("conflict");
    expect(store.bodyValue("A")).toBe("new local work");
    sync.resolve(false);
    expect(store.dirtyCount.value).toBe(0);
  });
  it("removes a draft after an older save finishes, keeping its CAS revision", async () => {
    const { store, sync } = setup();
    request.mockResolvedValueOnce(response(0, null));
    await sync.start("alice");
    store.setBody("A", "first");
    let finish!: (r: Response) => void;
    request.mockImplementationOnce(() => new Promise(r => { finish = r; }));
    const pending = sync.flush();
    store.clear();
    finish(response(1, null));
    await pending;
    request.mockResolvedValueOnce(response(2, null));
    await vi.advanceTimersByTimeAsync(700);
    expect(JSON.parse(request.mock.calls.at(-1)![1].body)).toEqual({ revision: 1, data: null });
    expect(sync.state.value).toBe("saved");
  });

});


describe('expired GitHub sessions', () => {
  it('preserves new edits locally and stops autosave retries until sign-in recovers', async () => {
    const { store, sync } = setup();
    request.mockResolvedValueOnce(response(0, null));
    await sync.start('alice');
    store.setBody('A', 'Before expiry');
    request.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));
    await sync.flush();
    expect(sync.authExpired.value).toBe(true);
    store.setBody('A', 'After expiry');
    await vi.advanceTimersByTimeAsync(30000);
    await sync.flush();
    expect(request).toHaveBeenCalledTimes(2);
    expect(sync.state.value).toBe('local');
    expect(sync.detail.value).toContain('sign in with GitHub');
    expect(createEditStore().bodyValue('A')).toBe('After expiry');
    request.mockResolvedValueOnce(response(0, null))
      .mockImplementationOnce((_path, init) => Promise.resolve(response(1, JSON.parse(init.body).data)));
    await sync.reconnect();
    await vi.advanceTimersByTimeAsync(700);
    expect(sync.authExpired.value).toBe(false);
    expect(sync.state.value).toBe('saved');
    expect(JSON.parse(request.mock.calls.at(-1)![1].body).data.bodies.A).toBe('After expiry');
  });
  it('keeps an offline discard pending through expiry instead of restoring the old account draft', async () => {
    const { store, sync } = setup();
    const old = { ...store.snapshot(), bodies: { A: 'Old draft' } };
    request.mockResolvedValueOnce(response(1, old));
    await sync.start('alice');
    store.clear();
    request.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));
    await sync.flush();
    request.mockResolvedValueOnce(response(1, old)).mockResolvedValueOnce(response(2, null));
    await sync.reconnect();
    await vi.advanceTimersByTimeAsync(700);
    expect(store.dirtyCount.value).toBe(0);
    expect(JSON.parse(request.mock.calls.at(-1)![1].body).data).toBeNull();
  });
});
