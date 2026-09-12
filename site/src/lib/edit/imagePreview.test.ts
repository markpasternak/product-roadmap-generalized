import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadImagePreview, resourcePreviewURLs } from "./resourceClient";
import { authedRequest } from "./client";

vi.mock("./client", () => ({
  authedRequest: vi.fn(),
  EDIT_API: "",
  getToken: () => null,
}));
const path = "content/assets/ast_one/rev_one/image.png";
let staticImageAvailable = false;
let staticImageURLs: string[];
beforeEach(() => {
  vi.clearAllMocks();
  staticImageAvailable = false;
  staticImageURLs = [];
  vi.stubGlobal("Image", class {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(url: string) {
      staticImageURLs.push(url);
      queueMicrotask(() => staticImageAvailable ? this.onload?.() : this.onerror?.());
    }
  });
});
afterEach(() => {
  resourcePreviewURLs.value = {};
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("authenticated image originals", () => {
  it("uses deployed images without calling the editing API, including concurrent and repeat previews", async () => {
    staticImageAvailable = true;
    vi.mocked(authedRequest).mockResolvedValue(
      new Response("image bytes", { headers: { "content-type": "image/png" } }),
    );
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:duplicate-image");
    await Promise.all([loadImagePreview(path), loadImagePreview(path)]);
    await loadImagePreview(path);
    expect(authedRequest).not.toHaveBeenCalled();
    expect(staticImageURLs).toEqual(["/assets/ast_one/rev_one/image.png"]);
    expect(resourcePreviewURLs.value[path]).toBe("/assets/ast_one/rev_one/image.png");
  });
  it("keeps an unpublished upload preview without requesting the deployed image or API", async () => {
    resourcePreviewURLs.value[path] = "blob:unpublished-upload";
    await loadImagePreview(path);
    expect(staticImageURLs).toEqual([]);
    expect(authedRequest).not.toHaveBeenCalled();
    expect(resourcePreviewURLs.value[path]).toBe("blob:unpublished-upload");
  });
  it("deduplicates simultaneous thumbnail and Markdown preview requests", async () => {
    vi.mocked(authedRequest).mockResolvedValue(
      new Response("image bytes", { headers: { "content-type": "image/png" } }),
    );
    const create = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:verified-image");
    await Promise.all([loadImagePreview(path), loadImagePreview(path)]);
    expect(authedRequest).toHaveBeenCalledTimes(1);
    expect(resourcePreviewURLs.value[path]).toBe("blob:verified-image");
    expect(create).toHaveBeenCalledTimes(1);
    expect(staticImageURLs).toEqual(["/assets/ast_one/rev_one/image.png"]);
  });
  it("rejects HTML login pages instead of caching them as image previews", async () => {
    vi.mocked(authedRequest).mockResolvedValue(
      new Response("<html>Login</html>", {
        headers: { "content-type": "text/html" },
      }),
    );
    await expect(loadImagePreview(path)).rejects.toThrow(
      "Image preview unavailable",
    );
    expect(resourcePreviewURLs.value[path]).toBeUndefined();
  });
});
