import { afterEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import ImagePicker from "./ImagePicker.vue";

let w: VueWrapper;
afterEach(() => w?.unmount());
const setup = () =>
  (w = mount(ImagePicker, {
    props: { images: [] },
    global: { stubs: { Teleport: true } },
  }));
describe("image insertion", () => {
  it('filters by filename regardless of case and preserves selections across filters and tabs', async () => {
    w = mount(ImagePicker, { props: { images: [
      { href: '/cover.png', name: 'Cover', filename: 'production-cover.png', attached: true },
      { href: '/screen.png', name: 'Screen', filename: 'production-screen.png', attached: false, mine: true },
      { href: '/shared.png', name: 'Shared screen', filename: 'shared-screen.png', attached: false },
    ] }, global: { stubs: { Teleport: true } } });
    await w.findAll('.image-choice')[0].trigger('click');
    await w.get('input[type=search]').setValue(' SCREEN ');
    expect(w.findAll('.image-choice').map(choice => choice.text())).toEqual(['Screenproduction-screen.pngYour upload']);
    await w.findAll('.image-choice')[0].trigger('click');
    await w.findAll('button').find(button => button.text() === 'Shared library')!.trigger('click');
    expect(w.findAll('.image-choice').map(choice => choice.text())).toEqual(['Shared screenshared-screen.pngShared library']);
    await w.get('input[type=search]').setValue('no-match');
    expect(w.text()).toContain('No images match your search.');
    await w.findAll('button').find(button => button.text() === 'Clear filter')!.trigger('click');
    expect(w.get('button[type=submit]').text()).toBe('Insert 2 images');
    await w.get('form').trigger('submit');
    expect(w.emitted('insert')?.[0]).toEqual(['![Cover](/cover.png)\n\n![Screen](/screen.png)']);
  });
  it('defaults to this item and personal uploads, with filenames visible and other authors in the shared library', async () => {
    w = mount(ImagePicker, { props: { images: [
      { href: '../../assets/ast_one/rev_one/long-filename.png', name: 'Cover', filename: 'long-filename.png', attached: true },
      { href: '../../assets/ast_two/rev_one/mine.png', name: 'Mine', attached: false, mine: true },
      { href: '../../assets/ast_three/rev_one/test.png', name: 'Test', attached: false, uploadedBy: 'markpasternak' },
    ] }, global: { stubs: { Teleport: true } } });
    expect(w.findAll('.image-choice').map(choice => choice.text())).toEqual(['Coverlong-filename.pngAttached to this item', 'MineYour upload']);
    await w.findAll('button').find(button => button.text() === 'Shared library')!.trigger('click');
    expect(w.findAll('.image-choice').map(choice => choice.text())).toEqual(['TestUploaded by markpasternak']);
  });

  it('uploads a batch, reports failed filenames, and inserts successful images in order', async () => {
    const uploadImage = vi.fn(async (file: File) => {
      if (file.name === 'broken.png') throw new Error('Upload failed');
      return { href: `../../assets/ast_test/rev_one/${file.name}`, name: file.name, attached: true };
    });
    w = mount(ImagePicker, { props: { images: [], uploadImage }, global: { stubs: { Teleport: true } } });
    const input = w.get('input[type=file]');
    const files = ['first.png', 'broken.png', 'last.png'].map(name => new File(['image'], name, { type: 'image/png' }));
    Object.defineProperty(input.element, 'files', { value: files });
    expect(input.attributes('multiple')).toBeDefined();
    await input.trigger('change');
    await flushPromises();
    expect(uploadImage).toHaveBeenCalledTimes(3);
    expect(w.get('[role=alert]').text()).toBe('broken.png: Upload failed');
    expect(w.get('button[type=submit]').text()).toBe('Insert 2 images');
    await w.get('form').trigger('submit');
    expect(w.emitted('insert')?.[0]).toEqual(['![first.png](../../assets/ast_test/rev_one/first.png)\n\n![last.png](../../assets/ast_test/rev_one/last.png)']);
  });

  it("uses standard Markdown, escapes alt text and URL parentheses", async () => {
    setup();
    await w.get("input[type=url]").setValue("https://example.com/image(1).png");
    await w
      .get('input[placeholder="Describe what the image shows"]')
      .setValue("A [useful] diagram");
    await w.get("form").trigger("submit");
    expect(w.emitted("insert")?.[0]).toEqual([
      "![A \\[useful\\] diagram](https://example.com/image%281%29.png)",
    ]);
  });
  it("rejects executable schemes without closing or inserting", async () => {
    setup();
    await w.get("input[type=url]").setValue("javascript:alert(1)");
    await w.get("form").trigger("submit");
    expect(w.emitted("insert")).toBeUndefined();
    expect(w.get("[role=alert]").text()).toContain("complete");
  });
  it("preserves an empty alt for decorative images", async () => {
    setup();
    await w
      .get("input[type=url]")
      .setValue("https://example.com/decorative.svg");
    await w.get("form").trigger("submit");
    expect(w.emitted("insert")?.[0]).toEqual([
      "![](https://example.com/decorative.svg)",
    ]);
  });
});


it('reports upload progress and cancels the request when the picker closes', async () => {
  let signal!: AbortSignal;
  let finish!: (image: { href: string; name: string; attached: boolean }) => void;
  const uploadImage = vi.fn((_file: File, abort: AbortSignal, progress: (n: number) => void) => {
    signal = abort;
    progress(45);
    return new Promise<{ href: string; name: string; attached: boolean }>(resolve => { finish = resolve; });
  });
  w = mount(ImagePicker, { props: { images: [], uploadImage }, global: { stubs: { Teleport: true } } });
  const input = w.get('input[type=file]');
  Object.defineProperty(input.element, 'files', { value: [new File(['image'], 'image.png', { type: 'image/png' })] });
  await input.trigger('change');
  expect(w.get('[role=status]').text()).toContain('45%');
  expect(w.get('button[type=submit]').attributes('disabled')).toBeDefined();
  await w.get('[aria-label="Close image picker"]').trigger('click');
  expect(signal.aborted).toBe(true);
  finish({ href: '../../assets/image.png', name: 'Image', attached: true });
  await flushPromises();
  expect(w.emitted('cancel')).toHaveLength(1);
  expect(w.emitted('insert')).toBeUndefined();
});

it('keeps the picker open with a useful upload error so the author can retry', async () => {
  w = mount(ImagePicker, { props: { images: [], uploadImage: vi.fn().mockRejectedValue(new Error('Could not upload. Try again.')) }, global: { stubs: { Teleport: true } } });
  const input = w.get('input[type=file]');
  Object.defineProperty(input.element, 'files', { value: [new File(['image'], 'image.png', { type: 'image/png' })] });
  await input.trigger('change');
  await flushPromises();
  expect(w.get('[role=alert]').text()).toBe('image.png: Could not upload. Try again.');
  expect(w.findAll('button').find(b => b.text() === 'Upload images')!.attributes('disabled')).toBeUndefined();
  expect(w.emitted('cancel')).toBeUndefined();
});
