import { afterEach, describe, expect, it, vi } from "vitest";
import { loadImagePreview, resourcePreviewURLs } from "./resourceClient";
import { authedRequest } from "./client";

vi.mock("./client", () => ({
  authedRequest: vi.fn(),
  EDIT_API: "",
  getToken: () => null,
}));
const path = "content/assets/ast_one/rev_one/image.png";
afterEach(() => {
  resourcePreviewURLs.value = {};
  vi.restoreAllMocks();
});
describe("authenticated image originals", () => {
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
