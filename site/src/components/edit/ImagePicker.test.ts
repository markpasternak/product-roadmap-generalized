import { afterEach, describe, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
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
