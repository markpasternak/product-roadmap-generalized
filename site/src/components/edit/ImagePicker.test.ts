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
  expect(w.get('[role=alert]').text()).toBe('Could not upload. Try again.');
  expect(w.findAll('button').find(b => b.text() === 'Upload image')!.attributes('disabled')).toBeUndefined();
  expect(w.emitted('cancel')).toBeUndefined();
});
