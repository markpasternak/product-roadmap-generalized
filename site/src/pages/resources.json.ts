import { getVisibleDocCollections } from "../lib/docs";
import { IS_PUBLIC } from "../lib/audience";
import { assetCatalog } from "../../scripts/managed-assets.mjs";
import { fileURLToPath } from "node:url";
export async function GET() {
  const documents = (await getVisibleDocCollections()).flatMap(
    ({ root, entries }) =>
      entries.map((e) => ({
        title: e.data.title ?? e.id,
        path: `content/${root}/${e.id}.md`,
      })),
  );
  const assets = (
    await assetCatalog(fileURLToPath(new URL("../../../", import.meta.url)))
  )
    .filter((a: any) => !IS_PUBLIC || a.visibility === "Public")
    .map((a: any) => ({
      id: a.id,
      name: a.name,
      visibility: a.visibility,
      revisions: a.revisions.map((r: any) => ({
        id: r.id,
        original: r.original,
      })),
    }));
  return Response.json({ documents, assets });
}
