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
        return { body: ref(body), cover: ref(''), coverPosition: ref(''), coverFraming: ref('') };
      },
      template: '<ResourceEditor v-model:body="body" v-model:cover="cover" v-model:cover-position="coverPosition" v-model:cover-framing="coverFraming" visibility="Internal" item-id="TEST-001"><textarea :value="body" /></ResourceEditor>',
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
    (Array.from(dialog.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Image URL') as HTMLButtonElement).click();
    await flushPromises();
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
    const Toolbar = defineComponent({ setup() { return { open: inject(insertImageKey), field: ref<HTMLTextAreaElement>() }; }, template: '<textarea ref="field">A story</textarea><button @click="open(field)">Insert image</button>' });
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
    await w.findAll("button").find(b => b.text() === "Edit")!.trigger("click");
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

describe('resource management', () => {
  const asset = { schemaVersion: 1 as const, id: result.assetId, name: result.name, visibility: 'Internal' as const, sha: 'manifest', revisions: [result.revision], usages: ['content/items/test/TEST-001-example.md'] };
  it('keeps management scoped to this item and reuses resources through a searchable picker', async () => {
    vi.mocked(listResources).mockResolvedValueOnce([asset, { ...asset, id: 'ast_other', name: 'Other file' }]);
    await setup('## What ships\n\n[Evidence](../../assets/ast_one/rev_one/evidence.txt)\n');
    expect(w.findAll('.resource-row')).toHaveLength(1);
    await w.get('[aria-label="Edit Evidence"]').trigger('click');
    expect(w.get('.resource-inspector').text()).toContain('In this item');
    expect(w.text()).not.toContain('content/items/');
    await w.get('[aria-label="Remove from What ships"]').trigger('click');
    expect((w.vm as any).body).not.toContain('evidence.txt');
    expect(w.find('.resource-inspector').exists()).toBe(true);
    expect(w.findAll('button').find(b => b.text() === 'Delete from library…')!.attributes('disabled')).toBeUndefined();
    expect(w.text()).not.toContain('Browse library');
    const add = w.findAll('button').filter(b => b.text() === 'Add resource');
    expect(add).toHaveLength(1);
    expect(add[0].element.closest('.resource-shelf')).not.toBeNull();
    await add[0].trigger('click');
    await w.findAll('button').find(b => b.text() === 'Choose existing')!.trigger('click');
    await w.get('input[type=search]').setValue('Other');
    expect(w.findAll('.existing-resource-choice')).toHaveLength(1);
    await w.get('.existing-resource-choice').trigger('click');
    await w.get('.resource-picker form').trigger('submit');
    expect((w.vm as any).body).toContain('[Other file](../../assets/ast_other/rev_one/evidence.txt)');
    expect(w.find('.resource-picker').exists()).toBe(false);
    expect(w.findAll('.resource-row')).toHaveLength(2);
  });
  it('removes one placement without removing the other uses of the file', async () => {
    vi.mocked(listResources).mockResolvedValueOnce([asset]);
    await setup('## What ships\n\n[Evidence](../../assets/ast_one/rev_one/evidence.txt)\n\n## Resources\n\n- [Evidence](../../assets/ast_one/rev_one/evidence.txt)\n');
    await w.get('[aria-label="Edit Evidence"]').trigger('click');
    await w.get('[aria-label="Remove from Resources"]').trigger('click');
    expect((w.vm as any).body.match(/evidence.txt/g)).toHaveLength(1);
    expect(w.get('.resource-placements').text()).toContain('What ships');
    expect(w.findAll('button').find(b => b.text() === 'Delete from library…')!.attributes('disabled')).toBeDefined();
  });

  it('selects an attached managed image as the card cover and adjusts its focal point', async () => {
    const imageRevision = { ...result.revision, original: { ...result.revision.original, path: 'rev_one/cover.png', mediaType: 'image/png' } };
    vi.mocked(listResources).mockResolvedValueOnce([{ ...asset, revisions: [imageRevision] }]);
    await setup('## Resources\n\n- [Evidence](../../assets/ast_one/rev_one/cover.png)\n');
    await w.findAll('button').find(button => button.text() === 'Use as cover')!.trigger('click');
    expect((w.vm as any).cover).toBe('../../assets/ast_one/rev_one/cover.png');
    expect((w.vm as any).coverPosition).toBe('50% 50%');
    expect((w.vm as any).coverFraming).toBe('0');
    const focus = w.get('.resource-cover-focus-map');
    await focus.trigger('keydown', { key: 'ArrowUp' });
    expect((w.vm as any).coverPosition).toBe('50% 45%');
    await w.get('input[aria-label^="Cover framing"]').setValue('-0.75');
    expect((w.vm as any).coverFraming).toBe('-0.75');
    expect(w.get('.resource-cover-framing output').text()).toBe('Reveal more');
    expect(w.findAll('.resource-cover-crop')).toHaveLength(2);
    await w.findAll('button').find(button => button.text() === 'Remove cover')!.trigger('click');
    expect((w.vm as any).cover).toBe('');
    expect((w.vm as any).coverFraming).toBe('');
  });

});

it('inserts into the empty section the author selected', async () => {
  const { default: SectionEditor } = await import('./SectionEditor.vue');
  vi.mocked(listResources).mockResolvedValueOnce([{ schemaVersion: 1, id: result.assetId, name: result.name, visibility: 'Internal', sha: 'manifest', revisions: [result.revision] }]);
  w = mount(defineComponent({ components: { ResourceEditor, SectionEditor }, setup: () => ({ body: ref('## Resources\n\n- [Evidence](../../assets/ast_one/rev_one/evidence.txt)\n') }), template: '<ResourceEditor v-model:body="body" visibility="Internal"><SectionEditor v-model="body" /></ResourceEditor>' }));
  await flushPromises();
  await w.findAll('[data-test="spine-display"]')[0].trigger('click');
  await flushPromises();
  await w.findAll('button').find(b => b.attributes('aria-label') === 'Insert image')!.trigger('click');
  await flushPromises();
  const dialog = document.querySelector('[role=dialog][aria-label="Insert image"]')!;
  (Array.from(dialog.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Image URL') as HTMLButtonElement).click();
  await flushPromises();
  const url = dialog.querySelector('input[type=url]') as HTMLInputElement;
  url.value = 'https://example.com/image.png';
  url.dispatchEvent(new Event('input', { bubbles: true }));
  await flushPromises();
  dialog.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await flushPromises();
  expect((w.vm as any).body).toContain('## Why it matters\n\n![](https://example.com/image.png)');
  expect((w.vm as any).body).not.toContain('## What ships');
});

it('cancels replacement mode before choosing a new upload', async () => {
  vi.mocked(listResources).mockResolvedValueOnce([{ schemaVersion: 1, id: result.assetId, name: result.name, visibility: 'Internal', sha: 'manifest', revisions: [result.revision] }]);
  await setup('## Resources\n\n- [Evidence](../../assets/ast_one/rev_one/evidence.txt)\n');
  await w.get('[aria-label="Edit Evidence"]').trigger('click');
  await w.findAll('button').find(b => b.text() === 'Replace file…')!.trigger('click');
  expect(w.get('input[type=file]').attributes('multiple')).toBeUndefined();
  await w.get('input[type=file]').trigger('cancel');
  vi.mocked(uploadResource).mockResolvedValueOnce({ ...result, assetId: 'ast_new' });
  await chooseFile();
  await flushPromises();
  expect(vi.mocked(uploadResource).mock.calls[0][1]).toBeUndefined();
});

it('keeps insertion in the text toolbar and protects originals used elsewhere', async () => {
  vi.mocked(listResources).mockResolvedValueOnce([{ schemaVersion: 1, id: result.assetId, name: result.name, visibility: 'Internal', sha: 'manifest', revisions: [result.revision], usages: ['content/items/test/TEST-002-other.md'] }]);
  await setup('## Resources\n\n- [Evidence](../../assets/ast_one/rev_one/evidence.txt)\n');
  await w.get('[aria-label="Edit Evidence"]').trigger('click');
  await w.get('[aria-label="Remove from Resources"]').trigger('click');
  expect(w.get('.resource-shelf').text()).not.toContain('Insert');
  expect(w.findAll('button').find(b => b.text() === 'Delete from library…')!.attributes('disabled')).toBeDefined();
  expect(w.text()).toContain('Still used elsewhere');
});

it('downloads the version used by this item rather than silently switching files', async () => {
  vi.mocked(listResources).mockResolvedValueOnce([{ schemaVersion: 1, id: result.assetId, name: result.name, visibility: 'Internal', sha: 'manifest', revisions: [result.revision, { ...result.revision, id: 'rev_new', original: { ...result.revision.original, path: 'rev_new/new.txt' } }] }]);
  resourcePreviewURLs.value[result.repoPath] = 'blob:original';
  resourcePreviewURLs.value['content/assets/ast_one/rev_new/new.txt'] = 'blob:new';
  let href = '';
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { href = this.href; });
  await setup('## Resources\n\n- [Evidence](../../assets/ast_one/rev_one/evidence.txt)\n');
  await w.get('[aria-label="Download Evidence"]').trigger('click');
  expect(href).toBe('blob:original');
  click.mockRestore();
});

it('uploads from the image toolbar, attaches the file, and preserves the insertion range', async () => {
  const image = { ...result, repoPath: 'content/assets/ast_one/rev_one/image.png', revision: { ...result.revision, original: { ...result.revision.original, path: 'rev_one/image.png', mediaType: 'image/png' } } };
  vi.mocked(uploadResource).mockResolvedValueOnce(image);
  resourcePreviewURLs.value[image.repoPath] = 'blob:http://localhost/image';
  const { insertImageKey } = await import('../../lib/edit/imageAuthoring');
  const { inject } = await import('vue');
  const Toolbar = defineComponent({ setup: () => ({ open: inject(insertImageKey), field: ref<HTMLTextAreaElement>() }), template: '<textarea ref="field">The old description.</textarea><button @click="open(field)">Insert image</button>' });
  w = mount(defineComponent({ components: { ResourceEditor, Toolbar }, setup: () => ({ body: ref('## Why it matters\n\nThe old description.\n') }), template: '<ResourceEditor v-model:body="body" visibility="Internal"><Toolbar /></ResourceEditor>' }));
  await flushPromises();
  w.get('textarea').element.setSelectionRange(4, 7);
  await w.findAll('button').find(b => b.text() === 'Insert image')!.trigger('click');
  await flushPromises();
  const dialog = document.querySelector('[role=dialog][aria-label="Insert image"]')!;
  const input = dialog.querySelector('input[type=file]')!;
  Object.defineProperty(input, 'files', { value: [new File(['image'], 'image.png', { type: 'image/png' })] });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await flushPromises();
  expect((w.vm as any).body).toContain('The old description.');
  expect((w.vm as any).body).toContain('## Resources\n\n- [Evidence](../../assets/ast_one/rev_one/image.png)');
  expect(dialog.querySelector('.image-choice[aria-pressed=true]')).not.toBeNull();
  dialog.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await flushPromises();
  expect((w.vm as any).body).toContain('The ![Evidence](../../assets/ast_one/rev_one/image.png) description.');
  expect(useEditStore().snapshot().assets.attach).toHaveLength(1);
  expect(resourceTransferCount.value).toBe(0);
});

it('prevents duplicate attachments and previews the existing revision when reusing an inline image', async () => {
  const old = { ...result.revision, original: { ...result.revision.original, path: 'rev_one/image.png', mediaType: 'image/png' } };
  vi.mocked(listResources).mockResolvedValueOnce([{ schemaVersion: 1, id: result.assetId, name: result.name, visibility: 'Internal', sha: 'manifest', revisions: [old, { ...old, id: 'rev_new', original: { ...old.original, path: 'rev_new/image.png' } }] }]);
  resourcePreviewURLs.value['content/assets/ast_one/rev_one/image.png'] = 'blob:original';
  await setup('## What ships\n\n![Evidence](../../assets/ast_one/rev_one/image.png)\n');
  await w.findAll('button').find(b => b.text() === 'Add resource')!.trigger('click');
  await w.findAll('button').find(b => b.text() === 'Choose existing')!.trigger('click');
  expect(w.get('.existing-resource-choice img').attributes('src')).toBe('blob:original');
  expect(w.get('.existing-resource-open').attributes()).toMatchObject({ href: 'blob:original', target: '_blank' });
  await w.get('.existing-resource-choice').trigger('click');
  await w.get('.resource-picker form').trigger('submit');
  expect((w.vm as any).body).toContain('- [Evidence](../../assets/ast_one/rev_one/image.png)');
  expect((w.vm as any).body).not.toContain('rev_new');
  await w.findAll('button').find(b => b.text() === 'Add resource')!.trigger('click');
  await w.findAll('button').find(b => b.text() === 'Choose existing')!.trigger('click');
  expect(w.get('.existing-resource-choice').attributes('disabled')).toBeDefined();
  expect(w.get('.existing-resource-choice').text()).toContain('Already attached');
});

it('keeps attached images previewable and lets authors inspect documents before attaching them', async () => {
  const image = { ...result.revision, original: { ...result.revision.original, path: 'rev_one/image.png', mediaType: 'image/png' } };
  vi.mocked(listResources).mockResolvedValueOnce([{ schemaVersion: 1, id: result.assetId, name: 'Screenshot', visibility: 'Internal', sha: 'manifest', revisions: [image] }]);
  resourcePreviewURLs.value['content/assets/ast_one/rev_one/image.png'] = 'blob:original';
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ documents: [{ title: 'Research brief', path: 'research/brief.md' }] }))));
  await setup('## Resources\n\n- [Screenshot](../../assets/ast_one/rev_one/image.png)\n');
  await w.findAll('button').find(b => b.text() === 'Add resource')!.trigger('click');
  await w.findAll('button').find(b => b.text() === 'Choose existing')!.trigger('click');
  const choices = w.findAll('.existing-resource-choice');
  expect(choices[0].attributes('disabled')).toBeDefined();
  expect(w.findAll('.existing-resource-open').map(link => link.text())).toEqual(['Preview', 'Open']);
  expect(w.findAll('.existing-resource-open')[0].attributes('href')).toBe('blob:original');
  expect(w.findAll('.existing-resource-open')[1].attributes('href')).toContain('/docs/research/brief');
  expect(w.findAll('.existing-resource-open').every(link => link.attributes('target') === '_blank')).toBe(true);
});
