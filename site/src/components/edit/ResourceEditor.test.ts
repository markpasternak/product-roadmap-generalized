import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { defineComponent, ref } from "vue";
import ResourceEditor from "./ResourceEditor.vue";
import { useEditStore } from "../../lib/edit/store";
import {
  listResources,
  uploadResource,
  resourceTransferCount,
  resourcePreviewURLs,
} from "../../lib/edit/resourceClient";
vi.mock("../../lib/edit/resourceClient", async () => {
  const { ref } = await import("vue");
  return {
    listResources: vi.fn(async () => []),
    uploadResource: vi.fn(),
    recoverUpload: vi.fn(),
    cancelUpload: vi.fn(),
    resourceTransferCount: ref(0),
    resourcePreviewURLs: ref({}),
    loadImagePreview: vi.fn(async () => {}),
  };
});
const result = {
  uploadId: "upl_one",
  assetId: "ast_one",
  name: "Evidence",
  repoPath: "content/assets/ast_one/rev_one/evidence.txt",
  revision: {
    id: "rev_one",
    original: {
      path: "rev_one/evidence.txt",
      mediaType: "text/plain; charset=utf-8",
      bytes: 8,
      sha256: "a".repeat(64),
    },
    createdAt: "",
    createdBy: "alice",
  },
  expiresAt: "2099-01-01",
  published: false,
};
let w: VueWrapper;
async function setup(body = "## What ships\n\nA clear story\n") {
  w = mount(
    defineComponent({
      components: { ResourceEditor },
      setup() {
        return { body: ref(body) };
      },
      template: '<ResourceEditor v-model:body="body" visibility="Internal" />',
    }),
  );
  await flushPromises();
  return w;
}
async function chooseFile() {
  const input = w.get("input[type=file]");
  Object.defineProperty(input.element, "files", {
    configurable: true,
    value: [new File(["evidence"], "evidence.txt", { type: "text/plain" })],
  });
  await input.trigger("change");
}
beforeEach(() => {
  useEditStore().clear();
  vi.clearAllMocks();
  resourcePreviewURLs.value = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ documents: [] }))),
  );
});
afterEach(() => {
  w?.unmount();
  useEditStore().clear();
  vi.unstubAllGlobals();
});
describe("resource authoring lifecycle", () => {
  it('inserts into the selected section range rather than appending elsewhere', async () => {
    const { insertImageKey } = await import('../../lib/edit/imageAuthoring');
    const { inject } = await import('vue');
    const Toolbar = defineComponent({
      setup() { return { open: inject(insertImageKey), field: ref<HTMLTextAreaElement>() }; },
      template: '<textarea ref="field">The old description.</textarea><button @click="open(field)">Insert image</button>',
    });
    w = mount(defineComponent({ components: { ResourceEditor, Toolbar }, setup: () => ({ body: ref('## Why it matters\n\nThe old description.\n\n## What ships\n\nA story\n') }), template: '<ResourceEditor v-model:body="body" visibility="Internal"><Toolbar /></ResourceEditor>' }));
    await flushPromises();
    w.get('textarea').element.setSelectionRange(4, 7);
    await w.findAll('button').find(b => b.text() === 'Insert image')!.trigger('click');
    await flushPromises();
    const dialog = document.querySelector('[role=dialog][aria-label="Insert image"]')!;
    const url = dialog.querySelector('input[type=url]') as HTMLInputElement;
    url.value = 'https://example.com/diagram.png'; url.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();
    dialog.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();
    expect((w.vm as any).body).toBe('## Why it matters\n\nThe ![](https://example.com/diagram.png) description.\n\n## What ships\n\nA story\n');
  });
  it('shows uploaded image thumbnails and inserts a resource with GitHub image syntax', async () => {
    const image = { ...result, repoPath: 'content/assets/ast_one/rev_one/image.png', revision: { ...result.revision, original: { ...result.revision.original, path: 'rev_one/image.png', mediaType: 'image/png' } } };
    vi.mocked(uploadResource).mockResolvedValueOnce(image);
    resourcePreviewURLs.value[image.repoPath] = 'blob:http://localhost/image';
    const { insertImageKey } = await import('../../lib/edit/imageAuthoring');
    const { inject } = await import('vue');
    const Toolbar = defineComponent({ setup() { return { open: inject(insertImageKey) }; }, template: '<button @click="open()">Insert image</button>' });
    w = mount(defineComponent({ components: { ResourceEditor, Toolbar }, setup: () => ({ body: ref('## What ships\n\nA story\n') }), template: '<ResourceEditor v-model:body="body" visibility="Internal"><Toolbar /></ResourceEditor>' }));
    await flushPromises();
    await chooseFile();
    await flushPromises();
    expect(w.get('.resource-shelf img').attributes('src')).toBe('blob:http://localhost/image');
    await w.findAll('button').find(b => b.text() === 'Insert image')!.trigger('click');
    await flushPromises();
    const dialog = document.querySelector('[role=dialog][aria-label="Insert image"]')!;
    (dialog.querySelector('.image-choice') as HTMLButtonElement).click();
    await flushPromises();
    dialog.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();
    expect((w.vm as any).body).toContain('![Evidence](../../assets/ast_one/rev_one/image.png)');
    expect((w.vm as any).body).toContain('- [Evidence](../../assets/ast_one/rev_one/image.png)');
  });
  it("shows transfer progress, then persists the claim and Markdown placement", async () => {
    let finish!: (r: any) => void;
    let progress!: (n: number) => void;
    vi.mocked(uploadResource).mockImplementationOnce((_file, _id, update) => {
      progress = update;
      return new Promise((r) => (finish = r));
    });
    await setup();
    await chooseFile();
    progress(45);
    await flushPromises();
    expect(w.get("progress").attributes("value")).toBe("45");
    expect(resourceTransferCount.value).toBe(1);
    finish(result);
    await flushPromises();
    expect((w.vm as any).body).toContain(
      "[Evidence](../../assets/ast_one/rev_one/evidence.txt)",
    );
    expect(useEditStore().snapshot().assets.attach[0]).toMatchObject({
      uploadId: "upl_one",
      resource: { repoPath: result.repoPath },
    });
    expect(resourceTransferCount.value).toBe(0);
  });
  it("does not attach a late response after cancellation", async () => {
    let finish!: (r: any) => void;
    vi.mocked(uploadResource).mockImplementationOnce(
      () => new Promise((r) => (finish = r)),
    );
    await setup();
    await chooseFile();
    await w
      .findAll("button")
      .find((b) => b.text() === "Cancel")!
      .trigger("click");
    finish(result);
    await flushPromises();
    expect(useEditStore().snapshot().assets.attach).toEqual([]);
    expect((w.vm as any).body).not.toContain("assets/");
    expect(resourceTransferCount.value).toBe(0);
  });
  it("keeps failed transfers actionable until retried or canceled", async () => {
    vi.mocked(uploadResource).mockRejectedValueOnce(
      new Error("Connection interrupted"),
    );
    await setup();
    await chooseFile();
    await flushPromises();
    expect(w.text()).toContain("Connection interrupted");
    expect(resourceTransferCount.value).toBe(1);
    vi.mocked(uploadResource).mockResolvedValueOnce(result);
    await w
      .findAll("button")
      .find((b) => b.text() === "Retry")!
      .trigger("click");
    await flushPromises();
    expect(resourceTransferCount.value).toBe(0);
    expect(useEditStore().snapshot().assets.attach).toHaveLength(1);
  });
  it("lets authors remove an existing legacy document link", async () => {
    await setup("## Links\n\n- PRD: ../../prds/design.md\n");
    expect(w.text()).toContain("PRD");
    await w
      .findAll("button")
      .find((b) => b.text() === "Remove")!
      .trigger("click");
    expect((w.vm as any).body).not.toContain("design.md");
  });
  it("freezes resource controls while a publication receipt is pending", async () => {
    await setup();
    useEditStore().setBody("TALK-001", "pending");
    useEditStore().preparePublication(new Map());
    await flushPromises();
    expect(
      w
        .findAll("fieldset")
        .every((f) => f.attributes("disabled") !== undefined),
    ).toBe(true);
    expect(w.text()).toContain("Finish it before changing files");
  });
  it("recognizes a draft upload already committed from another tab", async () => {
    useEditStore().setAssets({
      attach: [{ uploadId: result.uploadId, resource: result }],
      update: [],
    });
    vi.mocked(listResources).mockResolvedValueOnce([
      {
        schemaVersion: 1,
        id: result.assetId,
        name: result.name,
        visibility: "Internal",
        sha: "current",
        revisions: [result.revision],
      },
    ]);
    await setup(
      `## Resources\n\n- [Evidence](../../assets/ast_one/rev_one/evidence.txt)\n`,
    );
    await flushPromises();
    expect(useEditStore().snapshot().assets.attach).toEqual([]);
    expect((w.vm as any).body).toContain("evidence.txt");
  });
});
