import { describe, it, expect, vi, afterEach } from "vitest";
import { prepareShareResources, shareResourceChoices } from "./resources";
import type { ProjectedItem } from "./project";
const bytes = new TextEncoder().encode("Original notes");
const path = "content/assets/ast_test/rev_one/notes.txt";
const item = { id: "TALK-001", title: "Example" } as ProjectedItem;
const choice = {
  key: `TALK-001:${path}`,
  itemId: "TALK-001",
  label: "Notes",
  href: `../../${path.slice(8)}`,
  repoPath: path,
};
afterEach(() => vi.unstubAllGlobals());
async function mockFiles(response: Response) {
  const sha256 = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          assets: [
            {
              id: "ast_test",
              revisions: [
                {
                  original: {
                    path: "rev_one/notes.txt",
                    mediaType: "text/plain; charset=utf-8",
                    bytes: bytes.length,
                    sha256,
                  },
                },
              ],
            },
          ],
        }),
      ),
    )
    .mockResolvedValueOnce(response);
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
describe("explicit frozen share resources", () => {
  it('retains image intent for explicitly selected external images without a file extension', async () => {
    const choices = shareResourceChoices([{ id: 'TALK-001', links: [], sections: [{ markdown: '![Diagram](https://example.com/image?id=1)' }] } as any]);
    const result = await prepareShareResources([item], choices);
    expect(result.items[0].resources).toEqual([{ label: 'Diagram', href: 'https://example.com/image?id=1', image: true }]);
  });
  it("does not fetch or include anything unless selected", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const result = await prepareShareResources([item], []);
    expect(result.files).toEqual({});
    expect(result.items[0].resources).toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("freezes verified bytes and creates self-contained preview URLs", async () => {
    await mockFiles(new Response(bytes));
    const result = await prepareShareResources(
      [item],
      [choice],
      "/roadmap/",
      true,
    );
    expect(result.files["assets/ast_test/rev_one/notes.txt"]).toEqual(bytes);
    expect(result.items[0].resources?.[0].href).toMatch(
      /^data:text\/plain; charset=utf-8;base64,/,
    );
  });
  it("fails closed on login pages, missing originals and hash mismatches", async () => {
    for (const response of [
      new Response("<html>login</html>", {
        headers: { "Content-Type": "text/html" },
      }),
      new Response("missing", { status: 404 }),
      new Response("changed bytes"),
    ]) {
      await mockFiles(response);
      await expect(prepareShareResources([item], [choice])).rejects.toThrow();
    }
  });
  it("includes selected external links only for included items", async () => {
    const selected = {
      ...choice,
      repoPath: null,
      href: "https://example.com/design",
    };
    const result = await prepareShareResources(
      [item],
      [selected, { ...selected, itemId: "OTHER" }],
    );
    expect(result.items[0].resources).toEqual([
      { label: "Notes", href: selected.href },
    ]);
    expect(result.files).toEqual({});
  });
});
