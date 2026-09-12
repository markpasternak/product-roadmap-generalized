import { getVisibleDocCollections } from "../lib/docs";
import { IS_PUBLIC } from "../lib/audience";
import { repositoryRoot } from "../lib/server/repositoryRoot";
import { assetCatalog } from "../../scripts/managed-assets.mjs";
export async function GET() {
  const documents = (await getVisibleDocCollections()).flatMap(
    ({ root, entries }) =>
      entries.map((e) => ({
        title: e.data.title ?? e.id,
        path: `content/${root}/${e.id}.md`,
      })),
  );
  const assets = (
    await assetCatalog(repositoryRoot())
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
