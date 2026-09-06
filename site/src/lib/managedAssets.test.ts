// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import managedAssets, { assetCatalog } from "../../scripts/managed-assets.mjs";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture(visibility = "Internal") {
  const root = await mkdtemp(join(tmpdir(), "roadmap-assets-"));
  roots.push(root);
  const path = "content/assets/ast_test/rev_one/notes.txt";
  const bytes = Buffer.from("Original notes.");
  await mkdir(join(root, "content/assets/ast_test/rev_one"), {
    recursive: true,
  });
  await writeFile(join(root, path), bytes);
  const asset = {
    schemaVersion: 1,
    id: "ast_test",
    name: "Notes",
    visibility,
    revisions: [
      {
        id: "rev_one",
        original: {
          path: "rev_one/notes.txt",
          mediaType: "text/plain; charset=utf-8",
          bytes: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        },
      },
    ],
  };
  await writeFile(
    join(root, "content/assets/ast_test/asset.json"),
    JSON.stringify(asset),
  );
  await mkdir(join(root, "dist"));
  return { root, bytes, path, asset };
}
async function bake(root: string, audience: string) {
  await managedAssets(audience, "/roadmap/", root).hooks["astro:build:done"]({
    dir: pathToFileURL(join(root, "dist/")),
  });
}
describe("Git originals in static builds", () => {
  it("copies exact referenced originals and excludes unused originals", async () => {
    const f = await fixture();
    await writeFile(
      join(f.root, "dist/index.html"),
      '<a href="/roadmap/assets/ast_test/rev_one/notes.txt">Notes</a>',
    );
    await bake(f.root, "internal");
    expect(
      await readFile(join(f.root, "dist/assets/ast_test/rev_one/notes.txt")),
    ).toEqual(f.bytes);
    const unused = await fixture();
    await bake(unused.root, "internal");
    await expect(
      readFile(join(unused.root, "dist/assets/ast_test/rev_one/notes.txt")),
    ).rejects.toThrow();
  });
  it("fails public builds that reference Internal or missing resources", async () => {
    const f = await fixture();
    await writeFile(
      join(f.root, "dist/index.html"),
      "/assets/ast_test/rev_one/notes.txt",
    );
    await expect(bake(f.root, "public")).rejects.toThrow("Internal");
    await writeFile(
      join(f.root, "dist/index.html"),
      "/assets/ast_missing/rev_one/notes.txt",
    );
    await expect(bake(f.root, "internal")).rejects.toThrow("missing");
  });
  it("accepts Public originals and rejects changed bytes, active types and symlinks", async () => {
    const f = await fixture("Public");
    await writeFile(
      join(f.root, "dist/index.html"),
      "/assets/ast_test/rev_one/notes.txt",
    );
    await bake(f.root, "public");
    await writeFile(join(f.root, f.path), "Changed");
    await expect(assetCatalog(f.root)).rejects.toThrow("checksum");
    await writeFile(join(f.root, f.path), f.bytes);
    f.asset.revisions[0].original.mediaType = "text/html";
    await writeFile(
      join(f.root, "content/assets/ast_test/asset.json"),
      JSON.stringify(f.asset),
    );
    await expect(assetCatalog(f.root)).rejects.toThrow("revision");
    const linked = await fixture();
    await rm(join(linked.root, linked.path));
    await symlink("/etc/hosts", join(linked.root, linked.path));
    await expect(assetCatalog(linked.root)).rejects.toThrow("Symbolic");
  });
});
