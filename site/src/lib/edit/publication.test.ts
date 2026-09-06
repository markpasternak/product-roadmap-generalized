import { beforeEach, describe, expect, it } from "vitest";
import { createEditStore } from "./store";
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
describe("publication recovery", () => {
  it("captures originals only for edited items and preserves them across reloads", () => {
    const s = createEditStore();
    s.captureBase("A", "old-sha", "original");
    s.captureBase("B", "b-sha", "other");
    expect(s.snapshot().bases).toEqual({});
    s.setBody("A", "mine");
    const reloaded = createEditStore();
    reloaded.captureBase("A", "new-sha", "theirs");
    expect(reloaded.changeset(new Map([["A", "new-sha"]])).baseShas?.A).toBe(
      "old-sha",
    );
    expect(reloaded.changeset().baseContents).toEqual({ A: "original" });
  });
  it("freezes publication identity and payload while writing continues", () => {
    const s = createEditStore();
    s.setBody("A", "first");
    const sent = s.preparePublication(new Map());
    s.setBody("A", "second");
    expect(createEditStore().preparePublication(new Map())).toEqual(sent);
    s.acknowledge(sent);
    expect(s.bodyValue("A")).toBe("second");
    expect(s.snapshot().requestPayload).toBeNull();
  });
  it("acknowledges only fields that still match the submitted version", () => {
    const s = createEditStore();
    s.setField("A", "title", "first");
    s.setField("A", "owner", "Alice");
    const sent = s.preparePublication(new Map());
    s.setField("A", "title", "second");
    s.acknowledge(sent);
    expect(s.changeset().updated[0].frontmatter).toEqual({ title: "second" });
  });
  it("maps created identities without losing edits made while publishing", () => {
    const s = createEditStore();
    const id = s.addItem("Music App", "New");
    s.setBody(id, "first");
    const sent = s.preparePublication(new Map());
    s.setBody(id, "second");
    s.setField(id, "title", "Later title");
    s.acknowledge(sent, { [id]: "MUSIC-099" });
    expect(s.changeset().created).toEqual([]);
    expect(s.changeset().updated[0]).toMatchObject({
      id: "MUSIC-099",
      frontmatter: { title: "Later title" },
      body: "second",
    });
  });
  it("turns deletion during creation into a deletion of the real identity", () => {
    const s = createEditStore();
    const id = s.addItem("Music App", "New");
    const sent = s.preparePublication(new Map());
    s.deleteItem(id);
    s.acknowledge(sent, { [id]: "MUSIC-099" });
    expect(s.changeset().deletedIds).toEqual(["MUSIC-099"]);
  });
  it("acknowledges empty-body changes explicitly", () => {
    const s = createEditStore();
    s.setBody("A", "");
    const sent = s.preparePublication(new Map());
    expect(sent.updated[0].bodySet).toBe(true);
    s.acknowledge(sent);
    expect(s.dirtyCount.value).toBe(0);
  });
  it("keeps newer resource operations when an older publication succeeds", () => {
    const s = createEditStore();
    s.setAssets({ attach: [{ uploadId: "one" }], update: [] });
    const sent = s.preparePublication(new Map());
    s.setAssets({
      attach: [{ uploadId: "one" }, { uploadId: "two" }],
      update: [],
    });
    s.acknowledge(sent);
    expect(s.snapshot().assets.attach).toEqual([{ uploadId: "two" }]);
  });
  it("keeps a per-tab recovery copy when a different tab overwrites the shared key", () => {
    const first = createEditStore();
    first.setBody("A", "first tab");
    const firstTab = sessionStorage.getItem("rm-edit-tab");
    sessionStorage.removeItem("rm-edit-tab");
    const second = createEditStore();
    second.setBody("A", "second tab");
    sessionStorage.setItem("rm-edit-tab", firstTab!);
    expect(createEditStore().bodyValue("A")).toBe("first tab");
  });
});
