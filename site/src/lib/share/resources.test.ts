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
  it('automatically freezes the selected card cover without listing it as a drawer resource', async () => {
    const imageBytes = new Uint8Array([137, 80, 78, 71]);
    const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', imageBytes))).map(b => b.toString(16).padStart(2, '0')).join('');
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ assets: [{ id: 'ast_image', revisions: [{ original: { path: 'rev_one/cover.png', mediaType: 'image/png', bytes: imageBytes.length, sha256 } }] }] })))
      .mockResolvedValueOnce(new Response(imageBytes, { headers: { 'Content-Type': 'image/png' } }));
    vi.stubGlobal('fetch', fetcher);
    const source = { ...item, cover: '../../assets/ast_image/rev_one/cover.png', coverPosition: '30% 70%' };
    const result = await prepareShareResources([source], []);
    expect(result.items[0]).toMatchObject({ cover: 'assets/ast_image/rev_one/cover.png', coverPosition: '30% 70%' });
    expect(result.items[0].resources).toBeUndefined();
    expect(result.files['assets/ast_image/rev_one/cover.png']).toEqual(imageBytes);
  });
  it('automatically freezes inline images once and preserves their place in the text', async () => {
    const imageBytes = new Uint8Array([137, 80, 78, 71]);
    const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', imageBytes))).map(b => b.toString(16).padStart(2, '0')).join('');
    const href = '../../assets/ast_image/rev_one/image.png';
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ assets: [{ id: 'ast_image', revisions: [{ original: { path: 'rev_one/image.png', mediaType: 'image/png', bytes: imageBytes.length, sha256 } }] }] })))
      .mockResolvedValueOnce(new Response(imageBytes, { headers: { 'Content-Type': 'image/png' } }));
    vi.stubGlobal('fetch', fetcher);
    const source = { ...item, sections: [{ heading: 'Scope', text: '', blocks: [{ text: 'Before' }, { image: { href, label: '' } }, { text: 'After' }, { image: { href, label: 'Again' } }] }] };
    const result = await prepareShareResources([source], []);
    expect(result.files['assets/ast_image/rev_one/image.png']).toEqual(imageBytes);
    expect(result.items[0].sections[0].blocks).toEqual([{ text: 'Before' }, { image: { href: 'assets/ast_image/rev_one/image.png', label: '' } }, { text: 'After' }, { image: { href: 'assets/ast_image/rev_one/image.png', label: 'Again' } }]);
    expect(result.items[0].resources).toHaveLength(1);
    expect(result.items[0].resources?.[0]).toMatchObject({ inline: true, image: true, sha256 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('retains image intent for explicitly selected external images without a file extension', async () => {
    const choices = shareResourceChoices([{ id: 'TALK-001', links: [], sections: [{ heading: 'Scope', markdown: '![Diagram](https://example.com/image?id=1)' }] } as any]);
    const result = await prepareShareResources([item], choices);
    expect(result.items[0].resources).toEqual([{ label: 'Diagram', href: 'https://example.com/image?id=1', image: true, inline: true }]);
  });
  it('does not automatically include images from internal sections', () => {
    const choices = shareResourceChoices([{ id: 'TALK-001', links: [], sections: [
      { heading: 'Internal notes', markdown: '![Internal diagram](https://example.com/internal.png)' },
      { heading: 'Scope', markdown: '![Public diagram](https://example.com/public.png)' },
    ] } as any]);
    expect(choices.filter(choice => choice.inline).map(choice => choice.label)).toEqual(['Public diagram']);
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
